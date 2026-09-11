import { useEffect, useMemo, useState } from "react";
import {
  getAuthStatus,
  getDiagnostics,
  getRuntime,
  getSession,
  getSettings,
  getSnapshot,
  getIncidents,
  login,
  logout,
  saveSettings,
  setupAdmin,
  subscribeToCalls,
  type AppSettings,
  type Diagnostics,
  type RuntimeStatus,
  type IncidentView,
} from "./api";
import type { Call, Receiver, Snapshot } from "./types";
import { Header } from "./components/Header";
import { MapConsole } from "./components/MapConsole";
import { LiveFeedHUD } from "./components/LiveFeedHUD";
import { IncidentFeed } from "./components/IncidentFeed";
import { IncidentDrawer } from "./components/IncidentDrawer";
import { OperationsDrawer } from "./components/OperationsDrawer";
import { TalkgroupDrawer } from "./components/TalkgroupDrawer";
import { ArchiveDrawer } from "./components/ArchiveDrawer";
import { ApplianceDrawer } from "./components/ApplianceDrawer";
import { MobileNav } from "./components/MobileNav";
import { FirstRunWizard } from "./components/FirstRunWizard";
import { useLiveAudio } from "./useLiveAudio";
import { callCategory, matchesCall } from "./callPresentation";

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
  const [incidents, setIncidents] = useState<IncidentView[]>([]);

  // Audio State
  const [volume, setVolume] = useState(0.75);
  const [muted, setMuted] = useState(false);
  const [autoPlay, setAutoPlay] = useState(false);
  const playbackError = useLiveAudio(data.calls, autoPlay, muted ? 0 : volume);

  // Telemetry & Settings
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [runtime, setRuntime] = useState<RuntimeStatus | undefined>();
  const [diagnostics, setDiagnostics] = useState<Diagnostics | undefined>();
  const [connectionError, setConnectionError] = useState("");

  // Auth
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authAttempt, setAuthAttempt] = useState(0);
  const [authRequired, setAuthRequired] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);
  const [session, setSession] = useState<{ username: string; role: string } | undefined>();

  // Drawers
  const [activeDrawer, setActiveDrawer] = useState<"operations" | "talkgroups" | "archive" | "appliance" | "settings" | "incidents" | null>(null);
  const [inspectedTalkgroupId, setInspectedTalkgroupId] = useState<number | undefined>();

  // Initial Auth Check
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    setAuthError("");
    getAuthStatus(controller.signal)
      .then(async (status) => {
        if (!active) return;
        setSetupRequired(Boolean(status.setupRequired));
        setAuthRequired(status.enabled && !status.localOnly);
        if (!status.enabled || status.localOnly) {
          if (status.localOnly) setSession({ username: "local", role: "administrator" });
          setAuthReady(true);
          return;
        }
        const nextSession = await getSession(controller.signal);
        if (!active) return;
        setSession(nextSession);
        setAuthReady(true);
      })
      .catch(() => { if (active) setAuthError("Cannot reach the appliance. Check its connection and try again."); })
      .finally(() => window.clearTimeout(timeout));
    return () => { active = false; window.clearTimeout(timeout); controller.abort(); };
  }, [authAttempt]);

  // Periodic Polling
  useEffect(() => {
    if (!authReady || (authRequired && !session)) return;
    const refresh = () => {
      getRuntime().then(setRuntime).catch(() => undefined);
      getDiagnostics().then(setDiagnostics).catch(() => undefined);
      getSnapshot().then((snapshot) => {
        setData(snapshot);
        setConnectionError("");
      }).catch(() => setConnectionError("Appliance connection lost. Displayed calls may be stale; reconnecting…"));
      getIncidents().then(setIncidents).catch(() => undefined);
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

  // WebSocket Live Call Stream
  useEffect(() => {
    if (!authReady || (authRequired && !session)) return;
    const controller = new AbortController();
    getSnapshot(controller.signal)
      .then(setData)
      .catch(() => undefined);

    const unsubscribe = subscribeToCalls(
      (event) => {
        setData((curr) => {
          const updated = [
            event.payload,
            ...curr.calls.filter((c) => c.id !== event.payload.id),
          ].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 150);

          return { ...curr, calls: updated };
        });
      },
      () => undefined
    );

    return () => {
      controller.abort();
      unsubscribe();
    };
  }, [authReady, authRequired, session]);

  // Default selected call
  useEffect(() => {
    setSelectedCall((current) => current
      ? data.calls.find((call) => call.id === current.id) ?? current
      : data.calls[0]);
  }, [data.calls]);

  // Category counts
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { fire: 0, ems: 0, law: 0, traffic: 0, other: 0 };
    data.calls.forEach((call) => {
      counts[callCategory(call.category)]++;
    });
    return counts;
  }, [data.calls]);

  // Filter calls by search and category
  const filteredCalls = useMemo(() => {
    return data.calls.filter((call) => matchesCall(call, selectedCategory, searchQuery))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }, [data.calls, selectedCategory, searchQuery]);

  const homeCoords: [number, number] = useMemo(() => {
    if (settings?.homeLongitude != null && settings?.homeLatitude != null) {
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
          {authError ? <><p role="alert">{authError}</p><button type="button" onClick={() => setAuthAttempt(attempt => attempt + 1)}>Retry connection</button></> : <p className="loading-text">Connecting to appliance…</p>}
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
      {settings && !settings.wizardCompleted && (
        <FirstRunWizard
          settings={settings}
          onComplete={(saved) => setSettings(saved)}
          onDismiss={async () => {
            try {
              const saved = await saveSettings({ ...settings, wizardCompleted: true });
              setSettings(saved);
            } catch {
              setSettings({ ...settings, wizardCompleted: true });
            }
          }}
        />
      )}
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
        {(connectionError || playbackError) && <div role="alert" className="console-alert">{connectionError || playbackError}</div>}
        <MapConsole
          calls={filteredCalls}
          selectedCall={selectedCall}
          volume={muted ? 0 : volume}
          homeCenter={homeCoords}
          isAdmin={Boolean(session)}
          onSelectCall={setSelectedCall}
          onOpenTalkgroup={handleOpenTalkgroup}
          onCallUpdated={(call) => {
            setData((current) => ({
              ...current,
              calls: current.calls.map((item) => (item.id === call.id ? call : item)),
            }));
            setSelectedCall((current) => (current?.id === call.id ? call : current));
          }}
        />

        {/* Floating Live Feed HUD Overlay */}
        <LiveFeedHUD
          calls={filteredCalls}
          selectedCallId={selectedCall?.id}
          volume={muted ? 0 : volume}
          onSelectCall={setSelectedCall}
          onOpenTalkgroup={handleOpenTalkgroup}
          onOpenOperations={() => setActiveDrawer("operations")}
        />
        <IncidentFeed incidents={incidents} onSelectCall={(id) => {
          const call = data.calls.find((item) => item.id === id);
          if (call) setSelectedCall(call);
        }} />
      </main>

      <MobileNav active={activeDrawer} onOpen={setActiveDrawer} />

      <IncidentDrawer isOpen={activeDrawer === "incidents"} incidents={incidents} onClose={() => setActiveDrawer(null)} onSelectCall={(id) => { const call = data.calls.find((item) => item.id === id); if (call) { setSelectedCall(call); setActiveDrawer(null); } }} />

      {/* Drawers */}
      <OperationsDrawer
        isOpen={activeDrawer === "operations"}
        onClose={() => setActiveDrawer(null)}
        refreshMinutes={settings?.summaryRefreshMinutes ?? 15}
        defaultLookbackHours={settings?.summaryLookbackHours ?? 4}
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
        isOpen={activeDrawer === "appliance" || activeDrawer === "settings"}
        section={activeDrawer === "settings" ? "settings" : "radio"}
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
