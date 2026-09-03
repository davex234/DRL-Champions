/**
 * `/api/game/strats` — LAS ESTRATEGIAS DEL ENTRENADOR (Fase 9I).
 *
 *   GET                              → mis estrategias
 *   POST { action: "save",   strat }  → crear o actualizar
 *   POST { action: "delete", id }     → borrar
 *
 * POR QUÉ HAY RUTA DE SERVIDOR SI LA TABLA YA DEJA ESCRIBIR AL DUEÑO
 *
 *   Porque RLS filtra FILAS, no CONTENIDO. Las políticas de `user_strats` garantizan que
 *   nadie toca las estrategias de otro, pero no que el `plan` sea un plan: por PostgREST
 *   se podría guardar un jsonb de diez megas, con doscientos marcadores y coordenadas de
 *   un millón, y la pizarra se rompería al abrirlo.
 *
 *   Esta ruta pasa TODO por `sanitizeStrat` —la misma función que usa el editor— antes de
 *   escribir. Lo que llega a la base de datos es lo que el dominio aprueba, no lo que
 *   manda el navegador. El `user_id` sale del token, nunca del cuerpo.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/server/services/session";
import { sanitizeStrat, validateStrat, type Strat } from "@/domain/tactics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Mismo tope que el trigger de la migración. Aquí se responde con un mensaje legible. */
const MAX_STRATS = 40;

interface StratRow {
  id: string;
  name: string;
  map_id: string;
  side: string;
  plan: Strat;
  updated_at: string;
}

export async function GET(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data, error } = await session.admin
    .from("user_strats")
    .select("id, name, map_id, side, plan, updated_at")
    .eq("user_id", session.userId)
    .order("updated_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE });

  /*
   * El plan se vuelve a sanear AL SALIR, no solo al entrar. Una fila guardada antes de
   * una migración del formato podría no cumplir el modelo actual, y es mejor devolverla
   * normalizada que dejar que reviente en la pizarra.
   */
  const strats = ((data ?? []) as StratRow[]).map((r) => ({
    id: r.id,
    name: r.name,
    mapId: r.map_id,
    side: r.side,
    updatedAt: r.updated_at,
    plan: sanitizeStrat(r.plan, r.id),
  })).filter((s) => s.plan !== null);

  return NextResponse.json({ strats }, { headers: NO_STORE });
}

export async function POST(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* cuerpo vacío */ }

  const action = typeof body.action === "string" ? body.action : "";

  try {
    if (action === "save") {
      const id = typeof body.id === "string" && UUID.test(body.id) ? body.id : null;

      // La frontera: lo que llega se reconstruye campo a campo antes de mirarlo siquiera.
      const strat = sanitizeStrat(body.strat, id ?? "nueva");
      if (!strat) {
        return NextResponse.json({ error: "La estrategia no es válida" }, { status: 400, headers: NO_STORE });
      }

      const check = validateStrat(strat);
      if (!check.ok) {
        return NextResponse.json(
          { error: check.issues[0].message, issues: check.issues },
          { status: 409, headers: NO_STORE },
        );
      }

      if (id) {
        // `eq(user_id)` además de la política: defensa en profundidad, cuesta cero.
        const { data, error } = await session.admin
          .from("user_strats")
          .update({ name: strat.name, map_id: strat.mapId, side: strat.side, plan: strat })
          .eq("id", id).eq("user_id", session.userId)
          .select("id").maybeSingle();
        if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE });
        if (!data) return NextResponse.json({ error: "Esa estrategia no existe" }, { status: 404, headers: NO_STORE });
        return NextResponse.json({ id }, { headers: NO_STORE });
      }

      const { count } = await session.admin
        .from("user_strats").select("id", { count: "exact", head: true })
        .eq("user_id", session.userId);
      if ((count ?? 0) >= MAX_STRATS) {
        return NextResponse.json(
          { error: `Solo puedes guardar ${MAX_STRATS} estrategias. Borra alguna primero.` },
          { status: 409, headers: NO_STORE },
        );
      }

      const { data, error } = await session.admin
        .from("user_strats")
        .insert({
          user_id: session.userId,
          name: strat.name, map_id: strat.mapId, side: strat.side, plan: strat,
        })
        .select("id").maybeSingle();
      if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE });
      return NextResponse.json({ id: (data as { id: string }).id }, { headers: NO_STORE });
    }

    if (action === "delete") {
      const id = typeof body.id === "string" && UUID.test(body.id) ? body.id : "";
      if (!id) return NextResponse.json({ error: "Identificador no válido" }, { status: 400, headers: NO_STORE });
      const { error } = await session.admin
        .from("user_strats").delete().eq("id", id).eq("user_id", session.userId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE });
      return NextResponse.json({ ok: true }, { headers: NO_STORE });
    }

    return NextResponse.json({ error: "Acción no reconocida" }, { status: 400, headers: NO_STORE });
  } catch (e) {
    console.error("[strats]", e);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500, headers: NO_STORE });
  }
}
