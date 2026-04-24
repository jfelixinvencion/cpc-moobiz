import { createClient } from "@supabase/supabase-js";

export const QUALITY_STATUSES = ["draft", "submitted", "reviewed"] as const;
export const QUALITY_RESULTS = ["Aprobado", "Condicional", "Rechazado"] as const;
export const CHECK_ANSWER = ["yes", "no", "na"] as const;
export const MAX_PHOTOS = 9;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const ALLOWED_PHOTO_TYPES = ["image/jpeg", "image/png"];

export type QualityStatus = (typeof QUALITY_STATUSES)[number];
export type QualityResult = (typeof QUALITY_RESULTS)[number];
export type ChecklistAnswer = (typeof CHECK_ANSWER)[number];

export type ChecklistItemValue = {
  answer: ChecklistAnswer;
  comment?: string | null;
};

export type QualityChecklist = Record<string, ChecklistItemValue>;

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

export function normalizeStatus(raw: unknown): QualityStatus {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "submitted" || value === "reviewed") return value;
  return "draft";
}

export function sanitizeChecklist(raw: unknown): QualityChecklist {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("CHECKLIST_INVALID: checklist debe ser un objeto.");
  }
  const out: QualityChecklist = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!value || typeof value !== "object") continue;
    const answer = String((value as { answer?: string }).answer ?? "").toLowerCase();
    if (!CHECK_ANSWER.includes(answer as ChecklistAnswer)) {
      throw new Error(`CHECKLIST_INVALID: respuesta inválida para item ${key}.`);
    }
    const rawComment = (value as { comment?: string | null }).comment ?? null;
    const comment = rawComment === null ? null : String(rawComment);
    if (comment !== null && comment.length > 140) {
      throw new Error(`CHECKLIST_INVALID: comentario supera 140 chars en item ${key}.`);
    }
    out[key] = { answer: answer as ChecklistAnswer, comment };
  }
  return out;
}

export function sanitizePhotoPaths(raw: unknown, required = false): string[] {
  if (raw === undefined || raw === null) {
    if (!required) return [];
    throw new Error("PHOTOS_REQUIRED: Debes adjuntar al menos 1 foto.");
  }
  if (!Array.isArray(raw)) throw new Error("PHOTOS_INVALID: foto_paths debe ser arreglo.");
  const values = raw
    .map((v) => String(v ?? "").trim())
    .filter(Boolean)
    .filter((v) => !v.includes(".."));
  if (values.length < (required ? 1 : 0) || values.length > MAX_PHOTOS) {
    throw new Error("PHOTOS_INVALID: foto_paths debe contener entre 1 y 9 elementos.");
  }
  return values;
}

export function sanitizeDriverId(raw: unknown): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  if (!/^\d{1,6}$/.test(value)) {
    throw new Error("DRIVER_ID_INVALID: Driver ID debe tener solo números y máximo 6 dígitos.");
  }
  return value;
}
