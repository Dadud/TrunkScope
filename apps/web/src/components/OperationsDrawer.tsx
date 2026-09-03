import { useEffect, useState } from "react";
import { askOperations, getOperationsSummary, type OperationsSummary as SummaryData } from "../api";

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
  const [drawerTab, setDrawerTab] = useState<"brief" | "ask">("brief");
  const [question, setQuestion] = useState("");
  const [askAnswer, setAskAnswer] = useState("");
  const [askStatus, setAskStatus] = useState("");
  const [askLoading, setAskLoading] = useState(false);

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
          <button type="button" className={`time-tab ${drawerTab === "brief" ? "active" : ""}`} onClick={() => setDrawerTab("brief")}>BRIEF</button>
          <button type="button" className={`time-tab ${drawerTab === "ask" ? "active" : ""}`} onClick={() => setDrawerTab("ask")}>ASK AI</button>
        </div>

        {drawerTab === "brief" && (
        <>
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
        </>
        )}

        {drawerTab === "ask" && (
          <div className="ops-ask-panel">
            <p className="pane-desc">Ask a natural-language question about recent radio traffic.</p>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="What fire or EMS activity happened near Pittsville in the last few hours?"
              rows={4}
            />
            <div className="btn-row">
              <button
                type="button"
                className="primary-btn"
                disabled={askLoading || !question.trim()}
                onClick={async () => {
                  setAskLoading(true);
                  setAskStatus("");
                  try {
                    const response = await askOperations(question, hours);
                    setAskAnswer(response.answer);
                    setAskStatus(response.status);
                  } catch (err) {
                    setAskAnswer(err instanceof Error ? err.message : "Ask failed");
                    setAskStatus("error");
                  } finally {
                    setAskLoading(false);
                  }
                }}
              >
                {askLoading ? "Thinking…" : "Ask"}
              </button>
            </div>
            {askAnswer && (
              <div className="ops-ai-card">
                <div className="ai-card-title">
                  <strong>Answer</strong>
                  {askStatus && <span className={`ai-badge ${askStatus}`}>{askStatus.toUpperCase()}</span>}
                </div>
                <p className="ai-narrative-text">{askAnswer}</p>
              </div>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
