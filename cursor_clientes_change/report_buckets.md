# Bolsas Clientes (Empresas_Criticas)

## Política

Una empresa (`co_id`) solo puede estar en **una** bolsa. `POST /api/client-buckets` hace `ON CONFLICT (co_id) DO UPDATE` → mover de N1 a N2 reemplaza la fila anterior.

## Migration

Ejecutar manualmente en staging/prod (revisión DBA):

`db/migrations/20260601_create_empresas_criticas.sql`

## API

| Método | Ruta | Uso |
|--------|------|-----|
| GET | `/api/client-buckets` | Listado |
| POST | `/api/client-buckets` | Upsert `{ co_id, co_name?, bucket_level }` |
| DELETE | `/api/client-buckets/{co_id}` | Quitar |
| POST | `/api/client-buckets/bulk` | Lote `{ co_ids, bucket_level, co_names? }` |
| GET | `/api/client-buckets/companies?q=` | Autocomplete |

`created_by` = etiqueta de sesión panel (`getClientBucketsActorLabel`).

## UI

- Botón **Gestionar bolsas** → modal 3 columnas
- Badge **N1/N2/N3** y fila resaltada
- Menú **⋯** por empresa: asignar / quitar
- Filtro **Bolsa**: Todos | Nivel 1–3 (persistido en BD, no heurística timeline)
- Eliminado **2+ en misma hora**

## Seguimiento

Sin cambios en `seguimiento-operaciones.tsx` ni `/api/seguimiento-operaciones`.

## Tests

`npm test` — incluye `client-buckets.test.ts`, `client-buckets-move.test.ts`.
