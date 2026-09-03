import { useState, useEffect, type ChangeEvent } from "react";
import type { Receiver, Snapshot } from "../types";
import {
  changePassword,
  createReceiver,
  deleteReceiver,
  deleteScanList,
  deleteSystem,
  deleteTalkgroup,
  discoverReceivers,
  discoverSummaryModels,
  discoverTranscribeModels,
  getAuditLog,
  getAuthStatus,
  getDecoderConfig,
  getDiagnostics,
  getDiscordStatus,
  getGeocoderStatus,
  getPublicPolicy,
  getReceiverCapabilities,
  getReceiverPresets,
  getRuntime,
  getScanLists,
  getSettings,
  getSummaryStatus,
  getSystems,
  getTalkgroups,
  getTranscribeStatus,
  importTalkgroups,
  importSites,
  receiverAction,
  savePublicPolicy,
  saveScanList,
  saveSettings,
  saveSystem,
  saveTalkgroup,
  startScanList,
  stopScanList,
  testDiscordWebhook,
  testGeocoderIntegration,
  testSummaryIntegration,
  testTranscribeIntegration,
  AI_STACK_PRESETS,
  updateReceiver,
  verifyReceiver,
  type AppSettings,
  type AuditEntry,
  type DiscordKeywordRule,
  type DiscordTalkgroupRule,
  type IntegrationStatus,
  type PublicationPolicy,
  type ReceiverDevicePreset,
  type ReceiverInput,
  type ScanList,
  type SystemProfile,
  type Talkgroup,
} from "../api";
import { SitesEditor } from "../SitesEditor";
import { IntegrationModelField } from "./IntegrationModelField";
import { MhzField } from "./MhzField";
import { applySubmodelPreset, presetSummary } from "../receiverPresets";
import { deriveAiProfile, pickSummaryModel, pickTranscribeModel } from "../integrationModels";
import { formatFrequency, signalQuality } from "../format";

interface ApplianceDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  snapshot: Snapshot;
  onUpdateReceiver: (receiver: Receiver) => void;
  onRemoveReceiver: (id: string) => void;
}

type Tab = "radio" | "receivers" | "scanlists" | "systems" | "talkgroups" | "integrations" | "policy" | "security" | "diagnostics";

const DRIVER_OPTIONS: Array<{ value: ReceiverInput["driver"]; label: string }> = [
  { value: "sdrplay", label: "SDRplay RSP" },
  { value: "rtlSdr", label: "RTL-SDR" },
  { value: "airspy", label: "Airspy" },
  { value: "hackRf", label: "HackRF" },
  { value: "plutoSdr", label: "PlutoSDR" },
  { value: "bladeRf", label: "bladeRF" },
  { value: "limeSdr", label: "LimeSDR" },
  { value: "genericSoapy", label: "Generic Soapy" },
  { value: "simulator", label: "Simulator" },
];

// Mirrors soapy_driver_arg() in apps/control-plane/src/receiver_presets.rs
const SOAPY_DRIVER_ARGS: Record<ReceiverInput["driver"], string> = {
  sdrplay: "sdrplay",
  rtlSdr: "rtlsdr",
  airspy: "airspy",
  hackRf: "hackrf",
  plutoSdr: "plutosdr",
  bladeRf: "bladerf",
  limeSdr: "lms",
  genericSoapy: "driver",
  simulator: "driver",
};

const parseNacHex = (raw: string): number | undefined => {
  const text = raw.trim().replace(/^0x/i, "");
  if (!text || !/^[0-9a-f]+$/i.test(text)) return undefined;
  const value = Number.parseInt(text, 16);
  return value >= 0 && value <= 0xfff ? value : undefined;
};

