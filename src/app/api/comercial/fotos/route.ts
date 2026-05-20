import { NextRequest } from "next/server";

import { comercialError, comercialJson } from "@/lib/comercial-api";
import { STORAGE_BUCKET, getSupabaseAdmin } from "@/lib/comercial-quejas";
import { assertQualityReadAccess } from "@/lib/panel-session";

export const runtime = "nodejs";

const SIGNED_TTL_SEC = 60 * 60;

function sanitizeStoragePath(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.includes("..")) return null;
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed);
      const segments = u.pathname.split("/").filter(Boolean);
      const bucketIdx = segments.indexOf(STORAGE_BUCKET);
      if (bucketIdx >= 0 && bucketIdx < segments.length - 1) {
        return segments.slice(bucketIdx + 1).join("/");
      }
      const objectIdx = segments.indexOf("object");
      if (
        objectIdx >= 0 &&
        segments[objectIdx + 1] === "public" &&
        segments[objectIdx + 2] === STORAGE_BUCKET
      ) {
        return segments.slice(objectIdx + 3).join("/");
      }
    } catch {
      return null;
    }
    return null;
  }
  return trimmed.replace(/^\/+/, "");
}

export async function GET(request: NextRequest) {
  try {
    assertQualityReadAccess(request);
    const url = new URL(request.url);
    const paths = url.searchParams
      .getAll("paths[]")
      .map((p) => sanitizeStoragePath(p))
      .filter((p): p is string => Boolean(p));

    if (paths.length === 0) {
      return comercialError("No paths provided", 400);
    }

    const supabase = getSupabaseAdmin();
    const results: { path: string; url?: string; error?: string }[] = [];

    for (const path of paths) {
      const { data, error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(path, SIGNED_TTL_SEC);
      if (error || !data?.signedUrl) {
        results.push({ path, error: error?.message ?? "No se pudo firmar la URL." });
      } else {
        results.push({ path, url: data.signedUrl });
      }
    }

    return comercialJson({ urls: results });
  } catch (err) {
    console.error("comercial fotos signed error", err);
    const message = err instanceof Error ? err.message : String(err);
    const status = message.startsWith("AUTH_REQUIRED") ? 401 : 500;
    return comercialError(message.startsWith("AUTH_REQUIRED") ? message : "Internal error", status);
  }
}
