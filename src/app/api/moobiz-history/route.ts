import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const TABLE = "moobiz_services_history";
const SELECT_FIELDS =
  "id,service_id,date_finalized,date_scheduled,status,user_name,amount,raw_data,created_at,updated_at";

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

function escapeIlike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const userRaw = url.searchParams.get("user")?.trim() ?? "";
    const dateFrom = url.searchParams.get("dateFrom")?.trim() ?? "";
    const dateTo = url.searchParams.get("dateTo")?.trim() ?? "";
    const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
    const pageSizeRaw = Number.parseInt(url.searchParams.get("pageSize") ?? "50", 10) || 50;
    const pageSize = Math.min(100, Math.max(1, pageSizeRaw));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const supabase = getSupabase();
    let query = supabase.from(TABLE).select(SELECT_FIELDS, { count: "exact" });

    query = query.order("date_finalized", { ascending: false, nullsFirst: false });

    if (dateFrom) query = query.gte("date_finalized", `${dateFrom}T00:00:00.000Z`);
    if (dateTo) query = query.lte("date_finalized", `${dateTo}T23:59:59.999Z`);
    if (userRaw.length > 0) {
      const esc = escapeIlike(userRaw);
      query = query.ilike("user_name", `%${esc}%`);
    }

    const { data, error, count } = await query.range(from, to);
    if (error) throw error;

    return NextResponse.json({
      data: data ?? [],
      total: count ?? 0,
      page,
      pageSize,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : String(err),
        data: [],
        total: 0,
        page: 1,
        pageSize: 50,
      },
      { status: 500 },
    );
  }
}
