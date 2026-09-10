import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { EnrichmentSettings } from "./EnrichmentSettings";
import type { AiTaskSettings } from "../api";
afterEach(cleanup);
const config: AiTaskSettings = { enabled: true, intervalMinutes: 10, maxBatch: 32, confidenceThreshold: .75, fallbackModel: "", promptVersion: 1, systemPrompt: "Custom prompt" };
function Harness() {
  const [value, setValue] = useState({ "event-tagging": config, "unit-extraction": config, transcription: config, "tone-classification": config });
  return <EnrichmentSettings value={value} onChange={setValue as (value: Record<string, AiTaskSettings>) => void} />;
}
it("opens one task editor and preserves edits when switching tasks", () => {
  render(<Harness />);
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByRole("checkbox", { name: /transcription|tone/i })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Edit event categories" }));
  fireEvent.change(screen.getByLabelText("Run every (minutes)"), { target: { value: "20" } });
  fireEvent.click(screen.getByRole("button", { name: "Edit units and call signs" }));
  expect(screen.getAllByLabelText("Run every (minutes)")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Edit event categories" }));
  expect((screen.getByLabelText("Run every (minutes)") as HTMLInputElement).value).toBe("20");
  fireEvent.click(screen.getByText("Advanced model and prompt"));
  fireEvent.click(screen.getByRole("button", { name: "Use default prompt" }));
  expect((screen.getByLabelText("System prompt") as HTMLTextAreaElement).value).toBe("");
});
