import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    hasGITHUB_PAT: !!process.env.GITHUB_PAT,
    hasGITHUB_TOKEN: !!process.env.GITHUB_TOKEN,
  });
}
