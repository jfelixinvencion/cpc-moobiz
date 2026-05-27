# Pruebas staging — `moobiz_driver_forms` (tokens redactados)

**Entorno:** STAGING únicamente (Supabase pooler). **Producción:** no tocada.  
**Fecha ejecución:** 2026-05-27T20:39Z (re-run verificado en branch `feature/create-driver-forms-table`)

---

## 0. Verificación inicial

- Rama: `feature/create-driver-forms-table`
- Migration presente: `migrations/20260528_create_moobiz_driver_forms_table.sql` (CREATE LIKE `moobiz_drivers` + `forms jsonb`)
- `scripts/sync_moobiz_drivers.js`: **sin cambios** en esta rama

---

## 1. Migración aplicada en STAGING

```bash
# Equivalente ejecutado vía Node + STAGING_DATABASE_URL / DATABASE_URL desde .env.local (staging)
node scripts/_staging_apply_and_verify.js  # helper local, no commiteado
```

**SQL aplicado:** contenido de `migrations/20260528_create_moobiz_driver_forms_table.sql`

**Verificación post-migración:**

```sql
SELECT EXISTS (
  SELECT FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'moobiz_driver_forms'
) AS table_exists;
```

**Resultado:**

```json
{
  "migration_applied": true,
  "table_exists": true,
  "forms_column": true
}
```

---

## 2. Dry-run (10 ids)

**Comando:**

```bash
DB_CONNECTION_STRING="<STAGING_REDACTED>" node scripts/sync_moobiz_driver_forms.js --dry-run --batch-size=10 --concurrency=4
```

**Consola (tokens redactados):**

```
[driver-forms-sync] MOOBIZ_TOKEN desde env: 1a7271...
[driver-forms-sync] token inválido — refrescando vía ensureMoobizToken…
[driver-forms-sync] token refreshed: cef989...
[driver-forms-sync] list API: 1540 conductores
[driver-forms-sync] procesando 10 ids
[driver-forms-sync] done {"processed":10,"success":10,"errors":0,"dryRun":true,"tmpDir":".../tmp_sync_driver_forms"}
```

| Métrica | Valor |
|---------|-------|
| processed | 10 |
| success | 10 |
| errors | 0 |
| dryRun | true |
| tmpDir | `tmp_sync_driver_forms/` |

**Artefactos:** `tmp_sync_driver_forms/driver_form_{id}.json` (10 archivos, sin tokens en body — campos sensibles `[REDACTED]` si aplica), `progress.json`.

---

## 3. Batch real (10 ids, UPSERT)

**Comando:**

```bash
DB_CONNECTION_STRING="<STAGING_REDACTED>" node scripts/sync_moobiz_driver_forms.js --batch-size=10 --concurrency=4
```

**Consola (tokens redactados):**

```
[driver-forms-sync] MOOBIZ_TOKEN desde env: 1a7271...
[driver-forms-sync] token refreshed: cef989...
[driver-forms-sync] list API: 1540 conductores
[driver-forms-sync] procesando 10 ids
[driver-forms-sync] done {"processed":10,"success":10,"errors":0,"dryRun":false,"tmpDir":".../tmp_sync_driver_forms"}
```

| Métrica | Valor |
|---------|-------|
| processed | 10 |
| success | 10 |
| errors | 0 |
| dryRun | false |

**Ids upserted en este batch** (desde `progress.json`):

`131141`, `131143`, `131145`, `131146`, `131147`, `131148`, `131149`, `131150`, `131153`, `131912`

---

## 4. Verificación en `public.moobiz_driver_forms`

```sql
SELECT count(*) FROM public.moobiz_driver_forms;
SELECT id, forms->>'ok' AS ok,
       jsonb_array_length(COALESCE(forms->'forms', '[]'::jsonb)) AS forms_n,
       updated_at
FROM public.moobiz_driver_forms
ORDER BY updated_at DESC
LIMIT 10;
```

**Resultado staging:**

| Métrica | Valor |
|---------|-------|
| **total_rows** en tabla | **11** (incluye 1 fila de prueba anterior en la misma DB staging + 10 del batch; 9 ids solapados actualizados) |
| forms_n (muestra) | 4 por conductor |
| forms->>'ok' | `true` |

Muestra últimos `updated_at` (2026-05-27T20:39:16–18Z): ids listados arriba, todos con `ok=true`, `forms_n=4`.

---

## 5. Errores

Ninguno en migración, dry-run ni batch real.

---

## 6. Confirmaciones de seguridad

| Check | Estado |
|-------|--------|
| `scripts/sync_moobiz_drivers.js` modificado | **No** |
| DDL/DML en producción | **No** |
| DROP / revert `raw_forms` en prod | **No** |
| Tokens en este documento | **Redactados** (`1a7271...`, `cef989...`) |
| UPDATE parametrizado (`$1::jsonb`, `$2`) | **Sí** (script) |

---

## 7. Producción (pendiente — no ejecutar desde este job)

1. Backup / snapshot de `public.moobiz_drivers` (referencia) y plan para nueva tabla.
2. DBA aplica `migrations/20260528_create_moobiz_driver_forms_table.sql` vía pipeline habitual.
3. Ejecutar sync por lotes o GitHub Action **sync-driver-forms** (`workflow_dispatch`) con secrets de prod.
