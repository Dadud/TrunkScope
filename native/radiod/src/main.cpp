#include <algorithm>
#include <atomic>
#include <bit>
#include <chrono>
#include <cmath>
#include <complex>
#include <csignal>
#include <cstdint>
#include <cstdlib>
#include <iomanip>
#include <fstream>
#include <filesystem>
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
  std::string audio_output;
  double squelch_dbfs{-60.0};
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
    else if (argument == "--audio-output") options.audio_output = value_after(index, argument);
    else if (argument == "--squelch-dbfs") options.squelch_dbfs = parse_number(argument, value_after(index, argument));
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

class WavWriter {
 public:
  WavWriter() = default;
  ~WavWriter() { close(); }
  void open(const std::string& path, std::uint32_t sample_rate) {
    close();
    file_.open(path, std::ios::binary);
    if (!file_) throw std::runtime_error("failed to open audio output: " + path);
    path_ = path; sample_rate_ = sample_rate; samples_ = 0;
    write_header();
  }
  void write(float sample) {
    if (!file_) return;
    const auto value = static_cast<std::int16_t>(std::clamp(sample, -1.0f, 1.0f) * 32767.0f);
    file_.write(reinterpret_cast<const char*>(&value), sizeof(value)); ++samples_;
  }
  std::uint64_t samples() const { return samples_; }
  const std::string& path() const { return path_; }
  void close() {
    if (!file_) return;
    file_.seekp(4); write_u32(static_cast<std::uint32_t>(36 + samples_ * 2));
    file_.seekp(40); write_u32(static_cast<std::uint32_t>(samples_ * 2));
    file_.close();
  }
 private:
  std::ofstream file_;
  std::string path_;
  std::uint32_t sample_rate_{48000};
  std::uint64_t samples_{0};
  void write_u16(std::uint16_t v) { file_.write(reinterpret_cast<const char*>(&v), 2); }
  void write_u32(std::uint32_t v) { file_.write(reinterpret_cast<const char*>(&v), 4); }
  void write_header() {
    file_.write("RIFF", 4); write_u32(0); file_.write("WAVEfmt ", 8); write_u32(16);
    write_u16(1); write_u16(1); write_u32(sample_rate_); write_u32(sample_rate_ * 2);
    write_u16(2); write_u16(16); file_.write("data", 4); write_u32(0);
  }
};

