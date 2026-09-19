import { type NextRequest } from "next/server";
import { proxy } from "@/lib/api-proxy";
export const GET = (request: NextRequest) => proxy(request, "/telegram/status");
