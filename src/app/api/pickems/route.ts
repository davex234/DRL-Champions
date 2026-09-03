/**
 * POST /api/pickems — guardar una predicción (bloque F).
 *
 *   { "questionId": "<uuid>", "option": "demo-th" }
 *
 * El usuario sale del Bearer, nunca del cuerpo. El CIERRE lo decide la base de
 * datos dentro de `app_submit_pick`: después de `locks_at` la respuesta es 409,
 * da igual lo que muestre el frontend o qué hora tenga el navegador.
 *
 * Las LECTURAS (torneos, preguntas, mis respuestas, ranking) no pasan por aquí:
 * van directas a Supabase protegidas por RLS, que ya es el patrón del proyecto.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/server/services/session";
import { submitPick } from "@/server/services/pickems";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  let body: { questionId?: unknown; option?: unknown } = {};
  try { body = await req.json(); } catch { /* cuerpo vacío */ }

  const questionId = typeof body.questionId === "string" ? body.questionId : "";
  const option = typeof body.option === "string" ? body.option.trim() : "";

  if (!UUID_RE.test(questionId)) {
    return NextResponse.json({ error: "Pregunta inválida" }, { status: 400 });
  }
  if (!option || option.length > 64) {
    return NextResponse.json({ error: "Opción inválida" }, { status: 400 });
  }

  try {
    const result = await submitPick(session.admin, session.userId, questionId, option);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.data, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error al guardar la predicción" },
      { status: 500 },
    );
  }
}
