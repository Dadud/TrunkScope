use std::{
    env,
    path::{Path, PathBuf},
    sync::Arc,
    sync::atomic::Ordering,
    time::Duration,
};

use reqwest::{Client, multipart};
use serde::{Deserialize, Serialize};
use tokio::time::sleep;
use tracing::warn;
use trunkscope_domain::{Call, EncryptionState};

use crate::state::AppState;

#[derive(Clone)]
struct ProcessingConfig {
    transcription_url: String,
    transcription_model: String,
    summary_url: Option<String>,
    summary_model: String,
    calls_root: PathBuf,
}

impl ProcessingConfig {
    fn from_state(state: &AppState) -> Option<Self> {
        let settings = state
            .settings
            .read()
            .expect("settings lock poisoned")
            .clone();
        if !settings.ai_enabled {
            return None;
        }
        Some(Self {
            transcription_url: settings.transcribe_url,
            transcription_model: settings.transcribe_model,
            summary_url: env::var("TRUNKSCOPE_SUMMARY_URL").ok(),
            summary_model: settings.summary_model,
            calls_root: env::var("TRUNKSCOPE_CALLS_PATH")
                .map(PathBuf::from)
                .unwrap_or_else(|_| PathBuf::from("/var/lib/trunkscope/calls")),
        })
    }
}

pub fn spawn(state: Arc<AppState>) {
    let ai_enabled = state
        .settings
        .read()
        .expect("settings lock poisoned")
        .ai_enabled;
    *state
        .ai_worker_status
        .write()
        .expect("AI status lock poisoned") = if ai_enabled { "idle" } else { "disabled" }.into();
    let receiver = state
        .processing_receiver
        .lock()
        .expect("processing queue lock poisoned")
        .take()
        .expect("AI processor already started");
    let receiver = Arc::new(tokio::sync::Mutex::new(receiver));
    let workers = env::var("TRUNKSCOPE_AI_WORKERS")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(4)
        .clamp(1, 4);
    for _ in 0..workers {
        let state = Arc::clone(&state);
        let receiver = Arc::clone(&receiver);
        tokio::spawn(async move {
            let client = Client::builder()
                .timeout(Duration::from_secs(180))
                .build()
                .expect("valid processing HTTP client");
            loop {
                let call = receiver.lock().await.recv().await;
                match call {
                    Some(call) => {
                        state.processing_queue_depth.fetch_sub(1, Ordering::Relaxed);
                        let Some(config) = ProcessingConfig::from_state(&state) else {
                            *state
                                .ai_worker_status
                                .write()
                                .expect("AI status lock poisoned") = "disabled".into();
                            continue;
                        };
                        *state
                            .ai_worker_status
                            .write()
                            .expect("AI status lock poisoned") = "processing".into();
                        *state.ai_last_error.write().expect("AI error lock poisoned") = None;
                        process_with_retry(&client, &state, &config, call).await;
                        *state
                            .ai_worker_status
                            .write()
                            .expect("AI status lock poisoned") = if state
                            .ai_last_error
                            .read()
                            .expect("AI error lock poisoned")
                            .is_some()
                        {
                            "error".into()
                        } else {
                            "idle".into()
                        }
                    }
                    None => break,
                }
            }
        });
    }
}

async fn process_with_retry(
    client: &Client,
    state: &AppState,
    config: &ProcessingConfig,
    call: Call,
) {
    if call.encryption != EncryptionState::Clear {
        return;
    }
    let Some(asset) = &call.audio else { return };
    // Very short fragments are commonly squelch tails or control-channel
    // bleed. Keep the recording for auditability, but avoid publishing
    // hallucinated transcripts/summaries for audio that cannot contain a
    // meaningful utterance.
    if asset.duration_ms < 1_500 {
        return;
    }
    let path = PathBuf::from(&asset.object_key);
    if !safe_audio_path(&path, &config.calls_root) {
        warn!(path = %path.display(), "rejected decoder audio path outside call storage");
        return;
    }

    // Give adjacent dispatch/reply segments time to arrive before AI work is
    // scheduled, but do not add another ten seconds when this call waited in
    // the queue. The original audio remains independently archived.
    let ready_at = call.ended_at.unwrap_or(call.started_at) + chrono::Duration::seconds(10);
    if let Ok(wait) = (ready_at - chrono::Utc::now()).to_std() {
        sleep(wait).await;
    }

    let mut delay = Duration::from_secs(1);
    for attempt in 1..=5 {
        match transcribe(client, config, &path).await {
            Ok(transcript) => {
                let location_hint = extract_location_hint(&transcript);
                let summary = if transcript.trim().chars().count() >= 8 {
                    summarize(client, config, &transcript).await.ok()
                } else {
                    None
                };
                let discord_summary = summary.clone();
                state.enrich_call(call.id, transcript, summary);
                if let Some(hint) = location_hint {
                    if let Some(location) = geocode_hint(client, &hint).await {
                        state.set_call_location(call.id, location);
                    }
                }
                if let Some(summary_text) = discord_summary.as_deref() {
                    notify_discord(client, &call, summary_text).await;
                }
                return;
            }
            Err(cause) if attempt < 5 => {
                warn!(%attempt, error = %cause, "call processing failed; retrying");
                sleep(delay).await;
                delay *= 2;
            }
            Err(cause) => {
                *state.ai_last_error.write().expect("AI error lock poisoned") =
                    Some(cause.to_string());
                warn!(%attempt, error = %cause, "call processing exhausted retries");
            }
        }
    }
}

