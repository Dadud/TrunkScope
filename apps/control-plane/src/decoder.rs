use std::sync::Arc;

use axum::{
    extract::{
        State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    response::IntoResponse,
};
use chrono::{DateTime, Utc};
use futures_util::StreamExt;
use serde::Deserialize;
use tracing::{debug, info, warn};
use trunkscope_domain::{AudioAsset, Call, CallEvent, CallState, EncryptionState};
use uuid::Uuid;

use crate::state::AppState;

pub async fn status_socket(
    upgrade: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    upgrade.on_upgrade(move |socket| consume_status(socket, state))
}

async fn consume_status(mut socket: WebSocket, state: Arc<AppState>) {
    info!("Trunk Recorder status connection established");
    *state
        .decoder_connected
        .write()
        .expect("decoder lock poisoned") = true;
    while let Some(message) = socket.next().await {
        *state
            .decoder_last_event
            .write()
            .expect("decoder lock poisoned") = Some(Utc::now());
        match message {
            Ok(Message::Text(payload)) => {
                record_control_lock(&state, &payload);
                match serde_json::from_str::<StatusEvent>(&payload) {
                    Ok(event) => apply_status(&state, event),
                    Err(cause) => warn!(%cause, "ignored invalid decoder status message"),
                }
            }
            Ok(Message::Close(_)) => break,
            Ok(Message::Ping(_)) | Ok(Message::Pong(_)) | Ok(Message::Binary(_)) => {}
            Err(cause) => {
                warn!(%cause, "decoder status socket failed");
                break;
            }
        }
    }
    *state
        .decoder_connected
        .write()
        .expect("decoder lock poisoned") = false;
    warn!("Trunk Recorder status connection closed");
}

fn record_control_lock(state: &AppState, payload: &str) {
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(payload) {
        let lock_event = value
            .get("type")
            .and_then(|field| field.as_str())
            .is_some_and(|field| {
                field.contains("control")
                    || field.eq_ignore_ascii_case("controlchannel")
                    || field.eq_ignore_ascii_case("control_channel")
            })
            || value
                .get("controlChannel")
                .or_else(|| value.get("control_channel"))
                .is_some()
            || value
                .get("status")
                .and_then(|field| field.as_str())
                .is_some_and(|field| field.contains("control"));
        if lock_event {
            *state
                .decoder_control_lock
                .write()
                .expect("decoder lock poisoned") = Some(Utc::now());
            return;
        }
    }
    let value = payload.to_ascii_lowercase();
    let lock_event = (value.contains("control")
        && (value.contains("lock") || value.contains("channel")))
        || value.contains("controlchannel");
    if lock_event {
        *state
            .decoder_control_lock
            .write()
            .expect("decoder lock poisoned") = Some(Utc::now());
    }
}

/// Ingest a finalized Trunk Recorder JSON sidecar. This is also used as a
/// durable fallback when the optional websocket status connection is briefly
/// unavailable; the sidecar is only accepted after Trunk Recorder has closed
/// and written the call file.
pub fn ingest_status_payload(state: &AppState, payload: &str) -> bool {
    match serde_json::from_str::<StatusEvent>(payload) {
        Ok(event) => {
            *state
                .decoder_last_event
                .write()
                .expect("decoder lock poisoned") = Some(Utc::now());
            apply_status(state, event);
            true
        }
        Err(cause) => {
            warn!(%cause, "ignored invalid decoder sidecar");
            false
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum StatusEvent {
    #[serde(rename = "call_start")]
    CallStart { call: DecoderCall },
    #[serde(rename = "call_end")]
    CallEnd { call: DecoderCall },
    #[serde(other)]
    Other,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DecoderCall {
    id: FlexibleText,
    #[serde(default)]
    freq: FlexibleText,
    #[serde(default)]
    short_name: FlexibleText,
    #[serde(default)]
    talkgroup: FlexibleText,
    #[serde(default)]
    talkgrouptag: FlexibleText,
    #[serde(default)]
    phase2: FlexibleBool,
    #[serde(default)]
    encrypted: FlexibleBool,
    #[serde(default)]
    analog: FlexibleBool,
    #[serde(default)]
    tone: FlexibleText,
    #[serde(default)]
    signal: FlexibleText,
    #[serde(default)]
    noise: FlexibleText,
    #[serde(default)]
    start_time: FlexibleText,
    #[serde(default)]
    stop_time: FlexibleText,
    #[serde(default)]
    src_num: FlexibleText,
    #[serde(default)]
    filename: FlexibleText,
}

#[derive(Debug, Default, Deserialize)]
#[serde(untagged)]
enum FlexibleText {
    String(String),
    Number(serde_json::Number),
    #[default]
    Missing,
}

impl FlexibleText {
    fn value(&self) -> String {
        match self {
            Self::String(value) => value.clone(),
            Self::Number(value) => value.to_string(),
            Self::Missing => String::new(),
        }
    }
}

#[derive(Debug, Default, Deserialize)]
#[serde(untagged)]
enum FlexibleBool {
    Bool(bool),
    String(String),
    Number(serde_json::Number),
    #[default]
    Missing,
}

impl FlexibleBool {
    fn value(&self) -> bool {
        match self {
            Self::Bool(value) => *value,
            Self::String(value) => value.eq_ignore_ascii_case("true") || value == "1",
            Self::Number(value) => value.as_i64().is_some_and(|number| number != 0),
            Self::Missing => false,
        }
    }
}

fn apply_status(state: &AppState, event: StatusEvent) {
    let (decoder_call, ended) = match event {
        StatusEvent::CallStart { call } => (call, false),
        StatusEvent::CallEnd { call } => (call, true),
        StatusEvent::Other => {
            debug!("received non-call decoder status");
            return;
        }
    };
    match convert_call(state, &decoder_call, ended) {
        Some(call) if ended => {
            update_receiver_health(state, &call, &decoder_call);
            state.upsert_call(call.clone(), CallEvent::Ended(call.clone()));
            state.enqueue_processing(call);
        }
        Some(call) => {
            update_receiver_health(state, &call, &decoder_call);
            state.upsert_call(call.clone(), CallEvent::Started(call));
        }
        None => {
            warn!(decoder_call_id = %decoder_call.id.value(), "decoder call was missing required identifiers")
        }
    }
}

fn update_receiver_health(state: &AppState, call: &Call, source: &DecoderCall) {
    // Conventional sidecars contain measured signal/noise values. Digital
    // sidecars use 999 as a sentinel, so do not overwrite useful hardware
    // telemetry with that value.
    // Trunk Recorder uses 0/999 sentinel values for digital call signal;
    // retain those from overwriting a real negative analog measurement.
    if call.signal_dbfs > -200.0 && call.signal_dbfs < 0.0 {
        if let Ok(mut receivers) = state.receivers.write() {
            if let Some(receiver) = receivers.first_mut() {
                receiver.health.signal_dbfs = call.signal_dbfs;
                if let Ok(noise) = source.noise.value().parse::<f32>() {
                    if noise.is_finite() && noise < 0.0 {
                        receiver.health.noise_dbfs = noise;
                    }
                }
                receiver.health.updated_at = Utc::now();
            }
        }
    }
}

fn convert_call(state: &AppState, source: &DecoderCall, ended: bool) -> Option<Call> {
    let source_id = source.id.value();
    let talkgroup = source.talkgroup.value();
    let frequency = source.freq.value();
    let talkgroup_id = parse_u32(&talkgroup)?;
    let frequency_hz = frequency.parse::<f64>().ok()?.round() as u64;
    let reported_tone = source.tone.value();
    let tone_allowed = state
        .systems
        .read()
        .ok()
        .and_then(|systems| {
            systems
                .iter()
                .find(|profile| profile.frequency_hz == Some(frequency_hz))
                .and_then(|profile| profile.tone.clone())
        })
        .map(|expected| (expected, reported_tone.clone()))
        .is_none_or(|(expected, actual)| {
            expected.eq_ignore_ascii_case("none")
                || (!actual.is_empty() && expected.eq_ignore_ascii_case(&actual))
                // Trunk Recorder applies the CTCSS/DCS gate before emitting a
                // conventional sidecar. Its sidecars do not repeat the tone,
                // so an explicitly marked analog event with no tone field is
                // already a trusted match.
                || (source.analog.value() && actual.is_empty())
        });
    if !tone_allowed {
        return None;
    }
    let call_id = {
        let mut calls = state
            .decoder_calls
            .write()
            .expect("decoder call lock poisoned");
        *calls.entry(source_id).or_insert_with(Uuid::new_v4)
    };
    let short_name = source.short_name.value();
    let system_name = if short_name.is_empty() {
        "P25 system".to_string()
    } else {
        short_name
    };
    let system_id = {
        let mut systems = state
            .decoder_systems
            .write()
            .expect("decoder system lock poisoned");
        *systems
            .entry(system_name.clone())
            .or_insert_with(Uuid::new_v4)
    };
    let started_at = parse_epoch(&source.start_time.value()).unwrap_or_else(Utc::now);
    let ended_at = ended.then(|| parse_epoch(&source.stop_time.value()).unwrap_or_else(Utc::now));
    let encrypted = source.encrypted.value();
    let talkgrouptag = source.talkgrouptag.value();
    let talkgroup_label = if talkgrouptag.is_empty() {
        format!("Talkgroup {talkgroup_id}")
    } else {
        talkgrouptag
    };

    let filename = source.filename.value();
    let audio_path = if filename.is_empty() {
        None
    } else if std::path::Path::new(&filename).is_absolute() {
        Some(filename)
    } else {
        Some(format!("/var/lib/trunkscope/calls/{filename}"))
    };

    Some(Call {
        id: call_id,
        system_id,
        system_name,
        site_id: Uuid::nil(),
        talkgroup_id,
        talkgroup_label,
        category: if source.analog.value() {
            "Analog NFM".into()
        } else if source.phase2.value() {
            "P25 Phase 2".into()
        } else {
            "P25 Phase 1".into()
        },
        frequency_hz,
        tdma_slot: source.phase2.value().then_some(0),
        source_radio_id: parse_u32(&source.src_num.value()),
        started_at,
        ended_at,
        state: if ended {
            CallState::Complete
        } else {
            CallState::Active
        },
        encryption: if encrypted {
            EncryptionState::Encrypted
        } else {
            EncryptionState::Clear
        },
        signal_dbfs: source
            .signal
            .value()
            .parse::<f32>()
            .ok()
            .filter(|signal| signal.is_finite() && *signal <= 0.0)
            .unwrap_or(0.0),
        transcript: None,
        summary: None,
        location: None,
        audio: (ended && !encrypted)
            .then_some(audio_path)
            .flatten()
            .map(|object_key| AudioAsset {
                object_key,
                content_type: "audio/wav".into(),
                duration_ms: ended_at
                    .map(|end| (end - started_at).num_milliseconds().max(0) as u64)
                    .unwrap_or(0),
            }),
    })
}

fn parse_u32(value: &str) -> Option<u32> {
    value.parse().ok().filter(|number| *number > 0)
}

fn parse_epoch(value: &str) -> Option<DateTime<Utc>> {
    let seconds = value.parse().ok()?;
    DateTime::from_timestamp(seconds, 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decoder_start_becomes_domain_call() {
        let state = AppState::new();
        let event: StatusEvent = serde_json::from_str(
            r#"{"type":"call_start","call":{"id":"0_1001_1515575009","freq":"851012500","shortName":"Metro","talkgroup":"1001","talkgrouptag":"Fire Dispatch","phase2":"true","encrypted":"false","startTime":"1515575009","srcNum":"70001"}}"#,
        ).unwrap();
        apply_status(&state, event);
        let calls = state.calls.read().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].talkgroup_id, 1001);
        assert_eq!(calls[0].category, "P25 Phase 2");
        assert_eq!(calls[0].state, CallState::Active);
    }

    #[test]
    fn encrypted_call_never_gets_audio() {
        let state = AppState::new();
        let event: StatusEvent = serde_json::from_str(
            r#"{"type":"call_end","call":{"id":"call-2","freq":"851012500","shortName":"Metro","talkgroup":"1001","encrypted":"true","startTime":"1515575009","stopTime":"1515575018","filename":"secret.wav"}}"#,
        ).unwrap();
        apply_status(&state, event);
        let calls = state.calls.read().unwrap();
        assert_eq!(calls[0].encryption, EncryptionState::Encrypted);
        assert!(calls[0].audio.is_none());
    }

    #[test]
    fn accepts_numeric_trunk_recorder_fields() {
        let state = AppState::new();
        let event: StatusEvent = serde_json::from_str(
            r#"{"type":"call_start","call":{"id":42,"freq":851012500,"shortName":"Metro","talkgroup":1001,"phase2":false,"startTime":1515575009}}"#,
        )
        .unwrap();
        apply_status(&state, event);
        let calls = state.calls.read().unwrap();
        assert_eq!(calls[0].frequency_hz, 851012500);
        assert_eq!(calls[0].talkgroup_id, 1001);
    }

    #[test]
    fn resolves_relative_audio_filename_into_decoder_volume() {
        let state = AppState::new();
        let event: StatusEvent = serde_json::from_str(
            r#"{"type":"call_end","call":{"id":"call-3","freq":"851012500","talkgroup":"1001","startTime":"1515575009","stopTime":"1515575018","filename":"2026-09-01/call-3.wav"}}"#,
        )
        .unwrap();
        apply_status(&state, event);
        let calls = state.calls.read().unwrap();
        assert_eq!(
            calls[0].audio.as_ref().unwrap().object_key,
            "/var/lib/trunkscope/calls/2026-09-01/call-3.wav"
        );
    }

    #[test]
    fn configured_analog_tone_rejects_mismatched_decoder_call() {
        let state = AppState::new();
        state
            .systems
            .write()
            .unwrap()
            .push(crate::state::SystemProfile {
                id: Uuid::new_v4(),
                name: "FM".into(),
                protocol: "analog-fm".into(),
                control_channel_hz: None,
                control_channels_hz: Vec::new(),
                nac: None,
                frequency_hz: Some(166550000),
                bandwidth_hz: Some(12500),
                modulation: Some("NFM".into()),
                squelch_db: Some(-65.0),
                tone: Some("100.0".into()),
                deviation_hz: Some(2500),
                step_hz: Some(12500),
                dwell_ms: Some(2500),
                sites: Vec::new(),
                receiver_id: None,
            });
        let event: StatusEvent = serde_json::from_str(r#"{"type":"call_start","call":{"id":"tone-1","freq":"166550000","talkgroup":"1","analog":true,"tone":"123.0"}}"#).unwrap();
        apply_status(&state, event);
        assert!(state.calls.read().unwrap().is_empty());
    }

    #[test]
    fn configured_dcs_tone_accepts_matching_decoder_call() {
        let state = AppState::new();
        state
            .systems
            .write()
            .unwrap()
            .push(crate::state::SystemProfile {
                id: Uuid::new_v4(),
                name: "DCS FM".into(),
                protocol: "analog-fm".into(),
                control_channel_hz: None,
                control_channels_hz: Vec::new(),
                nac: None,
                frequency_hz: Some(166550000),
                bandwidth_hz: Some(12500),
                modulation: Some("NFM".into()),
                squelch_db: Some(-65.0),
                tone: Some("D023N".into()),
                deviation_hz: Some(2500),
                step_hz: Some(12500),
                dwell_ms: Some(2500),
                sites: Vec::new(),
                receiver_id: None,
            });
        let event: StatusEvent = serde_json::from_str(
            r#"{"type":"call_start","call":{"id":"dcs-1","freq":"166550000","talkgroup":"1","analog":true,"tone":"D023N"}}"#,
        )
        .unwrap();
        apply_status(&state, event);
        assert_eq!(state.calls.read().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn p25_call_lifecycle_archives_and_enqueues_processing() {
        let state = AppState::new();
        let mut processing = state.processing.subscribe();
        let start: StatusEvent = serde_json::from_str(
            r#"{"type":"call_start","call":{"id":"p25-e2e","freq":"851012500","talkgroup":"1001","shortName":"Dispatch","startTime":"1710000000"}}"#,
        )
        .unwrap();
        apply_status(&state, start);
        let end: StatusEvent = serde_json::from_str(
            r#"{"type":"call_end","call":{"id":"p25-e2e","freq":"851012500","talkgroup":"1001","shortName":"Dispatch","startTime":"1710000000","stopTime":"1710000004","filename":"2026-09-01/p25-e2e.wav"}}"#,
        )
        .unwrap();
        apply_status(&state, end);
        let queued = tokio::time::timeout(std::time::Duration::from_secs(1), processing.recv())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            queued.id.to_string(),
            state.calls.read().unwrap()[0].id.to_string()
        );
        assert_eq!(queued.category, "P25 Phase 1");
        assert_eq!(queued.state, CallState::Complete);
    }
}
