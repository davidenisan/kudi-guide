import { NextResponse, type NextRequest } from "next/server";
export async function proxy(request: NextRequest, path: string) {
  const token = request.cookies.get("kg_access_token")?.value;
  if (!token) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  try {
    const response = await fetch(`${process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}${path}`, {
      method: request.method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: ["POST", "PATCH"].includes(request.method) ? await request.text() || undefined : undefined,
      cache: "no-store", signal: AbortSignal.timeout(15000),
    });
    return NextResponse.json(await response.json(), { status: response.status });
  } catch { return NextResponse.json({ error: "Unable to reach the server. Please try again." }, { status: 503 }); }
}
