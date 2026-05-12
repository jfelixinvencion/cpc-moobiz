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
export async function dispatchSyncHistoryWorkflow(): Promise<void> {
  const token = getGithubToken();
  if (!token) {
    throw new Error(
      "Falta GITHUB_PAT o GITHUB_TOKEN en el entorno del servidor. En Vercel: Project → Settings → Environment Variables, crea GITHUB_PAT (scope del proyecto, entorno Production) y redeploy.",
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

  if (res.status === 204) return;

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

  throw new Error(message);
}
