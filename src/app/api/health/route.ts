/** F67 · LIVENESS — el proceso responde. Sin dependencias, sin datos. Para el gestor de procesos / balanceador. */
import { NextResponse } from "next/server";
import { liveness } from "@/server/ops/health";
import pkg from "../../../../package.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(liveness(pkg.version), { headers: { "cache-control": "no-store" } });
}
