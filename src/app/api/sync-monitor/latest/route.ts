import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    let { data, error } = await supabaseAdmin
      .from("sync_monitor")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1);

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

    const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
    return NextResponse.json({ row, error: null });
  } catch (err) {
    return NextResponse.json({
      row: null,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
