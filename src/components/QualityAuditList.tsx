"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { QualityAuditRecord } from "@/components/quality-audit-types";

type Props = {
  audits: QualityAuditRecord[];
  driverIdFilter: string;
  onDriverIdFilterChange: (value: string) => void;
  onOpen: (id: string) => void;
  page: number;
  total: number;
  limit: number;
  onPageChange: (next: number) => void;
  /** id único para el input de filtro (evita duplicados si hay dos listas montadas). */
  filterInputId?: string;
  emptyLabel?: string;
};

function sanitizeDriverIdInput(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 6);
}

export function QualityAuditList({
  audits,
  driverIdFilter,
  onDriverIdFilterChange,
  onOpen,
  page,
  total,
  limit,
  onPageChange,
  filterInputId = "quality-filter-driver-id",
  emptyLabel = "Sin auditorías",
}: Props) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-white p-3">
        <div className="max-w-xs space-y-1.5">
          <Label htmlFor={filterInputId}>Identificación del Conductor</Label>
          <Input
            id={filterInputId}
            value={driverIdFilter}
            onChange={(e) => onDriverIdFilterChange(sanitizeDriverIdInput(e.target.value))}
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            placeholder="Hasta 6 dígitos"
            className="h-9"
          />
        </div>
      </div>

      <div className="rounded-lg border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>ID Conductor</TableHead>
              <TableHead>Nombre Conductor</TableHead>
              <TableHead>Placa</TableHead>
              <TableHead>Resultado</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Fotos</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {audits.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-slate-500">
                  {emptyLabel}
                </TableCell>
              </TableRow>
            ) : (
              audits.map((row) => (
                <TableRow key={row.id} className="cursor-pointer" onClick={() => onOpen(row.id)}>
                  <TableCell>{new Date(row.created_at).toLocaleString("es-PE")}</TableCell>
                  <TableCell>{row.driver_id || "-"}</TableCell>
                  <TableCell>{row.driver_name || "-"}</TableCell>
                  <TableCell>{row.vehicle_plate || "-"}</TableCell>
                  <TableCell>{row.resultado || "-"}</TableCell>
                  <TableCell>{row.status}</TableCell>
                  <TableCell>{row.fotos_count ?? 0}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-600">
          Página {page} de {totalPages} ({total} registros)
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onPageChange(Math.max(1, page - 1))}
            className="rounded border px-3 py-1 text-sm disabled:opacity-40"
            disabled={page <= 1}
          >
            Anterior
          </button>
          <button
            type="button"
            onClick={() => onPageChange(Math.min(totalPages, page + 1))}
            className="rounded border px-3 py-1 text-sm disabled:opacity-40"
            disabled={page >= totalPages}
          >
            Siguiente
          </button>
        </div>
      </div>
    </div>
  );
}
