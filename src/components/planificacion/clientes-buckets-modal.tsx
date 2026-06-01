"use client";

import { X } from "lucide-react";
import { useMemo, useState } from "react";

import { ClientesBucketBadge } from "@/components/planificacion/clientes-bucket-badge";
import { ClientesBucketCompanySearch } from "@/components/planificacion/clientes-bucket-company-search";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  deleteClientBucketApi,
  upsertClientBucketApi,
} from "@/lib/client-buckets-client";
import type {
  ClientBucketCompanyOption,
  ClientBucketLevel,
  ClientBucketRow,
} from "@/lib/client-buckets-types";

const LEVELS: ClientBucketLevel[] = [1, 2, 3];

/** Ancho cómodo en desktop; responsive en móvil (solo Clientes). */
export const CLIENTES_BUCKETS_MODAL_CLASS =
  "clientes-buckets-modal max-h-[92vh] w-[95vw] max-w-[1100px] gap-4 overflow-y-auto sm:max-w-[1100px]";

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

  const assign = async (
    company: ClientBucketCompanyOption,
    bucketLevel: ClientBucketLevel,
  ) => {
    setBusyCoId(company.co_id);
    try {
      const row = await upsertClientBucketApi({
        co_id: company.co_id,
        co_name: company.co_name,
        bucket_level: bucketLevel,
      });
      const next = buckets.filter((b) => b.co_id !== company.co_id);
      next.push(row);
      onBucketsChange(next);
      onToast(`${company.co_name} asignada a Nivel ${bucketLevel}`);
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
      <DialogContent className={CLIENTES_BUCKETS_MODAL_CLASS}>
        <DialogHeader>
          <DialogTitle>Gestionar bolsas (Nivel 1, 2 y 3)</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-slate-600">
          Una empresa solo puede estar en una bolsa. Al asignarla a otro nivel, se mueve
          automáticamente. Busque, seleccione una fila y pulse Agregar.
        </p>
        <div className="grid gap-4 md:grid-cols-3">
          {LEVELS.map((level) => (
            <div
              key={level}
              className="flex min-h-[320px] flex-col rounded-lg border border-slate-200 bg-slate-50/80"
            >
              <div className="border-b border-slate-200 px-3 py-2">
                <div className="flex items-center gap-2">
                  <ClientesBucketBadge level={level} />
                  <span className="text-sm font-semibold text-slate-800">Nivel {level}</span>
                  <span className="ml-auto text-xs text-slate-500">{byLevel[level].length}</span>
                </div>
              </div>

              {open ? (
                <ClientesBucketCompanySearch
                  levelLabel={`Nivel ${level}`}
                  disabled={busyCoId != null}
                  onAdd={(company) => void assign(company, level)}
                  onError={(msg) => onToast(msg, true)}
                />
              ) : null}

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
