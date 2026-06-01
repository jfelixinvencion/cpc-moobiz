import { ClientBucketsError } from "./client-buckets";

export function clientBucketsJson<T>(data: T, status = 200): Response {
  return Response.json(data, { status });
}

export function clientBucketsErrorResponse(error: unknown): Response {
  if (error instanceof ClientBucketsError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  const message =
    error instanceof Error ? error.message : "Error inesperado en client-buckets";
  if (message.startsWith("AUTH_REQUIRED:")) {
    return Response.json({ error: message.replace(/^AUTH_REQUIRED:\s*/, "") }, { status: 401 });
  }
  console.error("[client-buckets]", error);
  return Response.json({ error: message }, { status: 500 });
}
