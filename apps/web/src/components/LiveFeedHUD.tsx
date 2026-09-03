import { useState } from "react";
import type { Call } from "../types";
import { formatElapsed, formatFrequency } from "../format";
import { callAudioUrl } from "../api";

interface LiveFeedHUDProps {
  calls: Call[];
  selectedCallId?: string;
  volume: number;
  onSelectCall: (call: Call) => void;
  onOpenTalkgroup: (talkgroupId: number) => void;
}

export function LiveFeedHUD({
  calls,
  selectedCallId,
  onSelectCall,
  onOpenTalkgroup,
}: LiveFeedHUDProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [playingCallId, setPlayingCallId] = useState<string | null>(null);

  const displayCalls = calls.slice(0, 8);

  const getCategoryClass = (cat: string) => {
    const c = cat.toLowerCase();
    if (c.includes("fire") || c.includes("structure") || c.includes("alarm")) return "cat-fire";
    if (c.includes("medical") || c.includes("ems") || c.includes("ambulance") || c.includes("rescue")) return "cat-ems";
    if (c.includes("police") || c.includes("law") || c.includes("sheriff")) return "cat-law";
    if (c.includes("traffic") || c.includes("crash") || c.includes("collision")) return "cat-traffic";
    return "cat-other";
  };

  const toggleRowPlay = (e: React.MouseEvent, call: Call) => {
    e.stopPropagation();
    if (playingCallId === call.id) {
      setPlayingCallId(null);
    } else {
      setPlayingCallId(call.id);
      onSelectCall(call);
    }
  };

  return (
    <div className={`live-feed-hud ${collapsed ? "collapsed" : ""}`}>
      <div className="hud-header">
        <div className="hud-title">
          <span className="pulse-indicator" />
          <strong>LIVE EVENT STREAM</strong>
          <span className="badge">{calls.length} total</span>
        </div>
        <div className="hud-controls">
          <button
            type="button"
            className="hud-toggle-btn"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? "Expand Feed" : "Collapse Feed"}
            title={collapsed ? "Expand Feed" : "Collapse Feed"}
          >
            {collapsed ? "▲ EXPAND" : "▼ MINIMIZE"}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="hud-list">
          {displayCalls.length === 0 ? (
            <div className="hud-empty">Waiting for radio traffic…</div>
          ) : (
            displayCalls.map((call) => {
              const isSelected = call.id === selectedCallId;
              const isPlaying = call.id === playingCallId;
              const hasAudio = Boolean(call.audio) && call.encryption === "clear";

              return (
                <div
                  key={call.id}
                  className={`hud-row ${isSelected ? "selected" : ""} ${call.state === "active" ? "active-call" : ""}`}
                  onClick={() => onSelectCall(call)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") onSelectCall(call);
                  }}
                >
                  <div className="hud-row-top">
                    <span className={`cat-pill ${getCategoryClass(call.category)}`}>
                      {call.category}
                    </span>
                    <strong
                      className="tg-link"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenTalkgroup(call.talkgroupId);
                      }}
                      title={`Inspect Talkgroup ${call.talkgroupId}`}
                    >
                      {call.talkgroupLabel}
                    </strong>
                    <span className="freq">{formatFrequency(call.frequencyHz)}</span>
                    <span className="time">
                      {new Date(call.startedAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </span>
                    {call.state === "active" && <span className="live-blink">LIVE</span>}
                  </div>

                  <div className="hud-row-body">
                    <p className="transcript-preview">
                      {call.summary ?? call.transcript ?? (call.state === "active" ? "Receiving audio…" : "No transcript recorded")}
                    </p>
                  </div>

                  <div className="hud-row-bottom">
                    {call.location && (
                      <span className="location-tag">
                        ⌖ {call.location.label}
                      </span>
                    )}
                    <span className="duration">
                      {formatElapsed(call.startedAt, call.endedAt)}
                    </span>
                    {hasAudio && (
                      <button
                        type="button"
                        className={`hud-play-btn ${isPlaying ? "playing" : ""}`}
                        onClick={(e) => toggleRowPlay(e, call)}
                        title={isPlaying ? "Pause" : "Play"}
                      >
                        {isPlaying ? "❚❚ PAUSE" : "▶ PLAY"}
                      </button>
                    )}
                  </div>

                  {isPlaying && hasAudio && (
                    <div className="hud-audio-drawer" onClick={(e) => e.stopPropagation()}>
                      <audio
                        src={callAudioUrl(call.id)}
                        autoPlay
                        controls
                        onEnded={() => setPlayingCallId(null)}
                      />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
