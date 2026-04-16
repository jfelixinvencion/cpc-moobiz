import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

type JsonRecord = Record<string, unknown>;

export const runtime = "nodejs";

const DISPATCHER_URL = "https://app.moobiz.pe/api/admin/dispatcher";
const TARGET_TABLE = "viajes_activos";

const REQUIRED_BASE_COLUMNS = [
  "id",
  "empresa",
  "usuario",
  "conductor",
  "estado",
  "pasajero",
  "fecha",
  "monto",
  "origen",
  "destino",
] as const;

const EXCEL_TO_DB_MAP: Record<string, string> = {
  id: "id",
  empresa: "empresa",
  usuario: "usuario",
  conductor: "conductor",
  estado: "estado",
  pasajeros: "pasajero",
  fecha: "fecha",
  "fecha de registro": "fecha_registro",
  producto: "producto",
  precio: "monto",
  origen: "origen",
  destino: "destino",
  operador: "operador",
};

function getEnvTrimmed(keys: string[]): string | null {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}

function normalizeHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function toNullableString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  return str.length > 0 ? str : null;
}

function toMoneyNumberOrZero(value: unknown): number {
  if (value === undefined || value === null) return 0;
  const raw = String(value).trim();
  if (!raw) return 0;
  const normalized = raw.replace(/[^0-9,.-]/g, "").replace(/,/g, ".");
  const parsed = parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapExcelRow(row: JsonRecord): JsonRecord {
  const mapped: JsonRecord = {};

  for (const [excelKeyRaw, value] of Object.entries(row)) {
    if (excelKeyRaw.startsWith("__EMPTY")) continue;
    const excelKey = normalizeHeader(excelKeyRaw);
    const dbField = EXCEL_TO_DB_MAP[excelKey];
    if (!dbField) continue; // Ignora cualquier columna fuera de la tabla exacta

    if (dbField === "monto") {
      mapped[dbField] = toMoneyNumberOrZero(value);
      continue;
    }

    mapped[dbField] = toNullableString(value);
  }

  // El ID de Supabase debe venir del ID de Moobiz.
  const id = toNullableString(mapped.id);
  mapped.id = id;

  return mapped;
}

function hasMinimumColumns(row: JsonRecord): boolean {
  return REQUIRED_BASE_COLUMNS.every((key) => row[key] !== null && row[key] !== "");
}

async function replaceAllRows(
  supabase: any,
  viajes: JsonRecord[],
): Promise<{ deleted: number; inserted: number }> {
  const { data: deletedRows, error: deleteError } = await supabase
    .from(TARGET_TABLE)
    .delete()
    .neq("id", "")
    .select("id");

  if (deleteError) {
    throw new Error(`Error eliminando registros existentes: ${deleteError.message}`);
  }

  let inserted = 0;
  const batchSize = 50;
  console.log("Total registros a insertar:", viajes.length);
  const totalLotes = Math.ceil(viajes.length / batchSize);
  for (let i = 0; i < viajes.length; i += batchSize) {
    const batch = viajes.slice(i, i + batchSize);
    const loteActual = Math.floor(i / batchSize) + 1;
    console.log("Insertando lote", loteActual, "de", totalLotes, "- registros:", batch.length);
    const { error } = await supabase.from(TARGET_TABLE).insert(batch);
    if (error) {
      console.log("Error en lote", loteActual, ":", JSON.stringify(error));
      continue;
    }
    inserted += batch.length;
  }

  return { deleted: deletedRows?.length ?? 0, inserted };
}

async function fetchDispatcherXlsxByToken(token: string): Promise<ArrayBuffer> {
  const body = new URLSearchParams();
  body.append("export", "xlsx");

  const exportRes = await fetch(DISPATCHER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Auth-Token": token,
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      Accept:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream,*/*",
      Origin: "https://app.moobiz.pe",
      Referer: "https://app.moobiz.pe/actives",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
    body: body.toString(),
    cache: "no-store",
  });
  console.log("Status respuesta Moobiz:", exportRes.status);
  console.log("Content-Type respuesta:", exportRes.headers.get("content-type"));
  const rawText = await exportRes.clone().text();
  console.log("Primeros 500 caracteres de la respuesta:", rawText.slice(0, 500));

  if (!exportRes.ok) {
    const details = await exportRes.text();
    throw new Error(`Exportacion fallida (${exportRes.status}): ${details.slice(0, 300)}`);
  }

  return exportRes.arrayBuffer();
}

export async function GET(): Promise<Response> {
  try {
    const moobizToken = getEnvTrimmed(["MOOBIZ_TOKEN"]);
    const supabaseUrl = getEnvTrimmed(["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]);
    const supabaseServiceKey = getEnvTrimmed(["SUPABASE_SERVICE_ROLE_KEY"]);

    if (!moobizToken || !supabaseUrl || !supabaseServiceKey) {
      return Response.json(
        {
          ok: false,
          error:
            "Faltan variables de entorno. Revisa MOOBIZ_TOKEN, SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.",
        },
        { status: 500 },
      );
    }

    console.log("Conexión directa con Token exitosa, procesando viajes...");
    const xlsxBuffer = await fetchDispatcherXlsxByToken(moobizToken);
    const workbook = XLSX.read(Buffer.from(xlsxBuffer), { type: "buffer" });
    const firstSheetName = workbook.SheetNames[0];

    if (!firstSheetName) {
      return Response.json(
        { ok: false, error: "El archivo XLSX no contiene hojas." },
        { status: 422 },
      );
    }

    const rawRows = XLSX.utils.sheet_to_json<JsonRecord>(workbook.Sheets[firstSheetName], {
      defval: null,
      raw: false,
    });
    console.log("Total filas en Excel:", rawRows.length);
    console.log(
      "Columnas de la primera fila:",
      JSON.stringify(Object.keys(rawRows[0] || {})),
    );
    console.log("Primera fila completa:", JSON.stringify(rawRows[0]));
    const firstRow = rawRows[0];
    if (firstRow && typeof firstRow === "object") {
      console.log(Object.keys(firstRow));
    }
    const mappedRows = rawRows.map(mapExcelRow);

    if (mappedRows.length === 0) {
      return Response.json(
        {
          ok: false,
          error:
            "No hubo filas validas despues del mapeo. Verifica encabezados del Excel y columnas de Supabase.",
          totalFilasExcel: rawRows.length,
        },
        { status: 422 },
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const syncResult = await replaceAllRows(supabase, mappedRows);

    return Response.json({
      deleted: syncResult.deleted,
      inserted: syncResult.inserted,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error inesperado";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
