use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use trunkscope_domain::{Receiver, ReceiverDriver};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiverSubmodelPreset {
    pub id: &'static str,
    pub label: &'static str,
    pub sample_rate_hz: u32,
    pub gain_db: f32,
    pub ppm: f32,
    pub center_frequency_hz: u64,
    pub notes: &'static str,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiverDevicePreset {
    pub driver: ReceiverDriver,
    pub label: &'static str,
    pub submodels: Vec<ReceiverSubmodelPreset>,
}

const PUBLIC_SAFETY_VHF_CENTER_HZ: u64 = 154_000_000;

pub fn device_presets() -> Vec<ReceiverDevicePreset> {
    vec![
        ReceiverDevicePreset {
            driver: ReceiverDriver::RtlSdr,
            label: "RTL-SDR",
            submodels: vec![
                ReceiverSubmodelPreset {
                    id: "v3",
                    label: "RTL-SDR Blog V3",
                    sample_rate_hz: 2_400_000,
                    gain_db: 32.0,
                    ppm: 0.0,
                    center_frequency_hz: PUBLIC_SAFETY_VHF_CENTER_HZ,
                    notes: "1 PPM TCXO, R860 tuner, bias-tee available. Stable max rate 2.4 MS/s.",
                },
                ReceiverSubmodelPreset {
                    id: "v4",
                    label: "RTL-SDR Blog V4 / V4L",
                    sample_rate_hz: 2_400_000,
                    gain_db: 32.0,
                    ppm: 0.0,
                    center_frequency_hz: PUBLIC_SAFETY_VHF_CENTER_HZ,
                    notes: "Improved front-end filtering; requires recent rtl-sdr drivers.",
                },
                ReceiverSubmodelPreset {
                    id: "generic",
                    label: "Generic RTL2832U",
                    sample_rate_hz: 2_048_000,
                    gain_db: 36.0,
                    ppm: 0.0,
                    center_frequency_hz: PUBLIC_SAFETY_VHF_CENTER_HZ,
                    notes: "Clock quality varies; calibrate PPM before trunking.",
                },
            ],
        },
        ReceiverDevicePreset {
            driver: ReceiverDriver::Sdrplay,
            label: "SDRplay RSP",
            submodels: vec![
                ReceiverSubmodelPreset {
                    id: "rsp1",
                    label: "RSP1",
                    sample_rate_hz: 2_000_000,
                    gain_db: 40.0,
                    ppm: 0.0,
                    center_frequency_hz: PUBLIC_SAFETY_VHF_CENTER_HZ,
                    notes: "Legacy RSP1. IF gain 20-59 dB.",
                },
                ReceiverSubmodelPreset {
                    id: "rsp1a",
                    label: "RSP1A",
                    sample_rate_hz: 4_000_000,
                    gain_db: 40.0,
                    ppm: 0.0,
                    center_frequency_hz: PUBLIC_SAFETY_VHF_CENTER_HZ,
                    notes: "Up to 10 MS/s (12-bit packed above 2 MS/s). IF gain 20-59, RF 0-9 dB.",
                },
                ReceiverSubmodelPreset {
                    id: "rsp1b",
                    label: "RSP1B",
                    sample_rate_hz: 4_000_000,
                    gain_db: 40.0,
                    ppm: 0.0,
                    center_frequency_hz: PUBLIC_SAFETY_VHF_CENTER_HZ,
                    notes: "Up to 10 MS/s; 11 band preselection filters; onboard bias-T.",
                },
                ReceiverSubmodelPreset {
                    id: "rspdx",
                    label: "RSPdx",
                    sample_rate_hz: 4_000_000,
                    gain_db: 40.0,
                    ppm: 0.0,
                    center_frequency_hz: PUBLIC_SAFETY_VHF_CENTER_HZ,
                    notes: "Use antenna port A for VHF/UHF trunking.",
                },
                ReceiverSubmodelPreset {
                    id: "rspduo",
                    label: "RSPduo",
                    sample_rate_hz: 4_000_000,
                    gain_db: 40.0,
                    ppm: 0.0,
                    center_frequency_hz: PUBLIC_SAFETY_VHF_CENTER_HZ,
                    notes: "Runs tuner A in single-channel mode.",
                },
            ],
        },
        ReceiverDevicePreset {
            driver: ReceiverDriver::Airspy,
            label: "Airspy",
            submodels: vec![
                ReceiverSubmodelPreset {
                    id: "r2",
                    label: "Airspy R2",
                    sample_rate_hz: 2_500_000,
                    gain_db: 30.0,
                    ppm: 0.0,
                    center_frequency_hz: PUBLIC_SAFETY_VHF_CENTER_HZ,
                    notes: "10 or 2.5 MS/s, 12-bit. 24-1700 MHz.",
                },
                ReceiverSubmodelPreset {
                    id: "mini",
                    label: "Airspy Mini",
                    sample_rate_hz: 3_000_000,
                    gain_db: 30.0,
                    ppm: 0.0,
                    center_frequency_hz: PUBLIC_SAFETY_VHF_CENTER_HZ,
                    notes: "6 or 3 MS/s, 12-bit. 24-1700 MHz.",
                },
            ],
        },
    ]
}

