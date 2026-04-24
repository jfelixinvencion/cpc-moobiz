"use client";

import type { QualityAuditRecord } from "@/components/quality-audit-types";

type Props = {
  audit: QualityAuditRecord | null;
  signedPhotos: Array<{ path: string; signedUrl: string }>;
  onClose: () => void;
};

export function QualityAuditDetail({ audit, signedPhotos, onClose }: Props) {
  if (!audit) return null;
  const checklist = audit.checklist ?? {};
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <div className="max-h-[90vh] w-full max-w-4xl overflow-auto rounded-lg bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Detalle auditoría {audit.id.slice(0, 8)}</h3>
          <button type="button" className="rounded border px-3 py-1 text-sm" onClick={onClose}>
            Cerrar
          </button>
        </div>
        <div className="grid grid-cols-1 gap-2 text-sm md:grid-cols-3">
          <div>
            <strong>Fecha:</strong> {new Date(audit.created_at).toLocaleString("es-PE")}
          </div>
          <div>
            <strong>Driver ID:</strong> {audit.driver_id || "-"}
          </div>
          <div>
            <strong>Nombre conductor:</strong> {audit.driver_name || "-"}
          </div>
          <div>
            <strong>Placa:</strong> {audit.vehicle_plate || "-"}
          </div>
          <div>
            <strong>Resultado:</strong> {audit.resultado || "-"}
          </div>
          <div>
            <strong>Estado:</strong> {audit.status}
          </div>
          <div>
            <strong>Auditor:</strong> {audit.auditor_name || audit.auditor_id}
          </div>
        </div>
        <div className="mt-4">
          <h4 className="mb-2 font-medium">Checklist</h4>
          <div className="space-y-2">
            {Object.entries(checklist).map(([key, item]) => (
              <div key={key} className="rounded border p-2 text-sm">
                <div className="font-medium">{key}</div>
                <div>Respuesta: {item.answer}</div>
                {item.comment ? <div>Comentario: {item.comment}</div> : null}
              </div>
            ))}
          </div>
        </div>
        <div className="mt-4">
          <h4 className="mb-2 font-medium">Fotos</h4>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            {signedPhotos.map((photo) => (
              <a key={photo.path} href={photo.signedUrl} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.signedUrl} alt={photo.path} className="h-36 w-full rounded object-cover" />
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
