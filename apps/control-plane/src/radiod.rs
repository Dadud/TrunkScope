use std::{env, process::Stdio, sync::Arc, time::Duration};

use anyhow::{Context, Result, bail};
use chrono::Utc;
use serde::Deserialize;
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::Command,
    time::sleep,
};
use tracing::{debug, error, info, warn};
use trunkscope_domain::{
    AudioAsset, Call, CallEvent, CallState, EncryptionState, Receiver, ReceiverDriver,
    ReceiverHealth, ReceiverRole, ReceiverState,
};
use uuid::Uuid;

use crate::{
    receiver_presets,
    state::{AppState, ReceiverCommand},
};

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
    audio_output: String,
    squelch_dbfs: f32,
}

impl RadioConfig {
    fn from_settings(state: &AppState) -> Result<Self> {
        let settings = state
            .settings
            .read()
            .expect("settings lock poisoned")
            .clone();
        let device = if settings.radio_device.trim().is_empty() {
            env::var("TRUNKSCOPE_RADIO_DEVICE")
                .context("a radio device is required when hardware mode is enabled")?
        } else {
            settings.radio_device
        };
        let frequency_hz = settings.radio_frequency_hz;
        if frequency_hz == 0 {
            bail!("radio frequency must be positive");
        }
        Ok(Self {
            executable: env::var("TRUNKSCOPE_RADIOD_PATH")
                .unwrap_or_else(|_| "/usr/local/bin/trunkscope-radiod".into()),
            device,
            frequency_hz,
            sample_rate_hz: settings.radio_sample_rate_hz,
            bandwidth_hz: settings.radio_bandwidth_hz,
            gain_db: settings.radio_gain_db,
            agc: settings.radio_agc,
            ppm: settings.radio_ppm,
            audio_output: env::var("TRUNKSCOPE_CALLS_PATH")
                .unwrap_or_else(|_| "/var/lib/trunkscope/calls".into()),
            squelch_dbfs: state
                .systems
                .read()
                .expect("systems lock poisoned")
                .iter()
                .find(|profile| profile.protocol == "analog-fm")
                .and_then(|profile| profile.squelch_db)
                .unwrap_or(-60.0),
        })
    }
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
    Retuned {
        #[serde(rename = "frequencyHz")]
        frequency_hz: f64,
    },
    SelfTestResult {
        healthy: bool,
        simulated: bool,
        samples: u64,
    },
    AudioSegment {
        path: String,
        #[serde(rename = "durationMs")]
        duration_ms: u64,
        #[serde(rename = "toneHz")]
        tone_hz: Option<f64>,
        #[serde(rename = "toneCode")]
        tone_code: Option<String>,
    },
    FatalError {
        message: String,
    },
}

