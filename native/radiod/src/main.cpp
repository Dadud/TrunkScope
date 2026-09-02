#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <complex>
#include <csignal>
#include <cstdint>
#include <cstdlib>
#include <iomanip>
#include <iostream>
#include <limits>
#include <memory>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <thread>
#include <vector>

#ifdef TRUNKSCOPE_WITH_SOAPY
#include <SoapySDR/Constants.h>
#include <SoapySDR/Device.hpp>
#include <SoapySDR/Errors.hpp>
#include <SoapySDR/Formats.hpp>
#include <SoapySDR/Version.hpp>
#endif

namespace {

using Clock = std::chrono::steady_clock;
std::atomic_bool running{true};
void stop(int) { running = false; }

std::string json_escape(std::string_view value) {
  std::ostringstream escaped;
  for (const char character : value) {
    switch (character) {
      case '"': escaped << "\\\""; break;
      case '\\': escaped << "\\\\"; break;
      case '\n': escaped << "\\n"; break;
      case '\r': escaped << "\\r"; break;
      case '\t': escaped << "\\t"; break;
      default:
        if (static_cast<unsigned char>(character) < 0x20) {
          escaped << "\\u" << std::hex << std::setw(4) << std::setfill('0')
                  << static_cast<int>(static_cast<unsigned char>(character));
        } else {
          escaped << character;
        }
    }
  }
  return escaped.str();
}

struct Options {
  enum class Mode { list, capabilities, self_test, monitor };
  Mode mode{Mode::list};
  std::string device_args;
  double frequency_hz{0};
  double sample_rate_hz{2'400'000};
  std::optional<double> bandwidth_hz;
  std::optional<double> gain_db;
  bool agc{false};
  double ppm{0};
  unsigned seconds{10};
  bool simulate{false};
};

double parse_number(std::string_view flag, std::string_view value) {
  std::size_t parsed = 0;
  const auto number = std::stod(std::string{value}, &parsed);
  if (parsed != value.size() || !std::isfinite(number)) {
    throw std::invalid_argument(std::string{flag} + " must be a finite number");
  }
  return number;
}

Options parse_options(int argc, char** argv) {
  Options options;
  auto value_after = [&](int& index, std::string_view flag) -> std::string_view {
    if (++index >= argc) throw std::invalid_argument(std::string{flag} + " requires a value");
    return argv[index];
  };

  for (int index = 1; index < argc; ++index) {
    const std::string_view argument{argv[index]};
    if (argument == "--list-devices") options.mode = Options::Mode::list;
    else if (argument == "--capabilities") options.mode = Options::Mode::capabilities;
    else if (argument == "--self-test") options.mode = Options::Mode::self_test;
    else if (argument == "--monitor") options.mode = Options::Mode::monitor;
    else if (argument == "--simulate") options.simulate = true;
    else if (argument == "--agc") options.agc = true;
    else if (argument == "--device") options.device_args = value_after(index, argument);
    else if (argument == "--frequency-hz") options.frequency_hz = parse_number(argument, value_after(index, argument));
    else if (argument == "--sample-rate-hz") options.sample_rate_hz = parse_number(argument, value_after(index, argument));
    else if (argument == "--bandwidth-hz") options.bandwidth_hz = parse_number(argument, value_after(index, argument));
    else if (argument == "--gain-db") options.gain_db = parse_number(argument, value_after(index, argument));
    else if (argument == "--ppm") options.ppm = parse_number(argument, value_after(index, argument));
    else if (argument == "--seconds") {
      const auto seconds = parse_number(argument, value_after(index, argument));
      if (seconds < 1 || seconds > 3600 || std::floor(seconds) != seconds) {
        throw std::invalid_argument("--seconds must be an integer from 1 to 3600");
      }
      options.seconds = static_cast<unsigned>(seconds);
    } else if (argument == "--help" || argument == "-h") {
      std::cout << "TrunkScope radiod\n\n"
                   "  --list-devices\n"
                   "  --capabilities --device driver=sdrplay[,serial=...]\n"
                   "  --self-test --device ... --frequency-hz HZ [options]\n"
                   "  --monitor --device ... --frequency-hz HZ [options]\n\n"
                   "Options: --sample-rate-hz HZ --bandwidth-hz HZ --gain-db DB\n"
                   "         --agc --ppm PPM --seconds N --simulate\n";
      std::exit(0);
    } else {
      throw std::invalid_argument("unknown option: " + std::string{argument});
    }
  }

  if ((options.mode == Options::Mode::self_test || options.mode == Options::Mode::monitor) &&
      options.frequency_hz <= 0) {
    throw std::invalid_argument("--frequency-hz is required and must be positive");
  }
  if (options.sample_rate_hz <= 0) throw std::invalid_argument("--sample-rate-hz must be positive");
  return options;
}

struct StreamStats {
  std::uint64_t samples{0};
  std::uint64_t reads{0};
  std::uint64_t timeouts{0};
  std::uint64_t overflows{0};
  double sum_power{0};
  float peak{0};
  std::complex<double> dc_sum{0, 0};

