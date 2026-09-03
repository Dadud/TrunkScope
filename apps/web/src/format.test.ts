import { describe, expect, it } from "vitest";
import { formatElapsed, formatFrequency, hzToMhz, mhzToHz, signalQuality } from "./format";

describe("radio formatting", () => {
  it("formats frequencies without losing scanner precision", () => {
    expect(formatFrequency(851_262_500)).toBe("851.2625 MHz");
  });
  it("converts Hz to MHz for editing", () => {
    expect(hzToMhz(851_012_500)).toBe("851.0125");
    expect(hzToMhz(2_400_000)).toBe("2.4");
    expect(hzToMhz(12_500)).toBe("0.0125");
    expect(hzToMhz(0)).toBe("");
    expect(hzToMhz(undefined)).toBe("");
  });
  it("converts MHz back to integer Hz", () => {
    expect(mhzToHz("851.0125")).toBe(851_012_500);
    expect(mhzToHz("2.4")).toBe(2_400_000);
    expect(mhzToHz("0.0125")).toBe(12_500);
    expect(mhzToHz("")).toBe(0);
    expect(mhzToHz("not a number")).toBe(0);
  });
  it("clamps signal quality", () => {
    expect(signalQuality(-100)).toBe(0);
    expect(signalQuality(-10)).toBe(100);
  });
  it("formats completed call duration", () => {
    expect(formatElapsed("2026-01-01T00:00:00Z", "2026-01-01T00:01:05Z")).toBe("1m 5s");
  });
});
