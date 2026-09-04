import type { CallEvent, Receiver, Snapshot } from "./types";

export type AuthStatus = { enabled: boolean; setupRequired?: boolean; localOnly?: boolean };
export type Session = { username: string; role: string };
export type RuntimeStatus = { decoderConnected: boolean; decoderLastEvent?: string; receiverCount: number; activeCallCount: number; receiverStates?: string[]; aiEnabled?: boolean; aiWorkerStatus?: string; storagePath?: string; activeScanList?: string; storageHealthy?: boolean; queueBacklog?: number; lastEvent?: string; persistenceConnected?: boolean; decoderConfigPending?: boolean };
export type Diagnostics = { capture: { state: string; detail: string }; decoder: { state: string; detail: string }; recording: { state: string; detail: string }; ingestion: { state: string; detail: string }; ai: { state: string; detail: string }; simulated: boolean; lastEvent?: string; lastAudioFile?: string; failureReason?: string; aiFailureReason?: string; imageVersion?: string; decoderControlLockAgeSeconds?: number; decoderHeartbeatAgeSeconds?: number; processId?: number; configHash?: string };
export async function getDiagnostics(): Promise<Diagnostics> { const response = await fetch("/api/v1/diagnostics"); if (!response.ok) throw new Error(`API returned ${response.status}`); return response.json() as Promise<Diagnostics>; }
export type DiscordKeywordRule = { id: string; keyword: string; webhookUrl?: string; enabled?: boolean };
export type DiscordTalkgroupRule = { id: string; talkgroupId: number; webhookUrl?: string; enabled?: boolean };
export type AppSettings = { schemaVersion?: number; homeLabel: string; homeLatitude: number; homeLongitude: number; radioMode: string; radioDevice: string; radioFrequencyHz: number; radioSampleRateHz: number; radioBandwidthHz?: number; radioGainDb?: number; radioAgc: boolean; radioPpm: number; aiEnabled: boolean; aiProfile: string; transcribeUrl: string; transcribeProvider?: string; transcribeApiKey?: string; transcribeModel: string; vadEnabled: boolean; summaryModel: string; summaryProvider?: string; summaryApiKey?: string; summaryUrl?: string; summaryRefreshMinutes?: number; geocoderUrl?: string; geocoderProvider?: string; geocoderApiKey?: string; discordWebhookUrl?: string; discordKeywordRules?: DiscordKeywordRule[]; discordTalkgroupRules?: DiscordTalkgroupRule[]; siteFilter?: string; compatIngestEnabled?: boolean; wizardCompleted?: boolean; publicFeedEnabled: boolean; publicAllowedTalkgroups?: string[]; publicFeedDelaySeconds: number; exposeTranscripts: boolean; exposeRadioIds: boolean; exposePreciseLocations: boolean; audioRetentionDays?: number; transcriptRetentionDays?: number; metadataRetentionDays?: number };
export async function getSettings(): Promise<AppSettings> { const response = await fetch("/api/v1/settings"); if (!response.ok) throw new Error(`API returned ${response.status}`); return response.json() as Promise<AppSettings>; }
export async function saveSettings(settings: AppSettings): Promise<AppSettings> { const response = await fetch("/api/v1/settings", { method: "PUT", headers: { "content-type": "application/json" }, credentials: "include", body: JSON.stringify(settings) }); if (!response.ok) throw new Error(response.status === 401 ? "Administrator login required" : response.status === 400 ? "Check the coordinates and home label" : `API returned ${response.status}`); return response.json() as Promise<AppSettings>; }
export async function getRuntime(): Promise<RuntimeStatus> { const response = await fetch("/api/v1/runtime"); if (!response.ok) throw new Error(`API returned ${response.status}`); return response.json() as Promise<RuntimeStatus>; }
export async function receiverAction(id: string, action: "probe" | "start" | "stop" | "restart"): Promise<Receiver> { const response = await fetch(`/api/v1/receivers/${id}/${action}`, { method: "POST", credentials: "include" }); if (!response.ok) throw new Error(response.status === 401 ? "Administrator login required" : `API returned ${response.status}`); return response.json() as Promise<Receiver>; }
export type ReceiverInput = Pick<Receiver, "label" | "driver" | "serial" | "centerFrequencyHz" | "sampleRateHz" | "gainDb" | "ppm" | "enabled" | "role" | "soapyIndex" | "autoTune" | "digitalRecorders" | "analogRecorders" | "dmrRecorders">;
export type ReceiverSubmodelPreset = { id: string; label: string; sampleRateHz: number; gainDb: number; ppm: number; centerFrequencyHz: number; notes?: string };
export type ReceiverDevicePreset = { driver: Receiver["driver"]; label: string; submodels: ReceiverSubmodelPreset[] };
export async function getReceiverPresets(): Promise<ReceiverDevicePreset[]> { const response = await fetch("/api/v1/receivers/presets"); if (!response.ok) throw new Error(`Presets unavailable (${response.status})`); return response.json() as Promise<ReceiverDevicePreset[]>; }
export type DiscoveredDevice = { index: number; driver: string; label: string; serial: string; args: string; suggestedDriver: Receiver["driver"] };
export async function discoverReceivers(): Promise<DiscoveredDevice[]> { const response = await fetch("/api/v1/receivers/discover", { credentials: "include" }); if (!response.ok) throw new Error(response.status === 401 ? "Administrator login required" : `Discovery failed (${response.status})`); const body = await response.json() as { devices: DiscoveredDevice[] }; return body.devices; }
export async function getReceiverCapabilities(id: string): Promise<Receiver["capabilities"]> { const response = await fetch(`/api/v1/receivers/${id}/capabilities`, { credentials: "include" }); if (!response.ok) throw new Error(`Capabilities unavailable (${response.status})`); return response.json() as Promise<Receiver["capabilities"]>; }
export async function verifyReceiver(id: string): Promise<{ passed: boolean; checks: Array<{ name: string; passed: boolean; detail: string }> }> { const response = await fetch(`/api/v1/receivers/${id}/verify`, { method: "POST", credentials: "include" }); if (!response.ok) throw new Error(response.status === 401 ? "Administrator login required" : `Verify failed (${response.status})`); return response.json() as Promise<{ passed: boolean; checks: Array<{ name: string; passed: boolean; detail: string }> }>; }
export type IntegrationStatus = { configured: boolean; provider?: string; model?: string; mode?: string; keywordRules?: number };
export type DiscoveredModels = { models: string[]; source: string; catalogUrl: string };
export type TranscribeModelDiscoveryInput = {
  transcribeUrl?: string;
  transcribeProvider?: string;
  transcribeApiKey?: string;
};
export type SummaryModelDiscoveryInput = {
  summaryUrl?: string;
  summaryProvider?: string;
  summaryApiKey?: string;
};
async function discoveryError(response: Response): Promise<string> {
  if (response.status === 401) return "Administrator login required";
  let detail = "";
  try {
    detail = (await response.text()).trim();
  } catch {
    detail = "";
  }
  const suffix = detail ? `: ${detail.slice(0, 240)}` : "";
  return `Model discovery failed (${response.status})${suffix}`;
}
export async function discoverTranscribeModels(
  overrides?: TranscribeModelDiscoveryInput,
): Promise<DiscoveredModels> {
  const response = await fetch("/api/v1/integrations/transcribe/models", {
    method: overrides ? "POST" : "GET",
    credentials: "include",
    headers: overrides ? { "content-type": "application/json" } : undefined,
    body: overrides ? JSON.stringify(overrides) : undefined,
  });
  if (!response.ok) throw new Error(await discoveryError(response));
  return response.json() as Promise<DiscoveredModels>;
}
export async function discoverSummaryModels(
  overrides?: SummaryModelDiscoveryInput,
): Promise<DiscoveredModels> {
  const response = await fetch("/api/v1/integrations/summary/models", {
    method: overrides ? "POST" : "GET",
    credentials: "include",
    headers: overrides ? { "content-type": "application/json" } : undefined,
    body: overrides ? JSON.stringify(overrides) : undefined,
  });
  if (!response.ok) throw new Error(await discoveryError(response));
  return response.json() as Promise<DiscoveredModels>;
}
export async function getTranscribeStatus(): Promise<IntegrationStatus> { const response = await fetch("/api/v1/integrations/transcribe"); if (!response.ok) throw new Error(`API returned ${response.status}`); return response.json() as Promise<IntegrationStatus>; }
export async function getSummaryStatus(): Promise<IntegrationStatus> { const response = await fetch("/api/v1/integrations/summary"); if (!response.ok) throw new Error(`API returned ${response.status}`); return response.json() as Promise<IntegrationStatus>; }
export async function getGeocoderStatus(): Promise<IntegrationStatus> { const response = await fetch("/api/v1/integrations/geocoder"); if (!response.ok) throw new Error(`API returned ${response.status}`); return response.json() as Promise<IntegrationStatus>; }
export async function getDiscordStatus(): Promise<IntegrationStatus> { const response = await fetch("/api/v1/integrations/discord"); if (!response.ok) throw new Error(`API returned ${response.status}`); return response.json() as Promise<IntegrationStatus>; }
export async function createReceiver(input: ReceiverInput): Promise<Receiver> { const response = await fetch("/api/v1/receivers", { method: "POST", headers: { "content-type": "application/json" }, credentials: "include", body: JSON.stringify(input) }); if (!response.ok) throw new Error(response.status === 401 ? "Administrator login required" : `API returned ${response.status}`); return response.json() as Promise<Receiver>; }
export async function updateReceiver(id: string, input: ReceiverInput): Promise<Receiver> { const response = await fetch(`/api/v1/receivers/${id}`, { method: "PUT", headers: { "content-type": "application/json" }, credentials: "include", body: JSON.stringify(input) }); if (!response.ok) throw new Error(response.status === 401 ? "Administrator login required" : `API returned ${response.status}`); return response.json() as Promise<Receiver>; }
export async function deleteReceiver(id: string): Promise<void> { const response = await fetch(`/api/v1/receivers/${id}`, { method: "DELETE", credentials: "include" }); if (!response.ok) throw new Error(response.status === 401 ? "Administrator login required" : `API returned ${response.status}`); }
export async function getAuthStatus(): Promise<AuthStatus> { const response = await fetch("/api/v1/auth/status"); if (!response.ok) throw new Error(`API returned ${response.status}`); return response.json() as Promise<AuthStatus>; }
export async function login(username: string, password: string): Promise<Session> { const response = await fetch("/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, credentials: "include", body: JSON.stringify({ username: username.trim(), password }) }); if (!response.ok) throw new Error(response.status === 401 ? "Invalid username or password" : response.status === 503 ? "Administrator credentials are not configured; finish first-run setup" : response.status >= 500 ? "Login service is unavailable; check the control-plane health" : `Login unavailable (${response.status})`); return response.json() as Promise<Session>; }
export async function setupAdmin(username: string, password: string): Promise<void> { const response = await fetch("/api/v1/auth/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) }); if (!response.ok) throw new Error(response.status === 400 ? "Use a username and a password of at least 12 characters" : response.status === 409 ? "Administrator credentials are already configured" : `Setup unavailable (${response.status})`); }
export async function changePassword(username: string, password: string): Promise<void> { const response = await fetch("/api/v1/auth/password", { method: "PUT", headers: { "content-type": "application/json" }, credentials: "include", body: JSON.stringify({ username, password }) }); if (!response.ok) throw new Error(response.status === 400 ? "Password must be at least 12 characters" : response.status === 401 ? "Administrator login required" : `Password change unavailable (${response.status})`); }
export async function getSession(): Promise<Session | undefined> { const response = await fetch("/api/v1/auth/me", { credentials: "include" }); return response.ok ? response.json() as Promise<Session> : undefined; }
export async function logout(): Promise<void> { await fetch("/api/v1/auth/logout", { method: "POST", credentials: "include" }); }

export type SystemSite = { id: string; name: string; controlChannelsHz: number[]; voiceChannelsHz: number[]; latitude?: number; longitude?: number };
export type SystemProfile = { id: string; name: string; protocol: string; controlChannelHz?: number; controlChannelsHz?: number[]; nac?: number; frequencyHz?: number; bandwidthHz?: number; modulation?: string; squelchDb?: number; tone?: string; deviationHz?: number; stepHz?: number; dwellMs?: number; sites?: SystemSite[]; receiverId?: string; decodeMdc?: boolean; monitorEncrypted?: boolean };
export type ScanChannel = { id: string; name: string; frequencyHz: number; modulation: string; bandwidthHz: number; squelchDb: number; tone?: string; toneRequired: boolean; dwellMs: number; priority: number; lockedOut: boolean };
export type ScanList = { id: string; name: string; enabled: boolean; pauseOnActivity: boolean; resumeAfterMs: number; channels: ScanChannel[] };
export type ConversationSession = { id: string; talkgroupId: number; callIds: string[]; state: string; transcript?: string; summary?: string; location?: { label: string; latitude: number; longitude: number; confidence: number }; audioKeys?: string[] };
export async function confirmSessionLocation(sessionId: string, location: { label: string; latitude: number; longitude: number; confidence: number }): Promise<void> {
  const response = await fetch(`/api/v1/operations/sessions/${encodeURIComponent(sessionId)}/location`, { method: "PUT", headers: { "content-type": "application/json" }, credentials: "include", body: JSON.stringify(location) });
  if (!response.ok) throw new Error(response.status === 401 ? "Administrator login required" : `API returned ${response.status}`);
}
export async function getScanLists(): Promise<ScanList[]> { const response = await fetch("/api/v1/scan-lists"); if (!response.ok) throw new Error(`API returned ${response.status}`); return response.json() as Promise<ScanList[]>; }
export async function saveScanList(list: ScanList): Promise<ScanList> { const response = await fetch("/api/v1/scan-lists", { method: "POST", headers: { "content-type": "application/json" }, credentials: "include", body: JSON.stringify(list) }); if (!response.ok) throw new Error(response.status === 401 ? "Administrator login required" : `API returned ${response.status}`); return response.json() as Promise<ScanList>; }
export async function getSystems(): Promise<SystemProfile[]> { const response = await fetch("/api/v1/systems"); if (!response.ok) throw new Error(`API returned ${response.status}`); return response.json() as Promise<SystemProfile[]>; }
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

function normalizeSystemProfile(profile: Omit<SystemProfile, "id"> & { id?: string }): SystemProfile & { id: string } {
  const id = profile.id?.trim();
  const tone = profile.tone?.trim();
  return {
    ...profile,
    id: id && id !== NIL_UUID ? id : NIL_UUID,
    receiverId: profile.receiverId?.trim() || undefined,
    tone: tone || undefined,
    squelchDb:
      profile.squelchDb != null && Number.isFinite(profile.squelchDb)
        ? profile.squelchDb
        : undefined,
  };
}

export async function saveSystem(profile: Omit<SystemProfile, "id"> & { id?: string }): Promise<SystemProfile> {
  const body = normalizeSystemProfile(profile);
  const response = await fetch("/api/v1/systems", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(
      response.status === 401
        ? "Administrator login required"
        : response.status === 400
          ? "Check name, frequency, bandwidth (6.25/12.5/25 kHz), modulation, and PL tone"
          : response.status === 422
            ? "Invalid system profile JSON (check IDs and numeric fields)"
            : `API returned ${response.status}`,
    );
  }
  return response.json() as Promise<SystemProfile>;
}
export async function importTalkgroups(file: File, options?: { systemId?: string; merge?: boolean }): Promise<{ imported: boolean; rows: number; path: string }> {
  const params = new URLSearchParams();
  if (options?.systemId) params.set("systemId", options.systemId);
  if (options?.merge) params.set("merge", "true");
  const query = params.toString();
  const response = await fetch(`/api/v1/imports/talkgroups${query ? `?${query}` : ""}`, { method: "POST", headers: { "content-type": "text/csv" }, credentials: "include", body: file });
  if (!response.ok) throw new Error(response.status === 401 ? "Administrator login required" : response.status === 400 ? "Invalid talkgroup CSV" : `API returned ${response.status}`);
  return response.json() as Promise<{ imported: boolean; rows: number; path: string }>;
}

export async function importSites(file: File, systemId: string, merge = false): Promise<{ imported: boolean; rows: number }> {
  const params = new URLSearchParams({ systemId, merge: merge ? "true" : "false" });
  const response = await fetch(`/api/v1/imports/sites?${params}`, { method: "POST", headers: { "content-type": "text/csv" }, credentials: "include", body: file });
  if (!response.ok) throw new Error(response.status === 401 ? "Administrator login required" : response.status === 400 ? "Invalid site CSV" : `API returned ${response.status}`);
  return response.json() as Promise<{ imported: boolean; rows: number }>;
}

export async function testTranscribeIntegration(): Promise<void> {
  const response = await fetch("/api/v1/integrations/transcribe/test", { method: "POST", credentials: "include" });
  if (!response.ok) throw new Error("Transcription provider test failed");
}

export async function testSummaryIntegration(): Promise<void> {
  const response = await fetch("/api/v1/integrations/summary/test", { method: "POST", credentials: "include" });
  if (!response.ok) throw new Error("Summary provider test failed");
}

export async function testGeocoderIntegration(): Promise<void> {
  const response = await fetch("/api/v1/integrations/geocoder/test", { method: "POST", credentials: "include" });
  if (!response.ok) throw new Error("Geocoder test failed");
}

export const AI_STACK_PRESETS: Record<string, Partial<AppSettings>> = {
  "local-gpu": {
    aiEnabled: true,
    transcribeProvider: "openai-compatible",
    transcribeUrl: "http://192.168.1.10:8000/v1/audio/transcriptions",
    transcribeModel: "Qwen/Qwen3-ASR-1.7B",
    summaryProvider: "ollama",
    summaryUrl: "http://192.168.1.10:11434/api/generate",
    summaryModel: "llama3.2:3b",
    geocoderProvider: "nominatim",
    geocoderUrl: "https://nominatim.openstreetmap.org/search",
  },
  "cloud-hybrid": {
    aiEnabled: true,
    transcribeProvider: "groq-whisper",
    transcribeUrl: "https://api.groq.com/openai/v1/audio/transcriptions",
    transcribeModel: "whisper-large-v3",
    summaryProvider: "openai-compatible",
    summaryUrl: "https://openrouter.ai/api/v1/chat/completions",
    summaryModel: "meta-llama/llama-3.2-3b-instruct",
    geocoderProvider: "google",
    geocoderUrl: "https://maps.googleapis.com/maps/api/geocode/json",
  },
  "privacy-max": {
    aiEnabled: true,
    transcribeProvider: "openai-compatible",
    transcribeUrl: "http://192.168.1.10:8000/v1/audio/transcriptions",
    transcribeModel: "Systran/faster-distil-whisper-small.en",
    summaryProvider: "ollama",
    summaryUrl: "http://192.168.1.10:11434/api/generate",
    summaryModel: "llama3.2:3b",
    geocoderProvider: "nominatim",
    geocoderUrl: "",
  },
};

export async function getSnapshot(signal?: AbortSignal): Promise<Snapshot> {
  const response = await fetch("/api/v1/snapshot", { signal });
  if (!response.ok) throw new Error(`API returned ${response.status}`);
  return response.json() as Promise<Snapshot>;
}

export type IncidentThread = {
  key: string;
  systemName: string;
  talkgroupId: number;
  talkgroupLabel: string;
  category: string;
  severity: number;
  activityScore: number;
  callCount: number;
  firstSeen: string;
  lastSeen: string;
  radioIds: number[];
  locations: Array<{ label: string; latitude: number; longitude: number; confidence: number }>;
  locationHints: string[];
  excerpts: string[];
};
export type OperationsSummary = { hours: number; generatedAt: string; callCount: number; activeThreadCount: number; headline: string; aiSummary?: string; aiSummaryStatus?: string; threads: IncidentThread[] };
export async function getOperationsSummary(hours = 4, signal?: AbortSignal): Promise<OperationsSummary> {
  const response = await fetch(`/api/v1/operations/summary?hours=${hours}`, { signal });
  if (!response.ok) throw new Error(`API returned ${response.status}`);
  return response.json() as Promise<OperationsSummary>;
}

export function callAudioUrl(callId: string): string { return `/api/v1/calls/${encodeURIComponent(callId)}/audio`; }
export function conversationAudioUrl(sessionId: string): string { return `/api/v1/operations/sessions/${encodeURIComponent(sessionId)}/audio`; }

export function subscribeToCalls(
  onEvent: (event: CallEvent) => void,
  onStatus: (connected: boolean) => void,
): () => void {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${location.host}/api/v1/live`);
  socket.onopen = () => onStatus(true);
  socket.onclose = () => onStatus(false);
  socket.onerror = () => onStatus(false);
  socket.onmessage = (message) => {
    try { onEvent(JSON.parse(message.data as string) as CallEvent); } catch { /* ignore malformed events */ }
  };
  return () => socket.close();
}

export type Talkgroup = { id: string; systemId: string; decimalId: number; alphaTag: string; description: string; category: string; priority?: number; enabled?: boolean; record?: boolean; publicAllowed?: boolean; mode?: string };
export type AuditEntry = { action: string; resourceType: string; resourceId: string; occurredAt: string };
export type PublicationPolicy = { enabled: boolean; delaySeconds: number; allowedTalkgroups: string[]; exposeTranscripts: boolean; exposeRadioIds: boolean; exposePreciseLocations: boolean };

export async function getTalkgroups(): Promise<Talkgroup[]> {
  const response = await fetch("/api/v1/talkgroups");
  if (!response.ok) throw new Error(`API returned ${response.status}`);
  return response.json() as Promise<Talkgroup[]>;
}

export async function saveTalkgroup(talkgroup: Talkgroup): Promise<Talkgroup> {
  const response = await fetch("/api/v1/talkgroups", { method: "POST", headers: { "content-type": "application/json" }, credentials: "include", body: JSON.stringify(talkgroup) });
  if (!response.ok) throw new Error(response.status === 401 ? "Administrator login required" : `API returned ${response.status}`);
  return response.json() as Promise<Talkgroup>;
}

export async function updateTalkgroup(id: string, talkgroup: Talkgroup): Promise<Talkgroup> {
  const response = await fetch(`/api/v1/talkgroups/${encodeURIComponent(id)}`, { method: "PUT", headers: { "content-type": "application/json" }, credentials: "include", body: JSON.stringify(talkgroup) });
  if (!response.ok) throw new Error(response.status === 401 ? "Administrator login required" : `API returned ${response.status}`);
  return response.json() as Promise<Talkgroup>;
}

export async function deleteTalkgroup(id: string): Promise<void> {
  const response = await fetch(`/api/v1/talkgroups/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "include" });
  if (!response.ok) throw new Error(response.status === 401 ? "Administrator login required" : `API returned ${response.status}`);
}

export async function deleteSystem(id: string): Promise<void> {
  const response = await fetch(`/api/v1/systems/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "include" });
  if (!response.ok) throw new Error(response.status === 401 ? "Administrator login required" : `API returned ${response.status}`);
}

export async function startScanList(id: string): Promise<void> {
  const response = await fetch(`/api/v1/scan-lists/${encodeURIComponent(id)}/start`, { method: "POST", credentials: "include" });
  if (!response.ok) throw new Error(response.status === 401 ? "Administrator login required" : `API returned ${response.status}`);
}

export async function stopScanList(id: string): Promise<void> {
  const response = await fetch(`/api/v1/scan-lists/${encodeURIComponent(id)}/stop`, { method: "POST", credentials: "include" });
  if (!response.ok) throw new Error(response.status === 401 ? "Administrator login required" : `API returned ${response.status}`);
}

export async function deleteScanList(id: string): Promise<void> {
  const response = await fetch(`/api/v1/scan-lists/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "include" });
  if (!response.ok) throw new Error(response.status === 401 ? "Administrator login required" : `API returned ${response.status}`);
}

export async function previewSystemsImport(file: File): Promise<{ rows: number; preview: SystemProfile[] }> {
  const response = await fetch("/api/v1/imports/systems/preview", { method: "POST", headers: { "content-type": "text/csv" }, credentials: "include", body: file });
  if (!response.ok) throw new Error(response.status === 401 ? "Administrator login required" : `API returned ${response.status}`);
  return response.json() as Promise<{ rows: number; preview: SystemProfile[] }>;
}

export async function importSystems(file: File): Promise<{ imported: boolean; rows: number }> {
  const response = await fetch("/api/v1/imports/systems", { method: "POST", headers: { "content-type": "text/csv" }, credentials: "include", body: file });
  if (!response.ok) throw new Error(response.status === 401 ? "Administrator login required" : `API returned ${response.status}`);
  return response.json() as Promise<{ imported: boolean; rows: number }>;
}

export async function getAuditLog(): Promise<AuditEntry[]> {
  const response = await fetch("/api/v1/audit", { credentials: "include" });
  if (!response.ok) throw new Error(response.status === 401 ? "Administrator login required" : `API returned ${response.status}`);
  return response.json() as Promise<AuditEntry[]>;
}

export async function getDecoderConfig(): Promise<unknown> {
  const response = await fetch("/api/v1/decoder/config");
  if (!response.ok) throw new Error(`API returned ${response.status}`);
  return response.json();
}
export async function applyDecoderConfig(): Promise<void> {
  const response = await fetch("/api/v1/decoder/apply", { method: "POST", credentials: "include" });
  if (!response.ok) throw new Error(response.status === 401 ? "Administrator login required" : `Apply failed (${response.status})`);
}

export async function updateCallLocation(callId: string, location: { label: string; latitude: number; longitude: number; confidence: number }): Promise<void> {
  const response = await fetch(`/api/v1/calls/${encodeURIComponent(callId)}/location`, { method: "PUT", headers: { "content-type": "application/json" }, credentials: "include", body: JSON.stringify(location) });
  if (!response.ok) throw new Error(response.status === 401 ? "Administrator login required" : `API returned ${response.status}`);
}

export async function purgeCalls(filters: { hours?: number; category?: string; talkgroupId?: number; systemId?: string }): Promise<{ removed: number }> {
  const response = await fetch("/api/v1/calls/purge", { method: "POST", headers: { "content-type": "application/json" }, credentials: "include", body: JSON.stringify(filters) });
  if (!response.ok) throw new Error(response.status === 401 ? "Administrator login required" : `API returned ${response.status}`);
  return response.json() as Promise<{ removed: number }>;
}

export async function undoPurgeCalls(): Promise<{ removed: number }> {
  const response = await fetch("/api/v1/calls/purge/undo", { method: "POST", credentials: "include" });
  if (!response.ok) throw new Error(response.status === 404 ? "Nothing to undo" : response.status === 401 ? "Administrator login required" : `API returned ${response.status}`);
  return response.json() as Promise<{ removed: number }>;
}

export type OperationsAskResponse = { answer: string; citedCallIds: string[]; status: string };

export async function askOperations(question: string, hours = 4): Promise<OperationsAskResponse> {
  const response = await fetch("/api/v1/operations/ask", { method: "POST", headers: { "content-type": "application/json" }, credentials: "include", body: JSON.stringify({ question, hours }) });
  if (!response.ok) throw new Error(response.status === 401 ? "Administrator login required" : `API returned ${response.status}`);
  return response.json() as Promise<OperationsAskResponse>;
}

export async function getPublicPolicy(): Promise<PublicationPolicy> {
  const response = await fetch("/api/v1/public-policy");
  if (!response.ok) throw new Error(`API returned ${response.status}`);
  return response.json() as Promise<PublicationPolicy>;
}

export async function savePublicPolicy(policy: PublicationPolicy): Promise<PublicationPolicy> {
  const response = await fetch("/api/v1/public-policy", { method: "PUT", headers: { "content-type": "application/json" }, credentials: "include", body: JSON.stringify(policy) });
  if (!response.ok) throw new Error(response.status === 401 ? "Administrator login required" : response.status === 400 ? "Enable requires at least one allowed talkgroup" : `API returned ${response.status}`);
  return response.json() as Promise<PublicationPolicy>;
}

export async function testDiscordWebhook(): Promise<void> {
  const response = await fetch("/api/v1/integrations/discord/test", { method: "POST", credentials: "include" });
  if (!response.ok) throw new Error(response.status === 501 ? "Discord webhook is not configured" : response.status === 401 ? "Administrator login required" : "Discord test failed");
}
