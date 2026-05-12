"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const SUCURSAL_ALL = "__all__" as const;
const PRODUCTO_ALL = "__all__" as const;
const PAGE_SIZE = 25;

type Row = {
  "ID Servicio"?: unknown;
  Sucursal?: unknown;
  "F. Finalizado"?: unknown;
  Producto?: unknown;
  "Precio Total"?: unknown;
};

function asText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}

function formatFecha(v: unknown): string {
  const s = asText(v);
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short" });
}

function formatPrecio(v: unknown): string {
  if (v === null || v === undefined) return "—";
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return asText(v) || "—";
  return n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function FlotaPendientesCard() {
  const [sucursal, setSucursal] = useState<string>(SUCURSAL_ALL);
  const [producto, setProducto] = useState<string>(PRODUCTO_ALL);
  const [productOptions, setProductOptions] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncingHistory, setSyncingHistory] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(
    null,
  );

  const loadProducts = useCallback(async () => {
    setLoadingProducts(true);
    try {
      const res = await fetch("/api/flota-pendientes?meta=products", { cache: "no-store" });
      const body = (await res.json()) as { products?: string[]; error?: string };
      if (!res.ok) throw new Error(body?.error || "No se pudieron cargar productos.");
      setProductOptions(Array.isArray(body.products) ? body.products : []);
    } catch (e) {
      setProductOptions([]);
    } finally {
      setLoadingProducts(false);
    }
  }, []);

  const loadRows = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent);
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const p = new URLSearchParams();
      p.set("page", String(page));
      p.set("pageSize", String(PAGE_SIZE));
      if (sucursal !== SUCURSAL_ALL) p.set("sucursal", sucursal);
      if (producto !== PRODUCTO_ALL) p.set("producto", producto);
      const res = await fetch(`/api/flota-pendientes?${p.toString()}`, { cache: "no-store" });
      const body = (await res.json()) as {
        data?: Row[];
        total?: number;
        error?: string;
      };
      if (!res.ok) throw new Error(body?.error || "No se pudieron cargar los pendientes.");
      setRows(Array.isArray(body.data) ? body.data : []);
      setTotal(typeof body.total === "number" ? body.total : 0);
    } catch (e) {
      if (!silent) {
        setError(e instanceof Error ? e.message : String(e));
        setRows([]);
        setTotal(0);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [page, producto, sucursal]);

  const handleActualizarHistorial = async () => {
    setSyncingHistory(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/sync/moobiz-history", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
      });
      if (res.status === 204) {
        setFeedback({
          type: "success",
          message:
            "Sincronización iniciada en GitHub. Los datos tardarán unos minutos en actualizarse",
        });
        await new Promise((r) => window.setTimeout(r, 2000));
        await loadRows({ silent: true });
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body?.error || `Error ${res.status}`);
    } catch (e) {
      setFeedback({
        type: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSyncingHistory(false);
    }
  };

  useEffect(() => {
    if (!feedback) return;
    const t = window.setTimeout(() => setFeedback(null), 9000);
    return () => window.clearTimeout(t);
  }, [feedback]);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Card className="border-slate-200 bg-white text-slate-900 shadow-sm">
      <CardHeader className="flex flex-col gap-3 border-b border-slate-100 py-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          <CardTitle className="text-base font-semibold">Pendientes</CardTitle>
          <p className="text-xs text-slate-600">
            Servicios finalizados con precio total cero (vista{" "}
            <span className="font-mono text-[11px]">vista.vw_moobiz_31cols_pe</span>).
          </p>
        </div>
        <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 border-slate-300 bg-white text-xs text-slate-800 hover:bg-slate-50"
            disabled={syncingHistory || loading}
            onClick={() => void handleActualizarHistorial()}
          >
            {syncingHistory ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                Sincronizando...
              </>
            ) : (
              <>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                Actualizar historial
              </>
            )}
          </Button>
          <Badge variant="secondary" className="w-fit bg-slate-100 text-slate-700">
            {loading ? "…" : `${total} registro${total === 1 ? "" : "s"}`}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {feedback ? (
          <div
            role="status"
            className={
              feedback.type === "success"
                ? "rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
                : "rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900"
            }
          >
            {feedback.message}
          </div>
        ) : null}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:max-w-xl">
          <div className="space-y-1">
            <Label className="text-xs font-medium text-slate-700">Sucursal</Label>
            <Select value={sucursal} onValueChange={(v) => { setSucursal(v); setPage(1); }}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Sucursal" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SUCURSAL_ALL}>Todas</SelectItem>
                <SelectItem value="LIMA">LIMA</SelectItem>
                <SelectItem value="PROVINCIA">PROVINCIA</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-medium text-slate-700">Producto</Label>
            <Select value={producto} onValueChange={(v) => { setProducto(v); setPage(1); }} disabled={loadingProducts}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder={loadingProducts ? "Cargando…" : "Producto"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={PRODUCTO_ALL}>Todas</SelectItem>
                {productOptions.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {error ? (
          <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>
        ) : null}

        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <Table>
            <TableHeader>
              <TableRow className="border-slate-200 bg-slate-50 hover:bg-slate-50">
                <TableHead className="text-xs font-semibold text-slate-700">Sucursal</TableHead>
                <TableHead className="text-xs font-semibold text-slate-700">F. Finalizado</TableHead>
                <TableHead className="text-xs font-semibold text-slate-700">ID Servicio</TableHead>
                <TableHead className="text-xs font-semibold text-slate-700">Producto</TableHead>
                <TableHead className="text-xs font-semibold text-slate-700">Precio Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-sm text-slate-500">
                    Cargando…
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-sm text-slate-500">
                    Sin registros para los filtros seleccionados.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row, idx) => (
                  <TableRow key={`${asText(row["ID Servicio"])}-${idx}`} className="text-sm">
                    <TableCell className="font-medium">{asText(row.Sucursal)}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{formatFecha(row["F. Finalizado"])}</TableCell>
                    <TableCell className="font-mono text-xs">{asText(row["ID Servicio"])}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-xs">{asText(row.Producto)}</TableCell>
                    <TableCell className="text-xs">{formatPrecio(row["Precio Total"])}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <p className="text-xs text-slate-600">
            Página {page} de {totalPages} · {PAGE_SIZE} por página
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
            >
              Siguiente
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
