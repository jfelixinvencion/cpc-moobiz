# Auditoria del Servicio (Calidad)

## Alcance

Implementacion de la subpestana **Auditoria del Servicio** bajo `Calidad` con:

- listado paginado y filtros,
- formulario con checklist,
- fotos (1..9, JPG/PNG, max 5MB),
- persistencia en Supabase (`public.quality_audits`),
- bucket privado con signed upload/read URLs.

No incluye videollamadas, metadatos de llamadas, `location/latlng` ni `service_id`.

## Variables de entorno

Agregar en `.env` / `.env.local`:

```bash
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
QUALITY_PHOTOS_BUCKET=audits-photos
# Opcional: UUID y nombre para auditor_id / created_by (el login del panel no expone usuario Supabase)
QUALITY_ACTOR_UUID=00000000-0000-0000-0000-000000000001
QUALITY_ACTOR_NAME=Auditor
```

## Migracion SQL

Ejecutar `sql/20260424_create_quality_audits.sql` en Supabase SQL Editor.
Si ya tenias la tabla creada, ejecutar tambien `sql/20260424_add_driver_name_to_quality_audits.sql`.

Para la pestaña **Seguimiento** (última auditoría por conductor con resultado Condicional o Rechazado), ejecutar:

- `sql/20260425_quality_audits_seguimiento_views.sql`

Incluye:

- tabla `public.quality_audits`,
- indices por `driver_id` y `created_at`,
- trigger para `updated_at`,
- ejemplo de policies RLS para usuarios quality (`is_quality=true` o `role=quality` en JWT).

## Storage bucket

Crear bucket privado `audits-photos`.

- Visibilidad: **private**
- Ruta utilizada: `audits/{audit_id}/{timestamp}_{filename}`

## API implementada

- `POST /api/quality/audits/upload-url`
  - firma upload URL por archivo (server-side con service role).
- `POST /api/quality/audits`
  - crea auditoria.
- `GET /api/quality/audits?page=&limit=&dateFrom=&dateTo=&driverId=&resultado=&status=`
  - listado paginado (la API admite varios filtros; la pantalla de Calidad solo usa `driverId` como filtro).
- `GET /api/quality/audits/segimiento?page=&limit=&driverId=`
  - listado desde la vista `quality_audits_seguimiento`: una fila por conductor (su última auditoría) con resultado Condicional o Rechazado; mismo filtro opcional `driverId`.
- `GET /api/quality/audits/{id}`
  - detalle + signed read URLs para fotos.
- `PATCH /api/quality/audits/{id}`
  - actualiza draft/submitted/reviewed.

### Seguridad API

Mismo mecanismo que el resto del panel: cookie `auth_session=authenticated` (login en `/api/auth/login`).

- **GET** (`/api/quality/audits`, `/api/quality/audits/{id}`): requiere sesión en producción. En `NODE_ENV=development` se permite listar/leer sin cookie para desarrollo local.
- **POST / PATCH / upload-url**: siempre requieren sesión del panel.

El cliente debe llamar con `credentials: "same-origin"` (ya aplicado en Calidad) para enviar la cookie httpOnly.

Respuestas de validacion:

- `400` campos requeridos basicos,
- `401` sin sesión (escritura o producción sin cookie),
- `422` validaciones de negocio (fotos, checklist, resultado),
- `500` error interno.

## Frontend

Las peticiones a `/api/quality/*` usan `fetch` con `credentials: "same-origin"`; no se usa Bearer manual ni `localStorage` de JWT.

Archivos:

- `src/app/calidad/page.tsx`
- `src/components/QualityAuditList.tsx`
- `src/components/QualityAuditForm.tsx`
- `src/components/QualityAuditDetail.tsx`

Flujo:

1. Ir a tab principal `Calidad`.
2. Click en `Nueva auditoria`.
3. Completar cabecera + checklist + fotos.
4. `Guardar borrador` o `Enviar`.

## Borrador local y reintento

Si falla guardado/upload, el formulario persiste localmente en `localStorage` (`quality_audit_draft`) para reintentar.

## Prueba manual (aceptacion)

1. Crear auditoria con 2 fotos validas (jpg/png < 5MB).
2. Guardar como `draft`.
3. Reabrir y completar resultado + checklist.
4. Enviar (`submitted`).
5. Ver detalle y abrir fotos con signed URLs.
6. Probar validaciones:
   - 0 fotos en submit (debe fallar),
   - 10 fotos (debe bloquear),
   - archivo > 5MB (debe fallar),
   - tipo no permitido (debe fallar).

## Retencion recomendada

Por privacidad, definir politica de retencion de fotos (ejemplo: 90 dias) con job programado en backend o politica operativa en Storage.
