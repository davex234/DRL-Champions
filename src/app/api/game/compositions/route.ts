/**
 * `/api/game/compositions` — COMPOSICIONES TÁCTICAS POR MAPA (Fase 47).
 *
 *   GET                                        → todas las composiciones del entrenador
 *   POST { action: "save",   composition }     → crear o actualizar
 *   POST { action: "delete", id }              → borrar
 *   POST { action: "primary", id }             → marcarla como principal de su mapa
 *
 * ────────────────────────── AUTORIDAD ──────────────────────────
 *
 * El usuario sale SIEMPRE de `getSession(req)`, es decir del Bearer. No se lee ningún `userId` del
 * cuerpo ni de la query: ese es exactamente el vector que permitiría escribir en nombre de otro.
 * Una composición que existe pero no es tuya responde **404, no 403**: un 403 confirmaría que ese
 * identificador existe.
 *
 * ────────────────────────── QUÉ SE VALIDA AQUÍ, Y POR QUÉ ──────────────────────────
 *
 * Todo lo que el cliente podría mentir: que el mapa exista, que los agentes existan, que no haya
 * repetidos y que no se pase del tope por mapa. Esconder un botón no es validar; el dominio puro
 * (`validateComposition`) es la única definición de «qué es legal» y la usan servidor y cliente.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/server/services/session";
import { ensureServerAgents } from "@/server/cms/agents";
import {
  sanitizeComposition, validateComposition, validateCompositionPayload, MAX_COMPOSITIONS_PER_MAP, type Composition,
} from "@/domain/tactics/composition";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status, headers: NO_STORE });

interface Row {
  id: string; map_id: string; name: string; agent_ids: string[] | null;
  notes: string | null; primary_comp: boolean; updated_at: string;
}

const toDto = (r: Row): Composition => ({
  id: r.id,
  mapId: r.map_id,
  name: r.name,
  agentIds: r.agent_ids ?? [],
  notes: r.notes ?? "",
  primary: r.primary_comp,
  updatedAt: r.updated_at,
});

export async function GET(req: Request) {
  const session = await getSession(req);
  if (!session) return bad("No autenticado", 401);
  await ensureServerAgents(session.admin); // F60: el roster sale de public.agents (panel), no sólo de la instantánea

  const { data, error } = await session.admin
    .from("user_compositions")
    .select("id, map_id, name, agent_ids, notes, primary_comp, updated_at")
    .eq("user_id", session.userId)
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("[compositions]", error.message);
    return bad("No se pudieron cargar las composiciones", 500);
  }
  return NextResponse.json({ compositions: (data ?? []).map((r) => toDto(r as Row)) }, { headers: NO_STORE });
}

export async function POST(req: Request) {
  const session = await getSession(req);
  if (!session) return bad("No autenticado", 401);
  await ensureServerAgents(session.admin); // F60: el roster sale de public.agents (panel), no sólo de la instantánea

  let body: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (raw.length > 8_000) return bad("Cuerpo demasiado grande");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return bad("Cuerpo no válido");
    body = parsed as Record<string, unknown>;
  } catch {
    return bad("Cuerpo no válido");
  }

  const action = typeof body.action === "string" ? body.action : "";
  const { admin, userId } = session;

  /* ── GUARDAR ───────────────────────────────────────────────────────────── */
  if (action === "save") {
    /*
     * FASE 51 · se valida el CUERPO CRUDO antes de limpiarlo: limpiar primero hacía desaparecer en
     * silencio los agentes inventados y dejaba pasar los del modelo anterior (ver
     * `validateCompositionPayload`). Solo se guarda lo que el roster activo ofrece.
     */
    const crudo = body.composition ?? {};
    const rechazos = validateCompositionPayload(crudo);
    if (rechazos.length > 0) return NextResponse.json({ error: rechazos[0].message, issues: rechazos }, { status: 400, headers: NO_STORE });

    const entrada = crudo as Partial<Composition> & { id?: string };
    const limpia = sanitizeComposition(entrada);

    const problemas = validateComposition(limpia);
    if (problemas.length > 0) return NextResponse.json({ error: problemas[0].message, issues: problemas }, { status: 400, headers: NO_STORE });

    const id = typeof entrada.id === "string" && UUID.test(entrada.id) ? entrada.id : null;

    // Tope POR MAPA, contado en el servidor y sólo al crear.
    if (!id) {
      const { count } = await admin
        .from("user_compositions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("map_id", limpia.mapId);
      if ((count ?? 0) >= MAX_COMPOSITIONS_PER_MAP) {
        return bad(`No puedes tener más de ${MAX_COMPOSITIONS_PER_MAP} composiciones en este mapa.`);
      }
    }

    /*
     * FULL GAME AUDIT (2026-10-07) · al EDITAR también se respeta el tope por mapa si la composición CAMBIA de mapa (antes
     * solo se contaba al crear: mover una a un mapa lleno lo dejaba en 13), y una composición PRINCIPAL que se muda deja
     * de serlo (antes chocaba con la principal del mapa de destino — índice único — y respondía 500).
     */
    let moving = false;
    if (id) {
      const { data: prev } = await admin.from("user_compositions").select("map_id").eq("id", id).eq("user_id", userId).maybeSingle();
      if (!prev) return bad("Composición no encontrada", 404);
      moving = (prev as { map_id: string }).map_id !== limpia.mapId;
      if (moving) {
        const { count } = await admin
          .from("user_compositions")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("map_id", limpia.mapId);
        if ((count ?? 0) >= MAX_COMPOSITIONS_PER_MAP) {
          return bad(`No puedes tener más de ${MAX_COMPOSITIONS_PER_MAP} composiciones en este mapa.`);
        }
      }
    }

    const fila = {
      user_id: userId,
      map_id: limpia.mapId,
      name: limpia.name,
      agent_ids: limpia.agentIds,
      notes: limpia.notes,
      updated_at: new Date().toISOString(),
    };

    if (id) {
      /*
       * `eq("user_id")` en el UPDATE no es redundante con RLS: es la segunda red. Sin él, un fallo
       * de política dejaría editar la composición de otro. Y devuelve 404 —no 403— si no es tuya.
       */
      const { data, error } = await admin
        .from("user_compositions").update(moving ? { ...fila, primary_comp: false } : fila)
        .eq("id", id).eq("user_id", userId)
        .select("id, map_id, name, agent_ids, notes, primary_comp, updated_at").maybeSingle();
      if (error?.code === "23505") return bad("Ese cambio choca con otra composición de ese mapa. Recarga e inténtalo de nuevo.", 409);
      if (error) { console.error("[compositions]", error.message); return bad("No se pudo guardar", 500); }
      if (!data) return bad("Composición no encontrada", 404);
      return NextResponse.json({ composition: toDto(data as Row) }, { headers: NO_STORE });
    }

    const { data, error } = await admin
      .from("user_compositions").insert(fila)
      .select("id, map_id, name, agent_ids, notes, primary_comp, updated_at").single();
    if (error) { console.error("[compositions]", error.message); return bad("No se pudo crear", 500); }
    return NextResponse.json({ composition: toDto(data as Row) }, { headers: NO_STORE });
  }

  /* ── BORRAR ────────────────────────────────────────────────────────────── */
  if (action === "delete") {
    const id = typeof body.id === "string" ? body.id : "";
    if (!UUID.test(id)) return bad("Identificador no válido");
    const { data, error } = await admin
      .from("user_compositions").delete().eq("id", id).eq("user_id", userId).select("id").maybeSingle();
    if (error) { console.error("[compositions]", error.message); return bad("No se pudo borrar", 500); }
    if (!data) return bad("Composición no encontrada", 404);
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  }

  /* ── PRINCIPAL ─────────────────────────────────────────────────────────── */
  if (action === "primary") {
    const id = typeof body.id === "string" ? body.id : "";
    if (!UUID.test(id)) return bad("Identificador no válido");

    const { data: comp } = await admin
      .from("user_compositions").select("id, map_id").eq("id", id).eq("user_id", userId).maybeSingle();
    if (!comp) return bad("Composición no encontrada", 404);

    /*
     * Se apaga la anterior ANTES de encender la nueva. El índice único parcial de la migración
     * rechazaría dos principales en el mismo mapa, así que el orden no es cosmético: al revés
     * fallaría siempre.
     */
    await admin.from("user_compositions").update({ primary_comp: false })
      .eq("user_id", userId).eq("map_id", (comp as { map_id: string }).map_id).eq("primary_comp", true);

    const { data, error } = await admin
      .from("user_compositions").update({ primary_comp: true })
      .eq("id", id).eq("user_id", userId)
      .select("id, map_id, name, agent_ids, notes, primary_comp, updated_at").maybeSingle();
    if (error) { console.error("[compositions]", error.message); return bad("No se pudo marcar como principal", 500); }
    if (!data) return bad("Composición no encontrada", 404);
    return NextResponse.json({ composition: toDto(data as Row) }, { headers: NO_STORE });
  }

  return bad("Acción inválida");
}
