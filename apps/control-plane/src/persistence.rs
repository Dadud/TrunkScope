use crate::state::AppState;
use crate::state::{AppSettings, AuditEntry, ScanList, SystemProfile};
use std::sync::Arc;
use tokio::sync::mpsc::{UnboundedSender, unbounded_channel};
use trunkscope_domain::{Call, Receiver};
use uuid::Uuid;

#[derive(Clone, Debug)]
pub enum Command {
    Settings(AppSettings),
    ScanList(ScanList),
    DeleteScanList(Uuid),
    System(SystemProfile),
    DeleteSystem(Uuid),
    Audit(AuditEntry),
    Call(Call),
    Receivers(Vec<Receiver>),
}

pub type Sender = UnboundedSender<Command>;

pub async fn hydrate(state: &Arc<AppState>, database_url: &str) -> bool {
    let (client, connection) =
        match tokio_postgres::connect(database_url, tokio_postgres::NoTls).await {
            Ok(value) => value,
            Err(error) => {
                tracing::warn!(%error, "postgres hydration unavailable; retaining file state");
                return false;
            }
        };
    tokio::spawn(async move {
        let _ = connection.await;
    });
    if let Ok(Some(row)) = client
        .query_opt("SELECT document FROM app_settings WHERE id = 1", &[])
        .await
    {
        if let Ok(value) = row.try_get::<_, serde_json::Value>(0) {
            if let Ok(settings) = serde_json::from_value::<AppSettings>(value) {
                *state.settings.write().expect("settings lock poisoned") = settings.clone();
                *state.public_policy.write().expect("policy lock poisoned") =
                    trunkscope_domain::PublicationPolicy {
                        enabled: settings.public_feed_enabled,
                        delay_seconds: settings.public_feed_delay_seconds,
                        allowed_talkgroups: settings.public_allowed_talkgroups,
                        expose_transcripts: settings.expose_transcripts,
                        expose_radio_ids: settings.expose_radio_ids,
                        expose_precise_locations: settings.expose_precise_locations,
                    };
            }
        }
    }
    if let Ok(rows) = client
        .query("SELECT document FROM systems ORDER BY name", &[])
        .await
    {
        let values: Vec<SystemProfile> = rows
            .into_iter()
            .filter_map(|row| row.try_get::<_, serde_json::Value>(0).ok())
            .filter_map(|value| serde_json::from_value(value).ok())
            .collect();
        *state.systems.write().expect("system lock poisoned") = values;
    }
    if let Ok(Some(row)) = client
        .query_opt("SELECT document FROM receiver_profiles WHERE id = 1", &[])
        .await
    {
        if let Ok(value) = row.try_get::<_, serde_json::Value>(0) {
            if let Ok(receivers) = serde_json::from_value::<Vec<Receiver>>(value) {
                *state.receivers.write().expect("receiver lock poisoned") = receivers;
            }
        }
    }
    if let Ok(rows) = client
        .query("SELECT document FROM scan_lists ORDER BY name", &[])
        .await
    {
        let values: Vec<ScanList> = rows
            .into_iter()
            .filter_map(|row| row.try_get::<_, serde_json::Value>(0).ok())
            .filter_map(|value| serde_json::from_value(value).ok())
            .collect();
        *state.scan_lists.write().expect("scan list lock poisoned") = values;
    }
    if let Ok(rows) = client
        .query(
            "SELECT document FROM trunkscope_calls ORDER BY started_at DESC LIMIT 1000",
            &[],
        )
        .await
    {
        let values: Vec<Call> = rows
            .into_iter()
            .filter_map(|row| row.try_get::<_, serde_json::Value>(0).ok())
            .filter_map(|value| serde_json::from_value(value).ok())
            .collect();
        *state.calls.write().expect("calls lock poisoned") = values.into_iter().collect();
    }
    if let Ok(rows) = client
        .query("SELECT action, resource_type, resource_id, occurred_at FROM audit_log ORDER BY id DESC LIMIT 500", &[])
        .await
    {
        let values: Vec<AuditEntry> = rows
            .into_iter()
            .filter_map(|row| Some(AuditEntry {
                action: row.try_get(0).ok()?,
                resource_type: row.try_get(1).ok()?,
                resource_id: row.try_get(2).ok()?,
                occurred_at: row.try_get(3).ok()?,
            }))
            .collect();
        *state.audit_log.write().expect("audit lock poisoned") = values.into_iter().collect();
    }
    true
}

