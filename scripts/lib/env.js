const { createClient } = require("@supabase/supabase-js");

function getSupabaseUrl() {
  return process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
}

function ensureEnv(required = []) {
  const missing = required.filter((key) => !String(process.env[key] || "").trim());
  if (missing.length === 0) return;

  console.error("[env-check] Missing env vars:", missing.join(", "));
  const critical = missing.filter((key) => key !== "MOOBIZ_TOKEN");
  if (critical.length > 0) {
    process.exit(2);
  }
}

function normalizeSyncStateTokenValue(value) {
  if (typeof value === "string") {
    const direct = value.trim();
    if (!direct) return null;
    try {
      const parsed = JSON.parse(direct);
      if (typeof parsed === "string") return parsed.trim() || null;
      if (parsed && typeof parsed === "object" && typeof parsed.token === "string") {
        return parsed.token.trim() || null;
      }
      return direct;
    } catch {
      return direct;
    }
  }

  if (value && typeof value === "object") {
    if (typeof value.token === "string") return value.token.trim() || null;
    const json = JSON.stringify(value);
    return json || null;
  }

  return null;
}

async function readMoobizTokenFromSupabaseSyncState() {
  const supabaseUrl = getSupabaseUrl();
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!supabaseUrl || !serviceRoleKey) {
    console.warn(
      "[token-fallback] no se puede leer sync_state: falta SUPABASE_URL (o NEXT_PUBLIC_SUPABASE_URL) o SUPABASE_SERVICE_ROLE_KEY.",
    );
    return null;
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  try {
    const { data, error } = await supabase
      .from("sync_state")
      .select("value, updated_at")
      .eq("key", "moobiz_token")
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn("[token-fallback] error leyendo sync_state:", error.message || error);
      return null;
    }
    const token = normalizeSyncStateTokenValue(data?.value);
    if (token) {
      console.log(
        `[token-fallback] token recuperado desde sync_state (updated_at=${data?.updated_at || "unknown"})`,
      );
      return token;
    }
    return null;
  } catch (err) {
    console.warn("[token-fallback] error inesperado:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

async function getMoobizTokenFallback() {
  const fromEnv = String(process.env.MOOBIZ_TOKEN || "").trim();
  if (fromEnv) {
    console.log("[token-fallback] usando MOOBIZ_TOKEN desde env");
    return fromEnv;
  }

  return readMoobizTokenFromSupabaseSyncState();
}

/** Siempre lee `moobiz_token` en Supabase (ignora MOOBIZ_TOKEN en env). Útil tras 401 si el env está obsoleto. */
async function getMoobizTokenFromSyncStateOnly() {
  return readMoobizTokenFromSupabaseSyncState();
}

module.exports = {
  ensureEnv,
  getMoobizTokenFallback,
  getMoobizTokenFromSyncStateOnly,
  getSupabaseUrl,
};
