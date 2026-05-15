# Informe recuperación `fv_items` (moobiz_drivers)

- **total_ids_truncados_en_db** (query length ≤ 1024): 1866
- **total_ids_chequeados** (API en esta corrida): 2
- **total_necesitan_update** (audit: needs_update y api > db): 0
- **primer lote aplicado**: 0 filas

> **Diagnóstico:** si `api_fv_len` del listado Moobiz coincide con `db_fv_len` (p. ej. ambos 1024), la API también entrega `fv_items` truncado; este proceso no puede inventar el resto. Hace falta otra fuente (export Moobiz sin límite, otro endpoint, o corrección en origen).

## Estado por id (primer lote)

(ninguna fila aplicada o lote vacío / rollback)

## Muestra `moobiz_drivers_audit` (ids de esta corrida)

```json
[
  {
    "id": "100088",
    "db_fv_len": 1024,
    "api_fv_len": 1024,
    "needs_update": false,
    "api_payload_head": "{\"ok\": true, \"msg\": \"\", \"item\": {\"id\": \"100088\", \"pic\": \"/users/pic_100088.png?t=1724182402\", \"code\": \"QY0OTA8J\", \"name\": \"LUIS MANUEL\", \"type\": \"3\", \"co_id\": null, \"email\": \"lumalehu@gmail.com\", \"fb_id\": \"\", \"phone\": \"986433260\", \"state\": "
  },
  {
    "id": "100119",
    "db_fv_len": 1024,
    "api_fv_len": 1024,
    "needs_update": false,
    "api_payload_head": "{\"ok\": true, \"msg\": \"\", \"item\": {\"id\": \"100119\", \"pic\": \"/users/pic_100119.png?t=1679755496\", \"code\": \"LNYE5R0I\", \"name\": \"Marcos\", \"type\": \"3\", \"co_id\": null, \"email\": \"Marcoshidalgomedina77@gmail.com\", \"fb_id\": \"\", \"phone\": \"51995812748\","
  }
]
```

## Verificación global

```json
{
  "max_largo": 1024,
  "siguen_cortados": 1866
}
```

## Verificación filas del primer lote (head/tail)

```json
null
```

## Vista `moobiz_drivers_updates_pending` (preview id + inicio SQL)

```json
[]
```

## Errores / notas

```json
{
  "errores": [],
  "notas": [
    "RECOVER_MAX_AUDIT_IDS=2: solo se auditaron 2 de 1866 ids truncados (modo acotado).",
    "Catálogo Moobiz (GET listado limit=3000): 1866 ítems, 1866 ids indexados para cruce fv_items.",
    "No hay filas pendientes con api_fv_len > db_fv_len; no se aplica lote."
  ]
}
```

> No se ejecutaron lotes adicionales tras el primero (máx. 50).