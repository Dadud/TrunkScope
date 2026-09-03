use std::{process::Stdio, sync::Arc, time::Instant};

use axum::{
    Json, Router,
    body::Bytes,
    extract::{
        Path, Query, State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post, put},
};
use serde::{Deserialize, Serialize};
use tower_http::{
    cors::CorsLayer,
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};
use trunkscope_domain::{
    Call, PublicationPolicy, Receiver, ReceiverCapabilities, ReceiverDriver, ReceiverHealth,
    ReceiverState, Talkgroup,
};

use crate::state::{AppSettings, AppState, ScanList, SystemProfile};

pub fn router(state: Arc<AppState>) -> Router {
    let mut app = Router::new()
        .route("/api/v1/health", get(health))
        .route("/api/v1/health/live", get(liveness))
        .route("/api/v1/health/ready", get(readiness))
        .route("/api/v1/runtime", get(runtime))
        .route("/api/v1/diagnostics", get(diagnostics))
        .route("/api/v1/decoder/config", get(decoder_config))
        .route("/api/v1/audit", get(audit))
        .route(
            "/api/v1/auth/login",
            axum::routing::post(crate::auth::login),
        )
        .route("/api/v1/auth/status", get(crate::auth::status))
        .route("/api/v1/auth/setup", post(crate::auth::setup))
        .route("/api/v1/auth/password", put(crate::auth::change_password))
        .route("/api/v1/auth/me", get(crate::auth::me))
        .route(
            "/api/v1/auth/logout",
            axum::routing::post(crate::auth::logout),
        )
        .route("/api/v1/snapshot", get(snapshot))
        .route("/api/v1/receivers", get(receivers).post(create_receiver))
        .route(
            "/api/v1/receivers/{id}",
            put(update_receiver).delete(delete_receiver),
        )
        .route("/api/v1/receivers/{id}/probe", post(receiver_probe))
        .route(
            "/api/v1/receivers/{id}/capabilities",
            get(receiver_capabilities),
        )
        .route("/api/v1/receivers/{id}/verify", post(receiver_verify))
        .route("/api/v1/receivers/{id}/start", post(receiver_start))
        .route("/api/v1/receivers/{id}/stop", post(receiver_stop))
        .route("/api/v1/receivers/{id}/restart", post(receiver_restart))
        .route("/api/v1/calls/{id}/location", put(update_call_location))
        .route("/api/v1/calls/purge", post(purge_calls))
        .route("/api/v1/calls/purge/undo", post(undo_purge_calls))
        .route("/api/v1/calls", get(calls))
        .route("/api/v1/operations/ask", post(operations_ask))
        .route("/api/call-upload", post(rdio_call_upload))
        .route("/api/v1/operations/summary", get(operations_summary))
        .route("/api/v1/operations/sessions", get(conversation_sessions))
        .route(
            "/api/v1/operations/sessions/{id}/audio",
            get(conversation_audio),
        )
        .route(
            "/api/v1/operations/sessions/{id}/location",
            put(confirm_session_location),
        )
        .route("/api/v1/integrations/discord", get(discord_status))
        .route("/api/v1/integrations/discord/test", post(discord_test))
        .route("/api/v1/integrations/geocoder", get(geocoder_status))
        .route("/api/v1/integrations/transcribe", get(transcribe_status))
        .route("/api/v1/integrations/transcribe/test", post(transcribe_test))
        .route("/api/v1/integrations/summary", get(summary_status))
        .route("/api/v1/integrations/summary/test", post(summary_test))
        .route("/api/v1/integrations/geocoder/test", post(geocoder_test))
        .route("/api/v1/imports/sites", post(import_sites))
        .route("/api/v1/imports/sites/preview", post(preview_sites))
        .route("/api/v1/audio/{id}", get(audio))
        .route("/api/v1/calls/{id}/audio", get(audio))
        .route(
            "/api/v1/policies/public",
            get(public_policy).put(save_public_policy),
        )
        .route(
            "/api/v1/public-policy",
            get(public_policy).put(save_public_policy),
        )
        .route("/api/v1/systems", get(systems).post(save_system))
        .route("/api/v1/talkgroups", get(talkgroups).post(save_talkgroup))
        .route(
            "/api/v1/talkgroups/{id}",
            put(update_talkgroup).delete(delete_talkgroup),
        )
        .route("/api/v1/imports/systems", post(import_systems))
        .route("/api/v1/imports/systems/preview", post(preview_systems))
        .route("/api/v1/imports/talkgroups", post(import_talkgroups))
        .route(
            "/api/v1/imports/talkgroups/preview",
            post(preview_talkgroups),
        )
        .route(
            "/api/v1/systems/{id}",
            put(update_system).delete(delete_system),
        )
        .route("/api/v1/scan-lists", get(scan_lists).post(save_scan_list))
        .route("/api/v1/scan-lists/{id}/start", post(start_scan_list))
        .route("/api/v1/scan-lists/{id}/stop", post(stop_scan_list))
        .route(
            "/api/v1/scan-lists/{id}",
            put(update_scan_list).delete(delete_scan_list),
        )
        .route("/api/v1/settings", get(settings).put(save_settings))
        .route("/api/v1/live", get(live))
        .route("/api/v1/decoder/status", get(crate::decoder::status_socket))
        .route("/api/v1/decoder/ingest", post(decoder_ingest))
        .with_state(state)
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http());

    // When TRUNKSCOPE_WEB_DIST points to the pre-built React SPA assets,
    // serve them directly from the control-plane binary (single-container
    // mode). All non-API requests fall through to index.html for client-
    // side routing.
    if let Ok(dist) = std::env::var("TRUNKSCOPE_WEB_DIST") {
        if !dist.trim().is_empty() {
            let serve = ServeDir::new(&dist)
                .fallback(ServeFile::new(std::path::Path::new(&dist).join("index.html")));
            app = app.fallback_service(serve);
            tracing::info!(path = %dist, "serving embedded web UI");
        }
    }

    app
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthResponse {
    status: &'static str,
    version: &'static str,
    uptime_ms: u128,
}

async fn health() -> Json<HealthResponse> {
    static STARTED: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();
    let started = STARTED.get_or_init(Instant::now);
    Json(HealthResponse {
        status: "ok",
        version: env!("CARGO_PKG_VERSION"),
        uptime_ms: started.elapsed().as_millis(),
    })
}

async fn liveness() -> StatusCode {
    StatusCode::OK
}

async fn readiness(State(state): State<Arc<AppState>>) -> StatusCode {
    let settings = state.settings.read().expect("settings lock poisoned");
    if settings.radio_mode == "decoder" {
        let connected = *state
            .decoder_connected
            .read()
            .expect("decoder lock poisoned");
        let recent_event = state
            .decoder_last_event
            .read()
            .expect("decoder lock poisoned")
            .map(|timestamp| (chrono::Utc::now() - timestamp).num_seconds() <= 15)
            .unwrap_or(false);
        // The decoder healthcheck refreshes this heartbeat while the foreground
        // Trunk Recorder process is alive.  An idle radio system can legitimately
        // have no call sidecars for minutes, so readiness must not fail merely
        // because the air is quiet.
        let heartbeat = decoder_heartbeat_fresh();
        if !connected && !recent_event && !heartbeat {
            return StatusCode::SERVICE_UNAVAILABLE;
        }
    }
    StatusCode::OK
}

fn decoder_heartbeat_fresh() -> bool {
    let path = std::env::var("TRUNKSCOPE_CALLS_PATH")
        .unwrap_or_else(|_| "/var/lib/trunkscope/calls".into());
    std::fs::metadata(std::path::Path::new(&path).join(".decoder-health"))
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|modified| modified.elapsed().ok())
        // The decoder healthcheck touches this file every ten seconds. Keep
        // only a small grace window so a stopped container becomes visibly
        // degraded instead of appearing healthy for nearly a minute.
        .map(|age| age.as_secs() <= 15)
        .unwrap_or(false)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeResponse {
    decoder_connected: bool,
    decoder_last_event: Option<chrono::DateTime<chrono::Utc>>,
    receiver_count: usize,
    active_call_count: usize,
    receiver_states: Vec<trunkscope_domain::ReceiverState>,
    ai_enabled: bool,
    storage_path: String,
    active_scan_list: Option<uuid::Uuid>,
    storage_healthy: bool,
    queue_backlog: usize,
    last_event: Option<chrono::DateTime<chrono::Utc>>,
    persistence_connected: bool,
    ai_worker_status: String,
}