fn extract_location_hint(transcript: &str) -> Option<String> {
    let lower = transcript.to_ascii_lowercase();
    [" at ", " near ", " on ", " intersection of ", " by "]
        .iter()
        .find_map(|marker| {
            let start = lower.find(marker)? + marker.len();
            let value = transcript[start..].split(['.', ',', ';']).next()?.trim();
            (value.len() >= 3 && value.len() <= 80).then(|| value.to_string())
        })
}

async fn geocode_hint(client: &Client, hint: &str) -> Option<trunkscope_domain::IncidentLocation> {
    let endpoint = env::var("TRUNKSCOPE_GEOCODER_URL").ok()?;
    if endpoint.trim().is_empty() {
        return None;
    }
    let response = client
        .get(endpoint)
        .query(&[("q", hint), ("format", "jsonv2"), ("limit", "1")])
        .header("user-agent", "TrunkScope/1.0")
        .send()
        .await
        .ok()?
        .json::<Vec<serde_json::Value>>()
        .await
        .ok()?;
    let first = response.first()?;
    let latitude = first.get("lat")?.as_str()?.parse().ok()?;
    let longitude = first.get("lon")?.as_str()?.parse().ok()?;
    let label = first
        .get("display_name")
        .and_then(|value| value.as_str())
        .unwrap_or(hint)
        .to_string();
    Some(trunkscope_domain::IncidentLocation {
        label,
        latitude,
        longitude,
        confidence: 0.7,
    })
}

async fn notify_discord(client: &Client, call: &Call, summary: &str) {
    let Ok(webhook) = env::var("TRUNKSCOPE_DISCORD_WEBHOOK_URL") else {
        return;
    };
    if webhook.trim().is_empty() || call.encryption != EncryptionState::Clear {
        return;
    }
    let payload = serde_json::json!({
        "username": "TrunkScope",
        "content": format!("**{}** · {}\n{}", call.talkgroup_label, call.category, summary),
        "allowed_mentions": { "parse": [] }
    });
    if let Err(error) = client.post(webhook).json(&payload).send().await {
        warn!(error = %error, call_id = %call.id, "discord notification failed");
    }
}

fn safe_audio_path(path: &Path, root: &Path) -> bool {
    path.is_absolute()
        && path.starts_with(root)
        && !path
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
}

#[derive(Deserialize)]
struct TranscriptionResponse {
    text: String,
}

async fn transcribe(
    client: &Client,
    config: &ProcessingConfig,
    path: &Path,
) -> anyhow::Result<String> {
    let audio = tokio::fs::read(path).await?;
    let filename = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("call.wav");
    let file = multipart::Part::bytes(audio)
        .file_name(filename.to_owned())
        .mime_str("audio/wav")?;
    let response = client
        .post(&config.transcription_url)
        .multipart(
            multipart::Form::new()
                .part("file", file)
                .text("model", config.transcription_model.clone())
                .text("response_format", "json"),
        )
        .send()
        .await?
        .error_for_status()?
        .json::<TranscriptionResponse>()
        .await?;
    Ok(response.text.trim().to_owned())
}

#[derive(Serialize)]
struct SummaryRequest<'a> {
    model: &'a str,
    prompt: String,
    stream: bool,
}

#[derive(Deserialize)]
struct SummaryResponse {
    response: String,
}

