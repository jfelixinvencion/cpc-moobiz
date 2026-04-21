"use client";

import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export type SyncMonitorRow = {
  id?: string | number;
  created_at?: string | null;
  inserted_at?: string | null;
  status?: string | null;
  records_inserted?: number | null;
  pages_queried?: number | null;
  last_id?: string | null;
  error_message?: string | null;
};

type HealthLevel = "green" | "yellow" | "red";

function rowTimestamp(row: SyncMonitorRow | null): Date | null {
  if (!row) return null;
  const raw = row.created_at ?? row.inserted_at ?? null;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function computeHealth(row: SyncMonitorRow | null): { level: HealthLevel; hint: string } {
  if (!row) {
    return { level: "red", hint: "Sin registros en sync_monitor" };
  }
  if (row.status === "error") {
    return { level: "red", hint: "Última corrida terminó en error" };
  }

  const ts = rowTimestamp(row);
  const ageMs = ts ? Date.now() - ts.getTime() : Number.POSITIVE_INFINITY;
  const twoH = 2 * 60 * 60 * 1000;
  const threeH = 3 * 60 * 60 * 1000;

  if (row.status === "success" && ts && ageMs < twoH) {
    return { level: "green", hint: "Sincronización reciente y correcta" };
  }
  if (row.status === "warning_backlog") {
    return { level: "yellow", hint: "Hay cola pendiente (warning_backlog)" };
  }
  if (ts && ageMs >= threeH) {
    return { level: "yellow", hint: "Lleva más de 3 horas sin sincronizar" };
  }
  if (row.status === "success" && (!ts || ageMs >= twoH)) {
    return { level: "yellow", hint: "Correcto pero ya pasaron más de 2 horas" };
  }

  return { level: "yellow", hint: "Revisar estado de la última corrida" };
}

const LEVEL_STYLES: Record<
  HealthLevel,
  { dot: string; ring: string; badge: string; label: string }
> = {
  green: {
    dot: "bg-emerald-500",
    ring: "ring-emerald-500/35",
    badge: "border-emerald-200 bg-emerald-50 text-emerald-900",
    label: "Saludable",
  },
  yellow: {
    dot: "bg-amber-400",
    ring: "ring-amber-400/40",
    badge: "border-amber-200 bg-amber-50 text-amber-950",
    label: "Atención",
  },
  red: {
    dot: "bg-red-500",
    ring: "ring-red-500/35",
    badge: "border-red-200 bg-red-50 text-red-900",
    label: "Crítico",
  },
};

type Props = {
  row: SyncMonitorRow | null;
  fetchError: string | null;
  loading: boolean;
};

export function LogsSyncHealthBanner({ row, fetchError, loading }: Props) {
  const [relTick, setRelTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setRelTick((n) => n + 1), 30000);
    return () => window.clearInterval(id);
  }, []);

  const health = useMemo(() => {
    if (fetchError && !row) {
      return { level: "red" as const, hint: `Error al consultar: ${fetchError}` };
    }
    return computeHealth(row);
  }, [row, fetchError]);

  const styles = LEVEL_STYLES[health.level];
  const ts = rowTimestamp(row);
  const relative = useMemo(() => {
    void relTick;
    if (ts == null) return "—";
    return formatDistanceToNow(ts, { addSuffix: true, locale: es });
  }, [ts, relTick]);

  const lastId = row?.last_id != null && String(row.last_id).trim() !== "" ? String(row.last_id) : "—";
  const inserted =
    row?.records_inserted != null && Number.isFinite(Number(row.records_inserted))
      ? String(row.records_inserted)
      : "0";

  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={`mt-0.5 inline-flex h-3.5 w-3.5 shrink-0 rounded-full ring-2 ring-offset-2 ring-offset-white ${styles.dot} ${styles.ring}`}
            aria-hidden
          />
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-slate-800">Sincronización de logs (Moobiz)</p>
              <Badge variant="outline" className={`text-[10px] font-semibold uppercase ${styles.badge}`}>
                {styles.label}
              </Badge>
            </div>
            <p className="text-xs text-slate-500">{health.hint}</p>
            {row?.status === "error" && row?.error_message ? (
              <p className="truncate text-xs text-red-700" title={row.error_message}>
                {row.error_message}
              </p>
            ) : null}
            {fetchError && row ? (
              <p className="text-xs text-amber-800">Aviso al cargar monitor: {fetchError}</p>
            ) : null}
          </div>
        </div>
        <dl className="grid shrink-0 grid-cols-1 gap-1 text-xs text-slate-600 sm:text-right">
          <div>
            <dt className="inline font-medium text-slate-500">Último ID: </dt>
            <dd className="inline font-mono text-slate-900">{lastId}</dd>
          </div>
          <div>
            <dt className="inline font-medium text-slate-500">Nuevos registros: </dt>
            <dd className="inline font-semibold text-slate-900">{inserted}</dd>
          </div>
          <div>
            <dt className="inline font-medium text-slate-500">Fecha: </dt>
            <dd className="inline text-slate-800">
              {loading ? "Cargando…" : relative}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