async fn runtime(State(state): State<Arc<AppState>>) -> Json<RuntimeResponse> {
    let calls = state.calls.read().expect("calls lock poisoned");
    let receivers = state.receivers.read().expect("receiver lock poisoned");
    let settings = state.settings.read().expect("settings lock poisoned");
    let mut ai_worker_status = state
        .ai_worker_status
        .read()
        .expect("AI status lock poisoned")
        .clone();
    // A worker is spawned whenever AI is enabled. Keep the diagnostic truthful
    // during the startup window before its first queue event changes status.
    if settings.ai_enabled && ai_worker_status == "disabled" {
        ai_worker_status = "idle".into();
    }
    // A live Trunk Recorder process may not have an open status websocket when
    // the system is quiet. Treat its fresh supervised heartbeat (or a recent
    // decoded event) as connected so the operator view reflects process truth.
    let decoder_socket = *state
        .decoder_connected
        .read()
        .expect("decoder lock poisoned");
    let decoder_recent_event = state
        .decoder_last_event
        .read()
        .expect("decoder lock poisoned")
        .map(|timestamp| (chrono::Utc::now() - timestamp).num_seconds() <= 45)
        .unwrap_or(false);
    let decoder_connected = decoder_socket || decoder_recent_event || decoder_heartbeat_fresh();
    Json(RuntimeResponse {
        decoder_connected,
        decoder_last_event: *state
            .decoder_last_event
            .read()
            .expect("decoder lock poisoned"),
        receiver_count: receivers.len(),
        receiver_states: receivers.iter().map(|receiver| receiver.state).collect(),
        ai_enabled: settings.ai_enabled,
        storage_path: std::env::var("TRUNKSCOPE_CALLS_PATH")
            .unwrap_or_else(|_| "/var/lib/trunkscope/calls".into()),
        active_scan_list: *state
            .active_scan_list
            .read()
            .expect("scan state lock poisoned"),
        storage_healthy: std::fs::metadata(
            std::env::var("TRUNKSCOPE_CALLS_PATH")
                .unwrap_or_else(|_| "/var/lib/trunkscope/calls".into()),
        )
        .map(|metadata| metadata.is_dir())
        .unwrap_or(false),
        queue_backlog: state
            .processing_queue_depth
            .load(std::sync::atomic::Ordering::Relaxed),
        last_event: *state
            .decoder_last_event
            .read()
            .expect("decoder lock poisoned"),
        persistence_connected: state
            .persistence
            .read()
            .expect("persistence lock poisoned")
            .is_some()
            || crate::sqlite::db_path().is_file(),
        ai_worker_status,
        active_call_count: calls
            .iter()
            .filter(|call| call.state == trunkscope_domain::CallState::Active)
            .count(),
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticsResponse {
    capture: ComponentStatus,
    decoder: ComponentStatus,
    recording: ComponentStatus,
    ingestion: ComponentStatus,
    ai: ComponentStatus,
    simulated: bool,
    last_event: Option<chrono::DateTime<chrono::Utc>>,
    last_audio_file: Option<String>,
    failure_reason: Option<String>,
    process_id: u32,
    image_version: String,
    config_hash: String,
    decoder_heartbeat_age_seconds: Option<u64>,
    decoder_control_lock_age_seconds: Option<u64>,
    ai_failure_reason: Option<String>,
}

#[derive(Serialize)]
struct ComponentStatus {
    state: String,
    detail: String,
}

async fn diagnostics(State(state): State<Arc<AppState>>) -> Json<DiagnosticsResponse> {
    let receivers = state.receivers.read().expect("receiver lock poisoned");
    let settings = state.settings.read().expect("settings lock poisoned");
    let decoder_mode = settings.radio_mode == "decoder";
    let capture_ok = receivers
        .iter()
        .any(|r| matches!(r.state, ReceiverState::Monitoring | ReceiverState::Ready));
    let decoder_socket_ok = *state
        .decoder_connected
        .read()
        .expect("decoder lock poisoned");
    let last_event = *state
        .decoder_last_event
        .read()
        .expect("decoder lock poisoned");
    // Trunk Recorder's file-sidecar ingestion is the authoritative event
    // path in production. Treat a recent normalized sidecar as decoder
    // connectivity evidence even when the optional websocket is absent.
    let decoder_event_ok = decoder_mode
        && last_event
            .map(|timestamp| (chrono::Utc::now() - timestamp).num_seconds() <= 45)
            .unwrap_or(false);
    let decoder_heartbeat_ok = decoder_heartbeat_fresh();
    let calls_path = std::env::var("TRUNKSCOPE_CALLS_PATH")
        .unwrap_or_else(|_| "/var/lib/trunkscope/calls".into());
    let decoder_heartbeat_age_seconds =
        std::fs::metadata(std::path::PathBuf::from(calls_path).join(".decoder-health"))
            .and_then(|metadata| metadata.modified())
            .ok()
            .and_then(|modified| modified.elapsed().ok())
            .map(|age| age.as_secs());
    let decoder_control_lock_age_seconds = state
        .decoder_control_lock
        .read()
        .expect("decoder lock poisoned")
        .and_then(|timestamp| (chrono::Utc::now() - timestamp).to_std().ok())
        .map(|age| age.as_secs());
    let config = decoder_config_value(&state);
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    use std::hash::{Hash, Hasher};
    serde_json::to_string(&config)
        .unwrap_or_default()
        .hash(&mut hasher);
    let config_hash = format!("{:016x}", hasher.finish());
    let decoder_ok = decoder_socket_ok || decoder_event_ok || decoder_heartbeat_ok;
    let calls = state.calls.read().expect("calls lock poisoned");
    let ai_worker_status = state
        .ai_worker_status
        .read()
        .expect("AI status lock poisoned")
        .clone();
    let ai_failure_reason = state
        .ai_last_error
        .read()
        .expect("AI error lock poisoned")
        .clone();
    let enriched_calls = calls
        .iter()
        .filter(|call| call.transcript.is_some() || call.summary.is_some())
        .count();
    let last_audio_file = calls
        .iter()
        .filter_map(|call| {
            call.audio.as_ref().map(|audio| {
                (
                    call.ended_at.unwrap_or(call.started_at),
                    audio.object_key.clone(),
                )
            })
        })
        .max_by_key(|(timestamp, _)| *timestamp)
        .map(|(_, path)| path);
    Json(DiagnosticsResponse {
        capture: ComponentStatus {
            state: if decoder_mode { "delegated" } else if capture_ok { "ready" } else { "unavailable" }.into(),
            detail: if decoder_mode { "Hardware stream is owned by Trunk Recorder" } else if capture_ok { "RF samples are arriving" } else { "No active hardware stream" }.into(),
        },
        decoder: ComponentStatus {
            state: if decoder_ok { "connected" } else if decoder_mode { "running-unverified" } else { "offline" }.into(),
            detail: if decoder_socket_ok { "Decoder status socket connected" } else if decoder_event_ok { "Recent Trunk Recorder event observed" } else if decoder_heartbeat_ok { "Trunk Recorder process heartbeat is fresh; awaiting control/call event" } else if decoder_mode && settings.radio_device.contains("remote=") { "Decoder mode enabled; remote SDR endpoint is not producing a heartbeat or event" } else if decoder_mode { "Decoder mode enabled; no recent control or call event" } else { "No decoder status connection" }.into(),
        },
        recording: ComponentStatus { state: if last_audio_file.is_some() { "ready" } else { "waiting" }.into(), detail: if last_audio_file.is_some() { "At least one audio asset exists" } else { "No finalized audio asset yet" }.into() },
        ingestion: ComponentStatus { state: if last_event.is_some() { "receiving" } else { "waiting" }.into(), detail: "Control-plane event ledger".into() },
        ai: ComponentStatus {
            state: if !settings.ai_enabled { "disabled" } else { ai_worker_status.as_str() }.into(),
            detail: if let Some(error) = ai_failure_reason.as_deref() {
                format!("AI worker failure: {error}")
            } else {
                format!("ASR profile {}; {enriched_calls} enriched calls", settings.ai_profile)
            },
        },
        simulated: settings.radio_mode == "simulator",
        last_event,
        last_audio_file,
        failure_reason: (!decoder_mode).then(|| receivers.iter().find(|r| matches!(r.state, ReceiverState::Faulted)).map(|r| {
            if r.serial.trim() == "driver=sdrplay" {
                format!("receiver {} is faulted: '{}' is not a remote Soapy device; configure driver=remote,remote=tcp://HOST:55132,remote:driver=sdrplay", r.label, r.serial)
            } else {
                format!("receiver {} is faulted (device: {})", r.label, r.serial)
            }
        })).flatten(),
        process_id: std::process::id(),
        image_version: std::env::var("TRUNKSCOPE_IMAGE_VERSION")
            .unwrap_or_else(|_| env!("CARGO_PKG_VERSION").to_string()),
        config_hash,
        decoder_heartbeat_age_seconds,
        decoder_control_lock_age_seconds,
        ai_failure_reason,
    })
}

pub fn decoder_config_value(state: &Arc<AppState>) -> serde_json::Value {
    let settings = state
        .settings
        .read()
        .expect("settings lock poisoned")
        .clone();
    let receivers = state.receivers.read().expect("receiver lock poisoned");
    let systems = state.systems.read().expect("system lock poisoned");
    let site_filter = settings.effective_site_filter();
    let p25_controls: Vec<u64> = systems
        .iter()
        .filter(|system| system.protocol == "p25")
        .flat_map(|system| {
            let selected_sites: Vec<_> = system
                .sites
                .iter()
                .filter(|site| {
                    site_filter
                        .as_ref()
                        .is_none_or(|filter| site.name.to_ascii_lowercase().contains(filter))
                })
                .collect();
            let site_channels = selected_sites
                .iter()
                .flat_map(|site| site.control_channels_hz.iter().copied())
                .collect::<Vec<_>>();
            if !site_channels.is_empty() {
                site_channels
            } else if system.control_channels_hz.is_empty() {
                system.control_channel_hz.into_iter().collect::<Vec<_>>()
            } else {
                system.control_channels_hz.clone()
            }
        })
        .collect();
    let analog_frequencies: Vec<u64> = systems
        .iter()
        .filter(|system| system.protocol == "analog-fm")
        .filter_map(|system| system.frequency_hz)
        .collect();
    let all_tuning_frequencies: Vec<u64> = p25_controls
        .iter()
        .copied()
        .chain(analog_frequencies.iter().copied())
        .collect();
    let requested_center = all_tuning_frequencies
        .iter()
        .min()
        .zip(all_tuning_frequencies.iter().max())
        .map(|(low, high)| (low + high) / 2);
    let requested_span = all_tuning_frequencies
        .iter()
        .min()
        .zip(all_tuning_frequencies.iter().max())
        .map(|(low, high)| high.saturating_sub(*low).saturating_add(500_000));
    // In decoder mode the persisted appliance setting is authoritative for a
    // remote SoapyRemote endpoint. Receiver inventory can contain only the
    // discovered driver identity (for example `driver=sdrplay`), which must
    // not overwrite the actual remote connection string on restart.
    let source_device = if settings.radio_device.contains("remote=")
        || settings.radio_device.contains("soapy=")
    {
        settings.radio_device.clone()
    } else {
        receivers
            .first()
            .map(|receiver| receiver.serial.clone())
            .filter(|serial| !serial.trim().is_empty())
            .unwrap_or_else(|| settings.radio_device.clone())
    };
    let source_device = if source_device.trim_start().starts_with("soapy=") {
        source_device
    } else {
        format!("soapy=0,{}", source_device)
    };
    let source = receivers.first().map(|receiver| serde_json::json!({
        "center": requested_center.unwrap_or(receiver.center_frequency_hz.unwrap_or(settings.radio_frequency_hz)),
        // A trunked system can grant voice channels on either side of the
        // control channel.  The RSP1B's 2.4 MHz mode clipped a live grant at
        // 151.0475 MHz by a few kHz, so use its next supported 6 MHz rate
        // whenever P25 is configured.  This keeps the entire 700/800 MHz
        // or VHF system slice available for following.
        "rate": requested_span.unwrap_or(0).max(6_000_000).max(receiver.sample_rate_hz.unwrap_or(settings.radio_sample_rate_hz) as u64),
        "error": receiver.ppm,
        // Trunk Recorder treats a zero gain as "unset" and emits a warning.
        // The RSP1B exposes IFGR (20..59) and RFGR (0..9); these conservative
        // midpoint values are overridden by a probed receiver profile when
        // the operator has explicitly selected gain.
        "gain": receiver.gain_db.unwrap_or(40.0),
        "gainSettings": {"IFGR": 40, "RFGR": 4},
        "digitalRecorders": 4,
        "analogRecorders": 2,
        "driver": "osmosdr",
        "device": source_device,
    })).unwrap_or_else(|| serde_json::json!({
        "center": requested_center.unwrap_or(settings.radio_frequency_hz),
        "rate": requested_span.unwrap_or(0).max(6_000_000).max(settings.radio_sample_rate_hz as u64),
        "error": settings.radio_ppm,
        "gain": settings.radio_gain_db.unwrap_or(40.0),
        "gainSettings": {"IFGR": 40, "RFGR": 4},
        "digitalRecorders": 4,
        "analogRecorders": 2,
        "driver": "osmosdr",
        "device": source_device,
    }));
    let imported_talkgroups = std::env::var("TRUNKSCOPE_CALLS_PATH")
        .map(|root| std::path::PathBuf::from(root).join("imported-talkgroups.csv"))
        .unwrap_or_else(|_| {
            std::path::PathBuf::from("/var/lib/trunkscope/calls/imported-talkgroups.csv")
        });
    let default_talkgroups_file = if imported_talkgroups.is_file() {
        "/var/lib/trunkscope/calls/imported-talkgroups.csv"
    } else {
        "/config/trs_tg_6364.csv"
    };
    let talkgroups = state.talkgroups.read().expect("talkgroup lock poisoned");
    let calls_root = std::env::var("TRUNKSCOPE_CALLS_PATH")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::path::PathBuf::from("/var/lib/trunkscope/calls"));
    let mut configured_systems: Vec<_> = systems
        .iter()
        .filter(|system| system.protocol == "p25")
        .map(|system| {
            let selected_sites: Vec<_> = system
                .sites
                .iter()
                .filter(|site| {
                    site_filter
                        .as_ref()
                        .is_none_or(|filter| site.name.to_ascii_lowercase().contains(filter))
                })
                .collect();
            let site_channels = selected_sites
                .iter()
                .flat_map(|site| site.control_channels_hz.iter().copied())
                .collect::<Vec<_>>();
            let control_channels = if !site_channels.is_empty() {
                site_channels
            } else if system.control_channels_hz.is_empty() {
                system.control_channel_hz.into_iter().collect::<Vec<_>>()
            } else {
                system.control_channels_hz.clone()
            };
            let talkgroups_file =
                talkgroups_file_for_system(&calls_root, &talkgroups, system.id, default_talkgroups_file);
            let mut configured = serde_json::json!({
                "type": "p25", "shortName": system.name,
                "control_channels": control_channels,
                "sites": selected_sites,
                "modulation": "qpsk", "squelch": -60, "recordUnknown": true, "hideEncrypted": false,
                "talkgroupsFile": talkgroups_file,
            });
            if let Some(nac) = system.nac.filter(|value| *value > 0 && *value <= 0xFFF) {
                configured["nac"] = serde_json::json!(nac);
            }
            attach_upload_script(&mut configured);
            configured
        })
        .collect();
    drop(talkgroups);
    if systems.iter().any(|system| system.protocol == "analog-fm") {
        let conventional_name = systems
            .iter()
            .filter(|system| system.protocol == "analog-fm")
            .map(|system| system.name.as_str())
            .collect::<Vec<_>>()
            .join(" / ");
        let mut conventional = serde_json::json!({
            "type": "conventional",
            "shortName": if conventional_name.is_empty() { "Conventional FM" } else { conventional_name.as_str() },
            "channelFile": "/var/lib/trunkscope/audio/decoder/analog-channels.csv",
            "squelch": -60.0,
            "enabled": true,
            "deemphasisTau": 0.000750,
            "decodeMDC": false,
            "decodeFSync": false,
        });
        attach_upload_script(&mut conventional);
        configured_systems.push(conventional);
    }
    let status_server = decoder_status_server();
    serde_json::json!({
        "ver": 2, "captureDir": "/var/lib/trunkscope/calls",
        "statusServer": status_server,
        "audioArchive": true, "callLog": true, "softVocoder": true,
        "sources": [source], "systems": configured_systems,
    })
}

fn talkgroups_file_for_system(
    calls_root: &std::path::Path,
    talkgroups: &[Talkgroup],
    system_id: uuid::Uuid,
    fallback: &str,
) -> String {
    let scoped: Vec<&Talkgroup> = talkgroups
        .iter()
        .filter(|talkgroup| talkgroup.system_id == system_id)
        .collect();
    if scoped.is_empty() {
        return fallback.to_string();
    }
    let path = calls_root.join(format!("talkgroups-{}.csv", system_id));
    let mut csv = String::from("Decimal,Hex,Alpha Tag,Mode,Description,Tag,Category\n");
    for talkgroup in scoped {
        csv.push_str(&format!(
            "{},{:03X},\"{}\",D,\"{}\",\"{}\",\"{}\"\n",
            talkgroup.decimal_id,
            talkgroup.decimal_id,
            talkgroup.alpha_tag.replace('"', "'"),
            talkgroup.description.replace('"', "'"),
            talkgroup.category.replace('"', "'"),
            talkgroup.category.replace('"', "'")
        ));
    }
    if crate::state::atomic_write(&path, csv.as_bytes()).is_ok() {
        format!("/var/lib/trunkscope/calls/talkgroups-{}.csv", system_id)
    } else {
        fallback.to_string()
    }
}

fn attach_upload_script(system: &mut serde_json::Value) {
    if let Some(script) = std::env::var("TRUNKSCOPE_UPLOAD_SCRIPT")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        system["uploadScript"] = serde_json::Value::String(script);
    }
}

fn decoder_status_server() -> String {
    std::env::var("TRUNKSCOPE_STATUS_SERVER")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "ws://127.0.0.1:8080/api/v1/decoder/status".into())
}

