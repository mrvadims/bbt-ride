// Route map (Leaflet): OpenStreetMap tiles in light mode, CARTO dark tiles in dark mode; falls back to the SVG outline
// when tiles can't load.
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useRef, useState } from "react";
import type { Poi, Route } from "../../shared/ride.ts";
import { isDark, usePrefs } from "../lib/prefs.ts";
import { TrackOutline } from "./charts.tsx";

export function RouteMap({ route, stop }: { route: Route; stop: Poi | null }) {
  const el = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const dark = isDark(usePrefs().theme);
  useEffect(() => {
    if (!el.current || failed) return;
    const map = L.map(el.current, { scrollWheelZoom: false });
    // The site sends no Referer by default; tile servers ask for one, so the tiles send the origin.
    const opts: L.TileLayerOptions = { maxZoom: 18, referrerPolicy: "strict-origin-when-cross-origin" };
    const tiles = dark
      ? L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
          ...opts,
          attribution: "© OpenStreetMap © CARTO",
        })
      : L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { ...opts, attribution: "© OpenStreetMap" });
    tiles.once("tileerror", () => setFailed(true)).addTo(map);
    const line = L.polyline(
      route.track.map((p) => [p[0], p[1]] as [number, number]),
      { color: "#0077D1", weight: 4 },
    ).addTo(map);
    const start = route.track[0];
    if (start)
      L.circleMarker([start[0], start[1]], {
        radius: 7,
        color: "#fff",
        weight: 2,
        fillColor: "#0077D1",
        fillOpacity: 1,
      })
        .addTo(map)
        .bindTooltip("Start");
    if (stop)
      L.circleMarker([stop.lat, stop.lng], {
        radius: 6,
        color: "#041DB2",
        weight: 3,
        fillColor: "#fff",
        fillOpacity: 1,
      })
        .addTo(map)
        .bindTooltip(stop.name);
    map.fitBounds(line.getBounds(), { padding: [16, 16] });
    return () => {
      map.remove();
    };
  }, [route, stop, failed, dark]);
  // Different keys so React replaces the element: Leaflet leaves its classes and styles on the one it used.
  return failed ? (
    <div className="map" key="outline">
      <TrackOutline route={route} stop={stop} />
    </div>
  ) : (
    <div className="map" key="leaflet" ref={el} />
  );
}
