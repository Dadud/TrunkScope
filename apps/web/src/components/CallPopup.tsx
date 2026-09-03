import { callAudioUrl, updateCallLocation } from "../api";
import { formatElapsed, formatFrequency } from "../format";
import type { Call } from "../types";
import { AudioPlayer } from "./AudioPlayer";
import { useState } from "react";

interface CallPopupProps {
  call: Call;
  volume: number;
  isAdmin?: boolean;
  onLocationUpdated?: (call: Call) => void;
  onOpenTalkgroup?: (talkgroupId: number) => void;
  onClose?: () => void;
}

export function CallPopup({ call, volume, isAdmin, onLocationUpdated, onOpenTalkgroup, onClose }: CallPopupProps) {
  const isEncrypted = call.encryption !== "clear";
  const hasAudio = !isEncrypted && Boolean(call.audio);
  const [editingLocation, setEditingLocation] = useState(false);
  const [locationDraft, setLocationDraft] = useState({
    label: call.location?.label ?? "",
    latitude: call.location?.latitude ?? 0,
    longitude: call.location?.longitude ?? 0,
    confidence: call.location?.confidence ?? 1,
  });
  const [locationMessage, setLocationMessage] = useState("");

  const getCategoryColor = (cat: string) => {
    const c = cat.toLowerCase();
    if (c.includes("fire") || c.includes("structure") || c.includes("alarm")) return "cat-fire";
    if (c.includes("medical") || c.includes("ems") || c.includes("ambulance") || c.includes("rescue")) return "cat-ems";
    if (c.includes("police") || c.includes("law") || c.includes("sheriff") || c.includes("pursuit")) return "cat-law";
    if (c.includes("traffic") || c.includes("crash") || c.includes("collision") || c.includes("hazard")) return "cat-traffic";
    return "cat-other";
  };

  return (
    <div className="tactical-call-popup">
      <div className="popup-header">
        <div className="header-tags">
          <span className={`category-badge ${getCategoryColor(call.category)}`}>
            {call.category}
          </span>
          {call.state === "active" && <span className="live-tag">LIVE</span>}
          {isEncrypted && <span className="encrypted-tag">ENCRYPTED</span>}
        </div>
        {onClose && (
          <button type="button" className="close-popup-btn" onClick={onClose} aria-label="Close">
            &times;
          </button>
        )}
      </div>

      <div className="popup-title">
        <h3>{call.talkgroupLabel}</h3>
        <span className="system-sub">{call.systemName}</span>
      </div>

      <div className="popup-meta-grid">
        <div className="meta-item">
          <span className="label">TALKGROUP</span>
          <span className="val">{call.talkgroupId}</span>
        </div>
        <div className="meta-item">
          <span className="label">FREQUENCY</span>
          <span className="val">{formatFrequency(call.frequencyHz)}</span>
        </div>
        <div className="meta-item">
          <span className="label">TIME</span>
          <span className="val">
            {new Date(call.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
        </div>
        <div className="meta-item">
          <span className="label">DURATION</span>
          <span className="val">{formatElapsed(call.startedAt, call.endedAt)}</span>
        </div>
      </div>

      {hasAudio ? (
        <div className="popup-audio-section">
          <AudioPlayer src={callAudioUrl(call.id)} volume={volume} autoPlay={false} />
        </div>
      ) : (
        <div className="popup-audio-notice">
          {isEncrypted ? "Audio suppressed: transmission encrypted" : "Audio unavailable for this recording"}
        </div>
      )}

      {call.summary && (
        <div className="popup-summary">
          <small className="section-label">AI SUMMARY</small>
          <p>{call.summary}</p>
        </div>
      )}

      {call.transcript && (
        <div className="popup-transcript">
          <small className="section-label">TRANSCRIPT</small>
          <p>{call.transcript}</p>
        </div>
      )}

      {call.location && !editingLocation && (
        <div className="popup-location">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 0 1 0-5 2.5 2.5 0 0 1 0 5z" />
          </svg>
          <span>{call.location.label}</span>
          {call.location.confidence < 0.8 && <small>Low confidence ({Math.round(call.location.confidence * 100)}%)</small>}
        </div>
      )}

      {isAdmin && (
        <div className="popup-location-edit">
          {!editingLocation ? (
            <button type="button" className="quiet-btn" onClick={() => setEditingLocation(true)}>
              Correct location
            </button>
          ) : (
            <div className="location-form">
              <label>Label<input value={locationDraft.label} onChange={(e) => setLocationDraft({ ...locationDraft, label: e.target.value })} /></label>
              <label>Latitude<input type="number" step="0.0001" value={locationDraft.latitude} onChange={(e) => setLocationDraft({ ...locationDraft, latitude: Number(e.target.value) })} /></label>
              <label>Longitude<input type="number" step="0.0001" value={locationDraft.longitude} onChange={(e) => setLocationDraft({ ...locationDraft, longitude: Number(e.target.value) })} /></label>
              <div className="btn-row">
                <button type="button" className="primary-btn" onClick={async () => {
                  try {
                    await updateCallLocation(call.id, locationDraft);
                    onLocationUpdated?.({ ...call, location: locationDraft });
                    setEditingLocation(false);
                    setLocationMessage("Location updated");
                  } catch (error) {
                    setLocationMessage(error instanceof Error ? error.message : "Location update failed");
                  }
                }}>Save location</button>
                <button type="button" onClick={() => setEditingLocation(false)}>Cancel</button>
              </div>
              {locationMessage && <span>{locationMessage}</span>}
            </div>
          )}
        </div>
      )}

      <div className="popup-actions">
        {onOpenTalkgroup && (
          <button
            type="button"
            className="talkgroup-btn"
            onClick={() => onOpenTalkgroup(call.talkgroupId)}
          >
            Inspect Talkgroup {call.talkgroupId} &rarr;
          </button>
        )}
      </div>
    </div>
  );
}
