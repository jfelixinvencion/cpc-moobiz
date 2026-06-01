/** Tipos compartidos para /api/clientes-operaciones (solo subpestaña Clientes). */

export type ClientesOperacionesServiceRow = {
  id: string | number | null;
  co_id: string;
  co_name: string;
  estado: string;
  fecha: string;
  fecha_registro: string;
  dr_id: string | null;
  producto: string;
};

export type ClientesOperacionesSummaryRow = {
  co_id: string;
  co_name: string;
  estado: string;
  /** ISO 8601 inicio de hora (UTC). */
  hour_ts: string;
  servicios_count: number;
};

export type ClientesOperacionesApiResponse = {
  data: ClientesOperacionesServiceRow[];
  summary: ClientesOperacionesSummaryRow[];
};
