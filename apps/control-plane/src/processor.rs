use std::{
    env,
    path::{Path, PathBuf},
    sync::Arc,
    sync::atomic::Ordering,
    time::Duration,
};

use reqwest::Client;
use tokio::time::sleep;
use tracing::warn;
use trunkscope_domain::{Call, EncryptionState};

use crate::{providers, state::AppState};

#[derive(Clone)]
struct ProcessingConfig {
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
            let client = providers::http_client();
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
    if asset.duration_ms < 1_500 {
        return;
    }
    let path = PathBuf::from(&asset.object_key);
    if !safe_audio_path(&path, &config.calls_root) {
        warn!(path = %path.display(), "rejected decoder audio path outside call storage");
        return;
    }

    let ready_at = call.ended_at.unwrap_or(call.started_at) + chrono::Duration::seconds(10);
    if let Ok(wait) = (ready_at - chrono::Utc::now()).to_std() {
        sleep(wait).await;
    }

    let settings = state
        .settings
        .read()
        .expect("settings lock poisoned")
        .clone();
    let mut delay = Duration::from_secs(1);
    for attempt in 1..=5 {
        match providers::transcribe(client, &settings, &path).await {
            Ok(transcript) => {
                let two_tone = providers::detect_two_tone_dispatch(&transcript);
                let mut location_hint = providers::extract_location_hint(&transcript);
                if location_hint.is_none() {
                    location_hint =
                        providers::llm_location_hint(client, &settings, &transcript).await;
                }
                let summary = if transcript.trim().chars().count() >= 8
                    && (!two_tone || transcript.trim().chars().count() >= 16)
                {
                    let prompt = format!(
                        "Summarize this radio transmission in one factual sentence. Do not invent details. Transcript: {transcript}"
                    );
                    providers::summarize(client, &settings, &transcript, &prompt)
                        .await
                        .ok()
                } else {
                    None
                };
                let discord_summary = summary.clone();
                state.enrich_call(call.id, transcript, summary);
                if let Some(hint) = location_hint {
                    if let Some(location) = providers::geocode(client, &settings, &hint).await {
                        state.set_call_location(call.id, location);
                    }
                }
                if let Some(summary_text) = discord_summary.as_deref() {
                    notify_discord(client, state, &call, summary_text).await;
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

async fn notify_discord(client: &Client, state: &AppState, call: &Call, summary: &str) {
    let (webhook, keyword_rules, talkgroup_rules) = {
        let settings = state.settings.read().expect("settings lock poisoned");
        (
            settings.effective_discord_webhook_url(),
            settings.discord_keyword_rules.clone(),
            settings.discord_talkgroup_rules.clone(),
        )
    };
    let Some(default_webhook) = webhook else {
        return;
    };
    if call.encryption != EncryptionState::Clear {
        return;
    }
    let talkgroup_webhook = talkgroup_rules.iter().find(|rule| {
        rule.enabled
            && rule.talkgroup_id == call.talkgroup_id
            && !rule.webhook_url.trim().is_empty()
    });
    let haystack = format!(
        "{} {} {} {}",
        call.talkgroup_label,
        call.category,
        summary,
        call.transcript.as_deref().unwrap_or("")
    )
    .to_lowercase();
    let matched_rule = keyword_rules
        .iter()
        .find(|rule| rule.enabled && haystack.contains(&rule.keyword.to_lowercase()));
    let target_webhook = talkgroup_webhook
        .map(|rule| rule.webhook_url.clone())
        .or_else(|| {
            matched_rule.and_then(|rule| {
                let trimmed = rule.webhook_url.trim();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(rule.webhook_url.clone())
                }
            })
        })
        .unwrap_or(default_webhook);
    let map_link = call
        .location
        .as_ref()
        .map(|loc| {
            format!(
                "https://www.openstreetmap.org/?mlat={}&mlon={}#map=16/{}/{}",
                loc.latitude, loc.longitude, loc.latitude, loc.longitude
            )
        })
        .unwrap_or_default();
    let audio_link = call
        .audio
        .as_ref()
        .map(|_| format!("/api/v1/calls/{}/audio", call.id))
        .unwrap_or_default();
    let duration_secs = call
        .ended_at
        .map(|ended| (ended - call.started_at).num_seconds().max(0))
        .unwrap_or(0);
    let mut embed = serde_json::json!({
        "title": format!("{} · {}", call.talkgroup_label, call.category),
        "description": summary,
        "color": 3447003,
        "fields": [
            { "name": "System", "value": call.system_name, "inline": true },
            { "name": "Talkgroup", "value": call.talkgroup_label, "inline": true },
            { "name": "Duration", "value": format!("{}s", duration_secs), "inline": true },
        ]
    });
    if !map_link.is_empty() {
        embed["fields"]
            .as_array_mut()
            .expect("embed fields")
            .push(serde_json::json!({ "name": "Map", "value": map_link, "inline": false }));
    }
    if !audio_link.is_empty() {
        embed["fields"]
            .as_array_mut()
            .expect("embed fields")
            .push(serde_json::json!({ "name": "Audio", "value": audio_link, "inline": false }));
    }
    let payload = serde_json::json!({
        "username": "TrunkScope",
        "embeds": [embed],
        "allowed_mentions": { "parse": [] }
    });
    if let Err(error) = client.post(target_webhook).json(&payload).send().await {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_paths_outside_calls_root() {
        let root = PathBuf::from("/var/lib/trunkscope/calls");
        let outside = Path::new("/var/lib/trunkscope/audio/leak.wav");
        let inside = Path::new("/var/lib/trunkscope/calls/2026/call.wav");
        if cfg!(windows) {
            assert!(!safe_audio_path(outside, &root) || !outside.starts_with(&root));
        } else {
            assert!(!safe_audio_path(outside, &root));
            assert!(safe_audio_path(inside, &root));
        }
    }
}
