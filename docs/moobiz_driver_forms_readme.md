# `public.moobiz_driver_forms` — sync independiente

## Propósito

Guardar la respuesta **completa** de `POST /api/admin/drivers/form` por conductor en una tabla dedicada, sin modificar `public.moobiz_drivers` ni `scripts/sync_moobiz_drivers.js`.

El listado masivo (`GET /api/admin/drivers`) trunca `fv_items` a 1024 caracteres; el endpoint `form` devuelve todos los campos.

## Migraciones (manual — DBA)

Orden sugerido:

1. `migrations/20260528_create_moobiz_driver_forms_table.sql` — crea la tabla.
2. (Opcional) `migrations/20260528_revert_add_raw_forms_column.sql` — solo si en algún entorno existió la columna `raw_forms` en `moobiz_drivers` y el equipo decide eliminarla.

```bash
psql "$DB_CONNECTION_STRING" -v ON_ERROR_STOP=1 -f migrations/20260528_create_moobiz_driver_forms_table.sql
```

**No** ejecutar migraciones desde GitHub Actions ni desde este script.

## Script: `scripts/sync_moobiz_driver_forms.js`

### Variables de entorno

| Variable | Uso |
|----------|-----|
| `DB_CONNECTION_STRING` o `DATABASE_URL` | Postgres |
| `MOOBIZ_TOKEN` | Opcional; si falta, `ensureMoobizToken()` |
| `MOOBIZ_EMAIL` / `MOOBIZ_PASSWORD` | Login admin (refresh token) |

No publicar tokens en logs ni commits.

### Flags

| Flag | Descripción |
|------|-------------|
| `--dry-run` | Solo API + `tmp_sync_driver_forms/`; sin UPSERT |
| `--batch-size=N` | Máx. ids por ejecución (default 50) |
| `--concurrency=N` | Paralelismo (default 8) |
| `--max-workers=N` | Alias de `--concurrency` |
| `--since=ISO` | Solo ids presentes en listado y con `moobiz_drivers.updated_at >= since` |

### Ejemplos locales

```bash
# Dry-run 10 ids
DB_CONNECTION_STRING="postgres://..." node scripts/sync_moobiz_driver_forms.js --dry-run --batch-size=10 --concurrency=4

# Lote real 50 ids
DB_CONNECTION_STRING="postgres://..." node scripts/sync_moobiz_driver_forms.js --batch-size=50 --concurrency=8
```

npm:

```bash
npm run sync:driver-forms -- --dry-run --batch-size=10 --concurrency=4
```

### Checkpoint

- `tmp_sync_driver_forms/progress.json` — `processed_ids`, `errors`, `last_batch_time`
- `tmp_sync_driver_forms/driver_form_{id}.json` — auditoría (tokens redactados)

## GitHub Action (solo manual)

Workflow: **sync-driver-forms** (`.github/workflows/sync_driver_forms.yml`)

1. Repo → **Actions** → **sync-driver-forms** → **Run workflow**
2. Elegir `dry_run`, `batch_size`, `concurrency`
3. Requiere secrets: `DATABASE_URL`, `MOOBIZ_TOKEN` (o email/password), `SUPABASE_*` para `check:env`

No hay `schedule` ni cron.

## Verificación SQL

```sql
SELECT id, forms->>'ok' AS ok,
       jsonb_array_length(COALESCE(forms->'forms', '[]'::jsonb)) AS forms_n,
       updated_at
FROM public.moobiz_driver_forms
ORDER BY updated_at DESC
LIMIT 10;
```

## Backup y seguridad

1. Backup o snapshot antes del primer lote en producción.
2. Probar en staging: dry-run → lote pequeño → validar filas.
3. Rotar `MOOBIZ_TOKEN` si se usó en entorno compartido.

## Qué no hace

- No altera `moobiz_drivers`.
- No ejecuta DDL automáticamente.
- No crea índices GIN por defecto (ver comentario en migration).
