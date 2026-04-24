"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CHECKLIST_ITEMS,
  type ChecklistAnswer,
  type QualityAuditRecord,
  type QualityResult,
} from "@/components/quality-audit-types";

const DRAFT_KEY = "quality_audit_draft";
const MAX_PHOTOS = 9;
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png"];

type ChecklistForm = Record<string, { answer: ChecklistAnswer; comment: string }>;

type FormState = {
  id: string;
  driverId: string;
  driverName: string;
  vehiclePlate: string;
  auditorName: string;
  createdAt: string;
  resultado: QualityResult;
  score: string;
  estado: string;
  usuarioEstado: string;
  notes: string;
  observacionesLibres: string;
  olor: "" | "Agradable" | "Neutral" | "Mal olor";
  ac: "" | "Frio/Tibio" | "No Funciona";
  checklist: ChecklistForm;
};

type Props = {
  open: boolean;
  initial?: QualityAuditRecord | null;
  onClose: () => void;
  onSaved: () => void;
};

function createEmptyChecklist(): ChecklistForm {
  const out: ChecklistForm = {};
  for (const item of CHECKLIST_ITEMS) out[item.key] = { answer: "na", comment: "" };
  return out;
}

function newFormState(): FormState {
  return {
    id: crypto.randomUUID(),
    driverId: "",
    driverName: "",
    vehiclePlate: "",
    auditorName: "",
    createdAt: new Date().toISOString(),
    resultado: "",
    score: "",
    estado: "",
    usuarioEstado: "",
    notes: "",
    observacionesLibres: "",
    olor: "",
    ac: "",
    checklist: createEmptyChecklist(),
  };
}

const fetchPanel: typeof fetch = (input, init) =>
  fetch(input, { ...init, credentials: "same-origin" });

