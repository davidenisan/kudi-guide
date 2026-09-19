import { NextRequest, NextResponse } from "next/server";
export async function POST(request: NextRequest) {
 const token = request.cookies.get("kg_access_token")?.value;
 if (token) {
  try {
   const upstream = await fetch(`${process.env.API_INTERNAL_URL ?? "http://localhost:4000"}/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(10000) });
   if (!upstream.ok) throw new Error();
  } catch { return NextResponse.json({ error: "Could not log out. Please try again." }, { status: 503 }); }
 }
 const response = NextResponse.json({ success: true });
 for (const name of ["kg_access_token", "kg_tg_code", "kg_tg_verifier"]) response.cookies.set(name, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 0, path: "/" });
 return response;
}
