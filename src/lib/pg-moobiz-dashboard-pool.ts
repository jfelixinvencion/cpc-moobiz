import { Pool } from "pg";

let poolSingleton: Pool | null = null;

/** Pool compartido para rutas que leen `vista.*` vía DATABASE_URL. */
export function getMoobizViewsPool(): Pool {
  const conn = process.env.DATABASE_URL?.trim();
  if (!conn) {
    throw new Error("DATABASE_URL no está definida.");
  }
  if (!poolSingleton) {
    poolSingleton = new Pool({ connectionString: conn, max: 5 });
  }
  return poolSingleton;
}
