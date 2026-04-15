import { NextResponse } from "next/server";
import { getAllAuthStatuses } from "@/lib/auth/auth-manager";

export async function GET() {
  try {
    const statuses = await getAllAuthStatuses();
    return NextResponse.json({ statuses });
  } catch (error) {
    console.error("Failed to get auth statuses:", error);
    return NextResponse.json(
      { error: "Failed to get auth statuses" },
      { status: 500 }
    );
  }
}
