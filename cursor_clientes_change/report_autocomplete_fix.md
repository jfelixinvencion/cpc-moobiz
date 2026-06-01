# Fix autocomplete bolsas Clientes

## Causa del parpadeo

El modal ejecutaba un único `useEffect` que, ante cualquier tecla, lanzaba búsquedas en **los 3 niveles** a la vez. Las respuestas tardías pisaban el estado (`race`) y `runSearch` vaciaba opciones al reiniciar.

## Solución

- Componente **`ClientesBucketCompanySearch`** por columna (aislamiento de estado).
- Debounce 300 ms (`useDebouncedValue`).
- `AbortController` + `requestId` para ignorar respuestas obsoletas.
- Opciones se mantienen visibles mientras llega la nueva respuesta; spinner en el input.
- **Agregar** solo con empresa **seleccionada** (clic o Enter).
- Modal ancho: `max-w-[1100px]`, `w-[95vw]` (clase `clientes-buckets-modal`).

## API

`GET /api/client-buckets/companies` devuelve `{ data, items, total, limit, offset }`.

## QA manual

1. Planificación → Clientes → Gestionar bolsas.
2. Escribir "Fenix" en Nivel 1: sin parpadeo continuo, lista estable.
3. Clic en una fila → "Seleccionada: …" → **Agregar a Nivel 1** habilitado.
4. Verificar badge en la matriz.
