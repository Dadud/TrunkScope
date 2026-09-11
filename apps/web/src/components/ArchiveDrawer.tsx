import { useState, useMemo } from "react";
import type { Call } from "../types";
import { formatElapsed, formatFrequency } from "../format";

const enrichmentLabels: Record<string, string> = {
  "address-normalization": "Address",
  "event-tagging": "Event category",
  "unit-extraction": "Units and call signs",
  "tone-classification": "Dispatch tone",
  correlation: "Related calls",
  "map-placement": "Map placement",
  location: "Location",
};

function enrichmentTaskLabel(task: string) {
  return enrichmentLabels[task] ?? task.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function enrichmentResult(item: Record<string, unknown>) {
  const ignored = new Set(["status", "confidence", "model", "provider", "promptVersion", "evidence", "raw", "error", "detail", "reason"]);
  const source = item.parsed && typeof item.parsed === "object" ? item.parsed as Record<string, unknown> : item;
  return Object.entries(source)
    .filter(([key, value]) => !ignored.has(key) && (typeof value === "string" || typeof value === "number" || typeof value === "boolean"))
    .map(([key, value]) => `${key.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())}: ${String(value)}`);
}

function enrichmentLists(item: Record<string, unknown>) {
  const source = item.parsed && typeof item.parsed === "object" ? item.parsed as Record<string, unknown> : item;
  return Object.entries(source).filter(([key, value]) =>
    !["evidence"].includes(key) && Array.isArray(value) && value.length > 0,
  ).map(([key, value]) => ({
    label: key.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
    values: value.map((entry) => typeof entry === "string" ? entry : JSON.stringify(entry)),
  }));
}
import { callAudioUrl, purgeCalls, undoPurgeCalls, retryCallEnrichment } from "../api";

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
  const [deleteAudio, setDeleteAudio] = useState(true);
  const [undoAvailable, setUndoAvailable] = useState(false);
  const [undoIds, setUndoIds] = useState<string[]>([]);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [retryMessage, setRetryMessage] = useState("");
  const [purging, setPurging] = useState(false);

  const categories = useMemo(() => {
    return Array.from(new Set(calls.map((c) => c.category))).sort();
  }, [calls]);

  const filteredCalls = useMemo(() => {
    return calls.filter((c) => {
      if (removedIds.includes(c.id)) return false;
      const matchesCat = selectedCategory === "all" || c.category === selectedCategory;
      const text = `${c.talkgroupLabel} ${c.talkgroupId} ${c.systemName} ${c.frequencyHz} ${formatFrequency(c.frequencyHz)} ${c.transcript ?? ""} ${c.location?.label ?? ""}`.toLowerCase();
      const matchesSearch = text.includes(search.trim().toLowerCase());
      return matchesCat && matchesSearch;
    });
  }, [calls, selectedCategory, search, removedIds]);

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
            aria-label="Search recordings"
            placeholder="Search channels, frequencies, transcripts, locations…"
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
          <h4>Remove recordings</h4>
          <label>
            Remove calls from last
            <input type="number" min={1} max={168} value={purgeHours} onChange={(e) => setPurgeHours(Number(e.target.value))} />
            hours
          </label>
          <div className="btn-row">
            <button
              type="button"
              className="danger-btn"
              disabled={purging || !Number.isInteger(purgeHours) || purgeHours < 1 || purgeHours > 168}
              onClick={async () => {
                const ids = filteredCalls.filter((call) => call.state !== "active" && new Date(call.startedAt).getTime() >= Date.now() - purgeHours * 3600000).map((call) => call.id);
                if (ids.length === 0) { setPurgeMessage("No completed recordings match the filters and time window."); return; }
                if (!window.confirm(`Delete ${ids.length} matching recordings${deleteAudio ? " and their audio" : " (metadata only)"} from the last ${purgeHours} hours?`)) return;
                setPurging(true);
                try {
                  const result = await purgeCalls({
                    callIds: ids,
                    deleteAudio,
                  });
                  setPurgeMessage(`Deleted ${result.removed} call${result.removed === 1 ? "" : "s"}${deleteAudio ? " and audio" : ""}`);
                  setUndoAvailable(result.removed > 0 && !deleteAudio);
                  setUndoIds(result.removed > 0 && !deleteAudio ? ids : []);
                  setRemovedIds((previous) => [...new Set([...previous, ...ids])]);
                  if (playingId && ids.includes(playingId)) setPlayingId(null);
                } catch (error) {
                  setPurgeMessage(error instanceof Error ? error.message : "Purge failed");
                } finally { setPurging(false); }
              }}
            >
              {purging ? "Removing…" : "Purge matching calls"}
            </button>
            {undoAvailable && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    const result = await undoPurgeCalls();
                    setPurgeMessage(`Restored ${result.removed} calls`);
                    setUndoAvailable(false);
                    setRemovedIds((previous) => previous.filter((id) => !undoIds.includes(id)));
                    setUndoIds([]);
                  } catch (error) {
                    setPurgeMessage(error instanceof Error ? error.message : "Undo failed");
                  }
                }}
              >
                Undo purge
              </button>
            )}
          </div>
          <label className="checkbox-label"><input type="checkbox" checked={deleteAudio} onChange={(event) => setDeleteAudio(event.target.checked)} /> Delete audio files too</label>
          {purgeMessage && <span>{purgeMessage}</span>}
        </div>

        <div className="archive-scroll-list">
          {filteredCalls.length === 0 && <p>No recordings match your filters.</p>}
          {retryMessage && <p role="status">{retryMessage}</p>}
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
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectCall(call);
                    if (call.location) onClose();
                  }
                }}
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
                    {call.transcript ?? "No transcript recorded"}
                  </p>
                </div>
                {call.enrichment && Object.keys(call.enrichment).length > 0 && (
                  <details className="ai-enrichment-details" onClick={(event) => event.stopPropagation()}>
                    <summary>AI enrichment ({Object.keys(call.enrichment).length} tasks)</summary>
                    <div className="ai-enrichment-list">
                      {Object.entries(call.enrichment).map(([task, value]) => {
                        const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
                        const canRetry = ["unit-extraction", "event-tagging", "address-normalization", "correlation", "map-placement"].includes(task)
                          && call.state === "complete" && call.encryption === "clear" && Boolean(call.transcript?.trim());
                        return <div key={task}>
                          <div className="enrichment-row-title"><strong>{enrichmentTaskLabel(task)}</strong><span className={`enrichment-status ${String(item.status ?? "recorded")}`}>{String(item.status ?? "recorded")}</span></div>
                          <span className="enrichment-meta">Confidence {typeof item.confidence === "number" ? item.confidence.toFixed(2) : "not reported"}{typeof item.model === "string" && ` · ${item.model}`}</span>
                          {enrichmentResult(item).map((result) => <p className="enrichment-result" key={result}>{result}</p>)}
                          {enrichmentLists(item).map((list) => <div className="enrichment-list-field" key={list.label}><strong>{list.label}</strong><ul>{list.values.map((entry) => <li key={entry}>{entry}</li>)}</ul></div>)}
                          {typeof item.error === "string" && <p role="alert">{item.error}{typeof item.detail === "string" ? `: ${item.detail}` : ""}</p>}
                          {typeof item.reason === "string" && <p>{item.reason}</p>}
                          {typeof item.raw === "string" && <details><summary>Provider response</summary><pre>{item.raw}</pre></details>}
                          {Array.isArray(item.evidence) && item.evidence.map((evidence, index) => {
                            const text = typeof evidence === "string" ? evidence : evidence && typeof evidence === "object" && typeof evidence.text === "string" ? evidence.text : null;
                            return text ? <blockquote key={index}>{text}</blockquote> : null;
                          })}
                          {canRetry && <button type="button" disabled={retrying !== null} onClick={async () => {
                            setRetrying(`${call.id}:${task}`);
                            setRetryMessage("");
                            try {
                              await retryCallEnrichment(call.id, task);
                              setRetryMessage(`${task}: retry requested.`);
                            } catch (error) {
                              setRetryMessage(error instanceof Error ? error.message : "Retry failed");
                            } finally { setRetrying(null); }
                          }}>{retrying === `${call.id}:${task}` ? "Requesting…" : "Retry"}</button>}
                        </div>;
                      })}
                    </div>
                  </details>
                )}

                <div className="card-bottom">
                  <span className="freq">{formatFrequency(call.frequencyHz)}</span>
                  <span className="duration">{formatElapsed(call.startedAt, call.endedAt)}</span>
                  {call.location && <span className="loc">⌖ {call.location.label}</span>}
                  <button
                    type="button"
                    className="danger-btn"
                    disabled={removingId !== null || call.state === "active"}
                    aria-label={`Remove ${call.talkgroupLabel}`}
                    onClick={async (event) => {
                      event.stopPropagation();
                      setRemovingId(call.id);
                      try {
                        const result = await purgeCalls({ callIds: [call.id], deleteAudio: true });
                        setRemovedIds((ids) => [...ids, call.id]);
                        if (playingId === call.id) setPlayingId(null);
                        setPurgeMessage(`Deleted ${result.removed} recording and its audio file.`);
                        setUndoAvailable(false);
                      } catch (error) {
                        setPurgeMessage(error instanceof Error ? error.message : "Remove failed");
                      } finally {
                        setRemovingId(null);
                      }
                    }}
                  >{removingId === call.id ? "Removing…" : "Remove"}</button>

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
