import {
  PRODUCTIVIDAD_LOG_TYPES,
  type ProductividadLogType,
} from "./productividad-logs-params.ts";

export type UserChartRawRow = {
  us_name: string;
  type_log_name: string;
  cnt: number;
  buckets: number;
  total_per_user: number;
};

export type UserChartPivotRow = {
  us_name: string;
  total: number;
  total_per_user: number;
  totals: Record<ProductividadLogType, number>;
  buckets: Record<ProductividadLogType, number>;
  per_hour: Record<ProductividadLogType, number>;
} & Record<ProductividadLogType, number>;

export function perHourFromCntBuckets(cnt: number, buckets: number): number {
  if (buckets <= 0) return 0;
  return Math.round((cnt / buckets) * 100) / 100;
}

export function formatPerHour(cnt: number, buckets: number): string {
  if (buckets <= 0) return "-";
  return `${perHourFromCntBuckets(cnt, buckets).toFixed(2)}/h`;
}

/** Tipos visibles para ordenar; null/[]/todos → orden por total. */
export function resolveSortTypes(
  visibleTypes: Record<ProductividadLogType, boolean>,
): ProductividadLogType[] | null {
  const active = PRODUCTIVIDAD_LOG_TYPES.filter((t) => visibleTypes[t]);
  if (active.length === 0 || active.length === PRODUCTIVIDAD_LOG_TYPES.length) {
    return null;
  }
  return active;
}

export function sortMetricForRow(
  row: Pick<UserChartPivotRow, "total" | "totals">,
  sortTypes: ProductividadLogType[] | null,
): number {
  if (sortTypes == null || sortTypes.length === 0) {
    return row.total;
  }
  if (sortTypes.length === 1) {
    return row.totals[sortTypes[0]] ?? 0;
  }
  return sortTypes.reduce((acc, t) => acc + (row.totals[t] ?? 0), 0);
}

export function sortUserChartRows(
  rows: UserChartPivotRow[],
  visibleTypes: Record<ProductividadLogType, boolean>,
): UserChartPivotRow[] {
  const sortTypes = resolveSortTypes(visibleTypes);
  return [...rows].sort((a, b) => {
    const diff = sortMetricForRow(b, sortTypes) - sortMetricForRow(a, sortTypes);
    if (diff !== 0) return diff;
    return a.us_name.localeCompare(b.us_name, "es");
  });
}

function emptyTypeRecord(): Record<ProductividadLogType, number> {
  return Object.fromEntries(PRODUCTIVIDAD_LOG_TYPES.map((t) => [t, 0])) as Record<
    ProductividadLogType,
    number
  >;
}

export function pivotUserChartRows(rows: UserChartRawRow[]): UserChartPivotRow[] {
  const byUser = new Map<string, UserChartPivotRow>();

  for (const r of rows) {
    const name = r.us_name;
    let row = byUser.get(name);
    if (!row) {
      const totals = emptyTypeRecord();
      const buckets = emptyTypeRecord();
      const per_hour = emptyTypeRecord();
      row = {
        us_name: name,
        total: r.total_per_user,
        total_per_user: r.total_per_user,
        totals,
        buckets,
        per_hour,
        ...emptyTypeRecord(),
      };
      byUser.set(name, row);
    }
    const type = r.type_log_name as ProductividadLogType;
    if (!PRODUCTIVIDAD_LOG_TYPES.includes(type)) continue;
    row[type] = r.cnt;
    row.totals[type] = r.cnt;
    row.buckets[type] = r.buckets;
    row.per_hour[type] = perHourFromCntBuckets(r.cnt, r.buckets);
    row.total = r.total_per_user;
    row.total_per_user = r.total_per_user;
  }

  return Array.from(byUser.values());
}

export function pivotAndSortUserChartRows(
  rows: UserChartRawRow[],
  visibleTypes: Record<ProductividadLogType, boolean>,
): UserChartPivotRow[] {
  return sortUserChartRows(pivotUserChartRows(rows), visibleTypes);
}
