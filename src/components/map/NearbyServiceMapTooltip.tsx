"use client";

import {
  debugLogMapMarker,
  resolveNearbyServiceProductName,
  resolveNearbyServiceStatus,
  type NearbyServiceDisplayFields,
} from "@/lib/map-nearby-service-display";

export type NearbyServiceMapTooltipMarker = NearbyServiceDisplayFields & {
  id?: string | number;
  alt_date?: string;
  dst_zone?: string;
};

type Props = {
  marker: NearbyServiceMapTooltipMarker;
  /** Fecha/hora ya formateada para la primera línea. */
  dateLabel: string;
};

/** Contenido del tooltip de marcadores de servicio en el mapa GPS. */
export function NearbyServiceMapTooltip({ marker, dateLabel }: Props) {
  debugLogMapMarker(marker);

  const productName = resolveNearbyServiceProductName(marker);
  const statusLabel = resolveNearbyServiceStatus(marker);
  const zone = String(marker.dst_zone ?? "").trim() || "—";

  return (
    <div className="max-w-[220px] space-y-0.5 text-left text-[11px] leading-snug text-slate-800">
      <p className="text-slate-600">{dateLabel}</p>
      <p>
        <strong>{statusLabel}</strong>
        {productName ? <span className="ml-2 text-slate-500">— ({productName})</span> : null}
      </p>
      <p className="text-slate-600">{zone}</p>
    </div>
  );
}
