import type { Diagnostics, RuntimeStatus } from "../api";

interface HeaderProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  selectedCategory: string;
  onSelectCategory: (cat: string) => void;
  categoryCounts: Record<string, number>;
  totalCalls: number;
  volume: number;
  onVolumeChange: (vol: number) => void;
  muted: boolean;
  onToggleMute: () => void;
  autoPlay: boolean;
  onToggleAutoPlay: () => void;
  runtime?: RuntimeStatus;
  diagnostics?: Diagnostics;
  onOpenDrawer: (drawer: "operations" | "talkgroups" | "archive" | "appliance") => void;
  onLogout: () => void;
  username?: string;
}

export function Header({
  searchQuery,
  onSearchChange,
  selectedCategory,
  onSelectCategory,
  categoryCounts,
  totalCalls,
  volume,
  onVolumeChange,
  muted,
  onToggleMute,
  autoPlay,
  onToggleAutoPlay,
  runtime,
  diagnostics,
  onOpenDrawer,
  onLogout,
  username,
}: HeaderProps) {
  const pipelineState =
    diagnostics?.decoder.state === "connected" ||
    diagnostics?.decoder.state === "running-unverified"
      ? diagnostics.decoder.state
      : diagnostics?.capture.state ?? "unknown";

  const linkLabel = diagnostics?.simulated
    ? "SIMULATOR"
    : pipelineState === "connected"
    ? "DECODER ONLINE"
    : pipelineState === "ready"
    ? "RF READY"
    : "RF OFFLINE";

  const isOnline = pipelineState === "connected" || pipelineState === "ready";

  const categories = [
    { key: "all", label: "ALL", count: totalCalls },
    { key: "fire", label: "FIRE", count: categoryCounts.fire || 0 },
    { key: "ems", label: "EMS", count: categoryCounts.ems || 0 },
    { key: "law", label: "LAW", count: categoryCounts.law || 0 },
    { key: "traffic", label: "TRAFFIC", count: categoryCounts.traffic || 0 },
  ];

  return (
    <header className="tactical-header">
      <div className="header-left">
        <div className="brand-lockup">
          <span className="brand-pulse" />
          <span className="brand-symbol">⌁</span>
          <span className="brand-text">TRUNKSCOPE</span>
        </div>

        <div className={`status-pill ${isOnline ? "online" : "offline"}`}>
          <i />
          <span>{linkLabel}</span>
        </div>

        {runtime?.decoderConfigPending && (
          <div className="status-pill pending" title="Saved settings have not reached the running capture yet">
            <i />
            <span>PENDING APPLY</span>
          </div>
        )}

        {runtime?.aiWorkerStatus && runtime.aiWorkerStatus !== "disabled" && (
          <div className="ai-status-pill" title={`AI Status: ${runtime.aiWorkerStatus}`}>
            <span className="ai-icon">✦</span>
            <span>AI {runtime.aiWorkerStatus.toUpperCase()}</span>
          </div>
        )}
      </div>

      <div className="header-center">
        <div className="search-bar-wrapper">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
            <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
          </svg>
          <input
            type="text"
            placeholder="Search transcript, talkgroup, location…"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="tactical-search-input"
          />
          {searchQuery && (
            <button
              type="button"
              className="clear-search-btn"
              onClick={() => onSearchChange("")}
            >
              &times;
            </button>
          )}
        </div>

        <div className="category-filter-bar">
          {categories.map((cat) => (
            <button
              key={cat.key}
              type="button"
              className={`cat-tab ${selectedCategory === cat.key ? "active" : ""}`}
              onClick={() => onSelectCategory(cat.key)}
            >
              <span>{cat.label}</span>
              <b className="tab-count">{cat.count}</b>
            </button>
          ))}
        </div>
      </div>

      <div className="header-right">
        {/* Global Volume Controls */}
        <div className="volume-widget" title="Master Audio Controls">
          <button
            type="button"
            className={`mute-btn ${muted ? "muted" : ""}`}
            onClick={onToggleMute}
            aria-label={muted ? "Unmute Audio" : "Mute Audio"}
          >
            {muted ? (
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
              </svg>
            )}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            onChange={(e) => onVolumeChange(Number(e.target.value))}
            className="volume-slider"
          />
          <button
            type="button"
            className={`live-monitor-btn ${autoPlay ? "active" : ""}`}
            onClick={onToggleAutoPlay}
            title={autoPlay ? "Live monitor autoplay active" : "Enable autoplay for incoming calls"}
          >
            {autoPlay ? "AUTOPLAY ON" : "AUTOPLAY OFF"}
          </button>
        </div>

        {/* Drawer triggers */}
        <div className="nav-actions">
          <button
            type="button"
            className="nav-btn"
            onClick={() => onOpenDrawer("operations")}
            title="Open AI Operations Brief"
          >
            ⚡ BRIEF
          </button>
          <button
            type="button"
            className="nav-btn"
            onClick={() => onOpenDrawer("talkgroups")}
            title="Open Talkgroup & Session Directory"
          >
            📻 TALKGROUPS
          </button>
          <button
            type="button"
            className="nav-btn"
            onClick={() => onOpenDrawer("archive")}
            title="Open Call Archive"
          >
            🗄️ ARCHIVE
          </button>
          <button
            type="button"
            className="nav-btn admin-btn"
            onClick={() => onOpenDrawer("appliance")}
            title="Open Appliance Console (SDR, Scan lists, Settings)"
          >
            ⚙️ CONSOLE
          </button>
        </div>

        {username && (
          <button
            type="button"
            className="signout-btn"
            onClick={onLogout}
            title={`Signed in as ${username}. Click to log out.`}
          >
            SIGN OUT
          </button>
        )}
      </div>
    </header>
  );
}
