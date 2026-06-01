# Clientes por empresa — resumen

## Objetivo

Subpestaña **Planificación → Clientes** con timeline por **empresa** (`co_name`), endpoint propio y sin cambios en Seguimiento.

## Cambios

| Área | Detalle |
|------|---------|
| API | `GET /api/clientes-operaciones` — lee `vista.moobiz_services_maestra`, fecha `alt_date`, incluye `dr_id` NULL |
| UI | Eje Y **Empresa**; sin icono GPS; **Abrir** → `https://app.moobiz.pe/actives?id_company={co_id}` |
| Estados | Todos los `state_color_name`, incl. **Pendiente** (ámbar `#ca8a04`) |
| Celdas | Conteo por empresa/hora; varios estados apilados; total central si >1 estado |
| Seguimiento | **Sin cambios** (`seguimiento-operaciones.tsx`, `/api/seguimiento-operaciones`) |

## Prioridad visual multi-estado

En una celda hora+empresa con varios estados: barras proporcionales al conteo por estado (orden `CLIENTES_ESTADO_UI_ORDER`); si hay más de un estado, el número total se superpone al centro. Tooltip al hover lista cada servicio con estado y hora programada.

## QA manual

1. `npm run dev` → Planificación → **Clientes**
2. Verificar filas con nombre de empresa y badge de total
3. Celdas con conteos >1 y color **Pendiente** en leyenda
4. Clic **Abrir** abre Moobiz con `id_company` correcto
5. Operaciones → **Seguimiento** sigue mostrando conductores y GPS

## CI local

- `npm test`: 104 pass, 1 fail preexistente (`control-operaciones-solicitante-filter-query`)
- `npm run build`: OK

## Branch

`feat/clientes-by-company`
