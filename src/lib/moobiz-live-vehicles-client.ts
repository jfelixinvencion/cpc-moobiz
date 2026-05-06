import { normalizeMoobizLiveSearchQuery } from "@/lib/gps-filter";

const MOOBIZ_LIVE_VEHICLES_BASE = "https://app.moobiz.pe/api/admin/live/vehicles";

/** Mensaje cuando hay que limpiar localStorage y pedir token de nuevo. */
export const MOOBIZ_GPS_FETCH_NOT_LOGGED = "not_logged";

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
};

export type DriverLiveLocationFetchResult = {
  ok: boolean;
  msg?: string;
  item: DriverLiveLocationItem | null;
};

const LS_KEY = "taxi-dashboard_moobiz_live_gps_bearer_v1";

export function readMoobizGpsBearerFromStorage(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(LS_KEY);
    const t = v?.trim();
    return t || null;
  } catch {
    return null;
  }
}

export function writeMoobizGpsBearerToStorage(token: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LS_KEY, token.trim());
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearMoobizGpsBearerFromStorage(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
}

/** Acepta token crudo o `Bearer xxx` pegado desde DevTools. */
export function sanitizeMoobizBearerFromInput(raw: string): string {
  let t = String(raw ?? "").trim();
  t = t.replace(/^["']|["']$/g, "");
  if (/^bearer\s+/i.test(t)) {
    t = t.replace(/^bearer\s+/i, "").trim();
  }
  return t.trim();
}

function asText(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function asNumber(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return n;
}

function normalizeAvailability(v: unknown): DriverLiveAvailability {
  const t = asText(v).toLowerCase();
  if (t.includes("online") || t.includes("disponible")) return "online";
  if (t.includes("busy") || t.includes("servicio")) return "busy";
  return "offline";
}

function normalizeLocationItem(raw: unknown): DriverLiveLocationItem | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const full_name = asText(row.full_name || row.name || row.label);
  const plate = asText(row.plate || row.vehicle_plate || row.placa);
  const lat = asNumber(row.lat ?? row.latitude);
  const lng = asNumber(row.lng ?? row.lon ?? row.long ?? row.longitude);
  if (!full_name || lat === null || lng === null) return null;
  return {
    full_name,
    plate,
    availability: normalizeAvailability(row.availability ?? row.status ?? row.online_status),
    lat,
    lng,
    code: asText(row.code),
    date_tracked: asText(row.date_tracked),
    txt_tracked: asText(row.txt_tracked),
    icon: asText(row.icon),
  };
}

function extractItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const o = payload as Record<string, unknown>;
  if (Array.isArray(o.items)) return o.items;
  if (o.items && typeof o.items === "object" && !Array.isArray(o.items)) return [o.items];
  if (Array.isArray(o.data)) return o.data;
  if (o.data && typeof o.data === "object" && !Array.isArray(o.data)) return [o.data];
  if (Array.isArray(o.results)) return o.results;
  if (o.item && typeof o.item === "object") return [o.item];
  return [];
}

function pickBestItem(items: DriverLiveLocationItem[], query: string): DriverLiveLocationItem | null {
  if (items.length === 0) return null;
  const q = query.trim().toLowerCase();
  const exact = items.find((it) => it.full_name.toLowerCase() === q);
  if (exact) return exact;
  const starts = items.find((it) => it.full_name.toLowerCase().startsWith(q));
  if (starts) return starts;
  const includes = items.find((it) => it.full_name.toLowerCase().includes(q));
  if (includes) return includes;
  return items[0] ?? null;
}

function parseJsonResponse(text: string): unknown {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

function moobizGpsResponseRequiresReauth(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== "object") return false;
  const o = parsed as Record<string, unknown>;
  const msg = [o.msg, o.error].map((x) => (typeof x === "string" ? x : "")).join(" ");
  return /not_?logged|not\s*authorized|unauthori|token\s*invalid|sesi[oó]n\s*(inv[aá]lida|expir)/i.test(
    msg,
  );
}

function resolveItemFromParsed(parsed: unknown, query: string): DriverLiveLocationItem | null {
  const normalized = extractItems(parsed).map(normalizeLocationItem).filter(Boolean) as DriverLiveLocationItem[];
  return pickBestItem(normalized, query);
}

/**
 * GET live/vehicles desde el navegador del operador (token de su sesión Moobiz).
 * Requiere CORS permitido por app.moobiz.pe hacia el origen del dashboard.
 */
export async function fetchMoobizLiveDriverLocation(
  bearerToken: string,
  conductorDisplayName: string,
): Promise<DriverLiveLocationFetchResult> {
  const token = bearerToken.trim();
  if (!token) {
    return { ok: false, msg: "missing_token", item: null };
  }

  const q = normalizeMoobizLiveSearchQuery(conductorDisplayName);
  if (!q) {
    return { ok: false, msg: "missing_query", item: null };
  }

  const url =
    `${MOOBIZ_LIVE_VEHICLES_BASE}?query=${encodeURIComponent(q)}` + `&show_destinations=true`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });
  } catch {
    return { ok: false, msg: "network_error", item: null };
  }

  const text = await res.text();
  const parsed = parseJsonResponse(text);

  if (res.status === 401 || res.status === 403) {
    return { ok: false, msg: MOOBIZ_GPS_FETCH_NOT_LOGGED, item: null };
  }

  if (moobizGpsResponseRequiresReauth(parsed)) {
    return { ok: false, msg: MOOBIZ_GPS_FETCH_NOT_LOGGED, item: null };
  }

  const item = resolveItemFromParsed(parsed, conductorDisplayName);
  if (item) {
    return { ok: true, item };
  }

  return { ok: false, msg: "not_found", item: null };
}
