export type QualityStatus = "draft" | "submitted" | "reviewed";
export type QualityResult = "Aprobado" | "Condicional" | "Rechazado" | "";
export type ChecklistAnswer = "yes" | "no" | "na";

export type ChecklistItem = {
  key: string;
  label: string;
  hasComment?: boolean;
};

export const CHECKLIST_ITEMS: ChecklistItem[] = [
  { key: "uniforme", label: "Uniforme completo y limpio", hasComment: true },
  { key: "identificacion", label: "Identificación visible (credencial)", hasComment: true },
  { key: "tablero_ordenado", label: "Tablero ordenado / sin objetos sueltos", hasComment: true },
  { key: "asientos_estado", label: "Asientos en buen estado", hasComment: true },
  { key: "piso_limpio", label: "Piso limpio (sin residuos)", hasComment: true },
  { key: "placa_visible", label: "Placa visible y limpia", hasComment: true },
  { key: "carroceria", label: "Carrocería sin daños graves", hasComment: true },
  { key: "luces_espejos", label: "Luces y espejos funcionales", hasComment: true },
  { key: "cinturones", label: "Cinturones presentes y funcionales", hasComment: true },
  {
    key: "documentacion",
    label: "Documentación/seguro visible (si aplica)",
    hasComment: true,
  },
];

export type AuditChecklistValue = {
  answer: ChecklistAnswer;
  comment?: string | null;
};

export type QualityAuditRecord = {
  id: string;
  driver_id: string | null;
  driver_name: string | null;
  vehicle_plate: string | null;
  auditor_id: string;
  auditor_name: string | null;
  created_at: string;
  updated_at: string;
  status: QualityStatus;
  fotos_count: number;
  foto_paths: string[];
  estado: string | null;
  usuario_estado: string | null;
  resultado: QualityResult;
  score: number | null;
  checklist: Record<string, AuditChecklistValue> | null;
  raw_data: Record<string, unknown> | null;
  notes: string | null;
  created_by: string;
};
