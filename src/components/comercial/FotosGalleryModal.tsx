"use client";

import { ChevronLeft, ChevronRight, Copy, ExternalLink, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const fetchPanel: typeof fetch = (input, init) =>
  fetch(input, { ...init, credentials: "same-origin" });

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

function fileLabel(value: string, index: number): string {
  const trimmed = value.trim();
  if (!trimmed) return `Foto ${index + 1}`;
  try {
    if (isHttpUrl(trimmed)) {
      const u = new URL(trimmed);
      const last = u.pathname.split("/").filter(Boolean).pop();
      return last || `Foto ${index + 1}`;
    }
  } catch {
    /* ignore */
  }
  const parts = trimmed.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? `Foto ${index + 1}`;
}

type Props = {
  open: boolean;
  onClose: () => void;
  fotos?: string[];
  quejaId?: number;
};

export function FotosGalleryModal({ open, onClose, fotos = [], quejaId }: Props) {
  const [urls, setUrls] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);

  const loadUrls = useCallback(async () => {
    setError(null);
    setUrls(null);
    setLightboxIndex(null);
    setCopyMsg(null);

    const items = fotos.map((f) => String(f ?? "").trim()).filter(Boolean);
    const httpItems = items.filter(isHttpUrl);
    const pathItems = items.filter((item) => !isHttpUrl(item));

    if (items.length === 0 && !quejaId) {
      setUrls([]);
      return;
    }

    if (items.length > 0 && httpItems.length === items.length) {
      setUrls(httpItems);
      return;
    }

    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (quejaId != null) params.set("quejaId", String(quejaId));
      for (const p of pathItems) params.append("paths[]", p);

      if (!params.toString()) {
        setUrls(httpItems);
        return;
      }

      const res = await fetchPanel(`/api/comercial/fotos?${params.toString()}`);
      const json = (await res.json()) as {
        urls?: Array<{ path: string; url?: string; error?: string }>;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(json.error ?? "Error al cargar fotos");
      }

      const pathToUrl = new Map<string, string>();
      for (const entry of json.urls ?? []) {
        if (entry.url) pathToUrl.set(entry.path, entry.url);
      }

      const signedFromServer = (json.urls ?? [])
        .map((e) => e.url)
        .filter((u): u is string => Boolean(u));

      const resolvedFromItems = items
        .map((item) => (isHttpUrl(item) ? item : pathToUrl.get(item)))
        .filter((u): u is string => Boolean(u));

      const merged =
        resolvedFromItems.length > 0
          ? resolvedFromItems
          : items.length === 0
            ? signedFromServer
            : [];

      if (merged.length === 0) {
        setError("No se encontraron fotos");
        setUrls([]);
        return;
      }
      setUrls(merged);
    } catch (err) {
      console.error("FotosGalleryModal load error", err);
      setError(err instanceof Error ? err.message : "Error al cargar fotos");
      if (httpItems.length > 0) setUrls(httpItems);
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
            {error && !loading ? (
              <p className="py-6 text-center text-sm text-red-600">{error}</p>
            ) : null}
            {!loading && urls && urls.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">Sin fotos</p>
            ) : null}
            {!loading && urls && urls.length > 0 ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {urls.map((u, i) => (
                  <button
                    key={`${u}-${i}`}
                    type="button"
                    className="group relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#00e676]"
                    title={fileLabel(fotos[i] ?? u, i)}
                    onClick={() => setLightboxIndex(i)}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={u}
                      alt={fileLabel(fotos[i] ?? u, i)}
                      className="h-24 w-full object-cover transition-transform group-hover:scale-105"
                    />
                    <span className="absolute bottom-0 left-0 right-0 truncate bg-black/50 px-1 py-0.5 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                      {fileLabel(fotos[i] ?? u, i)}
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
