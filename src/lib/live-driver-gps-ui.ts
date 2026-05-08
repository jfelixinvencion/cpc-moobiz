import { format } from "date-fns";

import type { DriverLiveAvailability } from "@/lib/moobiz-live-driver-location-client";

/** Alineado con `ControlOperacionesPanel` (colores del ícono MapPin). */
export const GPS_ICON_COLOR_NEUTRAL = "#cbd5e1";
export const GPS_ICON_COLOR_ONLINE = "#22c55e";
export const GPS_ICON_COLOR_BUSY = "#f97316";
export const GPS_ICON_COLOR_OFFLINE = "#94a3b8";

export function gpsAvailabilityLabel(availability: DriverLiveAvailability): string {
  if (availability === "online") return "Disponible";
  if (availability === "busy") return "En Servicio";
  return "Desconectado";
}

export function gpsAvailabilityClass(availability: DriverLiveAvailability): string {
  if (availability === "online") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (availability === "busy") return "border-orange-200 bg-orange-50 text-orange-700";
  return "border-slate-200 bg-slate-100 text-slate-600";
}

export function gpsAvailabilityDot(availability: DriverLiveAvailability): string {
  if (availability === "online") return "🟢";
  if (availability === "busy") return "🟠";
  return "⚫";
}

export function gpsIconColorFromAvailability(availability: DriverLiveAvailability | null): string {
  if (availability === "online") return GPS_ICON_COLOR_ONLINE;
  if (availability === "busy") return GPS_ICON_COLOR_BUSY;
  if (availability === "offline") return GPS_ICON_COLOR_OFFLINE;
  return GPS_ICON_COLOR_NEUTRAL;
}

export function formatGpsDate(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "—";
  const isoCandidate = raw.includes("T") ? raw : raw.replace(" ", "T");
  const d = new Date(isoCandidate);
  if (Number.isNaN(d.getTime())) return raw;
  return format(d, "dd/MM/yyyy HH:mm");
}
