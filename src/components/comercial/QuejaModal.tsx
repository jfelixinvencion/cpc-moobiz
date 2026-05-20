"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoobizServiceLink } from "@/components/comercial/moobiz-service-link";
import type { ComercialQuejaRow } from "@/components/comercial/types";
import { FUENTES, TURNOS } from "@/components/comercial/types";
import { ID_SERVICIO_REGEX } from "@/lib/comercial-quejas";
import { formatErrorFromPayload } from "@/lib/format-api-error";

const fetchPanel: typeof fetch = (input, init) =>
  fetch(input, { ...init, credentials: "same-origin" });

type SyncFields = {
  estado_servicio?: string | null;
  empresa?: string | null;
  usuario?: string | null;
  invitado?: string | null;
  conductor?: string | null;
  turno?: string | null;
};

type FormState = {
  fecha_queja: string;
  id_servicio: string;
  estado_servicio: string;
  empresa: string;
  usuario: string;
  invitado: string;
  conductor: string;
  turno: string;
  categoria: string;
  descripcion: string;
  fuente: string;
};

type FieldErrors = Partial<Record<"turno" | "categoria" | "descripcion" | "fuente", string>>;

function emptyForm(): FormState {
  return {
    fecha_queja: new Date().toISOString().slice(0, 10),
    id_servicio: "",
    estado_servicio: "",
    empresa: "",
    usuario: "",
    invitado: "",
    conductor: "",
    turno: "",
    categoria: "",
    descripcion: "",
    fuente: "",
  };
}

function fromRow(row: ComercialQuejaRow): FormState {
  return {
    fecha_queja: row.fecha_queja,
    id_servicio: row.id_servicio,
    estado_servicio: row.estado_servicio ?? "",
    empresa: row.empresa ?? "",
    usuario: row.usuario ?? "",
    invitado: row.invitado ?? "",
    conductor: row.conductor ?? "",
    turno: row.turno ?? "",
    categoria: row.categoria ?? "",
    descripcion: row.descripcion ?? "",
    fuente: row.fuente ?? "",
  };
}

function pasajeroDisplay(inv: string, usr: string): string {
  const i = inv.trim();
  if (i) return i;
  return usr.trim();
}

function validateEditForm(form: FormState): FieldErrors {
  const errors: FieldErrors = {};
  if (!form.turno || !TURNOS.includes(form.turno as (typeof TURNOS)[number])) {
    errors.turno = "Seleccione un turno válido (Mañana, Tarde o Noche).";
  }
  if (!form.categoria.trim()) {
    errors.categoria = "La categoría es obligatoria.";
  }
  if (form.descripcion.trim().length < 3) {
    errors.descripcion = "La descripción es obligatoria (mínimo 3 caracteres).";
  }
  if (!form.fuente || !FUENTES.includes(form.fuente as (typeof FUENTES)[number])) {
    errors.fuente = "Seleccione una fuente válida.";
  }
  return errors;
}

type Props = {
  open: boolean;
  mode: "create" | "edit";
  initial?: ComercialQuejaRow | null;
  onClose: () => void;
  onSaved: (row: ComercialQuejaRow, message: string) => void;
  onError: (message: string) => void;
};

