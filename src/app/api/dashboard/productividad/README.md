# API Productividad (`reportes.productividad_operaciones`)

Rutas bajo `/api/dashboard/productividad/*`. Requieren `DATABASE_URL` (mismo pool que el dashboard de servicios).

## Parámetros de filtro (query string)

Todos los endpoints aceptan los mismos filtros. Los valores de fecha deben ir en formato **`DD/MM/YYYY`** (`fecha_from`, `fecha_to`). La UI puede usar `<input type="date">` (ISO `YYYY-MM-DD`); al llamar a la API conviértelos con `isoInputToFechaParam` de `@/lib/productividad-logs-params`.

| Parámetro | Tipo | Descripción |
|-----------|------|-------------|
| `global` | repetible | **Obsoleto** — no existe en `productividad_operaciones`; ignorado |
| `estado` | repetible | Columna `"Estado"` |
| `n_semana` | repetible | Columna `"N_Semana"` |
| `type_user` | repetible | |
| `type_log_name` | repetible | **No** enviar en `/cards` (las tarjetas ignoran este filtro) |
| `us_name` | repetible | Filtra columna `"Solicitante"` en la vista |
| `fecha_from` | string | `DD/MM/YYYY` |
| `fecha_to` | string | `DD/MM/YYYY` |
| `limit` | number | Solo `/users` (default 20) |
| `offset` | number | Solo `/users` (paginación / scroll) |

Ejemplo:

```
/api/dashboard/productividad/users?global=LIMA&fecha_from=01/05/2026&fecha_to=15/05/2026&limit=20&offset=0
```

## Endpoints

- `GET /filters?field=global|estado|n_semana|type_user|type_log_name|us_name|fecha` — opciones en cascada (excluye el propio `field` del WHERE).
- `GET /users` — barras por usuario y `type_log_name`; `?export=csv` descarga completo.
- `GET /cards` — métricas por tipo (`Creó`, `Solicitó`, …); **sin** `type_log_name` en query.
- `GET /by-date` — conteo por `fecha`; `?export=csv`.
- `GET /by-date-hour` — conteo por `fecha` + `hora`; `?export=csv`.

Cache HTTP: `s-maxage=60` en respuestas JSON.

## Extender filtros

1. Añade el campo en `ProductividadParsedParams` y `parseProductividadParams` (`productividad-logs-params.ts`).
2. Añade la columna en `buildProductividadWhere` y en `FILTER_COLUMN` si aplica a `/filters`.
3. Expón el control en `ProductividadPanel` y en `FILTER_FIELDS` del panel.

Las consultas SQL viven en `src/lib/productividad-logs-query.ts` (prepared statements vía `pg`).
