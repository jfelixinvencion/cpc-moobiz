"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ArrowUpDown, ExternalLink, Loader2 } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { FlotaConductorNameSelect } from "@/components/flota/flota-conductor-name-select";
import { ProductividadFilterMulti } from "@/components/dashboard/productividad-filter-multi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  appendFlotaConductoresParams,
  type FlotaConductoresParsedParams,
  type FlotaConductoresSortCol,
  type FlotaConductoresSortDir,
} from "@/lib/flota-conductores-params";
import type { FlotaConductorRow, FlotaConductoresMeta } from "@/lib/flota-conductores-query";
import { formatDateForUi } from "@/lib/date-utils";
import { cn } from "@/lib/utils";

const MOOBIZ_DRIVER_URL = "https://app.moobiz.pe/drivers";

function moobizDriverHref(idConductor: string): string {
  return `${MOOBIZ_DRIVER_URL}?query=${encodeURIComponent(idConductor)}`;
}

function formatFechaActivacion(value: string | null | undefined): string {
  if (!value?.trim()) return "—";
  return formatDateForUi(value) || value.trim();
}

const BATCH = 100;
const ROW_H = 40;

type FilterState = {
  semanas: string[];
  global: string[];
  estado: string[];
  datosVenc: string[];
  datosFact: string[];
  distritos: string[];
  distritoText: string;
  nameId: string | null;
};

const EMPTY_FILTERS: FilterState = {
  semanas: [],
  global: [],
  estado: [],
  datosVenc: [],
  datosFact: [],
  distritos: [],
  distritoText: "",
  nameId: null,
};

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function filtersToParams(
  f: FilterState,
  sortCol: FlotaConductoresSortCol,
  sortDir: FlotaConductoresSortDir,
  limit: number,
  offset: number,
): FlotaConductoresParsedParams {
  const nullIf = (a: string[]) => (a.length === 0 ? null : a);
  return {
    selectedWeeks: nullIf(f.semanas),
    selectedGlobal: nullIf(f.global),
    selectedEstado: nullIf(f.estado),
    selectedDatosVenc: nullIf(f.datosVenc),
    selectedDatosFact: nullIf(f.datosFact),
    distritoText: f.distritoText.trim() || null,
    selectedDistritos: nullIf(f.distritos),
    selectedNameId: f.nameId,
    limit,
    offset,
    sortCol,
    sortDir,
  };
}

function buildQuery(
  f: FilterState,
  sortCol: FlotaConductoresSortCol,
  sortDir: FlotaConductoresSortDir,
  offset: number,
): string {
  const p = new URLSearchParams();
  appendFlotaConductoresParams(p, filtersToParams(f, sortCol, sortDir, BATCH, offset));
  return p.toString();
}

function SortIcon({
  active,
  dir,
}: {
  active: boolean;
  dir: FlotaConductoresSortDir;
}) {
  if (!active) return <ArrowUpDown className="ml-0.5 inline h-3 w-3 opacity-40" aria-hidden />;
  return dir === "asc" ? (
    <ArrowUp className="ml-0.5 inline h-3 w-3" aria-hidden />
  ) : (
    <ArrowDown className="ml-0.5 inline h-3 w-3" aria-hidden />
  );
}

