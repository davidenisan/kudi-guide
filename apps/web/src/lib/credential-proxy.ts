import { NextRequest, NextResponse } from "next/server";
export async function credentials(request: NextRequest, action: "register" | "login" | "setup") {
 const origin = request.headers.get("origin");
 const allowedOrigins = [process.env.APP_ORIGIN ?? request.nextUrl.origin, ...(process.env.APP_ALLOWED_ORIGINS ?? "").split(",")].map(value => value.trim()).filter(Boolean);
 if (origin && !allowedOrigins.includes(origin)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
 try {
  const token = request.cookies.get("kg_access_token")?.value;
  const upstream = await fetch(`${process.env.API_INTERNAL_URL ?? "http://localhost:4000"}/auth/${action}`, {
   method: "POST", headers: { "content-type": "application/json", ...(action === "setup" && token ? { Authorization: `Bearer ${token}` } : {}) },
   body: await request.text(), cache: "no-store", signal: AbortSignal.timeout(15000),
  });
  const body = await upstream.json();
  const response = NextResponse.json({ user: body.user, error: body.error }, { status: upstream.status });
  if (upstream.ok && body.accessToken) response.cookies.set("kg_access_token", body.accessToken, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: body.expiresIn });
  return response;
 } catch { return NextResponse.json({ error: "Unable to reach the server. Please try again." }, { status: 503 }); }
}
