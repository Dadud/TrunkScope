import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import {
  callAudioUrl,
  getAuthStatus,
  getDiagnostics,
  getRuntime,
  getSession,
  getSettings,
  getSnapshot,
  login,
  logout,
  setupAdmin,
  subscribeToCalls,
  type AppSettings,
  type Diagnostics,
  type RuntimeStatus,
} from "./api";
import type { Call, Receiver, Snapshot } from "./types";
import { Header } from "./components/Header";
import { MapConsole } from "./components/MapConsole";
import { LiveFeedHUD } from "./components/LiveFeedHUD";
import { OperationsDrawer } from "./components/OperationsDrawer";
import { TalkgroupDrawer } from "./components/TalkgroupDrawer";
import { ArchiveDrawer } from "./components/ArchiveDrawer";
import { ApplianceDrawer } from "./components/ApplianceDrawer";

const emptySnapshot: Snapshot = {
  receivers: [],
  calls: [],
  publicPolicy: {
    enabled: false,
    delaySeconds: 120,
    allowedTalkgroups: [],
    exposeTranscripts: false,
    exposeRadioIds: false,
    exposePreciseLocations: false,
  },
};

export default function App() {
  const [data, setData] = useState<Snapshot>(emptySnapshot);
  const [selectedCall, setSelectedCall] = useState<Call | undefined>();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");

  // Audio State
  const [volume, setVolume] = useState(0.75);
  const [muted, setMuted] = useState(false);
  const [autoPlay, setAutoPlay] = useState(false);
  const autoPlayAudioRef = useRef<HTMLAudioElement | null>(null);

  // Telemetry & Settings
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [runtime, setRuntime] = useState<RuntimeStatus | undefined>();
  const [diagnostics, setDiagnostics] = useState<Diagnostics | undefined>();

  // Auth
  const [authReady, setAuthReady] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);
  const [session, setSession] = useState<{ username: string; role: string } | undefined>();

  // Drawers
  const [activeDrawer, setActiveDrawer] = useState<"operations" | "talkgroups" | "archive" | "appliance" | null>(null);
  const [inspectedTalkgroupId, setInspectedTalkgroupId] = useState<number | undefined>();

  // Initial Auth Check
  useEffect(() => {
    getAuthStatus()
      .then(async (status) => {
        setSetupRequired(Boolean(status.setupRequired));
        setAuthRequired(status.enabled && !status.localOnly);
        if (!status.enabled || status.localOnly) {
          if (status.localOnly) setSession({ username: "local", role: "administrator" });
          setAuthReady(true);
          return;
        }
        setSession(await getSession());
        setAuthReady(true);
      })
      .catch(() => setAuthReady(true));
  }, []);

  // Periodic Polling
  useEffect(() => {
    if (!authReady || (authRequired && !session)) return;
    const refresh = () => {
      getRuntime().then(setRuntime).catch(() => undefined);
      getDiagnostics().then(setDiagnostics).catch(() => undefined);
      getSnapshot().then(setData).catch(() => undefined);
    };
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
  }, [authReady, authRequired, session]);

  // Load Settings
  useEffect(() => {
    if (!authReady || (authRequired && !session)) return;
    getSettings().then(setSettings).catch(() => undefined);
  }, [authReady, authRequired, session]);

  // Handle Autoplay for incoming calls
  const triggerAutoPlay = useCallback(
    (call: Call) => {
      if (!autoPlay || muted || call.encryption !== "clear" || !call.audio) return;
      if (!autoPlayAudioRef.current) {
        autoPlayAudioRef.current = new Audio();
      }
      const audio = autoPlayAudioRef.current;
      audio.volume = Math.max(0, Math.min(1, volume));
      audio.src = callAudioUrl(call.id);
      audio.play().catch(() => undefined);
    },
    [autoPlay, muted, volume]
  );

  // WebSocket Live Call Stream
  useEffect(() => {
    const controller = new AbortController();
    getSnapshot(controller.signal)
      .then(setData)
      .catch(() => undefined);

    const unsubscribe = subscribeToCalls(
      (event) => {
        setData((curr) => {
          const exists = curr.calls.some((c) => c.id === event.payload.id);
          const updated = [
            event.payload,
            ...curr.calls.filter((c) => c.id !== event.payload.id),
          ].slice(0, 150);

          if (!exists && event.payload.state === "complete") {
            triggerAutoPlay(event.payload);
          }
          return { ...curr, calls: updated };
        });
      },
      () => undefined
    );

    return () => {
      controller.abort();
      unsubscribe();
    };
  }, [triggerAutoPlay]);

  // Default selected call
  useEffect(() => {
    if (!selectedCall && data.calls.length > 0) {
      setSelectedCall(data.calls[0]);
    }
  }, [data.calls, selectedCall]);

  // Category counts
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { fire: 0, ems: 0, law: 0, traffic: 0, other: 0 };
    data.calls.forEach((call) => {
      const c = call.category.toLowerCase();
      if (c.includes("fire") || c.includes("structure") || c.includes("alarm")) counts.fire++;
      else if (c.includes("medical") || c.includes("ems") || c.includes("rescue")) counts.ems++;
      else if (c.includes("police") || c.includes("law") || c.includes("sheriff")) counts.law++;
      else if (c.includes("traffic") || c.includes("crash") || c.includes("collision")) counts.traffic++;
      else counts.other++;
    });
    return counts;
  }, [data.calls]);

  // Filter calls by search and category
  const filteredCalls = useMemo(() => {
    return data.calls.filter((call) => {
      const c = call.category.toLowerCase();
      let matchCat = true;
      if (selectedCategory === "fire") matchCat = c.includes("fire") || c.includes("structure") || c.includes("alarm");
      else if (selectedCategory === "ems") matchCat = c.includes("medical") || c.includes("ems") || c.includes("rescue");
      else if (selectedCategory === "law") matchCat = c.includes("police") || c.includes("law") || c.includes("sheriff");
      else if (selectedCategory === "traffic") matchCat = c.includes("traffic") || c.includes("crash") || c.includes("collision");

      const matchSearch =
        !searchQuery ||
        `${call.talkgroupLabel} ${call.talkgroupId} ${call.systemName} ${call.transcript ?? ""} ${call.location?.label ?? ""}`
          .toLowerCase()
          .includes(searchQuery.toLowerCase());

      return matchCat && matchSearch;
    });
  }, [data.calls, selectedCategory, searchQuery]);

  const homeCoords: [number, number] = useMemo(() => {
    if (settings?.homeLongitude && settings?.homeLatitude) {
      return [settings.homeLongitude, settings.homeLatitude];
    }
    return [-90.5785, 44.3984];
  }, [settings]);

  const handleOpenTalkgroup = (tgId: number) => {
    setInspectedTalkgroupId(tgId);
    setActiveDrawer("talkgroups");
  };

  const handleUpdateReceiver = (updated: Receiver) => {
    setData((curr) => ({
      ...curr,
      receivers: [...curr.receivers.filter((r) => r.id !== updated.id), updated],
    }));
  };

  const handleRemoveReceiver = (id: string) => {
    setData((curr) => ({
      ...curr,
      receivers: curr.receivers.filter((r) => r.id !== id),
    }));
  };

  if (!authReady) {
    return (
      <main className="login-shell">
        <div className="login-card">
          <div className="brand">
            <span className="brand-mark">⌁</span>
            <span>TRUNKSCOPE</span>
          </div>
          <p className="loading-text">Initializing Tactical Console…</p>
        </div>
      </main>
    );
  }

  if (setupRequired) {
    return <SetupView onComplete={() => window.location.reload()} />;
  }

  if (authRequired && !session) {
    return <LoginView onLogin={setSession} />;
  }

  return (
    <div className="tactical-app-root">
      {/* Top Header Controls */}
      <Header
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        selectedCategory={selectedCategory}
        onSelectCategory={setSelectedCategory}
        categoryCounts={categoryCounts}
        totalCalls={data.calls.length}
        volume={volume}
        onVolumeChange={setVolume}
        muted={muted}
        onToggleMute={() => setMuted((v) => !v)}
        autoPlay={autoPlay}
        onToggleAutoPlay={() => setAutoPlay((v) => !v)}
        runtime={runtime}
        diagnostics={diagnostics}
        onOpenDrawer={setActiveDrawer}
        onLogout={() => void logout().finally(() => setSession(undefined))}
        username={session?.username}
      />

      {/* Main Full-Screen Map Console */}
      <main className="tactical-map-viewport">
        <MapConsole
          calls={filteredCalls}
          selectedCall={selectedCall}
          volume={muted ? 0 : volume}
          homeCenter={homeCoords}
          onSelectCall={setSelectedCall}
          onOpenTalkgroup={handleOpenTalkgroup}
        />

        {/* Floating Live Feed HUD Overlay */}
        <LiveFeedHUD
          calls={filteredCalls}
          selectedCallId={selectedCall?.id}
          volume={muted ? 0 : volume}
          onSelectCall={setSelectedCall}
          onOpenTalkgroup={handleOpenTalkgroup}
        />
      </main>

      {/* Drawers */}
      <OperationsDrawer
        isOpen={activeDrawer === "operations"}
        onClose={() => setActiveDrawer(null)}
        refreshMinutes={settings?.summaryRefreshMinutes ?? 15}
      />

      <TalkgroupDrawer
        isOpen={activeDrawer === "talkgroups"}
        onClose={() => {
          setActiveDrawer(null);
          setInspectedTalkgroupId(undefined);
        }}
        calls={data.calls}
        selectedTalkgroupId={inspectedTalkgroupId}
        onSelectCall={setSelectedCall}
        volume={muted ? 0 : volume}
      />

      <ArchiveDrawer
        isOpen={activeDrawer === "archive"}
        onClose={() => setActiveDrawer(null)}
        calls={data.calls}
        onSelectCall={setSelectedCall}
      />

      <ApplianceDrawer
        isOpen={activeDrawer === "appliance"}
        onClose={() => setActiveDrawer(null)}
        snapshot={data}
        onUpdateReceiver={handleUpdateReceiver}
        onRemoveReceiver={handleRemoveReceiver}
      />
    </div>
  );
}

