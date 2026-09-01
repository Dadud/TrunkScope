export type ReceiverState = "offline" | "idle" | "monitoring" | "faulted";

export interface Receiver {
  id: string;
  label: string;
  driver: "rtlSdr" | "airspy" | "sdrplay" | "simulator";
  serial: string;
  state: ReceiverState;
  centerFrequencyHz?: number;
  sampleRateHz?: number;
  gainDb?: number;
  ppm: number;
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
