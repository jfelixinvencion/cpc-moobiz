-- Crear schema si no existe
CREATE SCHEMA IF NOT EXISTS comercial;

-- Tabla principal de quejas (single-table approach)
CREATE TABLE IF NOT EXISTS comercial.registro_quejas (
  id                BIGSERIAL PRIMARY KEY,
  fecha_queja       DATE NOT NULL,
  id_servicio       TEXT NOT NULL CHECK (id_servicio ~ '^[0-9]{7}$'),
  estado_servicio   TEXT,
  empresa           TEXT,
  usuario           TEXT,
  invitado          TEXT,
  pasajero          TEXT,
  conductor         TEXT,
  turno             TEXT,
  categoria         TEXT,
  descripcion       TEXT,
  fuente            TEXT,
  estado_registro   TEXT NOT NULL DEFAULT 'Pendiente',
  respuesta         TEXT,
  fecha_respuesta   DATE,
  acciones          TEXT,
  fotos_revision    TEXT[] DEFAULT ARRAY[]::text[],
  created_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quejas_id_servicio ON comercial.registro_quejas (id_servicio);
CREATE INDEX IF NOT EXISTS idx_quejas_created_at ON comercial.registro_quejas (created_at);
