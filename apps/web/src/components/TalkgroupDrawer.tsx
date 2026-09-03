import { useEffect, useState } from "react";
import type { Call } from "../types";
import { conversationAudioUrl, type ConversationSession } from "../api";
import { formatElapsed, formatFrequency } from "../format";
import { AudioPlayer } from "./AudioPlayer";

interface TalkgroupDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  calls: Call[];
  selectedTalkgroupId?: number;
  onSelectCall: (call: Call) => void;
  volume: number;
}

export function TalkgroupDrawer({
  isOpen,
  onClose,
  calls,
  selectedTalkgroupId,
  onSelectCall,
  volume,
}: TalkgroupDrawerProps) {
  const [sessions, setSessions] = useState<ConversationSession[]>([]);
  const [selectedTg, setSelectedTg] = useState<number | undefined>(selectedTalkgroupId);
  const [search, setSearch] = useState("");

  useEffect(() => {
    setSelectedTg(selectedTalkgroupId);
  }, [selectedTalkgroupId]);

  useEffect(() => {
    if (!isOpen) return;
    fetch("/api/v1/operations/sessions")
      .then((res) => (res.ok ? res.json() : []))
      .then((data: ConversationSession[]) => setSessions(data))
      .catch(() => undefined);
  }, [isOpen]);

  if (!isOpen) return null;

  // Extract unique talkgroups from calls
  const talkgroupMap = new Map<number, { label: string; system: string; count: number; category: string }>();
  calls.forEach((c) => {
    const existing = talkgroupMap.get(c.talkgroupId);
    if (existing) {
      existing.count += 1;
    } else {
      talkgroupMap.set(c.talkgroupId, {
        label: c.talkgroupLabel,
        system: c.systemName,
        count: 1,
        category: c.category,
      });
    }
  });

  const talkgroups = Array.from(talkgroupMap.entries())
    .map(([id, info]) => ({ id, ...info }))
    .filter((tg) =>
      `${tg.id} ${tg.label} ${tg.system} ${tg.category}`
        .toLowerCase()
        .includes(search.toLowerCase())
    )
    .sort((a, b) => b.count - a.count);

  const activeTgId = selectedTg ?? talkgroups[0]?.id;
  const tgCalls = calls.filter((c) => c.talkgroupId === activeTgId);
  const tgSessions = sessions.filter((s) => s.talkgroupId === activeTgId);

  return (
    <div className="tactical-drawer-backdrop" onClick={onClose}>
      <aside className="tactical-drawer wide-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <div>
            <small className="eyebrow">DIRECTORY & SESSIONS</small>
            <h2>Talkgroup Intelligence</h2>
          </div>
          <button type="button" className="drawer-close-btn" onClick={onClose}>
            &times;
          </button>
        </div>

        <div className="drawer-split-layout">
          {/* Talkgroup Selector Column */}
          <div className="drawer-column selector-column">
            <input
              type="text"
              className="drawer-search"
              placeholder="Search talkgroups…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="selector-list">
              {talkgroups.map((tg) => (
                <button
                  key={tg.id}
                  type="button"
                  className={`tg-list-item ${tg.id === activeTgId ? "active" : ""}`}
                  onClick={() => setSelectedTg(tg.id)}
                >
                  <div className="tg-item-header">
                    <strong>{tg.label}</strong>
                    <span className="tg-pill">{tg.id}</span>
                  </div>
                  <div className="tg-item-sub">
                    <span>{tg.system}</span>
                    <b>{tg.count} calls</b>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Details & Sessions Column */}
          <div className="drawer-column details-column">
            {activeTgId ? (
              <>
                <div className="tg-detail-header">
                  <div>
                    <h3>{talkgroupMap.get(activeTgId)?.label ?? `Talkgroup ${activeTgId}`}</h3>
                    <p className="system-subtitle">
                      ID #{activeTgId} · {talkgroupMap.get(activeTgId)?.system} · Category: {talkgroupMap.get(activeTgId)?.category}
                    </p>
                  </div>
                </div>

                {/* Conversation Sessions with Merged Playback */}
                <div className="section-block">
                  <h4>Conversation Sessions ({tgSessions.length})</h4>
                  <p className="section-hint">
                    Short back-and-forth radio transmissions grouped by 10-second activity dwell.
                  </p>
                  {tgSessions.length === 0 ? (
                    <div className="empty-notice">No conversation sessions recorded yet.</div>
                  ) : (
                    <div className="sessions-scroll">
                      {tgSessions.map((session) => (
                        <div key={session.id} className="session-card">
                          <div className="session-card-header">
                            <span className={`session-state ${session.state}`}>
                              {session.state.toUpperCase()}
                            </span>
                            <span className="session-meta">
                              {session.callIds.length} segments
                            </span>
                          </div>

                          {session.audioKeys && session.audioKeys.length > 0 && (
                            <div className="session-audio-wrap">
                              <span className="player-label">MERGED SESSION AUDIO</span>
                              <AudioPlayer
                                src={conversationAudioUrl(session.id)}
                                volume={volume}
                              />
                            </div>
                          )}

                          {session.summary && (
                            <blockquote className="session-summary">
                              {session.summary}
                            </blockquote>
                          )}

                          {session.transcript && (
                            <pre className="session-transcript">
                              {session.transcript}
                            </pre>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Individual Call Timeline */}
                <div className="section-block">
                  <h4>Transmissions Timeline ({tgCalls.length})</h4>
                  <div className="calls-timeline-list">
                    {tgCalls.map((call) => (
                      <div
                        key={call.id}
                        className="timeline-call-item"
                        onClick={() => {
                          onSelectCall(call);
                          onClose();
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        <div className="timeline-meta">
                          <span className="time">
                            {new Date(call.startedAt).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                              second: "2-digit",
                            })}
                          </span>
                          <span className="freq">{formatFrequency(call.frequencyHz)}</span>
                          <span className="duration">
                            {formatElapsed(call.startedAt, call.endedAt)}
                          </span>
                          {call.location && <span className="loc">⌖ {call.location.label}</span>}
                        </div>
                        <p className="snippet">
                          {call.summary ?? call.transcript ?? "No transcript recorded"}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="empty-notice">Select a talkgroup to inspect.</div>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
