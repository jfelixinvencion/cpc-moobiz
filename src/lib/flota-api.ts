import { NextResponse } from "next/server";

export function flotaJson<T>(body: T, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "s-maxage=30, stale-while-revalidate=15" },
  });
}

export function flotaError(msg: string, status = 500) {
  return NextResponse.json(
    { error: msg },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}
