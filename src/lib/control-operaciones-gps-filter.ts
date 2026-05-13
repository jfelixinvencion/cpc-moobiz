export type DriverLiveAvailability = "online" | "busy" | "offline";

/** Etiquetas mostradas en la columna GPS de Control de operaciones. */
export const GPS_TABLE_LABEL_EN_LINEA = "En linea";
export const GPS_TABLE_LABEL_OCUPADO = "Ocupado";
/** Fila en vista con availability offline (sigue en el feed). */
export const GPS_TABLE_LABEL_RECIENTE = "Reciente";
/** Sin fila en vista.vw_driver_live_raw_flat para ese conductor (API envía null). */
export const GPS_TABLE_LABEL_DESCONECTADO = "Desconectado";

export const GPS_MULTI_OPTIONS: { value: string; label: string }[] = [
  { value: GPS_TABLE_LABEL_EN_LINEA, label: GPS_TABLE_LABEL_EN_LINEA },
  { value: GPS_TABLE_LABEL_OCUPADO, label: GPS_TABLE_LABEL_OCUPADO },
  { value: GPS_TABLE_LABEL_RECIENTE, label: GPS_TABLE_LABEL_RECIENTE },
  { value: GPS_TABLE_LABEL_DESCONECTADO, label: GPS_TABLE_LABEL_DESCONECTADO },
];

/**
 * Mapeo grilla Control operaciones: enum Moobiz/vista → etiqueta.
 * `null` = sin cruce en vista (desconectado); `offline` en vista → Reciente.
 */
export function gpsTableLabelFromAvailability(
  availability: DriverLiveAvailability | null | undefined,
): string {
  if (availability === null || availability === undefined) {
    return GPS_TABLE_LABEL_DESCONECTADO;
  }
  if (availability === "online") return GPS_TABLE_LABEL_EN_LINEA;
  if (availability === "busy") return GPS_TABLE_LABEL_OCUPADO;
  if (availability === "offline") return GPS_TABLE_LABEL_RECIENTE;
  return GPS_TABLE_LABEL_DESCONECTADO;
}

/**
 * Filtro multi GPS (OR): sin selección = mostrar todos; con selección = fila visible si su etiqueta está en la lista.
 */
export function rowMatchesGpsMultiFilter(selectedLabels: string[], rowVisibleGpsLabel: string): boolean {
  if (selectedLabels.length === 0) return true;
  return selectedLabels.includes(rowVisibleGpsLabel);
}

/**
 * URL del listado base; si hay filtros GPS, añade `gps=` repetido (para futuro filtrado server-side o telemetría).
 */
export function buildControlOperacionesFetchUrl(gpsFilter: string[]): string {
  const base = "/api/control-operaciones";
  const uniq = [...new Set(gpsFilter.map((s) => String(s).trim()).filter(Boolean))];
  if (uniq.length === 0) return base;
  const sp = new URLSearchParams();
  for (const g of uniq) sp.append("gps", g);
  return `${base}?${sp.toString()}`;
}
