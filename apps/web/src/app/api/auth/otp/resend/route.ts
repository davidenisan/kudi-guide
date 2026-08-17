import { NextResponse, type NextRequest } from "next/server";

const apiUrl = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export async function POST(request: NextRequest) {
  const response = await fetch(`${apiUrl}/auth/otp/resend`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(await request.json()),
  });

  return NextResponse.json(await response.json(), { status: response.status });
}
