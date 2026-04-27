/**
 * Autenticación Moobiz (server-only): login admin, token en `sync_state`, fetch con reintento en 401/403.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

const ADMIN_LOGIN_URL = "https://app.moobiz.pe/api/admin/login/login";
const SYNC_STATE_TOKEN_KEY = "moobiz_token";

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function getEnvTrimmed(keys: string[]): string | null {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}

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

function createServiceClient(): SupabaseClient {
  const url = getEnvTrimmed(["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]);
  const key = getEnvTrimmed(["SUPABASE_SERVICE_ROLE_KEY"]);
  if (!url || !key) {
    throw new Error(
      "moobiz-auth: faltan SUPABASE_URL (o NEXT_PUBLIC_SUPABASE_URL) o SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Token enmascarado para logs (nunca el valor completo). */
export function redactMoobizToken(token: string): string {
  const t = token.trim();
  if (t.length < 12) return `[token len=${t.length}]`;
  return `[${t.slice(0, 6)}…${t.slice(-4)}]`;
}

export async function readMoobizTokenFromDb(): Promise<string | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("sync_state")
    .select("value")
    .eq("key", SYNC_STATE_TOKEN_KEY)
    .maybeSingle();

  if (error) {
    console.warn("[moobiz-auth] lectura sync_state:", error.message);
    return null;
  }
  const v = data?.value;
  if (typeof v !== "string" || !v.trim()) return null;
  return v.trim();
}

export async function writeMoobizTokenToDb(token: string): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase.from("sync_state").upsert(
    { key: SYNC_STATE_TOKEN_KEY, value: token.trim() },
    { onConflict: "key" },
  );
  if (error) {
    throw new Error(`moobiz-auth: no se pudo guardar token en sync_state: ${error.message}`);
  }
}

/**
 * Login admin Moobiz (payload alineado con Network).
 * Devuelve token Bearer y cookies opcionales del `Set-Cookie`.
 */
export async function loginAndGetMoobizToken(): Promise<{
  token: string;
  cookieFromLogin: string;
}> {
  const username = getEnvTrimmed(["MOOBIZ_EMAIL"]);
  const password = getEnvTrimmed(["MOOBIZ_PASSWORD"]);
  if (!username || !password) {
    throw new Error("MOOBIZ_LOGIN_FAILED: faltan MOOBIZ_EMAIL o MOOBIZ_PASSWORD en entorno.");
  }

  const body = {
    username,
    password,
    uuid: randomUUID(),
    language: "es",
    os: "Windows",
    os_version: "10",
    device_brand: "Chrome",
    device_model: "147.0.0.0",
    app_version_code: 193,
    time_zone_offset: -5,
    user_agent: CHROME_UA,
    country_code: "US",
  };

  console.log(
    "[moobiz-auth] POST admin/login (usuario:",
    username.replace(/(^.).*(@.*)$/, "$1***$2"),
    ")",
  );

  const res = await fetch(ADMIN_LOGIN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Origin: "https://app.moobiz.pe",
      Referer: "https://app.moobiz.pe/",
      "User-Agent": CHROME_UA,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`MOOBIZ_LOGIN_FAILED: HTTP ${res.status} — ${text.slice(0, 400)}`);
  }

  let parsed: { ok?: unknown; token?: unknown; msg?: unknown };
  try {
    parsed = JSON.parse(text) as { ok?: unknown; token?: unknown; msg?: unknown };
  } catch {
    throw new Error(`MOOBIZ_LOGIN_FAILED: respuesta no JSON — ${text.slice(0, 300)}`);
  }

  if (parsed.ok !== true || typeof parsed.token !== "string" || !parsed.token.trim()) {
    const msg = typeof parsed.msg === "string" ? parsed.msg : "";
    throw new Error(
      `MOOBIZ_LOGIN_FAILED: login sin token valido${msg ? ` — ${msg}` : ""} — ${text.slice(0, 280)}`,
    );
  }

  const token = parsed.token.trim();
  const cookieFromLogin = extractCookieHeaderFromLoginResponse(res);
  console.log("[moobiz-auth] Login admin OK, token", redactMoobizToken(token));
  if (cookieFromLogin) {
    console.log("[moobiz-auth] Set-Cookie (preview):", cookieFromLogin.slice(0, 120) + (cookieFromLogin.length > 120 ? "…" : ""));
  }

  return { token, cookieFromLogin };
}