pub fn spawn(state: Arc<AppState>) -> Result<()> {
    let config = RadioConfig::from_settings(&state)?;
    let receiver_id = {
        let mut receivers = state.receivers.write().expect("receiver lock poisoned");
        if let Some(existing) = receivers.first_mut() {
            // Keep the durable profile identity across restarts while applying
            // the authoritative persisted radio settings to the live worker.
            let id = existing.id;
            existing.driver = initial_receiver(id, &config).driver;
            existing.center_frequency_hz = Some(config.frequency_hz);
            existing.sample_rate_hz = Some(config.sample_rate_hz);
            existing.gain_db = config.gain_db;
            existing.ppm = config.ppm;
            existing.state = ReceiverState::Probing;
            id
        } else {
            let id = Uuid::new_v4();
            receivers.push(initial_receiver(id, &config));
            id
        }
    };

    tokio::spawn(async move {
        let mut restart_delay = Duration::from_secs(1);
        let mut commands = state.receiver_commands.subscribe();
        let mut paused = false;
        let mut failures = 0u8;
        loop {
            if paused {
                match commands.recv().await {
                    Ok(
                        ReceiverCommand::Start(id)
                        | ReceiverCommand::Restart(id)
                        | ReceiverCommand::Probe(id),
                    ) if id == receiver_id => {
                        paused = false;
                        set_state(&state, receiver_id, ReceiverState::Probing);
                    }
                    Ok(_) => {}
                    Err(_) => break,
                }
                continue;
            }
            let config = match RadioConfig::from_settings(&state) {
                Ok(config) => config,
                Err(cause) => {
                    set_state(&state, receiver_id, ReceiverState::Faulted);
                    error!(error = %cause, "invalid persisted radio settings");
                    sleep(Duration::from_secs(5)).await;
                    continue;
                }
            };
            // The worker always rebuilds config from persisted settings at the
            // top of the loop, so everything read here is by definition the
            // applied generation.
            state.mark_config_applied();
            state
                .force_apply
                .store(false, std::sync::atomic::Ordering::SeqCst);
            set_state(&state, receiver_id, ReceiverState::Offline);
            let run = run_once(&state, receiver_id, &config);
            tokio::pin!(run);
            let interrupted = tokio::select! {
                result = &mut run => {
                    match result {
                        Ok(()) => { failures = 0; warn!("radiod exited; scheduling restart"); }
                        Err(cause) => { failures = failures.saturating_add(1); error!(error = %cause, failures, "radiod failed; scheduling restart"); }
                    }
                    false
                }
                command = commands.recv() => {
                    match command {
                        Ok(ReceiverCommand::Stop(id)) if id == receiver_id => { paused = true; set_state(&state, receiver_id, ReceiverState::Stopped); }
                        Ok(ReceiverCommand::Start(id) | ReceiverCommand::Restart(id) | ReceiverCommand::Probe(id)) if id == receiver_id => { set_state(&state, receiver_id, ReceiverState::Probing); }
                        Ok(_) | Err(_) => {}
                    }
                    true
                }
                // Persisted settings changed (or an apply was forced): drop the
                // child so the loop rebuilds config and relaunches immediately
                // instead of running stale RF settings until the next crash.
                _ = async {
                    loop {
                        sleep(Duration::from_millis(1000)).await;
                        if state.pending_apply()
                            || state.force_apply.load(std::sync::atomic::Ordering::SeqCst)
                        {
                            break;
                        }
                    }
                } => {
                    set_state(&state, receiver_id, ReceiverState::Probing);
                    true
                }
            };
            if interrupted {
                restart_delay = Duration::from_secs(1);
                continue;
            }
            let faulted = failures >= 3;
            set_state(
                &state,
                receiver_id,
                if faulted {
                    ReceiverState::Faulted
                } else {
                    ReceiverState::Degraded
                },
            );
            // Do not hide a persistent device/plugin failure behind an
            // infinite restart loop. An explicit probe/start/restart command
            // clears the pause and makes recovery observable to the operator.
            if faulted {
                warn!(receiver_id = %receiver_id, "radiod paused after repeated failures; operator action required");
                paused = true;
                continue;
            }
            sleep(restart_delay).await;
            restart_delay = (restart_delay * 2).min(Duration::from_secs(30));
        }
    });
    Ok(())
}