pub fn write_decoder_config(state: &Arc<AppState>) {
    let path = std::env::var("TRUNKSCOPE_DECODER_CONFIG_PATH")
        .unwrap_or_else(|_| "/var/lib/trunkscope/audio/decoder/config.json".into());
    let path = std::path::PathBuf::from(path);
    if let Some(parent) = path.parent() {
        let _ = write_analog_channel_file(state, parent.join("analog-channels.csv"));
    }
    if let Ok(bytes) = serde_json::to_vec_pretty(&decoder_config_value(state)) {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Err(error) = crate::state::atomic_write(&path, &bytes) {
            tracing::warn!(%error, "decoder config generation failed");
        }
    }
}

fn write_analog_channel_file(
    state: &Arc<AppState>,
    path: std::path::PathBuf,
) -> std::io::Result<()> {
    let systems = state.systems.read().expect("system lock poisoned");
    let mut csv = String::from(
        "TG Number,Frequency,Tone,Alpha Tag,Description,Category,Enable,Signal Detector,Squelch\n",
    );
    for (index, system) in systems
        .iter()
        .filter(|system| system.protocol == "analog-fm")
        .enumerate()
    {
        let Some(frequency) = system.frequency_hz else {
            continue;
        };
        let tone = system.tone.as_deref().unwrap_or("");
        let label = system.name.replace([',', '\n', '\r'], " ");
        let squelch = system.squelch_db.unwrap_or(-60.0);
        csv.push_str(&format!(
            "{},{},{},{},{},Analog,true,true,{}\n",
            900000 + index,
            frequency,
            tone,
            label,
            label,
            squelch
        ));
    }
    crate::state::atomic_write(&path, csv.as_bytes())
}

async fn decoder_config(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    Json(decoder_config_value(&state))
}

