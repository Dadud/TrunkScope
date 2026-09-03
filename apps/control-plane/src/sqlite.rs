//! SQLite persistence for call history on the appliance appdata volume.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use rusqlite::{Connection, params};
use tracing::warn;
use trunkscope_domain::Call;

use crate::state::AppState;

pub fn db_path() -> PathBuf {
    std::env::var("TRUNKSCOPE_SQLITE_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/var/lib/trunkscope/trunkscope.db"))
}

pub fn init(path: &Path) -> rusqlite::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let connection = Connection::open(path)?;
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS calls (
            id TEXT PRIMARY KEY NOT NULL,
            payload TEXT NOT NULL,
            started_at TEXT NOT NULL,
            ended_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_calls_started_at ON calls(started_at DESC);",
    )?;
    Ok(())
}

pub fn hydrate(state: &Arc<AppState>) {
    let path = db_path();
    if init(&path).is_err() {
        warn!(path = %path.display(), "sqlite init failed; continuing with in-memory calls");
        return;
    }
    let Ok(connection) = Connection::open(&path) else {
        warn!("sqlite open failed during hydrate");
        return;
    };
    let mut statement =
        match connection.prepare("SELECT payload FROM calls ORDER BY started_at DESC LIMIT 1000") {
            Ok(stmt) => stmt,
            Err(error) => {
                warn!(%error, "sqlite hydrate query failed");
                return;
            }
        };
    let rows = statement.query_map([], |row| row.get::<_, String>(0));
    let Ok(rows) = rows else {
        return;
    };
    let mut loaded = Vec::new();
    for row in rows.flatten() {
        if let Ok(call) = serde_json::from_str::<Call>(&row) {
            loaded.push(call);
        }
    }
    if loaded.is_empty() {
        return;
    }
    let mut calls = state.calls.write().expect("calls lock poisoned");
    for call in loaded.into_iter().rev() {
        if !calls.iter().any(|existing| existing.id == call.id) {
            calls.push_back(call);
        }
    }
    while calls.len() > crate::state::MAX_RECENT_CALLS {
        calls.pop_front();
    }
}

pub fn upsert_call(call: &Call) {
    let path = db_path();
    if init(&path).is_err() {
        return;
    }
    let Ok(payload) = serde_json::to_string(call) else {
        return;
    };
    let Ok(connection) = Connection::open(path) else {
        return;
    };
    let started_at = call.started_at.to_rfc3339();
    let ended_at = call.ended_at.map(|value| value.to_rfc3339());
    if let Err(error) = connection.execute(
        "INSERT INTO calls (id, payload, started_at, ended_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, ended_at = excluded.ended_at",
        params![call.id.to_string(), payload, started_at, ended_at],
    ) {
        warn!(%error, call_id = %call.id, "sqlite upsert failed");
    }
}

pub fn delete_calls(ids: &[uuid::Uuid]) {
    if ids.is_empty() {
        return;
    }
    let path = db_path();
    let Ok(connection) = Connection::open(path) else {
        return;
    };
    for id in ids {
        let _ = connection.execute("DELETE FROM calls WHERE id = ?1", params![id.to_string()]);
    }
}

pub fn purge_before(cutoff: chrono::DateTime<chrono::Utc>) -> Vec<uuid::Uuid> {
    let path = db_path();
    let Ok(connection) = Connection::open(path) else {
        return Vec::new();
    };
    let cutoff = cutoff.to_rfc3339();
    let Ok(mut statement) = connection.prepare("SELECT id FROM calls WHERE started_at < ?1") else {
        return Vec::new();
    };
    let rows = statement.query_map(params![cutoff], |row| row.get::<_, String>(0));
    let Ok(rows) = rows else {
        return Vec::new();
    };
    rows.flatten()
        .filter_map(|id| uuid::Uuid::parse_str(&id).ok())
        .collect()
}

pub fn export_json_backup(path: &Path) {
    let db = db_path();
    let Ok(connection) = Connection::open(db) else {
        return;
    };
    let Ok(mut statement) = connection.prepare("SELECT payload FROM calls ORDER BY started_at ASC")
    else {
        return;
    };
    let Ok(rows) = statement.query_map([], |row| row.get::<_, String>(0)) else {
        return;
    };
    let calls: Vec<Call> = rows
        .flatten()
        .filter_map(|payload| serde_json::from_str(&payload).ok())
        .collect();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(bytes) = serde_json::to_vec_pretty(&calls) {
        let _ = crate::state::atomic_write(path, &bytes);
    }
}
