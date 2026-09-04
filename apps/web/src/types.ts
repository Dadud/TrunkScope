export type ReceiverState = "offline" | "probing" | "ready" | "idle" | "monitoring" | "degraded" | "stopped" | "faulted";

export interface Receiver {
  id: string;
  label: string;
  driver: "rtlSdr" | "airspy" | "sdrplay" | "hackRf" | "plutoSdr" | "bladeRf" | "limeSdr" | "genericSoapy" | "simulator";
  serial: string;
  state: ReceiverState;
  centerFrequencyHz?: number;
  sampleRateHz?: number;
  gainDb?: number;
  ppm: number;
  enabled?: boolean;
  role?: "general" | "p25" | "analog";
  soapyIndex?: number;
  autoTune?: boolean;
  digitalRecorders?: number;
  analogRecorders?: number;
  capabilities?: {
    minimumFrequencyHz: number;
    maximumFrequencyHz: number;
    sampleRatesHz: number[];
    maximumBandwidthHz: number;
    supportsAgc: boolean;
    gainElements: string[];
  };
  health: {
    signalDbfs: number;
    noiseDbfs: number;
    frequencyErrorHz: number;
    droppedSamples: number;
    updatedAt: string;
  };
}

export interface Call {
  id: string;
  systemName: string;
  talkgroupId: number;
  talkgroupLabel: string;
  category: string;
  frequencyHz: number;
  tdmaSlot?: number;
  sourceRadioId?: number;
  startedAt: string;
  endedAt?: string;
  state: "active" | "complete" | "failed";
  encryption: "clear" | "encrypted" | "unknown";
  signalDbfs: number;
  transcript?: string;
  summary?: string;
  location?: { label: string; latitude: number; longitude: number; confidence: number };
  audio?: { objectKey: string; contentType: string; durationMs: number };
}

export interface PublicationPolicy {
  enabled: boolean;
  delaySeconds: number;
  allowedTalkgroups: string[];
  exposeTranscripts: boolean;
  exposeRadioIds: boolean;
  exposePreciseLocations: boolean;
}

export interface Snapshot {
  receivers: Receiver[];
  calls: Call[];
  publicPolicy: PublicationPolicy;
}

export type CallEvent = {
  type: "started" | "updated" | "ended";
  payload: Call;
};
