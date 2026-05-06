"use client";

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useMemo } from "react";
import { CircleMarker, MapContainer, Marker, Popup, TileLayer, Tooltip } from "react-leaflet";

export type NearbyServiceMarker = {
  id: string | number;
  lat: number;
  lng: number;
  time: string;
  user: string;
};

type Props = {
  lat: number;
  lng: number;
  fullName: string;
  plate: string;
  iconUrl?: string;
  nearbyServices?: NearbyServiceMarker[];
};

const ICON_SIZE: [number, number] = [24, 24];
const ICON_ANCHOR: [number, number] = [12, 24];
const POPUP_ANCHOR: [number, number] = [0, -22];
const SHADOW_SIZE: [number, number] = [24, 24];

const VEHICLE_Z_INDEX = 2000;

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

export default function LiveDriverMap(props: Props) {
  const { lat, lng, fullName, plate, iconUrl, nearbyServices = [] } = props;

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

  return (
    <div className="h-[320px] w-full overflow-hidden rounded-lg border border-slate-200">
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
              color: "#1d4ed8",
              fillColor: "#2563eb",
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
              {`${s.time || "—"} - ${s.user || "—"}`}
            </Tooltip>
          </CircleMarker>
        ))}
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