export function QualityAuditForm({ open, initial, onClose, onSaved }: Props) {
  const [form, setForm] = useState<FormState>(newFormState);
  const [files, setFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function clearSelectedPhotos() {
    previewUrls.forEach((url) => URL.revokeObjectURL(url));
    setFiles([]);
    setPreviewUrls([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function resetFormCompletely() {
    setForm(newFormState());
    setError("");
    clearSelectedPhotos();
  }

  useEffect(() => {
    if (!open) return;
    if (initial) {
      clearSelectedPhotos();
      setForm({
        id: initial.id,
        driverId: initial.driver_id || "",
        driverName: initial.driver_name || "",
        vehiclePlate: initial.vehicle_plate || "",
        auditorName: initial.auditor_name || "",
        createdAt: initial.created_at,
        resultado: (initial.resultado || "") as QualityResult,
        score: initial.score ? String(initial.score) : "",
        estado: initial.estado || "",
        usuarioEstado: initial.usuario_estado || "",
        notes: initial.notes || "",
        observacionesLibres: String((initial.raw_data?.observaciones_libres as string) || ""),
        olor: ((initial.raw_data?.olor as string) || "") as FormState["olor"],
        ac: ((initial.raw_data?.ac as string) || "") as FormState["ac"],
        checklist: Object.fromEntries(
          CHECKLIST_ITEMS.map((item) => {
            const v = initial.checklist?.[item.key];
            return [item.key, { answer: v?.answer ?? "na", comment: v?.comment ?? "" }];
          }),
        ),
      });
      return;
    }
    clearSelectedPhotos();
    const draft = window.localStorage.getItem(DRAFT_KEY);
    if (draft) {
      try {
        setForm(JSON.parse(draft) as FormState);
      } catch {
        resetFormCompletely();
      }
    } else {
      resetFormCompletely();
    }
  }, [initial, open]);

  useEffect(() => {
    return () => {
      previewUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [previewUrls]);

  const photoCount = useMemo(() => files.length, [files.length]);

  function onPickPhotos(list: FileList | null) {
    if (!list) return;
    const selected = Array.from(list);
    const next = [...files, ...selected].slice(0, MAX_PHOTOS);
    for (const file of selected) {
      if (!ALLOWED.includes(file.type)) {
        setError("Solo se permiten fotos JPG/PNG.");
        return;
      }
      if (file.size > MAX_BYTES) {
        setError("Cada foto debe pesar máximo 5MB.");
        return;
      }
    }
    setError("");
    setFiles(next);
    previewUrls.forEach((url) => URL.revokeObjectURL(url));
    setPreviewUrls(next.map((file) => URL.createObjectURL(file)));
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removePhoto(indexToRemove: number) {
    const nextFiles = files.filter((_, index) => index !== indexToRemove);
    previewUrls.forEach((url) => URL.revokeObjectURL(url));
    setFiles(nextFiles);
    setPreviewUrls(nextFiles.map((file) => URL.createObjectURL(file)));
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function onDriverIdChange(raw: string) {
    const onlyNumbers = raw.replace(/\D/g, "").slice(0, 6);
    setForm({ ...form, driverId: onlyNumbers });
  }

  async function uploadAllPhotos(auditId: string): Promise<string[]> {
    const paths: string[] = [];
    for (const file of files) {
      const signRes = await fetchPanel("/api/quality/audits/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auditId,
          filename: file.name,
          contentType: file.type,
          size: file.size,
        }),
      });
      const signData = (await signRes.json()) as { signedUrl?: string; path?: string; error?: string };
      if (!signRes.ok || !signData.signedUrl || !signData.path) {
        throw new Error(signData.error || "No se pudo firmar una foto.");
      }
      const uploadRes = await fetch(signData.signedUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type, "x-upsert": "false" },
        body: file,
      });
      if (!uploadRes.ok) {
        throw new Error(`Falló upload de ${file.name}.`);
      }
      paths.push(signData.path);
    }
    return paths;
  }

  async function save(status: "draft" | "submitted") {
    setSaving(true);
    setError("");
    try {
      if (!form.driverId.trim() || !form.vehiclePlate.trim()) {
        throw new Error("Driver ID y Vehicle plate son obligatorios.");
      }
      if (status === "submitted" && files.length < 1) {
        throw new Error("Debes subir al menos 1 foto para enviar.");
      }
      if (status === "submitted" && !form.resultado) {
        throw new Error("La clasificación final es obligatoria al enviar.");
      }
      const photoPaths = files.length ? await uploadAllPhotos(form.id) : [];
      const payload = {
        id: form.id,
        driver_id: form.driverId.trim(),
        driver_name: form.driverName.trim() || null,
        vehicle_plate: form.vehiclePlate.trim(),
        auditor_name: form.auditorName.trim(),
        status,
        resultado: form.resultado || null,
        score: form.score ? Number.parseInt(form.score, 10) : null,
        estado: form.estado.trim() || null,
        usuario_estado: form.usuarioEstado.trim() || null,
        notes: form.notes.trim() || null,
        checklist: Object.fromEntries(
          Object.entries(form.checklist).map(([key, val]) => [
            key,
            { answer: val.answer, comment: val.comment.trim() || null },
          ]),
        ),
        foto_paths: photoPaths,
        raw_data: {
          olor: form.olor || null,
          ac: form.ac || null,
          observaciones_libres: form.observacionesLibres.trim() || null,
          created_at_visible: form.createdAt,
        },
      };
      const method = initial ? "PATCH" : "POST";
      const url = initial ? `/api/quality/audits/${form.id}` : "/api/quality/audits";
      const res = await fetchPanel(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error || "No se pudo guardar la auditoría.");
      }
      window.localStorage.removeItem(DRAFT_KEY);
      resetFormCompletely();
      onSaved();
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(form));
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <div className="max-h-[94vh] w-full max-w-5xl overflow-auto rounded-lg bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-semibold">{initial ? "Editar auditoría" : "Nueva auditoría"}</h3>
          <Button variant="outline" onClick={onClose}>
            Cerrar
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div>
            <Label>Driver ID *</Label>
            <Input
              value={form.driverId}
              onChange={(e) => onDriverIdChange(e.target.value)}
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              placeholder="Hasta 6 dígitos"
            />
          </div>
          <div>
            <Label>Nombre de Conductor</Label>
            <Input
              value={form.driverName}
              onChange={(e) => setForm({ ...form, driverName: e.target.value })}
              placeholder="Nombre completo"
            />
          </div>
          <div>
            <Label>Vehicle plate *</Label>
            <Input
              value={form.vehiclePlate}
              onChange={(e) => setForm({ ...form, vehiclePlate: e.target.value })}
            />
          </div>
          <div>
            <Label>Auditor name</Label>
            <Input
              value={form.auditorName}
              onChange={(e) => setForm({ ...form, auditorName: e.target.value })}
            />
          </div>
          <div>
            <Label>Fecha y hora (auto)</Label>
            <Input value={new Date(form.createdAt).toLocaleString("es-PE")} readOnly />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <Label>Olor</Label>
            <select
              className="h-9 w-full rounded border px-2 text-sm"
              value={form.olor}
              onChange={(e) => setForm({ ...form, olor: e.target.value as FormState["olor"] })}
            >
              <option value="">Seleccionar</option>
              <option value="Agradable">Agradable</option>
              <option value="Neutral">Neutral</option>
              <option value="Mal olor">Mal olor</option>
            </select>
          </div>
          <div>
            <Label>A/C</Label>
            <select
              className="h-9 w-full rounded border px-2 text-sm"
              value={form.ac}
              onChange={(e) => setForm({ ...form, ac: e.target.value as FormState["ac"] })}
            >
              <option value="">Seleccionar</option>
              <option value="Frio/Tibio">Frio/Tibio</option>
              <option value="No Funciona">No Funciona</option>
            </select>
          </div>
          <div>
            <Label>Clasificación final *</Label>
            <select
              className="h-9 w-full rounded border px-2 text-sm"
              value={form.resultado}
              onChange={(e) => setForm({ ...form, resultado: e.target.value as QualityResult })}
            >
              <option value="">Seleccionar</option>
              <option value="Aprobado">Aprobado</option>
              <option value="Condicional">Condicional</option>
              <option value="Rechazado">Rechazado</option>
            </select>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <h4 className="font-medium">Checklist</h4>
          {CHECKLIST_ITEMS.map((item) => (
            <div key={item.key} className="rounded border p-2">
              <div className="mb-2 text-sm font-medium">{item.label}</div>
              <div className="flex flex-wrap items-center gap-3">
                {(["yes", "no", "na"] as const).map((opt) => (
                  <label key={opt} className="text-sm">
                    <input
                      type="radio"
                      name={`check_${item.key}`}
                      checked={form.checklist[item.key]?.answer === opt}
                      onChange={() =>
                        setForm({
                          ...form,
                          checklist: {
                            ...form.checklist,
                            [item.key]: { ...form.checklist[item.key], answer: opt },
                          },
                        })
                      }
                    />{" "}
                    {opt.toUpperCase()}
                  </label>
                ))}
                <Input
                  placeholder="Comentario opcional (max 140)"
                  maxLength={140}
                  value={form.checklist[item.key]?.comment || ""}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      checklist: {
                        ...form.checklist,
                        [item.key]: { ...form.checklist[item.key], comment: e.target.value },
                      },
                    })
                  }
                  className="max-w-md"
                />
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 space-y-2">
          <Label>Observaciones libres</Label>
          <textarea
            className="min-h-20 w-full rounded border p-2 text-sm"
            value={form.observacionesLibres}
            onChange={(e) => setForm({ ...form, observacionesLibres: e.target.value })}
          />
        </div>

        <div className="mt-4 space-y-2">
          <Label>Fotos (1 a 9, jpg/png, max 5MB)</Label>
          <Input
            ref={fileInputRef}
            type="file"
            accept=".jpg,.jpeg,.png,image/jpeg,image/png"
            multiple
            onChange={(e) => onPickPhotos(e.target.files)}
          />
          <div className="text-sm text-slate-600">{photoCount} foto(s) seleccionadas</div>
          <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
            {previewUrls.map((url, index) => (
              <div key={url} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`preview-${index}`} className="h-24 w-full rounded object-cover" />
                <button
                  type="button"
                  onClick={() => removePhoto(index)}
                  className="absolute top-1 right-1 rounded bg-black/70 px-2 py-0.5 text-xs text-white hover:bg-black"
                  aria-label="Eliminar foto"
                >
                  Eliminar
                </button>
              </div>
            ))}
          </div>
        </div>

        {error ? <div className="mt-3 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700">{error}</div> : null}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => void save("draft")} disabled={saving}>
            Guardar borrador
          </Button>
          <Button onClick={() => void save("submitted")} disabled={saving}>
            {saving ? "Enviando..." : "Enviar"}
          </Button>
        </div>
      </div>
    </div>
  );
}
