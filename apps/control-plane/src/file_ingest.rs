use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use tokio::time::sleep;
use tracing::debug;

use crate::{decoder, state::AppState};

pub fn spawn(state: Arc<AppState>) {
    tokio::spawn(async move {
        let root = std::env::var("TRUNKSCOPE_CALLS_PATH")
            .unwrap_or_else(|_| "/var/lib/trunkscope/calls".into());
        let mut seen = HashSet::<PathBuf>::new();
        let mut initialized = false;
        let baseline = std::time::SystemTime::now();
        loop {
            let mut files = Vec::new();
            collect_json(Path::new(&root), &mut files);
            // A restart must not replay the entire historical decoder volume
            // into the transcription queue. Calls already present in durable
            // state remain archived; only sidecars discovered after this
            // baseline are new ingestion work.
            if !initialized {
                seen.extend(files.iter().cloned());
                initialized = true;
                debug!(
                    baseline = seen.len(),
                    "decoder sidecar ingestion baseline established"
                );
                sleep(Duration::from_secs(2)).await;
                continue;
            }
            for path in files {
                if seen.contains(&path) {
                    continue;
                }
                // When the seen set is trimmed, historical sidecars would be
                // replayed; the mtime gate keeps pre-baseline files excluded
                // no matter how large the volume grows.
                let new_enough = std::fs::metadata(&path)
                    .and_then(|metadata| metadata.modified())
                    .map(|modified| modified > baseline)
                    .unwrap_or(false);
                if !new_enough {
                    seen.insert(path);
                    continue;
                }
                let Ok(payload) = tokio::fs::read_to_string(&path).await else {
                    continue;
                };
                let normalized = normalize_sidecar(&payload, &path);
                if decoder::ingest_status_payload(&state, normalized.as_deref().unwrap_or(&payload))
                {
                    seen.insert(path);
                }
            }
            // Keep memory bounded across long-running appliances. Replay of
            // trimmed entries is harmless now: pre-baseline files fail the
            // mtime gate and completed calls are deduplicated downstream.
            if seen.len() > 10_000 {
                seen.clear();
            }
            sleep(Duration::from_secs(2)).await;
        }
    });
}

pub(crate) fn normalize_sidecar(payload: &str, path: &Path) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(payload).ok()?;
    if value.get("type").is_some() {
        return None;
    }
    let talkgroup = value.get("talkgroup")?.clone();
    let src_num = value
        .get("srcList")
        .and_then(|v| v.as_array())
        .and_then(|v| v.first())
        .and_then(|v| v.get("src"))
        .cloned()
        .unwrap_or(serde_json::Value::Null);
    let wav = path.with_extension("wav").to_string_lossy().to_string();
    Some(
        serde_json::json!({"type":"call_end","call":{
            "id": path.file_stem()?.to_string_lossy(),
            "freq": value.get("freq")?,
            "shortName": value.get("short_name").cloned().unwrap_or_default(),
            "talkgroup": talkgroup,
            "talkgrouptag": value.get("talkgroup_tag").cloned().unwrap_or_default(),
        "analog": value.get("audio_type").and_then(|v| v.as_str()).is_some_and(|kind| kind.eq_ignore_ascii_case("analog")),
        "tone": value.get("tone").cloned().unwrap_or_default(),
        "signal": value.get("signal").cloned().unwrap_or_default(),
        "noise": value.get("noise").cloned().unwrap_or_default(),
        "phase2": value.get("phase2_tdma").cloned().unwrap_or(serde_json::json!(0)),
        "encrypted": value.get("encrypted").cloned().unwrap_or(serde_json::json!(0)),
            "startTime": value.get("start_time").cloned().unwrap_or_default(),
            "stopTime": value.get("stop_time").cloned().unwrap_or_default(),
            "srcNum": src_num,
            "filename": wav
        }})
        .to_string(),
    )
}

fn collect_json(path: &Path, output: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(path) else {
        return;
    };
    for entry in entries.flatten() {
        let candidate = entry.path();
        if candidate.is_dir() {
            collect_json(&candidate, output);
        } else if candidate
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("json"))
        {
            debug!(path = %candidate.display(), "decoder sidecar discovered");
            output.push(candidate);
        }
    }
}
