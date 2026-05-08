# Volcado masivo `driver_live_raw` (Moobiz live/vehicles)

## Qué hace

`POST /api/moobiz/refresh-gps-raw` descarga en una sola petición:

`GET https://app.moobiz.pe/api/admin/live/vehicles?query=&show_destinations=true`

y reemplaza el contenido de `public.driver_live_raw` mediante la RPC `refresh_driver_live_raw(items jsonb)` (TRUNCATE + INSERT en una transacción).

Autenticación y reintento de token: **mismos** `getTokenForServicesSync()` y `moobizFetchWithToken()` que usa el sync de `moobiz_services`.

## Migración SQL (manual — no ejecutar desde CI/Cursor sin revisión)

1. Abre el **SQL Editor** en el proyecto Supabase (o tu cliente Postgres con permisos DDL).
2. Copia y ejecuta el contenido de **`sql/20260508_create_driver_live_raw.sql`**.
3. Verifica que existan la tabla `public.driver_live_raw` y la función `public.refresh_driver_live_raw(jsonb)`.

### Rollback DB

```sql
DROP FUNCTION IF EXISTS public.refresh_driver_live_raw(jsonb);
DROP TABLE IF EXISTS public.driver_live_raw;
```

## Probar el endpoint (después de la migración)

1. Inicia sesión en el panel (cookie `auth_session=authenticated`).
2. Desde la misma sesión del navegador, o con curl enviando la cookie:

```bash
curl -X POST "http://localhost:3000/api/moobiz/refresh-gps-raw" \
  -H "Cookie: auth_session=authenticated" \
  -H "Content-Type: application/json"
```

Respuesta esperada (éxito): `{ "ok": true, "total": <n>, "inserted": <n>, "elapsed_ms": <ms> }` (HTTP 200). Validación fallida: HTTP 422 con `ok: false` y `validationErrors`.

3. En Supabase: `SELECT count(*) FROM public.driver_live_raw;` y revisar `sync_monitor` con `last_id = 'driver_live_raw'`.

## Variables de entorno

| Variable | Uso |
|----------|-----|
| `SUPABASE_URL` o `NEXT_PUBLIC_SUPABASE_URL` | Cliente service role |
| `SUPABASE_SERVICE_ROLE_KEY` | RPC + `sync_monitor` |
| `MOOBIZ_SERVICES_TOKEN` | (Opcional) override Bearer, igual que sync servicios |
| `MOOBIZ_TOKEN` | Bootstrap token en `sync_state` |
| `MOOBIZ_EMAIL` / `MOOBIZ_PASSWORD` | Login admin si hace falta renovar token |

No se usa `POSTGRES_URL` ni cliente `pg` para este flujo.

## Archivos relevantes

| Archivo | Rol |
|---------|-----|
| `sql/20260508_create_driver_live_raw.sql` | Tabla, índices, RPC |
| `src/lib/driver-live-raw-sync-core.ts` | Orquestación (testeable sin `moobiz-services-sync`) |
| `src/lib/driver-live-raw-sync.ts` | Wrapper producción + `getTokenForServicesSync` |
| `src/lib/driver-live-raw-sync-monitor.ts` | `sync_monitor` con `last_id = driver_live_raw` |
| `src/lib/driver-live-vehicles-parse.ts` | Parse `items` y disponibilidad |
| `src/app/api/moobiz/refresh-gps-raw/route.ts` | Ruta POST |
| `tests/unit/driver-live-raw-sync.test.ts` | Mocks fetch + RPC + monitor |

## Nota sobre `tsconfig.json`

Se activó `allowImportingTsExtensions` para permitir imports relativos con sufijo `.ts` en los módulos nuevos, compatibles con `node --test --experimental-strip-types` y con `next build`.
