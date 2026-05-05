"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { format } from "date-fns";
import { ExternalLink } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import type { ControlDriverExcelRow } from "@/lib/control-operaciones-map";
import { semaforoSwatch } from "@/lib/control-operaciones-map";
import { normalizeConductorName } from "@/lib/gps-filter";

const ROW_H = 44;
const CHUNK_NAMES = 55;
const GLOBAL_ALL = "__all__";
const GPS_ALL = "__all__";
const SEMAFORO_ALL = "__all__";
const SEMAFORO_EMPTY = "__empty__";
const DISTRITO_ALL = "__all__";
const SOLICITANTE_ALL = "__all__";
const SOLICITANTE_EMPTY = "__empty__";

type MergedDriver = ControlDriverExcelRow & {
  /** undefined = aún no cargado (mostrar "-"). */
  servicios_activos?: number;
  /** undefined = aún no cargado (mostrar "-"). */
  semaforo?: string | null;
};

type ControlCell = { solicitante: string | null; observacion: string | null };

type ApiPage = {
  drivers: ControlDriverExcelRow[];
  controlById: Record<string, ControlCell>;
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

async function postUpsert(
  rows: { id_conductor: string; solicitante: string | null; observacion: string | null }[],
): Promise<void> {
  const res = await fetch("/api/control-operaciones", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows }),
  });
  const j = (await res.json()) as { error?: string };
  if (!res.ok) throw new Error(j.error || "Error al guardar");
}

