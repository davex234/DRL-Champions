/**
 * `/api/game/strats` — LAS ESTRATEGIAS DEL ENTRENADOR (Fase 9I).
 *
 *   GET                                  → mis estrategias
 *   POST { action: "save",      strat, id?, baseVersion? }   → crear o actualizar
 *        `baseVersion` es la `updatedAt` que leyó el editor. Si la fila ya no está en esa
 *        versión responde **409 VERSION_CONFLICT** en vez de pisar el trabajo de otra pestaña.
 *   POST { action: "duplicate", id }      → copiar una como estrategia nueva
 *   POST { action: "delete",    id }      → borrar
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
import { ensureServerAgents } from "@/server/cms/agents";
import {
  sanitizeStrat, validateStrat, cloneStrat, MAX_PLAN_BYTES, type Strat,
} from "@/domain/tactics";
import { internalError } from "@/server/ops/log";
import { readJsonObject } from "@/server/http/jsonBody";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Mismo tope que el trigger de la migración. Aquí se responde con un mensaje legible. */
const MAX_STRATS = 40;

/**
 * Tamaño máximo del plan ya saneado.
 *
 * `sanitizeStrat` acota pasos, objetos y vértices uno a uno, pero el producto de todos los
 * topes sigue siendo un jsonb grande. Esto es el techo del conjunto, medido sobre lo que
 * REALMENTE se va a escribir —no sobre lo que mandó el cliente—, para que una estrategia
 * legítima no se rechace por venir con basura que el saneado ya tiró.
 */
function planTooBig(strat: Strat): boolean {
  return Buffer.byteLength(JSON.stringify(strat), "utf8") > MAX_PLAN_BYTES;
}

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
  await ensureServerAgents(session.admin); // F60: agentes y habilidades del catálogo real

  const { data, error } = await session.admin
    .from("user_strats")
    .select("id, name, map_id, side, plan, updated_at")
    .eq("user_id", session.userId)
    .order("updated_at", { ascending: false });

  if (error) return internalError("api/game/strats", error, req);

  /*
   * El plan se vuelve a sanear AL SALIR, no solo al entrar. Una fila guardada antes de
   * una migración del formato podría no cumplir el modelo actual, y es mejor devolverla
   * normalizada que dejar que reviente en la pizarra.
   */
  const strats = ((data ?? []) as StratRow[]).map((r) => {
    const plan = sanitizeStrat(r.plan, r.id);
    return {
      id: r.id,
      name: r.name,
      mapId: r.map_id,
      side: r.side,
      updatedAt: r.updated_at,
      /* La lista enseña «6 pasos» sin que el cliente tenga que contar el plan. */
      steps: plan?.steps.length ?? 0,
      plan,
    };
  }).filter((s) => s.plan !== null);

  return NextResponse.json({ strats }, { headers: NO_STORE });
}

