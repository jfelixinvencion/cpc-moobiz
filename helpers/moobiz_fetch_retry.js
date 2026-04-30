function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Reintenta fetch ante errores transitorios de red o HTTP 5xx.
 * - No reintenta 401/403 (auth/token).
 * - Backoff exponencial por defecto: 1s, 2s, 4s.
 */
async function fetchWithRetry(url, options = {}, cfg = {}) {
  const retries = Number.isFinite(cfg.retries) ? Number(cfg.retries) : 3;
  const backoffMs = Array.isArray(cfg.backoffMs) && cfg.backoffMs.length > 0
    ? cfg.backoffMs
    : [1000, 2000, 4000];
  const label = cfg.label || "moobiz-fetch";
  let attempt = 0;

  while (true) {
    try {
      const res = await fetch(url, options);

      // Auth se maneja en otra capa (refresh token).
      if (res.status === 401 || res.status === 403) return res;

      // 5xx: potencialmente transitorio.
      if (res.status >= 500 && attempt < retries) {
        const delay = backoffMs[Math.min(attempt, backoffMs.length - 1)];
        console.warn(
          `[${label}] HTTP ${res.status} (attempt ${attempt + 1}/${retries + 1}) -> retry in ${delay}ms`,
        );
        await sleep(delay);
        attempt += 1;
        continue;
      }

      return res;
    } catch (err) {
      if (attempt >= retries) throw err;
      const delay = backoffMs[Math.min(attempt, backoffMs.length - 1)];
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[${label}] network error (attempt ${attempt + 1}/${retries + 1}): ${msg} -> retry in ${delay}ms`,
      );
      await sleep(delay);
      attempt += 1;
    }
  }
}

module.exports = { fetchWithRetry };