[[maybe_unused]] std::optional<double> detect_ctcss(const std::vector<float>& samples, double sample_rate) {
  if (samples.size() < 4800) return std::nullopt;
  static constexpr double tones[] = {67.0, 71.9, 74.4, 77.0, 79.7, 82.5, 85.4, 88.5,
      91.5, 94.8, 97.4, 100.0, 103.5, 107.2, 110.9, 114.8, 118.8, 123.0,
      127.3, 131.8, 136.5, 141.3, 146.2, 151.4, 156.7, 162.2, 167.9,
      173.8, 179.9, 186.2, 192.8, 203.5, 210.7, 218.1, 225.7, 233.6, 241.8};
  const std::size_t count = std::min<std::size_t>(samples.size(), 48'000);
  double total = 0.0;
  for (std::size_t i = samples.size() - count; i < samples.size(); ++i) total += samples[i] * samples[i];
  if (total <= 1e-5) return std::nullopt;
  double best_power = 0.0;
  double best_tone = 0.0;
  for (const double tone : tones) {
    const auto omega = 2.0 * 3.14159265358979323846 * tone / sample_rate;
    double in_phase = 0.0, quadrature = 0.0;
    std::size_t index = 0;
    for (std::size_t i = samples.size() - count; i < samples.size(); ++i, ++index) {
      const auto value = static_cast<double>(samples[i]);
      in_phase += value * std::cos(omega * static_cast<double>(index));
      quadrature += value * std::sin(omega * static_cast<double>(index));
    }
    const auto power = (in_phase * in_phase + quadrature * quadrature) / static_cast<double>(count * count);
    if (power > best_power) { best_power = power; best_tone = tone; }
  }
  return best_power / (total / static_cast<double>(count)) > 0.08 ? std::optional<double>(best_tone) : std::nullopt;
}

// DCS is transmitted as a repeating 23-bit Golay(23,12) word at 134.4 bit/s.
// The discriminator stream is already audio-rate, so a sign-integrator is a
// useful, bounded detector before Golay nearest-codeword matching. We try both
// polarities because radios use normal and inverted DCS variants.
std::uint32_t dcs_encode(std::uint32_t data) {
  data &= 0x0fffU;
  auto remainder = data;
  for (int bit = 0; bit < 12; ++bit) {
    remainder <<= 1;
    if ((remainder & 0x1000U) != 0) remainder ^= 0x08eaU;
  }
  return data | ((remainder & 0x07ffU) << 12);
}

[[maybe_unused]] std::uint32_t reverse_bits23(std::uint32_t value) {
  std::uint32_t result = 0;
  for (int bit = 0; bit < 23; ++bit) result = (result << 1) | ((value >> bit) & 1U);
  return result;
}

struct DcsCandidate { std::uint32_t word; int code; bool inverted; };

const std::vector<DcsCandidate>& dcs_candidates() {
  static const auto candidates = [] {
    std::vector<DcsCandidate> values;
    values.reserve(1024);
    for (int code = 0; code < 512; ++code) {
      const auto word = dcs_encode(static_cast<std::uint32_t>(code) | 0x800U);
      values.push_back({word, code, false});
      values.push_back({word ^ 0x7fffffU, code, true});
    }
    return values;
  }();
  return candidates;
}

[[maybe_unused]] std::optional<std::string> detect_dcs(const std::vector<float>& samples, double sample_rate) {
  constexpr double baud = 134.4;
  constexpr int bits = 23;
  if (samples.size() < static_cast<std::size_t>(sample_rate * 0.45)) return std::nullopt;
  const auto samples_per_bit = sample_rate / baud;
  const auto window = static_cast<std::size_t>(std::ceil(samples_per_bit * bits));
  const auto start = samples.size() > static_cast<std::size_t>(sample_rate * 2.0)
                         ? samples.size() - static_cast<std::size_t>(sample_rate * 2.0) : 0;
  int best_distance = bits + 1;
  double best_confidence = 0.0;
  DcsCandidate best{};
  for (std::size_t offset = start; offset + window <= samples.size(); offset += 8) {
    std::uint32_t word = 0;
    double confidence = 0.0;
    for (int bit = 0; bit < bits; ++bit) {
      const auto begin = offset + static_cast<std::size_t>(std::floor(bit * samples_per_bit));
      const auto end = std::min(samples.size(), offset + static_cast<std::size_t>(std::floor((bit + 1) * samples_per_bit)));
      double sum = 0.0;
      for (auto index = begin; index < end; ++index) sum += samples[index];
      const auto average = sum / static_cast<double>(std::max<std::size_t>(1, end - begin));
      if (average >= 0) word |= 1U << (bits - bit - 1);
      confidence += std::abs(average);
    }
    confidence /= bits;
    for (const auto& candidate : dcs_candidates()) {
      const auto distance = std::popcount(word ^ candidate.word);
      if (distance < best_distance || (distance == best_distance && confidence > best_confidence)) {
        best_distance = distance; best_confidence = confidence; best = candidate;
      }
    }
  }
  if (best_distance > 3 || best_confidence < 0.01) return std::nullopt;
  std::ostringstream code;
  code << "D" << std::oct << std::setw(3) << std::setfill('0') << best.code
       << (best.inverted ? 'I' : 'N');
  return code.str();
}

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
  WavWriter audio;
  std::vector<float> simulated_audio;
  if (!options.audio_output.empty()) {
    std::filesystem::create_directories(options.audio_output);
    audio.open(options.audio_output + "/fm-simulated.wav", 48'000);
  }
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
    if (audio.samples() < static_cast<std::uint64_t>(options.seconds) * 48'000) {
      for (std::size_t index = 0; index < buffer.size() / 50; ++index) {
        const auto sample_index = audio.samples();
        const auto dcs_word = dcs_encode(0x800U | 023U); // D023N development fixture
        const auto dcs_bit = static_cast<int>(std::floor(static_cast<double>(sample_index) * 134.4 / 48'000.0)) % 23;
        const auto dcs_level = ((dcs_word >> (22 - dcs_bit)) & 1U) != 0 ? 0.18 : -0.18;
        const auto sample = static_cast<float>(dcs_level
          + 0.05 * std::sin(2.0 * 3.14159265358979323846 * 100.0 * static_cast<double>(sample_index) / 48'000.0)
          + 0.02 * std::sin(2.0 * 3.14159265358979323846 * 700.0 * static_cast<double>(sample_index) / 48'000.0));
        audio.write(sample);
        simulated_audio.push_back(sample);
      }
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
  if (audio.samples() > 0) {
    audio.close();
    const auto tone = detect_ctcss(simulated_audio, 48'000.0);
    const auto dcs = detect_dcs(simulated_audio, 48'000.0);
    std::cout << "{\"type\":\"audioSegment\",\"path\":\"" << json_escape(audio.path())
              << "\",\"durationMs\":" << (audio.samples() * 1000 / 48'000) << ",\"toneHz\":"
              << (tone ? std::to_string(*tone) : "null") << ",\"toneCode\":"
              << (dcs ? "\"" + json_escape(*dcs) + "\"" : "null") << "}\n";
  }
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
  double tuned_frequency = actual_frequency;
  WavWriter audio;
  std::complex<float> previous{1.0f, 0.0f};
  std::size_t decimation = std::max<std::size_t>(1, static_cast<std::size_t>(actual_rate / 48'000.0));
  std::size_t decimation_counter = 0;
  bool squelch_open = false;
  std::size_t quiet_blocks = 0;
  std::uint64_t segment_number = 0;
  std::vector<float> tone_samples;
  const auto audio_root = options.audio_output.empty() ? std::string{} : options.audio_output;
  if (!audio_root.empty() && !std::filesystem::create_directories(audio_root) &&
      !std::filesystem::is_directory(audio_root)) {
    throw std::runtime_error("failed to create audio output directory: " + audio_root);
  }
  const std::string retune_file = [] { const char* value = std::getenv("TRUNKSCOPE_RETUNE_FILE"); return value ? std::string(value) : std::string{"/tmp/trunkscope-retune-frequency"}; }();
  const auto deadline = options.mode == Options::Mode::self_test
                            ? started + std::chrono::seconds{options.seconds}
                            : Clock::time_point::max();

  while (running && Clock::now() < deadline) {
    std::ifstream requested_file(retune_file);
    double requested_frequency = 0;
    if (requested_file >> requested_frequency && requested_frequency > 0 && std::abs(requested_frequency - tuned_frequency) >= 1.0) {
      device->setFrequency(SOAPY_SDR_RX, 0, requested_frequency);
      tuned_frequency = device->getFrequency(SOAPY_SDR_RX, 0);
      std::cout << "{\"type\":\"retuned\",\"frequencyHz\":" << tuned_frequency << "}\n" << std::flush;
    }
    int flags = 0;
    long long time_ns = 0;
    const int received = device->readStream(stream, buffers, buffer.size(), flags, time_ns, 250'000);
    if (received > 0) {
      total.add(buffer.data(), static_cast<std::size_t>(received));
      interval.add(buffer.data(), static_cast<std::size_t>(received));
      StreamStats block;
      block.add(buffer.data(), static_cast<std::size_t>(received));
      const bool active = power_dbfs(block) >= options.squelch_dbfs;
      if (active && !squelch_open) {
        const auto path = audio_root + "/fm-" + std::to_string(++segment_number) + ".wav";
        audio.open(path, 48'000);
        squelch_open = true;
        quiet_blocks = 0;
      } else if (!active && squelch_open) {
        if (++quiet_blocks >= 4) {
          audio.close();
          std::cout << "{\"type\":\"audioSegment\",\"path\":\""
                    << json_escape(audio.path()) << "\",\"durationMs\":"
                    << (audio.samples() * 1000 / 48'000) << "}\n" << std::flush;
          squelch_open = false;
          quiet_blocks = 0;
        }
      } else if (active) {
        quiet_blocks = 0;
      }
      if (squelch_open) {
        for (int index = 0; index < received; ++index) {
          const auto sample = buffer[static_cast<std::size_t>(index)];
          const auto product = std::conj(previous) * sample;
          const float discriminator = static_cast<float>(std::atan2(product.imag(), product.real()) / 3.14159265358979323846);
          previous = sample;
          if (++decimation_counter >= decimation) {
            decimation_counter = 0;
            audio.write(discriminator * 0.8f);
            tone_samples.push_back(discriminator * 0.8f);
            if (tone_samples.size() > 96'000) tone_samples.erase(tone_samples.begin(), tone_samples.begin() + 48'000);
            if (audio.samples() >= 480'000) {
              audio.close();
              const auto tone = detect_ctcss(tone_samples, 48'000.0);
              const auto dcs = detect_dcs(tone_samples, 48'000.0);
              std::cout << "{\"type\":\"audioSegment\",\"path\":\""
                        << json_escape(audio.path()) << "\",\"durationMs\":"
                        << (audio.samples() * 1000 / 48'000) << ",\"toneHz\":"
                        << (tone ? std::to_string(*tone) : "null") << ",\"toneCode\":"
                        << (dcs ? "\"" + json_escape(*dcs) + "\"" : "null") << "}\n" << std::flush;
              const auto path = audio_root + "/fm-" + std::to_string(++segment_number) + ".wav";
              audio.open(path, 48'000);
              tone_samples.clear();
            }
          }
        }
      } else if (received > 0) {
        previous = buffer[static_cast<std::size_t>(received - 1)];
      }
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
  if (squelch_open) {
    audio.close();
    const auto tone = detect_ctcss(tone_samples, 48'000.0);
    const auto dcs = detect_dcs(tone_samples, 48'000.0);
    std::cout << "{\"type\":\"audioSegment\",\"path\":\""
              << json_escape(audio.path()) << "\",\"durationMs\":"
              << (audio.samples() * 1000 / 48'000) << ",\"toneHz\":"
              << (tone ? std::to_string(*tone) : "null") << ",\"toneCode\":"
              << (dcs ? "\"" + json_escape(*dcs) + "\"" : "null") << "}\n" << std::flush;
  }
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
