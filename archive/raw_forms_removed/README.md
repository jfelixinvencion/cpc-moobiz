# Artefactos eliminados: intento `raw_forms` en `moobiz_drivers`

El enfoque de columna `raw_forms` en `public.moobiz_drivers` se descartó en favor de la tabla independiente `public.moobiz_driver_forms`.

Archivos que **no** deben volver al repo (rama `feature/add-raw-forms`):

- `migrations/20260527_add_raw_forms_column.sql`
- `scripts/update_raw_forms_job.js`
- `docs/raw_forms_readme.md`
- `docs/raw_forms_pr_test_logs.md`

**Base de datos:** si ya aplicaste `ADD COLUMN raw_forms` en algún entorno, **no** hay DROP automático. Ver `migrations/20260528_revert_add_raw_forms_column.sql` (comentado) y coordinar con DBA.
