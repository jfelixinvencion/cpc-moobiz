const { randomUUID, createHash } = require("node:crypto");
const { Client } = require("pg");

const ADMIN_LOGIN_URL = "https://app.moobiz.pe/api/admin/login/login";
const TOKEN_KEY = "moobiz_token";
const TOKEN_EXPIRES_KEY = "moobiz_token_expires_at";
const LOCK_NAME = "moobiz_token_refresh";
const WAIT_RETRIES = 10;
const WAIT_MS = 500;
const TOKEN_SKEW_SECONDS = 60;
const DEFAULT_EXPIRES_IN_SECONDS = 55 * 60;

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function redactToken(token) {
  const t = String(token ?? "").trim();
  if (!t) return "(empty)";
  return `${t.slice(0, 6)}...`;
}

function advisoryLockParts(name) {
  const digest = createHash("sha256").update(name).digest();
  const k1 = digest.readInt32BE(0);
  const k2 = digest.readInt32BE(4);
  return [k1, k2];
}

function parseIsoDate(value) {
  if (!value) return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function isTokenStillValid(token, expiresAt) {
  if (!token) return false;
  const exp = parseIsoDate(expiresAt);
  if (!exp) return false;
  return exp.getTime() > Date.now() + TOKEN_SKEW_SECONDS * 1000;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getSyncStateToken(client) {
  const { rows } = await client.query(
    `SELECT key, value FROM public.sync_state WHERE key = ANY($1::text[])`,
    [[TOKEN_KEY, TOKEN_EXPIRES_KEY]],
  );
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    token: typeof map[TOKEN_KEY] === "string" ? map[TOKEN_KEY].trim() : "",
    expiresAt:
      typeof map[TOKEN_EXPIRES_KEY] === "string" ? map[TOKEN_EXPIRES_KEY].trim() : "",
  };
}

function inferExpiresAt(loginBody) {
  if (typeof loginBody.expires_at === "string" && loginBody.expires_at.trim()) {
    return new Date(loginBody.expires_at).toISOString();
  }
  if (Number.isFinite(loginBody.expires_in)) {
    return new Date(Date.now() + Number(loginBody.expires_in) * 1000).toISOString();
  }
  return new Date(Date.now() + DEFAULT_EXPIRES_IN_SECONDS * 1000).toISOString();
}

async function insertTokenRefreshMonitor(client, payload) {
  await client.query(
    `INSERT INTO public.sync_monitor
      (action, status, reason_for_stop, error_message, records_procesados, records_inserted, pages_queried, last_id)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      "token_refresh",
      payload.status,
      payload.reasonForStop,
      payload.errorMessage ?? null,
      0,
      0,
      0,
      "moobiz_token",
    ],
  );
}

async function moobizAdminLogin() {
  const username = String(process.env.MOOBIZ_EMAIL ?? "").trim();
  const password = String(process.env.MOOBIZ_PASSWORD ?? "").trim();
  if (!username || !password) {
    throw new Error("Faltan MOOBIZ_EMAIL o MOOBIZ_PASSWORD para refresh de token.");
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
    throw new Error(`MOOBIZ_LOGIN_FAILED: HTTP ${res.status} — ${text.slice(0, 350)}`);
  }
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`MOOBIZ_LOGIN_FAILED: respuesta no JSON — ${text.slice(0, 250)}`);
  }
  if (parsed.ok !== true || typeof parsed.token !== "string" || !parsed.token.trim()) {
    throw new Error("MOOBIZ_LOGIN_FAILED: respuesta sin token válido.");
  }
  return {
    token: parsed.token.trim(),
    expiresAt: inferExpiresAt(parsed),
  };
}

async function ensureMoobizToken() {
  const databaseUrl = String(process.env.DATABASE_URL ?? "").trim();
  if (!databaseUrl) throw new Error("DATABASE_URL es requerido para refresh atómico de token.");

  const client = new Client({ connectionString: databaseUrl });
  const [lockK1, lockK2] = advisoryLockParts(LOCK_NAME);
  await client.connect();

  try {
    const current = await getSyncStateToken(client);
    if (isTokenStillValid(current.token, current.expiresAt)) {
      console.log(
        `[token-refresh] token vigente en sync_state (${redactToken(current.token)}) exp=${current.expiresAt}`,
      );
      return current.token;
    }

    const lockRes = await client.query(
      "SELECT pg_try_advisory_lock($1::int, $2::int) AS locked",
      [lockK1, lockK2],
    );
    const locked = Boolean(lockRes.rows[0]?.locked);

    if (!locked) {
      console.log("[token-refresh] lock ocupado; esperando token renovado...");
      for (let i = 0; i < WAIT_RETRIES; i += 1) {
        await sleep(WAIT_MS);
        const retryState = await getSyncStateToken(client);
        if (isTokenStillValid(retryState.token, retryState.expiresAt)) {
          console.log(
            `[token-refresh] token detectado tras espera (${redactToken(retryState.token)})`,
          );
          return retryState.token;
        }
      }
      throw new Error("TOKEN_REFRESH_TIMEOUT: no llegó token renovado tras esperar lock.");
    }

    try {
      const recheck = await getSyncStateToken(client);
      if (isTokenStillValid(recheck.token, recheck.expiresAt)) {
        console.log(
          `[token-refresh] lock obtenido pero token ya renovado (${redactToken(recheck.token)})`,
        );
        return recheck.token;
      }

      console.log("[token-refresh] lock obtenido, ejecutando login admin...");
      const fresh = await moobizAdminLogin();

      await client.query("BEGIN");
      await client.query(
        `INSERT INTO public.sync_state(key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [TOKEN_KEY, fresh.token],
      );
      await client.query(
        `INSERT INTO public.sync_state(key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [TOKEN_EXPIRES_KEY, fresh.expiresAt],
      );
      await insertTokenRefreshMonitor(client, {
        status: "success",
        reasonForStop: "token_refresh_ok",
      });
      await client.query("COMMIT");

      console.log(
        `[token-refresh] refresh OK token=${redactToken(fresh.token)} exp=${fresh.expiresAt}`,
      );
      return fresh.token;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      const msg = err instanceof Error ? err.message : String(err);
      await insertTokenRefreshMonitor(client, {
        status: "error",
        reasonForStop: "token_refresh_failed",
        errorMessage: msg.slice(0, 500),
      }).catch(() => {});
      throw err;
    } finally {
      await client.query("SELECT pg_advisory_unlock($1::int, $2::int)", [lockK1, lockK2]);
    }
  } finally {
    await client.end();
  }
}

module.exports = { ensureMoobizToken, redactToken };
