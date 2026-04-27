# Informe diagnóstico: moobiz_drivers vs API Moobiz

- Generado: 2026-04-24T20:35:57.757Z
- URL base conductores: `https://app.moobiz.pe/api/admin/drivers`
- `limit` (PAGE_SIZE): 15
- `MOOBIZ_DRIVERS_MAX_PAGES`: 2000
- Origen del token: sync_state.moobiz_token

## Totales API
| Métrica | Valor |
|---------|-------|
| total_api (campo `total` del JSON, primera respuesta válida) | 1812 |
| total_api_ids (IDs extraídos de ítems, con posibles repetidos) | 1797 |
| total_api_ids_unique | 1797 |
| duplicate_ids_in_stream (lista bruta − únicos) | 0 |
| Modo de paginación detectado | **page** |
| Filas acumuladas (mapeo sync / `acc.length`) | 1797 |
| Iteraciones de offset (solo modo offset) | — |

## Totales base de datos
| Métrica | Valor |
|---------|-------|
| total_db (COUNT vía Content-Range o recorrido) | 1796 |
| total_db_distinct | 1796 |

## Diferencia API → DB
| Métrica | Valor |
|---------|-------|
| total_missing (IDs en API únicos y no en DB) | 1 |
| total_extra (IDs en DB y no en API en esta corrida) | 0 |

### Primeros 20 missing IDs
```
130572
```

## Resumen de paginación (requests)
- Peticiones registradas: **120**
- Páginas con duplicados respecto a páginas anteriores: **0**
- Respuestas con 0 ítems: **0**
- Entradas con error en log: **0**
- HTTP 5xx: **0**
- Ítems sin `id` válido (omitidos del listado API, mismo criterio que sync): **0**

Detalle completo: `reports/moobiz_drivers_pages.csv` y `reports/moobiz_drivers_pages.json`.

## Causa probable (lectura de evidencia)

- **La API reporta `total=1812` pero solo se obtuvieron 1797 IDs únicos**: posible límite de páginas (`MOOBIZ_DRIVERS_MAX_PAGES`), corte por error de red, o paginación que no avanza (revisar CSV/JSON de páginas).

## Recomendación rápida
- **Full re-sync** tras corregir `MOOBIZ_DRIVERS_MAX_PAGES` / lógica de `page` vs `offset` si el informe muestra corte prematuro.

## Pasos siguientes sugeridos
1. Abrir `moobiz_drivers_pages.csv` y verificar últimas filas: `items_returned`, `ids_extracted`, `any_duplicates_with_previous_page`.
2. Comparar `total_api` con `total_api_ids_unique` y con `accLen` en el JSON de páginas.
3. Si el fetch actual trae 1811 IDs y la tabla 1796, auditar logs del último `sync_monitor` / errores de Supabase en el momento del upsert.
4. Si el fetch actual trae 1796 IDs, ajustar paginación (no aplicado en este informe).
