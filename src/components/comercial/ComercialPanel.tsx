"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ArrowUpDown, Loader2, Trash2 } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { MoobizServiceLink } from "@/components/comercial/moobiz-service-link";
import { QuejaModal } from "@/components/comercial/QuejaModal";
import { ReviewModal } from "@/components/comercial/ReviewModal";
import type { ComercialQuejaRow } from "@/components/comercial/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  appendComercialQuejasParams,
  type ComercialQuejasListParams,
  type ComercialQuejasSortCol,
  type ComercialQuejasSortDir,
} from "@/lib/comercial-quejas-params";
import { formatLimaDate } from "@/lib/date-utils";
import { cn } from "@/lib/utils";

const BATCH = 100;
const ROW_H = 44;

const ESTADO_REGISTRO_OPTIONS = ["Pendiente", "En revision", "Completado"] as const;

type PanelSortCol = ComercialQuejasSortCol | "estado_registro";

const fetchPanel: typeof fetch = (input, init) =>
  fetch(input, { ...init, credentials: "same-origin" });

function estadoRegistroBadgeClass(value: string | null | undefined): string {
  const base =
    "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium";
  const v = value ?? "";
  if (v === "Pendiente") return `${base} border-yellow-200 bg-yellow-100 text-yellow-800`;
  if (v === "En revision") return `${base} bg-blue-100 text-blue-800`;
  if (v === "Completado") return `${base} bg-green-100 text-green-800`;
  return `${base} bg-gray-100 text-gray-800`;
}

function EstadoRegistroBadge({ value }: { value: string | null | undefined }) {
  const label = value?.trim() || "—";
  return (
    <span className={estadoRegistroBadgeClass(value)} title={value ?? undefined}>
      {label}
    </span>
  );
}

type Props = {
  createOpen?: boolean;
  onCreateOpenChange?: (open: boolean) => void;
  onToast: (message: string) => void;
  onErrorToast: (message: string) => void;
};

function SortIcon({
  active,
  dir,
}: {
  active: boolean;
  dir: ComercialQuejasSortDir;
}) {
  if (!active) return <ArrowUpDown className="ml-0.5 inline h-3 w-3 opacity-40" aria-hidden />;
  return dir === "asc" ? (
    <ArrowUp className="ml-0.5 inline h-3 w-3" aria-hidden />
  ) : (
    <ArrowDown className="ml-0.5 inline h-3 w-3" aria-hidden />
  );
}

