import { NextResponse } from "next/server";

export const PRODUCTIVIDAD_CACHE = "s-maxage=60, stale-while-revalidate=30" as const;

export function productividadJson<T>(body: T, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": PRODUCTIVIDAD_CACHE },
  });
}

export function productividadError(msg: string, status = 500) {
  return NextResponse.json(
    { error: msg },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}

export function rowsToCsv(
  headers: string[],
  rows: Record<string, string | number>[],
): string {
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => esc(row[h] ?? "")).join(","));
  }
  return lines.join("\n");
}
