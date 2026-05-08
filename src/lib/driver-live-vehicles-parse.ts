/**
 * Parseo de respuestas Moobiz GET /api/admin/live/vehicles (alineado con live-driver-location).
 */

function asText(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

/** Sin tildes, ñ→N, mayúsculas, espacios colapsados (query Moobiz live/vehicles). */
export function normalizeConductorNameForMoobizQuery(raw: string): string {
  return String(raw ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ñ/gi, "N")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/** Extrae el array `items` del JSON raíz de la API live/vehicles. */
export function extractItemsFromLiveVehiclesResponse(json: unknown): unknown[] {
  if (!json || typeof json !== "object") return [];
  const items = (json as Record<string, unknown>).items;
  return Array.isArray(items) ? items : [];
}

export type LiveAvailability = "online" | "busy" | "offline";

/** Coherente con `normalizeAvailability` en `live-driver-location/route.ts`. */
export function normalizeAvailabilityFromItem(item: unknown): LiveAvailability {
  if (!item || typeof item !== "object") return "offline";
  const row = item as Record<string, unknown>;
  const v = row.availability ?? row.status ?? row.online_status;
  const t = asText(v).toLowerCase();
  if (t.includes("online") || t.includes("disponible")) return "online";
  if (t.includes("busy") || t.includes("servicio")) return "busy";
  return "offline";
}

export function buildDriverKeyFromLiveVehicleItem(item: Record<string, unknown>): string | null {
  if (item.id !== undefined && item.id !== null) {
    const s = String(item.id).trim();
    if (s) return s;
  }
  const fullName = asText(
    item.full_name ??
      item.name ??
      (item.us_name || item.us_surname
        ? `${asText(item.us_name)} ${asText(item.us_surname)}`.trim()
        : ""),
  );
  if (!fullName) return null;
  return `name:${normalizeConductorNameForMoobizQuery(fullName)}`;
}