export async function POST(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  await ensureServerAgents(session.admin); // F60: agentes y habilidades del catálogo real

  let body: Record<string, unknown> = {};
  body = ((await readJsonObject(req)) ?? {}) as typeof body; // FULL GAME AUDIT · `null`/no-objeto ya no da 500

  const action = typeof body.action === "string" ? body.action : "";

  try {
    if (action === "save") {
      const id = typeof body.id === "string" && UUID.test(body.id) ? body.id : null;

      // La frontera: lo que llega se reconstruye campo a campo antes de mirarlo siquiera.
      const strat = sanitizeStrat(body.strat, id ?? "nueva");
      if (!strat) {
        return NextResponse.json({ error: "La estrategia no es válida" }, { status: 400, headers: NO_STORE });
      }

      if (planTooBig(strat)) {
        return NextResponse.json(
          { error: "La estrategia es demasiado grande. Quita algún paso o algún dibujo." },
          { status: 413, headers: NO_STORE },
        );
      }

      const check = validateStrat(strat);
      if (!check.ok) {
        return NextResponse.json(
          { error: check.issues[0].message, issues: check.issues },
          { status: 409, headers: NO_STORE },
        );
      }

      if (id) {
        /*
         * ───────────── CERROJO OPTIMISTA (Fase 47) ─────────────
         *
         * Antes esto era último-en-escribir-gana: dos pestañas con la misma jugada abierta y la
         * segunda en guardar borraba el trabajo de la primera SIN DECIR NADA. Para un entrenador
         * que prepara una partida en dos ventanas eso es perder trabajo de verdad.
         *
         * No hace falta columna nueva: `updated_at` ya existe y el trigger `user_strats_touch` la
         * avanza en cada escritura, así que ES la versión. El cliente manda la que leyó
         * (`baseVersion`) y el UPDATE sólo muerde si la fila sigue en esa versión.
         *
         * `baseVersion` es OPCIONAL a propósito: un cliente antiguo —o un guardado que no viene de
         * un editor abierto— sigue funcionando como antes. Lo que no puede es perder cambios sin
         * enterarse, y para eso basta con que el editor lo mande.
         */
        const baseVersion = typeof body.baseVersion === "string" ? body.baseVersion : null;

        /*
         * FULL GAME AUDIT (2026-10-07) · cambiar el MAPA de una jugada ya asignada a una partida con mapa fijado dejaba una
         * jugada de Bind en una partida de Ascent (la regla solo se comprobaba al asignar). La misma regla, al guardar.
         */
        const { data: asignadas } = await session.admin
          .from("coach_match_strats").select("match_id").eq("strat_id", id).eq("user_id", session.userId);
        const ids = ((asignadas ?? []) as { match_id: string }[]).map((r) => r.match_id);
        if (ids.length > 0) {
          const { data: partidos } = await session.admin
            .from("coach_matches").select("id, map_id").in("id", ids).eq("user_id", session.userId);
          const choque = ((partidos ?? []) as { map_id: string | null }[]).find((m) => m.map_id && m.map_id !== strat.mapId);
          if (choque) {
            return NextResponse.json({
              error: `Esta jugada está en el plan de una partida en ${choque.map_id}: quítala de ese plan antes de cambiarle el mapa.`,
              code: "MAP_LOCKED_BY_MATCH",
            }, { status: 409, headers: NO_STORE });
          }
        }

        let q = session.admin
          .from("user_strats")
          .update({ name: strat.name, map_id: strat.mapId, side: strat.side, plan: strat })
          .eq("id", id).eq("user_id", session.userId);           // defensa en profundidad además de RLS
        if (baseVersion) q = q.eq("updated_at", baseVersion);

        const { data, error } = await q.select("id, updated_at").maybeSingle();
        if (error) return internalError("api/game/strats", error, req);

        if (!data) {
          /*
           * Cero filas puede significar dos cosas distintas y NO se pueden confundir: que la
           * jugada no existe (o no es tuya), o que existe pero alguien la cambió mientras la
           * tenías abierta. Se distingue leyendo la fila; sin esto, un conflicto se reportaría
           * como «no existe» y el entrenador creería que ha perdido la estrategia.
           */
          const { data: actual } = await session.admin
            .from("user_strats").select("id, name, updated_at")
            .eq("id", id).eq("user_id", session.userId).maybeSingle();

          if (!actual) return NextResponse.json({ error: "Esa estrategia no existe" }, { status: 404, headers: NO_STORE });

          const fila = actual as { name: string; updated_at: string };
          return NextResponse.json({
            error: "Esta jugada ha cambiado en otra sesión.",
            code: "VERSION_CONFLICT",
            currentVersion: fila.updated_at,
            currentName: fila.name,
          }, { status: 409, headers: NO_STORE });
        }

        return NextResponse.json({ id, version: (data as { updated_at: string }).updated_at }, { headers: NO_STORE });
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
        .select("id, updated_at").maybeSingle();
      if (error) return internalError("api/game/strats", error, req);
      const creada = data as { id: string; updated_at: string };
      return NextResponse.json({ id: creada.id, version: creada.updated_at }, { headers: NO_STORE });
    }

    if (action === "duplicate") {
      const id = typeof body.id === "string" && UUID.test(body.id) ? body.id : "";
      if (!id) return NextResponse.json({ error: "Identificador no válido" }, { status: 400, headers: NO_STORE });

      /*
       * La copia se hace EN EL SERVIDOR a partir de la fila guardada, no con lo que mande
       * el cliente: así una duplicación no puede colar contenido nuevo por la puerta de
       * atrás, y `eq(user_id)` impide copiar la estrategia de otro aunque se acierte el id.
       */
      const { data: origen, error: e1 } = await session.admin
        .from("user_strats").select("id, name, map_id, side, plan")
        .eq("id", id).eq("user_id", session.userId).maybeSingle();
      if (e1) return internalError("api/game/strats", e1, req);
      if (!origen) return NextResponse.json({ error: "Esa estrategia no existe" }, { status: 404, headers: NO_STORE });

      const base = sanitizeStrat((origen as StratRow).plan, id);
      if (!base) return NextResponse.json({ error: "La estrategia no es válida" }, { status: 409, headers: NO_STORE });

      // Copia PROFUNDA: la original y la copia no comparten ni un objeto.
      const copia = cloneStrat(base);
      copia.name = `${copia.name} (copia)`.slice(0, 60);

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
          name: copia.name, map_id: copia.mapId, side: copia.side, plan: copia,
        })
        .select("id, updated_at").maybeSingle();
      if (error) return internalError("api/game/strats", error, req);
      const creada = data as { id: string; updated_at: string };
      return NextResponse.json({ id: creada.id, version: creada.updated_at }, { headers: NO_STORE });
    }

    if (action === "delete") {
      const id = typeof body.id === "string" && UUID.test(body.id) ? body.id : "";
      if (!id) return NextResponse.json({ error: "Identificador no válido" }, { status: 400, headers: NO_STORE });
      const { data: borrada, error } = await session.admin
        .from("user_strats").delete().eq("id", id).eq("user_id", session.userId).select("id").maybeSingle();
      if (error) return internalError("api/game/strats", error, req);
      // FULL GAME AUDIT · borrar algo que no existe (o no es tuyo) ya no responde «ok»: 404, como las composiciones.
      if (!borrada) return NextResponse.json({ error: "Esa estrategia no existe" }, { status: 404, headers: NO_STORE });
      return NextResponse.json({ ok: true }, { headers: NO_STORE });
    }

    return NextResponse.json({ error: "Acción no reconocida" }, { status: 400, headers: NO_STORE });
  } catch (e) {
    console.error("[strats]", e);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500, headers: NO_STORE });
  }
}
