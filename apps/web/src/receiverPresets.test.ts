import { describe, expect, it } from "vitest";
import type { ReceiverInput, ReceiverSubmodelPreset } from "./api";
import { applySubmodelPreset, presetSummary } from "./receiverPresets";

const draft: ReceiverInput = {
  label: "New SDR",
  driver: "sdrplay",
  serial: "driver=sdrplay",
  centerFrequencyHz: 1,
  sampleRateHz: 1,
  gainDb: 1,
  ppm: 5,
  enabled: true,
  role: "general",
  soapyIndex: 0,
};

const rsp1b: ReceiverSubmodelPreset = {
  id: "rsp1b",
  label: "RSP1B",
  sampleRateHz: 4_000_000,
  gainDb: 40,
  ppm: 0,
  centerFrequencyHz: 154_000_000,
  notes: "Up to 10 MS/s",
};

describe("receiver presets", () => {
  it("applies optimal defaults without touching label or serial", () => {
    const applied = applySubmodelPreset(draft, rsp1b);
    expect(applied.centerFrequencyHz).toBe(154_000_000);
    expect(applied.sampleRateHz).toBe(4_000_000);
    expect(applied.gainDb).toBe(40);
    expect(applied.ppm).toBe(0);
    expect(applied.label).toBe("New SDR");
    expect(applied.serial).toBe("driver=sdrplay");
    expect(applied.role).toBe("general");
  });

  it("summarizes preset values in operator units", () => {
    expect(presetSummary(rsp1b)).toBe("4.0 MS/s, 40 dB, 154.0000 MHz");
  });
});
