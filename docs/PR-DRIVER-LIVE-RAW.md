# PR draft — Volcado masivo Moobiz → `public.driver_live_raw`

## Resumen

Nuevo endpoint **`POST /api/moobiz/refresh-gps-raw`** que llama una sola vez a  
`GET https://app.moobiz.pe/api/admin/live/vehicles?query=&show_destinations=true`,  
normaliza filas y ejecuta la RPC **`public.refresh_driver_live_raw(items jsonb)`** (TRUNCATE + INSERT atómico).

**No se modifica** `src/lib/moobiz-services-sync.ts`, `src/app/api/moobiz-services/sync/route.ts` ni la tabla `public.moobiz_services`.

## Imports reutilizados (producción)

| Módulo | Símbolo |
|--------|---------|
| `@/lib/moobiz-services-sync` | `getTokenForServicesSync` |
| `@/lib/moobiz-auth` | `moobizFetchWithToken` |
| `@/lib/panel-session` | `assertQualityWriteAccess` |
| `@/lib/format-api-error` | `formatApiError` |

Headers del GET: mismos que `fetchDispatcherPage` en `moobiz-services-sync` (`Accept`, `Origin`, `Referer`, `User-Agent`, `cache: "no-store"`).

## Archivos añadidos / tocados

- **Añadido** `sql/20260508_create_driver_live_raw.sql` — **no ejecutar desde Cursor/CI**; aplicar manualmente en Supabase.
- **Añadido** `src/lib/driver-live-raw-sync-monitor.ts` — insert `sync_monitor` con `last_id: 'driver_live_raw'` (misma forma de columnas que `writeServicesSyncMonitor`).
- **Añadido** `src/lib/driver-live-vehicles-parse.ts` — `extractItemsFromLiveVehiclesResponse`, `normalizeAvailabilityFromItem`, helpers de nombre.
- **Añadido** `src/lib/driver-live-raw-sync-core.ts` — lógica orquestada (inyectable en tests).
- **Añadido** `src/lib/driver-live-raw-sync.ts` — wrapper que enlaza `getTokenForServicesSync` + cliente Supabase por defecto.
- **Añadido** `src/app/api/moobiz/refresh-gps-raw/route.ts`.
- **Añadido** `tests/unit/driver-live-raw-sync.test.ts`.
- **Añadido** `docs/DRIVER_LIVE_RAW_SYNC.md`.
- **Modificado** `tsconfig.json` — `allowImportingTsExtensions: true` (imports `.ts` relativos en módulos nuevos; ver doc).

## Variables de entorno

`SUPABASE_URL` (o `NEXT_PUBLIC_SUPABASE_URL`), `SUPABASE_SERVICE_ROLE_KEY`, `MOOBIZ_SERVICES_TOKEN` (opcional), `MOOBIZ_TOKEN`, `MOOBIZ_EMAIL`, `MOOBIZ_PASSWORD`.

## Checklist QA manual

- [ ] Ejecutar SQL de `sql/20260508_create_driver_live_raw.sql` en Supabase.
- [ ] `POST /api/moobiz/refresh-gps-raw` con sesión del panel → 200 y `inserted` > 0 si hay vehículos.
- [ ] `SELECT * FROM public.driver_live_raw LIMIT 5` — `raw` JSONB y `availability` coherente.
- [ ] Último `sync_monitor`: `last_id = driver_live_raw`, `status` success/error acorde.
- [ ] Sin cookie de sesión → 401 `AUTH_REQUIRED`.
- [ ] `npm test` y `npx next build` pasan.

## Rollback (código + DB)

1. Revertir commit (eliminar rutas/libs/tests/docs y restaurar `tsconfig.json` si aplica).
2. SQL: `DROP FUNCTION IF EXISTS public.refresh_driver_live_raw(jsonb); DROP TABLE IF EXISTS public.driver_live_raw;`

## STOP

**No ejecutar la migración en producción ni mergear sin aprobación explícita.**
