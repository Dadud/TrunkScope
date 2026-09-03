# SDR receivers and multi-radio setups

TrunkScope supports multiple local USB SDRs and multiple remote SoapyRemote nodes on the same appliance. Each enabled receiver can become its own Trunk Recorder `sources[]` entry when more than one receiver is configured.

## Supported hardware

| UI driver | Soapy module | Typical use |
|-----------|--------------|-------------|
| SDRplay RSP | `sdrplay` (vendor mount) | Primary P25 trunking, wide bandwidth |
| RTL-SDR | `rtlsdr` | Budget VHF/UHF monitoring |
| Airspy | `airspy` | Higher dynamic range VHF/UHF |
| HackRF | `hackrf` | Experimental wideband (receive-only) |
| PlutoSDR | `plutosdr` | Network or USB ADALM-Pluto |
| bladeRF | `bladerf` | Lab / wideband experimentation |
| LimeSDR | `lms` | Wideband experimentation |
| Generic Soapy | varies | Any SoapySDR-compatible device |
| Remote | `remote` | SoapyRemote TCP endpoint on another host |

The appliance image installs `soapysdr-module-rtlsdr`, `soapysdr-module-airspy`, and `soapysdr-module-remote` by default. SDRplay uses the vendor runtime mounted at `/opt/sdrplay` on Unraid.

## Adding receivers

1. Open **Appliance → Receivers**.
2. Click **Discover devices** to list local Soapy indices (`soapy=0`, `soapy=1`, …).
3. Pick a device or enter a device string manually:
   - Local USB: `driver=sdrplay` with Soapy index `0`
   - Remote node: `driver=remote,remote=tcp://192.168.1.50:55132,remote:driver=sdrplay`
4. Save the receiver. Decoder config regenerates automatically.

## Device presets (optimal defaults)

The add-receiver form defaults each driver to **per-model optimal settings** served from `GET /api/v1/receivers/presets` (source: `apps/control-plane/src/receiver_presets.rs`). Picking a driver + model applies center frequency, sample rate, gain, and PPM in one step; the Soapy args string is auto-seeded from the driver.

| Model | Center (default) | Sample rate | Gain | Notes |
|-------|------------------|-------------|------|-------|
| RTL-SDR Blog V3 | 154.0 MHz | 2.4 MS/s | 32 dB | 1 PPM TCXO; stable max 2.4 MS/s |
| RTL-SDR Blog V4 / V4L | 154.0 MHz | 2.4 MS/s | 32 dB | Improved front end; needs recent drivers |
| Generic RTL2832U | 154.0 MHz | 2.048 MS/s | 36 dB | Calibrate PPM before trunking |
| SDRplay RSP1 | 154.0 MHz | 2 MS/s | 40 dB | IF gain 20-59 dB |
| SDRplay RSP1A/RSP1B | 154.0 MHz | 4 MS/s | 40 dB | Up to 10 MS/s (12-bit packed >2 MS/s) |
| SDRplay RSPdx / RSPduo | 154.0 MHz | 4 MS/s | 40 dB | Antenna A; RSPduo runs tuner A |
| Airspy R2 | 154.0 MHz | 2.5 MS/s | 30 dB | LNA/MIX/VGA split 8/6/11 at 30 dB |
| Airspy Mini | 154.0 MHz | 3 MS/s | 30 dB | 6 or 3 MS/s |

The default center frequency sits in the **VHF-High public-safety band** at 154.0 MHz, where 2-4 MS/s covers the 152-156 MHz fire/EMS/police allocations (including Black River Falls P25 at 152.1125/152.2175). Retune for your plan:

- UHF (450-512 MHz)
- 700 MHz (763-806 MHz)
- 800 MHz (851-869 MHz)

Sample-rate lists in receiver capabilities now reflect the real per-device sets (SDRplay API rates 0.5-10 MS/s; RTL stable rates up to 2.4 MS/s; Airspy 2.5/3/6/10 MS/s).

## Multi-USB on one host

- Assign explicit **Soapy index** values (`0`, `1`, …) so Trunk Recorder opens the correct stick.
- Use a powered USB hub for multiple RTL-SDR devices.
- Prefer one capable wideband receiver (SDRplay/Airspy) for P25 trunking and a second RTL for analog FM when possible.

## Multiple remote nodes

Deploy `deploy/receiver-node` on each host with USB hardware attached. On the appliance, add one receiver per `remote=tcp://HOST:55132,...` endpoint. Mixed local + remote receivers are supported.

## System assignment

On **Appliance → Systems**, set **Assigned receiver** for each P25 or analog profile. Unassigned systems use the first enabled receiver (backward compatible with single-radio installs).

When two or more enabled receivers exist, each source is tuned only from its assigned systems' control channels and analog frequencies.

## Decoder restart

Receiver and system changes rewrite `/var/lib/trunkscope/audio/decoder/config.json`. Restart Trunk Recorder (container restart on appliance) to apply RF retuning when sources change.

## Verification

Use **Probe**, **Capabilities**, and **Verify** on each receiver row. Verify checks profile, stream state, decoder connectivity, and remote TCP reachability for SoapyRemote endpoints.
