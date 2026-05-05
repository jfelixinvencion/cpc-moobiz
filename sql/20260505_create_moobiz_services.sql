-- Servicios Moobiz desde /api/admin/dispatcher (sync manual). PK = id del servicio en Moobiz.
CREATE TABLE IF NOT EXISTS public.moobiz_services (
  id TEXT PRIMARY KEY,
  state TEXT,
  raw JSONB NOT NULL,
  synced_at TIMESTAMPTZ DEFAULT NOW()
);
