# Sincronización de conductores Moobiz (`moobiz_drivers`)

Los conductores se obtienen del endpoint admin de Moobiz (`GET /api/admin/drivers`) y se guardan en Supabase en `public.moobiz_drivers` mediante **reemplazo total**: **un solo GET** con `limit` alto (por defecto **3000**), dedupe por `id`, validación y RPC `moobiz_drivers_full_replace` (**TRUNCATE + INSERT** atómico). La paginación clásica (`page` / `p` / `offset` en varias peticiones) devolvió ventanas duplicadas en pruebas; un único `limit=3000` devuelve el conjunto completo (~1814).

## Variables de entorno

| Variable | Uso |
|----------|-----|
| `SUPABASE_URL` | URL del proyecto (o `NEXT_PUBLIC_SUPABASE_URL`). |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave service role para upsert y `sync_monitor`. |
| `MOOBIZ_DRIVERS_TOKEN` | **Opcional pero recomendable** para el script CLI: Bearer dedicado a este sync. Si no está definida, el script usa `sync_state` (`moobiz_token`) o hace login con `MOOBIZ_EMAIL` / `MOOBIZ_PASSWORD`. |
| `MOOBIZ_DRIVERS_URL` | Base URL del endpoint (por defecto `https://app.moobiz.pe/api/admin/drivers`). |
| `MOOBIZ_DRIVERS_PAGE_SIZE` | Límite del **único** GET hacia Moobiz (por defecto **`3000`**, máximo **`5000`**). Debe cubrir el `total` de conductores declarado por la API. |
| `MOOBIZ_DRIVERS_MAX_PAGES` | *(Legacy)* Ya no se usa en el sync por GET único; se ignora. |
| `MOOBIZ_EMAIL` / `MOOBIZ_PASSWORD` | Solo si no usas `MOOBIZ_DRIVERS_TOKEN` y necesitas renovar token como en otros syncs. |

En la app Next.js, `POST /api/moobiz-drivers/sync` siempre ejecuta el mismo flujo de **reemplazo total** (prioridad `MOOBIZ_DRIVERS_TOKEN`, luego `getMoobizBearerForRequest()`). Si la validación detecta discrepancia entre el `total` declarado por la API y los ítems realmente descargados (o entre descarga y conteo en BD), responde **422** con `ok: false` y `validationErrors` (la tabla ya puede haberse actualizado con lo descargado).

## Base de datos

Ejecutar en Supabase el SQL:

- `sql/20260426_create_moobiz_drivers.sql`
- `sql/20260427_moobiz_drivers_full_replace_rpc.sql` (**obligatorio** para el sync actual)
- `sql/20260513_moobiz_drivers_raw_data_unbounded.sql` (**recomendado** si `raw_data` o campos internos como `fv_items` llegaron truncados por un tipo legacy `varchar(n)` en `raw_data`)

## Sync por CLI

Desde la raíz del repo (con `.env` / `.env.local` cargados; el script intenta cargar `dotenv` automáticamente):

```bash
npm run sync:drivers
```

El script CLI registra en consola **cuántos ítems devolvió el GET único** (`limit`) y un resumen tras dedupe antes del RPC.

## Sync manual desde el panel

1. Iniciar sesión en el panel (cookie `auth_session`).
2. **Datos** → pestaña **Conductores**.
3. **Actualizar conductores**: llama a `POST /api/moobiz-drivers/sync` en el servidor y muestra el estado (iniciando → en proceso → finalizado / error).

La lista de la tabla usa `GET /api/moobiz-drivers` (paginado); requiere la misma sesión de lectura que otras rutas de calidad/datos protegidas.

## Seguridad

No incluir el Bearer de Moobiz en el frontend ni en repositorios públicos. Preferir `MOOBIZ_DRIVERS_TOKEN` o credenciales solo en el servidor / secretos de CI.
