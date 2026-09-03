import { callAudioUrl } from "../api";
import { formatElapsed, formatFrequency } from "../format";
import type { Call } from "../types";
import { AudioPlayer } from "./AudioPlayer";

interface CallPopupProps {
  call: Call;
  volume: number;
  onOpenTalkgroup?: (talkgroupId: number) => void;
  onClose?: () => void;
}

export function CallPopup({ call, volume, onOpenTalkgroup, onClose }: CallPopupProps) {
  const isEncrypted = call.encryption !== "clear";
  const hasAudio = !isEncrypted && Boolean(call.audio);

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

      {call.location && (
        <div className="popup-location">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 0 1 0-5 2.5 2.5 0 0 1 0 5z" />
          </svg>
          <span>{call.location.label}</span>
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
