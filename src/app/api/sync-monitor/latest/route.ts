import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    /** Última corrida del script de logs (GitHub); excluye filas del antiguo flujo de actividades. */
    let { data, error } = await supabaseAdmin
      .from("sync_monitor")
      .select("*")
      .neq("last_id", "moobiz_actividad")
      .neq("last_id", "moobiz_activity")
      .order("created_at", { ascending: false })
      .limit(1);

    if (!error && (!Array.isArray(data) || data.length === 0)) {
      const anyRow = await supabaseAdmin
        .from("sync_monitor")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1);
      data = anyRow.data;
      error = anyRow.error;
    }

    if (error) {
      const fallback = await supabaseAdmin
        .from("sync_monitor")
        .select("*")
        .order("id", { ascending: false })
        .limit(1);
      data = fallback.data;
      error = fallback.error;
    }

    if (error) {
      return NextResponse.json({
        row: null,
        error: error.message,
      });
    }

    const rawRow = Array.isArray(data) && data.length > 0 ? data[0] : null;
    const row =
      rawRow && typeof rawRow === "object"
        ? {
            ...rawRow,
            records_procesados:
              (rawRow as { records_procesados?: unknown }).records_procesados ??
              (rawRow as { records_inserted?: unknown }).records_inserted ??
              null,
          }
        : rawRow;
    return NextResponse.json({ row, error: null });
  } catch (err) {
    return NextResponse.json({
      row: null,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
