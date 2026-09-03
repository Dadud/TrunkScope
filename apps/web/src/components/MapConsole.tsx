import { useEffect, useRef, useState, useCallback } from "react";
import type { FeatureCollection, Feature, Point } from "geojson";
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap, type Popup as MapLibrePopup } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Call } from "../types";
import { createRoot } from "react-dom/client";
import { CallPopup } from "./CallPopup";

export type MapStyleMode = "dark" | "satellite" | "streets";

interface MapConsoleProps {
  calls: Call[];
  selectedCall?: Call;
  volume: number;
  homeCenter: [number, number];
  isAdmin?: boolean;
  onSelectCall: (call: Call) => void;
  onOpenTalkgroup: (talkgroupId: number) => void;
  onCallUpdated?: (call: Call) => void;
}

const mapStyles: Record<MapStyleMode, { url: string; attribution: string }> = {
  dark: {
    url: "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
    attribution: "© CartoDB, © OpenStreetMap",
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "© Esri, Maxar, Earthstar",
  },
  streets: {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors",
  },
};

export function MapConsole({
  calls,
  selectedCall,
  volume,
  homeCenter,
  isAdmin,
  onSelectCall,
  onOpenTalkgroup,
  onCallUpdated,
}: MapConsoleProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const popupRef = useRef<MapLibrePopup | null>(null);
  const [styleMode, setStyleMode] = useState<MapStyleMode>("dark");
  const [heatmapEnabled, setHeatmapEnabled] = useState(false);

  const buildGeoJson = useCallback((): FeatureCollection<Point> => {
    const locatedCalls = calls.filter((c) => Boolean(c.location));
    const features: Feature<Point>[] = locatedCalls.map((call) => {
      const cat = call.category.toLowerCase();
      let color = "#22c55e"; // default other
      if (cat.includes("fire") || cat.includes("structure") || cat.includes("alarm")) {
        color = "#ef4444";
      } else if (cat.includes("medical") || cat.includes("ems") || cat.includes("rescue")) {
        color = "#ec4899";
      } else if (cat.includes("police") || cat.includes("law") || cat.includes("sheriff")) {
        color = "#38bdf8";
      } else if (cat.includes("traffic") || cat.includes("crash") || cat.includes("collision")) {
        color = "#f59e0b";
      }

      return {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [call.location!.longitude, call.location!.latitude],
        },
        properties: {
          id: call.id,
          label: call.talkgroupLabel,
          category: call.category,
          color,
          active: call.state === "active",
        },
      };
    });

    return { type: "FeatureCollection", features };
  }, [calls]);

  const showCallPopup = useCallback((call: Call, coordinates: [number, number]) => {
    if (!mapRef.current) return;

    if (popupRef.current) {
      popupRef.current.remove();
    }

    const popupNode = document.createElement("div");
    const root = createRoot(popupNode);

    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      maxWidth: "360px",
      className: "tactical-map-popup",
      offset: 14,
    })
      .setLngLat(coordinates)
      .setDOMContent(popupNode)
      .addTo(mapRef.current);

    root.render(
      <CallPopup
        call={call}
        volume={volume}
        isAdmin={isAdmin}
        onLocationUpdated={onCallUpdated}
        onOpenTalkgroup={onOpenTalkgroup}
        onClose={() => popup.remove()}
      />
    );

    popupRef.current = popup;
  }, [volume, onOpenTalkgroup, isAdmin, onCallUpdated]);

  // Initialize Map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const currentConf = mapStyles[styleMode];
    const map = new maplibregl.Map({
      container: containerRef.current,
      center: homeCenter,
      zoom: 12,
      attributionControl: false,
      style: {
        version: 8,
        sources: {
          basemap: {
            type: "raster",
            tiles: [currentConf.url],
            tileSize: 256,
            attribution: currentConf.attribution,
          },
        },
        layers: [
          {
            id: "basemap",
            type: "raster",
            source: "basemap",
          },
        ],
      },
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-right");

    map.on("load", () => {
      // Add GeoJSON source with clustering
      map.addSource("incidents", {
        type: "geojson",
        data: buildGeoJson(),
        cluster: true,
        clusterMaxZoom: 13,
        clusterRadius: 50,
      });

      // Incident heatmap (toggleable)
      map.addLayer({
        id: "incident-heatmap",
        type: "heatmap",
        source: "incidents",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "heatmap-weight": 1,
          "heatmap-intensity": 0.9,
          "heatmap-radius": 28,
          "heatmap-opacity": 0.65,
        },
        layout: {
          visibility: "none",
        },
      });

      // Cluster circle layer
      map.addLayer({
        id: "clusters",
        type: "circle",
        source: "incidents",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": [
            "step",
            ["get", "point_count"],
            "#0284c7",
            5,
            "#eab308",
            15,
            "#ef4444",
          ],
          "circle-radius": [
            "step",
            ["get", "point_count"],
            18,
            5,
            24,
            15,
            30,
          ],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
          "circle-opacity": 0.85,
        },
      });

      // Cluster count text
      map.addLayer({
        id: "cluster-count",
        type: "symbol",
        source: "incidents",
        filter: ["has", "point_count"],
        layout: {
          "text-field": "{point_count_abbreviated}",
          "text-size": 12,
          "text-font": ["Open Sans Bold"],
        },
        paint: {
          "text-color": "#ffffff",
        },
      });

      // Active Call Pulse Halo
      map.addLayer({
        id: "incident-active-halo",
        type: "circle",
        source: "incidents",
        filter: ["all", ["!has", "point_count"], ["==", "active", true]],
        paint: {
          "circle-radius": 22,
          "circle-color": ["get", "color"],
          "circle-opacity": 0.25,
          "circle-stroke-width": 1.5,
          "circle-stroke-color": ["get", "color"],
        },
      });

      // Individual Incident Marker
      map.addLayer({
        id: "incident-point",
        type: "circle",
        source: "incidents",
        filter: ["!has", "point_count"],
        paint: {
          "circle-radius": 8,
          "circle-color": ["get", "color"],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#090d16",
        },
      });

      // Click cluster to zoom in
      map.on("click", "clusters", (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ["clusters"] });
        const clusterId = features[0]?.properties?.cluster_id;
        const source = map.getSource("incidents") as GeoJSONSource;
        if (source && clusterId != null) {
          source.getClusterExpansionZoom(clusterId).then((zoom) => {
            const coordinates = (features[0].geometry as Point).coordinates;
            map.easeTo({ center: [coordinates[0], coordinates[1]], zoom });
          });
        }
      });

      // Click single incident marker
      map.on("click", "incident-point", (e) => {
        const feature = e.features?.[0];
        if (!feature) return;
        const id = feature.properties?.id;
        const call = calls.find((c) => c.id === id);
        if (call && call.location) {
          onSelectCall(call);
          showCallPopup(call, [call.location.longitude, call.location.latitude]);
        }
      });

      // Change cursor on hover
      map.on("mouseenter", "clusters", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "clusters", () => (map.getCanvas().style.cursor = ""));
      map.on("mouseenter", "incident-point", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "incident-point", () => (map.getCanvas().style.cursor = ""));
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [homeCenter, styleMode]);

  // Update GeoJSON source whenever calls change
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const source = map.getSource("incidents") as GeoJSONSource | undefined;
    if (source) {
      source.setData(buildGeoJson());
    }
  }, [calls, buildGeoJson]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    if (map.getLayer("incident-heatmap")) {
      map.setLayoutProperty("incident-heatmap", "visibility", heatmapEnabled ? "visible" : "none");
    }
  }, [heatmapEnabled]);

  // Fly to selected call if it has a location
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedCall || !selectedCall.location) return;

    const coords: [number, number] = [
      selectedCall.location.longitude,
      selectedCall.location.latitude,
    ];

    map.flyTo({
      center: coords,
      zoom: Math.max(map.getZoom(), 13.5),
      speed: 1.4,
      essential: true,
    });

    showCallPopup(selectedCall, coords);
  }, [selectedCall, showCallPopup]);

  const handleLayerSwitch = (mode: MapStyleMode) => {
    if (mode === styleMode || !mapRef.current) return;
    setStyleMode(mode);
    const map = mapRef.current;
    const conf = mapStyles[mode];

    map.setStyle({
      version: 8,
      sources: {
        basemap: {
          type: "raster",
          tiles: [conf.url],
          tileSize: 256,
          attribution: conf.attribution,
        },
      },
      layers: [
        {
          id: "basemap",
          type: "raster",
          source: "basemap",
        },
      ],
    });
  };

  const handleResetHome = () => {
    if (mapRef.current) {
      mapRef.current.flyTo({
        center: homeCenter,
        zoom: 12,
        speed: 1.2,
      });
    }
  };

  return (
    <div className="map-console-container">
      <div ref={containerRef} className="full-map-canvas" />

      <div className="tactical-map-toolbar">
        <div className="style-toggles">
          <button
            type="button"
            className={styleMode === "dark" ? "active" : ""}
            onClick={() => handleLayerSwitch("dark")}
            title="Tactical Night Radar"
          >
            NIGHT
          </button>
          <button
            type="button"
            className={styleMode === "satellite" ? "active" : ""}
            onClick={() => handleLayerSwitch("satellite")}
            title="Satellite Imagery"
          >
            SAT
          </button>
          <button
            type="button"
            className={styleMode === "streets" ? "active" : ""}
            onClick={() => handleLayerSwitch("streets")}
            title="Day Street Map"
          >
            DAY
          </button>
        </div>

        <button
          type="button"
          className={heatmapEnabled ? "active" : ""}
          onClick={() => setHeatmapEnabled((value) => !value)}
          title="Toggle incident heatmap"
        >
          HEAT
        </button>

        <button
          type="button"
          className="home-btn"
          onClick={handleResetHome}
          title="Center on Home Location"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