/// Instant post-call hook for Trunk Recorder `uploadScript`.
/// The sidecar JSON is POSTed as the body; `X-Sidecar-Path` is the JSON
/// file path so adjacent `.wav` names can be resolved the same way as the
/// directory poller.
async fn decoder_ingest(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: String,
) -> StatusCode {
    let payload = headers
        .get("x-sidecar-path")
        .and_then(|value| value.to_str().ok())
        .map(std::path::PathBuf::from)
        .and_then(|path| crate::file_ingest::normalize_sidecar(&body, &path))
        .unwrap_or(body);
    if crate::decoder::ingest_status_payload(&state, &payload) {
        StatusCode::NO_CONTENT
    } else {
        StatusCode::BAD_REQUEST
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    receivers: Vec<Receiver>,
    calls: Vec<Call>,
    public_policy: PublicationPolicy,
}

async fn snapshot(State(state): State<Arc<AppState>>) -> Json<Snapshot> {
    Json(Snapshot {
        receivers: state
            .receivers
            .read()
            .expect("receiver lock poisoned")
            .clone(),
        calls: state
            .calls
            .read()
            .expect("calls lock poisoned")
            .iter()
            .cloned()
            .collect::<Vec<_>>(),
        public_policy: state
            .public_policy
            .read()
            .expect("policy lock poisoned")
            .clone(),
    })
}

async fn audit(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    if !admin_allowed(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    Json(
        state
            .audit_log
            .read()
            .expect("audit lock poisoned")
            .iter()
            .cloned()
            .collect::<Vec<_>>(),
    )
    .into_response()
}

async fn receivers(State(state): State<Arc<AppState>>) -> Json<Vec<Receiver>> {
    Json(
        state
            .receivers
            .read()
            .expect("receiver lock poisoned")
            .clone(),
    )
}

async fn receiver_capabilities(
    State(state): State<Arc<AppState>>,
    Path(id): Path<uuid::Uuid>,
) -> Response {
    let receivers = state.receivers.read().expect("receiver lock poisoned");
    receivers
        .iter()
        .find(|r| r.id == id)
        .map(|r| (StatusCode::OK, Json(r.capabilities.clone())).into_response())
        .unwrap_or_else(|| StatusCode::NOT_FOUND.into_response())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VerifyResponse {
    passed: bool,
    checks: Vec<VerifyCheck>,
}
#[derive(Serialize)]
struct VerifyCheck {
    name: String,
    passed: bool,
    detail: String,
}

async fn receiver_verify(
    State(state): State<Arc<AppState>>,
    Path(id): Path<uuid::Uuid>,
    headers: HeaderMap,
) -> Response {
    if !admin_allowed(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let receiver = state
        .receivers
        .read()
        .expect("receiver lock poisoned")
        .iter()
        .find(|r| r.id == id)
        .cloned();
    let Some(receiver) = receiver else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let decoder_mode = state
        .settings
        .read()
        .expect("settings lock poisoned")
        .radio_mode
        == "decoder";
    let decoder_connected = *state
        .decoder_connected
        .read()
        .expect("decoder lock poisoned")
        || decoder_heartbeat_fresh();
    let recent_event = state
        .decoder_last_event
        .read()
        .expect("decoder lock poisoned")
        .is_some_and(|timestamp| (chrono::Utc::now() - timestamp).num_seconds() <= 45);
    let recording_exists = state
        .calls
        .read()
        .expect("calls lock poisoned")
        .iter()
        .filter_map(|call| call.audio.as_ref())
        .any(|audio| std::path::Path::new(&audio.object_key).is_file());
    let mut checks = vec![
        VerifyCheck {
            name: "device-profile".into(),
            passed: !receiver.serial.trim().is_empty(),
            detail: if receiver.serial.is_empty() {
                "No device arguments configured"
            } else {
                "Device arguments present"
            }
            .into(),
        },
        VerifyCheck {
            name: "frequency".into(),
            passed: receiver.center_frequency_hz.is_some_and(|f| f > 0),
            detail: format!("{}", receiver.center_frequency_hz.unwrap_or_default()),
        },
        VerifyCheck {
            name: "sample-rate".into(),
            passed: receiver
                .sample_rate_hz
                .is_some_and(|r| receiver.capabilities.sample_rates_hz.contains(&r)),
            detail: format!("{}", receiver.sample_rate_hz.unwrap_or_default()),
        },
        VerifyCheck {
            name: "stream-state".into(),
            passed: matches!(
                receiver.state,
                ReceiverState::Monitoring | ReceiverState::Ready
            ),
            detail: format!("{:?}", receiver.state),
        },
        VerifyCheck {
            name: "decoder-process".into(),
            passed: !decoder_mode || decoder_connected,
            detail: if !decoder_mode {
                "Not required in radiod mode"
            } else if decoder_connected {
                "Decoder heartbeat/socket is healthy"
            } else {
                "No decoder heartbeat or status socket"
            }
            .into(),
        },
        VerifyCheck {
            name: "event-ingestion".into(),
            passed: !decoder_mode || recent_event,
            detail: if !decoder_mode {
                "Not required in radiod mode"
            } else if recent_event {
                "Recent decoder event ingested"
            } else {
                "No recent decoder event"
            }
            .into(),
        },
        VerifyCheck {
            name: "recording-file".into(),
            passed: !decoder_mode || recording_exists,
            detail: if !decoder_mode {
                "Not required in radiod mode"
            } else if recording_exists {
                "A readable audio asset exists"
            } else {
                "No readable audio asset found"
            }
            .into(),
        },
    ];
    if let Some((host, port)) = remote_endpoint(&receiver.serial) {
        let endpoint = format!("{host}:{port}");
        let reachable = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            tokio::net::TcpStream::connect((host.as_str(), port)),
        )
        .await
        .is_ok_and(|result| result.is_ok());
        checks.push(VerifyCheck {
            name: "remote-endpoint".into(),
            passed: reachable,
            detail: if reachable {
                format!("SoapyRemote endpoint reachable at {endpoint}")
            } else {
                format!("SoapyRemote endpoint unreachable at {endpoint}")
            },
        });
    }
    let passed = checks.iter().all(|c| c.passed);
    (StatusCode::OK, Json(VerifyResponse { passed, checks })).into_response()
}

fn remote_endpoint(device: &str) -> Option<(String, u16)> {
    let marker = "remote=tcp://";
    let value = device.split(marker).nth(1)?.split(',').next()?;
    let (host, port) = value.rsplit_once(':')?;
    Some((host.trim_matches(['[', ']']).to_owned(), port.parse().ok()?))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReceiverInput {
    label: String,
    driver: ReceiverDriver,
    #[serde(default)]
    serial: String,
    center_frequency_hz: Option<u64>,
    sample_rate_hz: Option<u32>,
    gain_db: Option<f32>,
    #[serde(default)]
    ppm: f32,
}

fn receiver_from_input(input: ReceiverInput, id: uuid::Uuid) -> Receiver {
    Receiver {
        id,
        label: input.label,
        driver: input.driver,
        serial: input.serial,
        state: ReceiverState::Stopped,
        center_frequency_hz: input.center_frequency_hz,
        sample_rate_hz: input.sample_rate_hz,
        gain_db: input.gain_db,
        ppm: input.ppm,
        capabilities: ReceiverCapabilities {
            minimum_frequency_hz: 1_000_000,
            maximum_frequency_hz: 2_000_000_000,
            sample_rates_hz: vec![2_000_000, 2_048_000, 2_400_000],
            maximum_bandwidth_hz: 2_000_000,
            supports_agc: true,
            gain_elements: vec!["LNA".into(), "VGA".into()],
        },
        health: ReceiverHealth {
            signal_dbfs: -120.0,
            noise_dbfs: -120.0,
            frequency_error_hz: 0.0,
            dropped_samples: 0,
            updated_at: chrono::Utc::now(),
        },
    }
}

fn persist_receivers(state: &Arc<AppState>) {
    let snapshot = state
        .receivers
        .read()
        .expect("receiver lock poisoned")
        .clone();
    if let Ok(document) = serde_json::to_vec_pretty(&snapshot) {
        if let Err(error) = crate::state::atomic_write(&state.receivers_path, &document) {
            tracing::warn!(%error, "receiver profile file persistence failed");
        }
    }
    if let Some(sender) = state
        .persistence
        .read()
        .expect("persistence lock poisoned")
        .clone()
    {
        let _ = sender.send(crate::persistence::Command::Receivers(snapshot));
    }
}

fn valid_analog_tone(value: &str) -> bool {
    let normalized = value.trim().to_ascii_uppercase();
    if normalized == "NONE" {
        return true;
    }
    if let Some(dcs) = normalized.strip_prefix('D') {
        let digits = dcs
            .strip_suffix('N')
            .or_else(|| dcs.strip_suffix('I'))
            .unwrap_or(dcs);
        return digits.len() == 3 && digits.chars().all(|digit| ('0'..='7').contains(&digit));
    }
    normalized
        .parse::<f32>()
        .map(|hz| (50.0..=300.0).contains(&hz))
        .unwrap_or(false)
}

async fn create_receiver(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<ReceiverInput>,
) -> Response {
    if !admin_allowed(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    if input.label.trim().is_empty() {
        return (StatusCode::BAD_REQUEST, "label is required").into_response();
    }
    let receiver = receiver_from_input(input, uuid::Uuid::new_v4());
    state
        .receivers
        .write()
        .expect("receiver lock poisoned")
        .push(receiver.clone());
    persist_receivers(&state);
    state.audit("receiver.create", "receiver", receiver.id.to_string());
    (StatusCode::CREATED, Json(receiver)).into_response()
}

async fn update_receiver(
    State(state): State<Arc<AppState>>,
    Path(id): Path<uuid::Uuid>,
    headers: HeaderMap,
    Json(input): Json<ReceiverInput>,
) -> Response {
    if !admin_allowed(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let updated = {
        let mut receivers = state.receivers.write().expect("receiver lock poisoned");
        let Some(existing) = receivers.iter_mut().find(|receiver| receiver.id == id) else {
            return StatusCode::NOT_FOUND.into_response();
        };
        let state_value = existing.state;
        let mut updated = receiver_from_input(input, id);
        updated.state = state_value;
        *existing = updated.clone();
        updated
    };
    persist_receivers(&state);
    state.audit("receiver.update", "receiver", id.to_string());
    (StatusCode::OK, Json(updated)).into_response()
}

async fn delete_receiver(
    State(state): State<Arc<AppState>>,
    Path(id): Path<uuid::Uuid>,
    headers: HeaderMap,
) -> StatusCode {
    if !admin_allowed(&state, &headers) {
        return StatusCode::UNAUTHORIZED;
    }
    let removed = {
        let mut receivers = state.receivers.write().expect("receiver lock poisoned");
        let before = receivers.len();
        receivers.retain(|receiver| receiver.id != id);
        receivers.len() != before
    };
    if !removed {
        return StatusCode::NOT_FOUND;
    }
    persist_receivers(&state);
    let _ = state
        .receiver_commands
        .send(crate::state::ReceiverCommand::Stop(id));
    state.audit("receiver.delete", "receiver", id.to_string());
    StatusCode::NO_CONTENT
}

async fn receiver_action(
    State(state): State<Arc<AppState>>,
    Path(id): Path<uuid::Uuid>,
    headers: HeaderMap,
    action: trunkscope_domain::ReceiverState,
) -> Response {
    if !admin_allowed(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let mut receivers = state.receivers.write().expect("receiver lock poisoned");
    let Some(receiver) = receivers.iter_mut().find(|receiver| receiver.id == id) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    receiver.state = action;
    receiver.health.updated_at = chrono::Utc::now();
    let command = match action {
        trunkscope_domain::ReceiverState::Probing => crate::state::ReceiverCommand::Probe(id),
        trunkscope_domain::ReceiverState::Monitoring => crate::state::ReceiverCommand::Start(id),
        trunkscope_domain::ReceiverState::Stopped => crate::state::ReceiverCommand::Stop(id),
        _ => crate::state::ReceiverCommand::Restart(id),
    };
    let _ = state.receiver_commands.send(command);
    (StatusCode::OK, Json(receiver.clone())).into_response()
}

async fn receiver_probe(
    State(state): State<Arc<AppState>>,
    Path(id): Path<uuid::Uuid>,
    headers: HeaderMap,
) -> Response {
    if !admin_allowed(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let device = state
        .receivers
        .read()
        .ok()
        .and_then(|items| items.iter().find(|r| r.id == id).cloned());
    let Some(device) = device else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let executable = std::env::var("TRUNKSCOPE_RADIOD_PATH")
        .unwrap_or_else(|_| "/usr/local/bin/trunkscope-radiod".into());
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(15),
        tokio::process::Command::new(executable)
            .arg("--capabilities")
            .arg("--device")
            .arg(&device.serial)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output(),
    )
    .await;
    let Ok(Ok(output)) = output else {
        return (
            StatusCode::GATEWAY_TIMEOUT,
            "receiver capability probe timed out",
        )
            .into_response();
    };
    if !output.status.success() {
        return (
            StatusCode::BAD_GATEWAY,
            String::from_utf8_lossy(&output.stderr).to_string(),
        )
            .into_response();
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let Some(line) = stdout
        .lines()
        .find(|line| line.contains("\"type\":\"capabilities\""))
    else {
        return (StatusCode::BAD_GATEWAY, "receiver returned no capabilities").into_response();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
        return (StatusCode::BAD_GATEWAY, "invalid capability response").into_response();
    };
    let mut receivers = state.receivers.write().expect("receiver lock poisoned");
    let Some(updated) = receivers.iter_mut().find(|r| r.id == id) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if let Some(range) = value
        .get("frequencyRanges")
        .and_then(|v| v.as_array())
        .and_then(|v| v.first())
        .and_then(|v| v.as_array())
    {
        if range.len() >= 2 {
            updated.capabilities.minimum_frequency_hz =
                range[0].as_f64().unwrap_or(0.0).max(0.0) as u64;
            updated.capabilities.maximum_frequency_hz =
                range[1].as_f64().unwrap_or(0.0).max(0.0) as u64;
        }
    }
    if let Some(ranges) = value.get("sampleRateRanges").and_then(|v| v.as_array()) {
        updated.capabilities.sample_rates_hz = ranges
            .iter()
            .filter_map(|r| r.as_array())
            .filter_map(|r| r.first().and_then(|v| v.as_f64()))
            .map(|v| v as u32)
            .collect();
    }
    if let Some(range) = value
        .get("bandwidthRanges")
        .and_then(|v| v.as_array())
        .and_then(|v| v.last())
        .and_then(|v| v.as_array())
        .and_then(|v| v.get(1))
        .and_then(|v| v.as_f64())
    {
        updated.capabilities.maximum_bandwidth_hz = range as u32;
    }
    updated.capabilities.supports_agc = value
        .get("supportsAgc")
        .and_then(|v| v.as_bool())
        .unwrap_or(updated.capabilities.supports_agc);
    updated.capabilities.gain_elements = value
        .get("gainElements")
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|v| v.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default();
    updated.state = ReceiverState::Ready;
    let response = updated.clone();
    drop(receivers);
    persist_receivers(&state);
    state.audit("receiver.probe", "receiver", id.to_string());
    (StatusCode::OK, Json(response)).into_response()
}

async fn receiver_start(
    State(state): State<Arc<AppState>>,
    Path(id): Path<uuid::Uuid>,
    headers: HeaderMap,
) -> Response {
    receiver_action(
        State(state),
        Path(id),
        headers,
        trunkscope_domain::ReceiverState::Monitoring,
    )
    .await
}

async fn receiver_stop(
    State(state): State<Arc<AppState>>,
    Path(id): Path<uuid::Uuid>,
    headers: HeaderMap,
) -> Response {
    receiver_action(
        State(state),
        Path(id),
        headers,
        trunkscope_domain::ReceiverState::Stopped,
    )
    .await
}

async fn receiver_restart(
    State(state): State<Arc<AppState>>,
    Path(id): Path<uuid::Uuid>,
    headers: HeaderMap,
) -> Response {
    receiver_action(
        State(state),
        Path(id),
        headers,
        trunkscope_domain::ReceiverState::Probing,
    )
    .await
}

fn optional_http_url(url: &str) -> bool {
    let trimmed = url.trim();
    trimmed.is_empty() || trimmed.starts_with("http://") || trimmed.starts_with("https://")
}

fn admin_allowed(state: &AppState, headers: &HeaderMap) -> bool {
    crate::auth::admin_accessible(state, headers)
}

#[derive(Deserialize)]
struct CallQuery {
    limit: Option<usize>,
}

async fn calls(
    State(state): State<Arc<AppState>>,
    Query(query): Query<CallQuery>,
) -> Json<Vec<Call>> {
    let limit = query.limit.unwrap_or(50).clamp(1, 200);
    Json(
        state
            .calls
            .read()
            .expect("calls lock poisoned")
            .iter()
            .take(limit)
            .cloned()
            .collect(),
    )
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct IncidentThread {
    key: String,
    system_name: String,
    talkgroup_id: u32,
    talkgroup_label: String,
    category: String,
    severity: u8,
    activity_score: u32,
    call_count: usize,
    first_seen: chrono::DateTime<chrono::Utc>,
    last_seen: chrono::DateTime<chrono::Utc>,
    radio_ids: Vec<u32>,
    locations: Vec<trunkscope_domain::IncidentLocation>,
    location_hints: Vec<String>,
    excerpts: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OperationsSummary {
    hours: u32,
    generated_at: chrono::DateTime<chrono::Utc>,
    call_count: usize,
    active_thread_count: usize,
    headline: String,
    ai_summary: Option<String>,
    ai_summary_status: String,
    threads: Vec<IncidentThread>,
}

async fn generate_operations_ai_summary(state: &AppState, hours: u32, threads: &[IncidentThread]) -> (Option<String>, String) {
    let settings = state.settings.read().expect("settings lock poisoned").clone();
    if !settings.ai_enabled { return (None, "disabled".into()); }
    if settings.effective_summary_url().is_none() {
        return (None, "provider-unconfigured".into());
    }
    let mut context = String::new();
    for thread in threads.iter().take(12) {
        context.push_str(&format!("Site/system: {}; channel plan: {}; calls: {}; severity: {}/5; excerpts: {}\n", thread.system_name, thread.talkgroup_label, thread.call_count, thread.severity, thread.excerpts.join(" | ")));
        if context.len() > 6000 { context.truncate(6000); break; }
    }
    if context.is_empty() { return (Some(format!("No radio activity was recorded in the last {hours} hours.")), "generated".into()); }
    let prompt = format!("Write a concise factual radio-operations brief (maximum 120 words) for the last {hours} hours. Group related activity, mention only details supported by the excerpts, call out notable incidents and locations, and say when there is not enough information. Do not invent names, addresses, or outcomes.\n\n{context}");
    match crate::providers::summarize(&crate::providers::http_client(), &settings, &context, &prompt).await {
        Ok(text) if !text.trim().is_empty() => (Some(text), "generated".into()),
        Ok(_) => (None, "provider-invalid-response".into()),
        Err(_) => (None, "provider-unavailable".into()),
    }
}

async fn operations_summary(
    State(state): State<Arc<AppState>>,
    Query(query): Query<std::collections::HashMap<String, String>>,
) -> Json<OperationsSummary> {
    let hours = query
        .get("hours")
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or(4)
        .clamp(1, 24);
    let cutoff = chrono::Utc::now() - chrono::Duration::hours(hours as i64);
    let calls: Vec<Call> = state
        .calls
        .read()
        .expect("calls lock poisoned")
        .iter()
        .filter(|call| call.started_at >= cutoff)
        .cloned()
        .collect();
    let mut grouped: std::collections::HashMap<String, IncidentThread> =
        std::collections::HashMap::new();
    for call in &calls {
        // The decoder emits short segments; bucket adjacent traffic into a
        // Keep rapid dispatch/reply traffic together in a one-minute
        // operator-facing exchange while retaining every original call.
        let key = format!(
            "{}:{}:{}",
            call.system_id,
            call.talkgroup_id,
            call.started_at.timestamp() / 60
        );
        let entry = grouped
            .entry(key.clone())
            .or_insert_with(|| IncidentThread {
                key,
                system_name: call.system_name.clone(),
                talkgroup_id: call.talkgroup_id,
                talkgroup_label: call.talkgroup_label.clone(),
                category: call.category.clone(),
                severity: activity_severity(
                    &call.category,
                    call.transcript.as_deref().or(call.summary.as_deref()),
                ),
                activity_score: 0,
                call_count: 0,
                first_seen: call.started_at,
                last_seen: call.ended_at.unwrap_or(call.started_at),
                radio_ids: Vec::new(),
                locations: Vec::new(),
                location_hints: Vec::new(),
                excerpts: Vec::new(),
            });
        entry.call_count += 1;
        entry.first_seen = entry.first_seen.min(call.started_at);
        entry.last_seen = entry
            .last_seen
            .max(call.ended_at.unwrap_or(call.started_at));
        entry.severity = entry.severity.max(activity_severity(
            &call.category,
            call.transcript.as_deref().or(call.summary.as_deref()),
        ));
        if let Some(radio_id) = call.source_radio_id {
            if !entry.radio_ids.contains(&radio_id) {
                entry.radio_ids.push(radio_id);
            }
        }
        if let Some(location) = call.location.clone() {
            if !entry
                .locations
                .iter()
                .any(|known| known.label == location.label)
            {
                entry.locations.push(location);
            }
        }
        if let Some(transcript) = call.transcript.as_deref() {
            for hint in extract_location_hints(transcript) {
                if entry.location_hints.len() < 5 && !entry.location_hints.contains(&hint) {
                    entry.location_hints.push(hint);
                }
            }
        }
        if let Some(text) = call.summary.as_ref().or(call.transcript.as_ref()) {
            if !text.trim().is_empty() && entry.excerpts.len() < 3 {
                entry.excerpts.push(text.trim().to_string());
            }
        }
        entry.activity_score = entry.severity as u32 * 100
            + entry.call_count as u32 * 5
            + entry.radio_ids.len() as u32 * 3;
    }
    let mut threads: Vec<_> = grouped.into_values().collect();
    threads.sort_by_key(|thread| {
        (
            std::cmp::Reverse(thread.severity),
            std::cmp::Reverse(thread.last_seen),
        )
    });
    let active_thread_count = threads
        .iter()
        .filter(|thread| thread.last_seen >= cutoff)
        .count();
    let headline = if calls.is_empty() {
        format!("No calls recorded in the last {hours} hours.")
    } else {
        format!(
            "{} calls across {} incident threads in the last {} hours.",
            calls.len(),
            threads.len(),
            hours
        )
    };
    let (ai_summary, ai_summary_status) = generate_operations_ai_summary(&state, hours, &threads).await;
    Json(OperationsSummary {
        hours,
        generated_at: chrono::Utc::now(),
        call_count: calls.len(),
        active_thread_count,
        headline,
        ai_summary,
        ai_summary_status,
        threads,
    })
}

async fn conversation_sessions(
    State(state): State<Arc<AppState>>,
) -> Json<Vec<trunkscope_domain::ConversationSession>> {
    Json(
        state
            .conversation_sessions
            .read()
            .expect("sessions lock poisoned")
            .clone(),
    )
}

async fn conversation_audio(
    State(state): State<Arc<AppState>>,
    Path(id): Path<uuid::Uuid>,
    headers: HeaderMap,
) -> Response {
    let expected = std::env::var("TRUNKSCOPE_AUDIO_TOKEN").unwrap_or_default();
    if !crate::auth::admin_accessible(&state, &headers)
        && (expected.is_empty()
            || headers.get("authorization").and_then(|v| v.to_str().ok())
                != Some(&format!("Bearer {expected}")))
    {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let Some(session) = state
        .conversation_sessions
        .read()
        .ok()
        .and_then(|sessions| sessions.iter().find(|session| session.id == id).cloned())
    else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let root = std::path::PathBuf::from(
        std::env::var("TRUNKSCOPE_CALLS_PATH")
            .unwrap_or_else(|_| "/var/lib/trunkscope/calls".into()),
    );
    let mut object_keys = session.audio_keys.clone();
    if object_keys.is_empty() {
        object_keys = state
            .calls
            .read()
            .ok()
            .map(|calls| {
                session
                    .call_ids
                    .iter()
                    .filter_map(|call_id| {
                        calls
                            .iter()
                            .find(|call| call.id == *call_id)
                            .and_then(|call| {
                                call.audio.as_ref().map(|audio| audio.object_key.clone())
                            })
                    })
                    .collect()
            })
            .unwrap_or_default();
    }
    let mut wavs = Vec::new();
    for object_key in object_keys {
        let relative = object_key.trim_start_matches("/var/lib/trunkscope/calls/");
        let path = root.join(relative);
        if !path.starts_with(&root) {
            continue;
        }
        if let Ok(bytes) = tokio::fs::read(path).await {
            wavs.push(bytes);
        }
    }
    match merge_wavs(&wavs) {
        Some(bytes) => Response::builder()
            .status(StatusCode::OK)
            .header(axum::http::header::CONTENT_TYPE, "audio/wav")
            .header(axum::http::header::CONTENT_LENGTH, bytes.len())
            .body(axum::body::Body::from(bytes))
            .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response()),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn confirm_session_location(
    State(state): State<Arc<AppState>>,
    Path(id): Path<uuid::Uuid>,
    headers: HeaderMap,
    Json(location): Json<trunkscope_domain::IncidentLocation>,
) -> Response {
    if !admin_allowed(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let call_ids = state
        .conversation_sessions
        .read()
        .ok()
        .and_then(|sessions| {
            sessions
                .iter()
                .find(|session| session.id == id)
                .map(|session| session.call_ids.clone())
        });
    let Some(call_ids) = call_ids else {
        return StatusCode::NOT_FOUND.into_response();
    };
    for call_id in call_ids {
        state.set_call_location(call_id, location.clone());
    }
    StatusCode::NO_CONTENT.into_response()
}

async fn update_call_location(
    State(state): State<Arc<AppState>>,
    Path(id): Path<uuid::Uuid>,
    headers: HeaderMap,
    Json(location): Json<trunkscope_domain::IncidentLocation>,
) -> Response {
    if !admin_allowed(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let exists = state
        .calls
        .read()
        .expect("calls lock poisoned")
        .iter()
        .any(|call| call.id == id);
    if !exists {
        return StatusCode::NOT_FOUND.into_response();
    }
    state.set_call_location(id, location);
    StatusCode::NO_CONTENT.into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PurgeCallsRequest {
    #[serde(default)]
    hours: Option<u32>,
    #[serde(default)]
    category: Option<String>,
    #[serde(default)]
    talkgroup_id: Option<u32>,
    #[serde(default)]
    system_id: Option<uuid::Uuid>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PurgeCallsResponse {
    removed: usize,
}

async fn purge_calls(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<PurgeCallsRequest>,
) -> Response {
    if !admin_allowed(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let cutoff = request.hours.map(|hours| {
        chrono::Utc::now() - chrono::Duration::hours(hours.clamp(1, 24 * 365) as i64)
    });
    let category = request
        .category
        .as_deref()
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty());
    let mut removed = Vec::new();
    {
        let mut calls = state.calls.write().expect("calls lock poisoned");
        let retained: Vec<Call> = calls
            .drain(..)
            .filter(|call| {
                let matches = cutoff.is_none_or(|cutoff| call.started_at >= cutoff)
                    && category
                        .as_ref()
                        .is_none_or(|value| call.category.to_ascii_lowercase().contains(value))
                    && request
                        .talkgroup_id
                        .is_none_or(|talkgroup| call.talkgroup_id == talkgroup)
                    && request
                        .system_id
                        .is_none_or(|system_id| call.system_id == system_id);
                if matches {
                    removed.push(call.clone());
                    false
                } else {
                    true
                }
            })
            .collect();
        *calls = retained.into();
    }
    let count = removed.len();
    if count > 0 {
        crate::sqlite::delete_calls(&removed.iter().map(|call| call.id).collect::<Vec<_>>());
        *state.purge_undo.write().expect("purge undo lock poisoned") = Some(removed);
    }
    Json(PurgeCallsResponse { removed: count }).into_response()
}

async fn undo_purge_calls(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    if !admin_allowed(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let restored = state
        .purge_undo
        .write()
        .expect("purge undo lock poisoned")
        .take();
    let Some(restored) = restored else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let count = restored.len();
    {
        let mut calls = state.calls.write().expect("calls lock poisoned");
        calls.extend(restored.clone());
        let mut ordered: Vec<Call> = calls.drain(..).collect();
        ordered.sort_by_key(|call| std::cmp::Reverse(call.started_at));
        ordered.truncate(5000);
        calls.extend(ordered);
    }
    for call in restored {
        crate::sqlite::upsert_call(&call);
    }
    Json(PurgeCallsResponse { removed: count }).into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OperationsAskRequest {
    question: String,
    #[serde(default = "default_ask_hours")]
    hours: u32,
}

fn default_ask_hours() -> u32 {
    4
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OperationsAskResponse {
    answer: String,
    cited_call_ids: Vec<uuid::Uuid>,
    status: String,
}

async fn operations_ask(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<OperationsAskRequest>,
) -> Response {
    if !admin_allowed(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let question = request.question.trim();
    if question.is_empty() {
        return (StatusCode::BAD_REQUEST, "Question is required").into_response();
    }
    let hours = request.hours.clamp(1, 24);
    let cutoff = chrono::Utc::now() - chrono::Duration::hours(hours as i64);
    let calls: Vec<Call> = state
        .calls
        .read()
        .expect("calls lock poisoned")
        .iter()
        .filter(|call| call.started_at >= cutoff)
        .cloned()
        .collect();
    let mut context = String::new();
    let mut cited = Vec::new();
    for call in calls.iter().rev().take(40) {
        cited.push(call.id);
        context.push_str(&format!(
            "- {} {} {}: {}\n",
            call.started_at.to_rfc3339(),
            call.talkgroup_label,
            call.category,
            call.transcript
                .as_deref()
                .or(call.summary.as_deref())
                .unwrap_or("(no transcript)")
        ));
        if context.len() > 8000 {
            break;
        }
    }
    let settings = state.settings.read().expect("settings lock poisoned").clone();
    if !settings.ai_enabled {
        return Json(OperationsAskResponse {
            answer: "AI is disabled in settings.".into(),
            cited_call_ids: cited,
            status: "disabled".into(),
        })
        .into_response();
    }
    if settings.effective_summary_url().is_none() {
        return Json(OperationsAskResponse {
            answer: "Summary provider URL is not configured.".into(),
            cited_call_ids: cited,
            status: "provider-unconfigured".into(),
        })
        .into_response();
    };
    let prompt = format!(
        "You are a radio operations assistant. Answer the operator question using only the call history below. Cite talkgroups and times when possible. If the history does not support an answer, say so.\n\nQuestion: {question}\n\nHistory:\n{context}"
    );
    let answer = match crate::providers::summarize(
        &crate::providers::http_client(),
        &settings,
        &context,
        &prompt,
    )
    .await
    {
        Ok(text) if !text.trim().is_empty() => text,
        Ok(_) => "Summary provider returned an invalid response.".into(),
        Err(_) => "Summary provider is unavailable.".into(),
    };
    let status = if answer.contains("unavailable") || answer.contains("invalid") {
        "provider-unavailable".into()
    } else {
        "generated".into()
    };
    Json(OperationsAskResponse {
        answer,
        cited_call_ids: cited,
        status,
    })
    .into_response()
}

async fn rdio_call_upload(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: String,
) -> StatusCode {
    let settings = state.settings.read().expect("settings lock poisoned");
    if !settings.compat_ingest_enabled {
        drop(settings);
        return StatusCode::NOT_FOUND;
    }
    drop(settings);
    let payload = headers
        .get("x-sidecar-path")
        .and_then(|value| value.to_str().ok())
        .map(std::path::PathBuf::from)
        .and_then(|path| crate::file_ingest::normalize_sidecar(&body, &path))
        .unwrap_or(body);
    if crate::decoder::ingest_status_payload(&state, &payload) {
        StatusCode::NO_CONTENT
    } else {
        StatusCode::BAD_REQUEST
    }
}

fn merge_wavs(wavs: &[Vec<u8>]) -> Option<Vec<u8>> {
    let first = wavs.first()?.clone();
    if first.len() < 12 || &first[0..4] != b"RIFF" || &first[8..12] != b"WAVE" {
        return None;
    }
    let (data_start, data_size_offset) = wav_data_offsets(&first)?;
    let mut output = first[..data_start].to_vec();
    let mut pcm = Vec::new();
    for wav in wavs {
        let (start, _) = wav_data_offsets(wav)?;
        let size = u32::from_le_bytes(wav[start - 4..start].try_into().ok()?) as usize;
        pcm.extend_from_slice(wav.get(start..start + size.min(wav.len().saturating_sub(start)))?);
    }
    output.extend_from_slice(&pcm);
    let size = u32::try_from(pcm.len()).ok()?;
    output[data_size_offset..data_size_offset + 4].copy_from_slice(&size.to_le_bytes());
    let riff_size = u32::try_from(output.len().saturating_sub(8)).ok()?;
    output[4..8].copy_from_slice(&riff_size.to_le_bytes());
    Some(output)
}

fn wav_data_offsets(wav: &[u8]) -> Option<(usize, usize)> {
    let mut offset = 12;
    while offset + 8 <= wav.len() {
        let size = u32::from_le_bytes(wav[offset + 4..offset + 8].try_into().ok()?) as usize;
        if &wav[offset..offset + 4] == b"data" {
            return Some((offset + 8, offset + 4));
        }
        offset = offset.checked_add(8 + size + (size & 1))?;
    }
    None
}

async fn discord_status(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let settings = state.settings.read().expect("settings lock poisoned");
    Json(serde_json::json!({
        "configured": settings.effective_discord_webhook_url().is_some(),
        "keywordRules": settings.discord_keyword_rules.len(),
        "mode": "finalized-summary"
    }))
}

async fn geocoder_status(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let settings = state.settings.read().expect("settings lock poisoned");
    Json(serde_json::json!({
        "configured": settings.effective_geocoder_url().is_some(),
        "provider": settings.geocoder_provider,
        "mode": "local-evidence-first"
    }))
}

async fn transcribe_status(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let settings = state.settings.read().expect("settings lock poisoned");
    Json(serde_json::json!({
        "configured": crate::providers::effective_transcribe_url(&settings).is_some(),
        "provider": settings.transcribe_provider,
        "model": settings.transcribe_model
    }))
}

async fn summary_status(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let settings = state.settings.read().expect("settings lock poisoned");
    Json(serde_json::json!({
        "configured": settings.effective_summary_url().is_some(),
        "provider": settings.summary_provider,
        "model": settings.summary_model
    }))
}

async fn transcribe_test(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    if !admin_allowed(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let settings = state.settings.read().expect("settings lock poisoned").clone();
    match crate::providers::test_transcribe(&settings).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => (StatusCode::BAD_GATEWAY, error).into_response(),
    }
}

async fn summary_test(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    if !admin_allowed(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let settings = state.settings.read().expect("settings lock poisoned").clone();
    match crate::providers::test_summary(&settings).await {
        Ok(_) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => (StatusCode::BAD_GATEWAY, error).into_response(),
    }
}

async fn geocoder_test(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    if !admin_allowed(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let settings = state.settings.read().expect("settings lock poisoned").clone();
    match crate::providers::test_geocoder(&settings).await {
        Ok(_) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => (StatusCode::BAD_GATEWAY, error).into_response(),
    }
}

async fn discord_test(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    if !admin_allowed(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let webhook = state
        .settings
        .read()
        .expect("settings lock poisoned")
        .effective_discord_webhook_url();
    let Some(webhook) = webhook else {
        return (
            StatusCode::NOT_IMPLEMENTED,
            "Discord webhook is not configured",
        )
            .into_response();
    };
    match reqwest::Client::new().post(webhook).json(&serde_json::json!({"username":"TrunkScope","content":"TrunkScope Discord integration test","allowed_mentions":{"parse":[]}})).send().await {
        Ok(response) if response.status().is_success() => StatusCode::NO_CONTENT.into_response(),
        Ok(response) => (StatusCode::BAD_GATEWAY, format!("Discord returned {}", response.status())).into_response(),
        Err(error) => (StatusCode::BAD_GATEWAY, error.to_string()).into_response(),
    }
}

fn activity_severity(category: &str, text: Option<&str>) -> u8 {
    let haystack = format!("{} {}", category, text.unwrap_or_default()).to_ascii_lowercase();
    if [
        "mayday",
        "officer down",
        "structure fire",
        "rescue",
        "pursuit",
    ]
    .iter()
    .any(|term| haystack.contains(term))
    {
        return 5;
    }
    if ["fire", "ems", "medical", "ambulance"]
        .iter()
        .any(|term| haystack.contains(term))
    {
        return 4;
    }
    if ["law", "police", "sheriff", "traffic", "crash", "accident"]
        .iter()
        .any(|term| haystack.contains(term))
    {
        return 3;
    }
    if ["dispatch", "public works", "road"]
        .iter()
        .any(|term| haystack.contains(term))
    {
        return 2;
    }
    1
}

fn extract_location_hints(transcript: &str) -> Vec<String> {
    let lower = transcript.to_ascii_lowercase();
    let markers = [" at ", " near ", " on ", " intersection of ", " by "];
    markers
        .iter()
        .filter_map(|marker| {
            let start = lower.find(marker)? + marker.len();
            let tail = transcript[start..].split(['.', ',', ';']).next()?.trim();
            if tail.len() < 3 || tail.len() > 80 {
                None
            } else {
                Some(tail.to_string())
            }
        })
        .collect()
}

async fn audio(
    State(state): State<Arc<AppState>>,
    Path(id): Path<uuid::Uuid>,
    headers: axum::http::HeaderMap,
) -> Response {
    let expected = std::env::var("TRUNKSCOPE_AUDIO_TOKEN").unwrap_or_default();
    let provided = headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    // In an explicitly configured appliance, require the bearer token or an
    // authenticated session. A blank token is the documented first-run mode;
    // it must not accidentally make every local recording unplayable.
    if !crate::auth::admin_accessible(&state, &headers)
        && (expected.is_empty() || provided != format!("Bearer {expected}"))
    {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let Some(asset) = state.calls.read().ok().and_then(|calls| {
        calls
            .iter()
            .find(|call| call.id == id)
            .and_then(|call| call.audio.clone())
    }) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let root = std::path::PathBuf::from(
        std::env::var("TRUNKSCOPE_CALLS_PATH")
            .unwrap_or_else(|_| "/var/lib/trunkscope/calls".into()),
    );
    let relative = asset
        .object_key
        .trim_start_matches("/var/lib/trunkscope/calls/");
    let path = root.join(relative);
    if !path.starts_with(&root) {
        return StatusCode::NOT_FOUND.into_response();
    }
    match tokio::fs::read(path).await {
        Ok(bytes) => {
            let total = bytes.len();
            let range = headers
                .get(axum::http::header::RANGE)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| parse_range(value, total));
            let (status, body, content_range) = if let Some((start, end)) = range {
                (
                    StatusCode::PARTIAL_CONTENT,
                    bytes[start..=end].to_vec(),
                    Some(format!("bytes {start}-{end}/{total}")),
                )
            } else {
                (StatusCode::OK, bytes, None)
            };
            let mut response = Response::builder()
                .status(status)
                .header(axum::http::header::CONTENT_TYPE, asset.content_type)
                .header(axum::http::header::CONTENT_LENGTH, body.len())
                .header(axum::http::header::ACCEPT_RANGES, "bytes");
            if let Some(value) = content_range {
                response = response.header(axum::http::header::CONTENT_RANGE, value);
            }
            response
                .body(axum::body::Body::from(body))
                .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
        }
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

fn parse_range(value: &str, total: usize) -> Option<(usize, usize)> {
    let range = value.strip_prefix("bytes=")?.split(',').next()?.trim();
    let (start, end) = range.split_once('-')?;
    if start.is_empty() {
        let length = end.parse::<usize>().ok()?.min(total);
        return (length > 0).then_some((total - length, total - 1));
    }
    let start = start.parse::<usize>().ok()?;
    if start >= total {
        return None;
    }
    let end = if end.is_empty() {
        total - 1
    } else {
        end.parse::<usize>().ok()?.min(total - 1)
    };
    (start <= end).then_some((start, end))
}

async fn public_policy(State(state): State<Arc<AppState>>) -> Json<PublicationPolicy> {
    Json(
        state
            .public_policy
            .read()
            .expect("policy lock poisoned")
            .clone(),
    )
}

async fn save_public_policy(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(policy): Json<PublicationPolicy>,
) -> (StatusCode, Json<PublicationPolicy>) {
    if !admin_allowed(&state, &headers) {
        return (StatusCode::UNAUTHORIZED, Json(policy));
    }
    if policy.enabled && policy.allowed_talkgroups.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(policy));
    }
    let mut settings = state.settings.write().expect("settings lock poisoned");
    settings.public_feed_enabled = policy.enabled;
    settings.public_allowed_talkgroups = policy.allowed_talkgroups.clone();
    settings.public_feed_delay_seconds = policy.delay_seconds;
    settings.expose_transcripts = policy.expose_transcripts;
    settings.expose_radio_ids = policy.expose_radio_ids;
    settings.expose_precise_locations = policy.expose_precise_locations;
    if let Ok(serialized) = serde_json::to_vec_pretty(&*settings) {
        if let Some(parent) = state.settings_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = crate::state::atomic_write(&state.settings_path, &serialized);
    }
    if let Some(sender) = state
        .persistence
        .read()
        .expect("persistence lock poisoned")
        .as_ref()
    {
        let _ = sender.send(crate::persistence::Command::Settings(settings.clone()));
    }
    *state.public_policy.write().expect("policy lock poisoned") = policy.clone();
    state.audit("policy.update", "public-policy", "default");
    (StatusCode::OK, Json(policy))
}

async fn systems(State(state): State<Arc<AppState>>) -> Json<Vec<SystemProfile>> {
    Json(state.systems.read().expect("systems lock poisoned").clone())
}

/// Return the currently imported talkgroup catalog. Trunk Recorder owns the
/// CSV format, so the API deliberately exposes a stable JSON projection while
/// preserving the raw import on disk for regeneration and backup.
async fn talkgroups(State(state): State<Arc<AppState>>) -> Json<Vec<Talkgroup>> {
    Json(
        state
            .talkgroups
            .read()
            .expect("talkgroup lock poisoned")
            .clone(),
    )
}

fn persist_talkgroups(state: &Arc<AppState>) {
    let items = state
        .talkgroups
        .read()
        .expect("talkgroup lock poisoned")
        .clone();
    if let Ok(document) = serde_json::to_vec_pretty(&items) {
        let _ = crate::state::atomic_write(&state.talkgroups_path, &document);
    }
}

fn regenerate_talkgroup_csv(state: &Arc<AppState>) {
    let root = std::env::var("TRUNKSCOPE_CALLS_PATH")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::path::PathBuf::from("/var/lib/trunkscope/calls"));
    let path = root.join("imported-talkgroups.csv");
    let items = state.talkgroups.read().expect("talkgroup lock poisoned");
    let mut csv = String::from("Decimal,Hex,Alpha Tag,Mode,Description,Tag,Category\n");
    for item in items.iter() {
        let escaped = |value: &str| format!("\"{}\"", value.replace('"', "\"\""));
        csv.push_str(&format!(
            "{},{:03X},{},D,{},{},{}\n",
            item.decimal_id,
            item.decimal_id,
            escaped(&item.alpha_tag),
            escaped(&item.description),
            escaped(&item.category),
            escaped(&item.category)
        ));
    }
    let _ = crate::state::atomic_write(&path, csv.as_bytes());
}

async fn save_talkgroup(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(mut item): Json<Talkgroup>,
) -> Response {
    if !admin_allowed(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    if item.id == uuid::Uuid::nil() {
        item.id = uuid::Uuid::new_v4();
    }
    if item.decimal_id == 0 || item.alpha_tag.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            "decimalId and alphaTag are required",
        )
            .into_response();
    }
    let mut items = state.talkgroups.write().expect("talkgroup lock poisoned");
    items.retain(|existing| existing.id != item.id);
    items.push(item.clone());
    drop(items);
    persist_talkgroups(&state);
    regenerate_talkgroup_csv(&state);
    write_decoder_config(&state);
    state.audit("talkgroup.saved", "talkgroup", item.id.to_string());
    Json(item).into_response()
}

async fn update_talkgroup(
    State(state): State<Arc<AppState>>,
    Path(id): Path<uuid::Uuid>,
    headers: HeaderMap,
    Json(mut item): Json<Talkgroup>,
) -> Response {
    if !admin_allowed(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    item.id = id;
    save_talkgroup(State(state), headers, Json(item)).await
}

async fn delete_talkgroup(
    State(state): State<Arc<AppState>>,
    Path(id): Path<uuid::Uuid>,
    headers: HeaderMap,
) -> StatusCode {
    if !admin_allowed(&state, &headers) {
        return StatusCode::UNAUTHORIZED;
    }
    let mut items = state.talkgroups.write().expect("talkgroup lock poisoned");
    let before = items.len();
    items.retain(|item| item.id != id);
    if items.len() == before {
        return StatusCode::NOT_FOUND;
    }
    drop(items);
    persist_talkgroups(&state);
    regenerate_talkgroup_csv(&state);
    write_decoder_config(&state);
    state.audit("talkgroup.deleted", "talkgroup", id.to_string());
    StatusCode::NO_CONTENT
}

async fn import_systems(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !admin_allowed(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let profiles: Vec<SystemProfile> = if headers
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.contains("text/csv"))
    {
        let Ok(csv) = String::from_utf8(body.to_vec()) else {
            return StatusCode::BAD_REQUEST.into_response();
        };
        crate::imports::parse_systems_csv(&csv)
    } else {
        let Ok(payload) = serde_json::from_slice::<serde_json::Value>(&body) else {
            return StatusCode::BAD_REQUEST.into_response();
        };
        if let Some(items) = payload.get("systems") {
            match serde_json::from_value(items.clone()) {
                Ok(value) => value,
                Err(_) => return StatusCode::BAD_REQUEST.into_response(),
            }
        } else if payload.is_array() {
            match serde_json::from_value(payload) {
                Ok(value) => value,
                Err(_) => return StatusCode::BAD_REQUEST.into_response(),
            }
        } else {
            match serde_json::from_value(payload) {
                Ok(profile) => vec![profile],
                Err(_) => return StatusCode::BAD_REQUEST.into_response(),
            }
        }
    };
    if profiles.is_empty() {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let mut imported = Vec::with_capacity(profiles.len());
    for mut profile in profiles {
        let is_p25 = profile.protocol.starts_with("p25");
        if profile.name.trim().is_empty()
            || (is_p25 && profile.control_channel_hz.unwrap_or_default() == 0)
            || (is_p25 && profile.nac.is_some_and(|nac| nac > 0xFFF))
            || (!is_p25 && profile.frequency_hz.unwrap_or_default() == 0)
        {
            return StatusCode::BAD_REQUEST.into_response();
        }
        if profile.id.is_nil() {
            profile.id = uuid::Uuid::new_v4();
        }
        profile.name = profile.name.trim().to_string();
        imported.push(profile);
    }
    {
        let mut systems = state.systems.write().expect("system lock poisoned");
        for profile in &imported {
            if let Some(existing) = systems.iter_mut().find(|item| item.id == profile.id) {
                *existing = profile.clone();
            } else {
                systems.push(profile.clone());
            }
        }
        if let Ok(serialized) = serde_json::to_vec_pretty(&*systems) {
            if let Some(parent) = state.systems_path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let _ = crate::state::atomic_write(&state.systems_path, &serialized);
        }
    }
    if let Some(sender) = state
        .persistence
        .read()
        .expect("persistence lock poisoned")
        .as_ref()
    {
        for profile in &imported {
            let _ = sender.send(crate::persistence::Command::System(profile.clone()));
        }
    }
    write_decoder_config(&state);
    (StatusCode::CREATED, Json(imported)).into_response()
}

async fn import_talkgroups(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<std::collections::HashMap<String, String>>,
    body: Bytes,
) -> Response {
    if !admin_allowed(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let csv = String::from_utf8(body.to_vec()).ok();
    let Some(csv) = csv else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let system_id = query
        .get("systemId")
        .and_then(|value| uuid::Uuid::parse_str(value).ok())
        .or_else(|| {
            state
                .systems
                .read()
                .expect("systems lock poisoned")
                .first()
                .map(|system| system.id)
        })
        .unwrap_or_default();
    let merge = query
        .get("merge")
        .map(|value| value == "true" || value == "1")
        .unwrap_or(false);
    let existing = state
        .talkgroups
        .read()
        .expect("talkgroup lock poisoned")
        .clone();
    let Some(result) = crate::imports::parse_talkgroup_csv(
        &csv,
        &crate::imports::TalkgroupImportOptions { system_id, merge },
        &existing,
    ) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let root = std::env::var("TRUNKSCOPE_CALLS_PATH")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::path::PathBuf::from("/var/lib/trunkscope/calls"));
    let path = root.join("imported-talkgroups.csv");
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if crate::state::atomic_write(&path, csv.as_bytes()).is_err() {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
    if !result.imported.is_empty() {
        *state.talkgroups.write().expect("talkgroup lock poisoned") = result.imported;
        persist_talkgroups(&state);
    }
    write_decoder_config(&state);
    Json(serde_json::json!({
        "imported": true,
        "rows": result.rows,
        "merge": merge,
        "systemId": system_id,
        "path": "imported-talkgroups.csv"
    }))
    .into_response()
}

async fn preview_talkgroups(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !admin_allowed(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let Ok(csv) = String::from_utf8(body.to_vec()) else {
        return (StatusCode::BAD_REQUEST, "CSV must be UTF-8").into_response();
    };
    let mut lines = csv.lines().filter(|line| !line.trim().is_empty());
    let Some(header) = lines.next() else {
        return (StatusCode::BAD_REQUEST, "CSV is empty").into_response();
    };
    let lower = header.to_ascii_lowercase();
    if !lower.contains("decimal") || !lower.contains("alpha") {
        return (
            StatusCode::BAD_REQUEST,
            "CSV needs Decimal and Alpha Tag columns",
        )
            .into_response();
    }
    let rows: Vec<serde_json::Value> = lines
        .take(10)
        .map(|line| serde_json::json!({"raw": line}))
        .collect();
    let count = csv
        .lines()
        .skip(1)
        .filter(|line| !line.trim().is_empty())
        .count();
    (StatusCode::OK, Json(serde_json::json!({"valid": count > 0, "rows": count, "sample": rows, "requiresConfirmation": true}))).into_response()
}

async fn import_sites(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<std::collections::HashMap<String, String>>,
    body: Bytes,
) -> Response {
    if !admin_allowed(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let Ok(csv) = String::from_utf8(body.to_vec()) else {
        return (StatusCode::BAD_REQUEST, "CSV must be UTF-8").into_response();
    };
    let Some(result) = crate::imports::parse_site_csv(&csv) else {
        return (StatusCode::BAD_REQUEST, "Invalid site CSV").into_response();
    };
    let system_id = query
        .get("systemId")
        .and_then(|value| uuid::Uuid::parse_str(value).ok())
        .unwrap_or_default();
    let merge = query
        .get("merge")
        .map(|value| value == "true" || value == "1")
        .unwrap_or(false);
    let mut systems = state.systems.write().expect("systems lock poisoned");
    let Some(system) = systems.iter_mut().find(|system| system.id == system_id) else {
        return (StatusCode::NOT_FOUND, "System not found").into_response();
    };
    if merge {
        for site in result.sites {
            if let Some(existing) = system.sites.iter_mut().find(|item| item.name == site.name) {
                *existing = site;
            } else {
                system.sites.push(site);
            }
        }
    } else {
        system.sites = result.sites;
    }
    if let Ok(document) = serde_json::to_vec_pretty(&*systems) {
        let _ = crate::state::atomic_write(&state.systems_path, &document);
    }
    drop(systems);
    write_decoder_config(&state);
    Json(serde_json::json!({
        "imported": true,
        "rows": result.rows,
        "systemId": system_id,
        "merge": merge
    }))
    .into_response()
}

async fn preview_sites(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !admin_allowed(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let Ok(csv) = String::from_utf8(body.to_vec()) else {
        return (StatusCode::BAD_REQUEST, "CSV must be UTF-8").into_response();
    };
    let Some(result) = crate::imports::parse_site_csv(&csv) else {
        return (StatusCode::BAD_REQUEST, "Invalid site CSV").into_response();
    };
    let sample: Vec<_> = result
        .sites
        .iter()
        .take(10)
        .map(|site| serde_json::json!({
            "name": site.name,
            "nac": site.nac,
            "controlChannelsHz": site.control_channels_hz,
            "voiceChannelsHz": site.voice_channels_hz
        }))
        .collect();
    (StatusCode::OK, Json(serde_json::json!({
        "valid": result.rows > 0,
        "rows": result.rows,
        "sample": sample,
        "requiresConfirmation": true
    })))
    .into_response()
}

async fn preview_systems(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !admin_allowed(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    if headers
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.contains("text/csv"))
    {
        let Ok(csv) = String::from_utf8(body.to_vec()) else {
            return (StatusCode::BAD_REQUEST, "CSV must be UTF-8").into_response();
        };
        let profiles = crate::imports::parse_systems_csv(&csv);
        return (
            StatusCode::OK,
            Json(serde_json::json!({
                "valid": !profiles.is_empty(),
                "rows": profiles.len(),
                "preview": profiles,
                "requiresConfirmation": true
            })),
        )
            .into_response();
    }
    let Ok(payload) = serde_json::from_slice::<serde_json::Value>(&body) else {
        return (StatusCode::BAD_REQUEST, "Invalid JSON body").into_response();
    };
    let items = if payload.is_array() {
        payload.as_array().cloned().unwrap_or_default()
    } else if let Some(items) = payload.get("systems").and_then(|v| v.as_array()) {
        items.clone()
    } else {
        vec![payload]
    };
    if items.is_empty() {
        return (StatusCode::BAD_REQUEST, "No systems supplied").into_response();
    }
    let mut errors = Vec::new();
    for (index, item) in items.iter().enumerate() {
        let name = item.get("name").and_then(|v| v.as_str()).unwrap_or("");
        let protocol = item.get("protocol").and_then(|v| v.as_str()).unwrap_or("");
        let valid = !name.trim().is_empty()
            && ((protocol.starts_with("p25")
                && item
                    .get("controlChannelHz")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0)
                    > 0)
                || (!protocol.starts_with("p25")
                    && item
                        .get("frequencyHz")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0)
                        > 0));
        if !valid {
            errors.push(format!(
                "item {index}: name/protocol/frequency fields are invalid"
            ));
        }
    }
    (StatusCode::OK, Json(serde_json::json!({"valid": errors.is_empty(), "items": items.len(), "errors": errors, "requiresConfirmation": true}))).into_response()
}

async fn scan_lists(State(state): State<Arc<AppState>>) -> Json<Vec<ScanList>> {
    Json(
        state
            .scan_lists
            .read()
            .expect("scan list lock poisoned")
            .clone(),
    )
}

async fn update_scan_list(
    State(state): State<Arc<AppState>>,
    Path(id): Path<uuid::Uuid>,
    headers: HeaderMap,
    Json(mut list): Json<ScanList>,
) -> (StatusCode, Json<ScanList>) {
    list.id = id;
    save_scan_list(State(state), headers, Json(list)).await
}

async fn save_scan_list(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(mut list): Json<ScanList>,
) -> (StatusCode, Json<ScanList>) {
    if !admin_allowed(&state, &headers) {
        return (StatusCode::UNAUTHORIZED, Json(list));
    }
    if list.name.trim().is_empty()
        || list.channels.iter().any(|channel| {
            channel.frequency_hz == 0
                || channel.dwell_ms == 0
                || !matches!(channel.bandwidth_hz, 6250 | 12500 | 25000)
        })
    {
        return (StatusCode::BAD_REQUEST, Json(list));
    }
    if list.id.is_nil() {
        list.id = uuid::Uuid::new_v4();
    }
    list.name = list.name.trim().to_string();
    let mut lists = state.scan_lists.write().expect("scan list lock poisoned");
    if let Some(existing) = lists.iter_mut().find(|item| item.id == list.id) {
        *existing = list.clone();
    } else {
        lists.push(list.clone());
    }
    if let Ok(serialized) = serde_json::to_vec_pretty(&*lists) {
        if let Some(parent) = state.scan_lists_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = crate::state::atomic_write(&state.scan_lists_path, &serialized);
    }
    if let Some(sender) = state
        .persistence
        .read()
        .expect("persistence lock poisoned")
        .as_ref()
    {
        let _ = sender.send(crate::persistence::Command::ScanList(list.clone()));
    }
    (StatusCode::CREATED, Json(list))
}

async fn settings(State(state): State<Arc<AppState>>) -> Json<AppSettings> {
    Json(
        state
            .settings
            .read()
            .expect("settings lock poisoned")
            .clone(),
    )
}

async fn save_settings(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(settings): Json<AppSettings>,
) -> (StatusCode, Json<AppSettings>) {
    if !admin_allowed(&state, &headers) {
        return (StatusCode::UNAUTHORIZED, Json(settings));
    }
    if !(-90.0..=90.0).contains(&settings.home_latitude)
        || !(-180.0..=180.0).contains(&settings.home_longitude)
        || settings.home_label.trim().is_empty()
        || !matches!(
            settings.radio_mode.as_str(),
            "simulator" | "radiod" | "decoder"
        )
        || settings.radio_frequency_hz == 0
        || settings.radio_sample_rate_hz == 0
        || !matches!(
            settings.ai_profile.as_str(),
            "cpu-faster-whisper-small"
                | "cpu-whispercpp"
                | "gpu-faster-whisper"
                | "gpu-parakeet"
                | "gpu-qwen3"
                | "experimental-radio"
        )
        || !(settings.transcribe_url.is_empty()
            || settings.transcribe_url.starts_with("http://")
            || settings.transcribe_url.starts_with("https://"))
        || settings.public_feed_delay_seconds > 86_400
        || !(1..=60).contains(&settings.summary_refresh_minutes)
        || (settings.public_feed_enabled && settings.public_allowed_talkgroups.is_empty())
        || settings.audio_retention_days == 0
        || settings.transcript_retention_days == 0
        || settings.metadata_retention_days == 0
        || !optional_http_url(&settings.summary_url)
        || !optional_http_url(&settings.geocoder_url)
        || !optional_http_url(&settings.discord_webhook_url)
        || settings
            .discord_keyword_rules
            .iter()
            .any(|rule| !optional_http_url(&rule.webhook_url))
        || settings
            .discord_talkgroup_rules
            .iter()
            .any(|rule| !optional_http_url(&rule.webhook_url))
    {
        return (StatusCode::BAD_REQUEST, Json(settings));
    }
    let mut current = state.settings.write().expect("settings lock poisoned");
    *current = AppSettings {
        home_label: settings.home_label.trim().into(),
        ..settings
    };
    *state.public_policy.write().expect("policy lock poisoned") = PublicationPolicy {
        enabled: current.public_feed_enabled,
        delay_seconds: current.public_feed_delay_seconds,
        allowed_talkgroups: current.public_allowed_talkgroups.clone(),
        expose_transcripts: current.expose_transcripts,
        expose_radio_ids: current.expose_radio_ids,
        expose_precise_locations: current.expose_precise_locations,
    };
    if let Ok(serialized) = serde_json::to_vec_pretty(&*current) {
        if let Some(parent) = state.settings_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = crate::state::atomic_write(&state.settings_path, &serialized);
    }
    if let Some(sender) = state
        .persistence
        .read()
        .expect("persistence lock poisoned")
        .as_ref()
    {
        let _ = sender.send(crate::persistence::Command::Settings(current.clone()));
    }
    let saved_settings = current.clone();
    drop(current);
    // Keep the generated decoder profile synchronized with persisted radio
    // settings. The running process may still require a controlled restart,
    // but a restart can never pick up a stale configuration file.
    write_decoder_config(&state);
    (StatusCode::OK, Json(saved_settings))
}

async fn save_system(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(mut profile): Json<SystemProfile>,
) -> (StatusCode, Json<SystemProfile>) {
    if !admin_allowed(&state, &headers) {
        return (StatusCode::UNAUTHORIZED, Json(profile));
    }
    let is_p25 = profile.protocol.starts_with("p25");
    if profile.name.trim().is_empty()
        || (is_p25 && profile.control_channel_hz.unwrap_or_default() == 0)
        || (is_p25 && profile.nac.is_some_and(|nac| nac > 0xFFF))
        || (!is_p25 && profile.frequency_hz.unwrap_or_default() == 0)
    {
        return (StatusCode::BAD_REQUEST, Json(profile));
    }
    if !is_p25 {
        let bandwidth_ok = matches!(profile.bandwidth_hz, Some(6250 | 12500 | 25000));
        let tone_ok = profile
            .tone
            .as_deref()
            .map(valid_analog_tone)
            .unwrap_or(true);
        if !bandwidth_ok || profile.modulation.as_deref().is_none() || !tone_ok {
            return (StatusCode::BAD_REQUEST, Json(profile));
        }
        profile.control_channel_hz = None;
        profile.nac = None;
    } else {
        profile.frequency_hz = None;
        profile.tone = None;
    }
    if profile.id.is_nil() {
        profile.id = uuid::Uuid::new_v4();
    }
    profile.name = profile.name.trim().to_string();
    {
        let mut systems = state.systems.write().expect("systems lock poisoned");
        if let Some(existing) = systems.iter_mut().find(|item| item.id == profile.id) {
            *existing = profile.clone();
        } else {
            systems.push(profile.clone());
        }
        if let Ok(serialized) = serde_json::to_vec_pretty(&*systems) {
            if let Some(parent) = state.systems_path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let _ = crate::state::atomic_write(&state.systems_path, &serialized);
        }
    }
    if let Some(sender) = state
        .persistence
        .read()
        .expect("persistence lock poisoned")
        .as_ref()
    {
        let _ = sender.send(crate::persistence::Command::System(profile.clone()));
    }
    write_decoder_config(&state);
    (StatusCode::CREATED, Json(profile))
}

async fn update_system(
    State(state): State<Arc<AppState>>,
    Path(id): Path<uuid::Uuid>,
    headers: HeaderMap,
    Json(mut profile): Json<SystemProfile>,
) -> (StatusCode, Json<SystemProfile>) {
    profile.id = id;
    save_system(State(state), headers, Json(profile)).await
}

async fn start_scan_list(
    State(state): State<Arc<AppState>>,
    Path(id): Path<uuid::Uuid>,
    headers: HeaderMap,
) -> StatusCode {
    if !admin_allowed(&state, &headers) {
        return StatusCode::UNAUTHORIZED;
    }
    let exists = state
        .scan_lists
        .read()
        .expect("scan list lock poisoned")
        .iter()
        .any(|list| list.id == id && list.enabled);
    if !exists {
        return StatusCode::NOT_FOUND;
    }
    *state
        .active_scan_list
        .write()
        .expect("scan state lock poisoned") = Some(id);
    state.audit("scan.start", "scan-list", id.to_string());
    StatusCode::NO_CONTENT
}

async fn stop_scan_list(
    State(state): State<Arc<AppState>>,
    Path(id): Path<uuid::Uuid>,
    headers: HeaderMap,
) -> StatusCode {
    if !admin_allowed(&state, &headers) {
        return StatusCode::UNAUTHORIZED;
    }
    let mut active = state
        .active_scan_list
        .write()
        .expect("scan state lock poisoned");
    if *active != Some(id) {
        return StatusCode::NOT_FOUND;
    }
    *active = None;
    state.audit("scan.stop", "scan-list", id.to_string());
    StatusCode::NO_CONTENT
}

async fn delete_system(
    State(state): State<Arc<AppState>>,
    Path(id): Path<uuid::Uuid>,
    headers: HeaderMap,
) -> StatusCode {
    if !admin_allowed(&state, &headers) {
        return StatusCode::UNAUTHORIZED;
    }
    let mut systems = state.systems.write().expect("systems lock poisoned");
    let before = systems.len();
    systems.retain(|system| system.id != id);
    if systems.len() == before {
        return StatusCode::NOT_FOUND;
    }
    state.audit("system.delete", "system", id.to_string());
    if let Ok(serialized) = serde_json::to_vec_pretty(&*systems) {
        let _ = crate::state::atomic_write(&state.systems_path, &serialized);
    }
    if let Some(sender) = state
        .persistence
        .read()
        .expect("persistence lock poisoned")
        .as_ref()
    {
        let _ = sender.send(crate::persistence::Command::DeleteSystem(id));
    }
    StatusCode::NO_CONTENT
}

async fn delete_scan_list(
    State(state): State<Arc<AppState>>,
    Path(id): Path<uuid::Uuid>,
    headers: HeaderMap,
) -> StatusCode {
    if !admin_allowed(&state, &headers) {
        return StatusCode::UNAUTHORIZED;
    }
    let mut lists = state.scan_lists.write().expect("scan list lock poisoned");
    let before = lists.len();
    lists.retain(|list| list.id != id);
    if lists.len() == before {
        return StatusCode::NOT_FOUND;
    }
    state.audit("scan-list.delete", "scan-list", id.to_string());
    if let Ok(serialized) = serde_json::to_vec_pretty(&*lists) {
        let _ = crate::state::atomic_write(&state.scan_lists_path, &serialized);
    }
    if let Some(sender) = state
        .persistence
        .read()
        .expect("persistence lock poisoned")
        .as_ref()
    {
        let _ = sender.send(crate::persistence::Command::DeleteScanList(id));
    }
    StatusCode::NO_CONTENT
}

async fn live(upgrade: WebSocketUpgrade, State(state): State<Arc<AppState>>) -> impl IntoResponse {
    upgrade.on_upgrade(move |socket| live_socket(socket, state))
}

async fn live_socket(mut socket: WebSocket, state: Arc<AppState>) {
    let mut events = state.events.subscribe();
    while let Ok(event) = events.recv().await {
        let Ok(payload) = serde_json::to_string(&event) else {
            continue;
        };
        if socket.send(Message::Text(payload.into())).await.is_err() {
            break;
        }
    }
}

#[allow(dead_code)]
fn internal_error() -> impl IntoResponse {
    (StatusCode::INTERNAL_SERVER_ERROR, "internal server error")
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request};
    use tower::ServiceExt;

    fn test_state() -> Arc<AppState> {
        let state = Arc::new(AppState::new());
        state
            .sessions
            .write()
            .expect("sessions lock poisoned")
            .insert("test-session".into(), "admin".into());
        state
    }

    #[tokio::test]
    async fn health_endpoint_is_available() {
        let response = router(Arc::new(AppState::new()))
            .oneshot(
                Request::builder()
                    .uri("/api/v1/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn policy_is_private_by_default() {
        let response = router(Arc::new(AppState::new()))
            .oneshot(
                Request::builder()
                    .uri("/api/v1/policies/public")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn analog_profile_does_not_require_control_channel_or_nac() {
        let state = test_state();
        let response = router(state)
            .oneshot(
                Request::post("/api/v1/systems")
                    .header("content-type", "application/json")
                    .header("cookie", "trunkscope_session=test-session")
                    .body(Body::from(r#"{"id":"00000000-0000-0000-0000-000000000000","name":"Local FM","protocol":"analog-fm","frequencyHz":155550000,"bandwidthHz":12500,"modulation":"NFM"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);
    }

    #[test]
    fn analog_tone_validation_accepts_ctcss_and_dcs() {
        assert!(valid_analog_tone("100.0"));
        assert!(valid_analog_tone("D023"));
        assert!(valid_analog_tone("D754I"));
        assert!(!valid_analog_tone("D889"));
        assert!(!valid_analog_tone("D23"));
    }

    #[test]
    fn decoder_config_includes_conventional_fm_channels() {
        let state = test_state();
        state.systems.write().unwrap().clear();
        state.systems.write().unwrap().push(SystemProfile {
            id: uuid::Uuid::new_v4(),
            name: "Jackson County Fire".into(),
            protocol: "analog-fm".into(),
            control_channel_hz: None,
            control_channels_hz: vec![],
            nac: None,
            frequency_hz: Some(154_445_000),
            bandwidth_hz: Some(12_500),
            modulation: Some("NFM".into()),
            squelch_db: Some(-65.0),
            tone: Some("123.0".into()),
            deviation_hz: Some(2_500),
            step_hz: Some(12_500),
            dwell_ms: Some(2_500),
            sites: Vec::new(),
        });
        let config = decoder_config_value(&state);
        let systems = config["systems"].as_array().unwrap();
        assert_eq!(systems.len(), 1);
        assert_eq!(systems[0]["type"], "conventional");
        assert_eq!(systems[0]["shortName"], "Jackson County Fire");
        assert_eq!(
            systems[0]["channelFile"],
            "/var/lib/trunkscope/audio/decoder/analog-channels.csv"
        );
        assert!(config["sources"][0]["center"].as_u64().unwrap() > 150_000_000);
        assert!(
            config["statusServer"]
                .as_str()
                .unwrap()
                .ends_with("/api/v1/decoder/status")
        );
        assert!(systems[0].get("uploadScript").is_none());
    }

    #[test]
    fn decoder_status_server_defaults_to_localhost() {
        if std::env::var("TRUNKSCOPE_STATUS_SERVER")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .is_some()
        {
            return;
        }
        assert_eq!(
            decoder_status_server(),
            "ws://127.0.0.1:8080/api/v1/decoder/status"
        );
    }

    #[tokio::test]
    async fn decoder_ingest_accepts_trunk_recorder_sidecar() {
        let state = Arc::new(AppState::new());
        let sidecar = r#"{"freq":851012500,"talkgroup":1001,"start_time":1710000000,"stop_time":1710000004,"short_name":"Metro","talkgroup_tag":"Fire","encrypted":0}"#;
        let response = router(Arc::clone(&state))
            .oneshot(
                Request::post("/api/v1/decoder/ingest")
                    .header("content-type", "application/json")
                    .header(
                        "x-sidecar-path",
                        "/var/lib/trunkscope/calls/2026-09-01/call.json",
                    )
                    .body(Body::from(sidecar))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        let calls = state.calls.read().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].talkgroup_id, 1001);
    }

    #[tokio::test]
    async fn decoder_ingest_rejects_invalid_payload() {
        let response = router(Arc::new(AppState::new()))
            .oneshot(
                Request::post("/api/v1/decoder/ingest")
                    .header("content-type", "application/json")
                    .body(Body::from("not-json"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn parses_remote_soapy_endpoint_for_diagnostics() {
        assert_eq!(
            remote_endpoint("soapy=0,driver=remote,remote=tcp://192.168.1.50:55132,remote:driver=sdrplay"),
            Some(("192.168.1.50".into(), 55132))
        );
        assert!(remote_endpoint("driver=sdrplay").is_none());
    }

    #[tokio::test]
    async fn public_feed_requires_an_allowlist() {
        let state = test_state();
        let mut settings = state
            .settings
            .read()
            .expect("settings lock poisoned")
            .clone();
        settings.public_feed_enabled = true;
        settings.public_allowed_talkgroups.clear();
        let body = serde_json::to_vec(&settings).unwrap();
        let response = router(state)
            .oneshot(
                Request::put("/api/v1/settings")
                    .header("content-type", "application/json")
                    .header("cookie", "trunkscope_session=test-session")
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn p25_rejects_nac_outside_twelve_bit_range() {
        let state = test_state();
        let response = router(state)
            .oneshot(
                Request::post("/api/v1/systems")
                    .header("content-type", "application/json")
                    .header("cookie", "trunkscope_session=test-session")
                    .body(Body::from(
                        r#"{"id":"00000000-0000-0000-0000-000000000000","name":"P25","protocol":"p25","controlChannelHz":851012500,"nac":4096}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn audio_requires_bearer_token() {
        let response = router(Arc::new(AppState::new()))
            .oneshot(
                Request::get(format!("/api/v1/audio/{}", uuid::Uuid::new_v4()))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn runtime_endpoint_reports_decoder_and_receiver_state() {
        let response = router(Arc::new(AppState::new()))
            .oneshot(Request::get("/api/v1/runtime").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn liveness_and_readiness_endpoints_are_available() {
        let state = Arc::new(AppState::new());
        for path in ["/api/v1/health/live", "/api/v1/health/ready"] {
            let response = router(Arc::clone(&state))
                .oneshot(Request::get(path).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
        }
    }

    #[test]
    fn parses_audio_byte_ranges() {
        assert_eq!(parse_range("bytes=0-99", 200), Some((0, 99)));
        assert_eq!(parse_range("bytes=100-", 200), Some((100, 199)));
        assert_eq!(parse_range("bytes=-25", 200), Some((175, 199)));
        assert_eq!(parse_range("bytes=500-", 200), None);
    }

    #[test]
    fn optional_http_url_accepts_empty_or_http_values() {
        assert!(optional_http_url(""));
        assert!(optional_http_url("http://ollama:11434/api/generate"));
        assert!(optional_http_url("https://discord.com/api/webhooks/test"));
        assert!(!optional_http_url("ftp://example.com"));
    }

    #[tokio::test]
    async fn purge_and_undo_round_trip() {
        let state = test_state();
        let call_id = uuid::Uuid::new_v4();
        state.calls.write().expect("calls lock poisoned").push_back(Call {
            id: call_id,
            system_id: uuid::Uuid::new_v4(),
            system_name: "Test".into(),
            site_id: uuid::Uuid::new_v4(),
            talkgroup_id: 1001,
            talkgroup_label: "Dispatch".into(),
            category: "Law".into(),
            frequency_hz: 851_012_500,
            tdma_slot: None,
            source_radio_id: None,
            started_at: chrono::Utc::now(),
            ended_at: None,
            state: trunkscope_domain::CallState::Complete,
            encryption: trunkscope_domain::EncryptionState::Clear,
            signal_dbfs: -40.0,
            transcript: None,
            summary: None,
            location: None,
            audio: None,
        });
        let response = router(Arc::clone(&state))
            .oneshot(
                Request::post("/api/v1/calls/purge")
                    .header("content-type", "application/json")
                    .header("cookie", "trunkscope_session=test-session")
                    .body(Body::from(r#"{"hours":24}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert!(state.calls.read().expect("calls lock poisoned").is_empty());
        let undo = router(state)
            .oneshot(
                Request::post("/api/v1/calls/purge/undo")
                    .header("cookie", "trunkscope_session=test-session")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(undo.status(), StatusCode::OK);
    }
}