export function ApplianceDrawer({
  isOpen,
  onClose,
  snapshot,
  onUpdateReceiver,
  onRemoveReceiver,
}: ApplianceDrawerProps) {
  const [activeTab, setActiveTab] = useState<Tab>("receivers");
  const [statusMessage, setStatusMessage] = useState("");
  const [runtime, setRuntime] = useState<Awaited<ReturnType<typeof getRuntime>>>();
  const [diagnostics, setDiagnostics] = useState<Awaited<ReturnType<typeof getDiagnostics>>>();
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [decoderConfig, setDecoderConfig] = useState<string>("");
  const [talkgroups, setTalkgroups] = useState<Talkgroup[]>([]);
  const [talkgroupDraft, setTalkgroupDraft] = useState<Talkgroup>({ id: "", systemId: "00000000-0000-0000-0000-000000000000", decimalId: 0, alphaTag: "New talkgroup", description: "", category: "Unknown", enabled: true, record: true, publicAllowed: false });
  const [policy, setPolicy] = useState<PublicationPolicy>({ enabled: false, delaySeconds: 120, allowedTalkgroups: [], exposeTranscripts: false, exposeRadioIds: false, exposePreciseLocations: false });
  const [localOnly, setLocalOnly] = useState(false);
  const [activeScanListId, setActiveScanListId] = useState<string>();

  // Receivers State
  const [editingReceiverId, setEditingReceiverId] = useState<string | null>(null);
  const [receiverDraft, setReceiverDraft] = useState<ReceiverInput>({
    label: "New SDR",
    driver: "sdrplay",
    serial: "",
    centerFrequencyHz: 154_000_000,
    sampleRateHz: 2_400_000,
    gainDb: 40,
    ppm: 0,
    enabled: true,
    role: "general",
    soapyIndex: 0,
  });
  const [discoveredDevices, setDiscoveredDevices] = useState<Awaited<ReturnType<typeof discoverReceivers>>>([]);
  const [devicePresets, setDevicePresets] = useState<ReceiverDevicePreset[]>([]);
  const [submodelId, setSubmodelId] = useState("");
  const [integrationStatus, setIntegrationStatus] = useState<{
    transcribe?: IntegrationStatus;
    summary?: IntegrationStatus;
    geocoder?: IntegrationStatus;
    discord?: IntegrationStatus;
  }>({});
  const [transcribeModels, setTranscribeModels] = useState<string[]>([]);
  const [summaryModels, setSummaryModels] = useState<string[]>([]);
  const [transcribeModelSource, setTranscribeModelSource] = useState<string>();
  const [summaryModelSource, setSummaryModelSource] = useState<string>();
  const [transcribeModelsLoading, setTranscribeModelsLoading] = useState(false);
  const [summaryModelsLoading, setSummaryModelsLoading] = useState(false);
  const [transcribeModelsError, setTranscribeModelsError] = useState<string>();
  const [summaryModelsError, setSummaryModelsError] = useState<string>();
  const [showAddReceiver, setShowAddReceiver] = useState(false);

  // Scan Lists State
  const [scanLists, setScanLists] = useState<ScanList[]>([]);
  const [editingScanList, setEditingScanList] = useState<ScanList | null>(null);

  // Systems State
  const [systems, setSystems] = useState<SystemProfile[]>([]);
  const [systemDraft, setSystemDraft] = useState<SystemProfile>({
    id: "",
    name: "New System",
    protocol: "p25",
    controlChannelHz: 851012500,
    nac: 293,
    sites: [],
  });

  // Settings State
  const [settings, setSettings] = useState<AppSettings | null>(null);

  // Password Rotation State
  const [adminUser, setAdminUser] = useState("admin");
  const [newPassword, setNewPassword] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    getSettings().then(setSettings).catch(() => undefined);
    getScanLists().then(setScanLists).catch(() => undefined);
    getSystems().then(setSystems).catch(() => undefined);
    getReceiverPresets().then((presets) => {
      setDevicePresets(presets);
      const preset = presets.find((item) => item.driver === receiverDraft.driver);
      const submodel = preset?.submodels[0];
      if (submodel && !submodelId) {
        setReceiverDraft((draft) =>
          draft.driver === receiverDraft.driver ? applySubmodelPreset(draft, submodel) : draft,
        );
        setSubmodelId(submodel.id);
      }
    }).catch(() => undefined);
    getTalkgroups().then(setTalkgroups).catch(() => undefined);
    getPublicPolicy().then(setPolicy).catch(() => undefined);
    getRuntime().then(setRuntime).catch(() => undefined);
    getDiagnostics().then(setDiagnostics).catch(() => undefined);
    getAuditLog().then(setAuditLog).catch(() => undefined);
    getDecoderConfig().then((value) => setDecoderConfig(JSON.stringify(value, null, 2))).catch(() => undefined);
    getAuthStatus().then((status) => setLocalOnly(Boolean(status.localOnly))).catch(() => undefined);
    Promise.all([
      getTranscribeStatus().catch(() => undefined),
      getSummaryStatus().catch(() => undefined),
      getGeocoderStatus().catch(() => undefined),
      getDiscordStatus().catch(() => undefined),
    ]).then(([transcribe, summary, geocoder, discord]) => {
      setIntegrationStatus({ transcribe, summary, geocoder, discord });
    });
  }, [isOpen]);

  const refreshTranscribeModels = async () => {
    if (!settings?.transcribeUrl.trim()) {
      setTranscribeModels([]);
      setTranscribeModelsError("Transcribe URL is required");
      return;
    }
    setTranscribeModelsLoading(true);
    setTranscribeModelsError(undefined);
    try {
      const discovered = await discoverTranscribeModels({
        transcribeUrl: settings.transcribeUrl,
        transcribeProvider: settings.transcribeProvider,
        transcribeApiKey: settings.transcribeApiKey,
      });
      setTranscribeModels(discovered.models);
      setTranscribeModelSource(discovered.catalogUrl);
      setSettings((current) => {
        if (!current) return current;
        const transcribeModel = pickTranscribeModel(discovered.models, current.transcribeModel);
        return {
          ...current,
          transcribeModel,
          aiProfile: deriveAiProfile(transcribeModel),
        };
      });
    } catch (error) {
      setTranscribeModels([]);
      setTranscribeModelsError(error instanceof Error ? error.message : "Model discovery failed");
    } finally {
      setTranscribeModelsLoading(false);
    }
  };

  const refreshSummaryModels = async () => {
    if (!settings?.summaryUrl?.trim()) {
      setSummaryModels([]);
      setSummaryModelsError("Summary URL is required");
      return;
    }
    setSummaryModelsLoading(true);
    setSummaryModelsError(undefined);
    try {
      const discovered = await discoverSummaryModels({
        summaryUrl: settings.summaryUrl,
        summaryProvider: settings.summaryProvider,
        summaryApiKey: settings.summaryApiKey,
      });
      setSummaryModels(discovered.models);
      setSummaryModelSource(discovered.catalogUrl);
      setSettings((current) => {
        if (!current) return current;
        return {
          ...current,
          summaryModel: pickSummaryModel(discovered.models, current.summaryModel),
        };
      });
    } catch (error) {
      setSummaryModels([]);
      setSummaryModelsError(error instanceof Error ? error.message : "Model discovery failed");
    } finally {
      setSummaryModelsLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen || activeTab !== "integrations" || !settings) return;
    const timer = window.setTimeout(() => {
      void refreshTranscribeModels();
      void refreshSummaryModels();
    }, 400);
    return () => window.clearTimeout(timer);
  }, [
    isOpen,
    activeTab,
    settings?.transcribeUrl,
    settings?.transcribeProvider,
    settings?.transcribeApiKey,
    settings?.summaryUrl,
    settings?.summaryProvider,
    settings?.summaryApiKey,
  ]);

  if (!isOpen) return null;

  const handleDiscoverReceivers = async () => {
    setStatusMessage("Scanning for USB and network SDR devices…");
    try {
      const devices = await discoverReceivers();
      setDiscoveredDevices(devices);
      setStatusMessage(devices.length ? `Found ${devices.length} device(s)` : "No SDR devices detected");
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : "Discovery failed");
    }
  };

  const applyDiscoveredDevice = (device: (typeof discoveredDevices)[number]) => {
    setReceiverDraft((draft) => ({
      ...draft,
      label: device.label || `Soapy #${device.index}`,
      driver: device.suggestedDriver,
      serial: device.args || `driver=${device.driver}`,
      soapyIndex: device.index,
    }));
    setShowAddReceiver(true);
    setStatusMessage(`Selected ${device.label} (soapy=${device.index})`);
  };

  const systemsUsingReceiver = (receiverId: string) =>
    systems.filter((system) => system.receiverId === receiverId).map((system) => system.name);

  // Seed the Soapy args when the driver changes and the operator has not
  // supplied custom device args (e.g. a remote= endpoint).
  const seedSerialForDriver = (current: string, next: ReceiverInput["driver"]): string => {
    const trimmed = current.trim();
    if (!trimmed || /^driver=[a-z0-9]+$/i.test(trimmed)) {
      return `driver=${SOAPY_DRIVER_ARGS[next]}`;
    }
    return current;
  };

  const activeSubmodelOptions =
    devicePresets.find((preset) => preset.driver === receiverDraft.driver)?.submodels ?? [];
  const activeSubmodel =
    activeSubmodelOptions.find((submodel) => submodel.id === submodelId) ?? activeSubmodelOptions[0];

  const applyOptimalDefaults = (driver: ReceiverInput["driver"], serial: string) => {
    const preset = devicePresets.find((item) => item.driver === driver);
    const submodel = preset?.submodels[0];
    setReceiverDraft((draft) => {
      const next = { ...draft, driver, serial: seedSerialForDriver(serial, driver) };
      return submodel ? applySubmodelPreset(next, submodel) : next;
    });
    setSubmodelId(submodel?.id ?? "");
    if (submodel) {
      setStatusMessage(`Applied ${submodel.label} defaults: ${presetSummary(submodel)}`);
    }
  };

  // Receiver actions
  const handleReceiverAction = async (id: string, action: "probe" | "start" | "stop" | "restart") => {
    setStatusMessage(`Requesting ${action.toUpperCase()}…`);
    try {
      const updated = await receiverAction(id, action);
      onUpdateReceiver(updated);
      setStatusMessage(`Receiver ${action.toUpperCase()} completed`);
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : "Action failed");
    }
  };

  const handleSaveReceiver = async (id: string) => {
    try {
      const updated = await updateReceiver(id, receiverDraft);
      onUpdateReceiver(updated);
      setEditingReceiverId(null);
      setStatusMessage("Receiver settings saved. Restart receiver to apply.");
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : "Save failed");
    }
  };

  const handleAddReceiver = async () => {
    try {
      const created = await createReceiver(receiverDraft);
      onUpdateReceiver(created);
      setShowAddReceiver(false);
      setStatusMessage("Receiver created successfully");
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : "Create failed");
    }
  };

  const handleDeleteReceiver = async (id: string) => {
    if (!window.confirm("Delete this receiver configuration?")) return;
    try {
      await deleteReceiver(id);
      onRemoveReceiver(id);
      setStatusMessage("Receiver removed");
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : "Delete failed");
    }
  };

  // Scan list save
  const handleSaveScanList = async () => {
    if (!editingScanList) return;
    try {
      const saved = await saveScanList(editingScanList);
      setScanLists((prev) => [...prev.filter((l) => l.id !== saved.id), saved]);
      setEditingScanList(null);
      setStatusMessage("Scan list saved");
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : "Scan list save failed");
    }
  };

  // Systems save
  const handleSaveSystem = async () => {
    try {
      const saved = await saveSystem(systemDraft);
      setSystems((prev) => [...prev.filter((s) => s.id !== saved.id), saved]);
      setStatusMessage("System saved and validated");
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : "System save failed");
    }
  };

  // Talkgroups CSV import
  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const merge = (document.getElementById("tg-merge") as HTMLInputElement | null)?.checked ?? true;
      const res = await importTalkgroups(file, { systemId: systems[0]?.id, merge });
      setTalkgroups(await getTalkgroups());
      setStatusMessage(`Imported ${res.rows} talkgroups successfully`);
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : "CSV import failed");
    }
  };

  // Settings save
  const handleSaveSettings = async () => {
    if (!settings) return;
    try {
      const updated = await saveSettings(settings);
      setSettings(updated);
      setStatusMessage("Appliance settings saved");
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : "Save failed");
    }
  };

  // Password rotation
  const handleRotatePassword = async () => {
    if (newPassword.length < 12) {
      setStatusMessage("Password must be at least 12 characters");
      return;
    }
    try {
      await changePassword(adminUser, newPassword);
      setNewPassword("");
      setStatusMessage("Administrator password updated successfully");
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : "Password change failed");
    }
  };

  return (
    <div className="tactical-drawer-backdrop" onClick={onClose}>
      <aside className="tactical-drawer wide-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <div>
            <small className="eyebrow">APPLIANCE CONTROL</small>
            <h2>System Administration</h2>
          </div>
          <button type="button" className="drawer-close-btn" onClick={onClose}>
            &times;
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="appliance-tabs">
          <button type="button" className={activeTab === "radio" ? "active" : ""} onClick={() => setActiveTab("radio")}>📻 RADIO</button>
          <button
            type="button"
            className={activeTab === "receivers" ? "active" : ""}
            onClick={() => setActiveTab("receivers")}
          >
            📡 RECEIVERS ({snapshot.receivers.length})
          </button>
          <button
            type="button"
            className={activeTab === "scanlists" ? "active" : ""}
            onClick={() => setActiveTab("scanlists")}
          >
            📻 SCAN LISTS
          </button>
          <button
            type="button"
            className={activeTab === "systems" ? "active" : ""}
            onClick={() => setActiveTab("systems")}
          >
            ⚡ SYSTEMS
          </button>
          <button type="button" className={activeTab === "talkgroups" ? "active" : ""} onClick={() => setActiveTab("talkgroups")}>🗂️ TALKGROUPS</button>
          <button type="button" className={activeTab === "integrations" ? "active" : ""} onClick={() => setActiveTab("integrations")}>🤖 AI & INTEGRATIONS</button>
          <button type="button" className={activeTab === "policy" ? "active" : ""} onClick={() => setActiveTab("policy")}>🌐 POLICY</button>
          <button
            type="button"
            className={activeTab === "security" ? "active" : ""}
            onClick={() => setActiveTab("security")}
          >
            🔒 SECURITY
          </button>
          <button type="button" className={activeTab === "diagnostics" ? "active" : ""} onClick={() => setActiveTab("diagnostics")}>🩺 DIAGNOSTICS</button>
        </div>

        {statusMessage && <div className="appliance-status-bar">{statusMessage}</div>}

        <div className="appliance-body">
          {activeTab === "radio" && settings && (
            <div className="tab-pane">
              <h3>Radio Mode & Tuning</h3>
              <p className="pane-desc">Persisted radio settings drive decoder generation and receiver defaults. Restart receiver/decoder after saving.</p>
              <div className="form-grid">
                <label>Mode<select value={settings.radioMode} onChange={(e) => setSettings({ ...settings, radioMode: e.target.value })}><option value="simulator">Simulator</option><option value="radiod">radiod</option><option value="decoder">Decoder (Trunk Recorder)</option></select></label>
                <label>Device<input value={settings.radioDevice} onChange={(e) => setSettings({ ...settings, radioDevice: e.target.value })} /></label>
                <label>Center frequency (MHz)<MhzField valueHz={settings.radioFrequencyHz} placeholder="851.0125" onChange={(radioFrequencyHz) => setSettings({ ...settings, radioFrequencyHz })} /></label>
                <label>Sample rate (MHz)<MhzField valueHz={settings.radioSampleRateHz} placeholder="2.4" onChange={(radioSampleRateHz) => setSettings({ ...settings, radioSampleRateHz })} /></label>
                <label>Bandwidth (MHz)<MhzField valueHz={settings.radioBandwidthHz} placeholder="0.2" onChange={(value) => setSettings({ ...settings, radioBandwidthHz: value || undefined })} /></label>
                <label>Gain (dB)<input type="number" value={settings.radioGainDb ?? ""} onChange={(e) => setSettings({ ...settings, radioGainDb: Number(e.target.value) })} /></label>
                <label className="checkbox-label"><input type="checkbox" checked={settings.radioAgc} onChange={(e) => setSettings({ ...settings, radioAgc: e.target.checked })} /> AGC enabled</label>
                <label>PPM<input type="number" step="0.1" value={settings.radioPpm} onChange={(e) => setSettings({ ...settings, radioPpm: Number(e.target.value) })} /></label>
                <label>Site filter<input value={settings.siteFilter ?? ""} onChange={(e) => setSettings({ ...settings, siteFilter: e.target.value })} placeholder="Black River Falls" /></label>
              </div>
              <button type="button" className="primary-btn" onClick={handleSaveSettings}>Save radio settings</button>
            </div>
          )}

          {/* RECEIVERS TAB */}
          {activeTab === "receivers" && (
            <div className="tab-pane">
              <div className="pane-header">
                <h3>Hardware SDR Receivers</h3>
                <div className="btn-row">
                  <button type="button" onClick={handleDiscoverReceivers}>Discover devices</button>
                  <button
                    type="button"
                    className="primary-btn"
                    onClick={() => setShowAddReceiver(!showAddReceiver)}
                  >
                    {showAddReceiver ? "Cancel" : "+ Add Receiver"}
                  </button>
                </div>
              </div>

              {discoveredDevices.length > 0 && (
                <div className="config-box">
                  <h4>Discovered devices</h4>
                  {discoveredDevices.map((device) => (
                    <div key={`${device.index}-${device.serial}`} className="btn-row">
                      <span>#{device.index} {device.label} ({device.driver})</span>
                      <button type="button" onClick={() => applyDiscoveredDevice(device)}>Use</button>
                    </div>
                  ))}
                </div>
              )}

              {showAddReceiver && (
                <div className="config-box">
                  <h4>New Receiver</h4>
                  <div className="form-grid">
                    <label>
                      Label
                      <input
                        type="text"
                        value={receiverDraft.label}
                        onChange={(e) => setReceiverDraft({ ...receiverDraft, label: e.target.value })}
                      />
                    </label>
                    <label>
                      Driver
                      <select
                        value={receiverDraft.driver}
                        onChange={(e) =>
                          applyOptimalDefaults(e.target.value as ReceiverInput["driver"], receiverDraft.serial)
                        }
                      >
                        {DRIVER_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                    {activeSubmodelOptions.length > 0 && (
                      <label>
                        Model
                        <select
                          value={activeSubmodel?.id ?? ""}
                          onChange={(e) => {
                            const submodel = activeSubmodelOptions.find((item) => item.id === e.target.value);
                            if (!submodel) return;
                            setSubmodelId(submodel.id);
                            setReceiverDraft((draft) => applySubmodelPreset(draft, submodel));
                            setStatusMessage(`Applied ${submodel.label} defaults: ${presetSummary(submodel)}`);
                          }}
                        >
                          {activeSubmodelOptions.map((submodel) => (
                            <option key={submodel.id} value={submodel.id}>{submodel.label}</option>
                          ))}
                        </select>
                        {activeSubmodel?.notes && <small className="pane-desc">{activeSubmodel.notes}</small>}
                      </label>
                    )}
                    <label>
                      Soapy device args
                      <input
                        type="text"
                        placeholder="driver=sdrplay"
                        value={receiverDraft.serial}
                        onChange={(e) => setReceiverDraft({ ...receiverDraft, serial: e.target.value })}
                      />
                      <small className="pane-desc">Auto-filled from driver. Remote node: driver=remote,remote=192.168.1.50</small>
                    </label>
                    <label>
                      Center Frequency (MHz)
                      <MhzField
                        valueHz={receiverDraft.centerFrequencyHz}
                        placeholder="851.0125"
                        onChange={(centerFrequencyHz) =>
                          setReceiverDraft({ ...receiverDraft, centerFrequencyHz })
                        }
                      />
                    </label>
                    <label>
                      Sample Rate (MHz)
                      <MhzField
                        valueHz={receiverDraft.sampleRateHz}
                        placeholder="2.4"
                        onChange={(sampleRateHz) =>
                          setReceiverDraft({ ...receiverDraft, sampleRateHz })
                        }
                      />
                    </label>
                    <label>
                      Soapy index
                      <input
                        type="number"
                        value={receiverDraft.soapyIndex ?? 0}
                        onChange={(e) =>
                          setReceiverDraft({ ...receiverDraft, soapyIndex: Number(e.target.value) })
                        }
                      />
                    </label>
                    <label>
                      Role
                      <select
                        value={receiverDraft.role ?? "general"}
                        onChange={(e) =>
                          setReceiverDraft({
                            ...receiverDraft,
                            role: e.target.value as ReceiverInput["role"],
                          })
                        }
                      >
                        <option value="general">General</option>
                        <option value="p25">P25</option>
                        <option value="analog">Analog FM</option>
                      </select>
                    </label>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={receiverDraft.enabled ?? true}
                        onChange={(e) =>
                          setReceiverDraft({ ...receiverDraft, enabled: e.target.checked })
                        }
                      /> Enabled
                    </label>
                    <label>
                      Gain (dB)
                      <input
                        type="number"
                        value={receiverDraft.gainDb}
                        onChange={(e) =>
                          setReceiverDraft({ ...receiverDraft, gainDb: Number(e.target.value) })
                        }
                      />
                    </label>
                  </div>
                  <button type="button" className="primary-btn" onClick={handleAddReceiver}>
                    Save Receiver
                  </button>
                </div>
              )}

              <div className="receivers-grid">
                {snapshot.receivers.map((r) => (
                  <div key={r.id} className="receiver-item-card">
                    <div className="r-header">
                      <div>
                        <strong>{r.label}</strong>
                        <span className="driver-pill">{r.driver}</span>
                      </div>
                      <span className={`state-pill ${r.state}`}>{r.state.toUpperCase()}</span>
                    </div>

                    <div className="r-specs">
                      <span>Center: {formatFrequency(r.centerFrequencyHz)}</span>
                      <span>Rate: {(Number(r.sampleRateHz || 0) / 1e6).toFixed(2)} MHz</span>
                      <span>Gain: {r.gainDb ?? "Auto"} dB</span>
                      <span>Signal: {r.health.signalDbfs.toFixed(1)} dBFS</span>
                      {r.soapyIndex != null && <span>Soapy: {r.soapyIndex}</span>}
                      {r.enabled === false && <span className="live-tag">DISABLED</span>}
                    </div>
                    {systemsUsingReceiver(r.id).length > 0 && (
                      <p className="pane-desc">Used by: {systemsUsingReceiver(r.id).join(", ")}</p>
                    )}

                    <div className="meter-wrap">
                      <div
                        className="meter-fill"
                        style={{ width: `${signalQuality(r.health.signalDbfs)}%` }}
                      />
                    </div>

                    <div className="r-actions">
                      <button type="button" onClick={() => handleReceiverAction(r.id, "probe")}>
                        Probe
                      </button>
                      <button type="button" onClick={async () => {
                        try {
                          const caps = await getReceiverCapabilities(r.id);
                          setStatusMessage(`Gain elements: ${caps?.gainElements?.join(", ") || "none"}`);
                        } catch (error) {
                          setStatusMessage(error instanceof Error ? error.message : "Capabilities unavailable");
                        }
                      }}>Capabilities</button>
                      <button type="button" onClick={async () => {
                        try {
                          const result = await verifyReceiver(r.id);
                          setStatusMessage(result.passed ? "Receiver verification passed" : `Verify failed: ${result.checks.filter((c) => !c.passed).map((c) => c.name).join(", ")}`);
                        } catch (error) {
                          setStatusMessage(error instanceof Error ? error.message : "Verify failed");
                        }
                      }}>Verify</button>
                      <button type="button" onClick={() => handleReceiverAction(r.id, "start")}>
                        Start
                      </button>
                      <button type="button" onClick={() => handleReceiverAction(r.id, "stop")}>
                        Stop
                      </button>
                      <button type="button" onClick={() => handleReceiverAction(r.id, "restart")}>
                        Restart
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingReceiverId(editingReceiverId === r.id ? null : r.id);
                          setReceiverDraft({
                            label: r.label,
                            driver: r.driver,
                            serial: r.serial,
                            centerFrequencyHz: r.centerFrequencyHz ?? 154_000_000,
                            sampleRateHz: r.sampleRateHz ?? 2400000,
                            gainDb: r.gainDb ?? 40,
                            ppm: r.ppm,
                            enabled: r.enabled ?? true,
                            role: r.role ?? "general",
                            soapyIndex: r.soapyIndex ?? 0,
                          });
                        }}
                      >
                        {editingReceiverId === r.id ? "Cancel" : "Configure"}
                      </button>
                      <button
                        type="button"
                        className="danger-btn"
                        onClick={() => handleDeleteReceiver(r.id)}
                      >
                        Delete
                      </button>
                    </div>

                    {editingReceiverId === r.id && (
                      <div className="r-edit-box">
                        <div className="form-grid">
                          <label>
                            Label
                            <input
                              type="text"
                              value={receiverDraft.label}
                              onChange={(e) =>
                                setReceiverDraft({ ...receiverDraft, label: e.target.value })
                              }
                            />
                          </label>
                          <label>
                            Soapy device args
                            <input
                              type="text"
                              placeholder="driver=sdrplay"
                              value={receiverDraft.serial}
                              onChange={(e) =>
                                setReceiverDraft({ ...receiverDraft, serial: e.target.value })
                              }
                            />
                            <small className="pane-desc">Auto-filled from driver. Remote node: driver=remote,remote=192.168.1.50</small>
                          </label>
                          <label>
                            Center Frequency (MHz)
                            <MhzField
                              valueHz={receiverDraft.centerFrequencyHz}
                              placeholder="851.0125"
                              onChange={(centerFrequencyHz) =>
                                setReceiverDraft({
                                  ...receiverDraft,
                                  centerFrequencyHz,
                                })
                              }
                            />
                          </label>
                          <label>
                            Gain (dB)
                            <input
                              type="number"
                              value={receiverDraft.gainDb}
                              onChange={(e) =>
                                setReceiverDraft({ ...receiverDraft, gainDb: Number(e.target.value) })
                              }
                            />
                          </label>
                        </div>
                        <button
                          type="button"
                          className="primary-btn"
                          onClick={() => handleSaveReceiver(r.id)}
                        >
                          Save Changes
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* SCAN LISTS TAB */}
          {activeTab === "scanlists" && (
            <div className="tab-pane">
              <h3>FM Conventional Scan Lists</h3>
              <p className="pane-desc">
                Configure analog frequencies, squelch thresholds, and CTCSS/DCS tone lockouts.
              </p>

              <div className="scanlist-container">
                {scanLists.map((list) => (
                  <div key={list.id} className="config-box">
                    <div className="box-header">
                      <strong>{list.name}</strong>
                      <span>{list.channels.length} channels</span>
                      <button
                        type="button"
                        className="primary-btn"
                        onClick={() => setEditingScanList(list)}
                      >
                        Edit Channels
                      </button>
                      <button type="button" onClick={async () => { try { await startScanList(list.id); setActiveScanListId(list.id); setStatusMessage(`Started scan list ${list.name}`); } catch (error) { setStatusMessage(error instanceof Error ? error.message : "Start failed"); } }}>Start</button>
                      <button type="button" onClick={async () => { try { await stopScanList(list.id); setActiveScanListId(undefined); setStatusMessage(`Stopped scan list ${list.name}`); } catch (error) { setStatusMessage(error instanceof Error ? error.message : "Stop failed"); } }}>Stop</button>
                      <button type="button" className="danger-btn" onClick={async () => { if (!window.confirm(`Delete scan list ${list.name}?`)) return; await deleteScanList(list.id); setScanLists((items) => items.filter((item) => item.id !== list.id)); }}>Delete</button>
                      {activeScanListId === list.id && <span className="live-tag">ACTIVE</span>}
                    </div>
                  </div>
                ))}
              </div>

              {editingScanList && (
                <div className="config-box editing-scanlist">
                  <h4>Editing Scan List: {editingScanList.name}</h4>
                  <div className="channels-table">
                    {editingScanList.channels.map((chan, idx) => (
                      <div key={chan.id} className="channel-row">
                        <input
                          type="text"
                          value={chan.name}
                          placeholder="Channel Label"
                          onChange={(e) => {
                            const updated = [...editingScanList.channels];
                            updated[idx].name = e.target.value;
                            setEditingScanList({ ...editingScanList, channels: updated });
                          }}
                        />
                        <MhzField
                          valueHz={chan.frequencyHz}
                          placeholder="155.5500"
                          onChange={(frequencyHz) => {
                            const updated = [...editingScanList.channels];
                            updated[idx].frequencyHz = frequencyHz;
                            setEditingScanList({ ...editingScanList, channels: updated });
                          }}
                        />
                        <input
                          type="number"
                          value={chan.squelchDb}
                          placeholder="Squelch dBFS"
                          onChange={(e) => {
                            const updated = [...editingScanList.channels];
                            updated[idx].squelchDb = Number(e.target.value);
                            setEditingScanList({ ...editingScanList, channels: updated });
                          }}
                        />
                        <input
                          type="text"
                          value={chan.tone ?? ""}
                          placeholder="CTCSS/DCS"
                          onChange={(e) => {
                            const updated = [...editingScanList.channels];
                            updated[idx].tone = e.target.value || undefined;
                            setEditingScanList({ ...editingScanList, channels: updated });
                          }}
                        />
                        <button
                          type="button"
                          className="danger-btn"
                          onClick={() => {
                            const updated = editingScanList.channels.filter((_, i) => i !== idx);
                            setEditingScanList({ ...editingScanList, channels: updated });
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="btn-row">
                    <button
                      type="button"
                      onClick={() => {
                        const newChan = {
                          id: crypto.randomUUID(),
                          name: "New Channel",
                          frequencyHz: 155550000,
                          modulation: "NFM",
                          bandwidthHz: 12500,
                          squelchDb: -65,
                          toneRequired: false,
                          dwellMs: 2500,
                          priority: 0,
                          lockedOut: false,
                        };
                        setEditingScanList({
                          ...editingScanList,
                          channels: [...editingScanList.channels, newChan],
                        });
                      }}
                    >
                      + Add Channel
                    </button>
                    <button type="button" className="primary-btn" onClick={handleSaveScanList}>
                      Save Scan List
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* SYSTEMS & PROFILES TAB */}
          {activeTab === "systems" && (
            <div className="tab-pane">
              <h3>Radio Systems & Decoder Profiles</h3>
              <SitesEditor />
              <div className="import-box">
                <h4>Import RadioReference site CSV</h4>
                <input type="file" accept=".csv" onChange={async (event) => {
                  const file = event.target.files?.[0];
                  const systemId = systems[0]?.id;
                  if (!file || !systemId) return;
                  try {
                    const result = await importSites(file, systemId, true);
                    setSystems(await getSystems());
                    setStatusMessage(`Imported ${result.rows} sites`);
                  } catch (error) {
                    setStatusMessage(error instanceof Error ? error.message : "Site import failed");
                  }
                }} />
              </div>
              <div className="systems-list">
                {systems.map((sys) => (
                  <div key={sys.id} className="config-box">
                    <div className="box-header">
                      <strong>{sys.name}</strong>
                      <span>Protocol: {sys.protocol}</span>
                      {sys.protocol === "p25" ? (
                        <>
                          <span>Control: {formatFrequency(sys.controlChannelHz)}</span>
                          <span>NAC: {sys.nac != null ? sys.nac.toString(16).toUpperCase() : "—"}</span>
                        </>
                      ) : (
                        <>
                          <span>Freq: {formatFrequency(sys.frequencyHz)}</span>
                          <span>PL Tone: {sys.tone ?? "CSQ"}</span>
                        </>
                      )}
                    </div>
                    <div className="btn-row">
                      <button type="button" onClick={() => setSystemDraft(sys)}>Edit</button>
                      <button type="button" className="danger-btn" onClick={async () => {
                        if (!window.confirm(`Delete system ${sys.name}?`)) return;
                        try {
                          await deleteSystem(sys.id);
                          setSystems((items) => items.filter((item) => item.id !== sys.id));
                          setStatusMessage(`Deleted ${sys.name}`);
                        } catch (error) {
                          setStatusMessage(error instanceof Error ? error.message : "Delete failed");
                        }
                      }}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="config-box">
                <h4>Add / Update System</h4>
                <div className="form-grid">
                  <label>
                    System Name
                    <input
                      type="text"
                      value={systemDraft.name}
                      onChange={(e) => setSystemDraft({ ...systemDraft, name: e.target.value })}
                    />
                  </label>
                  <label>
                    Protocol
                    <select
                      value={systemDraft.protocol}
                      onChange={(e) => {
                        const protocol = e.target.value;
                        setSystemDraft((draft) => ({
                          ...draft,
                          protocol,
                          modulation: protocol === "analog-fm" ? draft.modulation ?? "NFM" : draft.modulation,
                          bandwidthHz: protocol === "analog-fm" ? draft.bandwidthHz ?? 12500 : draft.bandwidthHz,
                          controlChannelHz: protocol === "p25" ? draft.controlChannelHz ?? 851012500 : draft.controlChannelHz,
                        }));
                      }}
                    >
                      <option value="p25">P25 Phase 1/2 Trunked</option>
                      <option value="analog-fm">Analog FM Conventional</option>
                    </select>
                  </label>
                  {systemDraft.protocol === "p25" ? (
                    <>
                      <label>
                        Control Channel (MHz)
                        <MhzField
                          valueHz={systemDraft.controlChannelHz}
                          placeholder="851.0125"
                          onChange={(controlChannelHz) =>
                            setSystemDraft({ ...systemDraft, controlChannelHz })
                          }
                        />
                      </label>
                      <label>
                        NAC (hex)
                        <input
                          type="text"
                          placeholder="e.g. 293 or B0C"
                          value={systemDraft.nac != null ? systemDraft.nac.toString(16).toUpperCase() : ""}
                          onChange={(e) =>
                            setSystemDraft({ ...systemDraft, nac: parseNacHex(e.target.value) })
                          }
                        />
                        <small className="pane-desc">P25 network access code, 3 hex digits (000–FFF)</small>
                      </label>
                    </>
                  ) : (
                    <>
                      <label>Frequency (MHz)<MhzField valueHz={systemDraft.frequencyHz} placeholder="154.445" onChange={(frequencyHz) => setSystemDraft({ ...systemDraft, frequencyHz })} /></label>
                      <label>Bandwidth (MHz)<MhzField valueHz={systemDraft.bandwidthHz} placeholder="0.0125" onChange={(bandwidthHz) => setSystemDraft({ ...systemDraft, bandwidthHz })} /><small className="pane-desc">NFM 0.0125 · FM 0.025 · narrow 0.00625</small></label>
                      <label>Modulation
                        <select value={systemDraft.modulation ?? "NFM"} onChange={(e) => setSystemDraft({ ...systemDraft, modulation: e.target.value })}>
                          <option value="NFM">NFM (12.5 kHz)</option>
                          <option value="FM">FM (25 kHz)</option>
                        </select>
                      </label>
                      <label>Squelch (dB)<input type="number" value={systemDraft.squelchDb ?? ""} onChange={(e) => setSystemDraft({ ...systemDraft, squelchDb: Number(e.target.value) })} /></label>
                      <label>
                        PL Tone (CTCSS/DCS)
                        <input value={systemDraft.tone ?? ""} onChange={(e) => setSystemDraft({ ...systemDraft, tone: e.target.value })} placeholder="123.0 or D023N" />
                        <small className="pane-desc">Squelch tone; leave blank for carrier squelch. Not two-tone dispatch.</small>
                      </label>
                     </>
                   )}
                  <label>
                    Assigned receiver
                    <select
                      value={systemDraft.receiverId ?? ""}
                      onChange={(e) =>
                        setSystemDraft({
                          ...systemDraft,
                          receiverId: e.target.value || undefined,
                        })
                      }
                    >
                      <option value="">Default (first enabled)</option>
                      {snapshot.receivers.map((receiver) => (
                        <option key={receiver.id} value={receiver.id}>{receiver.label}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <button type="button" className="primary-btn" onClick={handleSaveSystem}>
                  Save System Profile
                </button>
              </div>
            </div>
          )}

          {activeTab === "talkgroups" && (
            <div className="tab-pane">
              <h3>Talkgroup Database</h3>
              <div className="import-box">
                <label className="checkbox-label"><input type="checkbox" id="tg-merge" defaultChecked /> Merge with existing catalog</label>
                <input type="file" accept=".csv" onChange={handleFileUpload} />
              </div>
              <div className="form-grid">
                <label>Alpha tag<input value={talkgroupDraft.alphaTag} onChange={(e) => setTalkgroupDraft({ ...talkgroupDraft, alphaTag: e.target.value })} /></label>
                <label>Decimal ID<input type="number" value={talkgroupDraft.decimalId} onChange={(e) => setTalkgroupDraft({ ...talkgroupDraft, decimalId: Number(e.target.value) })} /></label>
                <label>Description<input value={talkgroupDraft.description} onChange={(e) => setTalkgroupDraft({ ...talkgroupDraft, description: e.target.value })} /></label>
                <label>Category<input value={talkgroupDraft.category} onChange={(e) => setTalkgroupDraft({ ...talkgroupDraft, category: e.target.value })} /></label>
              </div>
              <button type="button" className="primary-btn" onClick={async () => {
                try {
                  const saved = await saveTalkgroup({ ...talkgroupDraft, id: talkgroupDraft.id || crypto.randomUUID() });
                  setTalkgroups((items) => [...items.filter((item) => item.id !== saved.id), saved]);
                  setStatusMessage("Talkgroup saved");
                } catch (error) {
                  setStatusMessage(error instanceof Error ? error.message : "Talkgroup save failed");
                }
              }}>Save talkgroup</button>
              <div className="systems-list">
                {talkgroups.map((tg) => (
                  <div key={tg.id} className="config-box">
                    <strong>{tg.alphaTag}</strong> · {tg.decimalId} · {tg.category}
                    <div className="btn-row">
                      <button type="button" onClick={() => setTalkgroupDraft(tg)}>Edit</button>
                      <button type="button" onClick={async () => { await deleteTalkgroup(tg.id); setTalkgroups((items) => items.filter((item) => item.id !== tg.id)); }}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === "integrations" && settings && (
            <div className="tab-pane">
              <h3>AI & Integrations</h3>
              <div className="config-box">
                <span>Transcription: {integrationStatus.transcribe?.configured ? "configured" : "not configured"}</span>
                <span>Summary: {integrationStatus.summary?.configured ? "configured" : "not configured"}</span>
                <span>Geocoder: {integrationStatus.geocoder?.configured ? "configured" : "not configured"}</span>
                <span>Discord: {integrationStatus.discord?.configured ? "configured" : "not configured"}</span>
              </div>
              <div className="config-section">
                <h4>Map center</h4>
                <div className="form-grid">
                  <label>Home label<input value={settings.homeLabel} onChange={(e) => setSettings({ ...settings, homeLabel: e.target.value })} /></label>
                  <label>Latitude<input type="number" step="0.0001" value={settings.homeLatitude} onChange={(e) => setSettings({ ...settings, homeLatitude: Number(e.target.value) })} /></label>
                  <label>Longitude<input type="number" step="0.0001" value={settings.homeLongitude} onChange={(e) => setSettings({ ...settings, homeLongitude: Number(e.target.value) })} /></label>
                </div>
              </div>
              <div className="config-section">
                <h4>AI transcription & summary</h4>
                <div className="form-grid">
                  <label className="checkbox-label"><input type="checkbox" checked={settings.aiEnabled} onChange={(e) => setSettings({ ...settings, aiEnabled: e.target.checked })} /> Enable AI</label>
                  <label>Stack preset
                    <select onChange={(e) => {
                      const preset = AI_STACK_PRESETS[e.target.value];
                      if (preset) setSettings({ ...settings, ...preset });
                    }}>
                      <option value="">Choose preset…</option>
                      <option value="local-gpu">Local GPU</option>
                      <option value="cloud-hybrid">Cloud hybrid</option>
                      <option value="privacy-max">Privacy max</option>
                    </select>
                  </label>
                  <label>Transcribe provider<input value={settings.transcribeProvider ?? "openai-compatible"} onChange={(e) => setSettings({ ...settings, transcribeProvider: e.target.value })} /></label>
                  <label>Transcribe URL<input value={settings.transcribeUrl} onChange={(e) => setSettings({ ...settings, transcribeUrl: e.target.value })} /></label>
                  <label>Transcribe API key<input type="password" value={settings.transcribeApiKey ?? ""} onChange={(e) => setSettings({ ...settings, transcribeApiKey: e.target.value })} /></label>
                  <IntegrationModelField
                    label="Transcribe model"
                    kind="transcribe"
                    value={settings.transcribeModel}
                    models={transcribeModels}
                    loading={transcribeModelsLoading}
                    error={transcribeModelsError}
                    source={transcribeModelSource}
                    onRefresh={() => void refreshTranscribeModels()}
                    onChange={(transcribeModel) =>
                      setSettings({
                        ...settings,
                        transcribeModel,
                        aiProfile: deriveAiProfile(transcribeModel),
                      })
                    }
                  />
                  <p className="pane-desc">ASR profile (auto): {settings.aiProfile}</p>
                  <label className="checkbox-label"><input type="checkbox" checked={settings.vadEnabled} onChange={(e) => setSettings({ ...settings, vadEnabled: e.target.checked })} /> VAD enabled</label>
                  <label>Summary provider<input value={settings.summaryProvider ?? "ollama"} onChange={(e) => setSettings({ ...settings, summaryProvider: e.target.value })} /></label>
                  <label>Summary URL<input value={settings.summaryUrl ?? ""} onChange={(e) => setSettings({ ...settings, summaryUrl: e.target.value })} /></label>
                  <label>Summary API key<input type="password" value={settings.summaryApiKey ?? ""} onChange={(e) => setSettings({ ...settings, summaryApiKey: e.target.value })} /></label>
                  <IntegrationModelField
                    label="Summary model"
                    kind="summary"
                    value={settings.summaryModel}
                    models={summaryModels}
                    loading={summaryModelsLoading}
                    error={summaryModelsError}
                    source={summaryModelSource}
                    onRefresh={() => void refreshSummaryModels()}
                    onChange={(summaryModel) => setSettings({ ...settings, summaryModel })}
                  />
                  <label>Summary refresh (min)<input type="number" value={settings.summaryRefreshMinutes ?? 15} onChange={(e) => setSettings({ ...settings, summaryRefreshMinutes: Number(e.target.value) })} /></label>
                </div>
                <div className="btn-row">
                  <button type="button" onClick={async () => { try { await testTranscribeIntegration(); setStatusMessage("Transcription provider reachable"); } catch (error) { setStatusMessage(error instanceof Error ? error.message : "Transcription test failed"); } }}>Test transcription</button>
                  <button type="button" onClick={async () => { try { await testSummaryIntegration(); setStatusMessage("Summary provider OK"); } catch (error) { setStatusMessage(error instanceof Error ? error.message : "Summary test failed"); } }}>Test summary</button>
                </div>
              </div>
              <div className="config-section">
                <h4>Geocoder & Discord</h4>
                <div className="form-grid">
                  <label>Geocoder provider
                    <select value={settings.geocoderProvider ?? "nominatim"} onChange={(e) => setSettings({ ...settings, geocoderProvider: e.target.value })}>
                      <option value="nominatim">Nominatim</option>
                      <option value="locationiq">LocationIQ</option>
                      <option value="google">Google</option>
                      <option value="mapbox">Mapbox</option>
                    </select>
                  </label>
                  <label>Geocoder URL<input value={settings.geocoderUrl ?? ""} onChange={(e) => setSettings({ ...settings, geocoderUrl: e.target.value })} /></label>
                  <label>Geocoder API key<input type="password" value={settings.geocoderApiKey ?? ""} onChange={(e) => setSettings({ ...settings, geocoderApiKey: e.target.value })} /></label>
                  <label>Discord webhook URL<input value={settings.discordWebhookUrl ?? ""} onChange={(e) => setSettings({ ...settings, discordWebhookUrl: e.target.value })} /></label>
                  <label className="checkbox-label"><input type="checkbox" checked={settings.compatIngestEnabled ?? false} onChange={(e) => setSettings({ ...settings, compatIngestEnabled: e.target.checked })} /> Rdio-scanner compatible ingest (`/api/call-upload`)</label>
                </div>
                <button type="button" onClick={async () => { try { await testGeocoderIntegration(); setStatusMessage("Geocoder test OK"); } catch (error) { setStatusMessage(error instanceof Error ? error.message : "Geocoder test failed"); } }}>Test geocoder</button>
                <button type="button" onClick={async () => { try { await testDiscordWebhook(); setStatusMessage("Discord test delivered"); } catch (error) { setStatusMessage(error instanceof Error ? error.message : "Discord test failed"); } }}>Test Discord webhook</button>
                <h4>Keyword alert rules</h4>
                {(settings.discordKeywordRules ?? []).map((rule, index) => (
                  <div key={rule.id} className="form-grid">
                    <label>Keyword<input value={rule.keyword} onChange={(e) => setSettings({ ...settings, discordKeywordRules: (settings.discordKeywordRules ?? []).map((item, i) => i === index ? { ...item, keyword: e.target.value } : item) })} /></label>
                    <label>Override webhook<input value={rule.webhookUrl ?? ""} onChange={(e) => setSettings({ ...settings, discordKeywordRules: (settings.discordKeywordRules ?? []).map((item, i) => i === index ? { ...item, webhookUrl: e.target.value } : item) })} /></label>
                    <label className="checkbox-label"><input type="checkbox" checked={rule.enabled ?? true} onChange={(e) => setSettings({ ...settings, discordKeywordRules: (settings.discordKeywordRules ?? []).map((item, i) => i === index ? { ...item, enabled: e.target.checked } : item) })} /> Enabled</label>
                  </div>
                ))}
                <button type="button" onClick={() => setSettings({ ...settings, discordKeywordRules: [...(settings.discordKeywordRules ?? []), { id: crypto.randomUUID(), keyword: "", webhookUrl: "", enabled: true } as DiscordKeywordRule] })}>Add keyword rule</button>
                <h4>Talkgroup Discord routing</h4>
                {(settings.discordTalkgroupRules ?? []).map((rule, index) => (
                  <div key={rule.id} className="form-grid">
                    <label>Talkgroup ID<input type="number" value={rule.talkgroupId} onChange={(e) => setSettings({ ...settings, discordTalkgroupRules: (settings.discordTalkgroupRules ?? []).map((item, i) => i === index ? { ...item, talkgroupId: Number(e.target.value) } : item) })} /></label>
                    <label>Webhook URL<input value={rule.webhookUrl ?? ""} onChange={(e) => setSettings({ ...settings, discordTalkgroupRules: (settings.discordTalkgroupRules ?? []).map((item, i) => i === index ? { ...item, webhookUrl: e.target.value } : item) })} /></label>
                    <label className="checkbox-label"><input type="checkbox" checked={rule.enabled ?? true} onChange={(e) => setSettings({ ...settings, discordTalkgroupRules: (settings.discordTalkgroupRules ?? []).map((item, i) => i === index ? { ...item, enabled: e.target.checked } : item) })} /> Enabled</label>
                  </div>
                ))}
                <button type="button" onClick={() => setSettings({ ...settings, discordTalkgroupRules: [...(settings.discordTalkgroupRules ?? []), { id: crypto.randomUUID(), talkgroupId: 0, webhookUrl: "", enabled: true } as DiscordTalkgroupRule] })}>Add talkgroup route</button>
              </div>
              <div className="config-section">
                <h4>Retention (days)</h4>
                <div className="form-grid">
                  <label>Audio<input type="number" value={settings.audioRetentionDays ?? 30} onChange={(e) => setSettings({ ...settings, audioRetentionDays: Number(e.target.value) })} /></label>
                  <label>Transcripts<input type="number" value={settings.transcriptRetentionDays ?? 365} onChange={(e) => setSettings({ ...settings, transcriptRetentionDays: Number(e.target.value) })} /></label>
                  <label>Metadata<input type="number" value={settings.metadataRetentionDays ?? 365} onChange={(e) => setSettings({ ...settings, metadataRetentionDays: Number(e.target.value) })} /></label>
                </div>
              </div>
              <button type="button" className="primary-btn" onClick={handleSaveSettings}>Save integrations</button>
            </div>
          )}

          {activeTab === "policy" && (
            <div className="tab-pane">
              <h3>Public Feed Policy</h3>
              <div className="form-grid">
                <label className="checkbox-label"><input type="checkbox" checked={policy.enabled} onChange={(e) => setPolicy({ ...policy, enabled: e.target.checked })} /> Enable delayed public feed</label>
                <label>Delay (seconds)<input type="number" value={policy.delaySeconds} onChange={(e) => setPolicy({ ...policy, delaySeconds: Number(e.target.value) })} /></label>
                <label>Allowed talkgroup UUIDs<input value={policy.allowedTalkgroups.join(", ")} onChange={(e) => setPolicy({ ...policy, allowedTalkgroups: e.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} /></label>
                <label className="checkbox-label"><input type="checkbox" checked={policy.exposeTranscripts} onChange={(e) => setPolicy({ ...policy, exposeTranscripts: e.target.checked })} /> Expose transcripts</label>
                <label className="checkbox-label"><input type="checkbox" checked={policy.exposeRadioIds} onChange={(e) => setPolicy({ ...policy, exposeRadioIds: e.target.checked })} /> Expose radio IDs</label>
                <label className="checkbox-label"><input type="checkbox" checked={policy.exposePreciseLocations} onChange={(e) => setPolicy({ ...policy, exposePreciseLocations: e.target.checked })} /> Expose precise locations</label>
              </div>
              <button type="button" className="primary-btn" onClick={async () => { try { setPolicy(await savePublicPolicy(policy)); setStatusMessage("Public policy saved"); } catch (error) { setStatusMessage(error instanceof Error ? error.message : "Policy save failed"); } }}>Save policy</button>
            </div>
          )}

          {activeTab === "diagnostics" && (
            <div className="tab-pane">
              <h3>Runtime Diagnostics</h3>
              {runtime && <div className="config-box"><span>Receivers: {runtime.receiverCount}</span><span>Decoder: {runtime.decoderConnected ? "connected" : "offline"}</span><span>AI: {runtime.aiWorkerStatus ?? "unknown"}</span><span>Queue backlog: {runtime.queueBacklog ?? 0}</span><span>Storage: {runtime.storagePath ?? "unknown"}</span><span>Persistence: {runtime.persistenceConnected ? "connected" : "file fallback"}</span><span>Active scan list: {runtime.activeScanList ?? "none"}</span></div>}
              {diagnostics && <div className="config-box"><span>Capture: {diagnostics.capture.state} — {diagnostics.capture.detail}</span><span>Decoder: {diagnostics.decoder.state} — {diagnostics.decoder.detail}</span><span>Recording: {diagnostics.recording.state}</span><span>Ingestion: {diagnostics.ingestion.state}</span><span>AI: {diagnostics.ai.state} — {diagnostics.ai.detail}</span><span>Image: {diagnostics.imageVersion ?? "unknown"}</span><span>Config hash: {diagnostics.configHash ?? "—"}</span><span>Process ID: {diagnostics.processId ?? "—"}</span><span>Decoder heartbeat age: {diagnostics.decoderHeartbeatAgeSeconds ?? "—"}s</span><span>Control lock age: {diagnostics.decoderControlLockAgeSeconds ?? "—"}s</span>{diagnostics.failureReason && <span>Failure: {diagnostics.failureReason}</span>}{diagnostics.aiFailureReason && <span>AI failure: {diagnostics.aiFailureReason}</span>}{diagnostics.simulated && <span className="live-tag">SIMULATED</span>}</div>}
              <h4>Decoder config preview</h4>
              <pre className="decoder-config-preview">{decoderConfig || "Decoder config unavailable"}</pre>
            </div>
          )}

          {activeTab === "security" && (
            <div className="tab-pane">
              <h3>Security & Password Rotation</h3>
              {localOnly && <p className="pane-desc warning">Local-only mode is enabled. Anyone on the trusted LAN has administrator access. This cannot be changed from the UI.</p>}
              <div className="config-box">
                <h4>Change Administrator Password</h4>
                <div className="form-grid">
                  <label>
                    Username
                    <input
                      type="text"
                      value={adminUser}
                      onChange={(e) => setAdminUser(e.target.value)}
                    />
                  </label>
                  <label>
                    New Password (min 12 chars)
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                    />
                  </label>
                </div>
                <button type="button" className="primary-btn" onClick={handleRotatePassword}>
                  Update Password
                </button>
              </div>
              <div className="config-box">
                <h4>Audit log</h4>
                <div className="audit-log-list">
                  {auditLog.slice(0, 50).map((entry, index) => (
                    <div key={`${entry.resourceId}-${index}`} className="audit-row">
                      <span>{new Date(entry.occurredAt).toLocaleString()}</span>
                      <span>{entry.action}</span>
                      <span>{entry.resourceType} · {entry.resourceId}</span>
                    </div>
                  ))}
                  {auditLog.length === 0 && <span>No audit entries recorded.</span>}
                </div>
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
