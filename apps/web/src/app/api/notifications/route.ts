import { NextRequest } from "next/server";
import { proxy } from "@/lib/api-proxy";
export const PATCH = (request: NextRequest) => proxy(request, "/notifications");
export const GET = PATCH;
