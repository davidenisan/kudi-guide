import { type NextRequest } from "next/server";
import { proxy } from "@/lib/api-proxy";
export const POST = (request: NextRequest) => proxy(request, "/telegram/link-code");
