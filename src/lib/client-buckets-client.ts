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

export type ClientBucketCompaniesSearchResponse = {
  data: ClientBucketCompanyOption[];
  items: ClientBucketCompanyOption[];
  total: number;
  limit: number;
  offset: number;
};

export async function searchClientBucketCompanies(
  q: string,
  options?: { signal?: AbortSignal; limit?: number; offset?: number },
): Promise<ClientBucketCompaniesSearchResponse> {
  const params = new URLSearchParams({ q });
  if (options?.limit != null) params.set("limit", String(options.limit));
  if (options?.offset != null) params.set("offset", String(options.offset));

  const res = await fetch(`/api/client-buckets/companies?${params}`, {
    cache: "no-store",
    signal: options?.signal,
  });
  const json = await parseJson<ClientBucketCompaniesSearchResponse>(res);
  const items = json.items ?? json.data ?? [];
  return {
    data: items,
    items,
    total: json.total ?? items.length,
    limit: json.limit ?? options?.limit ?? items.length,
    offset: json.offset ?? options?.offset ?? 0,
  };
}
