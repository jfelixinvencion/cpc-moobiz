/**
 * Volcado masivo Moobiz live/vehicles → public.driver_live_raw (RPC).
 * Uso: GitHub Actions (workflow manual) o local con .env.local.
 *
 * Misma lógica que POST /api/moobiz/refresh-gps-raw (runDriverLiveRawRefresh).
 */

import dotenv from "dotenv";

const EXIT = { ENV: 2, SYNC: 5 };

async function main() {
  if (!process.env.GITHUB_ACTIONS && !process.env.CI) {
    dotenv.config({ path: process.env.DOTENV_CONFIG_PATH || ".env.local" });
  }

  if (!process.env.SUPABASE_URL?.trim() && !process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()) {
    console.error("[sync-gps-raw] Falta SUPABASE_URL (o NEXT_PUBLIC_SUPABASE_URL)");
    process.exit(EXIT.ENV);
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    console.error("[sync-gps-raw] Falta SUPABASE_SERVICE_ROLE_KEY");
    process.exit(EXIT.ENV);
  }

  const { runDriverLiveRawRefresh } = await import("../src/lib/driver-live-raw-sync.ts");

  console.log("[sync-gps-raw] Iniciando runDriverLiveRawRefresh()");
  const result = await runDriverLiveRawRefresh();
  console.log("[sync-gps-raw] Resultado:", JSON.stringify(result));
  process.exit(result.ok ? 0 : 1);
}

main().catch((e) => {
  console.error("[sync-gps-raw] Error:", e instanceof Error ? e.message : e);
  process.exit(EXIT.SYNC);
});
