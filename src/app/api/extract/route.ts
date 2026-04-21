import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

type JsonRecord = Record<string, unknown>;

export const runtime = "nodejs";

const DISPATCHER_URL = "https://app.moobiz.pe/api/admin/dispatcher";
const DEFAULT_MOOBIZ_LOGIN_URL = "https://app.moobiz.pe/api/login";
const DEFAULT_MOOBIZ_VERIFY_URL = "https://app.moobiz.pe/api/verify";
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

/** Extrae pares name=value del primer segmento de cada Set-Cookie (Node/undici). */
function extractCookieHeaderFromLoginResponse(res: Response): string {
  const h = res.headers as unknown as { getSetCookie?: () => string[] };
  const lines = typeof h.getSetCookie === "function" ? h.getSetCookie() : [];
  const fromGetSetCookie = lines
    .map((line) => line.split(";")[0]?.trim())
    .filter((pair): pair is string => Boolean(pair && pair.includes("=")));
  if (fromGetSetCookie.length > 0) return fromGetSetCookie.join("; ");
  const single = res.headers.get("set-cookie");
  if (!single) return "";
  return single
    .split(/,(?=[^;]+?=)/)
    .map((s) => s.split(";")[0]?.trim())
    .filter((pair): pair is string => Boolean(pair && pair.includes("=")))
    .join("; ");
}

function getMoobizFallbackBearerToken(): string {
  return (
    getEnvTrimmed(["MOOBIZ_FALLBACK_TOKEN", "MOOBIZ_EMERGENCY_TOKEN"]) ?? DEFAULT_MOOBIZ_FALLBACK_BEARER
  );
}

/**
 * Login en Moobiz y nuevo token Bearer.
 * Body JSON `{ user, pass }` (user = MOOBIZ_EMAIL, pass = MOOBIZ_PASSWORD) según Network.
 */
async function refreshMoobizToken(): Promise<{ token: string; cookieFromLogin: string }> {
  const user = getEnvTrimmed(["MOOBIZ_EMAIL"]);
  const pass = getEnvTrimmed(["MOOBIZ_PASSWORD"]);
  if (!user || !pass) {
    throw new Error("MOOBIZ_LOGIN_FAILED: faltan MOOBIZ_EMAIL o MOOBIZ_PASSWORD en entorno.");
  }

  const loginUrl = getEnvTrimmed(["MOOBIZ_LOGIN_URL"]) ?? DEFAULT_MOOBIZ_LOGIN_URL;

  console.log(
    "[Moobiz] renovacion automatica: POST login en",
    loginUrl,
    "user",
    user.replace(/(^.).*(@.*)$/, "$1***$2"),
  );

  const loginRes = await fetch(loginUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Origin: "https://app.moobiz.pe",
      Referer: "https://app.moobiz.pe/",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
    body: JSON.stringify({ user, pass }),
    cache: "no-store",
  });

  const loginCt = loginRes.headers.get("content-type") || "";
  const loginText = await loginRes.text();
  console.log(
    "[Moobiz] login respuesta status=",
    loginRes.status,
    "content-type=",
    loginCt,
    "preview=",
    loginText.slice(0, 240),
  );

  if (!loginRes.ok) {
    throw new Error(
      `MOOBIZ_LOGIN_FAILED: HTTP ${loginRes.status} — ${loginText.slice(0, 400)}`,
    );
  }

  let parsed: {
    ok?: unknown;
    token?: unknown;
    msg?: unknown;
    id?: unknown;
    name?: unknown;
    surname?: unknown;
  };
  try {
    parsed = JSON.parse(loginText) as {
      ok?: unknown;
      token?: unknown;
      msg?: unknown;
      id?: unknown;
      name?: unknown;
      surname?: unknown;
    };
  } catch {
    throw new Error(`MOOBIZ_LOGIN_FAILED: respuesta no JSON — ${loginText.slice(0, 300)}`);
  }

  if (parsed.ok !== true || typeof parsed.token !== "string" || !parsed.token.trim()) {
    throw new Error(
      `MOOBIZ_LOGIN_FAILED: JSON sin token valido — ${JSON.stringify(parsed).slice(0, 500)}`,
    );
  }

  const token = parsed.token.trim();
  console.log(
    "[Moobiz] login OK (usuario Moobiz id=",
    String(parsed.id ?? ""),
    "nombre=",
    [parsed.name, parsed.surname].filter(Boolean).join(" ").trim() || "—",
    ")",
  );

  let cookieFromLogin = extractCookieHeaderFromLoginResponse(loginRes);
  if (cookieFromLogin) {
    console.log("[Moobiz] login Set-Cookie (pares):", cookieFromLogin.slice(0, 200));
  } else {
    console.log("[Moobiz] login sin Set-Cookie parseable.");
  }

  /** Tras login, Chrome llama `verify?token=...`; si falla no bloqueamos el export. */
  try {
    cookieFromLogin = await fetchMoobizVerifyAndMergeCookies(token, cookieFromLogin);
  } catch (verifyErr) {
    console.warn(
      "[Moobiz] verify opcional fallo (se continua con token de login):",
      verifyErr instanceof Error ? verifyErr.message : verifyErr,
    );
  }

  return { token, cookieFromLogin };
}

