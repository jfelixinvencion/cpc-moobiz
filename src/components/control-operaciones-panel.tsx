"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { format } from "date-fns";
import {
  Car,
  ExternalLink,
  Loader2,
  MapPin,
  ParkingSquare,
  Radar,
  RefreshCw,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from "react";
import { createPortal } from "react-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { NearbyServiceMarker } from "@/components/LiveDriverMap";
import {
  GPS_MULTI_OPTIONS,
  GPS_TABLE_LABEL_EN_LINEA,
  GPS_TABLE_LABEL_OCUPADO,
  type DriverLiveAvailability,
  gpsTableLabelFromAvailability,
  rowMatchesGpsMultiFilter,
} from "@/lib/control-operaciones-gps-filter";
import {
  SOLICITANTE_FILTER_ALL,
  SOLICITANTE_FILTER_EMPTY,
  buildSolicitanteFilterOptions,
  emptyControlSolicitanteCell,
  rowMatchesSolicitanteFilter,
  type ControlSolicitanteCell,
} from "@/lib/control-operaciones-solicitante-tm-tt";
import type { ControlDriverExcelRow } from "@/lib/control-operaciones-map";
import { semaforoSwatch } from "@/lib/control-operaciones-map";
import {
  formatRefreshGpsToastSuccess,
  runRefreshGpsRawAndRefetch,
} from "@/lib/control-operaciones-refresh-gps";
import {
  rowMatchesSemaforoMultiFilter,
  SEMAFORO_MULTI_SIN,
} from "@/lib/control-operaciones-semaforo-filter";
import {
  fetchLiveDriverLocationByConductorName,
  type DriverLiveLocationApiResponse,
  type DriverLiveLocationItem,
  type DriverLiveServiceDestination,
} from "@/lib/moobiz-live-driver-location-client";
import { OperacionesDriverModeSwitch } from "@/components/operaciones-driver-mode-switch";
import { useOperacionesDriverFilters } from "@/context/operaciones-driver-filters-context";
import {
  parseFechaActivacionLocalDay,
  rowMatchesActivated8dFilter,
  rowMatchesBaseFlNameFilter,
} from "@/lib/control-operaciones-driver-filters";

const ROW_H = 44;
const CHUNK_NAMES = 55;
const GLOBAL_ALL = "__all__";

/** Barra de acciones Control de operaciones: estilos unificados (solo apariencia). */
const TOOLBAR_BTN_PRIMARY =
  "h-8 min-h-8 px-2.5 text-xs font-medium shadow-sm border border-slate-700 bg-slate-800 text-white hover:bg-slate-700 hover:border-slate-600";
const TOOLBAR_BTN_SECONDARY =
  "h-8 min-h-8 gap-1.5 px-2.5 text-xs font-medium shadow-sm border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300 hover:text-slate-900";
/** Destacado respecto a secundarios, sin gradientes ni colores saturados. */
const TOOLBAR_BTN_GPS =
  "h-8 min-h-8 gap-1.5 px-2.5 text-xs font-medium shadow-sm border-indigo-200 bg-indigo-50/90 text-indigo-950 hover:bg-indigo-100 hover:border-indigo-300 hover:text-indigo-950";
const SOLICITANTE_ALL = SOLICITANTE_FILTER_ALL;
const SOLICITANTE_EMPTY = SOLICITANTE_FILTER_EMPTY;
const GPS_ICON_COLOR_NEUTRAL = "#cbd5e1";
const GPS_ICON_COLOR_ONLINE = "#22c55e";
const GPS_ICON_COLOR_BUSY = "#f97316";
const GPS_ICON_COLOR_OFFLINE = "#94a3b8";

type LiveDriverMapProps = {
  lat: number;
  lng: number;
  fullName: string;
  plate: string;
  iconUrl?: string;
  nearbyServices?: NearbyServiceMarker[];
  serviceDestination?: DriverLiveServiceDestination | null;
};

const SEMAFORO_MULTI_OPTIONS: { value: string; label: string }[] = [
  { value: SEMAFORO_MULTI_SIN, label: "Sin semáforo" },
  { value: "verde", label: "Verde" },
  { value: "amarillo", label: "Amarillo" },
  { value: "naranja", label: "Naranja" },
  { value: "rojo", label: "Rojo" },
];

type MergedDriver = ControlDriverExcelRow & {
  /** undefined = aún no cargado (mostrar "-"). */
  servicios_activos?: number;
  /** undefined = aún no cargado (mostrar "-"). */
  semaforo?: string | null;
};

type ApiPage = {
  drivers: ControlDriverExcelRow[];
  gpsAvailabilityById?: Record<string, DriverLiveAvailability | null>;
  controlById: Record<string, ControlSolicitanteCell>;
  total: number;
  approvedCount?: number;
  semanaLabel: string;
  error?: string;
};

function SearchableMiniSelect(props: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  widthClass?: string;
  markEditing?: boolean;
  disabled?: boolean;
  portalContainer?: HTMLElement | null;
}) {
  const {
    value,
    onChange,
    options,
    placeholder = "Buscar…",
    widthClass = "w-[200px]",
    markEditing,
    disabled,
    portalContainer,
  } = props;
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const recalc = () => {
      const triggerRect = triggerRef.current?.getBoundingClientRect();
      if (!triggerRect) return;
      if (portalContainer) {
        const containerRect = portalContainer.getBoundingClientRect();
        setMenuPos({
          top: triggerRect.bottom - containerRect.top + 4,
          left: triggerRect.left - containerRect.left,
          width: Math.max(triggerRect.width, 180),
        });
        return;
      }
      setMenuPos({
        top: triggerRect.bottom + window.scrollY + 4,
        left: triggerRect.left + window.scrollX,
        width: Math.max(triggerRect.width, 180),
      });
    };
    recalc();
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("resize", recalc);
    window.addEventListener("scroll", recalc, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("resize", recalc);
      window.removeEventListener("scroll", recalc, true);
    };
  }, [open, portalContainer]);

  useEffect(() => {
    if (!open) return;
    const id = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return options;
    return options.filter((o) => o.label.toLowerCase().includes(t));
  }, [options, q]);

  const label = options.find((o) => o.value === value)?.label ?? value;

  return (
    <div ref={rootRef} className={`relative ${widthClass}`}>
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        className="h-8 w-full justify-between px-2 text-left text-xs font-normal"
        onClick={() => {
          if (disabled) return;
          setQ("");
          setOpen((o) => !o);
        }}
        {...(markEditing && open ? { "data-control-edit": "true" } : {})}
      >
        <span className="truncate">{label || "—"}</span>
      </Button>
      {open && !disabled && menuPos
        ? createPortal(
            <div
              ref={menuRef}
              className={`${portalContainer ? "absolute" : "fixed"} z-[120] max-h-56 overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg`}
              style={{ top: menuPos.top, left: menuPos.left, width: menuPos.width }}
            >
              <div className="border-b border-slate-100 p-1.5">
                <Input
                  value={q}
                  ref={searchInputRef}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={placeholder}
                  className="h-8 text-xs"
                  {...(markEditing && open ? { "data-control-edit": "true" } : {})}
                />
              </div>
              <div className="max-h-40 overflow-auto p-1">
                {filtered.length === 0 ? (
                  <p className="px-2 py-1 text-xs text-slate-500">Sin coincidencias</p>
                ) : (
                  filtered.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      className="block w-full truncate rounded px-2 py-1.5 text-left text-xs hover:bg-slate-100"
                      onClick={() => {
                        onChange(o.value);
                        setOpen(false);
                        setQ("");
                      }}
                    >
                      {o.label}
                    </button>
                  ))
                )}
              </div>
            </div>,
            portalContainer ?? document.body,
          )
        : null}
    </div>
  );
}

