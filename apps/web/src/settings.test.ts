import { describe, expect, it } from "vitest";
import type { AppSettings } from "./api";

function validSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    homeLabel: "Home",
    homeLatitude: 44.4,
    homeLongitude: -90.5,
    radioMode: "decoder",
    radioDevice: "driver=sdrplay",
    radioFrequencyHz: 851012500,
    radioSampleRateHz: 2400000,
    radioAgc: false,
    radioPpm: 0,
    aiEnabled: true,
    aiProfile: "cpu-faster-whisper-small",
    transcribeUrl: "http://speaches:8000/v1/audio/transcriptions",
    transcribeModel: "small",
    vadEnabled: true,
    summaryModel: "llama3.2:3b",
    summaryUrl: "http://ollama:11434/api/generate",
    geocoderUrl: "https://nominatim.openstreetmap.org/search",
    discordWebhookUrl: "",
    publicFeedEnabled: false,
    publicFeedDelaySeconds: 120,
    exposeTranscripts: false,
    exposeRadioIds: false,
    exposePreciseLocations: false,
    audioRetentionDays: 30,
    transcriptRetentionDays: 365,
    metadataRetentionDays: 365,
    ...overrides,
  };
}

function validateSettings(settings: AppSettings): boolean {
  return (
    settings.homeLabel.trim().length > 0 &&
    settings.radioFrequencyHz > 0 &&
    settings.transcribeUrl.startsWith("http") &&
    (!settings.summaryUrl || settings.summaryUrl.startsWith("http")) &&
    (!settings.geocoderUrl || settings.geocoderUrl.startsWith("http"))
  );
}

describe("AppSettings validation", () => {
  it("accepts persisted integration URLs", () => {
    expect(validateSettings(validSettings())).toBe(true);
  });

  it("rejects invalid summary URLs", () => {
    expect(validateSettings(validSettings({ summaryUrl: "not-a-url" }))).toBe(false);
  });
});
