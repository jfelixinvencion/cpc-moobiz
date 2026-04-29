import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function getSupabaseUrl(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim() || "";
}

export function getSupabaseServerClient(): {
  client: SupabaseClient;
  usingServiceRole: boolean;
} {
  const supabaseUrl = getSupabaseUrl();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
  if (supabaseUrl && serviceRoleKey) {
    return {
      client: createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      }),
      usingServiceRole: true,
    };
  }
  const fallbackUrl =
    process.env.SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
  const fallbackKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
  if (!fallbackUrl || !fallbackKey) {
    throw new Error(
      "Faltan variables: SUPABASE_URL (o NEXT_PUBLIC_SUPABASE_URL) y SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  return {
    client: createClient(fallbackUrl, fallbackKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
    usingServiceRole: false,
  };
}