export function FlotaConductoresPanel() {
  const parentRef = useRef<HTMLDivElement>(null);
  const loadingMoreRef = useRef(false);

  const [meta, setMeta] = useState<FlotaConductoresMeta | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);
  const [metaError, setMetaError] = useState<string | null>(null);

  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [metaReady, setMetaReady] = useState(false);
  const debouncedFilters = useDebounced(filters, 300);

  const [sortCol, setSortCol] = useState<FlotaConductoresSortCol>("n_servicios");
  const [sortDir, setSortDir] = useState<FlotaConductoresSortDir>("desc");

  const [rows, setRows] = useState<FlotaConductorRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const setFilter = useCallback(<K extends keyof FilterState>(key: K, value: FilterState[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setMetaLoading(true);
    setMetaError(null);
    void (async () => {
      try {
        const res = await fetch("/api/flota/conductores/meta", { cache: "no-store" });
        const body = (await res.json()) as FlotaConductoresMeta & { error?: string };
        if (!res.ok) throw new Error(body.error ?? res.statusText);
        if (cancelled) return;
        setMeta(body);
        if (body.defaultSemana) {
          setFilters((prev) => ({
            ...prev,
            semanas: prev.semanas.length === 0 ? [body.defaultSemana!] : prev.semanas,
          }));
        }
        setMetaReady(true);
      } catch (e) {
        if (!cancelled) setMetaError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setMetaLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadRows = useCallback(
    async (append: boolean, offset: number) => {
      if (!metaReady) return;
      if (append) {
        if (loadingMoreRef.current) return;
        loadingMoreRef.current = true;
      } else {
        setLoading(true);
        setLoadError(null);
      }
      try {
        const qs = buildQuery(debouncedFilters, sortCol, sortDir, offset);
        const res = await fetch(`/api/flota/conductores?${qs}`, { cache: "no-store" });
        const body = (await res.json()) as {
          rows?: FlotaConductorRow[];
          total?: number;
          error?: string;
        };
        if (!res.ok) throw new Error(body.error ?? res.statusText);
        const batch = body.rows ?? [];
        setTotal(body.total ?? 0);
        setRows((prev) => (append ? [...prev, ...batch] : batch));
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : String(e));
        if (!append) setRows([]);
      } finally {
        setLoading(false);
        loadingMoreRef.current = false;
      }
    },
    [debouncedFilters, metaReady, sortCol, sortDir],
  );

  useEffect(() => {
    if (!metaReady) return;
    setSelectedId(null);
    void loadRows(false, 0);
  }, [debouncedFilters, sortCol, sortDir, metaReady, loadRows]);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_H,
    overscan: 8,
  });

  const onScroll = useCallback(() => {
    const el = parentRef.current;
    if (!el || loading || loadingMoreRef.current) return;
    if (rows.length >= total) return;
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 120;
    if (!nearBottom) return;
    void loadRows(true, rows.length);
  }, [loadRows, loading, rows.length, total]);

  const toggleSort = (col: FlotaConductoresSortCol) => {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir(col === "n_servicios" ? "desc" : "asc");
    }
  };

  const gridCols = useMemo(
    () =>
      "grid grid-cols-[minmax(6rem,0.75fr)_minmax(8rem,1.4fr)_minmax(5rem,0.8fr)_minmax(7rem,1fr)_minmax(4rem,0.5fr)_minmax(5.5rem,0.65fr)_minmax(4.5rem,0.55fr)] gap-2",
    [],
  );

  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardHeader className="space-y-1 border-b border-slate-100 py-3">
        <CardTitle className="text-base font-semibold text-slate-900">Conductores</CardTitle>
        <p className="text-xs text-slate-500">
          Listado de conductores y número de servicios por conductor (filtrable por semana y
          atributos)
        </p>
        {metaError ? <p className="text-xs text-red-600">{metaError}</p> : null}
        {loadError ? <p className="text-xs text-red-600">{loadError}</p> : null}
      </CardHeader>
      <CardContent className="space-y-3 pt-3">
        <div className="flex flex-wrap items-end gap-3">
          <ProductividadFilterMulti
            label="Semana"
            options={meta?.semanaOptions ?? []}
            selected={filters.semanas}
            onChange={(v) => setFilter("semanas", v)}
            loading={metaLoading}
          />
          <ProductividadFilterMulti
            label="GLOBAL"
            options={meta?.globalOptions ?? []}
            selected={filters.global}
            onChange={(v) => setFilter("global", v)}
            loading={metaLoading}
          />
          <ProductividadFilterMulti
            label="Estado Conductor"
            options={meta?.estadoOptions ?? []}
            selected={filters.estado}
            onChange={(v) => setFilter("estado", v)}
            loading={metaLoading}
          />
          <ProductividadFilterMulti
            label="Datos Vencimiento"
            options={meta?.datosVencimientoOptions ?? []}
            selected={filters.datosVenc}
            onChange={(v) => setFilter("datosVenc", v)}
            loading={metaLoading}
          />
          <ProductividadFilterMulti
            label="Datos Facturacion"
            options={meta?.datosFacturacionOptions ?? []}
            selected={filters.datosFact}
            onChange={(v) => setFilter("datosFact", v)}
            loading={metaLoading}
          />
          <ProductividadFilterMulti
            label="En que distrito vive"
            options={meta?.distritoOptions ?? []}
            selected={filters.distritos}
            onChange={(v) => setFilter("distritos", v)}
            loading={metaLoading}
            className="min-w-[10rem]"
          />
          <div className="min-w-[9rem] space-y-1">
            <Label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Distrito (texto)
            </Label>
            <Input
              className="h-8 text-xs"
              placeholder="Buscar distrito…"
              value={filters.distritoText}
              onChange={(e) => setFilter("distritoText", e.target.value)}
            />
          </div>
          <FlotaConductorNameSelect
            options={meta?.nameOptions ?? []}
            value={filters.nameId}
            onChange={(v) => setFilter("nameId", v)}
            loading={metaLoading}
          />
        </div>

        <div className="flex items-center justify-between gap-2 text-xs text-slate-600">
          <span>
            {loading && rows.length === 0
              ? "Cargando…"
              : `${total.toLocaleString("es-PE")} registro${total === 1 ? "" : "s"}`}
            {rows.length < total ? ` · mostrando ${rows.length.toLocaleString("es-PE")}` : ""}
          </span>
          {loading && rows.length > 0 ? (
            <span className="inline-flex items-center gap-1 text-slate-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              Actualizando…
            </span>
          ) : null}
        </div>

        <div className="overflow-hidden rounded-lg border border-slate-200">
          <div
            className={cn(
              gridCols,
              "border-b border-slate-200 bg-slate-50 px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-600",
            )}
          >
            <span>ID Conductor</span>
            <span>Nombre Conductor</span>
            <span>Sucursal</span>
            <button
              type="button"
              className="flex items-center text-left hover:text-slate-900"
              onClick={() => toggleSort("distrito")}
            >
              En que distrito vive
              <SortIcon active={sortCol === "distrito"} dir={sortDir} />
            </button>
            <span>Turno</span>
            <span className="text-center">Fecha Activación</span>
            <button
              type="button"
              className="flex items-center justify-end text-right hover:text-slate-900"
              onClick={() => toggleSort("n_servicios")}
            >
              N_Servicios
              <SortIcon active={sortCol === "n_servicios"} dir={sortDir} />
            </button>
          </div>

          <div
            ref={parentRef}
            className="max-h-[min(680px,calc(100vh-320px))] overflow-auto"
            onScroll={onScroll}
          >
            {rows.length === 0 && !loading ? (
              <p className="p-6 text-center text-sm text-slate-500">Sin registros</p>
            ) : (
              <div
                className="relative w-full"
                style={{ height: rowVirtualizer.getTotalSize() }}
              >
                {rowVirtualizer.getVirtualItems().map((vi) => {
                  const row = rows[vi.index];
                  if (!row) return null;
                  const selected = selectedId === row.idConductor;
                  return (
                    <div
                      key={row.idConductor}
                      role="row"
                      tabIndex={0}
                      className={cn(
                        gridCols,
                        "absolute left-0 w-full cursor-pointer items-center border-b border-slate-100 px-2 text-xs transition-colors",
                        selected ? "bg-[#0f5666]/10 ring-1 ring-inset ring-[#0f5666]/30" : "hover:bg-slate-50",
                      )}
                      style={{
                        transform: `translateY(${vi.start}px)`,
                        height: vi.size,
                      }}
                      onClick={() => setSelectedId(row.idConductor)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedId(row.idConductor);
                        }
                      }}
                    >
                      <span className="flex min-w-0 items-center gap-1">
                        <span
                          className="truncate font-mono text-[11px]"
                          title={row.idConductor}
                        >
                          {row.idConductor}
                        </span>
                        <a
                          href={moobizDriverHref(row.idConductor)}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={`Abrir driver ${row.idConductor} en app.moobiz`}
                          aria-label={`Abrir driver ${row.idConductor} en app.moobiz`}
                          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-[#0f5666]"
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                        </a>
                      </span>
                      <span className="truncate" title={row.nombreConductor}>
                        {row.nombreConductor}
                      </span>
                      <span className="truncate" title={row.sucursal}>
                        {row.sucursal || "—"}
                      </span>
                      <span className="truncate" title={row.distrito}>
                        {row.distrito || "—"}
                      </span>
                      <span className="truncate" title={row.turno}>
                        {row.turno || "—"}
                      </span>
                      <span
                        className="truncate text-center tabular-nums text-[11px]"
                        title={row.fechaActivacion ?? ""}
                      >
                        {formatFechaActivacion(row.fechaActivacion)}
                      </span>
                      <span className="text-right tabular-nums font-semibold text-[#0f5666]">
                        {row.nServicios.toLocaleString("es-PE")}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            {loading && rows.length === 0 ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-[#2fb6b0]" aria-hidden />
              </div>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
