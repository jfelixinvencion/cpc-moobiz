import { format, parse } from "date-fns";
import { es } from "date-fns/locale";

export type ServicesMoobizGranularity = "daily" | "monthly";

export type ServicesMoobizParsedParams = {
  granularity: ServicesMoobizGranularity;
  fromDate: string | null;
  toDate: string | null;
  estados: string[];
  creadosPor: string[];
  productos: string[];
  empresas: string[];
  sucursales: string[];
  conductorCategories: string[];
  months: string[];
};

const MAX_MULTI = 50;

function trimArr(arr: string[]): string[] {
  const out = arr.map((s) => s.trim()).filter(Boolean);
  return out.length > MAX_MULTI ? out.slice(0, MAX_MULTI) : out;
}

export function parseServicesMoobizParams(sp: URLSearchParams): ServicesMoobizParsedParams {
  const g = sp.get("granularity")?.trim().toLowerCase();
  const granularity: ServicesMoobizGranularity = g === "monthly" ? "monthly" : "daily";
  const fromDate = sp.get("from")?.trim() || null;
  const toDate = sp.get("to")?.trim() || null;

  const multi = (key: string) => trimArr(sp.getAll(key));

  return {
    granularity,
    fromDate: fromDate && /^\d{4}-\d{2}-\d{2}$/.test(fromDate) ? fromDate : null,
    toDate: toDate && /^\d{4}-\d{2}-\d{2}$/.test(toDate) ? toDate : null,
    estados: multi("estados"),
    creadosPor: multi("creados_por"),
    productos: multi("productos"),
    empresas: multi("empresas"),
    sucursales: multi("sucursal").filter((s) => s === "LIMA" || s === "PROVINCIA"),
    conductorCategories: multi("conductor_category").filter((s) =>
      ["APOYO LIMA", "APOYO PROVINCIA", "AFILIADO"].includes(s),
    ),
    months: multi("months").filter((m) => /^\d{4}-\d{2}$/.test(m)),
  };
}

export function ymToMmmYy(ym: string): string {
  const d = parse(`${ym}-01`, "yyyy-MM-dd", new Date());
  if (Number.isNaN(d.getTime())) return ym;
  return format(d, "MMM-yy", { locale: es })
    .replace(/\./g, "")
    .toLowerCase();
}
