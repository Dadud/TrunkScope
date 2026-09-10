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
        // Transcription is an independent pipeline. It may run when the
        // operations-summary feature is disabled, as long as an ASR endpoint
        // and model are configured.
        if !settings.ai_enabled
            || settings.transcribe_url.trim().is_empty()
            || settings.transcribe_model.trim().is_empty()
        {
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
    let transcription_enabled = ProcessingConfig::from_state(&state).is_some();
    *state
        .ai_worker_status
        .write()
        .expect("AI status lock poisoned") = if transcription_enabled { "idle" } else { "disabled" }.into();
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

    let mut settings = state
        .settings
        .read()
        .expect("settings lock poisoned")
        .clone();
    if let Some(profile) = state
        .systems
        .read()
        .expect("systems lock poisoned")
        .iter()
        .find(|profile| profile.id == call.system_id)
    {
        let mut context = Vec::new();
        if !profile.counties.is_empty() { context.push(format!("counties: {}", profile.counties.join(", "))); }
        if !profile.townships.is_empty() { context.push(format!("townships: {}", profile.townships.join(", "))); }
        if !profile.municipalities.is_empty() { context.push(format!("municipalities: {}", profile.municipalities.join(", "))); }
        if let Some(notes) = profile.local_context.as_deref().filter(|value| !value.trim().is_empty()) { context.push(format!("local context: {notes}")); }
        if !context.is_empty() {
            settings.transcription_system_prompt.push_str("\nLocal radio context: ");
            settings.transcription_system_prompt.push_str(&context.join("; "));
        }
    }
    let mut delay = Duration::from_secs(1);
    for attempt in 1..=5 {
        match providers::transcribe(client, &settings, &path).await {
            Ok(transcript) => {
                let location_hint = providers::extract_location_hint(&transcript);
                state.enrich_call(call.id, transcript, None);
                // Scheduled enrichment owns task completion. Transcription does
                // not establish a category, extract units, or normalize an address.
                if let Some(hint) = location_hint {
                    if let Some(location) = providers::geocode(client, &settings, &hint).await {
                        state.set_call_location(call.id, location);
                    }
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
