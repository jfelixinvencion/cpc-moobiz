import { NextRequest, NextResponse } from "next/server";

import { formatApiError } from "@/lib/format-api-error";
import { getMoobizBearerForRequest, moobizFetchWithToken } from "@/lib/moobiz-auth";
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
    const token = await getMoobizBearerForRequest();
    const upstreamUrl =
      `https://app.moobiz.pe/api/admin/live/vehicles?query=${encodeURIComponent(query)}` +
      `&show_destinations=true`;

    const upstream = await moobizFetchWithToken(
      upstreamUrl,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        cache: "no-store",
      },
      token,
    );

    const text = await upstream.text();
    let parsed: unknown = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = {};
    }

    if (!upstream.ok) {
      return NextResponse.json(
        {
          ok: false,
          msg: `upstream_${upstream.status}`,
          item: null,
        },
        { status: 502 },
      );
    }

    const normalized = extractItems(parsed).map(normalizeLocationItem).filter(Boolean) as LiveDriverLocationItem[];
    const item = pickBestItem(normalized, query);

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
