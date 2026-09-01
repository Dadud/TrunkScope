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
    while let Some(message) = socket.next().await {
        match message {
            Ok(Message::Text(payload)) => match serde_json::from_str::<StatusEvent>(&payload) {
                Ok(event) => apply_status(&state, event),
                Err(cause) => warn!(%cause, "ignored invalid decoder status message"),
            },
            Ok(Message::Close(_)) => break,
            Ok(Message::Ping(_)) | Ok(Message::Pong(_)) | Ok(Message::Binary(_)) => {}
            Err(cause) => {
                warn!(%cause, "decoder status socket failed");
                break;
            }
        }
    }
    warn!("Trunk Recorder status connection closed");
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
    #[default]
    Missing,
}

impl FlexibleBool {
    fn value(&self) -> bool {
        match self {
            Self::Bool(value) => *value,
            Self::String(value) => value.eq_ignore_ascii_case("true") || value == "1",
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
            state.upsert_call(call.clone(), CallEvent::Ended(call.clone()));
            state.enqueue_processing(call);
        }
        Some(call) => state.upsert_call(call.clone(), CallEvent::Started(call)),
        None => {
            warn!(decoder_call_id = %decoder_call.id.value(), "decoder call was missing required identifiers")
        }
    }
}

fn convert_call(state: &AppState, source: &DecoderCall, ended: bool) -> Option<Call> {
    let source_id = source.id.value();
    let talkgroup = source.talkgroup.value();
    let frequency = source.freq.value();
    let talkgroup_id = parse_u32(&talkgroup)?;
    let frequency_hz = frequency.parse::<f64>().ok()?.round() as u64;
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
        signal_dbfs: 0.0,
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
}
