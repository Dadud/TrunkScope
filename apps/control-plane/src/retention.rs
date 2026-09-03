//! Retention worker enforcing audio/transcript/metadata policies.

use std::path::PathBuf;
use std::sync::Arc;

use tracing::info;
use trunkscope_domain::Call;

use crate::{sqlite, state::AppState};

pub fn spawn(state: Arc<AppState>) {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(std::time::Duration::from_secs(3600));
        loop {
            ticker.tick().await;
            run_once(&state);
        }
    });
}

fn run_once(state: &Arc<AppState>) {
    let settings = state
        .settings
        .read()
        .expect("settings lock poisoned")
        .clone();
    let now = chrono::Utc::now();
    let audio_cutoff = now - chrono::Duration::days(settings.audio_retention_days as i64);
    let transcript_cutoff =
        now - chrono::Duration::days(settings.transcript_retention_days as i64);
    let metadata_cutoff = now - chrono::Duration::days(settings.metadata_retention_days as i64);
    let calls_root = std::env::var("TRUNKSCOPE_CALLS_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/var/lib/trunkscope/calls"));
    let mut removed_ids = Vec::new();
    let mut calls = state.calls.write().expect("calls lock poisoned");
    let retained: Vec<Call> = calls
        .drain(..)
        .filter_map(|mut call| {
            let started = call.started_at;
            if started < metadata_cutoff {
                removed_ids.push(call.id);
                if let Some(asset) = &call.audio {
                    let path = PathBuf::from(&asset.object_key);
                    if path.starts_with(&calls_root) {
                        let _ = std::fs::remove_file(&path);
                    }
                }
                return None;
            }
            if started < transcript_cutoff {
                call.transcript = None;
                call.summary = None;
            }
            if started < audio_cutoff {
                if let Some(asset) = &call.audio {
                    let path = PathBuf::from(&asset.object_key);
                    if path.starts_with(&calls_root) {
                        let _ = std::fs::remove_file(&path);
                    }
                }
                call.audio = None;
            }
            Some(call)
        })
        .collect();
    for call in retained {
        calls.push_back(call);
    }
    drop(calls);
    if !removed_ids.is_empty() {
        sqlite::delete_calls(&removed_ids);
        info!(count = removed_ids.len(), "retention worker purged expired calls");
    }
    let export_path = calls_root
        .parent()
        .unwrap_or(std::path::Path::new("/var/lib/trunkscope"))
        .join("calls-export.json");
    let _ = sqlite::export_json_backup(&export_path);
}
