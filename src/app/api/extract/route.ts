import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

import {
  loginAndGetMoobizToken,
  moobizFetch,
  readMoobizTokenFromDb,
  redactMoobizToken,
  writeMoobizTokenToDb,
} from "@/lib/moobiz-auth";
import { canonicalViajeProducto } from "@/lib/product-categories";

type JsonRecord = Record<string, unknown>;

export const runtime = "nodejs";

const DISPATCHER_URL = "https://app.moobiz.pe/api/admin/dispatcher";
/** Token de emergencia si login falla o sigue `not_logged` (override con MOOBIZ_FALLBACK_TOKEN). */
const DEFAULT_MOOBIZ_FALLBACK_BEARER = "1a7271369ba2dfa7efcc2195f55272d1";
const TARGET_TABLE = "viajes_activos";

/** Respuesta JSON de exportación cuando la sesión/token no es válida. */
class MoobizNotLoggedError extends Error {
  readonly code = "MOOBIZ_NOT_LOGGED" as const;
  constructor(readonly preview: string) {
    super("Moobiz not_logged");
    this.name = "MoobizNotLoggedError";
  }
}

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
  "id viaje": "id",
  empresa: "empresa",
  usuario: "usuario",
  conductor: "conductor",
  estado: "estado",
  pasajero: "pasajero",
  pasajeros: "pasajero",
  fecha: "fecha",
  "fecha de registro": "fecha_registro",
  producto: "producto",
  monto: "monto",
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

/** Cookies estáticas del .env (sesión Moobiz previa). */
function buildMoobizCookieFromEnv(): string {
  const parts: string[] = [];
  const phpsessid = getEnvTrimmed(["MOOBIZ_PHPSESSID", "MOOBIZ_SESSION_COOKIE"]);
  if (phpsessid) parts.push(`PHPSESSID=${phpsessid}`);
  const zldp = getEnvTrimmed(["MOOBIZ_ZLDP"]);
  if (zldp) {
    try {
      parts.push(`ZLDP=${decodeURIComponent(zldp)}`);
    } catch {
      parts.push(`ZLDP=${zldp}`);
    }
  }
  const zldt = getEnvTrimmed(["MOOBIZ_ZLDT"]);
  if (zldt) parts.push(`ZLDT=${zldt}`);
  return parts.join("; ");
}

