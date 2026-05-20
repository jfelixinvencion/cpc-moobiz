import { NextResponse } from "next/server";

export function comercialJson<T>(body: T, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export function comercialError(msg: string, status = 500) {
  return NextResponse.json({ error: msg }, { status });
}
