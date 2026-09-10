import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { Call } from "../types";
import { MapConsole } from "./MapConsole";

const maps = vi.hoisted(() => [] as Array<{
  handlers: Record<string, (event?: unknown) => void>;
  layers: Array<{ id: string; layout?: { visibility: string } }>;
}>);
vi.mock("maplibre-gl", () => ({ default: {
  Map: class {
    handlers: Record<string, (event?: unknown) => void> = {};
    layers: Array<{ id: string; layout?: { visibility: string } }> = [];
    constructor() { maps.push(this); }
    on(event: string, layer: string | ((event?: unknown) => void), handler?: (event?: unknown) => void) {
      this.handlers[typeof layer === "string" ? `${event}:${layer}` : event] = handler ?? layer as (event?: unknown) => void;
    }
    addControl() {} addSource() {} remove() {}
    addLayer(layer: { id: string }) { this.layers.push(layer); }
    getSource() { return { setData() {} }; }
    isStyleLoaded() { return true; }
    getLayer() { return true; }
    setLayoutProperty() {}
    getCenter() { return { lng: -90.5, lat: 44.4 }; }
    getZoom() { return 12; }
  },
  NavigationControl: class {}, AttributionControl: class {},
} }));

it("selects newly arrived markers and retains the heatmap across style changes", () => {
  const onSelectCall = vi.fn();
  const homeCenter: [number, number] = [-90.5, 44.4];
  const props = { volume: 0.5, homeCenter, onSelectCall, onOpenTalkgroup: vi.fn() };
  const { rerender } = render(<MapConsole {...props} calls={[]} />);
  act(() => maps[0].handlers.load());
  const call = { id: "new", category: "Fire", location: { latitude: 44.4, longitude: -90.5 } } as Call;
  rerender(<MapConsole {...props} calls={[call]} />);
  act(() => maps[0].handlers["click:incident-point"]({ features: [{ properties: { id: "new" } }] }));
  expect(onSelectCall).toHaveBeenCalledWith(call);
  fireEvent.click(screen.getByText("HEAT"));
  fireEvent.click(screen.getByText("SAT"));
  act(() => maps[1].handlers.load());
  expect(maps[1].layers.find((layer) => layer.id === "incident-heatmap")?.layout?.visibility).toBe("visible");
});