async function fetchViajesCountsChunked(names: string[]): Promise<Record<string, number>> {
  const uniq = [...new Set(names.map((n) => String(n).trim()).filter(Boolean))];
  const merged: Record<string, number> = {};
  for (let i = 0; i < uniq.length; i += CHUNK_NAMES) {
    const part = uniq.slice(i, i + CHUNK_NAMES);
    const sp = new URLSearchParams({ partial: "viajes" });
    for (const n of part) sp.append("n", n);
    const res = await fetch(`/api/control-operaciones?${sp.toString()}`, { cache: "no-store" });
    const j = (await res.json()) as { viajesCounts?: Record<string, number>; error?: string };
    if (!res.ok) throw new Error(j.error || "viajes");
    if (j.viajesCounts && typeof j.viajesCounts === "object") {
      for (const [k, v] of Object.entries(j.viajesCounts)) {
        merged[k] = (merged[k] ?? 0) + (typeof v === "number" ? v : 0);
      }
    }
  }
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

export function ControlOperacionesPanel() {
  const [rows, setRows] = useState<MergedDriver[]>([]);
  const [controlById, setControlById] = useState<Record<string, ControlCell>>({});
  const [operatorOptions, setOperatorOptions] = useState<{ value: string; label: string }[]>([]);
  const [operatorsReady, setOperatorsReady] = useState(false);
  const [semanaLabel, setSemanaLabel] = useState("");
  const [semaforoOptionsFromApi, setSemaforoOptionsFromApi] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [heavyBusy, setHeavyBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncConductoresBusy, setSyncConductoresBusy] = useState(false);
  const [viajesBusy, setViajesBusy] = useState(false);

  const [total, setTotal] = useState(0);

  const [region, setRegion] = useState(GLOBAL_ALL);
  const [gps, setGps] = useState(GPS_ALL);
  const [semaforo, setSemaforo] = useState(SEMAFORO_ALL);
  const [distrito, setDistrito] = useState(DISTRITO_ALL);
  const [conductorQ, setConductorQ] = useState("");
  const [solicitanteFilter, setSolicitanteFilter] = useState(SOLICITANTE_ALL);

  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const anchorIdx = useRef<number | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);

  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkSolicitante, setBulkSolicitante] = useState("");
  const [bulkClearMenuOpen, setBulkClearMenuOpen] = useState(false);
  const bulkClearMenuRef = useRef<HTMLDivElement>(null);
  const [bulkModalPortalContainer, setBulkModalPortalContainer] = useState<HTMLElement | null>(null);

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

  const solicitanteLabel = useCallback(
    (raw: string | null | undefined): string => {
      const v = String(raw ?? "").trim();
      if (!v) return "";
      return operatorLabelByValue.get(v) ?? v;
    },
    [operatorLabelByValue],
  );

  const distritoOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) {
      const d = r.distrito_vive.trim();
      if (d) s.add(d);
    }
    return [DISTRITO_ALL, ...Array.from(s).sort((a, b) => a.localeCompare(b, "es"))];
  }, [rows]);

  const solicitanteFilterOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      const sol = solicitanteLabel(controlById[r.id_conductor]?.solicitante);
      if (sol) set.add(sol);
    }
    return [
      { value: SOLICITANTE_ALL, label: "Todos" },
      { value: SOLICITANTE_EMPTY, label: "Vacíos" },
      ...Array.from(set)
        .sort((a, b) => a.localeCompare(b, "es"))
        .map((s) => ({ value: s, label: s })),
    ];
  }, [rows, controlById, solicitanteLabel]);

  const semaforoFilterOptions = useMemo(() => {
    const s = new Set<string>(semaforoOptionsFromApi);
    for (const r of rows) {
      const v = r.semaforo?.trim();
      if (v) s.add(v);
    }
    return [SEMAFORO_ALL, SEMAFORO_EMPTY, ...Array.from(s).sort((a, b) => a.localeCompare(b, "es"))];
  }, [rows, semaforoOptionsFromApi]);

  const filtered = useMemo(() => {
    const cq = conductorQ.trim().toLowerCase();
    return rows.filter((r) => {
      if (region !== GLOBAL_ALL && String(r.global).trim().toUpperCase() !== region) return false;
      if (gps !== GPS_ALL && r.gps_label !== gps) return false;
      if (semaforo === SEMAFORO_EMPTY) {
        if ((r.semaforo ?? "").trim()) return false;
      } else if (semaforo !== SEMAFORO_ALL && (r.semaforo ?? "").trim() !== semaforo) return false;
      if (distrito !== DISTRITO_ALL && r.distrito_vive !== distrito) return false;
      if (cq) {
        const idm = r.id_conductor.toLowerCase();
        const nm = r.nombre_conductor.toLowerCase();
        if (!idm.includes(cq) && !nm.includes(cq)) return false;
      }
      const sol = solicitanteLabel(controlById[r.id_conductor]?.solicitante);
      if (solicitanteFilter === SOLICITANTE_EMPTY) {
        if (sol) return false;
      } else if (solicitanteFilter !== SOLICITANTE_ALL) {
        if (sol !== solicitanteFilter) return false;
      }
      return true;
    });
  }, [rows, region, gps, semaforo, distrito, conductorQ, solicitanteFilter, controlById]);

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

      const names = slice.map((d) => d.nombre_conductor);
      const viajesCounts = await fetchViajesCountsChunked(names);
      setRows((prev) =>
        prev.map((r) => {
          if (!sliceIds.has(r.id_conductor)) return r;
          const k = normalizeConductorName(r.nombre_conductor);
          const v = viajesCounts[k] ?? 0;
          return { ...r, servicios_activos: v };
        }),
      );

      try {
        const { semaforoById, semaforoOptions } = await fetchSemaforoMap(semana);
        setSemaforoOptionsFromApi((prev) =>
          Array.from(new Set([...prev, ...semaforoOptions])).sort((a, b) => a.localeCompare(b, "es")),
        );
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
      const res = await fetch("/api/control-operaciones", { cache: "no-store" });
      const j = (await res.json()) as ApiPage & { loadStrategy?: unknown };
      if (!res.ok) throw new Error(j.error || "Error al cargar control");

      const drivers = Array.isArray(j.drivers) ? j.drivers : [];
      const control = j.controlById && typeof j.controlById === "object" ? j.controlById : {};
      const tot = typeof j.total === "number" ? j.total : drivers.length;
      const sl = typeof j.semanaLabel === "string" ? j.semanaLabel : "";

      setTotal(tot);
      setSemanaLabel(sl);
      setControlById(control);

      const merged = withPendingHeavy(drivers);
      setRows(merged);
      setOperatorOptions([]);
      setOperatorsReady(false);
      operatorsFetchedRef.current = false;
      setSemaforoOptionsFromApi([]);

      void enrichHeavyForSlice(drivers, sl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, [enrichHeavyForSlice]);

  const reloadTable = useCallback(() => {
    setSelected(new Set());
    void loadApprovedDriversBase();
  }, [loadApprovedDriversBase]);

  useEffect(() => {
    void loadApprovedDriversBase();
  }, [loadApprovedDriversBase]);

  const refreshViajes = useCallback(async () => {
    if (rows.length === 0) return;
    setViajesBusy(true);
    setError(null);
    try {
      const base = rows.map((r) => ({
        id_conductor: r.id_conductor,
        nombre_conductor: r.nombre_conductor,
      })) as ControlDriverExcelRow[];
      const viajesCounts = await fetchViajesCountsChunked(base.map((d) => d.nombre_conductor));
      setRows((prev) =>
        prev.map((r) => {
          const k = normalizeConductorName(r.nombre_conductor);
          const v = viajesCounts[k] ?? 0;
          return { ...r, servicios_activos: v };
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error viajes");
    } finally {
      setViajesBusy(false);
    }
  }, [rows]);

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
          controlById?: Record<string, ControlCell>;
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
    async (id: string, patch: Partial<ControlCell>) => {
      const cur = controlById[id] ?? { solicitante: null, observacion: null };
      const next: ControlCell = {
        solicitante: patch.solicitante !== undefined ? patch.solicitante : cur.solicitante,
        observacion: patch.observacion !== undefined ? patch.observacion : cur.observacion,
      };
      setSaving(true);
      try {
        await postUpsert([{ id_conductor: id, solicitante: next.solicitante, observacion: next.observacion }]);
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
    const payload = ids.map((id) => {
      const cur = controlById[id] ?? { solicitante: null, observacion: null };
      return {
        id_conductor: id,
        solicitante: sol,
        observacion: cur.observacion,
      };
    });
    setSaving(true);
    try {
      await postUpsert(payload);
      setControlById((prev) => {
        const n = { ...prev };
        for (const id of ids) {
          const cur = n[id] ?? { solicitante: null, observacion: null };
          n[id] = { solicitante: sol, observacion: cur.observacion };
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
  }, [selected, bulkSolicitante, controlById]);

  const clearBulkObservaciones = useCallback(async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const payload = ids.map((id) => {
      const cur = controlById[id] ?? { solicitante: null, observacion: null };
      return {
        id_conductor: id,
        solicitante: cur.solicitante,
        observacion: null,
      };
    });
    setSaving(true);
    try {
      await postUpsert(payload);
      setControlById((prev) => {
        const n = { ...prev };
        for (const id of ids) {
          const cur = n[id] ?? { solicitante: null, observacion: null };
          n[id] = { solicitante: cur.solicitante, observacion: null };
        }
        return n;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Guardar");
    } finally {
      setSaving(false);
    }
  }, [selected, controlById]);

  const clearBulkSolicitantes = useCallback(async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const payload = ids.map((id) => {
      const cur = controlById[id] ?? { solicitante: null, observacion: null };
      return {
        id_conductor: id,
        solicitante: null,
        observacion: cur.observacion,
      };
    });
    setSaving(true);
    try {
      await postUpsert(payload);
      setControlById((prev) => {
        const n = { ...prev };
        for (const id of ids) {
          const cur = n[id] ?? { solicitante: null, observacion: null };
          n[id] = { solicitante: null, observacion: cur.observacion };
        }
        return n;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Guardar");
    } finally {
      setSaving(false);
    }
  }, [selected, controlById]);

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
    "40px minmax(72px,0.65fr) minmax(120px,1fr) minmax(88px,0.75fr) minmax(64px,0.5fr) minmax(52px,0.45fr) minmax(100px,0.75fr) minmax(64px,0.45fr) minmax(140px,0.9fr) minmax(140px,1fr) 40px";

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
              <Label className="text-[9px] uppercase leading-none text-slate-500">GPS (Online)</Label>
              <Select value={gps} onValueChange={setGps}>
                <SelectTrigger className="h-8 text-[11px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={GPS_ALL}>Todos</SelectItem>
                  <SelectItem value="Encendido">Encendido</SelectItem>
                  <SelectItem value="Apagado">Apagado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-0.5">
              <Label className="text-[9px] uppercase leading-none text-slate-500">Semáforo</Label>
              <Select value={semaforo} onValueChange={setSemaforo}>
                <SelectTrigger className="h-8 text-[11px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {semaforoFilterOptions.map((v) => (
                    <SelectItem key={v} value={v}>
                      {v === SEMAFORO_ALL
                        ? "Todos"
                        : v === SEMAFORO_EMPTY
                          ? "Sin semáforo"
                          : v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-0.5">
              <Label className="text-[9px] uppercase leading-none text-slate-500">Distrito</Label>
              <SearchableMiniSelect
                value={distrito}
                onChange={setDistrito}
                options={distritoOptions.map((d) => ({ value: d, label: d === DISTRITO_ALL ? "Todos" : d }))}
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
              className="h-8 bg-[#0b1131] px-2 text-xs text-white hover:bg-[#0b1131]/90"
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
                className="h-8 px-2 text-xs"
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
                      void clearBulkSolicitantes();
                    }}
                  >
                    Limpiar solicitantes
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
              className="h-8 px-2 text-xs"
            >
              {syncConductoresBusy ? "…" : "🔄 Conductores"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={viajesBusy || loading || rows.length === 0}
              onClick={() => void refreshViajes()}
              className="h-8 px-2 text-xs"
            >
              {viajesBusy ? "…" : "🚗 Viajes"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={loading}
              onClick={() => void reloadTable()}
              className="h-8 px-2 text-xs"
            >
              Recargar tabla
            </Button>
            <span className="text-[10px] leading-none text-slate-500">
              {loading ? "Cargando…" : `${filtered.length} visibles · ${rows.length} en memoria`}
              {heavyBusy ? " · Sincronizando viajes/semáforo…" : ""}
              {saving ? " · Guardando…" : ""}
            </span>
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
              <span>Solicitante</span>
              <span>Observación</span>
              <span className="flex items-center justify-center">
                <ExternalLink className="h-3.5 w-3.5 text-blue-500" />
              </span>
            </div>
            <div ref={parentRef} className="max-h-[min(680px,calc(100vh-260px))] overflow-auto">
              <div className="relative" style={{ height: rowVirtualizer.getTotalSize() }}>
                {rowVirtualizer.getVirtualItems().map((vi) => {
                  const r = filtered[vi.index];
                  if (!r) return null;
                  const c = controlById[r.id_conductor] ?? { solicitante: null, observacion: null };
                  const sem = semaforoCell(r);
                  const checked = selected.has(r.id_conductor);
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
                        className={
                          r.gps_label === "Apagado"
                            ? "h-6 justify-self-start border-amber-200 bg-amber-50 text-[10px] text-amber-900"
                            : "h-6 justify-self-start border-emerald-200 bg-emerald-50 text-[10px] text-emerald-900"
                        }
                      >
                        {r.gps_label}
                      </Badge>
                      <div data-no-shift-select>
                        <SearchableMiniSelect
                          value={c.solicitante ?? ""}
                          onChange={(v) => void persistRow(r.id_conductor, { solicitante: v || null })}
                          options={[{ value: "", label: "— vacío —" }, ...operatorOptions]}
                          widthClass="w-full min-w-[120px]"
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
                      <div className="flex items-center justify-center" data-no-shift-select>
                        <a
                          href={`https://app.moobiz.pe/actives?id_driver=${encodeURIComponent(r.id_conductor)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Ver servicios en Moobiz"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center justify-center text-blue-500 hover:text-blue-600"
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

      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="sm:max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle>Solicitante masivo</DialogTitle>
          </DialogHeader>
          <div ref={setBulkModalPortalContainer}>
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