export function QuejaModal({ open, mode, initial, onClose, onSaved, onError }: Props) {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [syncWarning, setSyncWarning] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const isEdit = mode === "edit";
  const idValid = ID_SERVICIO_REGEX.test(form.id_servicio.trim());

  useEffect(() => {
    if (!open) return;
    setError("");
    setSyncWarning("");
    setFieldErrors({});
    setForm(initial ? fromRow(initial) : emptyForm());
  }, [open, initial]);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (isEdit && fieldErrors[key as keyof FieldErrors]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[key as keyof FieldErrors];
        return next;
      });
    }
  }

  async function handleSync() {
    if (!idValid) {
      setError("ID Servicio debe tener exactamente 7 dígitos.");
      return;
    }
    setSyncing(true);
    setError("");
    try {
      const res = await fetchPanel(
        `/api/comercial/sync-service?id_servicio=${encodeURIComponent(form.id_servicio.trim())}`,
      );
      const data = (await res.json()) as SyncFields & {
        error?: string;
        estado?: string | null;
        estado_servicio?: string | null;
      };
      if (!res.ok) {
        const msg = data.error ?? formatErrorFromPayload(data) ?? "No se pudo sincronizar.";
        onError(msg);
        setError(msg);
        return;
      }
      setForm((prev) => ({
        ...prev,
        estado_servicio: data.estado_servicio ?? data.estado ?? "",
        empresa: data.empresa ?? "",
        usuario: data.usuario ?? "",
        invitado: data.invitado ?? "",
        conductor: data.conductor ?? "",
        turno: data.turno && TURNOS.includes(data.turno as (typeof TURNOS)[number])
          ? data.turno
          : prev.turno,
      }));
      setSyncWarning("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      onError(msg);
    } finally {
      setSyncing(false);
    }
  }

  async function handleSave() {
    setError("");

    if (isEdit && initial) {
      const errors = validateEditForm(form);
      if (Object.keys(errors).length > 0) {
        setFieldErrors(errors);
        setError("Corrija los campos marcados antes de guardar.");
        return;
      }
      setFieldErrors({});
      setSaving(true);
      try {
        const res = await fetchPanel(`/api/comercial/quejas/${initial.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            turno: form.turno,
            categoria: form.categoria.trim(),
            descripcion: form.descripcion.trim(),
            fuente: form.fuente,
          }),
        });
        const data = (await res.json()) as { data?: ComercialQuejaRow; error?: string };
        if (!res.ok) {
          throw new Error(data.error ?? "Error al actualizar la queja.");
        }
        onSaved(data.data!, "Queja actualizada correctamente.");
        onClose();
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Error al actualizar la queja.";
        setError(msg);
        onError(msg);
      } finally {
        setSaving(false);
      }
      return;
    }

    if (!form.fecha_queja) {
      setError("Fecha queja es obligatoria.");
      return;
    }
    if (!idValid) {
      setError("ID Servicio debe tener exactamente 7 dígitos.");
      return;
    }
    if (!form.turno || !form.categoria.trim() || !form.descripcion.trim() || !form.fuente) {
      setError("Complete turno, categoría, descripción y fuente.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetchPanel("/api/comercial/quejas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fecha_queja: form.fecha_queja,
          id_servicio: form.id_servicio.trim(),
          turno: form.turno,
          categoria: form.categoria,
          descripcion: form.descripcion,
          fuente: form.fuente,
          sync: true,
          estado_servicio: form.estado_servicio || null,
          empresa: form.empresa || null,
          usuario: form.usuario || null,
          invitado: form.invitado || null,
          conductor: form.conductor || null,
        }),
      });
      const data = (await res.json()) as {
        data?: ComercialQuejaRow;
        warning?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "No se pudo crear.");
      let msg = `Queja registrada correctamente (Item #${data.data!.id})`;
      if (data.warning) {
        setSyncWarning(data.warning);
        msg += ". Algunos campos automáticos quedaron vacíos.";
      }
      onSaved(data.data!, msg);
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      onError(msg);
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  const pasajero = pasajeroDisplay(form.invitado, form.usuario);

  const editableFields = (
    <>
      <div className="space-y-1">
        <Label>Turno *</Label>
        <select
          className={`flex h-9 w-full rounded-md border bg-white px-3 text-sm ${
            fieldErrors.turno ? "border-red-400" : "border-slate-200"
          }`}
          required
          value={form.turno}
          onChange={(e) => setField("turno", e.target.value)}
          aria-invalid={!!fieldErrors.turno}
        >
          <option value="">Seleccionar…</option>
          {TURNOS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        {fieldErrors.turno ? (
          <p className="text-xs text-red-600">{fieldErrors.turno}</p>
        ) : null}
      </div>

      <div className="space-y-1">
        <Label>Categoría *</Label>
        <Input
          required
          value={form.categoria}
          onChange={(e) => setField("categoria", e.target.value)}
          aria-invalid={!!fieldErrors.categoria}
          className={fieldErrors.categoria ? "border-red-400" : undefined}
        />
        {fieldErrors.categoria ? (
          <p className="text-xs text-red-600">{fieldErrors.categoria}</p>
        ) : null}
      </div>

      <div className="space-y-1">
        <Label>Descripción *</Label>
        <textarea
          className={`min-h-[80px] w-full rounded-md border px-3 py-2 text-sm ${
            fieldErrors.descripcion ? "border-red-400" : "border-slate-200"
          }`}
          required
          value={form.descripcion}
          onChange={(e) => setField("descripcion", e.target.value)}
          aria-invalid={!!fieldErrors.descripcion}
        />
        {fieldErrors.descripcion ? (
          <p className="text-xs text-red-600">{fieldErrors.descripcion}</p>
        ) : null}
      </div>

      <div className="space-y-1">
        <Label>Fuente *</Label>
        <select
          className={`flex h-9 w-full rounded-md border bg-white px-3 text-sm ${
            fieldErrors.fuente ? "border-red-400" : "border-slate-200"
          }`}
          required
          value={form.fuente}
          onChange={(e) => setField("fuente", e.target.value)}
          aria-invalid={!!fieldErrors.fuente}
        >
          <option value="">Seleccionar…</option>
          {FUENTES.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        {fieldErrors.fuente ? (
          <p className="text-xs text-red-600">{fieldErrors.fuente}</p>
        ) : null}
      </div>
    </>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white shadow-xl">
        <div className="sticky top-0 border-b border-slate-100 bg-white px-5 py-4">
          <h2 className="text-lg font-semibold text-slate-900">
            {isEdit ? `Editar queja #${initial?.id}` : "Nueva queja"}
          </h2>
          {isEdit ? (
            <div className="mt-2 space-y-1 text-sm text-slate-600">
              <p>
                <span className="font-medium text-slate-700">ID Servicio:</span>{" "}
                <span className="font-mono">{form.id_servicio}</span>
                <MoobizServiceLink idServicio={form.id_servicio} className="ml-2 inline-flex" />
              </p>
              {form.empresa ? (
                <p>
                  <span className="font-medium text-slate-700">Empresa:</span> {form.empresa}
                </p>
              ) : null}
              {form.usuario ? (
                <p>
                  <span className="font-medium text-slate-700">Usuario:</span> {form.usuario}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="space-y-3 px-5 py-4">
          {isEdit ? (
            editableFields
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>Fecha queja *</Label>
                  <Input
                    type="date"
                    required
                    value={form.fecha_queja}
                    onChange={(e) => setField("fecha_queja", e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label>ID Servicio *</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      required
                      maxLength={7}
                      inputMode="numeric"
                      value={form.id_servicio}
                      onChange={(e) =>
                        setField("id_servicio", e.target.value.replace(/\D/g, "").slice(0, 7))
                      }
                    />
                    <MoobizServiceLink idServicio={form.id_servicio} />
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={!idValid || syncing}
                      onClick={() => void handleSync()}
                    >
                      {syncing ? "Actualizando…" : "Actualizar"}
                    </Button>
                  </div>
                </div>
              </div>

              {[
                ["Estado", "estado_servicio"],
                ["Empresa", "empresa"],
                ["Usuario", "usuario"],
                ["Invitado", "invitado"],
                ["Conductor", "conductor"],
              ].map(([label, key]) => (
                <div key={key} className="space-y-1">
                  <Label>{label}</Label>
                  <Input readOnly value={form[key as keyof FormState]} />
                </div>
              ))}

              <div className="space-y-1">
                <Label>Pasajero</Label>
                <Input readOnly value={pasajero} />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>Turno *</Label>
                  <select
                    className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                    required
                    value={form.turno}
                    onChange={(e) => setField("turno", e.target.value)}
                  >
                    <option value="">Seleccionar…</option>
                    {TURNOS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label>Fuente *</Label>
                  <select
                    className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                    required
                    value={form.fuente}
                    onChange={(e) => setField("fuente", e.target.value)}
                  >
                    <option value="">Seleccionar…</option>
                    {FUENTES.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <Label>Categoría *</Label>
                <Input
                  required
                  value={form.categoria}
                  onChange={(e) => setField("categoria", e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <Label>Descripción *</Label>
                <textarea
                  className="min-h-[80px] w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
                  required
                  value={form.descripcion}
                  onChange={(e) => setField("descripcion", e.target.value)}
                />
              </div>
            </>
          )}

          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          {syncWarning ? <p className="text-sm text-amber-700">{syncWarning}</p> : null}
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
            {saving ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </div>
    </div>
  );
}
