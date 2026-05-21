import { NextRequest, NextResponse } from "next/server";

import { formatApiError } from "@/lib/format-api-error";
import {
  getMoobizBearerForRequest,
  loginAndGetMoobizToken,
  writeMoobizTokenToDb,
} from "@/lib/moobiz-auth";
import { assertQualityReadAccess } from "@/lib/panel-session";
import { getMoobizViewsPool } from "@/lib/pg-moobiz-dashboard-pool";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

type Availability = "online" | "busy" | "offline";

type LiveDriverLocationItem = {
  full_name: string;
  plate: string;
  availability: Availability;
  lat: number;
  lng: number;
  code: string;
  date_tracked: string;
  txt_tracked: string;
  icon: string;
  parked_address: string;
};

/** Servicios próximos (vista.moobiz_services_maestra) para el mapa GPS. */
export type NearbyMoobizServiceForMap = {
  id: string | number;
  lat: number;
  lng: number;
  alt_date: string;
  pr_name: string;
  dst_zone: string;
  prioridad_mapa: 1 | 2 | 3;
  /** Estado del servicio (p. ej. desde `live_driver_location` o maestra). */
  status: string;
  /** Nombre de producto (`pr_name` vía JOIN con maestra). */
  product_name: string;
};

function asText(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function asNumber(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return n;
}

type MaestraNearbyRow = {
  id?: unknown;
  org_lat?: unknown;
  org_lng?: unknown;
  alt_date?: unknown;
  pr_name?: unknown;
  dst_zone?: unknown;
  prioridad_mapa?: unknown;
  state_color_name?: unknown;
};

/**
 * Destino del servicio desde `vista.vw_driver_live_raw_flat` (solo lectura).
 * Requiere fila con `id_user` = ID conductor, `availability = busy` y coordenadas de destino válidas.
 */
async function fetchProductNameByServiceId(seIdRaw: string): Promise<string> {
  const seId = seIdRaw.trim();
  if (!seId) return "";
  try {
    const pool = getMoobizViewsPool();
    const { rows } = await pool.query<{ product_name?: unknown }>(
      `
        SELECT COALESCE(NULLIF(trim(m.pr_name::text), ''), '') AS product_name
        FROM vista.moobiz_services_maestra m
        WHERE m.id::text = $1
        LIMIT 1
      `,
      [seId],
    );
    return asText(rows[0]?.product_name);
  } catch (e) {
    console.warn(
      "[live-driver-location] fetchProductNameByServiceId:",
      e instanceof Error ? e.message : e,
    );
    return "";
  }
}

async function fetchServiceDestinationFromFlat(idUserRaw: string): Promise<{
  lat: number;
  lng: number;
  se_id: string;
  name: string;
  se_dst_address: string;
  product_name: string;
} | null> {
  const idUser = idUserRaw.trim();
  if (!idUser) return null;
  try {
    const { client } = getSupabaseServerClient();
    const { data, error } = await client
      .schema("vista")
      .from("vw_driver_live_raw_flat")
      .select("id_user, availability, se_dst_lat, se_dst_lng, se_id, name, se_dst_address")
      .eq("id_user", idUser)
      .limit(1);
    if (error) {
      console.warn("[live-driver-location] vw_driver_live_raw_flat:", error.message);
      return null;
    }
    const row = Array.isArray(data) && data[0] && typeof data[0] === "object" ? (data[0] as Record<string, unknown>) : null;
    if (!row) return null;
    const rowUser = asText(row.id_user);
    if (rowUser !== idUser) return null;
    const av = asText(row.availability).toLowerCase();
    if (av !== "busy") return null;
    const lat = asNumber(row.se_dst_lat);
    const lng = asNumber(row.se_dst_lng);
    if (lat === null || lng === null) return null;
    const se_id = asText(row.se_id);
    const product_name = await fetchProductNameByServiceId(se_id);
    return {
      lat,
      lng,
      se_id,
      name: asText(row.name),
      se_dst_address: asText(row.se_dst_address),
      product_name,
    };
  } catch (e) {
    console.warn(
      "[live-driver-location] fetchServiceDestinationFromFlat:",
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

type LiveDriverLocationMapRow = {
  id?: unknown;
  org_lat?: unknown;
  org_lng?: unknown;
  alt_date?: unknown;
  pr_name?: unknown;
  dst_zone?: unknown;
  prioridad_mapa?: unknown;
  status?: unknown;
  product_name?: unknown;
};

function mapRowToNearbyService(row: LiveDriverLocationMapRow): NearbyMoobizServiceForMap | null {
  const lat = asNumber(row.org_lat);
  const lng = asNumber(row.org_lng);
  if (lat === null || lng === null) return null;
  const rawId = row.id;
  if (rawId === null || rawId === undefined) return null;
  if (typeof rawId !== "string" && typeof rawId !== "number") return null;
  if (rawId === "") return null;
  const priority = asNumber(row.prioridad_mapa);
  if (priority !== 1 && priority !== 2 && priority !== 3) return null;
  const productName = asText(row.product_name) || asText(row.pr_name);
  return {
    id: rawId,
    lat,
    lng,
    alt_date: asText(row.alt_date),
    pr_name: productName,
    dst_zone: asText(row.dst_zone),
    prioridad_mapa: priority,
    status: asText(row.status),
    product_name: productName,
  };
}

/** Marcadores del mapa: posiciones en `live_driver_location` + `product_name` desde maestra. */
async function fetchNearbyServicesFromLiveDriverLocationJoin(): Promise<NearbyMoobizServiceForMap[]> {
  const pool = getMoobizViewsPool();
  const sql = `
    SELECT
      COALESCE(m.id::text, l.se_id::text) AS id,
      COALESCE(l.lat, l.org_lat, m.org_lat) AS org_lat,
      COALESCE(l.lng, l.org_lng, m.org_lng) AS org_lng,
      COALESCE(l.alt_date::text, m.alt_date::text, '') AS alt_date,
      COALESCE(l.dst_zone::text, m.dst_zone::text, '') AS dst_zone,
      COALESCE(l.prioridad_mapa, m.prioridad_mapa) AS prioridad_mapa,
      COALESCE(NULLIF(trim(l.status::text), ''), NULLIF(trim(m.state_color_name::text), ''), '') AS status,
      COALESCE(NULLIF(trim(m.pr_name::text), ''), NULLIF(trim(l.pr_name::text), ''), '') AS product_name,
      COALESCE(NULLIF(trim(m.pr_name::text), ''), NULLIF(trim(l.pr_name::text), ''), '') AS pr_name
    FROM public.live_driver_location l
    LEFT JOIN vista.moobiz_services_maestra m ON m.id::text = l.se_id::text
    WHERE COALESCE(l.prioridad_mapa, m.prioridad_mapa, 0) > 0
    LIMIT 500
  `;
  const { rows } = await pool.query<LiveDriverLocationMapRow>(sql);
  const out: NearbyMoobizServiceForMap[] = [];
  for (const row of rows) {
    const mapped = mapRowToNearbyService(row);
    if (mapped) out.push(mapped);
  }
  return out;
}

async function fetchNearbyServicesForMapFromMaestra(): Promise<NearbyMoobizServiceForMap[]> {
  const { client } = getSupabaseServerClient();
  const { data, error } = await client
    .schema("vista")
    .from("moobiz_services_maestra")
    .select("id, org_lat, org_lng, alt_date, pr_name, dst_zone, prioridad_mapa, state_color_name")
    .gt("prioridad_mapa", 0)
    .limit(500);

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as MaestraNearbyRow[];
  const out: NearbyMoobizServiceForMap[] = [];
  for (const row of rows) {
    const mapped = mapRowToNearbyService({
      id: row.id,
      org_lat: row.org_lat,
      org_lng: row.org_lng,
      alt_date: row.alt_date,
      pr_name: row.pr_name,
      dst_zone: row.dst_zone,
      prioridad_mapa: row.prioridad_mapa,
      status: row.state_color_name,
      product_name: row.pr_name,
    });
    if (mapped) out.push(mapped);
  }
  return out;
}

async function fetchNearbyServicesForMap(): Promise<NearbyMoobizServiceForMap[]> {
  try {
    const joined = await fetchNearbyServicesFromLiveDriverLocationJoin();
    if (joined.length > 0) {
      console.log(
        `[live-driver-location] nearbyServices via live_driver_location JOIN: ${joined.length}`,
      );
      return joined;
    }
    console.warn(
      "[live-driver-location] JOIN live_driver_location devolvió 0 filas; fallback maestra",
    );
  } catch (e) {
    console.warn(
      "[live-driver-location] fetchNearbyServicesFromLiveDriverLocationJoin:",
      e instanceof Error ? e.message : e,
    );
  }

  try {
    const fallback = await fetchNearbyServicesForMapFromMaestra();
    console.log(`[live-driver-location] nearbyServices fallback maestra: ${fallback.length}`);
    return fallback;
  } catch (e) {
    console.warn(
      "[live-driver-location] fetchNearbyServicesForMap:",
      e instanceof Error ? e.message : e,
    );
    return [];
  }
}

function normalizeAvailability(v: unknown): Availability {
  const t = asText(v).toLowerCase();
  if (t.includes("online") || t.includes("disponible")) return "online";
  if (t.includes("busy") || t.includes("servicio")) return "busy";
  return "offline";
}

function normalizeLocationItem(raw: unknown): LiveDriverLocationItem | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;

  const full_name = asText(
    row.full_name ??
      row.name ??
      (row.us_name || row.us_surname
        ? `${asText(row.us_name)} ${asText(row.us_surname)}`.trim()
        : ""),
  );

  const plate = asText(row.plate ?? row.vehicle_plate ?? row.placa);
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
    parked_address: asText(row.parked_address),
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

function pickBestItem(items: LiveDriverLocationItem[], query: string): LiveDriverLocationItem | null {
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

function resolveItemFromParsed(parsed: unknown, matchName: string): LiveDriverLocationItem | null {
  const normalized = extractItems(parsed).map(normalizeLocationItem).filter(Boolean) as LiveDriverLocationItem[];
  return pickBestItem(normalized, matchName);
}

/** Sin tildes, ñ→N, mayúsculas, espacios colapsados (query Moobiz live/vehicles). */
function normalizeConductorNameForMoobizQuery(raw: string): string {
  return String(raw ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ñ/gi, "N")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/** Nombres largos (4+ palabras): probar completo, luego 3 y 2 tokens. */
function buildMoobizLiveQueryVariants(normalizedUpper: string): string[] {
  const parts = normalizedUpper.split(" ").filter(Boolean);
  if (parts.length === 0) return [];
  if (parts.length <= 3) return [normalizedUpper];
  const v3 = parts.slice(0, 3).join(" ");
  const v2 = parts.slice(0, 2).join(" ");
  const out = [normalizedUpper, v3, v2];
  return [...new Set(out)];
}

function parseJsonSafe(text: string): unknown {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

async function fetchLiveVehiclesParsed(
  token: string,
  query: string,
): Promise<{ httpStatus: number; parsed: unknown }> {
  const url =
    `https://app.moobiz.pe/api/admin/live/vehicles?query=${encodeURIComponent(query)}` +
    `&show_destinations=true`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "X-Auth-Token": token,
    },
    cache: "no-store",
  });
  const text = await res.text();
  const parsed = parseJsonSafe(text);
  return { httpStatus: res.status, parsed };
}

/** Token vencido / sesión inválida (re-login). No confundir con ok:true e items vacíos (conductor offline). */
function moobizLiveResponseNeedsFreshToken(httpStatus: number, parsed: unknown): boolean {
  if (httpStatus === 401 || httpStatus === 403) return true;
  if (!parsed || typeof parsed !== "object") return false;
  const o = parsed as Record<string, unknown>;
  if (o.ok === false) {
    const msg = String(o.msg ?? "").toLowerCase();
    return (
      msg.includes("not_log") ||
      msg.includes("unauthorized") ||
      msg.includes("invalid") ||
      msg.includes("session") ||
      msg.includes("token")
    );
  }
  return false;
}

async function tryLocateWithToken(
  token: string,
  queryVariants: string[],
  matchName: string,
): Promise<{ item: LiveDriverLocationItem | null; needFreshToken: boolean }> {
  for (const q of queryVariants) {
    console.log(`[live-driver-location] probando query: "${q}"`);
    const { httpStatus, parsed } = await fetchLiveVehiclesParsed(token, q);
    console.log(
      `[live-driver-location] respuesta: httpStatus=${httpStatus}, items=${extractItems(parsed).length}`,
    );
    if (moobizLiveResponseNeedsFreshToken(httpStatus, parsed)) {
      return { item: null, needFreshToken: true };
    }
    const item = resolveItemFromParsed(parsed, matchName);
    if (item) return { item, needFreshToken: false };
  }
  return { item: null, needFreshToken: false };
}

export async function GET(request: NextRequest): Promise<Response> {
  console.log("[live-driver-location] INICIO REQUEST");
  try {
    assertQualityReadAccess(request);
  } catch (err) {
    const message = formatApiError(err);
    const status = message.startsWith("AUTH_REQUIRED") ? 401 : 500;
    return NextResponse.json(
      { ok: false, msg: message, item: null, nearbyServices: [] },
      { status },
    );
  }

  const queryRaw = asText(request.nextUrl.searchParams.get("query"));
  if (!queryRaw) {
    return NextResponse.json(
      { ok: false, msg: "missing_query", item: null, nearbyServices: [] },
      { status: 400 },
    );
  }

  const matchName = queryRaw;
  const normalized = normalizeConductorNameForMoobizQuery(matchName);
  const variants = buildMoobizLiveQueryVariants(normalized);
  if (variants.length === 0) {
    return NextResponse.json(
      { ok: false, msg: "missing_query", item: null, nearbyServices: [] },
      { status: 400 },
    );
  }

  const nearbyServicesPromise = fetchNearbyServicesForMap();
  const idUserParam = asText(request.nextUrl.searchParams.get("id_user"));

  try {
    let token = await getMoobizBearerForRequest();
    const preview =
      token.trim().length <= 10 ? token.trim() : `${token.trim().slice(0, 10)}…`;
    console.log(`[live-driver-location] intento 1 Bearer (primeros 10): ${preview} [len=${token.trim().length}]`);

    let { item, needFreshToken } = await tryLocateWithToken(token, variants, matchName);

    if (item) {
      const nearbyServices = await nearbyServicesPromise;
      const serviceDestination = idUserParam ? await fetchServiceDestinationFromFlat(idUserParam) : null;
      return NextResponse.json({
        ok: true,
        item,
        nearbyServices,
        ...(idUserParam ? { serviceDestination } : {}),
      });
    }

    if (needFreshToken) {
      const { token: fresh } = await loginAndGetMoobizToken();
      await writeMoobizTokenToDb(fresh);
      ({ item } = await tryLocateWithToken(fresh, variants, matchName));
      if (item) {
        const nearbyServices = await nearbyServicesPromise;
        const serviceDestination = idUserParam ? await fetchServiceDestinationFromFlat(idUserParam) : null;
        return NextResponse.json({
          ok: true,
          item,
          nearbyServices,
          ...(idUserParam ? { serviceDestination } : {}),
        });
      }
    }

    const nearbyServices = await nearbyServicesPromise;
    return NextResponse.json({
      ok: false,
      msg: "not_found",
      item: null,
      nearbyServices,
    });
  } catch (error) {
    const message = formatApiError(error);
    const status = message.startsWith("AUTH_REQUIRED") ? 401 : 500;
    let nearbyServices: NearbyMoobizServiceForMap[] = [];
    try {
      nearbyServices = await nearbyServicesPromise;
    } catch {
      /* ignore */
    }
    return NextResponse.json(
      { ok: false, msg: message, item: null, nearbyServices },
      { status },
    );
  }
}
