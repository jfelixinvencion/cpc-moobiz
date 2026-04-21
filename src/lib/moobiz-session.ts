/**
 * Sesión Moobiz: login, verify, cookies y descarga XLSX vía dispatcher.
 * Compartible por rutas API (p. ej. actividades) sin importar `route.ts` de extract.
 */

const DISPATCHER_URL = "https://app.moobiz.pe/api/admin/dispatcher";
const DEFAULT_MOOBIZ_LOGIN_URL = "https://app.moobiz.pe/api/login";
const DEFAULT_MOOBIZ_VERIFY_URL = "https://app.moobiz.pe/api/verify";
const DEFAULT_MOOBIZ_FALLBACK_BEARER = "1a7271369ba2dfa7efcc2195f55272d1";

export class MoobizNotLoggedError extends Error {
  readonly code = "MOOBIZ_NOT_LOGGED" as const;
  constructor(readonly preview: string) {
    super("Moobiz not_logged");
    this.name = "MoobizNotLoggedError";
  }
}

export function getEnvTrimmed(keys: string[]): string | null {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}

export function buildMoobizCookieFromEnv(): string {
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

export function mergeCookieHeaders(...segments: (string | null | undefined)[]): string {
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

export function getMoobizFallbackBearerToken(): string {
  return (
    getEnvTrimmed(["MOOBIZ_FALLBACK_TOKEN", "MOOBIZ_EMERGENCY_TOKEN"]) ?? DEFAULT_MOOBIZ_FALLBACK_BEARER
  );
}

export async function refreshMoobizToken(): Promise<{ token: string; cookieFromLogin: string }> {
  const user = getEnvTrimmed(["MOOBIZ_EMAIL"]);
  const pass = getEnvTrimmed(["MOOBIZ_PASSWORD"]);
  if (!user || !pass) {
    throw new Error("MOOBIZ_LOGIN_FAILED: faltan MOOBIZ_EMAIL o MOOBIZ_PASSWORD en entorno.");
  }

  const loginUrl = getEnvTrimmed(["MOOBIZ_LOGIN_URL"]) ?? DEFAULT_MOOBIZ_LOGIN_URL;

  console.log(
    "[moobiz-session] POST login",
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
    "[moobiz-session] login status=",
    loginRes.status,
    "content-type=",
    loginCt,
    "preview=",
    loginText.slice(0, 240),
  );

  if (!loginRes.ok) {
    throw new Error(`MOOBIZ_LOGIN_FAILED: HTTP ${loginRes.status} — ${loginText.slice(0, 400)}`);
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
    parsed = JSON.parse(loginText) as typeof parsed;
  } catch {
    throw new Error(`MOOBIZ_LOGIN_FAILED: respuesta no JSON — ${loginText.slice(0, 300)}`);
  }

  if (parsed.ok !== true || typeof parsed.token !== "string" || !parsed.token.trim()) {
    throw new Error(
      `MOOBIZ_LOGIN_FAILED: JSON sin token valido — ${JSON.stringify(parsed).slice(0, 500)}`,
    );
  }

  const token = parsed.token.trim();
  let cookieFromLogin = extractCookieHeaderFromLoginResponse(loginRes);
  if (cookieFromLogin) {
    console.log("[moobiz-session] login Set-Cookie (pares):", cookieFromLogin.slice(0, 200));
  } else {
    console.log("[moobiz-session] login sin Set-Cookie parseable.");
  }

  try {
    cookieFromLogin = await fetchMoobizVerifyAndMergeCookies(token, cookieFromLogin);
  } catch (verifyErr) {
    console.warn(
      "[moobiz-session] verify opcional fallo (se continua con token de login):",
      verifyErr instanceof Error ? verifyErr.message : verifyErr,
    );
  }

  return { token, cookieFromLogin };
}

async function fetchMoobizVerifyAndMergeCookies(
  token: string,
  existingCookieHeader: string,
): Promise<string> {
  const rawBase = getEnvTrimmed(["MOOBIZ_VERIFY_URL"]);
  const verifyUrl = rawBase ? new URL(rawBase) : new URL(DEFAULT_MOOBIZ_VERIFY_URL);
  verifyUrl.searchParams.set("token", token);

  console.log("[moobiz-session] verify GET", verifyUrl.origin + verifyUrl.pathname + "?token=***");

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
    "[moobiz-session] verify status=",
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
    console.log("[moobiz-session] verify Set-Cookie (pares):", fromVerify.slice(0, 200));
  }

  return mergeCookieHeaders(existingCookieHeader, fromVerify);
}

type FetchDispatcherXlsxOptions = {
  cookieHeader?: string;
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
    "[moobiz-session] dispatcher XLSX",
    label,
    cookie ? "(con Cookie)" : "(solo Bearer + X-Auth-Token)",
  );

  const exportRes = await fetch(DISPATCHER_URL, {
    method: "POST",
    headers,
    body: body.toString(),
    cache: "no-store",
  });
  const rawText = await exportRes.clone().text();
  console.log("[moobiz-session]", label, "status=", exportRes.status, "ct=", exportRes.headers.get("content-type"));
  console.log("[moobiz-session]", label, "preview=", rawText.slice(0, 280));

  if (!exportRes.ok) {
    throw new Error(`Dispatcher HTTP ${exportRes.status} — ${rawText.slice(0, 300)}`);
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
      throw new Error(`respuesta JSON sin Excel — ${detail}`);
    } catch (e) {
      if (e instanceof MoobizNotLoggedError) throw e;
      if (e instanceof Error && e.message.startsWith("respuesta JSON")) throw e;
      throw new Error(`respuesta no XLSX — ${rawText.slice(0, 200)}`);
    }
  }

  return exportRes.arrayBuffer();
}

