-- Índice para consultas/filtros por date_updated almacenado en raw_data (Moobiz).
-- Idempotente: seguro ejecutar varias veces en Supabase SQL Editor.

create index if not exists idx_moobiz_services_history_raw_date_updated
  on public.moobiz_services_history ((raw_data->>'date_updated'));