/**
 * Bearer para llamadas Moobiz: DB → env MOOBIZ_TOKEN (bootstrap a DB) → login admin.
 */
export async function getMoobizBearerForRequest(): Promise<string> {
  const fromDb = await readMoobizTokenFromDb();
  if (fromDb) return fromDb;

  const fromEnv = getEnvTrimmed(["MOOBIZ_TOKEN"]);
  if (fromEnv) {
    try {
      await writeMoobizTokenToDb(fromEnv);
      console.log("[moobiz-auth] Token inicial desde MOOBIZ_TOKEN (persistido en sync_state):", redactMoobizToken(fromEnv));
    } catch (e) {
      console.warn(
        "[moobiz-auth] No se pudo persistir MOOBIZ_TOKEN en DB (se usa en memoria para esta peticion):",
        e instanceof Error ? e.message : e,
      );
    }
    return fromEnv;
  }

  const { token } = await loginAndGetMoobizToken();
  await writeMoobizTokenToDb(token);
  return token;
}

function moobizJsonBodyLooksLikeAuthFailure(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const o = body as Record<string, unknown>;
  if (o.ok === true) return false;
  const msg = [o.msg, o.error].map((x) => (typeof x === "string" ? x : "")).join(" ");
  return /not_logged|not\s*authorized|unauthori|token\s*invalid|sesi[oó]n/i.test(msg);
}

/**
 * Respuesta Moobiz que exige renovar Bearer: HTTP 401/403 o JSON con `ok!=true` y mensaje de sesión (p. ej. `not_logged`).
 */
async function moobizResponseIndicatesAuthFailure(res: Response): Promise<boolean> {
  if (res.status === 401 || res.status === 403) return true;
  if (!res.ok || res.status !== 200) return false;
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("json")) return false;
  const text = await res.clone().text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    return false;
  }
  return moobizJsonBodyLooksLikeAuthFailure(parsed);
}

/**
 * Primer intento con `bearerToken` explícito (p. ej. `MOOBIZ_DRIVERS_TOKEN`); si falla auth, login + `sync_state` y un reintento.
 * Si el segundo intento sigue fallando auth, lanza mensaje fijo para `sync_monitor`.
 */
export async function moobizFetchWithToken(
  url: string | URL,
  init: RequestInit | undefined,
  bearerToken: string,
): Promise<Response> {
  const buildHeaders = (token: string) => {
    const h = new Headers(init?.headers);
    h.set("Authorization", `Bearer ${token}`);
    h.set("X-Auth-Token", token);
    return h;
  };

  let token = bearerToken.trim();
  let res = await fetch(url, {
    ...init,
    headers: buildHeaders(token),
    cache: init?.cache ?? "no-store",
  });

  if (await moobizResponseIndicatesAuthFailure(res)) {
    console.warn("[moobiz-auth] Auth inválida en Moobiz — moobizFetchWithToken: renovando vía login admin…");
    const { token: fresh } = await loginAndGetMoobizToken();
    await writeMoobizTokenToDb(fresh);
    token = fresh;
    res = await fetch(url, {
      ...init,
      headers: buildHeaders(token),
      cache: init?.cache ?? "no-store",
    });
    if (await moobizResponseIndicatesAuthFailure(res)) {
      throw new Error("Error 401 tras intento de renovación");
    }
    console.log("[moobiz-auth] Reintento OK (moobizFetchWithToken)", redactMoobizToken(token));
  }

  return res;
}

/**
 * Fetch a API Moobiz con Bearer + X-Auth-Token.
 * Si HTTP 401/403: login admin, guarda token, reintenta una vez.
 */
export async function moobizFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  let token = await getMoobizBearerForRequest();
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("X-Auth-Token", token);

  const doFetch = () =>
    fetch(url, {
      ...init,
      headers,
      cache: init?.cache ?? "no-store",
    });

  let res = await doFetch();
  if (res.status === 401 || res.status === 403) {
    console.warn("[moobiz-auth] HTTP", res.status, "— renovando token vía login admin…");
    const { token: fresh } = await loginAndGetMoobizToken();
    await writeMoobizTokenToDb(fresh);
    token = fresh;
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("X-Auth-Token", token);
    res = await doFetch();
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `MOOBIZ_AUTH: Moobiz respondio ${res.status} de nuevo tras renovar token (ver credenciales y permisos).`,
      );
    }
    console.log("[moobiz-auth] Reintento OK con token", redactMoobizToken(token));
  }
  return res;
}
