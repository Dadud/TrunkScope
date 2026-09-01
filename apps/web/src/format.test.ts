import { describe, expect, it } from "vitest";
import { formatElapsed, formatFrequency, signalQuality } from "./format";

describe("radio formatting", () => {
  it("formats frequencies without losing scanner precision", () => {
    expect(formatFrequency(851_262_500)).toBe("851.2625 MHz");
  });
  it("clamps signal quality", () => {
    expect(signalQuality(-100)).toBe(0);
    expect(signalQuality(-10)).toBe(100);
  });
  it("formats completed call duration", () => {
    expect(formatElapsed("2026-01-01T00:00:00Z", "2026-01-01T00:01:05Z")).toBe("1m 5s");
  });
});