pub fn submodel_preset(driver: ReceiverDriver, id: &str) -> Option<ReceiverSubmodelPreset> {
    device_presets()
        .into_iter()
        .find(|preset| preset.driver == driver)
        .and_then(|preset| preset.submodels.into_iter().find(|sub| sub.id == id))
}

pub fn infer_driver_from_device(device: &str) -> ReceiverDriver {
    let lower = device.to_ascii_lowercase();
    if lower.contains("simulator") {
        ReceiverDriver::Simulator
    } else if lower.contains("sdrplay") {
        ReceiverDriver::Sdrplay
    } else if lower.contains("airspy") {
        ReceiverDriver::Airspy
    } else if lower.contains("hackrf") {
        ReceiverDriver::HackRf
    } else if lower.contains("pluto") {
        ReceiverDriver::PlutoSdr
    } else if lower.contains("bladerf") {
        ReceiverDriver::BladeRf
    } else if lower.contains("lms") || lower.contains("lime") {
        ReceiverDriver::LimeSdr
    } else if lower.contains("rtlsdr") || lower.contains("rtl-sdr") {
        ReceiverDriver::RtlSdr
    } else {
        ReceiverDriver::GenericSoapy
    }
}

pub fn driver_from_soapy_name(name: &str) -> ReceiverDriver {
    match name.trim().to_ascii_lowercase().as_str() {
        "rtlsdr" | "rtl" => ReceiverDriver::RtlSdr,
        "airspy" => ReceiverDriver::Airspy,
        "sdrplay" => ReceiverDriver::Sdrplay,
        "hackrf" => ReceiverDriver::HackRf,
        "plutosdr" | "pluto" => ReceiverDriver::PlutoSdr,
        "bladerf" => ReceiverDriver::BladeRf,
        "lms" | "lime" => ReceiverDriver::LimeSdr,
        "remote" => ReceiverDriver::GenericSoapy,
        _ => ReceiverDriver::GenericSoapy,
    }
}

pub fn soapy_driver_arg(driver: ReceiverDriver) -> &'static str {
    match driver {
        ReceiverDriver::RtlSdr => "rtlsdr",
        ReceiverDriver::Airspy => "airspy",
        ReceiverDriver::Sdrplay => "sdrplay",
        ReceiverDriver::HackRf => "hackrf",
        ReceiverDriver::PlutoSdr => "plutosdr",
        ReceiverDriver::BladeRf => "bladerf",
        ReceiverDriver::LimeSdr => "lms",
        ReceiverDriver::GenericSoapy | ReceiverDriver::Simulator => "driver",
    }
}

