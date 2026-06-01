import { NextRequest } from "next/server";

const SESSION_COOKIE = "auth_session";
const SESSION_VALUE = "authenticated";

/** Misma comprobación que `middleware.ts`: cookie httpOnly del login del panel. */
export function isPanelSessionAuthenticated(request: NextRequest): boolean {
  return request.cookies.get(SESSION_COOKIE)?.value === SESSION_VALUE;
}

/**
 * Lectura de auditorías: sesión del panel, o en desarrollo sin cookie (solo local).
 */
export function assertQualityReadAccess(request: NextRequest): void {
  if (isPanelSessionAuthenticated(request)) return;
  if (process.env.NODE_ENV === "development") return;
  throw new Error("AUTH_REQUIRED: Inicia sesión en el panel.");
}

/** Escritura / firmas: siempre requiere sesión del panel (igual que el resto de rutas protegidas). */
export function assertQualityWriteAccess(request: NextRequest): void {
  if (!isPanelSessionAuthenticated(request)) {
    throw new Error("AUTH_REQUIRED: Inicia sesión en el panel.");
  }
}

const DEFAULT_ACTOR_UUID = "00000000-0000-0000-0000-000000000001";

/** UUID para `auditor_id` / `created_by` cuando el login del panel no expone usuario Supabase. */
export function getQualityActorUserId(): string {
  const fromEnv = process.env.QUALITY_ACTOR_UUID?.trim();
  if (fromEnv && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(fromEnv)) {
    return fromEnv;
  }
  return DEFAULT_ACTOR_UUID;
}

export function getQualityActorDefaultName(): string {
  return (
    process.env.QUALITY_ACTOR_NAME?.trim() ||
    process.env.LOGIN_USERNAME?.trim() ||
    "Auditor"
  );
}

/** Actor para `created_by` en bolsas Clientes (misma sesión del panel). */
export function getClientBucketsActorLabel(): string {
  const name = getQualityActorDefaultName();
  const id = getQualityActorUserId();
  return `${name} (${id})`;
}
