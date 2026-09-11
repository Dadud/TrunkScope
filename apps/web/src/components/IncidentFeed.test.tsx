import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { IncidentFeed } from "./IncidentFeed";

it("shows operator-readable incident data and selects its source call", () => {
  const select = vi.fn();
  render(<IncidentFeed incidents={[{ id: "incident-1", category: "Fire", headline: "County fire dispatch", firstSeen: "2026-01-01T00:00:00Z", lastSeen: "2026-01-01T00:01:00Z", callIds: ["call-1"], confidenceState: "confirmed", confidence: .9, units: ["Engine 4"], location: { label: "Main St", latitude: 1, longitude: 2, confidence: .9 } }]} onSelectCall={select} />);
  expect(screen.getByText("County fire dispatch")).toBeTruthy();
  expect(screen.getByText(/Main St/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button"));
  expect(select).toHaveBeenCalledWith("call-1");
});
