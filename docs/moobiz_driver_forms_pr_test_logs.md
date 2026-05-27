# Pruebas staging — `moobiz_driver_forms` (tokens redactados)

Fecha: 2026-05-27

## Migración (staging, manual)

```bash
psql "$DB_CONNECTION_STRING" -v ON_ERROR_STOP=1 -f migrations/20260528_create_moobiz_driver_forms_table.sql
```

Resultado: tabla `public.moobiz_driver_forms` creada con columna `forms jsonb`.

## 1. Dry-run (`--batch-size=10 --concurrency=4`)

```bash
node scripts/sync_moobiz_driver_forms.js --dry-run --batch-size=10 --concurrency=4
```

Salida:

```
[driver-forms-sync] token inválido — refrescando vía ensureMoobizToken…
[driver-forms-sync] token refreshed: cef989...
[driver-forms-sync] list API: 1539 conductores
[driver-forms-sync] procesando 10 ids
[driver-forms-sync] done {"processed":10,"success":10,"errors":0,"dryRun":true}
```

Artefactos: `tmp_sync_driver_forms/driver_form_{id}.json` (10 archivos), `progress.json`.

## 2. Batch real (10 ids, UPSERT)

```bash
node scripts/sync_moobiz_driver_forms.js --batch-size=10 --concurrency=4
```

Salida:

```
[driver-forms-sync] list API: 1539 conductores
[driver-forms-sync] procesando 10 ids
[driver-forms-sync] done {"processed":10,"success":10,"errors":0,"dryRun":false}
```

## 3. Verificación SQL (muestra)

```sql
SELECT id, forms->>'ok' AS ok,
       jsonb_array_length(COALESCE(forms->'forms', '[]'::jsonb)) AS forms_n
FROM public.moobiz_driver_forms ORDER BY id LIMIT 10;
```

Resultado (staging):

| id | ok | forms_n |
|----|-----|---------|
| 131137 | true | 4 |
| 131141 | true | 4 |
| 131143 | true | 4 |
| 131145 | true | 4 |
| 131146 | true | 4 |
| 131147 | true | 4 |
| 131148 | true | 4 |
| 131149 | true | 4 |
| 131150 | true | 4 |
| 131153 | true | 4 |

`json_bytes` ~57k por fila (respuesta form completa).

## Errores

Ninguno en dry-run ni en batch real.

## Confirmaciones

- `scripts/sync_moobiz_drivers.js` **no modificado**.
- Migración **no** ejecutada desde GitHub Action (solo archivo en repo).
- `public.moobiz_drivers` **no** alterada por el sync de forms.
