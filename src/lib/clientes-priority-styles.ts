import type { ClientBucketLevel } from "./client-buckets-types";

/** Clase CSS local para fila con prioridad asignada (ver clientes-priority.css). */
export function clientesPriorityRowClass(level: ClientBucketLevel | undefined): string {
  if (level === 1) return "clientes-priority-n1";
  if (level === 2) return "clientes-priority-n2";
  if (level === 3) return "clientes-priority-n3";
  return "";
}