function SearchableMultiMiniSelect(props: {
  values: string[];
  onChange: (next: string[]) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  widthClass?: string;
  disabled?: boolean;
  portalContainer?: HTMLElement | null;
}) {
  const {
    values,
    onChange,
    options,
    placeholder = "Buscar…",
    widthClass = "w-[200px]",
    disabled,
    portalContainer,
  } = props;
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const recalc = () => {
      const triggerRect = triggerRef.current?.getBoundingClientRect();
      if (!triggerRect) return;
      if (portalContainer) {
        const containerRect = portalContainer.getBoundingClientRect();
        setMenuPos({
          top: triggerRect.bottom - containerRect.top + 4,
          left: triggerRect.left - containerRect.left,
          width: Math.max(triggerRect.width, 180),
        });
        return;
      }
      setMenuPos({
        top: triggerRect.bottom + window.scrollY + 4,
        left: triggerRect.left + window.scrollX,
        width: Math.max(triggerRect.width, 180),
      });
    };
    recalc();
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("resize", recalc);
    window.addEventListener("scroll", recalc, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("resize", recalc);
      window.removeEventListener("scroll", recalc, true);
    };
  }, [open, portalContainer]);

  useEffect(() => {
    if (!open) return;
    const id = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return options;
    return options.filter((o) => o.label.toLowerCase().includes(t));
  }, [options, q]);

  const summary = useMemo(() => {
    if (values.length === 0) return "Todos";
    if (values.length === 1) {
      return options.find((o) => o.value === values[0])?.label ?? `${values.length} seleccionados`;
    }
    return `${values.length} seleccionados`;
  }, [values, options]);

  const toggle = (v: string) => {
    const has = values.includes(v);
    const next = has ? values.filter((x) => x !== v) : [...values, v];
    onChange(next);
  };

  return (
    <div ref={rootRef} className={`relative ${widthClass}`}>
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        className="h-8 w-full justify-between px-2 text-left text-xs font-normal"
        onClick={() => {
          if (disabled) return;
          setQ("");
          setOpen((o) => !o);
        }}
      >
        <span className="truncate">{summary}</span>
      </Button>
      {open && !disabled && menuPos
        ? createPortal(
            <div
              ref={menuRef}
              className={`${portalContainer ? "absolute" : "fixed"} z-[120] max-h-56 overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg`}
              style={{ top: menuPos.top, left: menuPos.left, width: menuPos.width }}
            >
              <div className="border-b border-slate-100 p-1.5">
                <Input
                  value={q}
                  ref={searchInputRef}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={placeholder}
                  className="h-8 text-xs"
                />
              </div>
              <div className="max-h-40 overflow-auto p-1">
                {filtered.length === 0 ? (
                  <p className="px-2 py-1 text-xs text-slate-500">Sin coincidencias</p>
                ) : (
                  filtered.map((o) => (
                    <label
                      key={o.value}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-slate-100"
                    >
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 shrink-0 rounded border-slate-300"
                        checked={values.includes(o.value)}
                        onChange={() => toggle(o.value)}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    </label>
                  ))
                )}
              </div>
            </div>,
            portalContainer ?? document.body,
          )
        : null}
    </div>
  );
}

async function postUpsert(
  rows: {
    id_conductor: string;
    solicitante_tm: string | null;
    solicitante_tt: string | null;
    observacion: string | null;
  }[],
): Promise<void> {
  const res = await fetch("/api/control-operaciones", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows }),
  });
  const j = (await res.json()) as { error?: string };
  if (!res.ok) throw new Error(j.error || "Error al guardar");
}

async function postBulkUpdate(
  ids: string[],
  field: "solicitante_tm" | "solicitante_tt" | "observacion",
  value: string | null,
): Promise<void> {
  const res = await fetch("/api/control-operaciones", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bulk: true, ids, field, value }),
  });
  const j = (await res.json()) as { error?: string };
  if (!res.ok) throw new Error(j.error || "Actualización masiva falló");
}

async function fetchServCountsByDriverIdsChunked(driverIds: string[]): Promise<Record<string, number>> {
  const uniq = [...new Set(driverIds.map((n) => String(n).trim()).filter(Boolean))];
  console.log(`[control-operaciones][SERV] inicio carga SERV dr_id consultados=${uniq.length}`);
  const merged: Record<string, number> = {};
  for (let i = 0; i < uniq.length; i += CHUNK_NAMES) {
    const part = uniq.slice(i, i + CHUNK_NAMES);
    const sp = new URLSearchParams({ partial: "serv" });
    for (const d of part) sp.append("d", d);
    const res = await fetch(`/api/control-operaciones?${sp.toString()}`, { cache: "no-store" });
    const j = (await res.json()) as { servCounts?: Record<string, number>; error?: string };
    if (!res.ok) throw new Error(j.error || "serv");
    if (j.servCounts && typeof j.servCounts === "object") {
      for (const [k, v] of Object.entries(j.servCounts)) {
        merged[k] = (merged[k] ?? 0) + (typeof v === "number" ? v : 0);
      }
    }
  }
  console.log(`[control-operaciones][SERV] cantidad de conteos recibidos=${Object.keys(merged).length}`);
  return merged;
}

async function fetchSemaforoMap(semanaLabel?: string): Promise<{
  semaforoById: Record<string, string>;
  semaforoOptions: string[];
}> {
  const sp = new URLSearchParams({ partial: "semaforo" });
  if (semanaLabel) sp.set("semanaLabel", semanaLabel);
  const res = await fetch(`/api/control-operaciones?${sp.toString()}`, { cache: "no-store" });
  const j = (await res.json()) as {
    semaforoById?: Record<string, string>;
    semaforoOptions?: string[];
    error?: string;
  };
  if (!res.ok) throw new Error(j.error || "semaforo");
  const semaforoById = j.semaforoById && typeof j.semaforoById === "object" ? j.semaforoById : {};
  const semaforoOptions = Array.isArray(j.semaforoOptions)
    ? j.semaforoOptions
    : Array.from(
        new Set(
          Object.values(semaforoById)
            .map((s) => String(s).trim())
            .filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b, "es"));
  return { semaforoById, semaforoOptions };
}

function withPendingHeavy(drivers: ControlDriverExcelRow[]): MergedDriver[] {
  return drivers.map((d) => ({
    ...d,
    servicios_activos: undefined,
    semaforo: undefined,
  }));
}

function gpsAvailabilityLabel(availability: DriverLiveAvailability): string {
  if (availability === "online") return "Disponible";
  if (availability === "busy") return "En Servicio";
  return "Desconectado";
}

function gpsAvailabilityClass(availability: DriverLiveAvailability): string {
  if (availability === "online") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (availability === "busy") return "border-orange-200 bg-orange-50 text-orange-700";
  return "border-slate-200 bg-slate-100 text-slate-600";
}

function gpsAvailabilityDot(availability: DriverLiveAvailability): string {
  if (availability === "online") return "🟢";
  if (availability === "busy") return "🟠";
  return "⚫";
}

