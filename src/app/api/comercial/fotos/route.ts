import { NextRequest } from "next/server";

import { comercialError, comercialJson } from "@/lib/comercial-api";
import { STORAGE_BUCKET, getSupabaseAdmin } from "@/lib/comercial-quejas";
import { getMoobizViewsPool } from "@/lib/pg-moobiz-dashboard-pool";
import { assertQualityReadAccess } from "@/lib/panel-session";

export const runtime = "nodejs";

const SIGNED_TTL_SEC = 60 * 60;
const BUCKET = process.env.STORAGE_BUCKET?.trim() || STORAGE_BUCKET;

if (!process.env.SUPABASE_URL?.trim() && !process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()) {
  console.error("Missing SUPABASE_URL for signed URLs endpoint");
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY for signed URLs endpoint");
}

/** Convierte URL pública/firmada de Supabase o path relativo al path dentro del bucket. */
function extractPath(item: string): string | null {
  const trimmed = item.trim();
  if (!trimmed || trimmed.includes("..")) return null;

  if (trimmed.includes(`/public/${BUCKET}/`)) {
    const part = trimmed.split(`/public/${BUCKET}/`)[1];
    return part.split("?")[0].replace(/^\/+/, "") || null;
  }
  if (trimmed.includes(`/sign/${BUCKET}/`)) {
    const part = trimmed.split(`/sign/${BUCKET}/`)[1];
    return part.split("?")[0].replace(/^\/+/, "") || null;
  }

  const objectPublic = `/object/public/${BUCKET}/`;
  if (trimmed.includes(objectPublic)) {
    const part = trimmed.split(objectPublic)[1];
    return part.split("?")[0].replace(/^\/+/, "") || null;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed);
      const segments = u.pathname.split("/").filter(Boolean);
      const bucketIdx = segments.indexOf(BUCKET);
      if (bucketIdx >= 0 && bucketIdx < segments.length - 1) {
        return segments.slice(bucketIdx + 1).join("/");
      }
    } catch {
      return null;
    }
    return null;
  }

  return trimmed.replace(/^\/+/, "") || null;
}

async function pathsFromQuejaId(quejaId: string): Promise<string[]> {
  const id = Number(quejaId);
  if (!Number.isInteger(id) || id <= 0) return [];
  try {
    const pool = getMoobizViewsPool();
    const { rows } = await pool.query<{ fotos_revision: string[] | null }>(
      `SELECT fotos_revision FROM comercial.registro_quejas WHERE id = $1`,
      [id],
    );
    const arr = rows[0]?.fotos_revision;
    if (!Array.isArray(arr)) return [];
    return arr
      .map((p) => (typeof p === "string" ? extractPath(p) : null))
      .filter((p): p is string => Boolean(p));
  } catch (err) {
    console.error("fotos quejaId DB read error", err);
    return [];
  }
}

export async function GET(request: NextRequest) {
  try {
    assertQualityReadAccess(request);
    const url = new URL(request.url);
    const quejaId = url.searchParams.get("quejaId");
    const pathsQuery = url.searchParams.getAll("paths[]");

    let paths: string[] = [];

    if (quejaId) {
      paths = paths.concat(await pathsFromQuejaId(quejaId));
    }

    if (pathsQuery.length) {
      paths = paths.concat(
        pathsQuery.map((p) => extractPath(p)).filter((p): p is string => Boolean(p)),
      );
    }

    paths = Array.from(new Set(paths));

    if (paths.length === 0) {
      return comercialJson({ urls: [] });
    }

    const supabase = getSupabaseAdmin();
    const results: { path: string; url?: string; error?: string }[] = [];

    for (const path of paths) {
      try {
        const { data, error } = await supabase.storage
          .from(BUCKET)
          .createSignedUrl(path, SIGNED_TTL_SEC);
        if (error || !data?.signedUrl) {
          results.push({ path, error: error?.message ?? "No se pudo firmar la URL." });
        } else {
          results.push({ path, url: data.signedUrl });
        }
      } catch (e) {
        results.push({
          path,
          error: e instanceof Error ? e.message : "unknown",
        });
      }
    }

    return comercialJson({ urls: results });
  } catch (err) {
    console.error("fotos endpoint error", err);
    const message = err instanceof Error ? err.message : String(err);
    const status = message.startsWith("AUTH_REQUIRED") ? 401 : 500;
    return comercialError(
      message.startsWith("AUTH_REQUIRED") ? message : "Internal error",
      status,
    );
  }
}
