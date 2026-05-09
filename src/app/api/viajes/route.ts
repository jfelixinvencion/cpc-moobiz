import { createClient } from "@supabase/supabase-js";
import { matchesProductFilter } from "@/lib/product-categories";

export const runtime = "nodejs";

const TABLE_NAME = "viajes_activos";

type ViajeRow = {
  id: string | number | null;
  empresa?: string | null;
  usuario?: string | null;
  conductor?: string | null;
  estado?: string | null;
  pasajero?: string | null;
  fecha?: string | null;
  fecha_registro?: string | null;
  producto?: string | null;
  monto?: number | string | null;
  origen?: string | null;
  destino?: string | null;
  operador?: string | null;
};

function getEnvTrimmed(keys: string[]): string | null {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}

function getSupabaseClient() {
  const supabaseUrl = getEnvTrimmed(["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]);
  const serviceRoleKey = getEnvTrimmed(["SUPABASE_SERVICE_ROLE_KEY"]);

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Faltan variables de entorno para Supabase: SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function toText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

export async function GET(request: Request): Promise<Response> {
  try {
    const requestUrl = new URL(request.url);
    const scope = requestUrl.searchParams.get("scope");
    const productFilter = toText(requestUrl.searchParams.get("product"));

    if (scope !== "all") {
      return Response.json(
        {
          error:
            "Parametro requerido: scope=all. El listado de viajes solo esta disponible con ?scope=all (filtro opcional: product).",
        },
        { status: 400 },
      );
    }

    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select(
        "id, empresa, usuario, conductor, estado, pasajero, fecha, fecha_registro, producto, monto, origen, destino, operador",
      )
      .order("id", { ascending: false });

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    const rows = (data ?? []) as ViajeRow[];
    const allRows = rows.filter((row) => matchesProductFilter(row.producto, productFilter));
    return Response.json({ data: allRows });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error inesperado en /api/viajes";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as { ids?: unknown };
    const ids = Array.isArray(body?.ids)
      ? body.ids.map((value) => String(value).trim()).filter(Boolean)
      : [];

    if (ids.length === 0) {
      return Response.json({ error: "Debes enviar un arreglo de IDs." }, { status: 400 });
    }

    const supabase = getSupabaseClient();
    const { error } = await supabase.from(TABLE_NAME).delete().in("id", ids);

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ deleted: ids.length });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error inesperado eliminando viajes";
    return Response.json({ error: message }, { status: 500 });
  }
}
