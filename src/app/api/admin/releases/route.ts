/**
 * /api/admin/releases — Release Dashboard (Fase 4) + Rollback Engine (Fase 5).
 *
 *   GET  ?                          → DashboardData (JSON)
 *   GET  ?download=<canal>/<name>   → bytes del artefacto (descarga / copiar URL)
 *   POST { action:"plan", channel, toFull }                  → comparación actual vs destino
 *   POST { action:"rollback", channel, toFull, reason }      → rollback REAL (Transport Engine)
 *
 * El rollback reutiliza el Rollback Engine (scripts/release/transport/rollback.mjs), que a su vez
 * usa TransportEngine.rollback(). No duplica lógica. Acceso gateado por ADMIN_ENABLED.
 */
import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { ADMIN_ENABLED } from "@/config/admin";
import { readDashboard, resolveArtifact, planRollbackServer, executeRollbackServer, promoteServer, retryServer } from "@/server/releases/reader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTENT_TYPE: Record<string, string> = {
  json: "application/json", md: "text/markdown", exe: "application/octet-stream",
  msi: "application/octet-stream", txt: "text/plain",
};

export async function GET(req: Request) {
  if (!ADMIN_ENABLED) return NextResponse.json({ error: "admin deshabilitado" }, { status: 403 });
  const url = new URL(req.url);
  const root = process.cwd();

  // Descarga de un artefacto concreto (botón "Descargar" / "Copiar URL").
  const download = url.searchParams.get("download");
  if (download) {
    const slash = download.indexOf("/");
    if (slash < 0) return NextResponse.json({ error: "formato: <canal>/<archivo>" }, { status: 400 });
    const channel = download.slice(0, slash);
    const name = download.slice(slash + 1);
    const path = resolveArtifact(root, channel, name);
    if (!path) return NextResponse.json({ error: "artefacto no encontrado" }, { status: 404 });
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    const buf = readFileSync(path);
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "content-type": CONTENT_TYPE[ext] ?? "application/octet-stream",
        "content-disposition": `attachment; filename="${basename(name)}"`,
        "cache-control": "no-store",
      },
    });
  }

  try {
    const data = await readDashboard({ root, env: process.env });
    return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

const CHANNELS = new Set(["stable", "beta", "developer", "nightly"]);

export async function POST(req: Request) {
  if (!ADMIN_ENABLED) return NextResponse.json({ error: "admin deshabilitado" }, { status: 403 });
  const root = process.cwd();
  let body: { action?: string; channel?: string; toChannel?: string; toFull?: string; reason?: string } = {};
  try { body = await req.json(); } catch { /* vacío */ }
  const { action, channel, toChannel, toFull, reason } = body;

  // Seguridad básica de entrada (el motor valida el resto: firma, hashes, anillo…).
  if (!channel || !CHANNELS.has(channel)) return NextResponse.json({ error: "canal inválido" }, { status: 400 });
  const needsTarget = action === "plan" || action === "rollback";
  if (needsTarget && (!toFull || !/^[\w.+-]+$/.test(toFull))) return NextResponse.json({ error: "versión inválida" }, { status: 400 });
  if (action === "promote" && (!toChannel || !CHANNELS.has(toChannel))) return NextResponse.json({ error: "canal destino inválido" }, { status: 400 });

  try {
    if (action === "plan") {
      return NextResponse.json(await planRollbackServer({ root, env: process.env, channel, toFull: toFull! }), { headers: { "cache-control": "no-store" } });
    }
    if (action === "rollback") {
      const result = await executeRollbackServer({ root, env: process.env, channel, toFull: toFull!, reason: reason ?? "", user: "admin" });
      // El motor NO lanza por validación/verify: devuelve ok:false. Reflejamos el status HTTP.
      return NextResponse.json(result, { status: result.ok ? 200 : 422, headers: { "cache-control": "no-store" } });
    }
    if (action === "retry") {
      const result = await retryServer({ root, env: process.env, channel });
      return NextResponse.json(result, { status: result.ready ? 200 : 422, headers: { "cache-control": "no-store" } });
    }
    if (action === "promote") {
      const result = await promoteServer({ root, env: process.env, channel, toChannel, user: "admin" });
      return NextResponse.json(result, { status: result.ready ? 200 : 422, headers: { "cache-control": "no-store" } });
    }
    return NextResponse.json({ error: `acción desconocida: ${action}` }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