  void add(const std::complex<float>* buffer, std::size_t count) {
    for (std::size_t index = 0; index < count; ++index) {
      sum_power += static_cast<double>(std::norm(buffer[index]));
      peak = std::max(peak, std::abs(buffer[index]));
      dc_sum += buffer[index];
    }
    samples += count;
    ++reads;
  }
};

double power_dbfs(const StreamStats& stats) {
  if (stats.samples == 0 || stats.sum_power <= 0) return -200.0;
  return 10.0 * std::log10(stats.sum_power / static_cast<double>(stats.samples));
}

double peak_dbfs(const StreamStats& stats) {
  return stats.peak > 0 ? 20.0 * std::log10(stats.peak) : -200.0;
}

double dc_level(const StreamStats& stats) {
  return stats.samples > 0 ? std::abs(stats.dc_sum / static_cast<double>(stats.samples)) : 0;
}

void emit_metric(std::uint64_t sequence, const StreamStats& interval, const StreamStats& total,
                 double sample_rate_hz) {
  std::cout << std::fixed << std::setprecision(3)
            << "{\"sequence\":" << sequence << ",\"type\":\"receiverMetric\""
            << ",\"signalDbfs\":" << power_dbfs(interval)
            << ",\"peakDbfs\":" << peak_dbfs(interval)
            << ",\"dcLevel\":" << dc_level(interval)
            << ",\"sampleRateHz\":" << sample_rate_hz
            << ",\"samples\":" << total.samples << ",\"reads\":" << total.reads
            << ",\"timeouts\":" << total.timeouts << ",\"overflows\":" << total.overflows
            << "}\n" << std::flush;
}

int simulated_stream(const Options& options) {
  // Match practical SDR transfer batches and avoid timer-granularity under-runs.
  constexpr std::size_t block_size = 65'536;
  std::vector<std::complex<float>> buffer(block_size);
  StreamStats total;
  StreamStats interval;
  std::uint64_t sequence = 0;
  double phase = 0;
  const auto started = Clock::now();
  auto next_metric = started + std::chrono::seconds{1};
  const auto deadline = options.mode == Options::Mode::self_test
                            ? started + std::chrono::seconds{options.seconds}
                            : Clock::time_point::max();

  std::cerr << "trunkscope-radiod: synthetic IQ source active\n";
  while (running && Clock::now() < deadline) {
    for (auto& sample : buffer) {
      phase += 0.03125;
      sample = {static_cast<float>(0.12 * std::cos(phase)),
                static_cast<float>(0.12 * std::sin(phase))};
    }
    total.add(buffer.data(), buffer.size());
    interval.add(buffer.data(), buffer.size());
    std::this_thread::sleep_for(
        std::chrono::duration<double>{static_cast<double>(block_size) / options.sample_rate_hz});
    if (Clock::now() >= next_metric) {
      emit_metric(++sequence, interval, total, options.sample_rate_hz);
      interval = {};
      next_metric += std::chrono::seconds{1};
    }
  }

  const auto elapsed = std::chrono::duration<double>(Clock::now() - started).count();
  // Synthetic generation is intentionally CPU-paced; hardware self-tests enforce
  // real-time throughput, while this path verifies framing and supervision only.
  const bool healthy = total.samples > 0 && total.timeouts == 0 && total.overflows == 0;
  std::cout << "{\"type\":\"selfTestResult\",\"healthy\":"
            << (healthy ? "true" : "false") << ",\"simulated\":true,\"samples\":"
            << total.samples << ",\"elapsedSeconds\":" << std::fixed << std::setprecision(3)
            << elapsed << "}\n";
  return healthy ? 0 : 2;
}

#ifdef TRUNKSCOPE_WITH_SOAPY

using DeviceHandle = std::unique_ptr<SoapySDR::Device, void (*)(SoapySDR::Device*)>;

DeviceHandle make_device(const std::string& arguments) {
  auto* device = SoapySDR::Device::make(SoapySDR::KwargsFromString(arguments));
  if (!device) throw std::runtime_error("SoapySDR did not return a device");
  return {device, [](SoapySDR::Device* value) { SoapySDR::Device::unmake(value); }};
}

std::string value_or(const SoapySDR::Kwargs& values, const std::string& key,
                     const std::string& fallback = "") {
  const auto found = values.find(key);
  return found == values.end() ? fallback : found->second;
}

void list_devices() {
  const auto devices = SoapySDR::Device::enumerate();
  std::cout << "{\"type\":\"deviceList\",\"count\":" << devices.size()
            << ",\"soapyVersion\":\"" << json_escape(SoapySDR::getLibVersion()) << "\"}\n";
  for (std::size_t index = 0; index < devices.size(); ++index) {
    const auto& device = devices[index];
    std::cout << "{\"type\":\"device\",\"index\":" << index
              << ",\"driver\":\"" << json_escape(value_or(device, "driver", "unknown"))
              << "\",\"label\":\"" << json_escape(value_or(device, "label", "SDR receiver"))
              << "\",\"serial\":\"" << json_escape(value_or(device, "serial"))
              << "\",\"args\":\"" << json_escape(SoapySDR::KwargsToString(device))
              << "\"}\n";
  }
}

template <typename Range>
void print_ranges(const std::vector<Range>& ranges) {
  std::cout << '[';
  for (std::size_t index = 0; index < ranges.size(); ++index) {
    if (index) std::cout << ',';
    std::cout << "{\"minimum\":" << ranges[index].minimum()
              << ",\"maximum\":" << ranges[index].maximum()
              << ",\"step\":" << ranges[index].step() << '}';
  }
  std::cout << ']';
}

void capabilities(const Options& options) {
  auto device = make_device(options.device_args);
  if (device->getNumChannels(SOAPY_SDR_RX) == 0) throw std::runtime_error("device has no RX channels");
  std::cout << "{\"type\":\"capabilities\",\"driver\":\""
            << json_escape(device->getDriverKey()) << "\",\"hardware\":\""
            << json_escape(device->getHardwareKey()) << "\",\"rxChannels\":"
            << device->getNumChannels(SOAPY_SDR_RX) << ",\"frequencyRanges\":";
  print_ranges(device->getFrequencyRange(SOAPY_SDR_RX, 0));
  std::cout << ",\"sampleRateRanges\":";
  print_ranges(device->getSampleRateRange(SOAPY_SDR_RX, 0));
  std::cout << ",\"bandwidthRanges\":";
  print_ranges(device->getBandwidthRange(SOAPY_SDR_RX, 0));
  std::cout << ",\"supportsAgc\":"
            << (device->hasGainMode(SOAPY_SDR_RX, 0) ? "true" : "false")
            << ",\"gainElements\":[";
  const auto gains = device->listGains(SOAPY_SDR_RX, 0);
  for (std::size_t index = 0; index < gains.size(); ++index) {
    if (index) std::cout << ',';
    std::cout << '"' << json_escape(gains[index]) << '"';
  }
  std::cout << "]}\n";
}

int hardware_stream(const Options& options) {
  auto device = make_device(options.device_args);
  if (device->getNumChannels(SOAPY_SDR_RX) == 0) throw std::runtime_error("device has no RX channels");

  device->setSampleRate(SOAPY_SDR_RX, 0, options.sample_rate_hz);
  if (options.bandwidth_hz) device->setBandwidth(SOAPY_SDR_RX, 0, *options.bandwidth_hz);
  device->setFrequency(SOAPY_SDR_RX, 0, options.frequency_hz);
  if (options.ppm != 0 && device->hasFrequencyCorrection(SOAPY_SDR_RX, 0)) {
    device->setFrequencyCorrection(SOAPY_SDR_RX, 0, options.ppm);
  }
  if (device->hasGainMode(SOAPY_SDR_RX, 0)) device->setGainMode(SOAPY_SDR_RX, 0, options.agc);
  if (!options.agc && options.gain_db) device->setGain(SOAPY_SDR_RX, 0, *options.gain_db);

  auto* stream = device->setupStream(SOAPY_SDR_RX, SOAPY_SDR_CF32, {0});
  if (!stream) throw std::runtime_error("failed to create RX stream");
  struct StreamGuard {
    SoapySDR::Device* device;
    SoapySDR::Stream* stream;
    bool active{false};
    ~StreamGuard() {
      if (active) device->deactivateStream(stream);
      device->closeStream(stream);
    }
  } guard{device.get(), stream};

  const auto mtu = std::max<std::size_t>(device->getStreamMTU(stream), 4096);
  std::vector<std::complex<float>> buffer(mtu);
  void* buffers[] = {buffer.data()};
  const auto actual_rate = device->getSampleRate(SOAPY_SDR_RX, 0);
  const auto actual_frequency = device->getFrequency(SOAPY_SDR_RX, 0);
  std::cout << "{\"type\":\"streamStarted\",\"driver\":\""
            << json_escape(device->getDriverKey()) << "\",\"hardware\":\""
            << json_escape(device->getHardwareKey()) << "\",\"frequencyHz\":"
            << actual_frequency << ",\"sampleRateHz\":" << actual_rate << ",\"mtu\":"
            << mtu << "}\n" << std::flush;

  const int activation = device->activateStream(stream);
  if (activation != 0) {
    throw std::runtime_error(std::string("activateStream failed: ") + SoapySDR::errToStr(activation));
  }
  guard.active = true;

  StreamStats total;
  StreamStats interval;
  std::uint64_t sequence = 0;
  const auto started = Clock::now();
  auto next_metric = started + std::chrono::seconds{1};
  const auto deadline = options.mode == Options::Mode::self_test
                            ? started + std::chrono::seconds{options.seconds}
                            : Clock::time_point::max();

  while (running && Clock::now() < deadline) {
    int flags = 0;
    long long time_ns = 0;
    const int received = device->readStream(stream, buffers, buffer.size(), flags, time_ns, 250'000);
    if (received > 0) {
      total.add(buffer.data(), static_cast<std::size_t>(received));
      interval.add(buffer.data(), static_cast<std::size_t>(received));
    } else if (received == SOAPY_SDR_TIMEOUT) {
      ++total.timeouts;
      ++interval.timeouts;
    } else if (received == SOAPY_SDR_OVERFLOW) {
      ++total.overflows;
      ++interval.overflows;
    } else {
      throw std::runtime_error(std::string("readStream failed: ") + SoapySDR::errToStr(received));
    }
    if (Clock::now() >= next_metric) {
      emit_metric(++sequence, interval, total, actual_rate);
      interval = {};
      next_metric += std::chrono::seconds{1};
    }
  }

  const auto elapsed = std::chrono::duration<double>(Clock::now() - started).count();
  const auto expected = actual_rate * elapsed;
  const bool enough_samples =
      total.samples >= static_cast<std::uint64_t>(expected * 0.80);
  const bool healthy = enough_samples && total.timeouts <= 2 && total.overflows <= 2;
  std::cout << "{\"type\":\"selfTestResult\",\"healthy\":"
            << (healthy ? "true" : "false") << ",\"simulated\":false,\"samples\":"
            << total.samples << ",\"expectedSamples\":" << static_cast<std::uint64_t>(expected)
            << ",\"timeouts\":" << total.timeouts << ",\"overflows\":" << total.overflows
            << ",\"signalDbfs\":" << power_dbfs(total) << ",\"peakDbfs\":"
            << peak_dbfs(total) << ",\"elapsedSeconds\":" << elapsed << "}\n";
  return healthy ? 0 : 2;
}

#endif

int run(const Options& options) {
  if (options.simulate) {
    if (options.mode == Options::Mode::list) {
      std::cout << "{\"type\":\"deviceList\",\"count\":1,\"simulated\":true}\n"
                   "{\"type\":\"device\",\"index\":0,\"driver\":\"simulator\","
                   "\"label\":\"Synthetic IQ\",\"serial\":\"SIM-001\","
                   "\"args\":\"simulate=true\"}\n";
      return 0;
    }
    if (options.mode == Options::Mode::capabilities) {
      std::cout << "{\"type\":\"capabilities\",\"driver\":\"simulator\","
                   "\"hardware\":\"synthetic\",\"rxChannels\":1,"
                   "\"frequencyRanges\":[{\"minimum\":24000000,\"maximum\":1800000000,\"step\":1}],"
                   "\"sampleRateRanges\":[{\"minimum\":250000,\"maximum\":10000000,\"step\":1}],"
                   "\"bandwidthRanges\":[],\"supportsAgc\":true,\"gainElements\":[\"LNA\"]}\n";
      return 0;
    }
    return simulated_stream(options);
  }

#ifdef TRUNKSCOPE_WITH_SOAPY
  switch (options.mode) {
    case Options::Mode::list: list_devices(); return 0;
    case Options::Mode::capabilities: capabilities(options); return 0;
    case Options::Mode::self_test:
    case Options::Mode::monitor: return hardware_stream(options);
  }
#else
  throw std::runtime_error(
      "radiod was built without SoapySDR; pass --simulate or rebuild with "
      "TRUNKSCOPE_WITH_SOAPY=ON");
#endif
  return 1;
}

}  // namespace

int main(int argc, char** argv) {
  std::signal(SIGINT, stop);
  std::signal(SIGTERM, stop);
  try {
    return run(parse_options(argc, argv));
  } catch (const std::exception& error) {
    std::cerr << "trunkscope-radiod: " << error.what() << '\n';
    std::cout << "{\"type\":\"fatalError\",\"message\":\""
              << json_escape(error.what()) << "\"}\n";
    return 1;
  }
}
