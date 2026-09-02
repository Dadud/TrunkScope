use std::{
    collections::{HashMap, VecDeque},
    path::PathBuf,
    sync::RwLock,
};

use tokio::sync::broadcast;
use trunkscope_domain::{Call, CallEvent, PublicationPolicy, Receiver};

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemProfile {
    pub id: uuid::Uuid,
    pub name: String,
    pub protocol: String,
    pub control_channel_hz: u64,
    pub nac: Option<u32>,
}

pub const MAX_RECENT_CALLS: usize = 200;

pub struct AppState {
    pub receivers: RwLock<Vec<Receiver>>,
    pub calls: RwLock<VecDeque<Call>>,
    pub public_policy: RwLock<PublicationPolicy>,
    pub systems: RwLock<Vec<SystemProfile>>,
    pub systems_path: PathBuf,
    pub decoder_calls: RwLock<HashMap<String, uuid::Uuid>>,
    pub decoder_systems: RwLock<HashMap<String, uuid::Uuid>>,
    pub events: broadcast::Sender<CallEvent>,
    pub processing: broadcast::Sender<Call>,
}

impl AppState {
    pub fn new() -> Self {
        let (events, _) = broadcast::channel(256);
        let (processing, _) = broadcast::channel(256);
        let systems_path = std::env::var("TRUNKSCOPE_SYSTEMS_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("/var/lib/trunkscope/audio/systems.json"));
        let systems = std::fs::read_to_string(&systems_path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default();
        Self {
            receivers: RwLock::new(Vec::new()),
            calls: RwLock::new(VecDeque::new()),
            public_policy: RwLock::new(PublicationPolicy::default()),
            systems: RwLock::new(systems),
            systems_path,
            decoder_calls: RwLock::new(HashMap::new()),
            decoder_systems: RwLock::new(HashMap::new()),
            events,
            processing,
        }
    }

    pub fn upsert_call(&self, call: Call, event: CallEvent) {
        let mut calls = self.calls.write().expect("calls lock poisoned");
        if let Some(existing) = calls.iter_mut().find(|candidate| candidate.id == call.id) {
            *existing = call;
        } else {
            calls.push_front(call);
            calls.truncate(MAX_RECENT_CALLS);
        }
        drop(calls);
        let _ = self.events.send(event);
    }

    pub fn enqueue_processing(&self, call: Call) {
        let _ = self.processing.send(call);
    }

    pub fn enrich_call(&self, call_id: uuid::Uuid, transcript: String, summary: Option<String>) {
        let updated = {
            let mut calls = self.calls.write().expect("calls lock poisoned");
            calls
                .iter_mut()
                .find(|call| call.id == call_id)
                .map(|call| {
                    call.transcript = Some(transcript);
                    call.summary = summary;
                    call.clone()
                })
        };
        if let Some(call) = updated {
            let _ = self.events.send(CallEvent::Updated(call));
        }
    }
}