fn initial_receiver(id: Uuid, config: &RadioConfig) -> Receiver {
    let driver = receiver_presets::infer_driver_from_device(&config.device);
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
        enabled: true,
        role: ReceiverRole::General,
        soapy_index: Some(0),
        auto_tune: None,
        digital_recorders: None,
        analog_recorders: None,
        capabilities: receiver_presets::default_capabilities(driver),
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
        .arg("--audio-output")
        .arg(&config.audio_output)
        .arg("--squelch-dbfs")
        .arg(config.squelch_dbfs.to_string())
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
        RadioEvent::Retuned { frequency_hz } => {
            receiver.center_frequency_hz = Some(frequency_hz.round() as u64);
            receiver.state = ReceiverState::Monitoring;
        }
        RadioEvent::SelfTestResult {
            healthy,
            simulated,
            samples,
        } => info!(%healthy, %simulated, %samples, "radio self-test finished"),
        RadioEvent::AudioSegment {
            path,
            duration_ms,
            tone_hz,
            tone_code,
        } => {
            let settings = state
                .settings
                .read()
                .expect("settings lock poisoned")
                .clone();
            let tuned_frequency_hz = receiver
                .center_frequency_hz
                .unwrap_or(settings.radio_frequency_hz);
            // The channel plan is the source of truth: audio captured on a
            // frequency no analog profile claims is noise or a mis-tuned
            // receiver, and archiving it just spams the feed with static.
            let matches_plan = state
                .systems
                .read()
                .expect("system lock poisoned")
                .iter()
                .filter(|profile| profile.protocol == "analog-fm")
                .any(|profile| {
                    profile
                        .frequency_hz
                        .map(|frequency| frequency.abs_diff(tuned_frequency_hz) <= 25_000)
                        .unwrap_or(false)
                });
            if !matches_plan {
                debug!(
                    frequency_hz = tuned_frequency_hz,
                    "audio dropped: tuned frequency matches no analog profile"
                );
                return;
            }
            let tone_allowed = state
                .systems
                .read()
                .expect("system lock poisoned")
                .iter()
                .filter(|profile| profile.protocol == "analog-fm")
                // Retunes can move between multiple FM channels. Apply the
                // tone gate for the channel that is actually tuned instead
                // of accidentally using the first profile in the database.
                .min_by_key(|profile| {
                    profile
                        .frequency_hz
                        .map(|frequency| frequency.abs_diff(tuned_frequency_hz))
                        .unwrap_or(u64::MAX)
                })
                .filter(|profile| {
                    profile
                        .frequency_hz
                        .map(|frequency| frequency.abs_diff(tuned_frequency_hz) <= 25_000)
                        .unwrap_or(false)
                })
                .and_then(|profile| profile.tone.as_deref())
                .map(|expected| {
                    expected == "none"
                        || if expected.starts_with('D') {
                            tone_code
                                .as_deref()
                                .is_some_and(|actual| expected.eq_ignore_ascii_case(actual))
                        } else {
                            tone_hz
                                .map(|actual| {
                                    (actual - expected.parse::<f64>().unwrap_or(-1.0)).abs() < 0.8
                                })
                                .unwrap_or(false)
                        }
                })
                .unwrap_or(true);
            if !tone_allowed {
                return;
            }
            let call = Call {
                id: Uuid::new_v4(),
                system_id: Uuid::nil(),
                system_name: "Analog FM".into(),
                site_id: Uuid::nil(),
                talkgroup_id: 0,
                talkgroup_label: format!("FM {}", tuned_frequency_hz),
                category: "analog-fm".into(),
                frequency_hz: tuned_frequency_hz,
                tdma_slot: None,
                source_radio_id: None,
                started_at: Utc::now() - chrono::Duration::milliseconds(duration_ms as i64),
                ended_at: Some(Utc::now()),
                state: CallState::Complete,
                encryption: EncryptionState::Clear,
                signal_dbfs: receiver.health.signal_dbfs,
                transcript: None,
                summary: None,
                location: None,
                audio: Some(AudioAsset {
                    object_key: path,
                    content_type: "audio/wav".into(),
                    duration_ms,
                }),
            };
            state.upsert_call(call.clone(), CallEvent::Ended(call.clone()));
            state.enqueue_processing(call);
        }
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
            audio_output: "/var/lib/trunkscope/calls".into(),
            squelch_dbfs: -60.0,
        };
        assert_eq!(
            initial_receiver(Uuid::new_v4(), &config).driver,
            ReceiverDriver::Sdrplay
        );
    }

    #[test]
    fn audio_outside_the_channel_plan_is_dropped() {
        let state = AppState::new();
        let receiver_id = Uuid::new_v4();
        state.receivers.write().unwrap().push(initial_receiver(
            receiver_id,
            &RadioConfig {
                executable: "radiod".into(),
                device: "driver=sdrplay".into(),
                frequency_hz: 154_000_000,
                sample_rate_hz: 2_400_000,
                bandwidth_hz: None,
                gain_db: Some(40.0),
                agc: false,
                ppm: 0.0,
                audio_output: "/var/lib/trunkscope/calls".into(),
                squelch_dbfs: -60.0,
            },
        ));
        // Plan only knows about 154.445; capture tuned to 154.000 must drop.
        state
            .systems
            .write()
            .unwrap()
            .push(crate::state::SystemProfile {
                id: Uuid::new_v4(),
                name: "Jackson FM".into(),
                protocol: "analog-fm".into(),
                control_channel_hz: None,
                control_channels_hz: Vec::new(),
                nac: None,
                frequency_hz: Some(154_445_000),
                bandwidth_hz: Some(12_500),
                modulation: Some("NFM".into()),
                squelch_db: Some(-60.0),
                tone: Some("123.0".into()),
                deviation_hz: None,
                step_hz: None,
                dwell_ms: None,
                sites: Vec::new(),
                receiver_id: None,
                decode_mdc: None,
            });
        apply_event(
            &state,
            receiver_id,
            RadioEvent::AudioSegment {
                path: "/var/lib/trunkscope/calls/fm-1.wav".into(),
                duration_ms: 1200,
                tone_hz: None,
                tone_code: None,
            },
        );
        assert!(state.calls.read().unwrap().is_empty());
    }

    #[test]
    fn persisted_settings_drive_radio_config() {
        let state = AppState::new();
        {
            let mut settings = state.settings.write().unwrap();
            settings.radio_device = "driver=remote,remote=tcp://receiver:55132".into();
            settings.radio_frequency_hz = 155_550_000;
            settings.radio_sample_rate_hz = 2_000_000;
            settings.radio_agc = true;
        }
        let config = RadioConfig::from_settings(&state).unwrap();
        assert_eq!(config.frequency_hz, 155_550_000);
        assert_eq!(config.sample_rate_hz, 2_000_000);
        assert!(config.agc);
    }
}
