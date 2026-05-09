import { isGpsOff } from "@/lib/gps-filter";

export type ControlDriverExcelRow = {
  id_conductor: string;
  nombre_conductor: string;
  distrito_vive: string;
  turno: string;
  global: string;
  /** Aprobado | Rechazado | Nuevo (resto / pendiente). */
  estado_conductor: "Aprobado" | "Rechazado" | "Nuevo";
  /** Encendido | Apagado desde columna Online o GPS. */
  gps_label: "Encendido" | "Apagado";
};

function pickText(row: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (s.length) return s;
  }
  return "";
}

export function mapExcelRowToControlDriver(row: Record<string, unknown>): ControlDriverExcelRow | null {
  const id_conductor = pickText(row, ["ID Conductor", "id_conductor"]);
  if (!id_conductor) return null;
  const nombre_conductor = pickText(row, ["Nombre Conductor", "nombre_conductor"]);
  const distrito_vive = pickText(row, ["En que distrito vive", "distrito_vive"]);
  const turno = pickText(row, ["Turno", "turno"]);
  const global = pickText(row, ["global_col", "GLOBAL", "global"]).toUpperCase();

  const estadoRaw = pickText(row, [
    "estado_conductor_col",
    "Estado Conductor",
    "estado_conductor",
    "status_col",
    "Status",
    "estado",
    "Estado",
    "status",
  ]);
  const el = estadoRaw.toLowerCase();
  let estado_conductor: ControlDriverExcelRow["estado_conductor"] = "Nuevo";
  if (el.includes("aprob")) estado_conductor = "Aprobado";
  else if (el.includes("rechaz")) estado_conductor = "Rechazado";

  const onlineRaw =
    row["online_col"] ??
    row["gps_col"] ??
    row["Online"] ??
    row["online"] ??
    row["GPS"] ??
    row["gps"] ??
    row["Gps"] ??
    null;
  const gps_label: "Encendido" | "Apagado" = isGpsOff(onlineRaw) ? "Apagado" : "Encendido";

  return {
    id_conductor,
    nombre_conductor,
    distrito_vive,
    turno,
    global,
    estado_conductor,
    gps_label,
  };
}

export function semaforoSwatch(semaforo: string | null | undefined): { className: string; label: string } {
  const s = String(semaforo ?? "").trim();
  if (!s) return { className: "bg-slate-300", label: "—" };
  const lower = s.toLowerCase();
  if (lower.includes("verde") || lower === "v" || lower === "1")
    return { className: "bg-emerald-500", label: s };
  if (lower.includes("rojo") || lower === "r" || lower === "3")
    return { className: "bg-red-500", label: s };
  if (lower.includes("naranj"))
    return { className: "bg-orange-500", label: s };
  if (lower.includes("amar") || lower === "a" || lower === "2")
    return { className: "bg-yellow-400", label: s };
  return { className: "bg-slate-400", label: s };
}