/**
 * GET verify?token=... (como en Network tras login). Une nuevas cookies de la respuesta.
 */
async function fetchMoobizVerifyAndMergeCookies(
  token: string,
  existingCookieHeader: string,
): Promise<string> {
  const rawBase = getEnvTrimmed(["MOOBIZ_VERIFY_URL"]);
  const verifyUrl = rawBase ? new URL(rawBase) : new URL(DEFAULT_MOOBIZ_VERIFY_URL);
  verifyUrl.searchParams.set("token", token);

  console.log("[Moobiz] verify sesion GET", verifyUrl.origin + verifyUrl.pathname + "?token=***");

  const headers: Record<string, string> = {
    Accept: "application/json, text/plain, */*",
    Authorization: `Bearer ${token}`,
    "X-Auth-Token": token,
    Origin: "https://app.moobiz.pe",
    Referer: "https://app.moobiz.pe/",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  };
  const mergedIn = existingCookieHeader.trim();
  if (mergedIn) headers.Cookie = mergedIn;

  const verifyRes = await fetch(verifyUrl.toString(), {
    method: "GET",
    headers,
    cache: "no-store",
  });

  const verifyText = await verifyRes.text();
  const verifyCt = verifyRes.headers.get("content-type") || "";
  console.log(
    "[Moobiz] verify status=",
    verifyRes.status,
    "content-type=",
    verifyCt,
    "preview=",
    verifyText.slice(0, 240),
  );

  if (!verifyRes.ok) {
    throw new Error(
      `MOOBIZ_LOGIN_FAILED: verify HTTP ${verifyRes.status} — ${verifyText.slice(0, 400)}`,
    );
  }

  if (verifyCt.toLowerCase().includes("application/json")) {
    try {
      const v = JSON.parse(verifyText) as { ok?: unknown; msg?: unknown };
      if (v.ok === false) {
        throw new Error(
          `MOOBIZ_LOGIN_FAILED: verify respondio ok=false — ${verifyText.slice(0, 400)}`,
        );
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("MOOBIZ_LOGIN_FAILED")) throw e;
    }
  }

  const fromVerify = extractCookieHeaderFromLoginResponse(verifyRes);
  if (fromVerify) {
    console.log("[Moobiz] verify Set-Cookie (pares):", fromVerify.slice(0, 200));
  }

  return mergeCookieHeaders(existingCookieHeader, fromVerify);
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

type FetchDispatcherXlsxOptions = {
  /** Cabecera Cookie opcional (p. ej. PHPSESSID del login o del .env). */
  cookieHeader?: string;
  /** Etiqueta solo para logs. */
  attemptLabel?: string;
};

async function fetchDispatcherXlsx(
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

  const label = options?.attemptLabel ?? "export";
  console.log(
    "[Moobiz] descarga XLSX",
    label,
    cookie ? "(con header Cookie)" : "(solo Bearer + X-Auth-Token)",
  );

  const exportRes = await fetch(DISPATCHER_URL, {
    method: "POST",
    headers,
    body: body.toString(),
    cache: "no-store",
  });
  console.log("[Moobiz] export status:", exportRes.status);
  console.log("[Moobiz] export content-type:", exportRes.headers.get("content-type"));
  const rawText = await exportRes.clone().text();
  console.log("[Moobiz] export preview:", rawText.slice(0, 500));

  if (!exportRes.ok) {
    const details = await exportRes.text();
    throw new Error(`MOOBIZ_EXPORT_FAILED: HTTP ${exportRes.status} — ${details.slice(0, 300)}`);
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

/** `null` = respuesta JSON `not_logged` del dispatcher. */
async function fetchDispatcherXlsxOrNotLogged(
  token: string,
  cookieHeader: string,
  attemptLabel: string,
): Promise<ArrayBuffer | null> {
  try {
    return await fetchDispatcherXlsx(token, {
      cookieHeader: cookieHeader || undefined,
      attemptLabel,
    });
  } catch (e) {
    if (e instanceof MoobizNotLoggedError) return null;
    throw e;
  }
}

async function resolveMoobizXlsxBuffer(): Promise<ArrayBuffer> {
  const moobizToken = getEnvTrimmed(["MOOBIZ_TOKEN"]);
  const moobizEmail = getEnvTrimmed(["MOOBIZ_EMAIL"]);
  const moobizPassword = getEnvTrimmed(["MOOBIZ_PASSWORD"]);
  const canAutoLogin = Boolean(moobizEmail && moobizPassword);
  const fallbackBearer = getMoobizFallbackBearerToken();

  let cookieHeader = buildMoobizCookieFromEnv();

  if (!moobizToken && !canAutoLogin) {
    throw new Error(
      "FALLA_CRITICA_MOOBIZ_LOGIN: falta MOOBIZ_TOKEN y no hay MOOBIZ_EMAIL/MOOBIZ_PASSWORD para login.",
    );
  }

  const tryFallback = async (reason: string): Promise<ArrayBuffer> => {
    if (!fallbackBearer.trim()) {
      throw new Error(`FALLA_CRITICA_MOOBIZ_LOGIN: ${reason} (sin MOOBIZ_FALLBACK_TOKEN).`);
    }
    console.log("[Moobiz] intento con token fallback de emergencia (MOOBIZ_FALLBACK_TOKEN / default)...");
    const buf = await fetchDispatcherXlsxOrNotLogged(
      fallbackBearer,
      cookieHeader,
      "C_fallback_emergency",
    );
    if (buf) return buf;
    throw new Error(
      `FALLA_CRITICA_MOOBIZ_LOGIN: ${reason} — dispatcher sigue en not_logged incluso con token fallback.`,
    );
  };

  if (!moobizToken) {
    console.log("[Moobiz] sin MOOBIZ_TOKEN; login automatico antes del primer export...");
    let newToken: string;
    try {
      const refreshed = await refreshMoobizToken();
      newToken = refreshed.token;
      cookieHeader = mergeCookieHeaders(cookieHeader, refreshed.cookieFromLogin);
    } catch (loginErr) {
      return tryFallback(
        `login inicial fallo: ${loginErr instanceof Error ? loginErr.message : String(loginErr)}`,
      );
    }
    const buf = await fetchDispatcherXlsxOrNotLogged(newToken, cookieHeader, "B_post_login_sin_token_env");
    if (buf) return buf;
    const bufFb = await fetchDispatcherXlsxOrNotLogged(fallbackBearer, cookieHeader, "C_fallback_tras_login");
    if (bufFb) return bufFb;
    throw new Error(
      "FALLA_CRITICA_MOOBIZ_LOGIN: not_logged tras login inicial, nuevo token y token fallback.",
    );
  }

  let bufA = await fetchDispatcherXlsxOrNotLogged(moobizToken, cookieHeader, "A_token_env");
  if (bufA) return bufA;

  if (!canAutoLogin) {
    const bufFb = await fetchDispatcherXlsxOrNotLogged(fallbackBearer, cookieHeader, "C_fallback_sin_login");
    if (bufFb) return bufFb;
    throw new Error(
      "FALLA_CRITICA_MOOBIZ_LOGIN: not_logged con MOOBIZ_TOKEN y sin credenciales de login; fallback tambien not_logged.",
    );
  }

  console.log(
    "Token expirado, iniciando sesión automática para FLO FELIX (ID 128140)...",
  );

  let newToken: string;
  try {
    const refreshed = await refreshMoobizToken();
    newToken = refreshed.token;
    cookieHeader = mergeCookieHeaders(cookieHeader, refreshed.cookieFromLogin);
  } catch (loginErr) {
    return tryFallback(
      `login automatico fallo: ${loginErr instanceof Error ? loginErr.message : String(loginErr)}`,
    );
  }

  const bufB = await fetchDispatcherXlsxOrNotLogged(newToken, cookieHeader, "B_post_login");
  if (bufB) return bufB;

  const bufC = await fetchDispatcherXlsxOrNotLogged(fallbackBearer, cookieHeader, "C_fallback_emergency");
  if (bufC) return bufC;

  throw new Error(
    "FALLA_CRITICA_MOOBIZ_LOGIN: not_logged tras login automatico, nuevo token y token fallback.",
  );
}

export async function GET(): Promise<Response> {
  try {
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
