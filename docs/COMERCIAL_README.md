# Comercial — Registro de Quejas

Módulo para registrar quejas comerciales vinculadas a servicios Moobiz (`ID Servicio` de 7 dígitos), sincronizar datos desde `vista.vw_moobiz_31cols_pe` y gestionar revisiones con fotos en Supabase Storage.

## Rutas UI

| Ruta | Descripción |
|------|-------------|
| `/comercial` | Listado virtualizado, modales Nuevo / Editar / Revisar |
| Panel principal | Pestaña **Comercial** → navega a `/comercial` (mismo patrón que Calidad) |

## Base de datos

Ejecutar en Postgres (Supabase SQL o `psql`):

```bash
psql "$DATABASE_URL" -f migrations/sql/create_comercial_registro_quejas.sql
```

Tabla: `comercial.registro_quejas`

## Supabase Storage

1. Crear bucket **`comercial-uploads`** (o definir `STORAGE_BUCKET` en env).
2. El backend sube con **service role** (`SUPABASE_SERVICE_ROLE_KEY`).
3. Rutas: `{queja_id}/{timestamp}_{nombre}`.
4. Límite: 5 fotos por solicitud de revisión; JPEG/PNG/WebP; ≤ 5 MB c/u.

## Variables de entorno (Vercel / local)

| Variable | Uso |
|----------|-----|
| `DATABASE_URL` | Lectura `vista.*` y CRUD `comercial.*` |
| `SUPABASE_URL` | Storage upload |
| `SUPABASE_SERVICE_ROLE_KEY` | Storage + operaciones privilegiadas |
| `STORAGE_BUCKET` | Opcional; default `comercial-uploads` |
| `QUALITY_ACTOR_UUID` | `created_by` si el login del panel no expone usuario |

## API

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/comercial/sync-service?id_servicio=` | Sync desde vista 31 cols |
| GET | `/api/comercial/quejas` | Listado (`limit`, `offset`, `search`, `sort_col`, `sort_dir`) |
| POST | `/api/comercial/quejas` | Crear queja (`sync: true` opcional) |
| GET | `/api/comercial/quejas/:id` | Detalle |
| PUT | `/api/comercial/quejas/:id` | Editar campos permitidos |
| POST | `/api/comercial/quejas/:id/review` | Guardar revisión + fotos URLs |
| DELETE | `/api/comercial/quejas/:id` | Hard delete + limpieza storage (best-effort) |
| POST | `/api/comercial/upload-photo` | `multipart/form-data`: `queja_id`, `files` |

Auth: misma cookie `auth_session` que el resto del panel (`assertQualityReadAccess` / `assertQualityWriteAccess`).

## Despliegue

1. Branch sugerido: `feat/comercial-quejas`
2. Aplicar migración SQL y crear bucket Storage.
3. Configurar env en Vercel.
4. `npm run build` y pruebas manuales (ver checklist en spec del proyecto).
5. Verificar `/comercial` en staging/producción.

## Tests

```bash
npm test
```

Incluye `tests/integration/comercial-quejas.test.ts` (validaciones y contratos sin DB live).
