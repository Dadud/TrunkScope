import { useState, useMemo } from "react";
import type { Call } from "../types";
import { formatElapsed, formatFrequency } from "../format";
import { callAudioUrl, purgeCalls, undoPurgeCalls } from "../api";

interface ArchiveDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  calls: Call[];
  onSelectCall: (call: Call) => void;
}

export function ArchiveDrawer({ isOpen, onClose, calls, onSelectCall }: ArchiveDrawerProps) {
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [purgeHours, setPurgeHours] = useState(24);
  const [purgeMessage, setPurgeMessage] = useState("");
  const [undoAvailable, setUndoAvailable] = useState(false);

  const categories = useMemo(() => {
    return Array.from(new Set(calls.map((c) => c.category))).sort();
  }, [calls]);

  const filteredCalls = useMemo(() => {
    return calls.filter((c) => {
      const matchesCat = selectedCategory === "all" || c.category === selectedCategory;
      const text = `${c.talkgroupLabel} ${c.talkgroupId} ${c.systemName} ${c.transcript ?? ""} ${c.location?.label ?? ""}`.toLowerCase();
      const matchesSearch = text.includes(search.toLowerCase());
      return matchesCat && matchesSearch;
    });
  }, [calls, selectedCategory, search]);

  if (!isOpen) return null;

  return (
    <div className="tactical-drawer-backdrop" onClick={onClose}>
      <aside className="tactical-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <div>
            <small className="eyebrow">HISTORICAL RECORD</small>
            <h2>Call Archive</h2>
          </div>
          <button type="button" className="drawer-close-btn" onClick={onClose}>
            &times;
          </button>
        </div>

        <div className="archive-filters">
          <input
            type="text"
            className="drawer-search"
            placeholder="Search transcripts, talkgroups, locations…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="archive-cat-select"
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
          >
            <option value="all">All Categories ({calls.length})</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>

        <div className="archive-results-info">
          <span>{filteredCalls.length} recorded calls found</span>
        </div>

        <div className="archive-purge-panel">
          <h4>Admin purge</h4>
          <label>
            Remove calls from last
            <input type="number" min={1} max={168} value={purgeHours} onChange={(e) => setPurgeHours(Number(e.target.value))} />
            hours
          </label>
          <div className="btn-row">
            <button
              type="button"
              className="danger-btn"
              onClick={async () => {
                if (!window.confirm(`Remove calls from the last ${purgeHours} hours?`)) return;
                try {
                  const result = await purgeCalls({
                    hours: purgeHours,
                    category: selectedCategory === "all" ? undefined : selectedCategory,
                  });
                  setPurgeMessage(`Removed ${result.removed} calls`);
                  setUndoAvailable(result.removed > 0);
                } catch (error) {
                  setPurgeMessage(error instanceof Error ? error.message : "Purge failed");
                }
              }}
            >
              Purge matching calls
            </button>
            {undoAvailable && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    const result = await undoPurgeCalls();
                    setPurgeMessage(`Restored ${result.removed} calls`);
                    setUndoAvailable(false);
                  } catch (error) {
                    setPurgeMessage(error instanceof Error ? error.message : "Undo failed");
                  }
                }}
              >
                Undo purge
              </button>
            )}
          </div>
          {purgeMessage && <span>{purgeMessage}</span>}
        </div>

        <div className="archive-scroll-list">
          {filteredCalls.map((call) => {
            const hasAudio = Boolean(call.audio) && call.encryption === "clear";
            const isPlaying = playingId === call.id;

            return (
              <div
                key={call.id}
                className="archive-call-card"
                onClick={() => {
                  onSelectCall(call);
                  if (call.location) onClose();
                }}
                role="button"
                tabIndex={0}
              >
                <div className="card-top">
                  <span className="time">
                    {new Date(call.startedAt).toLocaleString([], {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </span>
                  <span className="cat-pill">{call.category}</span>
                  <strong>{call.talkgroupLabel}</strong>
                  <span className="system">{call.systemName}</span>
                </div>

                <div className="card-mid">
                  <p className="transcript">
                    {call.summary ?? call.transcript ?? "No transcript recorded"}
                  </p>
                </div>

                <div className="card-bottom">
                  <span className="freq">{formatFrequency(call.frequencyHz)}</span>
                  <span className="duration">{formatElapsed(call.startedAt, call.endedAt)}</span>
                  {call.location && <span className="loc">⌖ {call.location.label}</span>}

                  {hasAudio && (
                    <button
                      type="button"
                      className={`archive-play-btn ${isPlaying ? "playing" : ""}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setPlayingId(isPlaying ? null : call.id);
                      }}
                    >
                      {isPlaying ? "❚❚ PAUSE" : "▶ PLAY"}
                    </button>
                  )}
                </div>

                {isPlaying && hasAudio && (
                  <div className="archive-audio-player" onClick={(e) => e.stopPropagation()}>
                    <audio src={callAudioUrl(call.id)} controls autoPlay onEnded={() => setPlayingId(null)} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </aside>
    </div>
  );
}