function SetupView({ onComplete }: { onComplete: () => void }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await setupAdmin(username, password);
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Setup failed");
    }
  };

  return (
    <main className="login-shell">
      <form className="login-card" onSubmit={submit}>
        <div className="brand">
          <span className="brand-mark">⌁</span>
          <span>TRUNKSCOPE</span>
        </div>
        <p className="eyebrow">FIRST-RUN SECURITY</p>
        <h1>Create Administrator</h1>
        <p className="settings-help">
          Configure initial appliance credentials for receivers, AI, and storage access.
        </p>
        <label>
          Username
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
          />
        </label>
        <label>
          Password (min 12 characters)
          <input
            type="password"
            minLength={12}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </label>
        {error && <div className="notice error">{error}</div>}
        <button className="primary-btn submit-btn" type="submit">
          INITIALIZE APPLIANCE
        </button>
      </form>
    </main>
  );
}

function LoginView({ onLogin }: { onLogin: (session: { username: string; role: string }) => void }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      onLogin(await login(username, password));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    }
  };

  return (
    <main className="login-shell">
      <form className="login-card" onSubmit={submit}>
        <div className="brand">
          <span className="brand-mark">⌁</span>
          <span>TRUNKSCOPE</span>
        </div>
        <p className="eyebrow">TACTICAL SCANNER</p>
        <h1>Sign In</h1>
        <label>
          Username
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        {error && <div className="notice error">{error}</div>}
        <button className="primary-btn submit-btn" type="submit">
          ENTER CONSOLE
        </button>
      </form>
    </main>
  );
}
