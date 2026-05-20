import { createClient } from "@supabase/supabase-js";

export const ID_SERVICIO_REGEX = /^\d{7}$/;
export const TURNOS = ["Mañana", "Tarde", "Noche"] as const;
export const FUENTES = ["Correo", "Llamada", "Whatsapp"] as const;
export const ESTADOS_REGISTRO = ["Pendiente", "En revision", "Completado"] as const;

export const MAX_FOTOS_REVISION = 5;
export const MAX_FOTO_BYTES = 5 * 1024 * 1024;
export const ALLOWED_FOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export const STORAGE_BUCKET =
  process.env.STORAGE_BUCKET?.trim() || "comercial-uploads";

export const MOOBIZ_SERVICE_URL = "https://app.moobiz.pe/services?id=";

export type ComercialTurno = (typeof TURNOS)[number];
export type ComercialFuente = (typeof FUENTES)[number];

export function getSupabaseAdmin() {
  const supabaseUrl =
    process.env.SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      "Faltan variables: SUPABASE_URL (o NEXT_PUBLIC_SUPABASE_URL) y SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function validateIdServicio(raw: unknown): string {
  const value = String(raw ?? "").trim();
  if (!ID_SERVICIO_REGEX.test(value)) {
    throw new Error("VALIDATION_ID: ID Servicio debe tener exactamente 7 dígitos.");
  }
  return value;
}

export function sanitizeTurno(raw: unknown): ComercialTurno {
  const value = String(raw ?? "").trim();
  if (!TURNOS.includes(value as ComercialTurno)) {
    throw new Error("VALIDATION_TURNO: Turno inválido.");
  }
  return value as ComercialTurno;
}

export function sanitizeFuente(raw: unknown): ComercialFuente {
  const value = String(raw ?? "").trim();
  if (!FUENTES.includes(value as ComercialFuente)) {
    throw new Error("VALIDATION_FUENTE: Fuente inválida.");
  }
  return value as ComercialFuente;
}

export function sanitizeRequiredText(raw: unknown, field: string, max = 8000): string {
  const value = String(raw ?? "").trim();
  if (!value) throw new Error(`VALIDATION_REQUIRED: ${field} es obligatorio.`);
  if (value.length > max) {
    throw new Error(`VALIDATION_LENGTH: ${field} supera ${max} caracteres.`);
  }
  return value;
}

export function sanitizeOptionalText(raw: unknown, max = 8000): string | null {
  if (raw === undefined || raw === null) return null;
  const value = String(raw).trim();
  if (!value) return null;
  if (value.length > max) throw new Error("VALIDATION_LENGTH: texto demasiado largo.");
  return value;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function sanitizeDateRequired(raw: unknown, field: string): string {
  const value = String(raw ?? "").trim();
  if (!ISO_DATE.test(value)) {
    throw new Error(`VALIDATION_DATE: ${field} debe ser YYYY-MM-DD.`);
  }
  return value;
}

export function sanitizeDateOptional(raw: unknown): string | null {
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  const value = String(raw).trim();
  if (!ISO_DATE.test(value)) {
    throw new Error("VALIDATION_DATE: fecha debe ser YYYY-MM-DD.");
  }
  return value;
}

export function derivePasajero(invitado: string | null, usuario: string | null): string | null {
  const inv = invitado?.trim();
  if (inv) return inv;
  const usr = usuario?.trim();
  return usr || null;
}

export function resolveEstadoOnUpdate(input: {
  acciones: string | null | undefined;
  updatingReview: boolean;
  previous: string;
}): string {
  const acciones = String(input.acciones ?? "").trim();
  if (acciones) return "Completado";
  if (input.updatingReview) return "En revision";
  return input.previous || "Pendiente";
}

export function sanitizeFotoUrls(raw: unknown, max = MAX_FOTOS_REVISION): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error("VALIDATION_FOTOS: fotos_urls debe ser arreglo.");
  const values = raw
    .map((v) => String(v ?? "").trim())
    .filter(Boolean)
    .filter((v) => !v.includes(".."));
  if (values.length > max) {
    throw new Error(`VALIDATION_FOTOS: máximo ${max} fotos.`);
  }
  return values;
}

export function sanitizeFileName(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function apiStatusFromMessage(message: string): number {
  if (message.startsWith("AUTH_REQUIRED")) return 401;
  if (message.startsWith("NOT_FOUND")) return 404;
  if (
    message.startsWith("VALIDATION_") ||
    message.startsWith("VALIDATION_ID") ||
    message.startsWith("VALIDATION_REQUIRED")
  ) {
    return 400;
  }
  return 500;
}
