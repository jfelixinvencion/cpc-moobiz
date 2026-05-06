export function normalizeConductorName(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/** Texto del parámetro `query` en Moobiz live/vehicles: sin tildes ni caracteres especiales. */
export function normalizeMoobizLiveSearchQuery(raw: string): string {
  return String(raw ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isGpsOff(value: unknown): boolean {
  const v = String(value ?? "")
    .trim()
    .toLowerCase();
  return v === "false" || v === "apagado" || v === "0";
}
