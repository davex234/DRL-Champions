/**
 * `/api/game/match-strats` — QUÉ JUGADAS SE LLEVAN A UNA PARTIDA (Fase 47).
 *
 *   GET  ?matchId=<uuid>                     → las jugadas asignadas, en orden
 *   POST { action: "assign",   matchId, stratId }
 *   POST { action: "unassign", matchId, stratId }
 *   POST { action: "reorder",  matchId, stratIds[] }
 *
 * ────────────────────────── LA VALIDACIÓN QUE DA SENTIDO A ESTA RUTA ──────────────────────────
 *
 * **Una jugada de Ascent no puede asignarse a una partida que se juega en Bind.** Las coordenadas
 * de una jugada están normalizadas SOBRE SU MAPA: llevarlas a otro no las deja «un poco mal», las
 * deja sin significado —cinco fichas en sitios arbitrarios—. Por eso el mapa se comprueba aquí, en
 * el servidor, comparando el de la jugada con el de la partida, y no se confía en que el cliente
 * sólo haya ofrecido las correctas.
 *
 * El mapa NO se guarda en la fila de asignación: se deduce. Guardarlo por duplicado es invitar a
 * que un día la copia y el original no coincidan.
 *
 * ────────────────────────── AUTORIDAD ──────────────────────────
 *
 * Usuario del Bearer, siempre. La partida y la jugada tienen que ser las dos del mismo usuario; si
 * alguna no lo es, **404**, nunca 403.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/server/services/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status, headers: NO_STORE });

/** Tope por partida: una preparación con más de esto no se presenta, se lee. */
const MAX_PER_MATCH = 20;

export async function GET(req: Request) {
  const session = await getSession(req);
  if (!session) return bad("No autenticado", 401);

  const matchId = new URL(req.url).searchParams.get("matchId") ?? "";
  if (!UUID.test(matchId)) return bad("Identificador de partida no válido");

  const { data, error } = await session.admin
    .from("coach_match_strats")
    .select("id, strat_id, sort_order, user_strats(id, name, map_id, side, composition_id, updated_at)")
    .eq("user_id", session.userId)
    .eq("match_id", matchId)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("[match-strats]", error.message);
    return bad("No se pudo cargar el plan táctico", 500);
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const assigned = (data ?? []).map((r: any) => ({
    id: r.id,
    stratId: r.strat_id,
    sortOrder: r.sort_order,
    name: r.user_strats?.name ?? "",
    mapId: r.user_strats?.map_id ?? "",
    side: r.user_strats?.side ?? "",
    compositionId: r.user_strats?.composition_id ?? null,
  }));
  return NextResponse.json({ assigned }, { headers: NO_STORE });
}

export async function POST(req: Request) {
  const session = await getSession(req);
  if (!session) return bad("No autenticado", 401);

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
  const matchId = typeof body.matchId === "string" ? body.matchId : "";
  if (!UUID.test(matchId)) return bad("Identificador de partida no válido");

  const { admin, userId } = session;

  // La partida tiene que ser tuya. 404 si no lo es: no se confirma que exista.
  const { data: partido } = await admin
    .from("coach_matches").select("id, map_id").eq("id", matchId).eq("user_id", userId).maybeSingle();
  if (!partido) return bad("Partida no encontrada", 404);
  const mapaPartida = (partido as { map_id: string | null }).map_id;

  /* ── ASIGNAR ───────────────────────────────────────────────────────────── */
  if (action === "assign") {
    const stratId = typeof body.stratId === "string" ? body.stratId : "";
    if (!UUID.test(stratId)) return bad("Identificador de jugada no válido");

    const { data: jugada } = await admin
      .from("user_strats").select("id, map_id, name").eq("id", stratId).eq("user_id", userId).maybeSingle();
    if (!jugada) return bad("Jugada no encontrada", 404);

    const mapaJugada = (jugada as { map_id: string }).map_id;
    /*
     * LA COMPROBACIÓN QUE IMPORTA. Si la partida ya tiene mapa y no es el de la jugada, se rechaza:
     * las coordenadas no significarían nada. Si la partida NO tiene mapa todavía, se deja asignar
     * (el entrenador prepara antes de saber el veto) y la comprobación se hará al fijar el mapa.
     */
    if (mapaPartida && mapaPartida !== mapaJugada) {
      return bad(`Esa jugada es de otro mapa (${mapaJugada}) y la partida se juega en ${mapaPartida}.`, 409);
    }

    const { count } = await admin
      .from("coach_match_strats").select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("match_id", matchId);
    if ((count ?? 0) >= MAX_PER_MATCH) return bad(`No puedes asignar más de ${MAX_PER_MATCH} jugadas a una partida.`);

    // FULL GAME AUDIT · orden = el siguiente al MAYOR existente (con el recuento, quitar una y añadir otra repetía orden).
    const { data: ultima } = await admin
      .from("coach_match_strats").select("sort_order").eq("user_id", userId).eq("match_id", matchId)
      .order("sort_order", { ascending: false }).limit(1).maybeSingle();
    const siguiente = ultima ? Number((ultima as { sort_order: number }).sort_order) + 1 : 0;
    const { error } = await admin.from("coach_match_strats").insert({
      user_id: userId, match_id: matchId, strat_id: stratId, sort_order: siguiente,
    });
    // Asignar dos veces la misma jugada no es un error del entrenador: ya está donde quería.
    if (error && !/duplicate|unique/i.test(error.message)) {
      console.error("[match-strats]", error.message);
      return bad("No se pudo asignar la jugada", 500);
    }
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  }

  /* ── QUITAR ────────────────────────────────────────────────────────────── */
  if (action === "unassign") {
    const stratId = typeof body.stratId === "string" ? body.stratId : "";
    if (!UUID.test(stratId)) return bad("Identificador de jugada no válido");
    const { error } = await admin
      .from("coach_match_strats").delete()
      .eq("user_id", userId).eq("match_id", matchId).eq("strat_id", stratId);
    if (error) { console.error("[match-strats]", error.message); return bad("No se pudo quitar la jugada", 500); }
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  }

  /* ── REORDENAR ─────────────────────────────────────────────────────────── */
  if (action === "reorder") {
    const ids = Array.isArray(body.stratIds) ? body.stratIds : [];
    if (ids.length > MAX_PER_MATCH) return bad("Demasiadas jugadas");
    for (const [i, raw] of ids.entries()) {
      if (typeof raw !== "string" || !UUID.test(raw)) return bad("Identificador de jugada no válido");
      await admin.from("coach_match_strats").update({ sort_order: i })
        .eq("user_id", userId).eq("match_id", matchId).eq("strat_id", raw);
    }
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  }

  return bad("Acción inválida");
}
