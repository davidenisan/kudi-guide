import { NextRequest, NextResponse } from "next/server";
export async function POST(request: NextRequest) {
 try {
  const checking = request.nextUrl.searchParams.get("check") === "true";
  const code = request.cookies.get("kg_tg_code")?.value;
  const verifier = request.cookies.get("kg_tg_verifier")?.value;
  const upstream = await fetch(`${process.env.API_INTERNAL_URL ?? "http://localhost:4000"}/telegram/login${checking ? "/check" : ""}`, {
   method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(checking ? { code, verifier } : {}), cache: "no-store",
  });
  const body = await upstream.json();
  const response = NextResponse.json(checking ? { pending: body.pending, error: body.error, success: Boolean(body.accessToken) } : { url: body.url, expiresAt: body.expiresAt, error: body.error }, { status: upstream.status });
  const options = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/" };
  if (!checking && upstream.ok) { response.cookies.set("kg_tg_code", body.code, { ...options, maxAge: 600 }); response.cookies.set("kg_tg_verifier", body.verifier, { ...options, maxAge: 600 }); }
  if (body.accessToken) { response.cookies.set("kg_access_token", body.accessToken, { ...options, maxAge: 900 }); response.cookies.set("kg_tg_code", "", { ...options, maxAge: 0 }); response.cookies.set("kg_tg_verifier", "", { ...options, maxAge: 0 }); }
  return response;
 } catch { return NextResponse.json({ error: "Unable to reach the server. Please try again." }, { status: 503 }); }
}
