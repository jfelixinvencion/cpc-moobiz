"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ComercialQuejaRow } from "@/components/comercial/types";
import { MAX_FOTOS_REVISION } from "@/lib/comercial-quejas";

const fetchPanel: typeof fetch = (input, init) =>
  fetch(input, { ...init, credentials: "same-origin" });

const ALLOWED = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 5 * 1024 * 1024;

type Props = {
  open: boolean;
  queja: ComercialQuejaRow | null;
  onClose: () => void;
  onSaved: (row: ComercialQuejaRow, estado: string) => void;
  onError: (message: string) => void;
};

export function ReviewModal({ open, queja, onClose, onSaved, onError }: Props) {
  const [respuesta, setRespuesta] = useState("");
  const [fechaRespuesta, setFechaRespuesta] = useState("");
  const [acciones, setAcciones] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [uploadedUrls, setUploadedUrls] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open || !queja) return;
    setRespuesta(queja.respuesta ?? "");
    setFechaRespuesta(queja.fecha_respuesta ?? "");
    setAcciones(queja.acciones ?? "");
    setFiles([]);
    setPreviews([]);
    setUploadedUrls([]);
    setError("");
  }, [open, queja]);

  function clearPreviews() {
    previews.forEach((u) => URL.revokeObjectURL(u));
    setPreviews([]);
    setFiles([]);
    if (fileRef.current) fileRef.current.value = "";
  }

  function onPickFiles(list: FileList | null) {
    if (!list?.length) return;
    const next = [...files, ...Array.from(list)];
    if (next.length > MAX_FOTOS_REVISION) {
      setError(`Máximo ${MAX_FOTOS_REVISION} fotos por revisión.`);
      return;
    }
    for (const f of Array.from(list)) {
      if (!ALLOWED.includes(f.type)) {
        setError("Solo JPEG, PNG o WebP.");
        return;
      }
      if (f.size > MAX_BYTES) {
        setError("Cada foto debe ser ≤ 5 MB.");
        return;
      }
    }
    setError("");
    const added = Array.from(list);
    setFiles(next);
    setPreviews((prev) => [...prev, ...added.map((f) => URL.createObjectURL(f))]);
  }

  function removeLocal(idx: number) {
    URL.revokeObjectURL(previews[idx]);
    setFiles((prev) => prev.filter((_, i) => i !== idx));
    setPreviews((prev) => prev.filter((_, i) => i !== idx));
  }

  async function uploadFiles(quejaId: number): Promise<string[]> {
    if (files.length === 0) return [];
    const fd = new FormData();
    fd.set("queja_id", String(quejaId));
    for (const f of files) fd.append("files", f);
    const res = await fetchPanel("/api/comercial/upload-photo", { method: "POST", body: fd });
    const data = (await res.json()) as { urls?: string[]; error?: string };
    if (!res.ok) throw new Error(data.error ?? "Error al subir fotos.");
    return data.urls ?? [];
  }

  async function handleSave() {
    if (!queja) return;
    setSaving(true);
    setError("");
    try {
      const newUrls = await uploadFiles(queja.id);
      const allUrls = [...uploadedUrls, ...newUrls];
      const res = await fetchPanel(`/api/comercial/quejas/${queja.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          respuesta: respuesta.trim() || null,
          fecha_respuesta: fechaRespuesta || null,
          acciones: acciones.trim() || null,
          fotos_urls: allUrls,
        }),
      });
      const data = (await res.json()) as {
        data?: ComercialQuejaRow;
        estado_registro?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "No se pudo guardar la revisión.");
      const estado = data.estado_registro ?? data.data?.estado_registro ?? "En revision";
      clearPreviews();
      onSaved(data.data!, estado);
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      onError(msg);
    } finally {
      setSaving(false);
    }
  }

  if (!open || !queja) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white shadow-xl">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-lg font-semibold text-slate-900">Revisar queja #{queja.id}</h2>
          <p className="text-xs text-slate-500">Servicio {queja.id_servicio}</p>
        </div>
        <div className="space-y-3 px-5 py-4">
          <div className="space-y-1">
            <Label>Respuesta</Label>
            <textarea
              className="min-h-[80px] w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              value={respuesta}
              onChange={(e) => setRespuesta(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>Fecha respuesta</Label>
            <Input
              type="date"
              value={fechaRespuesta}
              onChange={(e) => setFechaRespuesta(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>Acciones</Label>
            <textarea
              className="min-h-[60px] w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              value={acciones}
              onChange={(e) => setAcciones(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>Fotos (máx. {MAX_FOTOS_REVISION})</Label>
            <input
              ref={fileRef}
              type="file"
              accept={ALLOWED.join(",")}
              multiple
              className="text-xs"
              onChange={(e) => onPickFiles(e.target.files)}
            />
            <div className="flex flex-wrap gap-2 pt-2">
              {previews.map((url, i) => (
                <div key={url} className="relative h-16 w-16 overflow-hidden rounded border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    className="absolute right-0 top-0 bg-black/60 p-0.5 text-white"
                    onClick={() => removeLocal(i)}
                    aria-label="Quitar foto"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button
            type="button"
            className="bg-[#00e676] text-[#0b1131] hover:bg-[#00c853]"
            disabled={saving}
            onClick={() => void handleSave()}
          >
            {saving ? "Guardando…" : "Guardar revisión"}
          </Button>
        </div>
      </div>
    </div>
  );
}
