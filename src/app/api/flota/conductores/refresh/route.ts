import { NextRequest } from "next/server";

import { flotaError, flotaJson } from "@/lib/flota-api";
import { getMoobizViewsPool } from "@/lib/pg-moobiz-dashboard-pool";
import { assertQualityReadAccess } from "@/lib/panel-session";

export const runtime = "nodejs";
/** Hasta 5 minutos (Vercel / entornos que respeten maxDuration). */
export const maxDuration = 300;

const REFRESH_LOCK_KEY = 2147483647;
const STATEMENT_TIMEOUT_MS = 300_000;

const MATERIALIZED_VIEWS = ["reportes.mv_conductores", "reportes.semaforo"] as const;

type RefreshResult = {
  view: string;
  method: "CONCURRENTLY" | "NON_CONCURRENT";
  ok: true;
};

function log(level: "info" | "warn" | "error", message: string, extra?: Record<string, unknown>): void {
  const payload = { ts: new Date().toISOString(), ...extra };
  const line = `[flota-conductores-refresh] ${message}`;
  if (level === "error") console.error(line, payload);
  else if (level === "warn") console.warn(line, payload);
  else console.log(line, payload);
}

function auditActor(): string {
  return (
    process.env.QUALITY_ACTOR_NAME?.trim() ||
    process.env.LOGIN_USERNAME?.trim() ||
    "panel-user"
  );
}

function isAuthError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("AUTH_REQUIRED");
}

async function tryAdvisoryLock(pool: ReturnType<typeof getMoobizViewsPool>): Promise<boolean> {
  const { rows } = await pool.query<{ got_lock: boolean }>(
    "SELECT pg_try_advisory_lock($1::bigint) AS got_lock",
    [REFRESH_LOCK_KEY],
  );
  return Boolean(rows[0]?.got_lock);
}

async function advisoryUnlock(pool: ReturnType<typeof getMoobizViewsPool>): Promise<void> {
  try {
    await pool.query("SELECT pg_advisory_unlock($1::bigint)", [REFRESH_LOCK_KEY]);
  } catch (e) {
    log("warn", "advisory_unlock failed", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

async function refreshMaterializedView(
  pool: ReturnType<typeof getMoobizViewsPool>,
  viewName: (typeof MATERIALIZED_VIEWS)[number],
): Promise<RefreshResult> {
  try {
    await pool.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${viewName}`);
    log("info", "refresh ok CONCURRENTLY", { view: viewName });
    return { view: viewName, method: "CONCURRENTLY", ok: true };
  } catch (err) {
    log("warn", "CONCURRENTLY failed, fallback to blocking refresh", {
      view: viewName,
      error: err instanceof Error ? err.message : String(err),
    });
    await pool.query(`REFRESH MATERIALIZED VIEW ${viewName}`);
    log("info", "refresh ok NON_CONCURRENT", { view: viewName });
    return { view: viewName, method: "NON_CONCURRENT", ok: true };
  }
}

export async function POST(req: NextRequest) {
  const actor = auditActor();
  let pool: ReturnType<typeof getMoobizViewsPool> | null = null;
  let locked = false;

  try {
    assertQualityReadAccess(req);
    pool = getMoobizViewsPool();

    log("info", "refresh requested", { actor });

    await pool.query(`SET statement_timeout = ${STATEMENT_TIMEOUT_MS}`);

    const gotLock = await tryAdvisoryLock(pool);
    if (!gotLock) {
      log("warn", "refresh rejected: lock held", { actor });
      return flotaError("Refresh already running", 409);
    }
    locked = true;

    await pool.query("SELECT 1");

    const results: RefreshResult[] = [];
    for (const viewName of MATERIALIZED_VIEWS) {
      results.push(await refreshMaterializedView(pool, viewName));
    }

    log("info", "refresh completed", { actor, results });
    return flotaJson({ ok: true, results });
  } catch (err) {
    if (isAuthError(err)) {
      return flotaError("Unauthorized", 401);
    }
    log("error", "refresh failed", {
      actor,
      error: err instanceof Error ? err.message : String(err),
    });
    return flotaError("Failed to refresh materialized views", 500);
  } finally {
    if (pool && locked) {
      await advisoryUnlock(pool);
    }
  }
}