pub fn default_gain_settings(driver: ReceiverDriver, gain_db: f32) -> Value {
    let gain = gain_db.round() as i64;
    match driver {
        ReceiverDriver::Sdrplay => json!({"IFGR": gain.max(20).min(59), "RFGR": 4}),
        ReceiverDriver::RtlSdr => json!({"LNA": gain.max(0).min(49), "TUNER": gain.max(0).min(49)}),
        ReceiverDriver::Airspy => {
            // Airspy element gains are 0-15 each; a linear split avoids
            // front-end overload while keeping the single gainDb control.
            let g = gain_db.clamp(0.0, 45.0);
            json!({
                "LNA": ((g * 0.27).round() as i64).clamp(0, 15),
                "MIX": ((g * 0.20).round() as i64).clamp(0, 15),
                "VGA": ((g * 0.37).round() as i64).clamp(0, 15),
            })
        }
        ReceiverDriver::HackRf => json!({"LNA": gain.max(0).min(40), "VGA": gain.max(0).min(62), "AMP": 0}),
        ReceiverDriver::PlutoSdr | ReceiverDriver::LimeSdr => json!({"hardwaregain": gain}),
        ReceiverDriver::BladeRf => json!({"gain": gain}),
        ReceiverDriver::GenericSoapy | ReceiverDriver::Simulator => json!({"gain": gain}),
    }
}

pub fn device_string(receiver: &Receiver, settings_device: &str, index: u32) -> String {
    let serial = receiver.serial.trim();
    if serial.contains("remote=") || serial.contains("soapy=") {
        return serial.to_string();
    }
    if settings_device.contains("remote=") && receivers_share_settings(receiver, settings_device) {
        return settings_device.to_string();
    }
    let soapy_index = receiver.soapy_index.unwrap_or(index);
    if serial.is_empty() {
        let driver = soapy_driver_arg(receiver.driver);
        if driver == "driver" {
            format!("soapy={soapy_index}")
        } else {
            format!("soapy={soapy_index},driver={driver}")
        }
    } else if serial.starts_with("driver=") {
        format!("soapy={soapy_index},{serial}")
    } else {
        format!("soapy={soapy_index},{serial}")
    }
}

fn receivers_share_settings(receiver: &Receiver, settings_device: &str) -> bool {
    receiver.serial.trim().is_empty()
        || settings_device.contains(&receiver.serial)
        || receiver.serial == "driver=sdrplay"
}