export function ComercialPanel({
  createOpen: createOpenProp,
  onCreateOpenChange,
  onToast,
  onErrorToast,
}: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const loadingMoreRef = useRef(false);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [estadoRegistroFilter, setEstadoRegistroFilter] = useState("");
  const [sortCol, setSortCol] = useState<PanelSortCol>("created_at");
  const [sortDir, setSortDir] = useState<ComercialQuejasSortDir>("desc");

  const [rows, setRows] = useState<ComercialQuejaRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [modalMode, setModalMode] = useState<"create" | "edit" | null>(null);

  useEffect(() => {
    if (createOpenProp) {
      setSelected(null);
      setModalMode("create");
      onCreateOpenChange?.(false);
    }
  }, [createOpenProp, onCreateOpenChange]);
  const [selected, setSelected] = useState<ComercialQuejaRow | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ComercialQuejaRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const listParams = useMemo((): ComercialQuejasListParams => {
    const apiSortCol: ComercialQuejasSortCol =
      sortCol === "estado_registro" ? "created_at" : sortCol;
    return {
      limit: BATCH,
      offset: 0,
      search: debouncedSearch || null,
      idServicio: null,
      estadoRegistro: estadoRegistroFilter || null,
      fechaFrom: null,
      fechaTo: null,
      sortCol: apiSortCol,
      sortDir,
    };
  }, [debouncedSearch, estadoRegistroFilter, sortCol, sortDir]);

  const displayRows = useMemo(() => {
    if (sortCol !== "estado_registro") return rows;
    return [...rows].sort((a, b) => {
      const cmp = (a.estado_registro ?? "").localeCompare(b.estado_registro ?? "", "es");
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [rows, sortCol, sortDir]);

  const loadRows = useCallback(
    async (append: boolean, offset: number) => {
      if (append) {
        if (loadingMoreRef.current) return;
        loadingMoreRef.current = true;
      } else {
        setLoading(true);
        setLoadError(null);
      }
      try {
        const p = new URLSearchParams();
        appendComercialQuejasParams(p, { ...listParams, offset });
        const res = await fetchPanel(`/api/comercial/quejas?${p.toString()}`, {
          cache: "no-store",
        });
        const body = (await res.json()) as {
          data?: ComercialQuejaRow[];
          total?: number;
          error?: string;
        };
        if (!res.ok) throw new Error(body.error ?? res.statusText);
        const batch = body.data ?? [];
        setTotal(body.total ?? 0);
        setRows((prev) => (append ? [...prev, ...batch] : batch));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setLoadError(msg);
        if (!append) setRows([]);
      } finally {
        setLoading(false);
        loadingMoreRef.current = false;
      }
    },
    [listParams],
  );

  useEffect(() => {
    void loadRows(false, 0);
  }, [loadRows]);

  const rowVirtualizer = useVirtualizer({
    count: displayRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_H,
    overscan: 10,
  });

  const onScroll = useCallback(() => {
    const el = parentRef.current;
    if (!el || loading || loadingMoreRef.current) return;
    if (rows.length >= total) return;
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 160;
    if (!nearBottom) return;
    void loadRows(true, rows.length);
  }, [loadRows, loading, rows.length, total]);

  const toggleSort = (col: PanelSortCol) => {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("desc");
    }
  };

  const refresh = () => void loadRows(false, 0);

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetchPanel(`/api/comercial/quejas/${deleteTarget.id}`, {
        method: "DELETE",
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "No se pudo eliminar.");
      onToast(`Queja #${deleteTarget.id} eliminada.`);
      setDeleteTarget(null);
      refresh();
    } catch (e) {
      onErrorToast(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }

  const gridCols =
    "grid grid-cols-[3.5rem_minmax(5rem,6rem)_5.5rem_minmax(7rem,9rem)_5rem_minmax(6.5rem,8rem)_minmax(5rem,6rem)_minmax(5rem,6rem)_minmax(5rem,6rem)_4rem_4.5rem_minmax(5rem,1fr)_4rem_minmax(11rem,13rem)] items-center gap-1";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Comercial — Registro de Quejas</h1>
          <p className="text-xs text-slate-500">
            {loading && rows.length === 0
              ? "Cargando…"
              : `${total.toLocaleString("es-PE")} registro${total === 1 ? "" : "s"}`}
            {rows.length < total
              ? ` · mostrando ${rows.length.toLocaleString("es-PE")}`
              : ""}
          </p>
        </div>
        <Button
          type="button"
          className="bg-[#00e676] text-[#0b1131] hover:bg-[#00c853]"
          onClick={() => {
            setSelected(null);
            setModalMode("create");
          }}
        >
          Nuevo
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[12rem] flex-1 space-y-1">
          <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Buscar
          </label>
          <Input
            className="h-8 text-xs"
            placeholder="ID, empresa, pasajero, categoría…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="min-w-[10rem] space-y-1">
          <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Estado registro
          </label>
          <select
            className="flex h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs"
            value={estadoRegistroFilter}
            onChange={(e) => setEstadoRegistroFilter(e.target.value)}
          >
            <option value="">Todos</option>
            {ESTADO_REGISTRO_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loadError ? <p className="text-sm text-red-600">{loadError}</p> : null}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <div
          className={cn(
            gridCols,
            "min-w-[1240px] border-b border-slate-200 bg-slate-50 px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-600",
          )}
        >
          <span>Item</span>
          <span>Empresa</span>
          <button type="button" className="flex items-center text-left" onClick={() => toggleSort("fecha_queja")}>
            Fecha queja
            <SortIcon active={sortCol === "fecha_queja"} dir={sortDir} />
          </button>
          <span>ID Servicio</span>
          <span>Estado</span>
          <button
            type="button"
            className="flex items-center text-left"
            onClick={() => toggleSort("estado_registro")}
          >
            <span className="hidden sm:inline">Estado registro</span>
            <span className="sm:hidden">Est. reg.</span>
            <SortIcon active={sortCol === "estado_registro"} dir={sortDir} />
          </button>
          <span>Usuario</span>
          <span>Pasajero</span>
          <span>Conductor</span>
          <span>Turno</span>
          <span>Categoría</span>
          <span>Descripción</span>
          <span>Fuente</span>
          <span className="text-right">Acciones</span>
        </div>

        <div
          ref={parentRef}
          className="max-h-[calc(100vh-16rem)] min-w-[1240px] overflow-y-auto"
          onScroll={onScroll}
        >
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((vi) => {
              const row = displayRows[vi.index];
              if (!row) return null;
              return (
                <div
                  key={row.id}
                  className={cn(
                    gridCols,
                    "absolute left-0 top-0 w-full border-b border-slate-100 px-2 text-xs text-slate-800",
                    vi.index % 2 === 0 ? "bg-white" : "bg-slate-50/50",
                  )}
                  role="row"
                  style={{
                    height: `${vi.size}px`,
                    transform: `translateY(${vi.start}px)`,
                  }}
                >
                  <span className="min-w-0 truncate py-2 font-mono">{row.id}</span>
                  <span
                    className="min-w-0 truncate py-2"
                    title={row.empresa ?? ""}
                  >
                    {row.empresa ?? "—"}
                  </span>
                  <span className="min-w-0 truncate py-2">{formatLimaDate(row.fecha_queja)}</span>
                  <div className="flex min-w-0 max-w-full items-center gap-2 py-2">
                    <span
                      className="min-w-0 flex-1 truncate font-mono text-xs text-slate-700"
                      title={row.id_servicio}
                    >
                      {row.id_servicio}
                    </span>
                    <MoobizServiceLink
                      idServicio={row.id_servicio}
                      className="h-6 w-6 shrink-0"
                    />
                  </div>
                  <span
                    className="min-w-0 truncate py-2"
                    title={row.estado_servicio ?? ""}
                  >
                    {row.estado_servicio ?? "—"}
                  </span>
                  <div className="flex items-center py-2">
                    <EstadoRegistroBadge value={row.estado_registro} />
                  </div>
                  <span className="min-w-0 truncate py-2" title={row.usuario ?? ""}>
                    {row.usuario ?? "—"}
                  </span>
                  <span className="min-w-0 truncate py-2" title={row.pasajero ?? ""}>
                    {row.pasajero ?? "—"}
                  </span>
                  <span className="min-w-0 truncate py-2" title={row.conductor ?? ""}>
                    {row.conductor ?? "—"}
                  </span>
                  <span className="min-w-0 truncate py-2">{row.turno ?? "—"}</span>
                  <span className="min-w-0 truncate py-2" title={row.categoria ?? ""}>
                    {row.categoria ?? "—"}
                  </span>
                  <span className="min-w-0 truncate py-2" title={row.descripcion ?? ""}>
                    {row.descripcion ?? "—"}
                  </span>
                  <span className="min-w-0 truncate py-2">{row.fuente ?? "—"}</span>
                  <div className="flex shrink-0 items-center justify-end gap-2 py-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 shrink-0 px-2 text-[10px]"
                      onClick={() => {
                        setSelected(row);
                        setModalMode("edit");
                      }}
                    >
                      Editar
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 shrink-0 px-2 text-[10px]"
                      onClick={() => {
                        setSelected(row);
                        setReviewOpen(true);
                      }}
                    >
                      Revisar
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 w-7 shrink-0 p-0 text-red-600"
                      onClick={() => setDeleteTarget(row)}
                      aria-label="Eliminar"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          {loading && rows.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Cargando registros…
            </div>
          ) : null}
          {!loading && rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">Sin quejas registradas.</p>
          ) : null}
        </div>
      </div>

      <QuejaModal
        open={modalMode !== null}
        mode={modalMode === "edit" ? "edit" : "create"}
        initial={modalMode === "edit" ? selected : null}
        onClose={() => setModalMode(null)}
        onSaved={(_row, msg) => {
          onToast(msg);
          refresh();
        }}
        onError={onErrorToast}
      />

      <ReviewModal
        open={reviewOpen}
        queja={selected}
        onClose={() => setReviewOpen(false)}
        onSaved={(_row, estado) => {
          onToast(`Revisión guardada. Estado: ${estado}`);
          refresh();
        }}
        onError={onErrorToast}
      />

      {deleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
            <h3 className="text-base font-semibold text-slate-900">Eliminar queja #{deleteTarget.id}</h3>
            <p className="mt-2 text-sm text-slate-600">
              Se eliminará y no podrá recuperarse. ¿Continuar?
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
                Cancelar
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={deleting}
                onClick={() => void confirmDelete()}
              >
                {deleting ? "Eliminando…" : "Eliminar"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
