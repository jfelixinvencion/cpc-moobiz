export const SCHEDULE_OTHER_KEY = "OTROS" as const;

export const SCHEDULE_CRITICAL_PRODUCTS = [
  "BUS",
  "FURGON",
  "VAN",
  "SPRINTER",
  "LOGISTICA",
  "PROVINCIA VIP",
  "VIP LIMA",
] as const;

export const SCHEDULE_STACK_ORDER = [SCHEDULE_OTHER_KEY, ...SCHEDULE_CRITICAL_PRODUCTS] as const;
export const SCHEDULE_TOOLTIP_ORDER = [...SCHEDULE_CRITICAL_PRODUCTS, SCHEDULE_OTHER_KEY] as const;
export type ScheduleProductKey = (typeof SCHEDULE_STACK_ORDER)[number];

export const SCHEDULE_PRODUCT_COLORS: Record<ScheduleProductKey, string> = {
  OTROS: "#9ca3af",
  BUS: "#1d4ed8",
  FURGON: "#16a34a",
  VAN: "#f97316",
  SPRINTER: "#06b6d4",
  LOGISTICA: "#7c3aed",
  "PROVINCIA VIP": "#e11d48",
  "VIP LIMA": "#8E44AD",
};

export function normalizeProductoKey(value: unknown): string {
  return String(value ?? "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function scheduleBucketForProducto(value: unknown): ScheduleProductKey {
  const key = normalizeProductoKey(value);
  const compact = key.replace(/\s+/g, "");
  if (key === "VIP LIMA" || compact === "VIPLIMA" || key.includes("VIP LIMA")) {
    return "VIP LIMA";
  }
  if (key === "VIP" || key === "PROVINCIA VIP" || compact === "PROVINCIAVIP") {
    return "PROVINCIA VIP";
  }
  if ((SCHEDULE_CRITICAL_PRODUCTS as readonly string[]).includes(key)) {
    return key as ScheduleProductKey;
  }
  return SCHEDULE_OTHER_KEY;
}

export function canonicalViajeProducto(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const bucket = scheduleBucketForProducto(raw);
  if (bucket === SCHEDULE_OTHER_KEY) return raw;
  return bucket;
}

export function matchesProductFilter(productValue: unknown, filterValue: unknown): boolean {
  const rawFilter = String(filterValue ?? "").trim();
  if (!rawFilter) return true;
  return scheduleBucketForProducto(productValue) === scheduleBucketForProducto(rawFilter);
}
