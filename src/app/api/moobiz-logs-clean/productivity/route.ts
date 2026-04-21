import {
  endOfISOWeek,
  getISODay,
  getISOWeek,
  getISOWeekYear,
  setISOWeek,
  setISOWeekYear,
  startOfISOWeek,
} from "date-fns";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const TABLE = "moobiz_logs_clean";
const MAX_ROWS = 25_000;

function getEnvTrimmed(keys: string[]): string | null {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}

function getSupabase() {
  const supabaseUrl = getEnvTrimmed(["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]);
  const serviceRoleKey = getEnvTrimmed(["SUPABASE_SERVICE_ROLE_KEY"]);
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Faltan variables de entorno para Supabase: SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Interpreta `date_created` como timestamp (texto ISO u otros formatos parseables por JS). */
function parseDateCreated(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "string") {
    const t = Date.parse(value);
    if (!Number.isNaN(t)) return new Date(t);
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** `year` = año de numeración de semana ISO (`getISOWeekYear`), no necesariamente el año civil. */
function isoWeekBounds(isoWeekYear: number, week: number): { start: Date; end: Date } {
  const ref = new Date(isoWeekYear, 5, 15, 12, 0, 0, 0);
  const inWeek = setISOWeek(setISOWeekYear(ref, isoWeekYear), week);
  return {
    start: startOfISOWeek(inWeek),
    end: endOfISOWeek(inWeek),
  };
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const now = new Date();
    const fromParam = url.searchParams.get("from")?.trim() ?? "";
    const toParam = url.searchParams.get("to")?.trim() ?? "";

    let start: Date;
    let end: Date;
    if (fromParam.length > 0 && toParam.length > 0) {
      start = new Date(fromParam);
      end = new Date(toParam);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        throw new Error("Parametros `from` / `to` no son fechas validas.");
      }
    } else {
      const isoY = Math.min(
        2100,
        Math.max(
          2000,
          Number.parseInt(url.searchParams.get("year") ?? String(getISOWeekYear(now)), 10) ||
            getISOWeekYear(now),
        ),
      );
      const wk = Math.min(
        53,
        Math.max(1, Number.parseInt(url.searchParams.get("week") ?? String(getISOWeek(now)), 10) || 1),
      );
      ({ start, end } = isoWeekBounds(isoY, wk));
    }

    const startIso = start.toISOString();
    const endIso = end.toISOString();
    const isoWeekYearMeta = getISOWeekYear(start);
    const weekMeta = getISOWeek(start);
    const weekdayRaw = url.searchParams.get("weekday")?.trim() ?? "all";
    const typeLogName = url.searchParams.get("typeLogName")?.trim() ?? "";

    const supabase = getSupabase();

    let q = supabase
      .from(TABLE)
      .select("us_name,date_created,type_log_name")
      .gte("date_created", startIso)
      .lte("date_created", endIso)
      .order("date_created", { ascending: true });

    if (typeLogName.length > 0) {
      q = q.eq("type_log_name", typeLogName);
    }

    const { data: rows, error } = await q.limit(MAX_ROWS);

    if (error) throw error;

    const list = rows ?? [];
    const counts = new Map<string, number>();

    const weekdayNum =
      weekdayRaw === "all" || weekdayRaw === ""
        ? null
        : Math.min(7, Math.max(1, Number.parseInt(weekdayRaw, 10) || NaN));
    const weekdayFilter = Number.isFinite(weekdayNum) ? (weekdayNum as number) : null;

    for (const row of list) {
      const dt = parseDateCreated(row.date_created);
      if (!dt) continue;
      if (weekdayFilter != null) {
        const isoD = getISODay(dt);
        if (isoD !== weekdayFilter) continue;
      }
      const rawName = row.us_name;
      const name =
        rawName != null && String(rawName).trim() !== "" ? String(rawName).trim() : "(sin nombre)";
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }

    const series = Array.from(counts.entries())
      .map(([us_name, count]) => ({ us_name, count }))
      .sort((a, b) => b.count - a.count);

    const { data: typeRows, error: typeErr } = await supabase
      .from(TABLE)
      .select("type_log_name")
      .not("type_log_name", "is", null)
      .limit(8000);

    if (typeErr) throw typeErr;
    const typeLogOptions = Array.from(
      new Set(
        (typeRows ?? [])
          .map((r) =>
            String((r as { type_log_name?: string | null }).type_log_name ?? "")
              .trim(),
          )
          .filter(Boolean),
      ),
    ).sort((a, b) => a.localeCompare(b, "es"));

    return NextResponse.json({
      series,
      typeLogOptions,
      meta: {
        year: isoWeekYearMeta,
        week: weekMeta,
        rowCount: list.length,
        capped: list.length >= MAX_ROWS,
        start: startIso,
        end: endIso,
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : String(err),
        series: [],
        typeLogOptions: [],
        meta: null,
      },
      { status: 500 },
    );
  }
}
