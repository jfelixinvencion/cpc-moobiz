"use client";

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useMemo } from "react";
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
} from "react-leaflet";

import { NearbyServiceMapTooltip } from "@/components/map/NearbyServiceMapTooltip";
import type { DriverLiveServiceDestination } from "@/lib/moobiz-live-driver-location-client";
import {
  resolveNearbyServiceProductName,
  resolveNearbyServiceStatus,
} from "@/lib/map-nearby-service-display";

export type NearbyServiceMarker = {
  id: string | number;
  lat: number;
  lng: number;
  alt_date: string;
  pr_name: string;
  dst_zone: string;
  prioridad_mapa: 1 | 2 | 3;
  status?: string;
  product_name?: string;
};

type Props = {
  lat: number;
  lng: number;
  fullName: string;
  plate: string;
  iconUrl?: string;
  nearbyServices?: NearbyServiceMarker[];
  /** Destino del servicio (vista plana live); solo capa visual. */
  serviceDestination?: DriverLiveServiceDestination | null;
};

const ICON_SIZE: [number, number] = [24, 24];
const ICON_ANCHOR: [number, number] = [12, 24];
const POPUP_ANCHOR: [number, number] = [0, -22];
const SHADOW_SIZE: [number, number] = [24, 24];

const VEHICLE_Z_INDEX = 2000;
const SERVICE_DEST_Z_INDEX = 1600;

const redFallbackIcon = L.icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: ICON_SIZE,
  iconAnchor: ICON_ANCHOR,
  popupAnchor: POPUP_ANCHOR,
  shadowSize: SHADOW_SIZE,
});

function openMoobizActiveService(id: string | number): void {
  const url = `https://app.moobiz.pe/actives?id=${encodeURIComponent(String(id))}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

function markerColorByPriority(prioridad: 1 | 2 | 3): { stroke: string; fill: string } {
  if (prioridad === 1) return { stroke: "#DC2626", fill: "#EF4444" };
  if (prioridad === 2) return { stroke: "#D97706", fill: "#F59E0B" };
  return { stroke: "#1D4ED8", fill: "#3B82F6" };
}

function formatAltDate(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "—";
  const isoCandidate = raw.includes("T") ? raw : raw.replace(" ", "T");
  const d = new Date(isoCandidate);
  if (Number.isNaN(d.getTime())) return raw;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm} ${hh}:${min}`;
}

function serviceDestinationDivIcon(): L.DivIcon {
  return L.divIcon({
    className: "leaflet-div-icon service-dest-flag",
    html: `
      <div style="
        width:30px;height:30px;border-radius:9999px;
        background:linear-gradient(145deg,#fef3c7 0%,#fde68a 45%,#f59e0b 100%);
        border:2px solid #fff;box-shadow:0 2px 10px rgba(15,23,42,0.22);
        display:flex;align-items:center;justify-content:center;
        font-size:15px;line-height:1;
      " aria-hidden="true">🚩</div>
    `,
    iconSize: [30, 30],
    iconAnchor: [15, 28],
    popupAnchor: [0, -26],
  });
}

export default function LiveDriverMap(props: Props) {
  const { lat, lng, fullName, plate, iconUrl, nearbyServices = [], serviceDestination } = props;

  const markerIcon = useMemo(() => {
    if (!iconUrl) return redFallbackIcon;
    return L.icon({
      iconUrl,
      shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      iconSize: ICON_SIZE,
      iconAnchor: ICON_ANCHOR,
      popupAnchor: POPUP_ANCHOR,
      shadowSize: SHADOW_SIZE,
    });
  }, [iconUrl]);

  const destIcon = useMemo(() => serviceDestinationDivIcon(), []);

  const dest = serviceDestination ?? null;
  const showDest = Boolean(dest && Number.isFinite(dest.lat) && Number.isFinite(dest.lng));

  return (
    <div className="h-[320px] w-full overflow-hidden rounded-lg border border-slate-200">
      <style>{`
        .leaflet-div-icon.service-dest-flag {
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
        }
      `}</style>
      <MapContainer center={[lat, lng]} zoom={16} className="h-full w-full">
        <TileLayer
          attribution='&copy; OpenStreetMap contributors &copy; CARTO'
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
        />
        {nearbyServices.map((s, idx) => (
          <CircleMarker
            key={`near-${String(s.id)}-${idx}`}
            center={[s.lat, s.lng]}
            radius={7}
            pathOptions={{
              color: markerColorByPriority(s.prioridad_mapa).stroke,
              fillColor: markerColorByPriority(s.prioridad_mapa).fill,
              fillOpacity: 0.9,
              weight: 1,
            }}
            eventHandlers={{
              click: (e) => {
                if (e.originalEvent) {
                  L.DomEvent.stopPropagation(e.originalEvent);
                }
                openMoobizActiveService(s.id);
              },
            }}
          >
            <Tooltip direction="top" offset={[0, -4]} opacity={1}>
              <NearbyServiceMapTooltip marker={s} dateLabel={formatAltDate(s.alt_date)} />
            </Tooltip>
          </CircleMarker>
        ))}
        {showDest && dest ? (
          <Polyline
            positions={[
              [lat, lng],
              [dest.lat, dest.lng],
            ]}
            pathOptions={{
              color: "#94a3b8",
              weight: 2,
              opacity: 0.42,
              dashArray: "6 10",
              lineCap: "round",
              lineJoin: "round",
            }}
          />
        ) : null}
        {showDest && dest ? (
          <Marker position={[dest.lat, dest.lng]} icon={destIcon} zIndexOffset={SERVICE_DEST_Z_INDEX}>
            <Tooltip direction="top" offset={[0, -10]} opacity={1} sticky>
              <div className="max-w-[240px] space-y-0.5 text-left text-[11px] leading-snug text-slate-800">
                <p className="font-mono text-[10px] text-slate-600">
                  se_id: {dest.se_id.trim() ? dest.se_id : "—"}
                </p>
                <p>
                  <strong>{resolveNearbyServiceStatus({ status: "busy" })}</strong>
                  {resolveNearbyServiceProductName(dest) ? (
                    <span className="ml-2 text-slate-500">
                      — ({resolveNearbyServiceProductName(dest)})
                    </span>
                  ) : null}
                </p>
                <p className="font-medium">{dest.name.trim() ? dest.name : "—"}</p>
                <p className="text-slate-600">{dest.se_dst_address.trim() ? dest.se_dst_address : "—"}</p>
              </div>
            </Tooltip>
          </Marker>
        ) : null}
        <Marker position={[lat, lng]} icon={markerIcon} zIndexOffset={VEHICLE_Z_INDEX}>
          <Popup>
            <div className="text-sm">
              <p className="font-semibold">{fullName}</p>
              <p>{plate || "Sin placa"}</p>
            </div>
          </Popup>
        </Marker>
      </MapContainer>
    </div>
  );
}
