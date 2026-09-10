import { useState, useEffect, type ChangeEvent } from "react";
import { EnrichmentActions } from "./EnrichmentActions";
import type { Receiver, Snapshot } from "../types";
import {
  applyDecoderConfig,
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
import { IntegrationModelField } from "./IntegrationModelField";
import { EnrichmentSettings } from "./EnrichmentSettings";
import { MhzField } from "./MhzField";
import { applySubmodelPreset, presetSummary } from "../receiverPresets";
import { deriveAiProfile, pickSummaryModel, pickTranscribeModel } from "../integrationModels";
import { formatFrequency, hzToMhz, mhzToHz, signalQuality } from "../format";

interface ApplianceDrawerProps {
  section?: "radio" | "settings";
  isOpen: boolean;
  onClose: () => void;
  snapshot: Snapshot;
  onUpdateReceiver: (receiver: Receiver) => void;
  onRemoveReceiver: (id: string) => void;
}

type Tab = "overview" | "sources" | "trunked" | "conventional" | "rf" | "monitoring" | "settings-home" | "integrations" | "policy" | "notifications" | "retention" | "security" | "diagnostics";

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
  section = "radio",
  isOpen,
  onClose,
  snapshot,
  onUpdateReceiver,
  onRemoveReceiver,
}: ApplianceDrawerProps) {
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const systemView = activeTab === "conventional" ? "conventional" : "trunked";
  useEffect(() => {
    if (isOpen) setActiveTab(section === "settings" ? "settings-home" : "overview");
  }, [isOpen, section]);
  const [statusMessage, setStatusMessage] = useState("");
  const [hasDrafts, setHasDrafts] = useState(false);
  const [runtime, setRuntime] = useState<Awaited<ReturnType<typeof getRuntime>>>();
  const [diagnostics, setDiagnostics] = useState<Awaited<ReturnType<typeof getDiagnostics>>>();
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [decoderConfig, setDecoderConfig] = useState<string>("");
  const [talkgroups, setTalkgroups] = useState<Talkgroup[]>([]);
  const [talkgroupPanelSystem, setTalkgroupPanelSystem] = useState<string | null>(null);
  const [talkgroupDraft, setTalkgroupDraft] = useState<Talkgroup>({ id: "", systemId: "00000000-0000-0000-0000-000000000000", decimalId: 0, alphaTag: "New talkgroup", description: "", category: "Unknown", enabled: true, record: true, publicAllowed: false, mode: "D" });
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
    gainSettings: {},
    ppm: 0,
    enabled: true,
    role: "general",
    soapyIndex: 0,
    autoTune: false,
    digitalRecorders: 6,
    dmrRecorders: 4,
    analogRecorders: 4,
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
    id: "00000000-0000-0000-0000-000000000000",
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
    if (!statusMessage) return;
    // Status notes are ephemeral: a stale error bar from an old action must
    // not read as the current state of the appliance.
    const timer = window.setTimeout(() => setStatusMessage(""), 6000);
    return () => window.clearTimeout(timer);
  }, [statusMessage]);

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
    // Load once when the panel opens. Keeping drafts in memory while moving
    // between focused screens prevents partially entered receiver, channel,
    // and settings changes from being overwritten.
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
      setHasDrafts(false);
      setStatusMessage("Receiver settings saved — the capture reloads automatically.");
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : "Save failed");
    }
  };

  const handleAddReceiver = async () => {
    try {
      const created = await createReceiver(receiverDraft);
      onUpdateReceiver(created);
      setShowAddReceiver(false);
      setHasDrafts(false);
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
    setStatusMessage("Saving configuration…");
    try {
      const saved = await saveSystem(systemDraft);
      setSystems((prev) => [...prev.filter((s) => s.id !== saved.id), saved]);
      setSystemDraft(saved);
      setHasDrafts(false);
      setStatusMessage("Applied — decoder configuration is updating");
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : "System save failed");
    }
  };

  const handleSaveAndAddChannel = async () => {
    setStatusMessage("Saving channel…");
    try {
      const saved = await saveSystem(systemDraft);
      setSystems((prev) => [...prev.filter((system) => system.id !== saved.id), saved]);
      setSystemDraft({
        id: "00000000-0000-0000-0000-000000000000",
        name: "New conventional channel",
        protocol: saved.protocol,
        frequencyHz: saved.frequencyHz,
        bandwidthHz: saved.bandwidthHz,
        modulation: saved.modulation,
        receiverId: saved.receiverId,
        sites: [],
      });
      setHasDrafts(false);
      setStatusMessage("Applied — channel saved. Enter the next channel.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Channel save failed");
    }
  };

  const updateSystemSites = (systemId: string, update: (sites: NonNullable<SystemProfile["sites"]>) => NonNullable<SystemProfile["sites"]>) => {
    setSystems((items) => items.map((system) => system.id === systemId ? { ...system, sites: update(system.sites ?? []) } : system));
  };

  const saveSystemSites = async (systemId: string) => {
    const system = systems.find((item) => item.id === systemId);
    if (!system) return;
    setStatusMessage("Saving site plan…");
    try {
      const saved = await saveSystem(system);
      setSystems((items) => items.map((item) => item.id === saved.id ? saved : item));
      setStatusMessage("Applied — site plan saved");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Site plan save failed");
    }
  };

  // Talkgroups CSV import (scoped to the system whose panel hosts the input)
  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>, systemId: string) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const merge = (document.getElementById(`tg-merge-${systemId}`) as HTMLInputElement | null)?.checked ?? true;
      const res = await importTalkgroups(file, { systemId, merge });
      setTalkgroups(await getTalkgroups());
      setStatusMessage(`Imported ${res.rows} talkgroups successfully`);
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : "CSV import failed");
    }
  };

  // Settings save
  const handleSaveSettings = async () => {
    if (!settings) return;
    setStatusMessage("Saving settings…");
    try {
      const updated = await saveSettings(settings);
      setSettings(updated);
      setHasDrafts(false);
      setStatusMessage("Applied — settings saved");
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

  const requestClose = () => {
    if (hasDrafts && !window.confirm("Discard unsaved changes?")) return;
    setHasDrafts(false);
    onClose();
  };

  return (
    <div className="tactical-drawer-backdrop" onClick={requestClose}>
      <aside className="tactical-drawer wide-drawer" onClick={(e) => e.stopPropagation()} onInputCapture={() => setHasDrafts(true)}>
        <div className="drawer-header">
          <div>
            <small className="eyebrow">TRUNKSCOPE</small>
            <h2>{section === "settings" ? "Settings" : "Radio Setup"}</h2>
          </div>
          <button type="button" className="drawer-close-btn" onClick={requestClose}>
            &times;
          </button>
        </div>

        {activeTab !== "overview" && activeTab !== "settings-home" && (
          <div className="panel-crumb">
            <button type="button" className="back-btn" onClick={() => setActiveTab(section === "settings" ? "settings-home" : "overview")}>← Back</button>
            <span>{activeTab === "sources" ? "Receivers" : activeTab === "conventional" ? "Conventional channels" : activeTab === "trunked" ? "Trunked systems" : activeTab === "rf" ? "RF activity" : activeTab === "monitoring" ? "Monitoring plan" : activeTab === "integrations" ? "Transcription & summaries" : activeTab === "notifications" ? "Notifications" : activeTab === "retention" ? "Recording retention" : activeTab === "policy" ? "Public feed" : activeTab === "security" ? "Access & sharing" : "Diagnostics"}</span>
          </div>
        )}

        {statusMessage && (
          <div
            className={`appliance-status-bar${/fail|error|unavailable|invalid|denied|required|\(\d{3}\)/i.test(statusMessage) ? " error" : ""}`}
          >
            {statusMessage}
          </div>
        )}

        <div className="appliance-body">
          {activeTab === "overview" && (
            <div className="tab-pane setup-home">
              <h3>Radio Setup</h3>
              <p className="pane-desc">Set up receivers and what each one monitors. Saved changes apply to the decoder automatically.</p>
              <div className="setup-status-grid">
                <div className="config-box"><strong>{snapshot.receivers.length}</strong><span>receivers configured</span></div>
                <div className="config-box"><strong>{systems.filter((system) => !(system.protocol === "p25" || system.protocol === "dmr")).length}</strong><span>conventional channels</span></div>
                <div className="config-box"><strong>{systems.filter((system) => system.protocol === "p25" || system.protocol === "dmr").length}</strong><span>trunked systems</span></div>
                <div className="config-box"><strong>{diagnostics?.decoder.state ?? "Unavailable"}</strong><span>decoder status</span></div>
              </div>
              <div className="setup-menu">
                <button type="button" onClick={() => setActiveTab("sources")}><strong>Receivers</strong><span>Add hardware, tune coverage, recorder pools, and advanced gain controls.</span></button>
                <button type="button" onClick={() => setActiveTab("conventional")}><strong>Conventional channels</strong><span>Analog FM, fixed P25, and fixed DMR channels.</span></button>
                <button type="button" onClick={() => setActiveTab("trunked")}><strong>Trunked systems</strong><span>P25 and DMR systems, sites, control channels, and talkgroups.</span></button>
                <button type="button" onClick={() => setActiveTab("monitoring")}><strong>Monitoring plan</strong><span>Receiver coverage, assigned channels, and recorder capacity.</span></button>
                <button type="button" onClick={() => setActiveTab("rf")}><strong>RF activity</strong><span>Signal level and gain adjustment while the receiver is operating.</span></button>
              </div>
            </div>
          )}

          {activeTab === "settings-home" && (
            <div className="tab-pane setup-home">
              <h3>Settings</h3>
              <p className="pane-desc">Manage processing, notifications, access, and appliance diagnostics.</p>
              <div className="setup-menu">
                <button type="button" onClick={() => setActiveTab("integrations")}><strong>Transcription & summaries</strong><span>ASR, summary models, prompts, lookback period, vocabulary, and map location context.</span></button>
                <button type="button" onClick={() => setActiveTab("notifications")}><strong>Notifications</strong><span>Discord webhooks and alert rules.</span></button>
                <button type="button" onClick={() => setActiveTab("retention")}><strong>Recording retention</strong><span>How long recordings and transcripts are kept.</span></button>
                <button type="button" onClick={() => setActiveTab("policy")}><strong>Public feed</strong><span>Delayed public access and allowed radio traffic.</span></button>
                <button type="button" onClick={() => setActiveTab("security")}><strong>Access & sharing</strong><span>Administrator password, sharing policy, and audit history.</span></button>
                <button type="button" onClick={() => setActiveTab("diagnostics")}><strong>Diagnostics</strong><span>Runtime status, decoder configuration, and advanced troubleshooting.</span></button>
              </div>
            </div>
          )}
          {activeTab === "rf" && (
            <div className="tab-pane">
              <h3>RF Activity</h3>
              <p className="pane-desc">Tune gain while watching the real receiver signal and noise floor. Changes are saved per receiver.</p>
              {snapshot.receivers.map((receiver) => {
                const signal = receiver.health.signalDbfs;
                const noise = receiver.health.noiseDbfs;
                const telemetryAge = Date.now() - new Date(receiver.health.updatedAt).getTime();
                const telemetryFresh = Number.isFinite(telemetryAge) && telemetryAge < 15_000;
                const margin = signal - noise;
                const level = Math.max(0, Math.min(100, (signal + 120) / 1.2));
                return <div className="config-box" key={receiver.id}>
                  <div className="box-header"><strong>{receiver.label}</strong><span>{receiver.state.toUpperCase()}</span><span>{receiver.driver}</span></div>
                  <div className="rf-meter"><span>{telemetryFresh ? `Signal ${signal.toFixed(1)} dBFS` : "Signal telemetry unavailable"}</span><div className="rf-meter-track"><i style={{ width: telemetryFresh ? `${level}%` : "0%" }} /></div></div>
                  <div className="rf-stats"><span>Noise floor {telemetryFresh ? `${noise.toFixed(1)} dBFS` : "—"}</span><span>Margin {telemetryFresh ? `${margin.toFixed(1)} dB` : "—"}</span><span>Drops {receiver.health.droppedSamples}</span></div>
                  <div className="form-grid">
                    <label>{receiver.driver === "sdrplay" ? "IF gain reduction (dB)" : "Gain (dB)"}<input type="number" min={receiver.driver === "sdrplay" ? 20 : 0} max={receiver.driver === "sdrplay" ? 59 : 100} step="1" value={receiver.gainDb ?? 40} onChange={(e) => { const gainDb = Number(e.target.value); void updateReceiver(receiver.id, { label: receiver.label, driver: receiver.driver, serial: receiver.serial, centerFrequencyHz: receiver.centerFrequencyHz, sampleRateHz: receiver.sampleRateHz, gainDb, gainSettings: receiver.gainSettings, ppm: receiver.ppm, enabled: receiver.enabled, role: receiver.role, soapyIndex: receiver.soapyIndex, autoTune: receiver.autoTune, digitalRecorders: receiver.digitalRecorders, analogRecorders: receiver.analogRecorders, dmrRecorders: receiver.dmrRecorders }).then(onUpdateReceiver).catch(() => setStatusMessage("Gain update failed")); }} /></label>
                    {receiver.driver === "sdrplay" && <label>RF gain reduction (0–9)<input type="number" min="0" max="9" step="1" value={receiver.gainSettings?.RFGR ?? 4} onChange={(e) => { const gainSettings = { ...(receiver.gainSettings ?? {}), RFGR: Number(e.target.value) }; void updateReceiver(receiver.id, { label: receiver.label, driver: receiver.driver, serial: receiver.serial, centerFrequencyHz: receiver.centerFrequencyHz, sampleRateHz: receiver.sampleRateHz, gainDb: receiver.gainDb, gainSettings, ppm: receiver.ppm, enabled: receiver.enabled, role: receiver.role, soapyIndex: receiver.soapyIndex, autoTune: receiver.autoTune, digitalRecorders: receiver.digitalRecorders, analogRecorders: receiver.analogRecorders, dmrRecorders: receiver.dmrRecorders }).then(onUpdateReceiver).catch(() => setStatusMessage("RF gain update failed")); }} /></label>}
                  </div>
                  <p className="pane-desc">{receiver.driver === "sdrplay" ? "SDRplay uses gain reduction: lower IFGR/RFGR means more gain; higher values mean less gain. RFGR is a discrete LNA state, not dB." : ""} {telemetryFresh ? "Live telemetry is fresh." : "No fresh RF telemetry. Decoder mode reports levels only during calls; use radiod mode for continuous capture metrics."} A waterfall needs an FFT stream from the receiver.</p>
                </div>;
              })}
            </div>
          )}
          {/* SOURCES TAB */}
          {activeTab === "sources" && (
            <div className="tab-pane">
              <h3>Receivers</h3>
              <p className="pane-desc">Each receiver covers a slice of spectrum and shares its recorder pools across the channels assigned to it.</p>

              {settings && (
                <div className="config-section">
                  <h4>Capture engine</h4>
                  <p className="pane-desc">This is usually set once. Receiver tuning and gain belong to the receiver cards below.</p>
                  <div className="form-grid">
                    <label>Capture mode<select value={settings.radioMode} onChange={(e) => setSettings({ ...settings, radioMode: e.target.value })}><option value="simulator">Simulator</option><option value="radiod">radiod (native)</option><option value="decoder">Decoder (Trunk Recorder)</option></select></label>
                  </div>
                  <details className="fallback-details">
                    <summary>Advanced — fallback defaults for receivers that leave a value blank</summary>
                    <div className="form-grid">
                      <label>Fallback device<input value={settings.radioDevice} onChange={(e) => setSettings({ ...settings, radioDevice: e.target.value })} /></label>
                      <label>Center frequency (MHz)<MhzField valueHz={settings.radioFrequencyHz} placeholder="154.0" onChange={(radioFrequencyHz) => setSettings({ ...settings, radioFrequencyHz })} /></label>
                      <label>Sample rate (MHz)<MhzField valueHz={settings.radioSampleRateHz} placeholder="2.4" onChange={(radioSampleRateHz) => setSettings({ ...settings, radioSampleRateHz })} /></label>
                      <label>Bandwidth (MHz)<MhzField valueHz={settings.radioBandwidthHz} placeholder="0.2" onChange={(value) => setSettings({ ...settings, radioBandwidthHz: value || undefined })} /></label>
                      <label>Gain (dB)<input type="number" value={settings.radioGainDb ?? ""} onChange={(e) => setSettings({ ...settings, radioGainDb: Number(e.target.value) })} /></label>
                      <label className="checkbox-label"><input type="checkbox" checked={settings.radioAgc} onChange={(e) => setSettings({ ...settings, radioAgc: e.target.checked })} /> AGC enabled</label>
                      <label>PPM<input type="number" step="0.1" value={settings.radioPpm} onChange={(e) => setSettings({ ...settings, radioPpm: Number(e.target.value) })} /></label>
                    </div>
                    <small className="pane-desc">Receivers set their own RF below — these only fill gaps. Empty spectrum comes from a receiver tuned off-plan, not from these.</small>
                  </details>
                  <button type="button" className="primary-btn" onClick={handleSaveSettings}>Save capture settings</button>
                </div>
              )}

              <div className="pane-header">
                <h3>Hardware SDR Receivers</h3>
                <div className="btn-row">
                  <button type="button" onClick={handleDiscoverReceivers}>Discover devices</button>
                  <button
                    type="button"
                    className="primary-btn"
                    onClick={() => {
                      // The draft is shared with the Configure flow; a fresh
                      // receiver must not inherit another receiver's values.
                      if (!showAddReceiver) {
                        const preset = devicePresets.find((item) => item.driver === "sdrplay");
                        const submodel = preset?.submodels[0];
                        setReceiverDraft({
                          label: "New SDR",
                          driver: "sdrplay",
                          serial: "",
                          centerFrequencyHz: submodel?.centerFrequencyHz ?? 154_000_000,
                          sampleRateHz: submodel?.sampleRateHz ?? 2_400_000,
                          gainDb: submodel?.gainDb ?? 40,
                          gainSettings: {},
                          ppm: submodel?.ppm ?? 0,
                          enabled: true,
                          role: "general",
                          soapyIndex: 0,
                          autoTune: false,
                          digitalRecorders: 6,
                          dmrRecorders: 4,
                          analogRecorders: 4,
                        });
                        setSubmodelId(submodel?.id ?? "");
                      }
                      setShowAddReceiver(!showAddReceiver);
                    }}
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

              {statusMessage && <div className="status-message" role="status">{statusMessage}</div>}

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
                    <label className="checkbox-label" title="Trunk Recorder autoTune: track observed tuning offsets and correct each call">
                      <input
                        type="checkbox"
                        checked={receiverDraft.autoTune ?? false}
                        onChange={(e) =>
                          setReceiverDraft({ ...receiverDraft, autoTune: e.target.checked })
                        }
                      /> Auto-tune PPM
                    </label>
                    <label title="Simultaneous digital (P25) calls this source can record">
                      Digital recorders
                      <input
                        type="number"
                        min={0}
                        value={receiverDraft.digitalRecorders ?? 6}
                        onChange={(e) =>
                          setReceiverDraft({ ...receiverDraft, digitalRecorders: Number(e.target.value) })
                        }
                      />
                    </label>
                    <label title="Simultaneous analog trunked calls; conventional channels get dedicated recorders">
                      Analog recorders
                      <input
                        type="number"
                        min={0}
                        value={receiverDraft.analogRecorders ?? 4}
                        onChange={(e) =>
                          setReceiverDraft({ ...receiverDraft, analogRecorders: Number(e.target.value) })
                        }
                      />
                    </label>
                    <label title="Trunked-DMR voice recorders; one per active TDMA slot">
                      DMR recorders
                      <input
                        type="number"
                        min={0}
                        value={receiverDraft.dmrRecorders ?? 4}
                        onChange={(e) =>
                          setReceiverDraft({ ...receiverDraft, dmrRecorders: Number(e.target.value) })
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
                            sampleRateHz: r.sampleRateHz ?? 2_400_000,
                            gainDb: r.gainDb ?? 40,
                            gainSettings: r.gainSettings,
                            ppm: r.ppm,
                            enabled: r.enabled ?? true,
                            role: r.role ?? "general",
                            soapyIndex: r.soapyIndex ?? 0,
                            autoTune: r.autoTune ?? false,
                            digitalRecorders: r.digitalRecorders ?? 6,
                            analogRecorders: r.analogRecorders ?? 4,
                            dmrRecorders: r.dmrRecorders ?? 4,
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
                            Sample rate (MHz)
                            <MhzField
                              valueHz={receiverDraft.sampleRateHz}
                              placeholder="2.4"
                              onChange={(sampleRateHz) => setReceiverDraft({ ...receiverDraft, sampleRateHz })}
                            />
                          </label>
                          <label>
                            {r.driver === "sdrplay" ? "IF gain reduction (dB)" : "Gain (dB)"}
                            <input
                              type="number"
                              value={receiverDraft.gainDb}
                              onChange={(e) =>
                                setReceiverDraft({ ...receiverDraft, gainDb: Number(e.target.value) })
                              }
                            />
                          </label>
                          {r.driver === "sdrplay" && <label>
                            RF gain reduction (0–9)
                            <input type="number" min="0" max="9" value={receiverDraft.gainSettings?.RFGR ?? 4} onChange={(e) => setReceiverDraft({ ...receiverDraft, gainSettings: { ...(receiverDraft.gainSettings ?? {}), RFGR: Number(e.target.value) } })} />
                            <small className="pane-desc">Lower IFGR/RFGR means more gain. RFGR is an SDRplay LNA state, not dB.</small>
                          </label>}
                        </div>
                        <details className="fallback-details">
                          <summary>Advanced receiver controls</summary>
                          <div className="form-grid">
                            <label>Frequency correction (PPM)<input type="number" step="0.1" value={receiverDraft.ppm} onChange={(event) => setReceiverDraft({ ...receiverDraft, ppm: Number(event.target.value) })} /></label>
                            <label>Digital recorders<input type="number" min="0" value={receiverDraft.digitalRecorders ?? 6} onChange={(event) => setReceiverDraft({ ...receiverDraft, digitalRecorders: Number(event.target.value) })} /></label>
                            <label>DMR recorders<input type="number" min="0" value={receiverDraft.dmrRecorders ?? 4} onChange={(event) => setReceiverDraft({ ...receiverDraft, dmrRecorders: Number(event.target.value) })} /></label>
                            <label>Analog recorders<input type="number" min="0" value={receiverDraft.analogRecorders ?? 4} onChange={(event) => setReceiverDraft({ ...receiverDraft, analogRecorders: Number(event.target.value) })} /></label>
                            <label className="checkbox-label"><input type="checkbox" checked={receiverDraft.autoTune ?? false} onChange={(event) => setReceiverDraft({ ...receiverDraft, autoTune: event.target.checked })} /> Auto-tune PPM</label>
                            <label className="checkbox-label"><input type="checkbox" checked={receiverDraft.enabled ?? true} onChange={(event) => setReceiverDraft({ ...receiverDraft, enabled: event.target.checked })} /> Receiver enabled</label>
                          </div>
                          <p className="pane-desc">Automatic gain control is a capture-engine fallback because Soapy drivers expose AGC differently. The gain values above are applied directly to this receiver.</p>
                        </details>
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

          {/* MONITORING TAB */}
          {activeTab === "monitoring" && settings && settings.radioMode !== "radiod" && (
            <div className="tab-pane">
              <h3>Channel Monitoring</h3>
              <p className="pane-desc">
                Trunk Recorder does not scan — every planned channel inside a source's coverage is recorded simultaneously, limited by that source's recorder pool.
              </p>
              {diagnostics && (
                <div className="config-box">
                  <span>Decoder: {diagnostics.decoder.state} — {diagnostics.decoder.detail}</span>
                  <span>Heartbeat: {diagnostics.decoderHeartbeatAgeSeconds != null ? `${diagnostics.decoderHeartbeatAgeSeconds}s ago` : "none"}</span>
                  <span>Recording: {diagnostics.recording.state}</span>
                </div>
              )}
              {snapshot.receivers.filter((receiver) => receiver.enabled !== false).map((receiver) => {
                const center = receiver.centerFrequencyHz ?? settings.radioFrequencyHz;
                const rate = receiver.sampleRateHz ?? settings.radioSampleRateHz;
                const lowHz = Math.max(0, center - rate / 2);
                const highHz = center + rate / 2;
                const inCoverage = systems.flatMap((sys) => {
                  const channels: Array<{ label: string; hz: number; tone?: string }> = [];
                  if (sys.protocol === "p25" || sys.protocol === "dmr") {
                    (sys.controlChannelsHz?.length ? sys.controlChannelsHz : sys.controlChannelHz ? [sys.controlChannelHz] : [])
                      .forEach((hz) => channels.push({ label: `${sys.name} control`, hz }));
                    (sys.sites ?? []).forEach((site) =>
                      site.controlChannelsHz.forEach((hz) =>
                        channels.push({ label: `${sys.name} · ${site.name}`, hz }),
                      ),
                    );
                  } else if (sys.frequencyHz) {
                    channels.push({ label: sys.name, hz: sys.frequencyHz, tone: sys.tone });
                  }
                  return channels.filter((channel) => channel.hz >= lowHz && channel.hz <= highHz);
                });
                return (
                  <div key={receiver.id} className="config-box">
                    <div className="box-header">
                      <strong>{receiver.label}</strong>
                      <span>Center: {formatFrequency(center)}</span>
                      <span>Rate: {(rate / 1e6).toFixed(2)} MHz</span>
                      <span>Coverage: {formatFrequency(lowHz)} – {formatFrequency(highHz)}</span>
                      <span>Recorders: {receiver.digitalRecorders ?? 6} digital / {receiver.analogRecorders ?? 4} analog</span>
                    </div>
                    {inCoverage.length === 0 ? (
                      <p className="pane-desc warning">No planned channels fall inside this source's coverage. Add systems or widen the sample rate.</p>
                    ) : (
                      <div className="btn-row">
                        {inCoverage.map((channel) => (
                          <span key={`${channel.label}-${channel.hz}`}>
                            {formatFrequency(channel.hz)} · {channel.label}{channel.tone ? ` · PL ${channel.tone}` : ""}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {systems.length === 0 && (
                <p className="pane-desc">No systems configured yet — add them under Systems to build the monitoring plan.</p>
              )}
            </div>
          )}

          {/* SCANNING (radiod legacy) */}
          {activeTab === "monitoring" && settings && settings.radioMode === "radiod" && (
            <div className="tab-pane">
              <h3>FM Conventional Scan Lists</h3>
              <p className="pane-desc">
                Configure analog frequencies, squelch thresholds, and CTCSS/DCS tone lockouts. Scan lists are a <strong>radiod</strong>-mode legacy feature — Trunk Recorder monitors the whole channel plan at once.
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
          {(activeTab === "trunked" || activeTab === "conventional") && (
            <div className="tab-pane">
              <h3>{systemView === "conventional" ? "Conventional channels" : "Trunked systems"}</h3>
              <p className="pane-desc">{systemView === "conventional" ? "Each row is one fixed channel. Sites and talkgroups never apply here." : "Open a system to manage its control plan, sites, and talkgroups."}</p>
              <div className="systems-list">
                {systems.filter((sys) => systemView === "trunked" ? (sys.protocol === "p25" || sys.protocol === "dmr") : !(sys.protocol === "p25" || sys.protocol === "dmr")).map((sys) => (
                  <div key={sys.id} className="config-box">
                    <div className="box-header">
                      <strong>{sys.name}</strong>
                      <span>Protocol: {sys.protocol}</span>
                      {sys.protocol === "analog-fm" || sys.protocol === "conventional-p25" ? (
                        <>
                          <span>Freq: {formatFrequency(sys.frequencyHz)}</span>
                          {sys.protocol === "analog-fm" && <span>PL Tone: {sys.tone ?? "CSQ"}</span>}
                        </>
                      ) : (
                        <>
                          <span>Control: {formatFrequency(sys.controlChannelHz)}</span>
                          {sys.protocol === "p25" && (
                            <span>NAC: {sys.nac != null ? sys.nac.toString(16).toUpperCase() : "—"}</span>
                          )}
                        </>
                      )}
                    </div>
                    <div className="btn-row">
                      {(sys.protocol === "p25" || sys.protocol === "dmr") && <button
                        type="button"
                        onClick={() => setTalkgroupPanelSystem(talkgroupPanelSystem === sys.id ? null : sys.id)}
                      >Talkgroups ({talkgroups.filter((tg) => tg.systemId === sys.id).length})</button>}
                      {systemView === "trunked" && <label className="import-inline">Import sites
                        <input type="file" accept=".csv" onChange={async (event) => {
                          const file = event.target.files?.[0];
                          if (!file) return;
                          try {
                            const result = await importSites(file, sys.id, true);
                            setSystems(await getSystems());
                            setStatusMessage(`Imported ${result.rows} sites into ${sys.name}`);
                          } catch (error) {
                            setStatusMessage(error instanceof Error ? error.message : "Site import failed");
                          }
                        }} />
                      </label>}
                      <label className="checkbox-label"><input type="checkbox" checked={sys.enabled !== false} onChange={async (e) => { try { const saved = await saveSystem({ ...sys, enabled: e.target.checked }); setSystems((items) => items.map((item) => item.id === saved.id ? saved : item)); } catch (error) { setStatusMessage(error instanceof Error ? error.message : "Channel update failed"); } }} /> Enabled</label>
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
                    {systemView === "trunked" && (
                      <details className="fallback-details">
                        <summary>Sites and channel plan ({sys.sites?.length ?? 0})</summary>
                        {(sys.sites ?? []).map((site, index) => (
                          <div className="form-grid" key={site.id}>
                            <label>Site name<input value={site.name} onChange={(event) => updateSystemSites(sys.id, (sites) => sites.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} /></label>
                            <label>Control channels (MHz)<input value={site.controlChannelsHz.map(hzToMhz).join(", ")} placeholder="152.1125, 152.2175" onChange={(event) => updateSystemSites(sys.id, (sites) => sites.map((item, itemIndex) => itemIndex === index ? { ...item, controlChannelsHz: event.target.value.split(",").map(mhzToHz).filter((value) => value > 0) } : item))} /></label>
                            <label>Voice channels (MHz)<input value={site.voiceChannelsHz.map(hzToMhz).join(", ")} placeholder="Voice channels, comma separated" onChange={(event) => updateSystemSites(sys.id, (sites) => sites.map((item, itemIndex) => itemIndex === index ? { ...item, voiceChannelsHz: event.target.value.split(",").map(mhzToHz).filter((value) => value > 0) } : item))} /></label>
                            <button type="button" className="danger-btn" onClick={() => updateSystemSites(sys.id, (sites) => sites.filter((_, itemIndex) => itemIndex !== index))}>Remove site</button>
                          </div>
                        ))}
                        <div className="btn-row">
                          <button type="button" onClick={() => updateSystemSites(sys.id, (sites) => [...sites, { id: crypto.randomUUID(), name: "New site", controlChannelsHz: [], voiceChannelsHz: [] }])}>Add site</button>
                          <button type="button" className="primary-btn" onClick={() => void saveSystemSites(sys.id)}>Save site plan</button>
                        </div>
                      </details>
                    )}
                    {talkgroupPanelSystem === sys.id && (
                      <div className="r-edit-box">
                        {(sys.protocol === "p25" || sys.protocol === "dmr") && (
                          <>
                            {talkgroups.filter((tg) => tg.systemId === sys.id).length === 0 && (
                              <p className="pane-desc">No talkgroups yet. Import a RadioReference CSV or add one below.</p>
                            )}
                            {talkgroups.filter((tg) => tg.systemId === sys.id).map((tg) => (
                              <div key={tg.id} className="btn-row">
                                <span>{tg.decimalId} · {tg.alphaTag} · {tg.mode?.toUpperCase() ?? "D"}</span>
                                <button type="button" onClick={() => setTalkgroupDraft(tg)}>Edit</button>
                                <button type="button" className="danger-btn" onClick={async () => {
                                  try {
                                    await deleteTalkgroup(tg.id);
                                    setTalkgroups((items) => items.filter((item) => item.id !== tg.id));
                                  } catch (error) {
                                    setStatusMessage(error instanceof Error ? error.message : "Delete failed");
                                  }
                                }}>Delete</button>
                              </div>
                            ))}
                            <div className="form-grid">
                              <label>Alpha tag<input value={talkgroupDraft.alphaTag} onChange={(e) => setTalkgroupDraft({ ...talkgroupDraft, alphaTag: e.target.value })} /></label>
                              <label>Decimal ID<input type="number" value={talkgroupDraft.decimalId} onChange={(e) => setTalkgroupDraft({ ...talkgroupDraft, decimalId: Number(e.target.value) })} /></label>
                              <label>Mode
                                <select value={talkgroupDraft.mode ?? "D"} onChange={(e) => setTalkgroupDraft({ ...talkgroupDraft, mode: e.target.value })}>
                                  <option value="D">D — Digital (P25)</option>
                                  <option value="A">A — Analog</option>
                                  <option value="M">M — Mixed</option>
                                  <option value="T">T — TDMA</option>
                                </select>
                              </label>
                              <label className="checkbox-label"><input type="checkbox" checked={talkgroupDraft.record ?? true} onChange={(e) => setTalkgroupDraft({ ...talkgroupDraft, record: e.target.checked })} /> Record (unchecked = never record)</label>
                            </div>
                            <div className="btn-row">
                              <button type="button" className="primary-btn" onClick={async () => {
                                try {
                                  const saved = await saveTalkgroup({
                                    ...talkgroupDraft,
                                    systemId: sys.id,
                                    id: talkgroupDraft.id || crypto.randomUUID(),
                                  });
                                  setTalkgroups((items) => [...items.filter((item) => item.id !== saved.id), saved]);
                                  setTalkgroupDraft({
                                    id: "",
                                    systemId: sys.id,
                                    decimalId: 0,
                                    alphaTag: "New talkgroup",
                                    description: "",
                                    category: "Unknown",
                                    enabled: true,
                                    record: true,
                                    publicAllowed: false,
                                    mode: "D",
                                  });
                                  setStatusMessage(`Saved talkgroup ${saved.alphaTag}`);
                                } catch (error) {
                                  setStatusMessage(error instanceof Error ? error.message : "Talkgroup save failed");
                                }
                              }}>Save talkgroup</button>
                              <label className="checkbox-label"><input type="checkbox" id={`tg-merge-${sys.id}`} defaultChecked /> Merge on import</label>
                              <input type="file" accept=".csv" onChange={(e) => void handleFileUpload(e, sys.id)} />
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="config-box">
                <div className="pane-header"><h4>{systemDraft.id === "00000000-0000-0000-0000-000000000000" ? "Add configuration" : "Edit configuration"}</h4><button type="button" onClick={() => setSystemDraft({ id: "00000000-0000-0000-0000-000000000000", name: systemView === "trunked" ? "New trunked system" : "New conventional channel", protocol: systemView === "trunked" ? "p25" : "analog-fm", controlChannelHz: systemView === "trunked" ? 851012500 : undefined, frequencyHz: systemView === "trunked" ? undefined : 154445000, bandwidthHz: systemView === "trunked" ? undefined : 12500, modulation: systemView === "trunked" ? undefined : "NFM", sites: [] })}>+ New {systemView === "trunked" ? "trunked system" : "channel"}</button></div>
                <div className="form-grid">
                  <label>
                    {systemView === "conventional" ? "Channel name" : "System name"}
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
                          modulation: protocol === "analog-fm" ? "NFM" : protocol === "conventional-p25" || protocol === "conventional-dmr" ? "fsk4" : draft.modulation,
                          bandwidthHz: protocol === "analog-fm" ? draft.bandwidthHz ?? 12500 : draft.bandwidthHz,
                          controlChannelHz: protocol === "p25" || protocol === "dmr" ? draft.controlChannelHz ?? 851012500 : draft.controlChannelHz,
                        }));
                      }}
                    >
                      {systemView === "trunked" ? <>
                        <option value="p25">P25 Phase 1/2</option>
                        <option value="dmr">DMR Tier III / MotoTRBO</option>
                      </> : <>
                        <option value="analog-fm">Analog FM</option>
                        <option value="conventional-p25">P25</option>
                        <option value="conventional-dmr">DMR</option>
                      </>}
                    </select>
                  </label>
                  {systemDraft.protocol === "p25" || systemDraft.protocol === "dmr" ? (
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
                      {systemDraft.protocol === "p25" && (
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
                      )}
                      {systemDraft.protocol === "p25" && (
                        <label className="checkbox-label" title="Track encrypted calls for metadata without recording audio">
                          <input
                            type="checkbox"
                            checked={systemDraft.monitorEncrypted ?? false}
                            onChange={(e) =>
                              setSystemDraft({ ...systemDraft, monitorEncrypted: e.target.checked })
                            }
                          /> Monitor encrypted (metadata only)
                        </label>
                      )}
                    </>
                  ) : systemDraft.protocol === "conventional-p25" ? (
                    <>
                      <label>Frequency (MHz)<MhzField valueHz={systemDraft.frequencyHz} onChange={(frequencyHz) => setSystemDraft({ ...systemDraft, frequencyHz })} /></label>
                      <label>Modulation
                        <select value={systemDraft.modulation ?? "fsk4"} onChange={(e) => setSystemDraft({ ...systemDraft, modulation: e.target.value })}>
                          <option value="fsk4">C4FM</option>
                          <option value="qpsk">CQPSK / simulcast</option>
                        </select>
                      </label>
                      <label>Squelch (dB)<input type="number" value={systemDraft.squelchDb ?? -70} onChange={(e) => setSystemDraft({ ...systemDraft, squelchDb: Number(e.target.value) })} /></label>
                      <p className="pane-desc">A dedicated digital recorder monitors this channel continuously. Encrypted audio is excluded from playback and AI.</p>
                    </>
                  ) : systemDraft.protocol === "conventional-dmr" ? (
                    <>
                      <label>Frequency (MHz)<MhzField valueHz={systemDraft.frequencyHz} onChange={(frequencyHz) => setSystemDraft({ ...systemDraft, frequencyHz })} /></label>
                      <label>Color code (0–15)<input type="number" min="0" max="15" value={systemDraft.colorCode ?? 1} onChange={(e) => setSystemDraft({ ...systemDraft, colorCode: Number(e.target.value) })} /></label>
                      <label>Time slot<select value={systemDraft.timeSlot ?? 1} onChange={(e) => setSystemDraft({ ...systemDraft, timeSlot: Number(e.target.value) })}><option value="1">1</option><option value="2">2</option></select></label>
                      <label>Contact / talkgroup ID<input type="number" min="0" value={systemDraft.contactId ?? ""} onChange={(e) => setSystemDraft({ ...systemDraft, contactId: e.target.value ? Number(e.target.value) : undefined })} /></label>
                      <p className="pane-desc">A dedicated digital recorder monitors this fixed DMR channel continuously.</p>
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
                        <input value={systemDraft.tone ?? ""} onChange={(e) => setSystemDraft({ ...systemDraft, tone: e.target.value.trim() || undefined })} placeholder="123.0 or D023N" />
                        <small className="pane-desc">Squelch tone; leave blank for carrier squelch. Not two-tone dispatch.</small>
                      </label>
                      <label className="checkbox-label" title="Decode MDC-1200 signaling (fire station alerting tones)">
                        <input
                          type="checkbox"
                          checked={systemDraft.decodeMdc ?? false}
                          onChange={(e) => setSystemDraft({ ...systemDraft, decodeMdc: e.target.checked })}
                        /> Decode MDC signaling
                      </label>
                      </>
                    )}
                  {systemDraft.protocol !== "p25" && systemDraft.protocol !== "dmr" && <>
                    <label>Counties<input value={(systemDraft.counties ?? []).join(", ")} placeholder="Jackson, Wood" onChange={(e) => setSystemDraft({ ...systemDraft, counties: e.target.value.split(",").map((v) => v.trim()).filter(Boolean) })} /></label>
                    <label>Townships<input value={(systemDraft.townships ?? []).join(", ")} placeholder="Cleveland, Cary" onChange={(e) => setSystemDraft({ ...systemDraft, townships: e.target.value.split(",").map((v) => v.trim()).filter(Boolean) })} /></label>
                    <label>Municipalities<input value={(systemDraft.municipalities ?? []).join(", ")} placeholder="Pittsville" onChange={(e) => setSystemDraft({ ...systemDraft, municipalities: e.target.value.split(",").map((v) => v.trim()).filter(Boolean) })} /></label>
                    <label className="full-width">Local context<textarea rows={2} value={systemDraft.localContext ?? ""} placeholder="Coverage area, common intersections, agency terms" onChange={(e) => setSystemDraft({ ...systemDraft, localContext: e.target.value || undefined })} /></label>
                  </>}
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
                <div className="btn-row">
                  <button type="button" className="primary-btn" onClick={handleSaveSystem}>
                    Save {systemDraft.protocol === "p25" || systemDraft.protocol === "dmr" ? "trunked system" : "conventional channel"}
                  </button>
                  {systemView === "conventional" && <button type="button" onClick={handleSaveAndAddChannel}>Save & add another</button>}
                </div>
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
                  <label>Transcription provider
                    <select value={settings.transcribeProvider ?? "openai-compatible"} onChange={(e) => {
                      const provider = e.target.value;
                      const defaults: Record<string, Partial<AppSettings>> = {
                        "openai-compatible": { transcribeUrl: "http://127.0.0.1:8000/v1/audio/transcriptions", transcribeModel: "whisper-1" },
                        "openai": { transcribeUrl: "https://api.openai.com/v1/audio/transcriptions", transcribeModel: "gpt-4o-mini-transcribe" },
                        "groq": { transcribeUrl: "https://api.groq.com/openai/v1/audio/transcriptions", transcribeModel: "whisper-large-v3-turbo" },
                      };
                      setSettings({ ...settings, transcribeProvider: provider, ...(defaults[provider] ?? {}) });
                    }}>
                      <option value="openai-compatible">Local / OpenAI-compatible</option><option value="openai">OpenAI</option><option value="groq">Groq</option>
                    </select>
                  </label>
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
                  <label>Summary provider
                    <select value={settings.summaryProvider ?? "ollama"} onChange={(e) => {
                      const provider = e.target.value;
                      const defaults: Record<string, Partial<AppSettings>> = {
                        ollama: { summaryUrl: "http://127.0.0.1:11434/api/generate", summaryModel: "llama3.2:3b" },
                        "openai-compatible": { summaryUrl: "https://api.openai.com/v1/chat/completions", summaryModel: "gpt-4o-mini" },
                        anthropic: { summaryUrl: "https://api.anthropic.com/v1/messages", summaryModel: "claude-sonnet-4-20250514" },
                      };
                      setSettings({ ...settings, summaryProvider: provider, ...(defaults[provider] ?? {}) });
                    }}>
                      <option value="ollama">Local Ollama</option><option value="openai-compatible">OpenAI-compatible / OpenRouter</option><option value="anthropic">Anthropic</option>
                    </select>
                  </label>
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
                  <label>Summary lookback
                    <select value={settings.summaryLookbackHours ?? 4} onChange={(e) => setSettings({ ...settings, summaryLookbackHours: Number(e.target.value) })}>
                      <option value="1">Last hour</option><option value="4">Last 4 hours</option><option value="12">Last 12 hours</option><option value="24">Last 24 hours</option>
                    </select>
                  </label>
                  <label className="full-width">Transcription system prompt<textarea rows={4} value={settings.transcriptionSystemPrompt ?? ""} onChange={(e) => setSettings({ ...settings, transcriptionSystemPrompt: e.target.value })} /></label>
                  <label className="full-width">Summary system prompt<textarea rows={4} value={settings.summarySystemPrompt ?? ""} onChange={(e) => setSettings({ ...settings, summarySystemPrompt: e.target.value })} /></label>
                  <label className="full-width">Radio vocabulary<textarea rows={3} placeholder="One term per line: call signs, unit names, local places" value={(settings.radioVocabulary ?? []).join("\n")} onChange={(e) => setSettings({ ...settings, radioVocabulary: e.target.value.split(/\r?\n/).map((v) => v.trim()).filter(Boolean) })} /></label>
                  <EnrichmentSettings value={settings.aiTasks ?? {}} onChange={aiTasks => setSettings({ ...settings, aiTasks })} />
                </div>
                <div className="btn-row">
                  <button type="button" onClick={async () => { try { await testTranscribeIntegration(); setStatusMessage("Transcription provider reachable"); } catch (error) { setStatusMessage(error instanceof Error ? error.message : "Transcription test failed"); } }}>Test transcription</button>
                  <button type="button" onClick={async () => { try { await testSummaryIntegration(); setStatusMessage("Summary provider OK"); } catch (error) { setStatusMessage(error instanceof Error ? error.message : "Summary test failed"); } }}>Test summary</button>
                </div>
              </div>
              <div className="config-section">
                <h4>Geocoding</h4>
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
                  <label className="checkbox-label"><input type="checkbox" checked={settings.compatIngestEnabled ?? false} onChange={(e) => setSettings({ ...settings, compatIngestEnabled: e.target.checked })} /> Rdio-scanner compatible ingest (`/api/call-upload`)</label>
                </div>
                <button type="button" onClick={async () => { try { await testGeocoderIntegration(); setStatusMessage("Geocoder test OK"); } catch (error) { setStatusMessage(error instanceof Error ? error.message : "Geocoder test failed"); } }}>Test geocoder</button>
              </div>
              <button type="button" className="primary-btn" onClick={handleSaveSettings}>Save integrations</button>
            </div>
          )}

          {activeTab === "notifications" && settings && (<div className="tab-pane"><h3>Notifications</h3><p className="pane-desc">Tests send a message using the saved webhook. Save changes before testing.</p><div className="form-grid">
                  <label>Discord webhook URL<input value={settings.discordWebhookUrl ?? ""} onChange={(e) => setSettings({ ...settings, discordWebhookUrl: e.target.value })} /></label>
</div>
                <button type="button" onClick={async () => { try { await testDiscordWebhook(); setStatusMessage("Discord test delivered"); } catch (error) { setStatusMessage(error instanceof Error ? error.message : "Discord test failed"); } }}>Test Discord webhook</button>
                <h4>Keyword alert rules</h4>
                {(settings.discordKeywordRules ?? []).map((rule, index) => (
                  <div key={rule.id} className="form-grid">
                    <label>Keyword<input value={rule.keyword} onChange={(e) => setSettings({ ...settings, discordKeywordRules: (settings.discordKeywordRules ?? []).map((item, i) => i === index ? { ...item, keyword: e.target.value } : item) })} /></label>
                    <label>Override webhook<input value={rule.webhookUrl ?? ""} onChange={(e) => setSettings({ ...settings, discordKeywordRules: (settings.discordKeywordRules ?? []).map((item, i) => i === index ? { ...item, webhookUrl: e.target.value } : item) })} /></label>
                    <label className="checkbox-label"><input type="checkbox" checked={rule.enabled ?? true} onChange={(e) => setSettings({ ...settings, discordKeywordRules: (settings.discordKeywordRules ?? []).map((item, i) => i === index ? { ...item, enabled: e.target.checked } : item) })} /> Enabled</label>
                    <button type="button" aria-label={`Remove keyword rule ${index + 1}`} onClick={() => setSettings({ ...settings, discordKeywordRules: (settings.discordKeywordRules ?? []).filter((_, i) => i !== index) })}>Remove rule</button>
                  </div>
                ))}
                <button type="button" onClick={() => setSettings({ ...settings, discordKeywordRules: [...(settings.discordKeywordRules ?? []), { id: crypto.randomUUID(), keyword: "", webhookUrl: "", enabled: true } as DiscordKeywordRule] })}>Add keyword rule</button>
                <h4>Talkgroup Discord routing</h4>
                {(settings.discordTalkgroupRules ?? []).map((rule, index) => (
                  <div key={rule.id} className="form-grid">
                    <label>Talkgroup ID<input type="number" value={rule.talkgroupId} onChange={(e) => setSettings({ ...settings, discordTalkgroupRules: (settings.discordTalkgroupRules ?? []).map((item, i) => i === index ? { ...item, talkgroupId: Number(e.target.value) } : item) })} /></label>
                    <label>Webhook URL<input value={rule.webhookUrl ?? ""} onChange={(e) => setSettings({ ...settings, discordTalkgroupRules: (settings.discordTalkgroupRules ?? []).map((item, i) => i === index ? { ...item, webhookUrl: e.target.value } : item) })} /></label>
                    <label className="checkbox-label"><input type="checkbox" checked={rule.enabled ?? true} onChange={(e) => setSettings({ ...settings, discordTalkgroupRules: (settings.discordTalkgroupRules ?? []).map((item, i) => i === index ? { ...item, enabled: e.target.checked } : item) })} /> Enabled</label>
                    <button type="button" aria-label={`Remove talkgroup route ${index + 1}`} onClick={() => setSettings({ ...settings, discordTalkgroupRules: (settings.discordTalkgroupRules ?? []).filter((_, i) => i !== index) })}>Remove route</button>
                  </div>
                ))}
                <button type="button" onClick={() => setSettings({ ...settings, discordTalkgroupRules: [...(settings.discordTalkgroupRules ?? []), { id: crypto.randomUUID(), talkgroupId: 0, webhookUrl: "", enabled: true } as DiscordTalkgroupRule] })}>Add talkgroup route</button>
<button type="button" className="primary-btn" onClick={handleSaveSettings}>Save notifications</button></div>)}
          {activeTab === "retention" && settings && (<div className="tab-pane"><h3>Recording retention</h3><p className="pane-desc">Expired records are removed automatically. Set how many days to keep each type.</p>
              <div className="config-section">
                <h4>Retention (days)</h4>
                <div className="form-grid">
                  <label>Audio<input type="number" value={settings.audioRetentionDays ?? 30} onChange={(e) => setSettings({ ...settings, audioRetentionDays: Number(e.target.value) })} /></label>
                  <label>Transcripts<input type="number" value={settings.transcriptRetentionDays ?? 365} onChange={(e) => setSettings({ ...settings, transcriptRetentionDays: Number(e.target.value) })} /></label>
                  <label>Metadata<input type="number" value={settings.metadataRetentionDays ?? 365} onChange={(e) => setSettings({ ...settings, metadataRetentionDays: Number(e.target.value) })} /></label>
                </div>
              </div>
<button type="button" className="primary-btn" onClick={handleSaveSettings}>Save retention</button></div>)}
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
              <EnrichmentActions />
              {diagnostics && <div className="config-box"><span>Capture: {diagnostics.capture.state} — {diagnostics.capture.detail}</span><span>Decoder: {diagnostics.decoder.state} — {diagnostics.decoder.detail}</span><span>Recording: {diagnostics.recording.state}</span><span>Ingestion: {diagnostics.ingestion.state}</span><span>AI: {diagnostics.ai.state} — {diagnostics.ai.detail}</span><span>Image: {diagnostics.imageVersion ?? "unknown"}</span><span>Config hash: {diagnostics.configHash ?? "—"}</span><span>Process ID: {diagnostics.processId ?? "—"}</span><span>Decoder heartbeat age: {diagnostics.decoderHeartbeatAgeSeconds ?? "—"}s</span><span>Control lock age: {diagnostics.decoderControlLockAgeSeconds ?? "—"}s</span>{diagnostics.failureReason && <span>Failure: {diagnostics.failureReason}</span>}{diagnostics.aiFailureReason && <span>AI failure: {diagnostics.aiFailureReason}</span>}{diagnostics.simulated && <span className="live-tag">SIMULATED</span>}</div>}
              <div className="btn-row">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await applyDecoderConfig();
                      setStatusMessage("Apply requested — capture reloading with saved settings");
                    } catch (error) {
                      setStatusMessage(error instanceof Error ? error.message : "Apply failed");
                    }
                  }}
                >
                  {runtime?.decoderConfigPending ? "Apply pending changes now" : "Reload capture now"}
                </button>
                <span className="pane-desc">Saves apply automatically; this forces an immediate reload.</span>
              </div>
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
