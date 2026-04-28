export function normalizeConductorName(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

export function isGpsOff(value: unknown): boolean {
  const v = String(value ?? "")
    .trim()
    .toLowerCase();
  return v === "false" || v === "apagado" || v === "0";
}
