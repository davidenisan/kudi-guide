import { type NextRequest } from "next/server";
import { proxy } from "@/lib/api-proxy";
export const DELETE = (request: NextRequest) => proxy(request, "/telegram/connection");
