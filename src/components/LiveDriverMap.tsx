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

const redFallbackIcon = L.icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

export default function LiveDriverMap(props: Props) {
  const { lat, lng, fullName, plate, iconUrl } = props;

  const markerIcon = useMemo(() => {
    if (!iconUrl) return redFallbackIcon;
    return L.icon({
      iconUrl,
      shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      iconSize: [28, 42],
      iconAnchor: [14, 42],
      popupAnchor: [0, -34],
      shadowSize: [41, 41],
    });
  }, [iconUrl]);

  return (
    <div className="h-[320px] w-full overflow-hidden rounded-lg border border-slate-200">
      <MapContainer center={[lat, lng]} zoom={16} className="h-full w-full">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
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
