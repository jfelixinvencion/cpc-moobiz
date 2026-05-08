export type RefreshGpsRawClientResult =
  | { ok: true; total: number; inserted: number; elapsed_ms?: number }
  | { ok: false; error: string };

export function parseRefreshGpsRawJson(body: unknown, httpOk: boolean): RefreshGpsRawClientResult {
  if (!body || typeof body !== "object") {
    return { ok: false, error: httpOk ? "Respuesta inválida" : "Error de red" };
  }
  const o = body as Record<string, unknown>;
  if (o.ok === true) {
    const total = typeof o.total === "number" && Number.isFinite(o.total) ? o.total : Number(o.total) || 0;
    const inserted =
      typeof o.inserted === "number" && Number.isFinite(o.inserted) ? o.inserted : Number(o.inserted) || 0;
    const elapsed_ms =
      typeof o.elapsed_ms === "number" && Number.isFinite(o.elapsed_ms) ? o.elapsed_ms : undefined;
    return { ok: true, total, inserted, elapsed_ms };
  }
  const errRaw = o.error;
  const err =
    typeof errRaw === "string" && errRaw.trim()
      ? errRaw.trim()
      : httpOk
        ? "Operación rechazada"
        : "Error HTTP";
  return { ok: false, error: err };
}

export async function postRefreshGpsRaw(fetchImpl: typeof fetch = fetch): Promise<RefreshGpsRawClientResult> {
  const res = await fetchImpl("/api/moobiz/refresh-gps-raw", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
  });
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = {};
  }
  return parseRefreshGpsRawJson(body, res.ok);
}

export async function runRefreshGpsRawAndRefetch(options: {
  fetchImpl?: typeof fetch;
  onSuccess?: () => void | Promise<void>;
} = {}): Promise<RefreshGpsRawClientResult> {
  const { fetchImpl = fetch, onSuccess } = options;
  const result = await postRefreshGpsRaw(fetchImpl);
  if (result.ok && onSuccess) await onSuccess();
  return result;
}

export function formatRefreshGpsToastSuccess(result: { inserted: number; total: number }): string {
  return `GPS actualizado: inserted ${result.inserted} / total ${result.total}`;
}
