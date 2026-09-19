import { type NextRequest } from "next/server";
import { proxy } from "@/lib/api-proxy";
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return proxy(request, `/transactions/${encodeURIComponent((await context.params).id)}`);
}
