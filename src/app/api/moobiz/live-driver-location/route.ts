import { NextRequest, NextResponse } from "next/server";

import { formatApiError } from "@/lib/format-api-error";
import {
  getMoobizBearerForRequest,
  loginAndGetMoobizToken,
  moobizFetchWithToken,
  writeMoobizTokenToDb,
} from "@/lib/moobiz-auth";
import { assertQualityReadAccess } from "@/lib/panel-session";

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

function normalizeAvailability(v: unknown): Availability {
  const t = asText(v).toLowerCase();
  if (t.includes("online") || t.includes("disponible")) return "online";
  if (t.includes("busy") || t.includes("servicio")) return "busy";
  return "offline";
}

function normalizeLocationItem(raw: unknown): LiveDriverLocationItem | null {
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

/** Moobiz a veces responde HTTP 200 y `ok: true` con `items: []` cuando el Bearer está vencido (sin 401). */
function moobizLiveVehiclesOkButEmptyItems(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== "object") return false;
  const o = parsed as Record<string, unknown>;
  if (o.ok !== true) return false;
  return extractItems(parsed).length === 0;
}

function logLiveLocationBearer(label: string, token: string): void {
  const t = token.trim();
  const preview = t.length <= 10 ? t : `${t.slice(0, 10)}…`;
  console.log(`[live-driver-location] ${label} Bearer (primeros 10): ${preview} [len=${t.length}]`);
}

function parseJsonResponse(text: string): unknown {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

async function fetchLiveVehiclesJson(
  upstreamUrl: string,
  token: string,
): Promise<{ ok: boolean; status: number; parsed: unknown }> {
  const res = await moobizFetchWithToken(
    upstreamUrl,
    {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    },
    token,
  );
  const text = await res.text();
  const parsed = parseJsonResponse(text);
  return { ok: res.ok, status: res.status, parsed };
}

export async function GET(request: NextRequest): Promise<Response> {
  try {
    assertQualityReadAccess(request);
  } catch (err) {
    const message = formatApiError(err);
    const status = message.startsWith("AUTH_REQUIRED") ? 401 : 500;
    return NextResponse.json({ ok: false, msg: message, item: null }, { status });
  }

  const query = asText(request.nextUrl.searchParams.get("query"));
  if (!query) {
    return NextResponse.json({ ok: false, msg: "missing_query", item: null }, { status: 400 });
  }

  try {
    const upstreamUrl =
      `https://app.moobiz.pe/api/admin/live/vehicles?query=${encodeURIComponent(query)}` +
      `&show_destinations=true`;

    let token = await getMoobizBearerForRequest();
    logLiveLocationBearer("intento 1", token);

    let { ok: httpOk, status: httpStatus, parsed } = await fetchLiveVehiclesJson(upstreamUrl, token);

    if (!httpOk) {
      return NextResponse.json(
        {
          ok: false,
          msg: `upstream_${httpStatus}`,
          item: null,
        },
        { status: 502 },
      );
    }

    let normalized = extractItems(parsed).map(normalizeLocationItem).filter(Boolean) as LiveDriverLocationItem[];
    let item = pickBestItem(normalized, query);

    const emptySuccess = moobizLiveVehiclesOkButEmptyItems(parsed);
    if (emptySuccess) {
      console.warn(
        "[live-driver-location] Moobiz respondió ok:true con items vacíos; se asume token desactualizado — login + persistencia en sync_state y reintento…",
      );
      const { token: fresh } = await loginAndGetMoobizToken();
      await writeMoobizTokenToDb(fresh);
      token = fresh;
      logLiveLocationBearer("intento 2 (tras renovar y guardar en sync_state)", token);

      const second = await fetchLiveVehiclesJson(upstreamUrl, token);
      if (!second.ok) {
        return NextResponse.json(
          { ok: false, msg: `upstream_${second.status}`, item: null },
          { status: 502 },
        );
      }
      parsed = second.parsed;
      normalized = extractItems(parsed).map(normalizeLocationItem).filter(Boolean) as LiveDriverLocationItem[];
      item = pickBestItem(normalized, query);
    }

    if (!item) {
      return NextResponse.json({ ok: false, msg: "not_found", item: null });
    }

    return NextResponse.json({ ok: true, item });
  } catch (error) {
    const message = formatApiError(error);
    const status = message.startsWith("AUTH_REQUIRED") ? 401 : 500;
    return NextResponse.json({ ok: false, msg: message, item: null }, { status });
  }
}
