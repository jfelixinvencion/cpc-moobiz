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

/** Destino del servicio (solo lectura `vista.vw_driver_live_raw_flat`, conductor ocupado con coordenadas). */
export type DriverLiveServiceDestination = {
  lat: number;
  lng: number;
  se_id: string;
  name: string;
  se_dst_address: string;
  product_name?: string;
};

export type DriverLiveLocationApiResponse = {
  ok: boolean;
  msg?: string;
  item: DriverLiveLocationItem | null;
  nearbyServices?: NearbyServiceMarker[];
  serviceDestination?: DriverLiveServiceDestination | null;
};

/**
 * Consulta ubicación en vivo del conductor (misma petición que Control operaciones).
 * El caller puede ignorar `nearbyServices` y sustituirlos por marcadores propios (p. ej. Seguimiento).
 */
export async function fetchLiveDriverLocationByConductorName(
  conductorName: string,
  idUser?: string,
): Promise<DriverLiveLocationApiResponse> {
  const sp = new URLSearchParams({ query: conductorName });
  const id = String(idUser ?? "").trim();
  if (id) sp.set("id_user", id);
  const res = await fetch(`${MOOBIZ_LIVE_DRIVER_LOCATION_API}?${sp.toString()}`, { cache: "no-store" });
  const body = (await res.json()) as DriverLiveLocationApiResponse;
  const dest = body?.serviceDestination;
  const serviceDestination =
    dest != null &&
    typeof dest === "object" &&
    typeof (dest as { lat?: unknown }).lat === "number" &&
    typeof (dest as { lng?: unknown }).lng === "number"
      ? {
          lat: (dest as { lat: number }).lat,
          lng: (dest as { lng: number }).lng,
          se_id: String((dest as { se_id?: unknown }).se_id ?? ""),
          name: String((dest as { name?: unknown }).name ?? ""),
          se_dst_address: String((dest as { se_dst_address?: unknown }).se_dst_address ?? ""),
          product_name: String((dest as { product_name?: unknown }).product_name ?? "").trim(),
        }
      : null;
  return {
    ok: Boolean(body?.ok),
    msg: body?.msg,
    item: body?.item ?? null,
    nearbyServices: Array.isArray(body?.nearbyServices) ? body.nearbyServices : [],
    serviceDestination,
  };
}
