-- Vistas de seguimiento en esquema `vista` (tabla base sigue en public).
CREATE SCHEMA IF NOT EXISTS vista;

-- Última auditoría por conductor (ID de conductor).
-- Criterio: created_at DESC, desempate id DESC.
CREATE OR REPLACE VIEW vista.quality_audits_latest_per_driver AS
SELECT DISTINCT ON (qa.driver_id) qa.*
FROM public.quality_audits qa
WHERE qa.driver_id IS NOT NULL
  AND btrim(qa.driver_id) <> ''
ORDER BY qa.driver_id, qa.created_at DESC NULLS LAST, qa.id DESC;

-- Seguimiento: solo conductores cuya ÚLTIMA auditoría es Condicional o Rechazado.
CREATE OR REPLACE VIEW vista.quality_audits_seguimiento AS
SELECT *
FROM vista.quality_audits_latest_per_driver
WHERE resultado IN ('Condicional', 'Rechazado');

COMMENT ON VIEW vista.quality_audits_latest_per_driver IS
  'Una fila por driver_id: la auditoría más reciente (created_at DESC, id DESC).';

COMMENT ON VIEW vista.quality_audits_seguimiento IS
  'Última auditoría por conductor filtrada a resultado Condicional o Rechazado.';
