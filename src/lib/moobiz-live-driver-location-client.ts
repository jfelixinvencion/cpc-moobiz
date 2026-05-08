import type { NearbyServiceMarker } from "@/components/LiveDriverMap";

/** Misma ruta que usa `ControlOperacionesPanel` (ubicación GPS vía proxy servidor). */
export const MOOBIZ_LIVE_DRIVER_LOCATION_API = "/api/moobiz/live-driver-location";

export type DriverLiveAvailability = "online" | "busy" | "offline";

export type DriverLiveLocationItem = {
  full_name: string;
  plate: string;
  availability: DriverLiveAvailability;
  lat: number;
  lng: number;
  code: string;
  date_tracked: string;
  txt_tracked: string;
  icon: string;
  parked_address?: string | null;
};

export type DriverLiveLocationApiResponse = {
  ok: boolean;
  msg?: string;
  item: DriverLiveLocationItem | null;
  nearbyServices?: NearbyServiceMarker[];
};

/**
 * Consulta ubicación en vivo del conductor (misma petición que Control operaciones).
 * El caller puede ignorar `nearbyServices` y sustituirlos por marcadores propios (p. ej. Seguimiento).
 */
export async function fetchLiveDriverLocationByConductorName(
  conductorName: string,
): Promise<DriverLiveLocationApiResponse> {
  const sp = new URLSearchParams({ query: conductorName });
  const res = await fetch(`${MOOBIZ_LIVE_DRIVER_LOCATION_API}?${sp.toString()}`, { cache: "no-store" });
  const body = (await res.json()) as DriverLiveLocationApiResponse;
  return {
    ok: Boolean(body?.ok),
    msg: body?.msg,
    item: body?.item ?? null,
    nearbyServices: Array.isArray(body?.nearbyServices) ? body.nearbyServices : [],
  };
}
