import type {
  ClientBucketBulkBody,
  ClientBucketCompanyOption,
  ClientBucketRow,
  ClientBucketUpsertBody,
} from "./client-buckets-types";

async function parseJson<T>(res: Response): Promise<T> {
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(
      typeof json.error === "string" && json.error.trim()
        ? json.error
        : `Error HTTP ${res.status}`,
    );
  }
  return json;
}

export async function fetchClientBuckets(): Promise<ClientBucketRow[]> {
  const res = await fetch("/api/client-buckets", { cache: "no-store" });
  const json = await parseJson<{ data: ClientBucketRow[] }>(res);
  return json.data ?? [];
}

export async function upsertClientBucketApi(
  body: ClientBucketUpsertBody,
): Promise<ClientBucketRow> {
  const res = await fetch("/api/client-buckets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await parseJson<{ data: ClientBucketRow }>(res);
  return json.data;
}

export async function deleteClientBucketApi(coId: string): Promise<void> {
  const res = await fetch(`/api/client-buckets/${encodeURIComponent(coId)}`, {
    method: "DELETE",
  });
  await parseJson<{ ok: boolean }>(res);
}

export async function bulkUpsertClientBucketsApi(
  body: ClientBucketBulkBody,
): Promise<ClientBucketRow[]> {
  const res = await fetch("/api/client-buckets/bulk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await parseJson<{ data: ClientBucketRow[] }>(res);
  return json.data ?? [];
}

export async function searchClientBucketCompanies(
  q: string,
): Promise<ClientBucketCompanyOption[]> {
  const params = new URLSearchParams({ q });
  const res = await fetch(`/api/client-buckets/companies?${params}`, {
    cache: "no-store",
  });
  const json = await parseJson<{ data: ClientBucketCompanyOption[] }>(res);
  return json.data ?? [];
}
