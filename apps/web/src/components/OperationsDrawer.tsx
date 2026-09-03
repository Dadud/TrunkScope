import { useEffect, useState } from "react";
import { getOperationsSummary, type OperationsSummary as SummaryData } from "../api";

interface OperationsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  refreshMinutes?: number;
}

export function OperationsDrawer({ isOpen, onClose, refreshMinutes = 15 }: OperationsDrawerProps) {
  const [hours, setHours] = useState<number>(4);
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSummary = async (h: number) => {
    setLoading(true);
    setError(null);
    try {
      const data = await getOperationsSummary(h);
      setSummary(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load operations brief");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    fetchSummary(hours);
    const interval = setInterval(() => fetchSummary(hours), refreshMinutes * 60 * 1000);
    return () => clearInterval(interval);
  }, [isOpen, hours, refreshMinutes]);

  if (!isOpen) return null;

  return (
    <div className="tactical-drawer-backdrop" onClick={onClose}>
      <aside className="tactical-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <div>
            <small className="eyebrow">TACTICAL SITREP</small>
            <h2>AI Operations Brief</h2>
          </div>
          <button type="button" className="drawer-close-btn" onClick={onClose}>
            &times;
          </button>
        </div>

        <div className="ops-time-tabs">
          {[1, 4, 12, 24].map((h) => (
            <button
              key={h}
              type="button"
              className={`time-tab ${hours === h ? "active" : ""}`}
              onClick={() => {
                setHours(h);
                fetchSummary(h);
              }}
            >
              {h}H WINDOW
            </button>
          ))}
        </div>

        {loading && <div className="ops-loading">Synthesizing operations brief…</div>}
        {error && <div className="ops-error">{error}</div>}

        {summary && !loading && (
          <div className="ops-content">
            <div className="ops-headline-card">
              <div className="headline-meta">
                <span className="count-tag">{summary.callCount} calls recorded</span>
                <span className="count-tag">{summary.activeThreadCount} active threads</span>
                <span className="updated-tag">
                  {new Date(summary.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
              <p className="headline-text">{summary.headline}</p>
            </div>

            {/* AI Narrative Brief */}
            <div className="ops-ai-card">
              <div className="ai-card-title">
                <span className="ai-sparkle">✦</span>
                <strong>AI DISPATCH NARRATIVE</strong>
                <span className={`ai-badge ${summary.aiSummaryStatus}`}>
                  {summary.aiSummaryStatus?.toUpperCase()}
                </span>
              </div>
              {summary.aiSummary ? (
                <p className="ai-narrative-text">{summary.aiSummary}</p>
              ) : (
                <p className="ai-fallback-text">
                  AI narrative brief unavailable ({summary.aiSummaryStatus ?? "disabled"}). Structured incidents below reflect verified radio traffic.
                </p>
              )}
            </div>

            {/* Incident Threads */}
            <div className="ops-threads-section">
              <h3>Incident Threads ({summary.threads.length})</h3>
              <div className="threads-list">
                {summary.threads.map((thread) => (
                  <div key={thread.key} className="incident-thread-card">
                    <div className="thread-card-header">
                      <div className="thread-title">
                        <strong>{thread.talkgroupLabel}</strong>
                        <span className="system-tag">{thread.systemName}</span>
                      </div>
                      <span className={`severity-tag sev-${thread.severity}`}>
                        SEV {thread.severity}/5
                      </span>
                    </div>

                    <div className="thread-meta-row">
                      <span>{thread.callCount} calls</span>
                      <span>Category: {thread.category}</span>
                      <span>
                        {new Date(thread.firstSeen).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} -{" "}
                        {new Date(thread.lastSeen).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>

                    {thread.locations.length > 0 && (
                      <div className="thread-locations">
                        {thread.locations.map((loc, i) => (
                          <span key={i} className="loc-chip">
                            ⌖ {loc.label}
                          </span>
                        ))}
                      </div>
                    )}

                    {thread.excerpts.length > 0 && (
                      <div className="thread-excerpts">
                        {thread.excerpts.map((ex, i) => (
                          <blockquote key={i}>{ex}</blockquote>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