export async function fetchDispatcherXlsxOrNotLogged(
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

/**
 * Intenta `MOOBIZ_LOGS_TOKEN`, luego `MOOBIZ_TOKEN`; ante not_logged hace login y reintenta.
 */
export async function resolveActivityDispatcherXlsx(): Promise<{
  buffer: ArrayBuffer;
  sessionRenewed: boolean;
}> {
  let cookieHeader = buildMoobizCookieFromEnv();
  const logsToken = getEnvTrimmed(["MOOBIZ_LOGS_TOKEN"]);
  const moobizToken = getEnvTrimmed(["MOOBIZ_TOKEN"]);
  const canAutoLogin = Boolean(getEnvTrimmed(["MOOBIZ_EMAIL"]) && getEnvTrimmed(["MOOBIZ_PASSWORD"]));
  const fallbackBearer = getMoobizFallbackBearerToken();

  let sessionRenewed = false;

  const tryFetch = (token: string, label: string) =>
    fetchDispatcherXlsxOrNotLogged(token, cookieHeader, label);

  const primaryTokens: { t: string; label: string }[] = [];
  if (logsToken) primaryTokens.push({ t: logsToken, label: "A_MOOBIZ_LOGS_TOKEN" });
  if (moobizToken && moobizToken !== logsToken) {
    primaryTokens.push({ t: moobizToken, label: "A_MOOBIZ_TOKEN" });
  } else if (!logsToken && moobizToken) {
    primaryTokens.push({ t: moobizToken, label: "A_MOOBIZ_TOKEN" });
  }

  for (const { t, label } of primaryTokens) {
    const buf = await tryFetch(t, label);
    if (buf) return { buffer: buf, sessionRenewed };
  }

  if (primaryTokens.length === 0) {
    if (!canAutoLogin) {
      throw new Error(
        "Falta MOOBIZ_LOGS_TOKEN / MOOBIZ_TOKEN y no hay MOOBIZ_EMAIL/MOOBIZ_PASSWORD para login automatico.",
      );
    }
    const refreshed = await refreshMoobizToken();
    sessionRenewed = true;
    cookieHeader = mergeCookieHeaders(cookieHeader, refreshed.cookieFromLogin);
    const buf = await tryFetch(refreshed.token, "B_post_login_sin_token_previo");
    if (buf) return { buffer: buf, sessionRenewed };
    const bufFb = await tryFetch(fallbackBearer, "C_fallback_tras_login_sin_token");
    if (bufFb) return { buffer: bufFb, sessionRenewed };
    throw new Error(
      "not_logged tras login inicial: el dispatcher no acepto el nuevo token ni el fallback.",
    );
  }

  if (!canAutoLogin) {
    const bufFb = await tryFetch(fallbackBearer, "C_fallback_sin_credenciales_login");
    if (bufFb) return { buffer: bufFb, sessionRenewed: false };
    throw new Error(
      "Sesion Moobiz invalida (not_logged) con los tokens configurados; no hay MOOBIZ_EMAIL/MOOBIZ_PASSWORD para renovar.",
    );
  }

  console.log("[moobiz-session] tokens en env devolvieron not_logged; auto-login y reintento…");
  const refreshed = await refreshMoobizToken();
  sessionRenewed = true;
  cookieHeader = mergeCookieHeaders(cookieHeader, refreshed.cookieFromLogin);

  const bufAfterLogin = await tryFetch(refreshed.token, "B_post_login");
  if (bufAfterLogin) return { buffer: bufAfterLogin, sessionRenewed };

  const bufFb = await tryFetch(fallbackBearer, "C_fallback_post_login");
  if (bufFb) return { buffer: bufFb, sessionRenewed };

  throw new Error(
    "not_logged tras auto-login: el dispatcher no acepto el token renovado ni el fallback.",
  );
}
