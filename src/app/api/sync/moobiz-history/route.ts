import { NextRequest, NextResponse } from "next/server";

import { formatApiError } from "@/lib/format-api-error";
import { assertQualityWriteAccess } from "@/lib/panel-session";

export const runtime = "nodejs";

const GITHUB_DISPATCH_URL =
  "https://api.github.com/repos/jfelixinvencion/cpc-moobiz/actions/workflows/sync-history.yml/dispatches";

function getGithubToken(): string | null {
  const pat = process.env.GITHUB_PAT?.trim();
  if (pat) return pat;
  const tok = process.env.GITHUB_TOKEN?.trim();
  if (tok) return tok;
  return null;
}

/** Dispara el workflow `sync-history` en GitHub Actions (workflow_dispatch). */
export async function POST(request: NextRequest) {
  try {
    assertQualityWriteAccess(request);
    const token = getGithubToken();
    if (!token) {
      return NextResponse.json(
        { ok: false, error: "Falta GITHUB_PAT o GITHUB_TOKEN en el entorno del servidor." },
        { status: 500 },
      );
    }

    const res = await fetch(GITHUB_DISPATCH_URL, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "main" }),
      cache: "no-store",
    });

    if (res.status === 204) {
      return new NextResponse(null, { status: 204 });
    }

    const text = await res.text();
    let message = text || `GitHub respondió HTTP ${res.status}`;
    try {
      const parsed = JSON.parse(text) as { message?: string };
      if (typeof parsed.message === "string" && parsed.message.trim()) {
        message = parsed.message;
      }
    } catch {
      /* usar texto crudo */
    }

    return NextResponse.json(
      { ok: false, error: message },
      { status: res.status >= 400 && res.status < 600 ? res.status : 502 },
    );
  } catch (error) {
    const message = formatApiError(error);
    const status = message.startsWith("AUTH_REQUIRED") ? 401 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
