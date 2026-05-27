# Pruebas staging — feature `raw_forms` (sin tokens)

Fecha: 2026-05-27

## 1. Migración (staging)

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/20260527_add_raw_forms_column.sql
# Verificación: columna raw_forms presente en information_schema
```

## 2. Dry-run (10 ids)

```bash
node scripts/update_raw_forms_job.js --dry-run --batch-size=10 --concurrency=4
```

Salida:

```
[raw-forms] token: cef989...
[raw-forms] ids a procesar: 10
[raw-forms] done { processed: 10, ok: 10, err: 0, dryRun: true, tmpDir: '.../tmp_raw_forms_job' }
```

Artefactos: `tmp_raw_forms_job/driver_form_{id}.json` (10 archivos), `progress.json`.

## 3. UPDATE real (10 ids, staging)

```bash
node scripts/update_raw_forms_job.js --batch-size=10 --concurrency=4
```

Salida:

```
[raw-forms] token: cef989...
[raw-forms] ids a procesar: 10
[raw-forms] done { processed: 10, ok: 10, err: 0, dryRun: false, tmpDir: '.../tmp_raw_forms_job' }
```

Verificación SQL (ejecutar en staging):

```sql
SELECT id,
       raw_forms->>'ok' AS ok,
       jsonb_array_length(COALESCE(raw_forms->'forms', '[]'::jsonb)) AS forms_n
FROM public.moobiz_drivers
WHERE raw_forms IS NOT NULL
ORDER BY id
LIMIT 10;
```

Resultado esperado: `ok = true`, `forms_n >= 1` para los 10 ids actualizados.

## Confirmación

- `scripts/sync_moobiz_drivers.js` **no modificado**.
- Solo columna nueva `raw_forms` + job independiente.
