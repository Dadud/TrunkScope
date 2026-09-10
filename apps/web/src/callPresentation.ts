import type { Call } from "./types";
import { formatFrequency } from "./format";

export function callCategory(category: string): "fire" | "ems" | "law" | "traffic" | "other" {
  const value = category.toLowerCase();
  if (/fire|structure|alarm/.test(value)) return "fire";
  if (/medical|ems|rescue|ambulance/.test(value)) return "ems";
  if (/police|law|sheriff/.test(value)) return "law";
  if (/traffic|crash|collision/.test(value)) return "traffic";
  return "other";
}

export function matchesCall(call: Call, category: string, query: string) {
  return (category === "all" || callCategory(call.category) === category)
    && `${call.talkgroupLabel} ${call.talkgroupId} ${call.systemName} ${call.frequencyHz} ${formatFrequency(call.frequencyHz)} ${call.transcript ?? ""} ${call.location?.label ?? ""}`
      .toLowerCase().includes(query.trim().toLowerCase());
}
