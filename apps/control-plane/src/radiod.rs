use std::{env, process::Stdio, sync::Arc, time::Duration};

use anyhow::{Context, Result, bail};
use chrono::Utc;
use serde::Deserialize;
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::Command,
    time::sleep,
};
use tracing::{error, info, warn};
use trunkscope_domain::{
    Receiver, ReceiverCapabilities, ReceiverDriver, ReceiverHealth, ReceiverState,
};
use uuid::Uuid;

use crate::state::AppState;

#[derive(Clone)]
struct RadioConfig {
    executable: String,
    device: String,
    frequency_hz: u64,
    sample_rate_hz: u32,
    bandwidth_hz: Option<u32>,
    gain_db: Option<f32>,
    agc: bool,
    ppm: f32,
}

impl RadioConfig {
    fn from_env() -> Result<Self> {
        let device = env::var("TRUNKSCOPE_RADIO_DEVICE")
            .context("TRUNKSCOPE_RADIO_DEVICE is required when TRUNKSCOPE_SIMULATOR=false")?;
        let frequency_hz = parse_required("TRUNKSCOPE_RADIO_FREQUENCY_HZ")?;
        if frequency_hz == 0 {
            bail!("TRUNKSCOPE_RADIO_FREQUENCY_HZ must be positive");
        }
        Ok(Self {
            executable: env::var("TRUNKSCOPE_RADIOD_PATH")
                .unwrap_or_else(|_| "/usr/local/bin/trunkscope-radiod".into()),
            device,
            frequency_hz,
            sample_rate_hz: parse_optional("TRUNKSCOPE_RADIO_SAMPLE_RATE_HZ")?.unwrap_or(2_400_000),
            bandwidth_hz: parse_optional("TRUNKSCOPE_RADIO_BANDWIDTH_HZ")?,
            gain_db: parse_optional("TRUNKSCOPE_RADIO_GAIN_DB")?,
            agc: env_bool("TRUNKSCOPE_RADIO_AGC", false),
            ppm: parse_optional("TRUNKSCOPE_RADIO_PPM")?.unwrap_or(0.0),
        })
    }
}

fn parse_required<T>(name: &str) -> Result<T>
where
    T: std::str::FromStr,
    T::Err: std::error::Error + Send + Sync + 'static,
{
    env::var(name)
        .with_context(|| format!("{name} is required"))?
        .parse()
        .with_context(|| format!("{name} has an invalid value"))
}

fn parse_optional<T>(name: &str) -> Result<Option<T>>
where
    T: std::str::FromStr,
    T::Err: std::error::Error + Send + Sync + 'static,
{
    env::var(name)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(|value| {
            value
                .parse()
                .with_context(|| format!("{name} has an invalid value"))
        })
        .transpose()
}

fn env_bool(name: &str, fallback: bool) -> bool {
    env::var(name)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(fallback)
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum RadioEvent {
    StreamStarted {
        driver: String,
        hardware: String,
        #[serde(rename = "frequencyHz")]
        frequency_hz: f64,
        #[serde(rename = "sampleRateHz")]
        sample_rate_hz: f64,
        mtu: usize,
    },
    ReceiverMetric {
        #[serde(rename = "signalDbfs")]
        signal_dbfs: f32,
        #[serde(rename = "peakDbfs")]
        peak_dbfs: f32,
        #[serde(rename = "dcLevel")]
        dc_level: f32,
        #[serde(rename = "sampleRateHz")]
        sample_rate_hz: f64,
        samples: u64,
        reads: u64,
        timeouts: u64,
        overflows: u64,
        sequence: u64,
    },
    SelfTestResult {
        healthy: bool,
        simulated: bool,
        samples: u64,
    },
    FatalError {
        message: String,
    },
}

pub fn spawn(state: Arc<AppState>) -> Result<()> {
    let config = RadioConfig::from_env()?;
    let receiver_id = Uuid::new_v4();
    state
        .receivers
        .write()
        .expect("receiver lock poisoned")
        .push(initial_receiver(receiver_id, &config));

    tokio::spawn(async move {
        let mut restart_delay = Duration::from_secs(1);
        loop {
            set_state(&state, receiver_id, ReceiverState::Offline);
            match run_once(&state, receiver_id, &config).await {
                Ok(()) => warn!("radiod exited; scheduling restart"),
                Err(cause) => error!(error = %cause, "radiod failed; scheduling restart"),
            }
            set_state(&state, receiver_id, ReceiverState::Faulted);
            sleep(restart_delay).await;
            restart_delay = (restart_delay * 2).min(Duration::from_secs(30));
        }
    });
    Ok(())
}

fn initial_receiver(id: Uuid, config: &RadioConfig) -> Receiver {
    let driver = if config.device.contains("sdrplay") {
        ReceiverDriver::Sdrplay
    } else if config.device.contains("airspy") {
        ReceiverDriver::Airspy
    } else {
        ReceiverDriver::RtlSdr
    };
    Receiver {
        id,
        label: if driver == ReceiverDriver::Sdrplay {
            "Remote SDRplay RSP1B".into()
        } else {
            "Remote SDR receiver".into()
        },
        driver,
        serial: config.device.clone(),
        state: ReceiverState::Offline,
        center_frequency_hz: Some(config.frequency_hz),
        sample_rate_hz: Some(config.sample_rate_hz),
        gain_db: config.gain_db,
        ppm: config.ppm,
        capabilities: ReceiverCapabilities {
            minimum_frequency_hz: 1_000,
            maximum_frequency_hz: 2_000_000_000,
            sample_rates_hz: vec![2_000_000, 2_400_000, 6_000_000, 8_000_000],
            maximum_bandwidth_hz: 8_000_000,
            supports_agc: true,
            gain_elements: vec!["IFGR".into(), "RFGR".into()],
        },
        health: ReceiverHealth {
            signal_dbfs: -200.0,
            noise_dbfs: -200.0,
            frequency_error_hz: 0.0,
            dropped_samples: 0,
            updated_at: Utc::now(),
        },
    }
}

async fn run_once(state: &Arc<AppState>, receiver_id: Uuid, config: &RadioConfig) -> Result<()> {
    let mut command = Command::new(&config.executable);
    command
        .arg("--monitor")
        .arg("--device")
        .arg(&config.device)
        .arg("--frequency-hz")
        .arg(config.frequency_hz.to_string())
        .arg("--sample-rate-hz")
        .arg(config.sample_rate_hz.to_string())
        .arg("--ppm")
        .arg(config.ppm.to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some(bandwidth) = config.bandwidth_hz {
        command.arg("--bandwidth-hz").arg(bandwidth.to_string());
    }
    if let Some(gain) = config.gain_db {
        command.arg("--gain-db").arg(gain.to_string());
    }
    if config.agc {
        command.arg("--agc");
    }

    info!(device = %config.device, frequency_hz = config.frequency_hz, "starting radiod");
    let mut child = command
        .spawn()
        .context("failed to start trunkscope-radiod")?;
    let stdout = child.stdout.take().context("radiod stdout was not piped")?;
    let stderr = child.stderr.take().context("radiod stderr was not piped")?;
    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            warn!(target: "trunkscope::radiod", "{line}");
        }
    });

    let mut lines = BufReader::new(stdout).lines();
    while let Some(line) = lines
        .next_line()
        .await
        .context("failed reading radiod output")?
    {
        match serde_json::from_str::<RadioEvent>(&line) {
            Ok(event) => apply_event(state, receiver_id, event),
            Err(cause) => warn!(%cause, %line, "ignored malformed radiod event"),
        }
    }
    let status = child.wait().await.context("failed waiting for radiod")?;
    if !status.success() {
        bail!("radiod exited with {status}");
    }
    Ok(())
}

