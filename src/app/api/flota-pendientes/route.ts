import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";

export const runtime = "nodejs";

const PAGE_SIZE_DEFAULT = 25;
const PAGE_SIZE_MAX = 100;

const BASE_WHERE = `
  COALESCE("Precio Total", 0) = 0
  AND upper(trim(coalesce("Estado", ''))) = 'FINALIZADO'
`;

let poolSingleton: Pool | null = null;

function getPool(): Pool {
  const conn = process.env.DATABASE_URL?.trim();
  if (!conn) {
    throw new Error(
      "DATABASE_URL no está definida. Es necesaria para consultar vista.vw_moobiz_31cols_pe con los filtros del SQL acordado.",
    );
  }
  if (!poolSingleton) {
    poolSingleton = new Pool({ connectionString: conn, max: 5 });
  }
  return poolSingleton;
}

function parseSucursalFilter(raw: string | null): string | null {
  const v = (raw ?? "").trim().toUpperCase();
  if (v === "LIMA" || v === "PROVINCIA") return v;
  return null;
}

function sanitizeProduct(raw: string | null): string | null {
  const v = (raw ?? "").trim();
  if (!v || v === "__all__") return null;
  if (v.length > 400) return null;
  return v;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const meta = url.searchParams.get("meta")?.trim();
    const pool = getPool();

    if (meta === "products") {
      const sql = `
        SELECT DISTINCT trim("Producto") AS producto
        FROM vista.vw_moobiz_31cols_pe
        WHERE ${BASE_WHERE}
          AND "Producto" IS NOT NULL
          AND trim(coalesce("Producto", '')) <> ''
        ORDER BY 1
      `;
      const { rows } = await pool.query<{ producto: string }>(sql);
      const products = rows
        .map((r) => (typeof r.producto === "string" ? r.producto.trim() : ""))
        .filter(Boolean);
      return NextResponse.json({ products });
    }

    const sucursalParam = parseSucursalFilter(url.searchParams.get("sucursal"));
    const productParam = sanitizeProduct(url.searchParams.get("producto"));

    const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
    const pageSizeRaw = Number.parseInt(url.searchParams.get("pageSize") ?? String(PAGE_SIZE_DEFAULT), 10) || PAGE_SIZE_DEFAULT;
    const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, pageSizeRaw));
    const offset = (page - 1) * pageSize;

    const filterSucursal = `
      AND ($1::text IS NULL OR (CASE
        WHEN upper(trim(coalesce("Sucursal", ''))) = 'LIMA' THEN 'LIMA'
        ELSE 'PROVINCIA'
      END) = $1)`;

    const filterProduct = ` AND ($2::text IS NULL OR "Producto" = $2)`;

    const countSql = `
      SELECT count(*)::int AS c
      FROM vista.vw_moobiz_31cols_pe
      WHERE ${BASE_WHERE}
      ${filterSucursal}
      ${filterProduct}
    `;

    const listSql = `
      SELECT
        "ID Servicio"::text AS "ID Servicio",
        CASE
          WHEN upper(trim(coalesce("Sucursal", ''))) = 'LIMA' THEN 'LIMA'
          ELSE 'PROVINCIA'
        END AS "Sucursal",
        "F. Finalizado",
        "Producto",
        "Precio Total"
      FROM vista.vw_moobiz_31cols_pe
      WHERE ${BASE_WHERE}
      ${filterSucursal}
      ${filterProduct}
      ORDER BY "F. Finalizado" DESC NULLS LAST
      LIMIT $3 OFFSET $4
    `;

    const baseParams: unknown[] = [sucursalParam, productParam];

    const [countRes, listRes] = await Promise.all([
      pool.query<{ c: number }>(countSql, baseParams),
      pool.query<Record<string, unknown>>(listSql, [...baseParams, pageSize, offset]),
    ]);

    const total = countRes.rows[0]?.c ?? 0;

    return NextResponse.json({
      data: listRes.rows,
      total,
      page,
      pageSize,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: message, data: [], total: 0, page: 1, pageSize: PAGE_SIZE_DEFAULT },
      { status: 500 },
    );
  }
}
