/** Meta mínima para filtros BASE / NUEVOS (compartido Control + Seguimiento). */
export type ControlDriverFilterMeta = {
  fl_name?: string | null;
  fecha_activacion?: string | null;
};

export function normalizeConductorFilterKey(name: string): string {
  return name.trim().toLowerCase();
}

function parseFechaActivacionIsoToLocalDay(s: string): Date | null {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function parseFechaActivacionDdMmYyyy(raw: string): Date | null {
  if (!raw) return null;
  const s = String(raw).trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const d = new Date(yyyy, mm - 1, dd);
  if (d.getFullYear() !== yyyy || d.getMonth() !== mm - 1 || d.getDate() !== dd) return null;
  return d;
}

export function parseFechaActivacionLocalDay(raw: unknown): Date | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (s.includes("-")) return parseFechaActivacionIsoToLocalDay(s);
  if (s.includes("/")) return parseFechaActivacionDdMmYyyy(s);
  return null;
}

/** Filtro NUEVOS: activados en los últimos 8 días (hoy incluido). */
export function rowMatchesActivated8dFilter(
  row: Record<string, unknown>,
  activated8dEnabled: boolean,
): boolean {
  if (!activated8dEnabled) return true;

  const candidate =
    row.fecha_activacion ??
    row["fecha_activacion"] ??
    row["Fecha Activacion"] ??
    row["Fecha Activación"] ??
    null;

  const d = parseFechaActivacionLocalDay(candidate);
  if (!d) return false;

  const today = new Date();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const oldest = new Date(todayMidnight);
  oldest.setDate(oldest.getDate() - 7);

  return d.getTime() >= oldest.getTime() && d.getTime() <= todayMidnight.getTime();
}

/** Filtro BASE: fl_name contiene «moobiz» (case-insensitive). */
export function rowMatchesBaseFlNameFilter(
  row: ControlDriverFilterMeta,
  baseFilterEnabled: boolean,
): boolean {
  if (!baseFilterEnabled) return true;
  const v = row.fl_name;
  if (v === null || v === undefined) return false;
  const fl = String(v).trim().toLowerCase();
  if (!fl) return false;
  return fl.includes("moobiz");
}

export function driverMetaMatchesOperacionesFilters(
  meta: ControlDriverFilterMeta | undefined,
  baseFilterEnabled: boolean,
  activated8dEnabled: boolean,
): boolean {
  if (!baseFilterEnabled && !activated8dEnabled) return true;
  if (!meta) return false;
  const row = meta as Record<string, unknown>;
  if (!rowMatchesBaseFlNameFilter(meta, baseFilterEnabled)) return false;
  if (!rowMatchesActivated8dFilter(row, activated8dEnabled)) return false;
  return true;
}