/** Une cabeceras Cookie (mismo nombre de cookie: gana el último fragmento). */
function mergeCookieHeaders(...segments: (string | null | undefined)[]): string {
  const map = new Map<string, string>();
  for (const seg of segments) {
    if (!seg || !seg.trim()) continue;
    for (const part of seg.split(";")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const name = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (name) map.set(name, value);
    }
  }
  return Array.from(map.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

function getMoobizFallbackBearerToken(): string {
  return (
    getEnvTrimmed(["MOOBIZ_FALLBACK_TOKEN", "MOOBIZ_EMERGENCY_TOKEN"]) ?? DEFAULT_MOOBIZ_FALLBACK_BEARER
  );
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
    if (dbField === "producto") {
      mapped[dbField] = canonicalViajeProducto(value);
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

type FetchDispatcherXlsxOptions = {
  /** Cabecera Cookie opcional (p. ej. PHPSESSID del login o del .env). */
  cookieHeader?: string;
  /** Etiqueta solo para logs. */
  attemptLabel?: string;
};

async function parseDispatcherResponse(exportRes: Response, rawText: string): Promise<ArrayBuffer> {
  if (!exportRes.ok) {
    throw new Error(`MOOBIZ_EXPORT_FAILED: HTTP ${exportRes.status} — ${rawText.slice(0, 300)}`);
  }

  const contentType = (exportRes.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("application/json") || contentType.includes("text/plain")) {
    try {
      const parsed = JSON.parse(rawText) as { ok?: unknown; msg?: unknown; error?: unknown };
      if (parsed?.msg === "not_logged") {
        throw new MoobizNotLoggedError(rawText.slice(0, 500));
      }
      const detail =
        typeof parsed?.error === "string" && parsed.error.trim()
          ? parsed.error
          : typeof parsed?.msg === "string" && parsed.msg.trim()
            ? String(parsed.msg)
            : rawText.slice(0, 200);
      throw new Error(`MOOBIZ_EXPORT_FAILED: respuesta JSON sin Excel — ${detail}`);
    } catch (e) {
      if (e instanceof MoobizNotLoggedError) throw e;
      if (e instanceof Error && e.message.startsWith("MOOBIZ_EXPORT_FAILED")) throw e;
      throw new Error(`MOOBIZ_EXPORT_FAILED: ${rawText.slice(0, 200)}`);
    }
  }

  return exportRes.arrayBuffer();
}

/** Dispatcher usando `moobizFetch` (token en sync_state / renovación 401/403). */
async function fetchDispatcherXlsxMoobizFetch(options?: FetchDispatcherXlsxOptions): Promise<ArrayBuffer> {
  const body = new URLSearchParams();
  body.append("export", "xlsx");

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    Accept:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream,*/*",
    Origin: "https://app.moobiz.pe",
    Referer: "https://app.moobiz.pe/actives",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  };
  const cookie = options?.cookieHeader?.trim();
  if (cookie) headers.Cookie = cookie;

  const label = options?.attemptLabel ?? "export";
  console.log("[Moobiz] descarga XLSX", label, cookie ? "(con Cookie env)" : "(sin Cookie env)");

  const exportRes = await moobizFetch(DISPATCHER_URL, {
    method: "POST",
    headers,
    body: body.toString(),
  });

  console.log("[Moobiz] export status:", exportRes.status);
  const rawText = await exportRes.clone().text();
  console.log("[Moobiz] export content-type:", exportRes.headers.get("content-type"));
  console.log("[Moobiz] export preview:", rawText.slice(0, 500));

  return await parseDispatcherResponse(exportRes, rawText);
}

/** `null` = respuesta JSON `not_logged` del dispatcher. */
async function fetchDispatcherXlsxOrNotLoggedMoobiz(
  cookieHeader: string,
  attemptLabel: string,
): Promise<ArrayBuffer | null> {
  try {
    return await fetchDispatcherXlsxMoobizFetch({
      cookieHeader: cookieHeader || undefined,
      attemptLabel,
    });
  } catch (e) {
    if (e instanceof MoobizNotLoggedError) return null;
    throw e;
  }
}

/** Fallback: Bearer fijo (no pasa por sync_state / moobizFetch). */
async function fetchDispatcherXlsxFixedToken(
  token: string,
  options?: FetchDispatcherXlsxOptions,
): Promise<ArrayBuffer> {
  const body = new URLSearchParams();
  body.append("export", "xlsx");

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "X-Auth-Token": token,
    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    Accept:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream,*/*",
    Origin: "https://app.moobiz.pe",
    Referer: "https://app.moobiz.pe/actives",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  };
  const cookie = options?.cookieHeader?.trim();
  if (cookie) headers.Cookie = cookie;

  const exportRes = await fetch(DISPATCHER_URL, {
    method: "POST",
    headers,
    body: body.toString(),
    cache: "no-store",
  });
  const rawText = await exportRes.clone().text();
  console.log("[Moobiz] export (fallback fijo) status:", exportRes.status);
  return await parseDispatcherResponse(exportRes, rawText);
}

async function fetchDispatcherXlsxOrNotLoggedFixed(
  token: string,
  cookieHeader: string,
  attemptLabel: string,
): Promise<ArrayBuffer | null> {
  try {
    return await fetchDispatcherXlsxFixedToken(token, {
      cookieHeader: cookieHeader || undefined,
      attemptLabel,
    });
  } catch (e) {
    if (e instanceof MoobizNotLoggedError) return null;
    throw e;
  }
}

async function resolveMoobizXlsxBuffer(): Promise<ArrayBuffer> {
  const email = getEnvTrimmed(["MOOBIZ_EMAIL"]);
  const pass = getEnvTrimmed(["MOOBIZ_PASSWORD"]);
  const envTok = getEnvTrimmed(["MOOBIZ_TOKEN"]);
  const canAdminLogin = Boolean(email && pass);
  const fallbackBearer = getMoobizFallbackBearerToken();
  let cookieHeader = buildMoobizCookieFromEnv();

  const dbTok = await readMoobizTokenFromDb();
  if (!canAdminLogin && !envTok && !dbTok) {
    throw new Error(
      "FALLA_CRITICA_MOOBIZ_LOGIN: faltan MOOBIZ_EMAIL/MOOBIZ_PASSWORD y no hay token en sync_state ni MOOBIZ_TOKEN para arrancar.",
    );
  }

  const tryFallback = async (reason: string): Promise<ArrayBuffer> => {
    if (!fallbackBearer.trim()) {
      throw new Error(`FALLA_CRITICA_MOOBIZ_LOGIN: ${reason} (sin MOOBIZ_FALLBACK_TOKEN).`);
    }
    console.log(
      "[Moobiz] intento token fallback (emergencia), bearer:",
      redactMoobizToken(fallbackBearer),
    );
    const buf = await fetchDispatcherXlsxOrNotLoggedFixed(
      fallbackBearer,
      cookieHeader,
      "C_fallback_emergency",
    );
    if (buf) return buf;
    throw new Error(
      `FALLA_CRITICA_MOOBIZ_LOGIN: ${reason} — dispatcher sigue en not_logged incluso con token fallback.`,
    );
  };

  let buf = await fetchDispatcherXlsxOrNotLoggedMoobiz(cookieHeader, "A_moobiz_fetch");
  if (buf) return buf;

  if (canAdminLogin) {
    console.log("[Moobiz] not_logged con token actual; login admin + persistencia en sync_state…");
    const { token, cookieFromLogin } = await loginAndGetMoobizToken();
    await writeMoobizTokenToDb(token);
    cookieHeader = mergeCookieHeaders(cookieHeader, cookieFromLogin);
    buf = await fetchDispatcherXlsxOrNotLoggedMoobiz(cookieHeader, "B_post_admin_login");
    if (buf) return buf;
  }

  return tryFallback("dispatcher not_logged despues de login admin");
}

export async function GET(): Promise<Response> {
  try {
    console.log(`[extract][AUDIT] GET /api/extract iniciado destino=public.${TARGET_TABLE}`);
    const supabaseUrl = getEnvTrimmed(["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]);
    const supabaseServiceKey = getEnvTrimmed(["SUPABASE_SERVICE_ROLE_KEY"]);

    if (!supabaseUrl || !supabaseServiceKey) {
      return Response.json(
        {
          ok: false,
          error:
            "Faltan variables de entorno. Revisa SUPABASE_URL (o NEXT_PUBLIC_SUPABASE_URL) y SUPABASE_SERVICE_ROLE_KEY.",
        },
        { status: 500 },
      );
    }

    const xlsxBuffer = await resolveMoobizXlsxBuffer();

    console.log("Conexion Moobiz OK, procesando viajes (XLSX descargado)...");
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
    console.log(`[extract][AUDIT] registros mapeados para insertar=${mappedRows.length}`);

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
    console.log(
      `[extract][AUDIT] escritura destino=public.${TARGET_TABLE} deleted=${syncResult.deleted} inserted=${syncResult.inserted}`,
    );

    return Response.json({
      deleted: syncResult.deleted,
      inserted: syncResult.inserted,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error inesperado";
    if (message.startsWith("FALLA_CRITICA_MOOBIZ_LOGIN")) {
      return Response.json(
        { ok: false, code: "FALLA_CRITICA_MOOBIZ_LOGIN", error: message },
        { status: 503 },
      );
    }
    if (message.startsWith("MOOBIZ_LOGIN_FAILED")) {
      return Response.json(
        { ok: false, code: "MOOBIZ_LOGIN_FAILED", error: message },
        { status: 401 },
      );
    }
    if (message.startsWith("MOOBIZ_EXPORT_FAILED")) {
      return Response.json(
        { ok: false, code: "MOOBIZ_EXPORT_FAILED", error: message },
        { status: 502 },
      );
    }
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