fn apply_event(state: &AppState, receiver_id: Uuid, event: RadioEvent) {
    let mut receivers = state.receivers.write().expect("receiver lock poisoned");
    let Some(receiver) = receivers.iter_mut().find(|item| item.id == receiver_id) else {
        return;
    };
    match event {
        RadioEvent::StreamStarted {
            driver,
            hardware,
            frequency_hz,
            sample_rate_hz,
            mtu,
        } => {
            receiver.label = format!("{hardware} via {driver}");
            receiver.center_frequency_hz = Some(frequency_hz.round() as u64);
            receiver.sample_rate_hz = Some(sample_rate_hz.round() as u32);
            receiver.state = ReceiverState::Monitoring;
            info!(%hardware, %driver, %mtu, "radio stream started");
        }
        RadioEvent::ReceiverMetric {
            signal_dbfs,
            peak_dbfs,
            dc_level,
            sample_rate_hz,
            samples,
            reads,
            timeouts,
            overflows,
            sequence,
        } => {
            receiver.state = ReceiverState::Monitoring;
            receiver.sample_rate_hz = Some(sample_rate_hz.round() as u32);
            receiver.health.signal_dbfs = signal_dbfs;
            receiver.health.noise_dbfs = signal_dbfs - 20.0;
            receiver.health.dropped_samples = overflows;
            receiver.health.updated_at = Utc::now();
            tracing::debug!(%peak_dbfs, %dc_level, %samples, %reads, %timeouts, %sequence, "RF metric");
        }
        RadioEvent::SelfTestResult {
            healthy,
            simulated,
            samples,
        } => info!(%healthy, %simulated, %samples, "radio self-test finished"),
        RadioEvent::FatalError { message } => {
            receiver.state = ReceiverState::Faulted;
            error!(%message, "radiod reported fatal error");
        }
    }
}

fn set_state(state: &AppState, receiver_id: Uuid, receiver_state: ReceiverState) {
    if let Some(receiver) = state
        .receivers
        .write()
        .expect("receiver lock poisoned")
        .iter_mut()
        .find(|item| item.id == receiver_id)
    {
        receiver.state = receiver_state;
        receiver.health.updated_at = Utc::now();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_receiver_metric() {
        let event = serde_json::from_str::<RadioEvent>(
            r#"{"sequence":3,"type":"receiverMetric","signalDbfs":-31.2,"peakDbfs":-9.1,"dcLevel":0.002,"sampleRateHz":2400000,"samples":4800000,"reads":150,"timeouts":0,"overflows":0}"#,
        );
        assert!(matches!(
            event,
            Ok(RadioEvent::ReceiverMetric { sequence: 3, .. })
        ));
    }

    #[test]
    fn identifies_rsp1b_as_sdrplay() {
        let config = RadioConfig {
            executable: "radiod".into(),
            device: "driver=remote,remote=tcp://192.168.1.50:55132,remote:driver=sdrplay,remote:format=CS16".into(),
            frequency_hz: 851_012_500,
            sample_rate_hz: 2_400_000,
            bandwidth_hz: None,
            gain_db: None,
            agc: false,
            ppm: 0.0,
        };
        assert_eq!(
            initial_receiver(Uuid::new_v4(), &config).driver,
            ReceiverDriver::Sdrplay
        );
    }
}