async fn summarize(
    client: &Client,
    config: &ProcessingConfig,
    transcript: &str,
) -> anyhow::Result<String> {
    let Some(url) = &config.summary_url else {
        anyhow::bail!("summary provider is disabled");
    };
    let prompt = format!(
        "Summarize this radio transmission in one factual sentence. Do not invent details. Transcript: {transcript}"
    );
    let response = client
        .post(url)
        .json(&SummaryRequest {
            model: &config.summary_model,
            prompt,
            stream: false,
        })
        .send()
        .await?
        .error_for_status()?
        .json::<SummaryResponse>()
        .await?;
    Ok(response.response.trim().to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{Json, Router, routing::post};
    use chrono::Utc;
    use serde_json::json;
    use trunkscope_domain::{AudioAsset, CallEvent, CallState};

    #[test]
    fn audio_must_remain_in_decoder_volume() {
        #[cfg(windows)]
        let (root, valid, outside, traversal) = (
            Path::new(r"C:\trunkscope\calls"),
            Path::new(r"C:\trunkscope\calls\metro\call.wav"),
            Path::new(r"C:\Windows\system.ini"),
            Path::new(r"C:\trunkscope\calls\..\secrets"),
        );
        #[cfg(not(windows))]
        let (root, valid, outside, traversal) = (
            Path::new("/var/lib/trunkscope/calls"),
            Path::new("/var/lib/trunkscope/calls/metro/call.wav"),
            Path::new("/etc/passwd"),
            Path::new("/var/lib/trunkscope/calls/../secrets"),
        );
        assert!(safe_audio_path(valid, root));
        assert!(!safe_audio_path(outside, root));
        assert!(!safe_audio_path(traversal, root));
    }

    #[test]
    fn processing_config_follows_persisted_ai_toggle() {
        let state = AppState::new();
        assert!(ProcessingConfig::from_state(&state).is_none());
        state.settings.write().unwrap().ai_enabled = true;
        assert!(ProcessingConfig::from_state(&state).is_some());
    }

    #[tokio::test]
    async fn provider_pipeline_enriches_archived_call() {
        let app = Router::new()
            .route(
                "/transcribe",
                post(|| async { Json(json!({"text":"Unit 12 responding"})) }),
            )
            .route(
                "/summary",
                post(|| async { Json(json!({"response":"Unit 12 is responding."})) }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let root = std::env::temp_dir().join(format!("trunkscope-ai-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir_all(&root).await.unwrap();
        let audio_path = root.join("call.wav");
        tokio::fs::write(&audio_path, b"RIFFtestwav").await.unwrap();
        let id = uuid::Uuid::new_v4();
        let call = Call {
            id,
            system_id: uuid::Uuid::new_v4(),
            system_name: "Mock system".into(),
            site_id: uuid::Uuid::new_v4(),
            talkgroup_id: 12,
            talkgroup_label: "Dispatch".into(),
            category: "public-safety".into(),
            frequency_hz: 851_012_500,
            tdma_slot: None,
            source_radio_id: None,
            started_at: Utc::now(),
            ended_at: Some(Utc::now()),
            state: CallState::Complete,
            encryption: EncryptionState::Clear,
            signal_dbfs: -40.0,
            transcript: None,
            summary: None,
            location: None,
            audio: Some(AudioAsset {
                object_key: audio_path.to_string_lossy().into_owned(),
                content_type: "audio/wav".into(),
                duration_ms: 2_000,
            }),
        };
        let state = AppState::new();
        state.upsert_call(call.clone(), CallEvent::Ended(call.clone()));
        let config = ProcessingConfig {
            transcription_url: format!("http://{address}/transcribe"),
            transcription_model: "test".into(),
            summary_url: Some(format!("http://{address}/summary")),
            summary_model: "test".into(),
            calls_root: root.clone(),
        };
        process_with_retry(&Client::new(), &state, &config, call).await;
        let archived = state.calls.read().unwrap().front().cloned().unwrap();
        assert_eq!(archived.transcript.as_deref(), Some("Unit 12 responding"));
        assert_eq!(archived.summary.as_deref(), Some("Unit 12 is responding."));
        let _ = tokio::fs::remove_dir_all(root).await;
    }

    #[tokio::test]
    async fn provider_outage_is_recorded_after_retry_exhaustion() {
        let root =
            std::env::temp_dir().join(format!("trunkscope-ai-outage-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir_all(&root).await.unwrap();
        let audio_path = root.join("call.wav");
        tokio::fs::write(&audio_path, b"RIFFtestwav").await.unwrap();
        let now = Utc::now() - chrono::Duration::seconds(20);
        let call = Call {
            id: uuid::Uuid::new_v4(),
            system_id: uuid::Uuid::new_v4(),
            system_name: "Outage fixture".into(),
            site_id: uuid::Uuid::new_v4(),
            talkgroup_id: 12,
            talkgroup_label: "Dispatch".into(),
            category: "public-safety".into(),
            frequency_hz: 851_012_500,
            tdma_slot: None,
            source_radio_id: None,
            started_at: now,
            ended_at: Some(now),
            state: CallState::Complete,
            encryption: EncryptionState::Clear,
            signal_dbfs: -40.0,
            transcript: None,
            summary: None,
            location: None,
            audio: Some(AudioAsset {
                object_key: audio_path.to_string_lossy().into_owned(),
                content_type: "audio/wav".into(),
                duration_ms: 2_000,
            }),
        };
        let state = AppState::new();
        let config = ProcessingConfig {
            transcription_url: "http://127.0.0.1:9/unavailable".into(),
            transcription_model: "test".into(),
            summary_url: None,
            summary_model: "test".into(),
            calls_root: root.clone(),
        };
        process_with_retry(&Client::new(), &state, &config, call).await;
        assert!(state.ai_last_error.read().unwrap().is_some());
        let _ = tokio::fs::remove_dir_all(root).await;
    }
}
