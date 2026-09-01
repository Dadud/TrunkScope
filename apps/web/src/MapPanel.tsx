import { useEffect, useRef } from "react";
import type { FeatureCollection } from "geojson";
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Call } from "./types";

export function MapPanel({ calls }: { calls: Call[] }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const geojson = (): FeatureCollection => ({
    type: "FeatureCollection",
    features: calls.filter((call) => call.location).map((call) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [call.location!.longitude, call.location!.latitude] },
      properties: { id: call.id, label: call.talkgroupLabel, category: call.category, active: call.state === "active" },
    })),
  });

  useEffect(() => {
    if (!container.current || map.current) return;
    const instance = new maplibregl.Map({
      container: container.current,
      center: [-87.632, 41.884],
      zoom: 11.7,
      attributionControl: false,
      style: {
        version: 8,
        sources: { basemap: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap contributors" } },
        layers: [{ id: "basemap", type: "raster", source: "basemap", paint: { "raster-saturation": -0.72, "raster-brightness-max": 0.55 } }],
      },
    });
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    instance.on("load", () => {
      instance.addSource("calls", { type: "geojson", data: geojson() });
      instance.addLayer({ id: "call-glow", type: "circle", source: "calls", paint: { "circle-radius": 16, "circle-color": ["case", ["get", "active"], "#c7f36b", "#53b8a9"], "circle-opacity": 0.18 } });
      instance.addLayer({ id: "calls", type: "circle", source: "calls", paint: { "circle-radius": 6, "circle-color": ["case", ["get", "active"], "#c7f36b", "#75d6c8"], "circle-stroke-color": "#07100f", "circle-stroke-width": 2 } });
    });
    map.current = instance;
    return () => { instance.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    (map.current?.getSource("calls") as GeoJSONSource | undefined)?.setData(geojson());
  }, [calls]);

  return <div className="map" ref={container} aria-label="Incident map" />;
}
