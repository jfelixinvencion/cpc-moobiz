/**
 * PostgREST / Supabase suelen devolver errores como objetos `{ message, details, hint, code }`
 * que no son `instanceof Error`, y `String(obj)` resulta en "[object Object]".
 */
export function formatApiError(err: unknown): string {
  if (err === undefined || err === null) return "Error desconocido";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const o = err as Record<string, unknown>;
    const msg = typeof o.message === "string" ? o.message : "";
    const details = typeof o.details === "string" ? o.details : "";
    const hint = typeof o.hint === "string" ? o.hint : "";
    const code = typeof o.code === "string" ? o.code : "";
    const parts = [msg, details, hint, code ? `[${code}]` : ""].filter(Boolean);
    if (parts.length) return parts.join(" — ");
  }
  try {
    const s = JSON.stringify(err);
    if (typeof s === "string") return s;
  } catch {
    /* ignore */
  }
  return "Error desconocido";
}

/** Mensaje legible desde el campo `error` de un JSON de respuesta API. */
export function formatErrorFromPayload(error: unknown): string | undefined {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const m = (error as { message: unknown }).message;
    if (typeof m === "string") return m;
  }
  return undefined;
}
