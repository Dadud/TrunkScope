use std::{
    env,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use reqwest::{Client, multipart};
use serde::{Deserialize, Serialize};
use tokio::time::sleep;
use tracing::{info, warn};
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
    fn from_env() -> Option<Self> {
        if !env_bool("TRUNKSCOPE_AI_ENABLED", false) {
            return None;
        }
        Some(Self {
            transcription_url: env::var("TRUNKSCOPE_TRANSCRIBE_URL")
                .unwrap_or_else(|_| "http://speaches:8000/v1/audio/transcriptions".into()),
            transcription_model: env::var("TRUNKSCOPE_TRANSCRIBE_MODEL")
                .unwrap_or_else(|_| "Systran/faster-distil-whisper-small.en".into()),
            summary_url: env::var("TRUNKSCOPE_SUMMARY_URL").ok(),
            summary_model: env::var("TRUNKSCOPE_SUMMARY_MODEL")
                .unwrap_or_else(|_| "llama3.2:3b".into()),
            calls_root: env::var("TRUNKSCOPE_CALLS_PATH")
                .map(PathBuf::from)
                .unwrap_or_else(|_| PathBuf::from("/var/lib/trunkscope/calls")),
        })
    }
}

fn env_bool(name: &str, fallback: bool) -> bool {
    env::var(name)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(fallback)
}

pub fn spawn(state: Arc<AppState>) {
    let Some(config) = ProcessingConfig::from_env() else {
        info!("local transcription and summarization are disabled");
        return;
    };
    let mut queue = state.processing.subscribe();
    tokio::spawn(async move {
        let client = Client::builder()
            .timeout(Duration::from_secs(180))
            .build()
            .expect("valid processing HTTP client");
        loop {
            match queue.recv().await {
                Ok(call) => process_with_retry(&client, &state, &config, call).await,
                Err(tokio::sync::broadcast::error::RecvError::Lagged(count)) => {
                    warn!(%count, "AI processing queue lagged");
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    });
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
    let path = PathBuf::from(&asset.object_key);
    if !safe_audio_path(&path, &config.calls_root) {
        warn!(path = %path.display(), "rejected decoder audio path outside call storage");
        return;
    }

    let mut delay = Duration::from_secs(1);
    for attempt in 1..=5 {
        match transcribe(client, config, &path).await {
            Ok(transcript) => {
                let summary = summarize(client, config, &transcript).await.ok();
                state.enrich_call(call.id, transcript, summary);
                return;
            }
            Err(cause) if attempt < 5 => {
                warn!(%attempt, error = %cause, "call processing failed; retrying");
                sleep(delay).await;
                delay *= 2;
            }
            Err(cause) => warn!(%attempt, error = %cause, "call processing exhausted retries"),
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
}
