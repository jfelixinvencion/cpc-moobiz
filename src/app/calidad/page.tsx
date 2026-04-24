"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MouseRevealHeaderLayout } from "@/components/mouse-reveal-header-layout";
import { QualityAuditDetail } from "@/components/QualityAuditDetail";
import { QualityAuditForm } from "@/components/QualityAuditForm";
import { QualityAuditList } from "@/components/QualityAuditList";
import type { QualityAuditRecord } from "@/components/quality-audit-types";
import { formatApiError, formatErrorFromPayload } from "@/lib/format-api-error";

type ListResponse = {
  data?: QualityAuditRecord[];
  total?: number;
  error?: unknown;
  hint?: string;
};

const fetchPanel: typeof fetch = (input, init) =>
  fetch(input, { ...init, credentials: "same-origin" });

const TAB_AUDITORIA = "auditoria" as const;
const TAB_SEGUIMIENTO = "seguimiento" as const;

export default function CalidadPage() {
  const router = useRouter();
  const [subTab, setSubTab] = useState<typeof TAB_AUDITORIA | typeof TAB_SEGUIMIENTO>(TAB_AUDITORIA);
  const [audits, setAudits] = useState<QualityAuditRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [total, setTotal] = useState(0);
  const [driverIdFilter, setDriverIdFilter] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<QualityAuditRecord | null>(null);
  const [signedPhotos, setSignedPhotos] = useState<Array<{ path: string; signedUrl: string }>>([]);
  const [toast, setToast] = useState("");
  const listAbortRef = useRef<AbortController | null>(null);

  const qs = useMemo(() => {
    const p = new URLSearchParams({
      page: String(page),
      limit: String(limit),
    });
    if (driverIdFilter.trim()) p.set("driverId", driverIdFilter.trim());
    return p.toString();
  }, [driverIdFilter, limit, page]);

  const loadAudits = useCallback(async () => {
    listAbortRef.current?.abort();
    const ac = new AbortController();
    listAbortRef.current = ac;
    setLoading(true);
    setError("");
    try {
      const base =
        subTab === TAB_SEGUIMIENTO ? "/api/quality/audits/segimiento" : "/api/quality/audits";
      const res = await fetchPanel(`${base}?${qs}`, { signal: ac.signal });
      const data = (await res.json()) as ListResponse;
      if (!res.ok) {
        let msg = formatErrorFromPayload(data.error);
        if (!msg && data.error != null) msg = formatApiError(data.error);
        if (!msg) msg = `No se pudo cargar (${res.status}).`;
        if (typeof data.hint === "string" && data.hint.trim()) msg += ` — ${data.hint}`;
        throw new Error(msg);
      }
      setAudits(data.data ?? []);
      setTotal(data.total ?? 0);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : String(err));
      setAudits([]);
      setTotal(0);
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [qs, subTab]);

  useEffect(() => {
    void loadAudits();
  }, [loadAudits]);

  useEffect(() => {
    return () => {
      listAbortRef.current?.abort();
    };
  }, []);

  async function openDetail(id: string) {
    try {
      const res = await fetchPanel(`/api/quality/audits/${id}`);
      const data = (await res.json()) as {
        data?: QualityAuditRecord;
        signedPhotos?: Array<{ path: string; signedUrl: string }>;
        error?: string;
      };
      if (!res.ok || !data.data) throw new Error(data.error || "No se pudo cargar el detalle.");
      setSelected(data.data);
      setSignedPhotos(data.signedPhotos ?? []);
      setDetailOpen(true);
    } catch (err) {
      setToast(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <main className="flex min-h-screen flex-col bg-slate-100 text-slate-900">
      <MouseRevealHeaderLayout
        header={
          <div className="border-b border-white/10 bg-[#0b1131] text-white">
            <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between px-4 py-2 md:px-6">
              <div className="flex items-center gap-2">
                <span className="text-xl font-bold text-[#00e676]">moobiz.</span>
                <span className="text-sm text-white/75">Calidad</span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="border-[#00e676]/45 bg-transparent text-[#00e676] hover:bg-[#00e676]/15 hover:text-[#00e676]"
                  onClick={() => router.push("/")}
                >
                  Volver al panel
                </Button>
                <Button size="sm" className="bg-[#00e676] text-[#0b1131]" onClick={() => setFormOpen(true)}>
                  Nueva auditoría
                </Button>
              </div>
            </div>
          </div>
        }
      >
        <div className="mx-auto w-full max-w-[1600px] px-4 py-6 md:px-6">
          <Tabs
            value={subTab}
            onValueChange={(v) => {
              if (v !== TAB_AUDITORIA && v !== TAB_SEGUIMIENTO) return;
              setSubTab(v);
              setPage(1);
            }}
          >
            <TabsList className="mb-4 bg-slate-200/90">
              <TabsTrigger value={TAB_AUDITORIA}>Auditoría del Servicio</TabsTrigger>
              <TabsTrigger value={TAB_SEGUIMIENTO}>Seguimiento</TabsTrigger>
            </TabsList>
            <TabsContent value={TAB_AUDITORIA}>
              {error ? (
                <div className="mb-3 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700">{error}</div>
              ) : null}
              {loading ? <div className="mb-3 text-sm text-slate-600">Cargando...</div> : null}
              <QualityAuditList
                audits={audits}
                driverIdFilter={driverIdFilter}
                onDriverIdFilterChange={(value) => {
                  setPage(1);
                  setDriverIdFilter(value);
                }}
                page={page}
                limit={limit}
                total={total}
                onPageChange={setPage}
                onOpen={(id) => void openDetail(id)}
                filterInputId="quality-filter-driver-auditoria"
              />
            </TabsContent>
            <TabsContent value={TAB_SEGUIMIENTO}>
              <p className="mb-3 text-sm text-slate-600">
                Conductores cuya última auditoría (por ID de conductor) tiene resultado{" "}
                <span className="font-medium">Condicional</span> o <span className="font-medium">Rechazado</span>.
                Si luego reciben una auditoría <span className="font-medium">Aprobada</span>, dejan de aparecer aquí.
              </p>
              {error ? (
                <div className="mb-3 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700">{error}</div>
              ) : null}
              {loading ? <div className="mb-3 text-sm text-slate-600">Cargando...</div> : null}
              <QualityAuditList
                audits={audits}
                driverIdFilter={driverIdFilter}
                onDriverIdFilterChange={(value) => {
                  setPage(1);
                  setDriverIdFilter(value);
                }}
                page={page}
                limit={limit}
                total={total}
                onPageChange={setPage}
                onOpen={(id) => void openDetail(id)}
                filterInputId="quality-filter-driver-seguimiento"
                emptyLabel="Sin conductores en seguimiento"
              />
            </TabsContent>
          </Tabs>
        </div>
      </MouseRevealHeaderLayout>

      <QualityAuditForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setToast("Auditoría guardada.");
          void loadAudits();
        }}
      />
      {detailOpen ? (
        <QualityAuditDetail
          audit={selected}
          signedPhotos={signedPhotos}
          onClose={() => {
            setDetailOpen(false);
            setSelected(null);
            setSignedPhotos([]);
          }}
        />
      ) : null}

      {toast ? (
        <div className="fixed right-4 bottom-4 rounded bg-[#0b1131] px-3 py-2 text-sm text-white shadow">
          {toast}
          <button type="button" className="ml-3 text-[#00e676]" onClick={() => setToast("")}>
            Cerrar
          </button>
        </div>
      ) : null}
    </main>
  );
}