/// Start the optional PostgreSQL persistence worker. JSON files remain the
/// recovery source when the database is unavailable during first boot.
pub async fn start(database_url: String) -> Option<Sender> {
    let (client, connection) =
        match tokio_postgres::connect(&database_url, tokio_postgres::NoTls).await {
            Ok(value) => value,
            Err(error) => {
                tracing::warn!(%error, "postgres persistence unavailable; using file persistence");
                return None;
            }
        };
    tokio::spawn(async move {
        if let Err(error) = connection.await {
            tracing::warn!(%error, "postgres connection stopped");
        }
    });
    let (sender, mut receiver) = unbounded_channel::<Command>();
    tokio::spawn(async move {
        for statement in [
            "CREATE TABLE IF NOT EXISTS systems (id uuid PRIMARY KEY, name text NOT NULL, protocol text NOT NULL, document jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())",
            "CREATE TABLE IF NOT EXISTS audit_log (id bigserial PRIMARY KEY, action text NOT NULL, resource_type text NOT NULL, resource_id text NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now())",
            "CREATE TABLE IF NOT EXISTS trunkscope_calls (id uuid PRIMARY KEY, started_at timestamptz NOT NULL, document jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())",
            "CREATE TABLE IF NOT EXISTS receiver_profiles (id integer PRIMARY KEY, document jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())",
        ] {
            if let Err(error) = client.batch_execute(statement).await {
                tracing::warn!(%error, "postgres schema initialization failed");
            }
        }
        while let Some(command) = receiver.recv().await {
            let result = match command {
                Command::Settings(value) => client.execute(
                    "INSERT INTO app_settings (id, document, revision, updated_at) VALUES (1, $1, 1, now()) ON CONFLICT (id) DO UPDATE SET document = EXCLUDED.document, revision = app_settings.revision + 1, updated_at = now()",
                    &[&serde_json::to_value(value).unwrap_or_default()]).await.map(|_| ()),
                Command::ScanList(value) => {
                    let document = serde_json::to_value(&value).unwrap_or_default();
                    client.execute(
                        "INSERT INTO scan_lists (id, name, enabled, pause_on_activity, resume_after_ms, document, updated_at) VALUES ($1, $2, $3, $4, $5, $6, now()) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, enabled = EXCLUDED.enabled, pause_on_activity = EXCLUDED.pause_on_activity, resume_after_ms = EXCLUDED.resume_after_ms, document = EXCLUDED.document, updated_at = now()",
                        &[&value.id, &value.name, &value.enabled, &(value.pause_on_activity), &(value.resume_after_ms as i32), &document]).await.map(|_| ())
                },
                Command::DeleteScanList(id) => client.execute("DELETE FROM scan_lists WHERE id = $1", &[&id]).await.map(|_| ()),
                Command::System(value) => {
                    let document = serde_json::to_value(&value).unwrap_or_default();
                    client.execute(
                        "INSERT INTO systems (id, name, protocol, document, updated_at) VALUES ($1, $2, $3, $4, now()) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, protocol = EXCLUDED.protocol, document = EXCLUDED.document, updated_at = now()",
                        &[&value.id, &value.name, &value.protocol, &document]).await.map(|_| ())
                },
                Command::DeleteSystem(id) => client.execute("DELETE FROM systems WHERE id = $1", &[&id]).await.map(|_| ()),
                Command::Audit(value) => client.execute("INSERT INTO audit_log (action, resource_type, resource_id, occurred_at) VALUES ($1, $2, $3, $4)", &[&value.action, &value.resource_type, &value.resource_id, &value.occurred_at]).await.map(|_| ()),
                Command::Call(value) => {
                    let document = serde_json::to_value(&value).unwrap_or_default();
                    client.execute("INSERT INTO trunkscope_calls (id, started_at, document, updated_at) VALUES ($1, $2, $3, now()) ON CONFLICT (id) DO UPDATE SET document = EXCLUDED.document, updated_at = now()", &[&value.id, &value.started_at, &document]).await.map(|_| ())
                },
                Command::Receivers(value) => client.execute("INSERT INTO receiver_profiles (id, document, updated_at) VALUES (1, $1, now()) ON CONFLICT (id) DO UPDATE SET document = EXCLUDED.document, updated_at = now()", &[&serde_json::to_value(value).unwrap_or_default()]).await.map(|_| ()),
            };
            if let Err(error) = result {
                tracing::warn!(%error, "postgres persistence write failed");
            }
        }
    });
    Some(sender)
}
