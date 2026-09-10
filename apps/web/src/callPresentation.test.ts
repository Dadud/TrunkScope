import { expect, it } from "vitest";
import { callCategory, matchesCall } from "./callPresentation";
import type { Call } from "./types";

it("uses consistent categories and searches visible transcripts", () => {
  expect(callCategory("Ambulance dispatch")).toBe("ems");
  const call = { category: "Police", transcript: "Road closed near the bridge", talkgroupLabel: "Dispatch", frequencyHz: 154445000 } as Call;
  expect(matchesCall(call, "other", "")).toBe(false);
  expect(matchesCall(call, "law", " BRIDGE ")).toBe(true);
  expect(matchesCall(call, "fire", "bridge")).toBe(false);
});

it("finds conventional frequencies without matching hidden legacy summaries", () => {
  const call = { category: "Police", frequencyHz: 154445000, summary: "Legacy summary", talkgroupLabel: "Dispatch" } as Call;
  expect(matchesCall(call, "all", "154.4450")).toBe(true);
  expect(matchesCall(call, "all", "154445000")).toBe(true);
  expect(matchesCall(call, "all", "Legacy summary")).toBe(false);
});
