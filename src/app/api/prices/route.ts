import { NextResponse } from "next/server";

export async function GET() {
  // Stub — Week 3 will implement price fetching
  return NextResponse.json(
    { message: "Prices endpoint — coming in Week 3" },
    { status: 501 }
  );
}