pub fn default_capabilities(driver: ReceiverDriver) -> trunkscope_domain::ReceiverCapabilities {
    use trunkscope_domain::ReceiverCapabilities;
    match driver {
        ReceiverDriver::Sdrplay => ReceiverCapabilities {
            minimum_frequency_hz: 1_000,
            maximum_frequency_hz: 2_000_000_000,
            sample_rates_hz: vec![500_000, 1_000_000, 2_000_000, 4_000_000, 6_000_000, 8_000_000, 10_000_000],
            maximum_bandwidth_hz: 8_000_000,
            supports_agc: true,
            gain_elements: vec!["IFGR".into(), "RFGR".into()],
        },
        ReceiverDriver::RtlSdr => ReceiverCapabilities {
            minimum_frequency_hz: 24_000_000,
            maximum_frequency_hz: 1_766_000_000,
            sample_rates_hz: vec![250_000, 1_024_000, 1_400_000, 1_800_000, 1_920_000, 2_048_000, 2_400_000],
            maximum_bandwidth_hz: 2_400_000,
            supports_agc: true,
            gain_elements: vec!["TUNER".into()],
        },
        ReceiverDriver::Airspy => ReceiverCapabilities {
            minimum_frequency_hz: 24_000_000,
            maximum_frequency_hz: 1_700_000_000,
            sample_rates_hz: vec![2_500_000, 3_000_000, 6_000_000, 10_000_000],
            maximum_bandwidth_hz: 10_000_000,
            supports_agc: false,
            gain_elements: vec!["LNA".into(), "MIX".into(), "VGA".into()],
        },
        ReceiverDriver::HackRf => ReceiverCapabilities {
            minimum_frequency_hz: 1_000_000,
            maximum_frequency_hz: 6_000_000_000,
            sample_rates_hz: vec![2_000_000, 4_000_000, 8_000_000, 10_000_000],
            maximum_bandwidth_hz: 20_000_000,
            supports_agc: false,
            gain_elements: vec!["LNA".into(), "VGA".into(), "AMP".into()],
        },
        ReceiverDriver::Simulator => ReceiverCapabilities {
            minimum_frequency_hz: 24_000_000,
            maximum_frequency_hz: 1_766_000_000,
            sample_rates_hz: vec![1_024_000, 2_400_000, 3_200_000],
            maximum_bandwidth_hz: 3_200_000,
            supports_agc: true,
            gain_elements: vec!["LNA".into()],
        },
        _ => ReceiverCapabilities {
            minimum_frequency_hz: 1_000_000,
            maximum_frequency_hz: 2_000_000_000,
            sample_rates_hz: vec![2_000_000, 2_048_000, 2_400_000],
            maximum_bandwidth_hz: 2_000_000,
            supports_agc: true,
            gain_elements: vec!["LNA".into(), "VGA".into()],
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn presets_cover_supported_hardware() {
        let presets = device_presets();
        let drivers: Vec<_> = presets.iter().map(|p| p.driver).collect();
        assert!(drivers.contains(&ReceiverDriver::RtlSdr));
        assert!(drivers.contains(&ReceiverDriver::Sdrplay));
        assert!(drivers.contains(&ReceiverDriver::Airspy));
        assert!(presets.iter().all(|p| !p.submodels.is_empty()));
    }

    #[test]
    fn rsp1b_defaults_use_sdrplay_api_sample_rate() {
        let preset = device_presets()
            .into_iter()
            .find(|p| p.driver == ReceiverDriver::Sdrplay)
            .unwrap();
        let rsp1b = preset.submodels.iter().find(|s| s.id == "rsp1b").unwrap();
        assert_eq!(rsp1b.sample_rate_hz, 4_000_000);
        assert!((20.0..=59.0).contains(&rsp1b.gain_db));
        assert_eq!(rsp1b.ppm, 0.0);
    }

    #[test]
    fn default_center_sits_in_vhf_public_safety_band() {
        for preset in device_presets() {
            for sub in preset.submodels {
                assert!(
                    (152_000_000..=156_000_000).contains(&sub.center_frequency_hz),
                    "{} center {} outside VHF public safety band",
                    sub.id,
                    sub.center_frequency_hz
                );
            }
        }
    }

    #[test]
    fn airspy_gain_split_stays_within_element_ranges() {
        for gain in [0.0, 15.0, 30.0, 45.0, 60.0] {
            let settings = default_gain_settings(ReceiverDriver::Airspy, gain);
            for element in ["LNA", "MIX", "VGA"] {
                let value = settings[element].as_i64().unwrap();
                assert!((0..=15).contains(&value), "{element}={value} at gain {gain}");
            }
        }
        let at_30 = default_gain_settings(ReceiverDriver::Airspy, 30.0);
        assert_eq!(at_30["LNA"].as_i64(), Some(8));
        assert_eq!(at_30["MIX"].as_i64(), Some(6));
        assert_eq!(at_30["VGA"].as_i64(), Some(11));
    }

    #[test]
    fn capabilities_list_device_sample_rates() {
        let rtl = default_capabilities(ReceiverDriver::RtlSdr);
        assert!(rtl.sample_rates_hz.contains(&2_400_000));
        assert!(!rtl.sample_rates_hz.contains(&2_048_001));
        let sdrplay = default_capabilities(ReceiverDriver::Sdrplay);
        assert!(sdrplay.sample_rates_hz.contains(&4_000_000));
        assert!(!sdrplay.sample_rates_hz.contains(&2_400_000));
        let airspy = default_capabilities(ReceiverDriver::Airspy);
        assert!(airspy.sample_rates_hz.contains(&2_500_000));
        assert!(airspy.sample_rates_hz.contains(&10_000_000));
    }
}
