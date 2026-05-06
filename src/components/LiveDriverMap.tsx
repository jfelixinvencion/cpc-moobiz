"use client";

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useMemo } from "react";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";

type Props = {
  lat: number;
  lng: number;
  fullName: string;
  plate: string;
  iconUrl?: string;
};

const ICON_SIZE: [number, number] = [24, 24];
const ICON_ANCHOR: [number, number] = [12, 24];
const POPUP_ANCHOR: [number, number] = [0, -22];
const SHADOW_SIZE: [number, number] = [24, 24];

const redFallbackIcon = L.icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: ICON_SIZE,
  iconAnchor: ICON_ANCHOR,
  popupAnchor: POPUP_ANCHOR,
  shadowSize: SHADOW_SIZE,
});

export default function LiveDriverMap(props: Props) {
  const { lat, lng, fullName, plate, iconUrl } = props;

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
        <Marker position={[lat, lng]} icon={markerIcon}>
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
