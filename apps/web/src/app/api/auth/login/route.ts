import { NextRequest } from "next/server";
import { credentials } from "@/lib/credential-proxy";
export async function POST(request: NextRequest) { return credentials(request, "login"); }
