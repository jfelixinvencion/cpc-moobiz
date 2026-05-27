# Columna `raw_forms` en `public.moobiz_drivers`

## Por qué existe

El listado masivo de conductores (`GET /api/admin/drivers`) devuelve `fv_items` truncado a **1024 caracteres**. La respuesta completa de campos personalizados está en **`POST /api/admin/drivers/form`**.

La columna **`raw_forms jsonb`** guarda esa respuesta JSON **sin alterar** `raw_data` ni el flujo de `scripts/sync_moobiz_drivers.js`. Permite auditoría, reconstrucción de `fv_items` y consultas futuras sin acoplar el sync principal.

## Migración

Aplicar **manualmente** en staging y luego en producción (DBA o pipeline de migraciones habitual):

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/20260527_add_raw_forms_column.sql
```

No se ejecuta automáticamente desde el script de job.

## Job: `scripts/update_raw_forms_job.js`

### Requisitos

| Variable | Uso |
|----------|-----|
| `DATABASE_URL` | Postgres (Supabase pooler o directo) |
| `MOOBIZ_EMAIL` / `MOOBIZ_PASSWORD` | Login admin vía `ensureMoobizToken` (token en `sync_state`) |

**No** imprimir `MOOBIZ_TOKEN` en logs. Rotar credenciales Moobiz si el token se usó en un entorno compartido.

### Comandos

```bash
# Dry-run: solo API + archivos en tmp_raw_forms_job/ (sin UPDATE)
node scripts/update_raw_forms_job.js --dry-run --batch-size=10 --concurrency=4

# Staging/prod: pendientes (raw_forms IS NULL)
node scripts/update_raw_forms_job.js --batch-size=50 --concurrency=8

# Reprocesar todos
node scripts/update_raw_forms_job.js --full-run --batch-size=100 --concurrency=8

# Solo filas actualizadas desde una fecha
node scripts/update_raw_forms_job.js --since=2026-05-01 --batch-size=20
```

Equivalente npm:

```bash
npm run update:raw_forms -- --dry-run --batch-size=10
```

### Checkpoint

- Directorio: `tmp_raw_forms_job/`
- `driver_form_{id}.json` — respuesta redactada (sin tokens)
- `progress.json` — estado por id

### Backup y pruebas recomendadas

1. Backup de `public.moobiz_drivers` (o snapshot) antes del primer lote en prod.
2. Aplicar migración en **staging** y validar con `--dry-run` + lote de 10 ids.
3. Verificar: `SELECT id, jsonb_typeof(raw_forms), raw_forms->>'ok' FROM moobiz_drivers WHERE raw_forms IS NOT NULL LIMIT 5;`
4. Ejecutar lotes (`--batch-size`) hasta vaciar pendientes (`raw_forms IS NULL`).

## Qué no hace

- No modifica `sync_moobiz_drivers.js` ni `raw_data`.
- No reconstruye `fv_items` en `raw_data` (tarea separada si se desea).
