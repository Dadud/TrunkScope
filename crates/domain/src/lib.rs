use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

fn default_enabled() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Receiver {
    pub id: Uuid,
    pub label: String,
    pub driver: ReceiverDriver,
    pub serial: String,
    pub state: ReceiverState,
    pub center_frequency_hz: Option<u64>,
    pub sample_rate_hz: Option<u32>,
    pub gain_db: Option<f32>,
    pub ppm: f32,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub role: ReceiverRole,
    #[serde(default)]
    pub soapy_index: Option<u32>,
    /// Trunk Recorder `autoTune`: track observed tuning offsets and correct
    /// each call. Useful for SDRs with drifting clocks (RTL-SDR).
    #[serde(default)]
    pub auto_tune: Option<bool>,
    pub capabilities: ReceiverCapabilities,
    pub health: ReceiverHealth,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum ReceiverRole {
    #[default]
    General,
    P25,
    Analog,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ReceiverDriver {
    RtlSdr,
    Airspy,
    Sdrplay,
    HackRf,
    PlutoSdr,
    BladeRf,
    LimeSdr,
    GenericSoapy,
    Simulator,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ReceiverState {
    Offline,
    Probing,
    Ready,
    Idle,
    Monitoring,
    Degraded,
    Stopped,
    Faulted,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReceiverCapabilities {
    pub minimum_frequency_hz: u64,
    pub maximum_frequency_hz: u64,
    pub sample_rates_hz: Vec<u32>,
    pub maximum_bandwidth_hz: u32,
    pub supports_agc: bool,
    pub gain_elements: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReceiverHealth {
    pub signal_dbfs: f32,
    pub noise_dbfs: f32,
    pub frequency_error_hz: f32,
    pub dropped_samples: u64,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RadioSystem {
    pub id: Uuid,
    pub name: String,
    pub kind: SystemKind,
    pub enabled: bool,
    pub sites: Vec<Site>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SystemKind {
    P25Trunked,
    P25Conventional,
    NfmConventional,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Site {
    pub id: Uuid,
    pub name: String,
    pub control_channels_hz: Vec<u64>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Talkgroup {
    pub id: Uuid,
    pub system_id: Uuid,
    pub decimal_id: u32,
    pub alpha_tag: String,
    pub description: String,
    pub category: String,
    pub priority: i16,
    pub enabled: bool,
    pub record: bool,
    pub public_allowed: bool,
    /// Trunk Recorder talkgroup mode: A (analog), D (digital),
    /// M (mixed), T (TDMA). Defaults to digital when unset.
    #[serde(default)]
    pub mode: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Call {
    pub id: Uuid,
    pub system_id: Uuid,
    pub system_name: String,
    pub site_id: Uuid,
    pub talkgroup_id: u32,
    pub talkgroup_label: String,
    pub category: String,
    pub frequency_hz: u64,
    pub tdma_slot: Option<u8>,
    pub source_radio_id: Option<u32>,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
    pub state: CallState,
    pub encryption: EncryptionState,
    pub signal_dbfs: f32,
    pub transcript: Option<String>,
    pub summary: Option<String>,
    pub location: Option<IncidentLocation>,
    pub audio: Option<AudioAsset>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConversationSession {
    pub id: Uuid,
    pub system_id: Uuid,
    pub site_id: Uuid,
    pub talkgroup_id: u32,
    pub started_at: DateTime<Utc>,
    pub last_activity_at: DateTime<Utc>,
    pub call_ids: Vec<Uuid>,
    #[serde(default)]
    pub audio_keys: Vec<String>,
    pub state: String,
    pub transcript: Option<String>,
    pub summary: Option<String>,
    pub location: Option<IncidentLocation>,
    pub activity_score: u32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CallState {
    Active,
    Complete,
    Failed,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum EncryptionState {
    Clear,
    Encrypted,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IncidentLocation {
    pub label: String,
    pub latitude: f64,
    pub longitude: f64,
    pub confidence: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AudioAsset {
    pub object_key: String,
    pub content_type: String,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", content = "payload", rename_all = "camelCase")]
pub enum CallEvent {
    Started(Call),
    Updated(Call),
    Ended(Call),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PublicationPolicy {
    pub enabled: bool,
    pub delay_seconds: u32,
    pub allowed_talkgroups: Vec<Uuid>,
    pub expose_transcripts: bool,
    pub expose_radio_ids: bool,
    pub expose_precise_locations: bool,
}

impl Default for PublicationPolicy {
    fn default() -> Self {
        Self {
            enabled: false,
            delay_seconds: 120,
            allowed_talkgroups: Vec::new(),
            expose_transcripts: false,
            expose_radio_ids: false,
            expose_precise_locations: false,
        }
    }
}

impl PublicationPolicy {
    pub fn validate(&self) -> Result<(), ValidationError> {
        if self.enabled && self.allowed_talkgroups.is_empty() {
            return Err(ValidationError::PublicFeedRequiresAllowlist);
        }
        if self.delay_seconds > 86_400 {
            return Err(ValidationError::PublicDelayTooLarge);
        }
        Ok(())
    }

    pub fn permits(&self, talkgroup_id: Uuid, encryption: EncryptionState) -> bool {
        self.enabled
            && encryption == EncryptionState::Clear
            && self.allowed_talkgroups.contains(&talkgroup_id)
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ValidationError {
    #[error("a public feed requires at least one explicitly allowed talkgroup")]
    PublicFeedRequiresAllowlist,
    #[error("public feed delay cannot exceed 24 hours")]
    PublicDelayTooLarge,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_feed_is_private_by_default() {
        let policy = PublicationPolicy::default();
        assert!(!policy.enabled);
        assert_eq!(policy.delay_seconds, 120);
        assert!(!policy.permits(Uuid::new_v4(), EncryptionState::Clear));
    }

    #[test]
    fn enabled_public_feed_requires_allowlist() {
        let policy = PublicationPolicy {
            enabled: true,
            ..PublicationPolicy::default()
        };
        assert_eq!(
            policy.validate(),
            Err(ValidationError::PublicFeedRequiresAllowlist)
        );
    }

    #[test]
    fn encrypted_audio_is_never_publishable() {
        let talkgroup = Uuid::new_v4();
        let policy = PublicationPolicy {
            enabled: true,
            allowed_talkgroups: vec![talkgroup],
            ..PublicationPolicy::default()
        };
        assert!(!policy.permits(talkgroup, EncryptionState::Encrypted));
    }
}
