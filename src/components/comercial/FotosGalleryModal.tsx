"use client";

import { ChevronLeft, ChevronRight, Copy, ExternalLink, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const fetchPanel: typeof fetch = (input, init) =>
  fetch(input, { ...init, credentials: "same-origin" });

function fileLabelFromPath(path: string, index: number): string {
  const trimmed = path.trim();
  if (!trimmed) return `Foto ${index + 1}`;
  const parts = trimmed.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? `Foto ${index + 1}`;
}

type SignedEntry = { path: string; url?: string; error?: string };

type Props = {
  open: boolean;
  onClose: () => void;
  fotos?: string[];
  quejaId?: number;
};

export function FotosGalleryModal({ open, onClose, fotos = [], quejaId }: Props) {
  const [urls, setUrls] = useState<string[] | null>(null);
  const [pathLabels, setPathLabels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pathNotice, setPathNotice] = useState<string | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);

  const loadUrls = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPathNotice(null);
    setFetchFailed(false);
    setUrls(null);
    setPathLabels([]);
    setLightboxIndex(null);
    setCopyMsg(null);

    try {
      let endpoint = "";
      if (quejaId != null) {
        endpoint = `/api/comercial/fotos?quejaId=${encodeURIComponent(String(quejaId))}`;
      } else {
        const items = fotos.map((f) => String(f ?? "").trim()).filter(Boolean);
        if (items.length === 0) {
          setUrls([]);
          return;
        }
        const params = new URLSearchParams();
        for (const f of items) params.append("paths[]", f);
        endpoint = `/api/comercial/fotos?${params.toString()}`;
      }

      const res = await fetchPanel(endpoint);
      const json = (await res.json()) as {
        urls?: SignedEntry[];
        error?: string;
      };
      if (!res.ok) {
        throw new Error(json.error ?? "Error fetching signed urls");
      }

      const results = json.urls ?? [];
      const okUrls = results.map((item) => item.url).filter((u): u is string => Boolean(u));

      if (okUrls.length === 0) {
        console.log("API devolvió vacío para id:", quejaId, "respuesta:", results);
      }

      setUrls(okUrls);
      setPathLabels(
        results.filter((item) => item.url).map((item) => item.path),
      );

      const errs = results
        .filter((item) => item.error)
        .map((item) => `${item.path}: ${item.error}`);
      if (errs.length) {
        setPathNotice(`Algunas fotos no se pudieron cargar: ${errs.join("; ")}`);
      }
    } catch (e) {
      console.error("FotosGalleryModal load error", e);
      setFetchFailed(true);
      setError("Error al cargar fotos. Reintenta.");
      setUrls(null);
    } finally {
      setLoading(false);
    }
  }, [fotos, quejaId]);

  useEffect(() => {
    if (!open) return;
    void loadUrls();
  }, [open, loadUrls]);

  async function copyUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopyMsg("URL copiada");
      window.setTimeout(() => setCopyMsg(null), 2000);
    } catch {
      setCopyMsg("No se pudo copiar");
    }
  }

  if (!open) return null;

  const title = quejaId != null ? `Fotos — Queja #${quejaId}` : "Fotos";
  const currentUrl = lightboxIndex != null && urls ? urls[lightboxIndex] : null;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
        <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-lg bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cerrar
            </Button>
          </div>

          <div className="overflow-y-auto px-5 py-4">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-600">
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                Cargando fotos…
              </div>
            ) : null}

            {fetchFailed && !loading ? (
              <div className="flex flex-col items-center gap-3 py-8">
                <p className="text-center text-sm text-red-600">{error}</p>
                <Button type="button" variant="outline" size="sm" onClick={() => void loadUrls()}>
                  Reintentar
                </Button>
              </div>
            ) : null}

            {!loading && !fetchFailed && pathNotice ? (
              <p className="mb-3 text-center text-xs text-amber-700">{pathNotice}</p>
            ) : null}

            {!loading && !fetchFailed && urls && urls.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">Sin fotos</p>
            ) : null}

            {!loading && !fetchFailed && urls && urls.length > 0 ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {urls.map((u, i) => (
                  <button
                    key={`${u}-${i}`}
                    type="button"
                    className="group relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#00e676]"
                    title={fileLabelFromPath(pathLabels[i] ?? "", i)}
                    onClick={() => setLightboxIndex(i)}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={u}
                      alt={fileLabelFromPath(pathLabels[i] ?? "", i)}
                      className="h-24 w-full object-cover transition-transform group-hover:scale-105"
                    />
                    <span className="absolute bottom-0 left-0 right-0 truncate bg-black/50 px-1 py-0.5 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                      {fileLabelFromPath(pathLabels[i] ?? "", i)}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {lightboxIndex !== null && currentUrl ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-4"
          role="dialog"
          aria-modal
          aria-label="Vista ampliada"
        >
          <div className="relative max-w-4xl">
            <div className="absolute -top-10 right-0 flex items-center gap-2">
              {copyMsg ? (
                <span className="text-xs text-white/90">{copyMsg}</span>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="border-white/30 bg-white/10 text-white hover:bg-white/20"
                onClick={() => void copyUrl(currentUrl)}
                title="Copiar URL"
              >
                <Copy className="h-4 w-4" aria-hidden />
              </Button>
              <a
                href={currentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "inline-flex h-8 items-center justify-center rounded-md border border-white/30 bg-white/10 px-2 text-white hover:bg-white/20",
                )}
                title="Abrir en nueva pestaña"
              >
                <ExternalLink className="h-4 w-4" aria-hidden />
              </a>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="border-white/30 bg-white/10 text-white hover:bg-white/20"
                onClick={() => setLightboxIndex(null)}
              >
                <X className="h-4 w-4" aria-hidden />
              </Button>
            </div>

            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={currentUrl}
              alt={`Foto ${lightboxIndex + 1}`}
              className="max-h-[80vh] w-auto max-w-full rounded-lg object-contain"
            />

            {lightboxIndex > 0 ? (
              <button
                type="button"
                className="absolute left-0 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-2 shadow hover:bg-white"
                onClick={() => setLightboxIndex((i) => (i != null ? i - 1 : i))}
                aria-label="Foto anterior"
              >
                <ChevronLeft className="h-6 w-6 text-slate-800" />
              </button>
            ) : null}
            {urls && lightboxIndex < urls.length - 1 ? (
              <button
                type="button"
                className="absolute right-0 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-2 shadow hover:bg-white"
                onClick={() => setLightboxIndex((i) => (i != null ? i + 1 : i))}
                aria-label="Foto siguiente"
              >
                <ChevronRight className="h-6 w-6 text-slate-800" />
              </button>
            ) : null}

            <p className="mt-2 text-center text-xs text-white/80">
              {lightboxIndex + 1} / {urls?.length ?? 0}
            </p>
          </div>
        </div>
      ) : null}
    </>
  );
}
