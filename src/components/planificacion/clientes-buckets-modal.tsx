"use client";

import { Loader2, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ClientesBucketBadge } from "@/components/planificacion/clientes-bucket-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ClientBucketLevel, ClientBucketRow } from "@/lib/client-buckets-types";
import {
  deleteClientBucketApi,
  searchClientBucketCompanies,
  upsertClientBucketApi,
} from "@/lib/client-buckets-client";
import type { ClientBucketCompanyOption } from "@/lib/client-buckets-types";

const LEVELS: ClientBucketLevel[] = [1, 2, 3];

type ClientesBucketsModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  buckets: ClientBucketRow[];
  onBucketsChange: (rows: ClientBucketRow[]) => void;
  onToast: (message: string, isError?: boolean) => void;
};

export function ClientesBucketsModal({
  open,
  onOpenChange,
  buckets,
  onBucketsChange,
  onToast,
}: ClientesBucketsModalProps) {
  const [searchByLevel, setSearchByLevel] = useState<Record<ClientBucketLevel, string>>({
    1: "",
    2: "",
    3: "",
  });
  const [searchResults, setSearchResults] = useState<
    Record<ClientBucketLevel, ClientBucketCompanyOption[]>
  >({ 1: [], 2: [], 3: [] });
  const [searching, setSearching] = useState<Record<ClientBucketLevel, boolean>>({
    1: false,
    2: false,
    3: false,
  });
  const [busyCoId, setBusyCoId] = useState<string | null>(null);

  const byLevel = useMemo(() => {
    const m: Record<ClientBucketLevel, ClientBucketRow[]> = { 1: [], 2: [], 3: [] };
    for (const b of buckets) {
      m[b.bucket_level].push(b);
    }
    for (const lvl of LEVELS) {
      m[lvl].sort((a, b) => a.co_name.localeCompare(b.co_name, "es"));
    }
    return m;
  }, [buckets]);

  const runSearch = useCallback(
    async (level: ClientBucketLevel, q: string) => {
      setSearchByLevel((prev) => ({ ...prev, [level]: q }));
      const trimmed = q.trim();
      if (trimmed.length < 2) {
        setSearchResults((prev) => ({ ...prev, [level]: [] }));
        return;
      }
      setSearching((prev) => ({ ...prev, [level]: true }));
      try {
        const data = await searchClientBucketCompanies(trimmed);
        setSearchResults((prev) => ({ ...prev, [level]: data }));
      } catch (e) {
        onToast(e instanceof Error ? e.message : "Error al buscar empresas", true);
      } finally {
        setSearching((prev) => ({ ...prev, [level]: false }));
      }
    },
    [onToast],
  );

  useEffect(() => {
    if (!open) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const level of LEVELS) {
      const q = searchByLevel[level];
      timers.push(
        setTimeout(() => {
          void runSearch(level, q);
        }, 300),
      );
    }
    return () => timers.forEach(clearTimeout);
  }, [open, searchByLevel, runSearch]);

  const assign = async (
    coId: string,
    coName: string,
    bucketLevel: ClientBucketLevel,
  ) => {
    setBusyCoId(coId);
    try {
      const row = await upsertClientBucketApi({
        co_id: coId,
        co_name: coName,
        bucket_level: bucketLevel,
      });
      const next = buckets.filter((b) => b.co_id !== coId);
      next.push(row);
      onBucketsChange(next);
      onToast(`${coName} asignada a Nivel ${bucketLevel}`);
      setSearchResults((prev) => ({ ...prev, [bucketLevel]: [] }));
      setSearchByLevel((prev) => ({ ...prev, [bucketLevel]: "" }));
    } catch (e) {
      onToast(e instanceof Error ? e.message : "No se pudo asignar", true);
    } finally {
      setBusyCoId(null);
    }
  };

  const remove = async (row: ClientBucketRow) => {
    setBusyCoId(row.co_id);
    try {
      await deleteClientBucketApi(row.co_id);
      onBucketsChange(buckets.filter((b) => b.co_id !== row.co_id));
      onToast(`${row.co_name} quitada de bolsas`);
    } catch (e) {
      onToast(e instanceof Error ? e.message : "No se pudo quitar", true);
    } finally {
      setBusyCoId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Gestionar bolsas (Nivel 1, 2 y 3)</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-slate-600">
          Una empresa solo puede estar en una bolsa. Al asignarla a otro nivel, se mueve
          automáticamente.
        </p>
        <div className="grid gap-4 md:grid-cols-3">
          {LEVELS.map((level) => (
            <div
              key={level}
              className="flex min-h-[280px] flex-col rounded-lg border border-slate-200 bg-slate-50/80"
            >
              <div className="border-b border-slate-200 px-3 py-2">
                <div className="flex items-center gap-2">
                  <ClientesBucketBadge level={level} />
                  <span className="text-sm font-semibold text-slate-800">Nivel {level}</span>
                  <span className="ml-auto text-xs text-slate-500">{byLevel[level].length}</span>
                </div>
              </div>
              <div className="space-y-2 border-b border-slate-200 p-2">
                <Label className="text-[10px] text-slate-500">Añadir empresa</Label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2 top-2.5 h-3.5 w-3.5 text-slate-400" />
                  <Input
                    value={searchByLevel[level]}
                    onChange={(e) =>
                      setSearchByLevel((prev) => ({ ...prev, [level]: e.target.value }))
                    }
                    placeholder="Buscar co_name..."
                    className="h-8 pl-7 text-xs"
                  />
                </div>
                {searching[level] && (
                  <p className="flex items-center gap-1 text-[10px] text-slate-500">
                    <Loader2 className="h-3 w-3 animate-spin" /> Buscando...
                  </p>
                )}
                {searchResults[level].length > 0 && (
                  <ul className="max-h-28 space-y-1 overflow-y-auto rounded border border-slate-200 bg-white p-1">
                    {searchResults[level].map((opt) => (
                      <li key={opt.co_id} className="flex items-center gap-1">
                        <span className="min-w-0 flex-1 truncate text-[11px]" title={opt.co_name}>
                          {opt.co_name}
                        </span>
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          className="h-6 shrink-0 px-1.5 text-[10px]"
                          disabled={busyCoId === opt.co_id}
                          onClick={() => void assign(opt.co_id, opt.co_name, level)}
                        >
                          Agregar
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <ul className="flex-1 space-y-1 overflow-y-auto p-2">
                {byLevel[level].map((row) => (
                  <li
                    key={row.co_id}
                    className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1"
                  >
                    <span className="min-w-0 flex-1 truncate text-xs font-medium" title={row.co_name}>
                      {row.co_name}
                    </span>
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      className="h-6 w-6 shrink-0 text-slate-500"
                      disabled={busyCoId === row.co_id}
                      title="Quitar de bolsas"
                      onClick={() => void remove(row)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
                {byLevel[level].length === 0 && (
                  <li className="py-4 text-center text-[11px] text-slate-400">Sin empresas</li>
                )}
              </ul>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
