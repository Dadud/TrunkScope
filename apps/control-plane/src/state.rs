use std::{
    collections::{HashMap, VecDeque},
    path::PathBuf,
    sync::{
        Mutex, RwLock,
        atomic::{AtomicUsize, Ordering},
    },
};

use tokio::sync::{broadcast, mpsc};
use trunkscope_domain::{
    Call, CallEvent, ConversationSession, PublicationPolicy, Receiver, Talkgroup,
};

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemProfile {
    pub id: uuid::Uuid,
    pub name: String,
    pub protocol: String,
    pub control_channel_hz: Option<u64>,
    /// Ordered control/alternate control channels for trunked systems. The
    /// singular field is retained for forward-compatible migration of older
    /// profiles.
    #[serde(default)]
    pub control_channels_hz: Vec<u64>,
    pub nac: Option<u32>,
    pub frequency_hz: Option<u64>,
    pub bandwidth_hz: Option<u32>,
    pub modulation: Option<String>,
    pub squelch_db: Option<f32>,
    pub tone: Option<String>,
    pub deviation_hz: Option<u32>,
    pub step_hz: Option<u32>,
    pub dwell_ms: Option<u32>,
    #[serde(default)]
    pub sites: Vec<SystemSite>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemSite {
    pub id: uuid::Uuid,
    pub name: String,
    #[serde(default)]
    pub control_channels_hz: Vec<u64>,
    #[serde(default)]
    pub voice_channels_hz: Vec<u64>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanChannel {
    pub id: uuid::Uuid,
    pub name: String,
    pub frequency_hz: u64,
    pub modulation: String,
    pub bandwidth_hz: u32,
    pub squelch_db: f32,
    pub tone: Option<String>,
    pub tone_required: bool,
    pub dwell_ms: u32,
    pub priority: i16,
    pub locked_out: bool,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanList {
    pub id: uuid::Uuid,
    pub name: String,
    pub enabled: bool,
    pub pause_on_activity: bool,
    pub resume_after_ms: u32,
    pub channels: Vec<ScanChannel>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntry {
    pub action: String,
    pub resource_type: String,
    pub resource_id: String,
    pub occurred_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Clone, Debug)]
pub enum ReceiverCommand {
    Probe(uuid::Uuid),
    Start(uuid::Uuid),
    Stop(uuid::Uuid),
    Restart(uuid::Uuid),
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct AppSettings {
    pub schema_version: u32,
    pub home_label: String,
    pub home_latitude: f64,
    pub home_longitude: f64,
    pub radio_mode: String,
    pub radio_device: String,
    pub radio_frequency_hz: u64,
    pub radio_sample_rate_hz: u32,
    pub radio_bandwidth_hz: Option<u32>,
    pub radio_gain_db: Option<f32>,
    pub radio_agc: bool,
    pub radio_ppm: f32,
    pub ai_enabled: bool,
    /// Runtime ASR profile. This is descriptive and lets the operator choose
    /// a CPU, CUDA, ROCm, or radio-specialized deployment without hiding the
    /// actual model/endpoint values below.
    pub ai_profile: String,
    pub transcribe_url: String,
    pub transcribe_model: String,
    pub vad_enabled: bool,
    pub summary_model: String,
    pub summary_refresh_minutes: u32,
    pub public_feed_enabled: bool,
    pub public_allowed_talkgroups: Vec<uuid::Uuid>,
    pub public_feed_delay_seconds: u32,
    pub expose_transcripts: bool,
    pub expose_radio_ids: bool,
    pub expose_precise_locations: bool,
    pub audio_retention_days: u32,
    pub transcript_retention_days: u32,
    pub metadata_retention_days: u32,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            schema_version: 3,
            home_label: "Home".into(),
            home_latitude: 44.3984,
            home_longitude: -90.5785,
            radio_mode: std::env::var("TRUNKSCOPE_RADIO_MODE")
                .unwrap_or_else(|_| "simulator".into()),
            radio_device: std::env::var("TRUNKSCOPE_RADIO_DEVICE").unwrap_or_default(),
            radio_frequency_hz: std::env::var("TRUNKSCOPE_RADIO_FREQUENCY_HZ")
                .ok()
                .and_then(|v| v.parse().ok())
                .filter(|v: &u64| *v > 0)
                .unwrap_or(851_012_500),
            radio_sample_rate_hz: std::env::var("TRUNKSCOPE_RADIO_SAMPLE_RATE_HZ")
                .ok()
                .and_then(|v| v.parse().ok())
                .filter(|v: &u32| *v > 0)
                .unwrap_or(2_400_000),
            radio_bandwidth_hz: std::env::var("TRUNKSCOPE_RADIO_BANDWIDTH_HZ")
                .ok()
                .and_then(|v| v.parse().ok()),
            radio_gain_db: std::env::var("TRUNKSCOPE_RADIO_GAIN_DB")
                .ok()
                .and_then(|v| v.parse().ok()),
            radio_agc: std::env::var("TRUNKSCOPE_RADIO_AGC")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(false),
            radio_ppm: std::env::var("TRUNKSCOPE_RADIO_PPM")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(0.0),
            ai_enabled: std::env::var("TRUNKSCOPE_AI_ENABLED")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(false),
            ai_profile: std::env::var("TRUNKSCOPE_AI_PROFILE")
                .unwrap_or_else(|_| "cpu-faster-whisper-small".into()),
            transcribe_url: std::env::var("TRUNKSCOPE_TRANSCRIBE_URL")
                .unwrap_or_else(|_| "http://speaches:8000/v1/audio/transcriptions".into()),
            transcribe_model: std::env::var("TRUNKSCOPE_TRANSCRIBE_MODEL")
                .unwrap_or_else(|_| "Systran/faster-distil-whisper-small.en".into()),
            vad_enabled: std::env::var("TRUNKSCOPE_VAD_ENABLED")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(true),
            summary_model: std::env::var("TRUNKSCOPE_SUMMARY_MODEL")
                .unwrap_or_else(|_| "llama3.2:3b".into()),
            summary_refresh_minutes: 15,
            public_feed_enabled: false,
            public_allowed_talkgroups: Vec::new(),
            public_feed_delay_seconds: 120,
            expose_transcripts: false,
            expose_radio_ids: false,
            expose_precise_locations: false,
            audio_retention_days: 30,
            transcript_retention_days: 365,
            metadata_retention_days: 365,
        }
    }
}

pub const MAX_RECENT_CALLS: usize = 200;

/// Write a persisted document atomically so a power loss cannot leave a
/// partially-written settings, system, scan-list, or audit file.
pub fn atomic_write(path: &std::path::Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let temp = path.with_extension(format!("tmp-{}", uuid::Uuid::new_v4()));
    std::fs::write(&temp, bytes)?;
    std::fs::rename(temp, path)
}

pub struct AppState {
    pub receivers: RwLock<Vec<Receiver>>,
    pub receivers_path: PathBuf,
    pub calls: RwLock<VecDeque<Call>>,
    pub conversation_sessions: RwLock<Vec<ConversationSession>>,
    pub conversation_sessions_path: PathBuf,
    pub public_policy: RwLock<PublicationPolicy>,
    pub systems: RwLock<Vec<SystemProfile>>,
    pub systems_path: PathBuf,
    pub talkgroups: RwLock<Vec<Talkgroup>>,
    pub talkgroups_path: PathBuf,
    pub scan_lists: RwLock<Vec<ScanList>>,
    pub scan_lists_path: PathBuf,
    pub active_scan_list: RwLock<Option<uuid::Uuid>>,
    pub audit_log: RwLock<VecDeque<AuditEntry>>,
    pub audit_path: PathBuf,
    pub receiver_commands: broadcast::Sender<ReceiverCommand>,
    pub settings: RwLock<AppSettings>,
    pub settings_path: PathBuf,
    pub sessions: RwLock<HashMap<String, String>>,
    pub decoder_calls: RwLock<HashMap<String, uuid::Uuid>>,
    pub decoder_systems: RwLock<HashMap<String, uuid::Uuid>>,
    pub decoder_connected: RwLock<bool>,
    pub decoder_last_event: RwLock<Option<chrono::DateTime<chrono::Utc>>>,
    pub decoder_control_lock: RwLock<Option<chrono::DateTime<chrono::Utc>>>,
    pub events: broadcast::Sender<CallEvent>,
    pub processing: broadcast::Sender<Call>,
    /// Reliable single-consumer AI queue. The broadcast channel above remains
    /// available for diagnostics/tests, but workers must never lose calls when
    /// a burst exceeds its ring buffer.
    pub processing_queue: mpsc::UnboundedSender<Call>,
    pub processing_queue_depth: AtomicUsize,
    pub processing_receiver: Mutex<Option<mpsc::UnboundedReceiver<Call>>>,
    pub ai_worker_status: RwLock<String>,
    pub ai_last_error: RwLock<Option<String>>,
    pub persistence: RwLock<Option<crate::persistence::Sender>>,
}

impl AppState {
    pub fn new() -> Self {
        let (events, _) = broadcast::channel(256);
        let (processing, _) = broadcast::channel(256);
        let (processing_queue, processing_receiver) = mpsc::unbounded_channel();
        let (receiver_commands, _) = broadcast::channel(32);
        let systems_path = std::env::var("TRUNKSCOPE_SYSTEMS_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("/var/lib/trunkscope/audio/systems.json"));
        let receivers_path = std::env::var("TRUNKSCOPE_RECEIVERS_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                systems_path
                    .parent()
                    .unwrap_or(std::path::Path::new("/var/lib/trunkscope/audio"))
                    .join("receivers.json")
            });
        let receivers = std::fs::read_to_string(&receivers_path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default();
        let systems: Vec<SystemProfile> = std::fs::read_to_string(&systems_path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default();
        let talkgroups_path = std::env::var("TRUNKSCOPE_TALKGROUPS_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                systems_path
                    .parent()
                    .unwrap_or(std::path::Path::new("/var/lib/trunkscope/audio"))
                    .join("talkgroups.json")
            });
        let talkgroups = std::fs::read_to_string(&talkgroups_path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_else(|| {
                let csv_path = std::env::var("TRUNKSCOPE_CALLS_PATH")
                    .map(PathBuf::from)
                    .unwrap_or_else(|_| PathBuf::from("/var/lib/trunkscope/calls"))
                    .join("imported-talkgroups.csv");
                let system_id = systems
                    .first()
                    .map(|system: &SystemProfile| system.id)
                    .unwrap_or_default();
                std::fs::read_to_string(csv_path)
                    .ok()
                    .and_then(|raw| {
                        let mut lines = raw.lines();
                        lines.next()?;
                        let parsed = lines
                            .filter_map(|line| {
                                let fields: Vec<String> = line
                                    .split(',')
                                    .map(|field| field.trim().trim_matches('"').to_string())
                                    .collect();
                                let decimal_id = fields.first()?.parse().ok()?;
                                let alpha_tag = fields.get(2)?.clone();
                                if alpha_tag.is_empty() {
                                    return None;
                                }
                                Some(Talkgroup {
                                    id: uuid::Uuid::new_v4(),
                                    system_id,
                                    decimal_id,
                                    alpha_tag,
                                    description: fields.get(4).cloned().unwrap_or_default(),
                                    category: fields.get(6).cloned().unwrap_or_default(),
                                    priority: 0,
                                    enabled: true,
                                    record: true,
                                    public_allowed: false,
                                })
                            })
                            .collect::<Vec<_>>();
                        (!parsed.is_empty()).then_some(parsed)
                    })
                    .unwrap_or_default()
            });
        // Commit a one-time CSV migration so talkgroup UUIDs remain stable
        // across restarts and subsequent CRUD operations address the same row.
        if !talkgroups.is_empty() && !talkgroups_path.is_file() {
            if let Ok(document) = serde_json::to_vec_pretty(&talkgroups) {
                let _ = atomic_write(&talkgroups_path, &document);
            }
        }
        let settings_path = std::env::var("TRUNKSCOPE_SETTINGS_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                systems_path
                    .parent()
                    .unwrap_or(std::path::Path::new("/var/lib/trunkscope/audio"))
                    .join("settings.json")
            });
        let conversation_sessions_path = std::env::var("TRUNKSCOPE_SESSIONS_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                settings_path
                    .parent()
                    .unwrap_or(std::path::Path::new("/var/lib/trunkscope/audio"))
                    .join("conversation-sessions.json")
            });
        let conversation_sessions = std::fs::read_to_string(&conversation_sessions_path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default();
        let scan_lists_path = std::env::var("TRUNKSCOPE_SCAN_LISTS_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                systems_path
                    .parent()
                    .unwrap_or(std::path::Path::new("/var/lib/trunkscope/audio"))
                    .join("scan-lists.json")
            });
        let scan_lists = std::fs::read_to_string(&scan_lists_path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default();
        let audit_path = std::env::var("TRUNKSCOPE_AUDIT_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                systems_path
                    .parent()
                    .unwrap_or(std::path::Path::new("/var/lib/trunkscope/audio"))
                    .join("audit.json")
            });
        let audit_log: VecDeque<AuditEntry> = std::fs::read_to_string(&audit_path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default();
        let mut settings: AppSettings = std::fs::read_to_string(&settings_path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default();
        let mut settings_changed = false;
        if settings.schema_version < 2 {
            settings.schema_version = 2;
            settings_changed = true;
        }
        if settings.schema_version < 3 {
            settings.schema_version = 3;
            if settings.ai_profile.is_empty() {
                settings.ai_profile = "cpu-faster-whisper-small".into();
            }
            if settings.transcribe_url.is_empty() {
                settings.transcribe_url = "http://speaches:8000/v1/audio/transcriptions".into();
            }
            settings_changed = true;
        }
        // SDRplay RSP1B exposes stable manual-gain operation and a broad
        // bandwidth range. Make the conservative first-run values explicit so
        // the UI/runtime do not display nulls while silently applying a
        // different decoder fallback. An operator can still override these
        // values in Settings after capability probing.
        if settings
            .radio_device
            .to_ascii_lowercase()
            .contains("sdrplay")
        {
            if settings.radio_bandwidth_hz.is_none() {
                settings.radio_bandwidth_hz = Some(1_800_000);
                settings_changed = true;
            }
            if settings.radio_gain_db.is_none() {
                settings.radio_gain_db = Some(40.0);
                settings_changed = true;
            }
            if settings.radio_agc {
                settings.radio_agc = false;
                settings_changed = true;
            }
        }
        if settings_changed {
            if let Ok(serialized) = serde_json::to_vec_pretty(&settings) {
                let _ = atomic_write(&settings_path, &serialized);
            }
        }
        Self {
            receivers: RwLock::new(receivers),
            receivers_path,
            calls: RwLock::new(VecDeque::new()),
            conversation_sessions: RwLock::new(conversation_sessions),
            conversation_sessions_path,
            public_policy: RwLock::new(PublicationPolicy {
                enabled: settings.public_feed_enabled,
                delay_seconds: settings.public_feed_delay_seconds,
                allowed_talkgroups: settings.public_allowed_talkgroups.clone(),
                expose_transcripts: settings.expose_transcripts,
                expose_radio_ids: settings.expose_radio_ids,
                expose_precise_locations: settings.expose_precise_locations,
            }),
            systems: RwLock::new(systems),
            systems_path,
            talkgroups: RwLock::new(talkgroups),
            talkgroups_path,
            scan_lists: RwLock::new(scan_lists),
            scan_lists_path,
            active_scan_list: RwLock::new(None),
            audit_log: RwLock::new(audit_log),
            audit_path,
            receiver_commands,
            settings: RwLock::new(settings),
            settings_path,
            sessions: RwLock::new(HashMap::new()),
            decoder_calls: RwLock::new(HashMap::new()),
            decoder_systems: RwLock::new(HashMap::new()),
            decoder_connected: RwLock::new(false),
            decoder_last_event: RwLock::new(None),
            decoder_control_lock: RwLock::new(None),
            events,
            processing,
            processing_queue,
            processing_queue_depth: AtomicUsize::new(0),
            processing_receiver: Mutex::new(Some(processing_receiver)),
            ai_worker_status: RwLock::new("disabled".into()),
            ai_last_error: RwLock::new(None),
            persistence: RwLock::new(None),
        }
    }

    pub fn audit(&self, action: &str, resource_type: &str, resource_id: impl Into<String>) {
        let mut log = self.audit_log.write().expect("audit lock poisoned");
        log.push_front(AuditEntry {
            action: action.into(),
            resource_type: resource_type.into(),
            resource_id: resource_id.into(),
            occurred_at: chrono::Utc::now(),
        });
        log.truncate(500);
        if let Some(parent) = self.audit_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(serialized) = serde_json::to_vec_pretty(&*log) {
            let _ = atomic_write(&self.audit_path, &serialized);
        }
        if let Some(sender) = self
            .persistence
            .read()
            .expect("persistence lock poisoned")
            .as_ref()
        {
            if let Some(entry) = log.front().cloned() {
                let _ = sender.send(crate::persistence::Command::Audit(entry));
            }
        }
    }

    pub fn upsert_call(&self, call: Call, event: CallEvent) {
        let persisted = call.clone();
        let mut calls = self.calls.write().expect("calls lock poisoned");
        if let Some(existing) = calls.iter_mut().find(|candidate| candidate.id == call.id) {
            *existing = call;
        } else {
            calls.push_front(call);
            calls.truncate(MAX_RECENT_CALLS);
        }
        drop(calls);
        self.update_conversation_session(&persisted);
        if let Some(sender) = self
            .persistence
            .read()
            .expect("persistence lock poisoned")
            .as_ref()
        {
            let _ = sender.send(crate::persistence::Command::Call(persisted));
        }
        let _ = self.events.send(event);
    }

    fn update_conversation_session(&self, call: &Call) {
        if call.encryption != trunkscope_domain::EncryptionState::Clear {
            return;
        }
        let mut sessions = self
            .conversation_sessions
            .write()
            .expect("sessions lock poisoned");
        let now = call.ended_at.unwrap_or(call.started_at);
        let existing = sessions.iter_mut().find(|session| {
            session.system_id == call.system_id
                && session.site_id == call.site_id
                && session.talkgroup_id == call.talkgroup_id
                && now
                    .signed_duration_since(session.last_activity_at)
                    .num_seconds()
                    <= 10
                && session.state != "finalized"
        });
        if let Some(session) = existing {
            if !session.call_ids.contains(&call.id) {
                session.call_ids.push(call.id);
            }
            if let Some(audio) = &call.audio {
                if !session.audio_keys.contains(&audio.object_key) {
                    session.audio_keys.push(audio.object_key.clone());
                }
            }
            session.last_activity_at = session.last_activity_at.max(now);
        } else {
            sessions.push(ConversationSession {
                id: uuid::Uuid::new_v4(),
                system_id: call.system_id,
                site_id: call.site_id,
                talkgroup_id: call.talkgroup_id,
                started_at: call.started_at,
                last_activity_at: now,
                call_ids: vec![call.id],
                audio_keys: call
                    .audio
                    .as_ref()
                    .map(|audio| vec![audio.object_key.clone()])
                    .unwrap_or_default(),
                state: "open".into(),
                transcript: None,
                summary: None,
                location: call.location.clone(),
                activity_score: 0,
            });
        }
        sessions.sort_by_key(|session| std::cmp::Reverse(session.last_activity_at));
        sessions.truncate(500);
        if let Ok(document) = serde_json::to_vec_pretty(&*sessions) {
            let _ = atomic_write(&self.conversation_sessions_path, &document);
        }
    }

    pub fn enqueue_processing(&self, call: Call) {
        let _ = self.processing.send(call.clone());
        if self.processing_queue.send(call).is_ok() {
            self.processing_queue_depth.fetch_add(1, Ordering::Relaxed);
        }
    }

    /// Close an exchange after ten seconds of radio silence. This keeps the
    /// operator view and downstream notifications aligned with the same
    /// conversation boundary used when calls are grouped.
    pub fn finalize_expired_sessions(&self) {
        let cutoff = chrono::Utc::now() - chrono::Duration::seconds(10);
        let mut changed = false;
        if let Ok(mut sessions) = self.conversation_sessions.write() {
            for session in sessions.iter_mut() {
                if session.state != "finalized" && session.last_activity_at < cutoff {
                    session.state = "finalized".into();
                    changed = true;
                }
            }
            if changed {
                if let Ok(document) = serde_json::to_vec_pretty(&*sessions) {
                    let _ = atomic_write(&self.conversation_sessions_path, &document);
                }
            }
        }
    }

    pub fn enrich_call(&self, call_id: uuid::Uuid, transcript: String, summary: Option<String>) {
        let updated = {
            let mut calls = self.calls.write().expect("calls lock poisoned");
            calls
                .iter_mut()
                .find(|call| call.id == call_id)
                .map(|call| {
                    call.transcript = Some(transcript.clone());
                    call.summary = summary.clone();
                    call.clone()
                })
        };
        if let Some(call) = updated {
            if let Ok(mut sessions) = self.conversation_sessions.write() {
                if let Some(session) = sessions
                    .iter_mut()
                    .find(|session| session.call_ids.contains(&call_id))
                {
                    let combined = session.transcript.take().unwrap_or_default();
                    session.transcript = Some(if combined.is_empty() {
                        transcript.clone()
                    } else {
                        format!("{combined}\n{transcript}")
                    });
                    if summary.is_some() {
                        session.summary = summary.clone();
                    }
                    session.state = "processing".into();
                    if let Ok(document) = serde_json::to_vec_pretty(&*sessions) {
                        let _ = atomic_write(&self.conversation_sessions_path, &document);
                    }
                }
            }
            if let Some(sender) = self
                .persistence
                .read()
                .expect("persistence lock poisoned")
                .as_ref()
            {
                let _ = sender.send(crate::persistence::Command::Call(call.clone()));
            }
            let _ = self.events.send(CallEvent::Updated(call));
        }
    }

    pub fn set_call_location(
        &self,
        call_id: uuid::Uuid,
        location: trunkscope_domain::IncidentLocation,
    ) {
        let updated = {
            let mut calls = self.calls.write().expect("calls lock poisoned");
            calls
                .iter_mut()
                .find(|call| call.id == call_id)
                .map(|call| {
                    call.location = Some(location.clone());
                    call.clone()
                })
        };
        if let Some(call) = updated {
            if let Ok(mut sessions) = self.conversation_sessions.write() {
                if let Some(session) = sessions
                    .iter_mut()
                    .find(|session| session.call_ids.contains(&call_id))
                {
                    session.location = Some(location);
                }
                if let Ok(document) = serde_json::to_vec_pretty(&*sessions) {
                    let _ = atomic_write(&self.conversation_sessions_path, &document);
                }
            }
            if let Some(sender) = self
                .persistence
                .read()
                .expect("persistence lock poisoned")
                .as_ref()
            {
                let _ = sender.send(crate::persistence::Command::Call(call.clone()));
            }
            let _ = self.events.send(CallEvent::Updated(call));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audit_log_is_bounded_and_newest_first() {
        let state = AppState::new();
        for index in 0..510 {
            state.audit("test", "fixture", index.to_string());
        }
        let log = state.audit_log.read().unwrap();
        assert_eq!(log.len(), 500);
        assert_eq!(log.front().unwrap().resource_id, "509");
    }

    #[test]
    fn atomic_write_replaces_document() {
        let path = std::env::temp_dir().join(format!("trunkscope-{}.json", uuid::Uuid::new_v4()));
        atomic_write(&path, br#"{"version":1}"#).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{\"version\":1}");
        let _ = std::fs::remove_file(path);
    }
}
