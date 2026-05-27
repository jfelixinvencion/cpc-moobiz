## Summary

- Nueva tabla independiente **`public.moobiz_driver_forms`** (misma estructura base que `moobiz_drivers` + columna `forms jsonb`).
- Script **`scripts/sync_moobiz_driver_forms.js`**: GET list + POST `/api/admin/drivers/form` + UPSERT parametrizado.
- GitHub Action **`sync-driver-forms`** — solo **`workflow_dispatch`** (manual).
- Documentación y logs de prueba en staging.

**No modifica** `scripts/sync_moobiz_drivers.js` ni `public.moobiz_drivers`.

## Artefactos del intento `raw_forms` (eliminados del repo)

Si existía la rama `feature/add-raw-forms`, estos archivos **no** se incluyen aquí:

- `migrations/20260527_add_raw_forms_column.sql`
- `scripts/update_raw_forms_job.js`
- `docs/raw_forms_*`

Ver `archive/raw_forms_removed/README.md`.

**DB:** si ya aplicaste `ADD COLUMN raw_forms` en algún entorno, **no** hay DROP automático. Opcional: `migrations/20260528_revert_add_raw_forms_column.sql` (comentado, solo DBA).

## Migraciones (orden manual — DBA)

1. `migrations/20260528_create_moobiz_driver_forms_table.sql`
2. (Opcional) `migrations/20260528_revert_add_raw_forms_column.sql`

```bash
psql "$DB_CONNECTION_STRING" -v ON_ERROR_STOP=1 -f migrations/20260528_create_moobiz_driver_forms_table.sql
```

## Ejecutar sync

**Local:**

```bash
npm run sync:driver-forms -- --dry-run --batch-size=10 --concurrency=4
npm run sync:driver-forms -- --batch-size=50 --concurrency=8
```

**GitHub Actions:** Actions → **sync-driver-forms** → Run workflow.

## Pruebas staging

Ver `docs/moobiz_driver_forms_pr_test_logs.md`:

- Dry-run 10 ids: **10/10 OK**
- Batch real 10 ids: **10/10 UPSERT OK**

## Test plan

- [ ] DBA aplica migration en staging
- [ ] Dry-run en staging
- [ ] Lote pequeño con UPSERT
- [ ] Validar SQL muestra
- [ ] Prod: backup + migration + workflow manual
