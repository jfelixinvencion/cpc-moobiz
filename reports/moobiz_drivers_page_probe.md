# Probe paginación: Moobiz `/api/admin/drivers`

- Generado: 2026-04-24T22:11:01.233Z
- Base URL: `https://app.moobiz.pe/api/admin/drivers`
- Token origen: **sync_state.moobiz_token (GET)**
- Límite fijo del probe: **1000**

## Resumen

- **Parámetro recomendado (heurística):** `p`
- **page=1 vs page=2 avanza:** no o incompleto
- **Repetición page 1–3 (misma firma de ids):** windows_differ_or_incomplete

### Recomendación inmediata para el sync

Considerar cambiar el sync a **`p`** en lugar de **`page`** si `p=2` diverge de `page=2` y coincide con el total esperado.

## Detalle por petición

| label | status | items | first_id | last_id | api_ok |
|-------|--------|-------|----------|---------|--------|
| page_1 | 200 | 814 | 120020… | 83320… | true |
| page_2 | 200 | 0 | — | — | true |
| page_3 | 200 | 0 | — | — | true |
| page_0 | 200 | 1000 | 130619… | 120035… | true |
| p_2 | 200 | 1000 | 130619… | 120035… | true |
| pagina_2 | 200 | 1000 | 130619… | 120035… | true |
| offset_1000_no_page | 200 | 1000 | 130619… | 120035… | true |

## Headers relevantes (por petición)
### page_1
```json
{
  "set-cookie": [
    "PHPSESSID=61icgnthjktua6uanlut7e42v0; path=/"
  ]
}
```

- sample_10_ids: `["120020","120012","120001","119990","119989","119988","119986","119985","119979","119972"]`

### page_2
```json
{
  "set-cookie": [
    "PHPSESSID=h9rb9blep0nqpf9tktk47oiknd; path=/"
  ]
}
```

- sample_10_ids: `[]`

### page_3
```json
{
  "set-cookie": [
    "PHPSESSID=usr8jn2odg6p03o93gvi0tqb6n; path=/"
  ]
}
```

- sample_10_ids: `[]`

### page_0
```json
{
  "set-cookie": [
    "PHPSESSID=vgpgjmsiffbqe63i3k4qer696b; path=/"
  ]
}
```

- sample_10_ids: `["130619","130617","130616","130615","130609","130593","130592","130589","130588","130587"]`

### p_2
```json
{
  "set-cookie": [
    "PHPSESSID=6ti3r0ep4j2eil1canhpaq239t; path=/"
  ]
}
```

- sample_10_ids: `["130619","130617","130616","130615","130609","130593","130592","130589","130588","130587"]`

### pagina_2
```json
{
  "set-cookie": [
    "PHPSESSID=j9fi7nc5n21lkbph61j65hsqpa; path=/"
  ]
}
```

- sample_10_ids: `["130619","130617","130616","130615","130609","130593","130592","130589","130588","130587"]`

### offset_1000_no_page
```json
{
  "set-cookie": [
    "PHPSESSID=4j6gfq1p1g5e6vscv09re8sohg; path=/"
  ]
}
```

- sample_10_ids: `["130619","130617","130616","130615","130609","130593","130592","130589","130588","130587"]`
