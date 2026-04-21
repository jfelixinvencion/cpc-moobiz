import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import {
  resolveActivityDispatcherXlsx,
  getEnvTrimmed,
} from "@/lib/moobiz-session";
import * as XLSX from "xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lee celda tolerando mayúsculas/minúsculas en el nombre de columna del Excel. */
function pickCell(row: Record<string, unknown>, ...candidates: string[]): unknown {
  const keys = Object.keys(row);
  for (const want of candidates) {
    const w = want.toLowerCase();
    for (const k of keys) {
      if (k.toLowerCase() === w) return row[k];
    }
  }
  return undefined;
}

function parseSourceDate(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

type MapOutcome =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; reason: string };

function mapRowToPayload(row: Record<string, unknown>, rowIndex: number): MapOutcome {
  const idVal = pickCell(row, "ID", "id", "Id", "id viaje", "ID Viaje", "ID_VIAJE");
  if (idVal === undefined || idVal === null || String(idVal).trim() === "") {
    return { ok: false, reason: `sin_id_fila_${rowIndex}` };
  }

  const estado = pickCell(row, "Estado", "estado", "ESTADO");
  const usuario = pickCell(row, "Usuario", "usuario", "USUARIO");
  const conductor = pickCell(row, "Conductor", "conductor", "CONDUCTOR");
  const empresa = pickCell(row, "Empresa", "empresa", "EMPRESA");
  const destino = pickCell(row, "Destino", "destino", "DESTINO");
  const origen = pickCell(row, "Origen", "origen", "ORIGEN");
  const fecha = pickCell(row, "Fecha", "fecha", "FECHA");

  return {
    ok: true,
    payload: {
      source_id: String(idVal).trim(),
      source_date: parseSourceDate(fecha),
      tipo_actividad: (estado != null && String(estado).trim() !== "" ? String(estado) : null) ?? "Reserva Activa",
      nombre_usuario: usuario != null && String(usuario).trim() !== "" ? String(usuario) : null,
      apellido_usuario: conductor != null && String(conductor).trim() !== "" ? String(conductor) : null,
      plataforma: empresa != null && String(empresa).trim() !== "" ? String(empresa) : null,
      id_destino: destino != null && String(destino).trim() !== "" ? String(destino) : null,
      tabla_padre: origen != null && String(origen).trim() !== "" ? String(origen) : null,
      datos: row,
    },
  };
}

const UPSERT_BATCH = 200;

async function insertActivitySyncMonitorSuccess(recordsInserted: number): Promise<void> {
  const { error } = await supabaseAdmin.from("sync_monitor").insert({
    status: "success",
    records_inserted: recordsInserted,
    pages_queried: 1,
    last_id: "moobiz_activity",
    error_message: null,
  });
  if (error) {
    console.warn("[moobiz-activity] sync_monitor insert fallo (no bloquea sync):", error.message);
  } else {
    console.log("[moobiz-activity] sync_monitor actualizado (actividades), records_inserted=", recordsInserted);
  }
}

export async function GET() {
  const hasAnyTokenOrLogin =
    getEnvTrimmed(["MOOBIZ_LOGS_TOKEN", "MOOBIZ_TOKEN"]) ||
    (getEnvTrimmed(["MOOBIZ_EMAIL"]) && getEnvTrimmed(["MOOBIZ_PASSWORD"]));

  if (!hasAnyTokenOrLogin) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Falta MOOBIZ_LOGS_TOKEN o MOOBIZ_TOKEN (o credenciales MOOBIZ_EMAIL/MOOBIZ_PASSWORD para login).",
        session_renewed: false,
        raw_count: 0,
        mapped_count: 0,
        inserted_count: 0,
        skipped_count: 0,
        skip_reasons: {},
      },
      { status: 500 },
    );
  }

  let sessionRenewed = false;

  try {
    const { buffer: xlsxBuffer, sessionRenewed: renewed } = await resolveActivityDispatcherXlsx();
    sessionRenewed = renewed;

    const buffer = Buffer.from(xlsxBuffer);
    const wb = XLSX.read(buffer, { type: "buffer" });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) {
      console.warn("[moobiz-activity] XLSX sin hojas");
      return NextResponse.json({
        ok: false,
        error: "El XLSX no contiene hojas.",
        session_renewed: sessionRenewed,
        raw_count: 0,
        mapped_count: 0,
        inserted_count: 0,
        skipped_count: 0,
        skip_reasons: {},
      });
    }

    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], {
      defval: null,
      raw: false,
    });
    const rawCount = rows.length;
    console.log("[moobiz-activity] raw_count (filas Excel):", rawCount);

    const payloads: Record<string, unknown>[] = [];
    const skipReasons: Record<string, number> = {};
    for (let i = 0; i < rows.length; i++) {
      const outcome = mapRowToPayload(rows[i] ?? {}, i);
      if (!outcome.ok) {
        skipReasons[outcome.reason] = (skipReasons[outcome.reason] ?? 0) + 1;
        continue;
      }
      payloads.push(outcome.payload);
    }

    const mappedCount = payloads.length;
    const skippedCount = rawCount - mappedCount;
    console.log(
      "[moobiz-activity] mapped_count=",
      mappedCount,
      "skipped_count=",
      skippedCount,
      "skip_reasons=",
      JSON.stringify(skipReasons),
    );

    if (payloads.length === 0) {
      console.warn(
        "[moobiz-activity] inserted_count=0 motivo: 0 filas mapeables (revisar cabeceras o respuesta vacia).",
      );
      await insertActivitySyncMonitorSuccess(0);
      return NextResponse.json({
        ok: true,
        mensaje: "Sin filas validas para insertar tras el mapeo.",
        session_renewed: sessionRenewed,
        raw_count: rawCount,
        mapped_count: mappedCount,
        inserted_count: 0,
        skipped_count: skippedCount,
        skip_reasons: skipReasons,
      });
    }

    let insertedCount = 0;
    for (let i = 0; i < payloads.length; i += UPSERT_BATCH) {
      const chunk = payloads.slice(i, i + UPSERT_BATCH);
      const { error } = await supabaseAdmin.from("moobiz_activity_raw").upsert(chunk, {
        onConflict: "source_id",
      });
      if (error) throw error;
      insertedCount += chunk.length;
    }

    console.log("[moobiz-activity] inserted_count (lotes upsert):", insertedCount);

    await insertActivitySyncMonitorSuccess(insertedCount);

    return NextResponse.json({
      ok: true,
      mensaje: "Sincronizacion exitosa",
      session_renewed: sessionRenewed,
      raw_count: rawCount,
      mapped_count: mappedCount,
      inserted_count: insertedCount,
      skipped_count: skippedCount,
      skip_reasons: skipReasons,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[moobiz-activity] error:", message);
    return NextResponse.json(
      {
        ok: false,
        error: message,
        session_renewed: sessionRenewed,
        raw_count: null,
        mapped_count: null,
        inserted_count: 0,
        skipped_count: null,
        skip_reasons: null,
      },
      { status: 500 },
    );
  }
}