function gpsIconColorFromAvailability(availability: DriverLiveAvailability | null): string {
  if (availability === "online") return GPS_ICON_COLOR_ONLINE;
  if (availability === "busy") return GPS_ICON_COLOR_BUSY;
  if (availability === "offline") return GPS_ICON_COLOR_OFFLINE;
  return GPS_ICON_COLOR_NEUTRAL;
}

function formatGpsDate(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "—";
  const isoCandidate = raw.includes("T") ? raw : raw.replace(" ", "T");
  const d = new Date(isoCandidate);
  if (Number.isNaN(d.getTime())) return raw;
  return format(d, "dd/MM/yyyy HH:mm");
}

export function ControlOperacionesPanel() {
  const { baseFilterEnabled, activated8dEnabled, registerDriverMetas } =
    useOperacionesDriverFilters();
  const [rows, setRows] = useState<MergedDriver[]>([]);
  const [controlById, setControlById] = useState<Record<string, ControlSolicitanteCell>>({});
  const [operatorOptions, setOperatorOptions] = useState<{ value: string; label: string }[]>([]);
  const [operatorsReady, setOperatorsReady] = useState(false);
  const [semanaLabel, setSemanaLabel] = useState("");
  const [loading, setLoading] = useState(true);
  const [heavyBusy, setHeavyBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncConductoresBusy, setSyncConductoresBusy] = useState(false);
  const [viajesBusy, setViajesBusy] = useState(false);
  const [asignacionesBusy, setAsignacionesBusy] = useState(false);
  const [refreshGpsBusy, setRefreshGpsBusy] = useState(false);
  const [gpsActionToast, setGpsActionToast] = useState<string | null>(null);

  const [total, setTotal] = useState(0);

  const [region, setRegion] = useState(GLOBAL_ALL);
  /** Vacío = todos (equivalente a "Todos"). */
  const [gpsFilter, setGpsFilter] = useState<string[]>([]);
  const [semaforoFilter, setSemaforoFilter] = useState<string[]>([]);
  const [distritoFilter, setDistritoFilter] = useState<string[]>([]);
  const [conductorQ, setConductorQ] = useState("");
  const [solicitanteFilter, setSolicitanteFilter] = useState(SOLICITANTE_ALL);

  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const anchorIdx = useRef<number | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  /** Evita solapar auto-refresh silencioso (no usa `asignacionesBusy`). */
  const silentAsignacionesInFlightRef = useRef(false);

  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkSolicitante, setBulkSolicitante] = useState("");
  const [bulkSolicitanteTarget, setBulkSolicitanteTarget] = useState<"tm" | "tt">("tm");
  const [bulkClearMenuOpen, setBulkClearMenuOpen] = useState(false);
  const bulkClearMenuRef = useRef<HTMLDivElement>(null);
  const [bulkModalPortalContainer, setBulkModalPortalContainer] = useState<HTMLElement | null>(null);
  const liveLocationCacheRef = useRef<Map<string, DriverLiveLocationApiResponse>>(new Map());
  /** Colores del ícono MapPin por fila (solo tras consulta exitosa; evita leer refs durante render). */
  const [gpsAvailByDriverId, setGpsAvailByDriverId] = useState<
    Record<string, DriverLiveAvailability | null>
  >({});
  const [gpsModalOpen, setGpsModalOpen] = useState(false);
  const [gpsModalDriver, setGpsModalDriver] = useState<{ id: string; name: string } | null>(null);
  const [gpsModalState, setGpsModalState] = useState<{
    status: "idle" | "loading" | "success" | "error";
    item: DriverLiveLocationItem | null;
    nearbyServices: NearbyServiceMarker[];
    serviceDestination: DriverLiveServiceDestination | null;
  }>({ status: "idle", item: null, nearbyServices: [], serviceDestination: null });
  const [LiveMapComponent, setLiveMapComponent] = useState<ComponentType<LiveDriverMapProps> | null>(null);

  /** Evita que `operatorsReady` recree callbacks y dispare el `useEffect` de carga inicial en bucle. */
  const operatorsFetchedRef = useRef(false);

  const hoyStr = useMemo(() => format(new Date(), "dd/MM/yyyy"), []);
  const operatorLabelByValue = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of operatorOptions) {
      map.set(String(o.value), String(o.label));
    }
    return map;
  }, [operatorOptions]);

  const solicitanteFilterOptions = useMemo(() => {
    return buildSolicitanteFilterOptions({
      controlById,
      operatorLabelByValue,
    });
  }, [controlById, operatorLabelByValue]);

  const rowsBeforeDistritoFilter = useMemo(() => {
    const cq = conductorQ.trim().toLowerCase();
    return rows.filter((r) => {
      if (region !== GLOBAL_ALL && String(r.global).trim().toUpperCase() !== region) return false;
      const gpsLabel = gpsTableLabelFromAvailability(gpsAvailByDriverId[r.id_conductor]);
      if (!rowMatchesGpsMultiFilter(gpsFilter, gpsLabel)) return false;
      if (!rowMatchesSemaforoMultiFilter(r, semaforoFilter)) return false;
      if (cq) {
        const idm = r.id_conductor.toLowerCase();
        const nm = r.nombre_conductor.toLowerCase();
        if (!idm.includes(cq) && !nm.includes(cq)) return false;
      }
      if (
        !rowMatchesSolicitanteFilter({
          solicitanteFilter,
          cell: controlById[r.id_conductor],
          operatorLabelByValue,
        })
      ) {
        return false;
      }
      if (!rowMatchesBaseFlNameFilter(r, baseFilterEnabled)) return false;
      if (!rowMatchesActivated8dFilter(r as Record<string, unknown>, activated8dEnabled))
        return false;
      return true;
    });
  }, [
    rows,
    region,
    gpsFilter,
    baseFilterEnabled,
    activated8dEnabled,
    semaforoFilter,
    conductorQ,
    solicitanteFilter,
    controlById,
    operatorLabelByValue,
    gpsAvailByDriverId,
  ]);

  const distritosDisponibles = useMemo(() => {
    const s = new Set<string>();
    for (const r of rowsBeforeDistritoFilter) {
      const d = r.distrito_vive.trim();
      if (d) s.add(d);
    }
    return Array.from(s).sort((a, b) => a.localeCompare(b, "es"));
  }, [rowsBeforeDistritoFilter]);

  const distritoMultiOptions = useMemo(
    () => distritosDisponibles.map((d) => ({ value: d, label: d })),
    [distritosDisponibles],
  );

  useEffect(() => {
    setDistritoFilter((prev) => {
      if (prev.length === 0) return prev;
      const allowed = new Set(distritosDisponibles);
      const next = prev.filter((d) => allowed.has(d));
      return next.length === prev.length ? prev : next;
    });
  }, [distritosDisponibles]);

  useEffect(() => {
    if (!gpsActionToast) return;
    const id = window.setTimeout(() => setGpsActionToast(null), 6500);
    return () => window.clearTimeout(id);
  }, [gpsActionToast]);

  const filtered = useMemo(() => {
    if (distritoFilter.length === 0) return rowsBeforeDistritoFilter;
    return rowsBeforeDistritoFilter.filter((r) => {
      const d = r.distrito_vive.trim();
      return distritoFilter.includes(d);
    });
  }, [rowsBeforeDistritoFilter, distritoFilter]);

  const enrichHeavyForSlice = useCallback(async (slice: ControlDriverExcelRow[], semana: string) => {
    if (slice.length === 0) return;
    setHeavyBusy(true);
    const sliceIds = new Set(slice.map((s) => s.id_conductor));
    try {
      if (!operatorsFetchedRef.current) {
        const ro = await fetch("/api/control-operaciones?partial=operators", { cache: "no-store" });
        const jo = (await ro.json()) as { operatorOptions?: { value: string; label: string }[]; error?: string };
        if (ro.ok && Array.isArray(jo.operatorOptions)) {
          setOperatorOptions(jo.operatorOptions);
          setOperatorsReady(true);
          operatorsFetchedRef.current = true;
        }
      }

      const ids = slice.map((d) => d.id_conductor);
      const servCounts = await fetchServCountsByDriverIdsChunked(ids);
      setRows((prev) =>
        prev.map((r) => {
          if (!sliceIds.has(r.id_conductor)) return r;
          const v = servCounts[r.id_conductor] ?? 0;
          return { ...r, servicios_activos: v };
        }),
      );
      const sample = slice.slice(0, 3).map((d) => ({
        dr_id: d.id_conductor,
        serv: servCounts[d.id_conductor] ?? 0,
      }));
      console.log("[control-operaciones][SERV] ejemplo de 3 conductores", sample);

      try {
        const { semaforoById } = await fetchSemaforoMap(semana);
        setRows((prev) =>
          prev.map((r) => {
            if (!sliceIds.has(r.id_conductor)) return r;
            return { ...r, semaforo: semaforoById[r.id_conductor] ?? null };
          }),
        );
      } catch (e) {
        console.error("[control-operaciones] semaforo auto-load:", e);
      }
    } finally {
      setHeavyBusy(false);
    }
  }, []);

  const loadApprovedDriversBase = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams();
      if (solicitanteFilter === SOLICITANTE_EMPTY) sp.append("solicitante", SOLICITANTE_EMPTY);
      else if (solicitanteFilter !== SOLICITANTE_ALL) sp.append("solicitante", solicitanteFilter);
      const qs = sp.toString();
      const res = await fetch(qs ? `/api/control-operaciones?${qs}` : "/api/control-operaciones", {
        cache: "no-store",
      });
      const j = (await res.json()) as ApiPage & { loadStrategy?: unknown };
      if (!res.ok) throw new Error(j.error || "Error al cargar control");

      const drivers = Array.isArray(j.drivers) ? j.drivers : [];
      const gpsAvailabilityById =
        j.gpsAvailabilityById && typeof j.gpsAvailabilityById === "object" ? j.gpsAvailabilityById : {};
      const control = j.controlById && typeof j.controlById === "object" ? j.controlById : {};
      const tot = typeof j.total === "number" ? j.total : drivers.length;
      const sl = typeof j.semanaLabel === "string" ? j.semanaLabel : "";

      setTotal(tot);
      setSemanaLabel(sl);
      setControlById(control);
      setGpsAvailByDriverId(gpsAvailabilityById);

      const merged = withPendingHeavy(drivers);
      setRows(merged);
      registerDriverMetas(
        merged.map((d) => ({
          nombre_conductor: d.nombre_conductor,
          fl_name: (d as MergedDriver & { fl_name?: string | null }).fl_name ?? null,
          fecha_activacion: d.fecha_activacion,
        })),
      );
      // DEBUG TEMPORAL - eliminar después de verificar
      for (const id of ["130880", "130912", "130913"]) {
        const r = merged.find((x) => String(x.id_conductor) === id);
        console.debug("[DEBUG activation parse]", id, r?.fecha_activacion, parseFechaActivacionLocalDay(r?.fecha_activacion));
      }
      setOperatorOptions([]);
      setOperatorsReady(false);
      operatorsFetchedRef.current = false;

      void enrichHeavyForSlice(drivers, sl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, [enrichHeavyForSlice, registerDriverMetas, solicitanteFilter]);

  const reloadTable = useCallback(() => {
    setSelected(new Set());
    void loadApprovedDriversBase();
  }, [loadApprovedDriversBase]);

  const refreshAsignacionesOnly = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    if (silent && silentAsignacionesInFlightRef.current) return;
    if (silent) {
      silentAsignacionesInFlightRef.current = true;
    } else {
      setAsignacionesBusy(true);
      setError(null);
    }
    try {
      const res = await fetch("/api/control-operaciones?partial=asignaciones", { cache: "no-store" });
      let j: {
        asignaciones?: {
          id_conductor: string;
          solicitante_tm: string | null;
          solicitante_tt: string | null;
          observacion: string | null;
        }[];
        error?: string;
      };
      try {
        j = (await res.json()) as typeof j;
      } catch {
        if (silent) return;
        throw new Error("Error al actualizar asignaciones");
      }
      if (!res.ok) {
        if (silent) return;
        throw new Error(j.error || "Error al actualizar asignaciones");
      }
      const list = Array.isArray(j.asignaciones) ? j.asignaciones : [];
      setControlById((prev) => {
        const next = { ...prev };
        for (const a of list) {
          const id = String(a.id_conductor ?? "").trim();
          if (!id) continue;
          next[id] = {
            solicitante_tm:
              a.solicitante_tm == null || a.solicitante_tm === "" ? null : String(a.solicitante_tm),
            solicitante_tt:
              a.solicitante_tt == null || a.solicitante_tt === "" ? null : String(a.solicitante_tt),
            observacion: a.observacion == null || a.observacion === "" ? null : String(a.observacion),
          };
        }
        return next;
      });
    } catch (e) {
      if (!silent) {
        setError(e instanceof Error ? e.message : "Error al actualizar asignaciones");
      }
    } finally {
      if (silent) {
        silentAsignacionesInFlightRef.current = false;
      } else {
        setAsignacionesBusy(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadApprovedDriversBase();
  }, [loadApprovedDriversBase]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (loading || asignacionesBusy || rows.length === 0) return;
      void refreshAsignacionesOnly({ silent: true });
    }, 120_000);
    return () => window.clearInterval(id);
  }, [loading, asignacionesBusy, rows.length, refreshAsignacionesOnly]);

  /** Recalcula conteos SERV. desde `vista.moobiz_services_maestra` por dr_id. */
  const refreshServ = useCallback(async () => {
    if (rows.length === 0) return;
    const servCounts = await fetchServCountsByDriverIdsChunked(rows.map((d) => d.id_conductor));
    setRows((prev) =>
      prev.map((r) => {
        const v = servCounts[r.id_conductor] ?? 0;
        return { ...r, servicios_activos: v };
      }),
    );
    const sample = rows.slice(0, 3).map((d) => ({
      dr_id: d.id_conductor,
      serv: servCounts[d.id_conductor] ?? 0,
    }));
    console.log("[control-operaciones][SERV] ejemplo de 3 conductores", sample);
  }, [rows]);

  /** POST /api/moobiz-services/sync y luego refresh de SERV desde vista.moobiz_services_maestra. */
  const syncServiciosYConteos = useCallback(async () => {
    if (rows.length === 0) return;
    setViajesBusy(true);
    setError(null);
    try {
      console.log("[control-operaciones][SERV] refresh después del botón Servicios (inicio)");
      const res = await fetch("/api/moobiz-services/sync", { method: "POST", cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        const msg =
          typeof data.error === "string" && data.error.trim()
            ? data.error
            : `No se pudo sincronizar servicios desde Moobiz (HTTP ${res.status}).`;
        throw new Error(msg);
      }
      await refreshServ();
      console.log("[control-operaciones][SERV] refresh después del botón Servicios (ok)");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al sincronizar servicios o actualizar conteos");
    } finally {
      setViajesBusy(false);
    }
  }, [rows, refreshServ]);

  const refreshGpsRawFromMoobiz = useCallback(async () => {
    if (rows.length === 0) return;
    setRefreshGpsBusy(true);
    setError(null);
    try {
      console.debug("[control-operaciones] POST /api/moobiz/refresh-gps-raw");
      const result = await runRefreshGpsRawAndRefetch({
        onSuccess: loadApprovedDriversBase,
      });
      if (!result.ok) {
        console.error("[control-operaciones] refresh-gps-raw:", result.error);
        setGpsActionToast(`Error al actualizar GPS: ${result.error}`);
        return;
      }
      setGpsActionToast(formatRefreshGpsToastSuccess(result));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[control-operaciones] refresh-gps-raw", e);
      setGpsActionToast(`Error al actualizar GPS: ${msg}`);
    } finally {
      setRefreshGpsBusy(false);
    }
  }, [rows.length, loadApprovedDriversBase]);

  const syncConductores = useCallback(async () => {
    setSyncConductoresBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/moobiz-drivers/sync", { method: "POST" });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(j.error || "Sync conductores falló");
      reloadTable();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync");
    } finally {
      setSyncConductoresBusy(false);
    }
  }, [reloadTable]);

  useEffect(() => {
    const tick = async () => {
      if (typeof document !== "undefined" && document.querySelector("[data-control-edit='true']")) {
        return;
      }
      try {
        const res = await fetch("/api/control-operaciones?partial=control", { cache: "no-store" });
        const j = (await res.json()) as {
          controlById?: Record<string, ControlSolicitanteCell>;
          error?: string;
        };
        if (!res.ok) return;
        if (j.controlById && typeof j.controlById === "object") {
          setControlById((prev) => ({ ...prev, ...j.controlById }));
        }
      } catch {
        /* noop */
      }
    };
    const id = window.setInterval(() => void tick(), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
  });

  const toggleSelected = useCallback(
    (id: string, idx: number, shift: boolean) => {
      setSelected((prev) => {
        const next = new Set(prev);
        if (shift && anchorIdx.current !== null) {
          const a = Math.min(anchorIdx.current, idx);
          const b = Math.max(anchorIdx.current, idx);
          const slice = filtered.slice(a, b + 1).map((r) => r.id_conductor);
          const allOn = slice.every((x) => next.has(x));
          for (const x of slice) {
            if (allOn) next.delete(x);
            else next.add(x);
          }
          return next;
        }
        anchorIdx.current = idx;
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [filtered],
  );

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((r) => selected.has(r.id_conductor));

  const toggleAllFiltered = useCallback(() => {
    setSelected(() => {
      if (allFilteredSelected) return new Set();
      return new Set(filtered.map((r) => r.id_conductor));
    });
  }, [allFilteredSelected, filtered]);

  const persistRow = useCallback(
    async (id: string, patch: Partial<ControlSolicitanteCell>) => {
      const cur = controlById[id] ?? emptyControlSolicitanteCell();
      const next: ControlSolicitanteCell = {
        solicitante_tm: patch.solicitante_tm !== undefined ? patch.solicitante_tm : cur.solicitante_tm,
        solicitante_tt: patch.solicitante_tt !== undefined ? patch.solicitante_tt : cur.solicitante_tt,
        observacion: patch.observacion !== undefined ? patch.observacion : cur.observacion,
      };
      setSaving(true);
      try {
        await postUpsert([
          {
            id_conductor: id,
            solicitante_tm: next.solicitante_tm,
            solicitante_tt: next.solicitante_tt,
            observacion: next.observacion,
          },
        ]);
        setControlById((prev) => ({ ...prev, [id]: next }));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Guardar");
      } finally {
        setSaving(false);
      }
    },
    [controlById],
  );

  const applyBulkSolicitante = useCallback(async () => {
    const ids = Array.from(selected);
    if (ids.length === 0 || !bulkSolicitante.trim()) return;
    const sol = bulkSolicitante.trim();
    const field = bulkSolicitanteTarget === "tm" ? "solicitante_tm" : "solicitante_tt";
    setSaving(true);
    try {
      await postBulkUpdate(ids, field, sol);
      setControlById((prev) => {
        const n = { ...prev };
        for (const id of ids) {
          const cur = n[id] ?? emptyControlSolicitanteCell();
          n[id] =
            field === "solicitante_tm"
              ? { ...cur, solicitante_tm: sol }
              : { ...cur, solicitante_tt: sol };
        }
        return n;
      });
      setBulkOpen(false);
      setBulkSolicitante("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Guardar");
    } finally {
      setSaving(false);
    }
  }, [selected, bulkSolicitante, bulkSolicitanteTarget]);

  const clearBulkObservaciones = useCallback(async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!window.confirm(`¿Limpiar observaciones en ${ids.length} fila(s)?`)) return;
    setSaving(true);
    try {
      await postBulkUpdate(ids, "observacion", null);
      setControlById((prev) => {
        const n = { ...prev };
        for (const id of ids) {
          const cur = n[id] ?? emptyControlSolicitanteCell();
          n[id] = { ...cur, observacion: null };
        }
        return n;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Guardar");
    } finally {
      setSaving(false);
    }
  }, [selected]);

  const clearBulkSolicitanteTm = useCallback(async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!window.confirm(`¿Limpiar SOLICITANTE TM en ${ids.length} fila(s)?`)) return;
    setSaving(true);
    try {
      await postBulkUpdate(ids, "solicitante_tm", null);
      setControlById((prev) => {
        const n = { ...prev };
        for (const id of ids) {
          const cur = n[id] ?? emptyControlSolicitanteCell();
          n[id] = { ...cur, solicitante_tm: null };
        }
        return n;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Guardar");
    } finally {
      setSaving(false);
    }
  }, [selected]);

  const clearBulkSolicitanteTt = useCallback(async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!window.confirm(`¿Limpiar SOLICITANTE TT en ${ids.length} fila(s)?`)) return;
    setSaving(true);
    try {
      await postBulkUpdate(ids, "solicitante_tt", null);
      setControlById((prev) => {
        const n = { ...prev };
        for (const id of ids) {
          const cur = n[id] ?? emptyControlSolicitanteCell();
          n[id] = { ...cur, solicitante_tt: null };
        }
        return n;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Guardar");
    } finally {
      setSaving(false);
    }
  }, [selected]);

  const rememberGpsAvailability = useCallback((driverId: string, entry: DriverLiveLocationApiResponse) => {
    if (!entry.ok || !entry.item) return;
    setGpsAvailByDriverId((prev) => {
      if (prev[driverId] === entry.item!.availability) return prev;
      return { ...prev, [driverId]: entry.item!.availability };
    });
  }, []);

  /** Carga Leaflet/react-leaflet solo tras éxito y clic de usuario (no en montaje del panel). */
  const loadLiveMapChunk = useCallback(() => {
    void import("@/components/LiveDriverMap").then((mod) => {
      setLiveMapComponent(() => mod.default);
    });
  }, []);

  const openGpsModalForDriver = useCallback(
    async (driver: MergedDriver) => {
      const id = String(driver.id_conductor).trim();
      const name = String(driver.nombre_conductor || "").trim();
      if (!id || !name) return;

      setGpsModalDriver({ id, name });
      setGpsModalOpen(true);
      setLiveMapComponent(null);

      const cached = liveLocationCacheRef.current.get(id);
      const hasCachedItem = Boolean(cached?.ok && cached.item);
      if (cached?.ok && cached.item) {
        rememberGpsAvailability(id, cached);
        setGpsModalState({
          status: "success",
          item: cached.item,
          nearbyServices: cached.nearbyServices ?? [],
          serviceDestination: cached.serviceDestination ?? null,
        });
        loadLiveMapChunk();
      } else {
        setGpsModalState({
          status: "loading",
          item: null,
          nearbyServices: [],
          serviceDestination: null,
        });
      }

      try {
        const normalized = await fetchLiveDriverLocationByConductorName(name, id);
        rememberGpsAvailability(id, normalized);
        if (!normalized.ok || !normalized.item) {
          if (!hasCachedItem) {
            setGpsModalState({
              status: "error",
              item: null,
              nearbyServices: [],
              serviceDestination: null,
            });
          }
          return;
        }
        liveLocationCacheRef.current.set(id, normalized);
        console.log(`[map] fetched nearbyServices count: ${(normalized.nearbyServices ?? []).length}`);
        setGpsModalState({
          status: "success",
          item: normalized.item,
          nearbyServices: normalized.nearbyServices ?? [],
          serviceDestination: normalized.serviceDestination ?? null,
        });
        loadLiveMapChunk();
      } catch {
        if (!hasCachedItem) {
          setGpsModalState({
            status: "error",
            item: null,
            nearbyServices: [],
            serviceDestination: null,
          });
        }
      }
    },
    [rememberGpsAvailability, loadLiveMapChunk],
  );

  useEffect(() => {
    if (!bulkClearMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!bulkClearMenuRef.current?.contains(e.target as Node)) {
        setBulkClearMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [bulkClearMenuOpen]);

  const gridTemplate =
    "40px minmax(72px,0.65fr) minmax(120px,1fr) minmax(88px,0.75fr) minmax(64px,0.5fr) minmax(52px,0.45fr) minmax(100px,0.75fr) minmax(64px,0.45fr) minmax(96px,0.42fr) minmax(96px,0.42fr) minmax(120px,0.85fr) 64px";

  const serviciosCell = (r: MergedDriver) =>
    r.servicios_activos === undefined ? "—" : String(r.servicios_activos);

  const semaforoCell = (r: MergedDriver) => {
    if (r.semaforo === undefined) {
      return { className: "bg-slate-200", label: "—" };
    }
    return semaforoSwatch(r.semaforo);
  };

  return (
    <div className="space-y-3">
      <Card className="border-slate-200 bg-white shadow-sm">
        <CardHeader className="space-y-1.5 border-b border-slate-100 py-2">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <CardTitle className="text-sm font-semibold text-slate-900">Control de operaciones</CardTitle>
              <p className="text-xs text-slate-500">
                Semana liquidaciones: <span className="font-mono text-slate-700">{semanaLabel || "—"}</span>
              </p>
            </div>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
              <p className="text-xs text-slate-500">
                {rows.length} cargados / {total} aprobados
              </p>
              <Badge variant="secondary" className="h-6 shrink-0 bg-slate-100 px-2 text-[11px] text-slate-800">
                Fecha sistema: {hoyStr}
              </Badge>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1.5 md:grid-cols-3 xl:grid-cols-6">
            <div className="space-y-0.5">
              <Label className="text-[9px] uppercase leading-none text-slate-500">Región</Label>
              <Select value={region} onValueChange={setRegion}>
                <SelectTrigger className="h-8 text-[11px]">
                  <SelectValue placeholder="GLOBAL" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={GLOBAL_ALL}>Todas</SelectItem>
                  <SelectItem value="LIMA">LIMA</SelectItem>
                  <SelectItem value="PROVINCIA">PROVINCIA</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-0.5">
              <Label className="text-[9px] uppercase leading-none text-slate-500">GPS</Label>
              <SearchableMultiMiniSelect
                values={gpsFilter}
                onChange={setGpsFilter}
                options={GPS_MULTI_OPTIONS}
                placeholder="Buscar estado GPS…"
                widthClass="w-full"
              />
            </div>
            <div className="space-y-0.5">
              <Label className="text-[9px] uppercase leading-none text-slate-500">Semáforo</Label>
              <SearchableMultiMiniSelect
                values={semaforoFilter}
                onChange={setSemaforoFilter}
                options={SEMAFORO_MULTI_OPTIONS}
                placeholder="Buscar semáforo…"
                widthClass="w-full"
              />
            </div>
            <div className="space-y-0.5">
              <Label className="text-[9px] uppercase leading-none text-slate-500">Distrito</Label>
              <SearchableMultiMiniSelect
                values={distritoFilter}
                onChange={setDistritoFilter}
                options={distritoMultiOptions}
                placeholder="Buscar distrito…"
                widthClass="w-full"
              />
            </div>
            <div className="space-y-0.5">
              <Label className="text-[9px] uppercase leading-none text-slate-500">Conductor</Label>
              <Input
                value={conductorQ}
                onChange={(e) => setConductorQ(e.target.value)}
                placeholder="ID o nombre…"
                className="h-8 text-[11px]"
              />
            </div>
            <div className="space-y-0.5">
              <Label className="text-[9px] uppercase leading-none text-slate-500">Solicitante</Label>
              <SearchableMiniSelect
                value={solicitanteFilter}
                onChange={setSolicitanteFilter}
                options={solicitanteFilterOptions}
                placeholder="Buscar solicitante…"
                widthClass="w-full"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 pt-2">
          {error ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="default"
              className={TOOLBAR_BTN_PRIMARY}
              disabled={selected.size === 0}
              onClick={() => setBulkOpen(true)}
            >
              Aplicar solicitante a seleccionados ({selected.size})
            </Button>
            <div className="relative" ref={bulkClearMenuRef}>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className={TOOLBAR_BTN_SECONDARY}
                disabled={selected.size === 0}
                onClick={() => setBulkClearMenuOpen((v) => !v)}
              >
                Limpiar seleccionadas
              </Button>
              {bulkClearMenuOpen ? (
                <div className="absolute z-40 mt-1 min-w-[220px] rounded-md border border-slate-200 bg-white p-1 shadow-md">
                  <button
                    type="button"
                    className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-slate-100"
                    onClick={() => {
                      setBulkClearMenuOpen(false);
                      void clearBulkObservaciones();
                    }}
                  >
                    Limpiar observaciones
                  </button>
                  <button
                    type="button"
                    className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-slate-100"
                    onClick={() => {
                      setBulkClearMenuOpen(false);
                      void clearBulkSolicitanteTm();
                    }}
                  >
                    Limpiar solicitante TM
                  </button>
                  <button
                    type="button"
                    className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-slate-100"
                    onClick={() => {
                      setBulkClearMenuOpen(false);
                      void clearBulkSolicitanteTt();
                    }}
                  >
                    Limpiar solicitante TT
                  </button>
                </div>
              ) : null}
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={syncConductoresBusy || loading}
              onClick={() => void syncConductores()}
              className={`${TOOLBAR_BTN_SECONDARY} max-w-[200px]`}
            >
              {syncConductoresBusy ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-slate-500" aria-hidden />
              ) : (
                <RefreshCw className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
              )}
              <span className="truncate">Conductores</span>
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={viajesBusy || loading || rows.length === 0}
              onClick={() => void syncServiciosYConteos()}
              className={`${TOOLBAR_BTN_SECONDARY} max-w-[220px]`}
              title={viajesBusy ? undefined : "Sincronizar public.moobiz_services y refrescar SERV desde vista.moobiz_services_maestra."}
            >
              {viajesBusy ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-slate-500" aria-hidden />
              ) : (
                <Car className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
              )}
              <span className="truncate">{viajesBusy ? "Actualizando servicios..." : "Servicios"}</span>
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={refreshGpsBusy || loading || rows.length === 0}
              onClick={() => void refreshGpsRawFromMoobiz()}
              className={TOOLBAR_BTN_GPS}
              title="Volcar live/vehicles a public.driver_live_raw (requiere permiso de escritura)."
            >
              {refreshGpsBusy ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-indigo-600/90" aria-hidden />
                  <span className="tabular-nums">GPS</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <Radar className="h-3.5 w-3.5 shrink-0 text-indigo-600/85" strokeWidth={2} aria-hidden />
                  GPS
                </span>
              )}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={loading || asignacionesBusy}
              onClick={() => void refreshAsignacionesOnly()}
              className={TOOLBAR_BTN_SECONDARY}
            >
              {asignacionesBusy ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-slate-500" aria-hidden />
                  <span>Actualizando…</span>
                </>
              ) : (
                "Actualizar asignaciones"
              )}
            </Button>
            <span className="text-[10px] leading-none text-slate-500">
              {loading ? "Cargando…" : `${filtered.length} visibles · ${rows.length} en memoria`}
              {heavyBusy ? " · Sincronizando viajes/semáforo…" : ""}
              {saving ? " · Guardando…" : ""}
            </span>
            <OperacionesDriverModeSwitch className="ml-auto" />
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-200">
            <div
              className="grid gap-1 border-b border-slate-200 bg-slate-50 px-1 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-600"
              style={{ gridTemplateColumns: gridTemplate }}
            >
              <div className="flex items-center justify-center">
                <input
                  type="checkbox"
                  checked={allFilteredSelected}
                  onChange={toggleAllFiltered}
                  aria-label="Seleccionar visibles"
                />
              </div>
              <span>ID</span>
              <span>Nombre</span>
              <span>Distrito</span>
              <span>Turno</span>
              <span className="text-center">Serv.</span>
              <span>Semáforo</span>
              <span>GPS</span>
              <span>SOLICITANTE TM</span>
              <span>SOLICITANTE TT</span>
              <span>Observación</span>
              <span className="flex items-center justify-center gap-2">
                <MapPin className="h-3.5 w-3.5 text-slate-400" />
                <ExternalLink className="h-3.5 w-3.5 text-slate-500" />
              </span>
            </div>
            <div ref={parentRef} className="max-h-[min(680px,calc(100vh-260px))] overflow-auto">
              <div className="relative" style={{ height: rowVirtualizer.getTotalSize() }}>
                {rowVirtualizer.getVirtualItems().map((vi) => {
                  const r = filtered[vi.index];
                  if (!r) return null;
                  const c = controlById[r.id_conductor] ?? emptyControlSolicitanteCell();
                  const sem = semaforoCell(r);
                  const checked = selected.has(r.id_conductor);
                  const gpsLabel = gpsTableLabelFromAvailability(gpsAvailByDriverId[r.id_conductor]);
                  const gpsBadgeClass =
                    gpsLabel === GPS_TABLE_LABEL_EN_LINEA
                      ? "h-6 justify-self-start border-emerald-200 bg-emerald-50 text-[10px] text-emerald-900"
                      : gpsLabel === GPS_TABLE_LABEL_OCUPADO
                        ? "h-6 justify-self-start border-orange-200 bg-orange-50 text-[10px] text-orange-900"
                        : "h-6 justify-self-start border-slate-200 bg-slate-100 text-[10px] text-slate-700";
                  return (
                    <div
                      key={r.id_conductor}
                      className="absolute left-0 grid w-full gap-1 border-b border-slate-100 px-1 py-1 text-xs hover:bg-slate-50/80"
                      style={{
                        transform: `translateY(${vi.start}px)`,
                        height: vi.size,
                        gridTemplateColumns: gridTemplate,
                      }}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest("input,button,select,a,[data-no-shift-select]"))
                          return;
                        toggleSelected(r.id_conductor, vi.index, e.shiftKey);
                      }}
                    >
                      <div className="flex items-center justify-center">
                        <input
                          type="checkbox"
                          checked={checked}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => toggleSelected(r.id_conductor, vi.index, false)}
                          aria-label={`Sel ${r.id_conductor}`}
                        />
                      </div>
                      <span className="truncate font-mono text-[11px]" title={r.id_conductor}>
                        {r.id_conductor}
                      </span>
                      <span className="truncate" title={r.nombre_conductor}>
                        {r.nombre_conductor}
                      </span>
                      <span className="truncate text-[11px]" title={r.distrito_vive}>
                        {r.distrito_vive || "—"}
                      </span>
                      <span className="truncate text-[11px]">{r.turno || "—"}</span>
                      <span className="text-center tabular-nums">{serviciosCell(r)}</span>
                      <div className="flex min-w-0 items-center gap-1.5" data-no-shift-select>
                        <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${sem.className}`} />
                        <span className="truncate text-[11px]" title={r.semaforo ?? ""}>
                          {sem.label}
                        </span>
                      </div>
                      <Badge
                        variant="outline"
                        className={gpsBadgeClass}
                      >
                        {gpsLabel}
                      </Badge>
                      <div data-no-shift-select>
                        <SearchableMiniSelect
                          value={c.solicitante_tm ?? ""}
                          onChange={(v) => void persistRow(r.id_conductor, { solicitante_tm: v || null })}
                          options={[{ value: "", label: "— vacío —" }, ...operatorOptions]}
                          widthClass="w-full min-w-[88px]"
                          markEditing
                          disabled={!operatorsReady}
                        />
                      </div>
                      <div data-no-shift-select>
                        <SearchableMiniSelect
                          value={c.solicitante_tt ?? ""}
                          onChange={(v) => void persistRow(r.id_conductor, { solicitante_tt: v || null })}
                          options={[{ value: "", label: "— vacío —" }, ...operatorOptions]}
                          widthClass="w-full min-w-[88px]"
                          markEditing
                          disabled={!operatorsReady}
                        />
                      </div>
                      <div data-no-shift-select>
                        <ObservacionCell
                          initial={c.observacion ?? ""}
                          onCommit={(text) => void persistRow(r.id_conductor, { observacion: text || null })}
                        />
                      </div>
                      <div className="flex items-center justify-center gap-2" data-no-shift-select>
                        <button
                          type="button"
                          title="Ver ubicación GPS"
                          onClick={(e) => {
                            e.stopPropagation();
                            void openGpsModalForDriver(r);
                          }}
                          className="inline-flex items-center justify-center transition hover:opacity-85"
                        >
                          <MapPin
                            className="h-4 w-4"
                            style={{
                              color: gpsIconColorFromAvailability(
                                gpsAvailByDriverId[r.id_conductor] ?? null,
                              ),
                            }}
                          />
                        </button>
                        <a
                          href={`https://app.moobiz.pe/actives?id_driver=${encodeURIComponent(r.id_conductor)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Ver servicios en Moobiz"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center justify-center text-slate-600 hover:text-slate-800"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={gpsModalOpen}
        onOpenChange={(open) => {
          setGpsModalOpen(open);
          if (!open) {
            setGpsModalState({
              status: "idle",
              item: null,
              nearbyServices: [],
              serviceDestination: null,
            });
            setGpsModalDriver(null);
            setLiveMapComponent(null);
          }
        }}
      >
        <DialogContent
          className="sm:max-w-3xl"
          showCloseButton
          overlayClassName="fixed inset-0 isolate z-50 bg-black/55 supports-backdrop-filter:backdrop-blur-sm data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
        >
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center justify-between gap-2">
              <span className="truncate">{gpsModalDriver?.name ?? "Ubicación GPS"}</span>
              {gpsModalState.status === "success" && gpsModalState.item ? (
                <Badge variant="outline" className={gpsAvailabilityClass(gpsModalState.item.availability)}>
                  {gpsAvailabilityDot(gpsModalState.item.availability)}{" "}
                  {gpsAvailabilityLabel(gpsModalState.item.availability)}
                </Badge>
              ) : null}
            </DialogTitle>
          </DialogHeader>

          {gpsModalState.status === "loading" ? (
            <div className="flex min-h-[260px] flex-col items-center justify-center gap-2">
              <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
              <p className="text-sm text-slate-600">Obteniendo ubicación GPS...</p>
            </div>
          ) : gpsModalState.status === "error" ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center gap-3">
              <p className="text-sm text-slate-700">GPS no disponible para este conductor</p>
              <Button type="button" variant="outline" onClick={() => setGpsModalOpen(false)}>
                Cerrar
              </Button>
            </div>
          ) : gpsModalState.status === "success" && gpsModalState.item && gpsModalOpen ? (
            <div className="space-y-3">
              {LiveMapComponent ? (
                <LiveMapComponent
                  key={gpsModalDriver?.id ?? "map"}
                  lat={gpsModalState.item.lat}
                  lng={gpsModalState.item.lng}
                  fullName={gpsModalState.item.full_name}
                  plate={gpsModalState.item.plate}
                  iconUrl={gpsModalState.item.icon || undefined}
                  nearbyServices={gpsModalState.nearbyServices}
                  serviceDestination={gpsModalState.serviceDestination}
                />
              ) : (
                <div className="flex h-[320px] items-center justify-center rounded-lg border border-slate-200 bg-slate-50">
                  <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
                </div>
              )}
              <div className="space-y-1 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                <p>🚗 Placa: {gpsModalState.item.plate || "—"}</p>
                <p>📍 Código: {gpsModalState.item.code || "—"}</p>
                <p>🕐 Último GPS: {gpsModalState.item.txt_tracked || "—"}</p>
                <p>📅 Fecha: {formatGpsDate(gpsModalState.item.date_tracked)}</p>
                {String(gpsModalState.item.parked_address ?? "").trim() ? (
                  <p className="flex items-start gap-2">
                    <ParkingSquare className="mt-0.5 h-4 w-4 shrink-0 text-slate-600" aria-hidden />
                    <span>
                      Últ. posición parado: {String(gpsModalState.item.parked_address).trim()}
                    </span>
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          <DialogFooter className="gap-2 sm:justify-end">
            {gpsModalState.status === "success" && gpsModalState.item ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const { lat, lng } = gpsModalState.item as DriverLiveLocationItem;
                  window.open(
                    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`,
                    "_blank",
                    "noopener,noreferrer",
                  );
                }}
              >
                Abrir en Google Maps
              </Button>
            ) : null}
            <Button type="button" variant="secondary" onClick={() => setGpsModalOpen(false)}>
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {gpsActionToast ? (
        <div className="fixed right-4 bottom-4 z-[200] max-w-sm rounded-md border border-slate-200 bg-[#0b1131] px-3 py-2 text-sm text-white shadow-lg">
          <span className="break-words">{gpsActionToast}</span>
          <button
            type="button"
            className="ml-3 text-[#7dd3fc] hover:underline"
            onClick={() => setGpsActionToast(null)}
          >
            Cerrar
          </button>
        </div>
      ) : null}

      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="sm:max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle>Solicitante masivo</DialogTitle>
            <p className="text-xs text-slate-600">
              Se aplicará el operador elegido a la columna indicada en las filas seleccionadas.
            </p>
          </DialogHeader>
          <div ref={setBulkModalPortalContainer} className="space-y-3">
            <div className="flex flex-col gap-2 rounded-md border border-slate-200 bg-slate-50/80 p-2 text-xs">
              <span className="font-medium text-slate-700">Aplicar a</span>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="bulk-solic-col"
                  checked={bulkSolicitanteTarget === "tm"}
                  onChange={() => setBulkSolicitanteTarget("tm")}
                  className="h-3.5 w-3.5"
                />
                <span>SOLICITANTE TM</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="bulk-solic-col"
                  checked={bulkSolicitanteTarget === "tt"}
                  onChange={() => setBulkSolicitanteTarget("tt")}
                  className="h-3.5 w-3.5"
                />
                <span>SOLICITANTE TT</span>
              </label>
            </div>
            <SearchableMiniSelect
              value={bulkSolicitante}
              onChange={setBulkSolicitante}
              options={operatorOptions}
              placeholder="Buscar operador…"
              widthClass="w-full"
              disabled={!operatorsReady}
              portalContainer={bulkModalPortalContainer}
            />
          </div>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setBulkOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => void applyBulkSolicitante()}
              disabled={!bulkSolicitante.trim() || !operatorsReady}
            >
              Aplicar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ObservacionCell(props: { initial: string; onCommit: (t: string) => void }) {
  const [v, setV] = useState(props.initial);
  const tRef = useRef<number | null>(null);
  const commitRef = useRef(props.onCommit);
  commitRef.current = props.onCommit;

  useEffect(() => {
    setV(props.initial);
  }, [props.initial]);

  useEffect(() => {
    return () => {
      if (tRef.current != null) window.clearTimeout(tRef.current);
    };
  }, []);

  const schedule = useCallback((next: string) => {
    if (tRef.current != null) window.clearTimeout(tRef.current);
    tRef.current = window.setTimeout(() => {
      commitRef.current(next);
      tRef.current = null;
    }, 650);
  }, []);

  return (
    <Input
      value={v}
      data-control-edit
      onFocus={(e) => {
        e.currentTarget.setAttribute("data-control-edit", "true");
      }}
      onBlur={(e) => {
        e.currentTarget.setAttribute("data-control-edit", "false");
        if (tRef.current != null) window.clearTimeout(tRef.current);
        tRef.current = null;
        commitRef.current(v);
      }}
      onChange={(e) => {
        const next = e.target.value;
        setV(next);
        schedule(next);
      }}
      className="h-8 min-w-0 text-[11px]"
      placeholder="Observación…"
    />
  );
}
