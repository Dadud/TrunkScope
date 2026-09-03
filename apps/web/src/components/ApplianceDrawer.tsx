import { useState, useEffect, type ChangeEvent } from "react";
import type { Receiver, Snapshot } from "../types";
import {
  changePassword,
  createReceiver,
  deleteReceiver,
  getScanLists,
  getSettings,
  getSystems,
  importTalkgroups,
  receiverAction,
  saveScanList,
  saveSettings,
  saveSystem,
  updateReceiver,
  type AppSettings,
  type ReceiverInput,
  type ScanList,
  type SystemProfile,
} from "../api";
import { formatFrequency, signalQuality } from "../format";

interface ApplianceDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  snapshot: Snapshot;
  onUpdateReceiver: (receiver: Receiver) => void;
  onRemoveReceiver: (id: string) => void;
}

type Tab = "receivers" | "scanlists" | "systems" | "import" | "settings" | "security";

export function ApplianceDrawer({
  isOpen,
  onClose,
  snapshot,
  onUpdateReceiver,
  onRemoveReceiver,
}: ApplianceDrawerProps) {
  const [activeTab, setActiveTab] = useState<Tab>("receivers");
  const [statusMessage, setStatusMessage] = useState("");

  // Receivers State
  const [editingReceiverId, setEditingReceiverId] = useState<string | null>(null);
  const [receiverDraft, setReceiverDraft] = useState<ReceiverInput>({
    label: "New SDR",
    driver: "sdrplay",
    serial: "",
    centerFrequencyHz: 851012500,
    sampleRateHz: 2400000,
    gainDb: 40,
    ppm: 0,
  });
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
  }, [isOpen]);

  if (!isOpen) return null;

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
      const res = await importTalkgroups(file);
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
            ⚡ SYSTEMS & PROFILES
          </button>
          <button
            type="button"
            className={activeTab === "import" ? "active" : ""}
            onClick={() => setActiveTab("import")}
          >
            📂 TALKGROUP IMPORT
          </button>
          <button
            type="button"
            className={activeTab === "settings" ? "active" : ""}
            onClick={() => setActiveTab("settings")}
          >
            ⚙️ SETTINGS
          </button>
          <button
            type="button"
            className={activeTab === "security" ? "active" : ""}
            onClick={() => setActiveTab("security")}
          >
            🔒 SECURITY
          </button>
        </div>

        {statusMessage && <div className="appliance-status-bar">{statusMessage}</div>}

        <div className="appliance-body">
          {/* RECEIVERS TAB */}
          {activeTab === "receivers" && (
            <div className="tab-pane">
              <div className="pane-header">
                <h3>Hardware SDR Receivers</h3>
                <button
                  type="button"
                  className="primary-btn"
                  onClick={() => setShowAddReceiver(!showAddReceiver)}
                >
                  {showAddReceiver ? "Cancel" : "+ Add Receiver"}
                </button>
              </div>

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
                          setReceiverDraft({
                            ...receiverDraft,
                            driver: e.target.value as ReceiverInput["driver"],
                          })
                        }
                      >
                        <option value="sdrplay">SDRplay RSP1B</option>
                        <option value="rtlSdr">RTL-SDR</option>
                        <option value="airspy">Airspy</option>
                        <option value="simulator">Simulator</option>
                      </select>
                    </label>
                    <label>
                      Device String / Args
                      <input
                        type="text"
                        placeholder="e.g. driver=sdrplay or driver=remote..."
                        value={receiverDraft.serial}
                        onChange={(e) => setReceiverDraft({ ...receiverDraft, serial: e.target.value })}
                      />
                    </label>
                    <label>
                      Center Frequency (Hz)
                      <input
                        type="number"
                        value={receiverDraft.centerFrequencyHz}
                        onChange={(e) =>
                          setReceiverDraft({ ...receiverDraft, centerFrequencyHz: Number(e.target.value) })
                        }
                      />
                    </label>
                    <label>
                      Sample Rate (Hz)
                      <input
                        type="number"
                        value={receiverDraft.sampleRateHz}
                        onChange={(e) =>
                          setReceiverDraft({ ...receiverDraft, sampleRateHz: Number(e.target.value) })
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
                    </div>

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
                            centerFrequencyHz: r.centerFrequencyHz ?? 851012500,
                            sampleRateHz: r.sampleRateHz ?? 2400000,
                            gainDb: r.gainDb ?? 40,
                            ppm: r.ppm,
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
                            Device Serial / Args
                            <input
                              type="text"
                              value={receiverDraft.serial}
                              onChange={(e) =>
                                setReceiverDraft({ ...receiverDraft, serial: e.target.value })
                              }
                            />
                          </label>
                          <label>
                            Center Frequency (Hz)
                            <input
                              type="number"
                              value={receiverDraft.centerFrequencyHz}
                              onChange={(e) =>
                                setReceiverDraft({
                                  ...receiverDraft,
                                  centerFrequencyHz: Number(e.target.value),
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
                        <input
                          type="number"
                          value={chan.frequencyHz}
                          placeholder="Frequency (Hz)"
                          onChange={(e) => {
                            const updated = [...editingScanList.channels];
                            updated[idx].frequencyHz = Number(e.target.value);
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
              <div className="systems-list">
                {systems.map((sys) => (
                  <div key={sys.id} className="config-box">
                    <div className="box-header">
                      <strong>{sys.name}</strong>
                      <span>Protocol: {sys.protocol}</span>
                      <span>Control: {formatFrequency(sys.controlChannelHz)}</span>
                      <span>NAC: ${sys.nac?.toString(16).toUpperCase() ?? "—"}</span>
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
                      onChange={(e) => setSystemDraft({ ...systemDraft, protocol: e.target.value })}
                    >
                      <option value="p25">P25 Phase 1/2 Trunked</option>
                      <option value="analog-fm">Analog FM Conventional</option>
                    </select>
                  </label>
                  <label>
                    Control Channel (Hz)
                    <input
                      type="number"
                      value={systemDraft.controlChannelHz ?? ""}
                      onChange={(e) =>
                        setSystemDraft({ ...systemDraft, controlChannelHz: Number(e.target.value) })
                      }
                    />
                  </label>
                  <label>
                    NAC (Hex/Decimal)
                    <input
                      type="number"
                      value={systemDraft.nac ?? ""}
                      onChange={(e) =>
                        setSystemDraft({ ...systemDraft, nac: Number(e.target.value) })
                      }
                    />
                  </label>
                </div>
                <button type="button" className="primary-btn" onClick={handleSaveSystem}>
                  Save System Profile
                </button>
              </div>
            </div>
          )}

          {/* TALKGROUP CSV IMPORT TAB */}
          {activeTab === "import" && (
            <div className="tab-pane">
              <h3>Import Talkgroups from CSV</h3>
              <p className="pane-desc">
                Upload RadioReference or Trunk Recorder compatible CSV files to populate talkgroup alpha tags and categories.
              </p>
              <div className="import-box">
                <input type="file" accept=".csv" onChange={handleFileUpload} />
              </div>
            </div>
          )}

          {/* SETTINGS TAB */}
          {activeTab === "settings" && settings && (
            <div className="tab-pane">
              <h3>Appliance Configuration</h3>

              <div className="config-section">
                <h4>Map Center & Home Coordinates</h4>
                <div className="form-grid">
                  <label>
                    Home Label
                    <input
                      type="text"
                      value={settings.homeLabel}
                      onChange={(e) => setSettings({ ...settings, homeLabel: e.target.value })}
                    />
                  </label>
                  <label>
                    Latitude
                    <input
                      type="number"
                      step="0.0001"
                      value={settings.homeLatitude}
                      onChange={(e) =>
                        setSettings({ ...settings, homeLatitude: Number(e.target.value) })
                      }
                    />
                  </label>
                  <label>
                    Longitude
                    <input
                      type="number"
                      step="0.0001"
                      value={settings.homeLongitude}
                      onChange={(e) =>
                        setSettings({ ...settings, homeLongitude: Number(e.target.value) })
                      }
                    />
                  </label>
                </div>
              </div>

              <div className="config-section">
                <h4>AI Transcription & Summarization</h4>
                <div className="form-grid">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={settings.aiEnabled}
                      onChange={(e) => setSettings({ ...settings, aiEnabled: e.target.checked })}
                    />
                    Enable AI Transcription & Summary
                  </label>
                  <label>
                    ASR Model
                    <input
                      type="text"
                      value={settings.transcribeModel}
                      onChange={(e) =>
                        setSettings({ ...settings, transcribeModel: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    LLM Summary Model
                    <input
                      type="text"
                      value={settings.summaryModel}
                      onChange={(e) => setSettings({ ...settings, summaryModel: e.target.value })}
                    />
                  </label>
                  <label>
                    Summary Refresh Window (min)
                    <input
                      type="number"
                      value={settings.summaryRefreshMinutes ?? 15}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          summaryRefreshMinutes: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                </div>
              </div>

              <div className="config-section">
                <h4>Data Retention (Days)</h4>
                <div className="form-grid">
                  <label>
                    Audio Recordings (Days)
                    <input
                      type="number"
                      value={settings.audioRetentionDays ?? 30}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          audioRetentionDays: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    Transcripts (Days)
                    <input
                      type="number"
                      value={settings.transcriptRetentionDays ?? 365}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          transcriptRetentionDays: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    Call Metadata (Days)
                    <input
                      type="number"
                      value={settings.metadataRetentionDays ?? 365}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          metadataRetentionDays: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                </div>
              </div>

              <button type="button" className="primary-btn" onClick={handleSaveSettings}>
                Save Appliance Settings
              </button>
            </div>
          )}

          {/* SECURITY & PASSWORDS TAB */}
          {activeTab === "security" && (
            <div className="tab-pane">
              <h3>Security & Password Rotation</h3>
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
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
