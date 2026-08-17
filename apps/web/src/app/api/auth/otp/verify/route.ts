import { NextResponse, type NextRequest } from "next/server";

const apiUrl = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export async function POST(request: NextRequest) {
  const response = await fetch(`${apiUrl}/auth/otp/verify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(await request.json()),
  });
  const body = await response.json();
  const nextResponse = NextResponse.json(body, { status: response.status });

  if (response.ok && body.accessToken) {
    nextResponse.cookies.set("kg_access_token", body.accessToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 15 * 60,
    });
  }

  return nextResponse;
}
