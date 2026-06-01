import type { Pool, PoolClient } from "pg";

import type {
  ClientBucketCompanyOption,
  ClientBucketLevel,
  ClientBucketRow,
  ClientBucketUpsertBody,
} from "./client-buckets-types";

const VISTA_SERVICES = "vista.moobiz_services_maestra";
const TABLE = 'public."Empresas_Criticas"';

export class ClientBucketsError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ClientBucketsError";
    this.status = status;
  }
}

export function parseCoId(raw: unknown): string {
  if (raw === null || raw === undefined) {
    throw new ClientBucketsError("co_id es obligatorio.", 400);
  }
  const s = String(raw).trim();
  if (!s) throw new ClientBucketsError("co_id es obligatorio.", 400);
  return s;
}

export function parseBucketLevel(raw: unknown): ClientBucketLevel {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (n === 1 || n === 2 || n === 3) return n;
  throw new ClientBucketsError("bucket_level debe ser 1, 2 o 3.", 400);
}

export function normalizeCoName(raw: unknown, fallback: string): string {
  const s = raw === null || raw === undefined ? "" : String(raw).trim();
  return s || fallback;
}

function mapRow(r: Record<string, unknown>): ClientBucketRow {
  return {
    co_id: String(r.co_id ?? ""),
    co_name: String(r.co_name ?? ""),
    bucket_level: Number(r.bucket_level) as ClientBucketLevel,
    created_by: String(r.created_by ?? ""),
    created_at:
      r.created_at instanceof Date
        ? r.created_at.toISOString()
        : String(r.created_at ?? ""),
  };
}

export async function companyExistsInVista(
  db: Pool | PoolClient,
  coId: string,
): Promise<{ exists: boolean; co_name: string | null }> {
  const res = await db.query<{ co_name: string | null }>(
    `SELECT co_name
     FROM ${VISTA_SERVICES}
     WHERE co_id::text = $1
     LIMIT 1`,
    [coId],
  );
  if (res.rowCount === 0) return { exists: false, co_name: null };
  const name = res.rows[0]?.co_name;
  return {
    exists: true,
    co_name: name != null ? String(name).trim() || null : null,
  };
}

export async function listClientBuckets(db: Pool): Promise<ClientBucketRow[]> {
  const res = await db.query(
    `SELECT co_id, co_name, bucket_level, created_by, created_at
     FROM ${TABLE}
     ORDER BY bucket_level ASC, co_name ASC`,
  );
  return res.rows.map((r) => mapRow(r as Record<string, unknown>));
}

export async function upsertClientBucket(
  db: Pool | PoolClient,
  body: ClientBucketUpsertBody,
  createdBy: string,
): Promise<ClientBucketRow> {
  const coId = parseCoId(body.co_id);
  const bucketLevel = parseBucketLevel(body.bucket_level);

  const vista = await companyExistsInVista(db, coId);
  if (!vista.exists) {
    throw new ClientBucketsError(
      `co_id ${coId} no existe en ${VISTA_SERVICES}.`,
      404,
    );
  }

  const coName = normalizeCoName(body.co_name, vista.co_name ?? `Empresa ${coId}`);

  const res = await db.query(
    `INSERT INTO ${TABLE} (co_id, co_name, bucket_level, created_by, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (co_id) DO UPDATE SET
       co_name = EXCLUDED.co_name,
       bucket_level = EXCLUDED.bucket_level,
       created_by = EXCLUDED.created_by,
       updated_at = now()
     RETURNING co_id, co_name, bucket_level, created_by, created_at`,
    [coId, coName, bucketLevel, createdBy],
  );

  return mapRow(res.rows[0] as Record<string, unknown>);
}

export async function deleteClientBucket(db: Pool, coIdRaw: string): Promise<boolean> {
  const coId = parseCoId(coIdRaw);
  const res = await db.query(`DELETE FROM ${TABLE} WHERE co_id = $1`, [coId]);
  return (res.rowCount ?? 0) > 0;
}

export async function bulkUpsertClientBuckets(
  db: Pool,
  coIdsRaw: unknown[],
  bucketLevelRaw: unknown,
  createdBy: string,
  coNames?: Record<string, string>,
): Promise<ClientBucketRow[]> {
  const bucketLevel = parseBucketLevel(bucketLevelRaw);
  if (!Array.isArray(coIdsRaw) || coIdsRaw.length === 0) {
    throw new ClientBucketsError("co_ids debe ser un array no vacío.", 400);
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const out: ClientBucketRow[] = [];
    for (const raw of coIdsRaw) {
      const coId = parseCoId(raw);
      const nameFromMap = coNames?.[coId];
      const row = await upsertClientBucket(
        client,
        { co_id: coId, co_name: nameFromMap, bucket_level: bucketLevel },
        createdBy,
      );
      out.push(row);
    }
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function searchCompaniesInVista(
  db: Pool,
  query: string,
  limit = 25,
): Promise<ClientBucketCompanyOption[]> {
  const q = query.trim();
  if (!q) return [];

  const res = await db.query<{ co_id: string; co_name: string }>(
    `SELECT DISTINCT ON (co_id::text)
       co_id::text AS co_id,
       COALESCE(NULLIF(trim(co_name), ''), 'Empresa ' || co_id::text) AS co_name
     FROM ${VISTA_SERVICES}
     WHERE co_id IS NOT NULL
       AND (
         co_name ILIKE '%' || $1 || '%'
         OR co_id::text = $1
       )
     ORDER BY co_id::text, co_name
     LIMIT $2`,
    [q, limit],
  );

  return res.rows.map((r) => ({
    co_id: String(r.co_id),
    co_name: String(r.co_name),
  }));
}

export function bucketLevelLabel(level: ClientBucketLevel): string {
  return `N${level}`;
}

export function bucketLevelBadgeClass(level: ClientBucketLevel): string {
  if (level === 1) return "bg-amber-100 text-amber-900 border-amber-200";
  if (level === 2) return "bg-orange-100 text-orange-900 border-orange-200";
  return "bg-red-100 text-red-900 border-red-200";
}
