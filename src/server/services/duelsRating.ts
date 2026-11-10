/**
 * SERVICIO DE RATING PvP (Bloque 7.4.1).
 *
 * Es la ÚNICA puerta de servidor al rating de duelos. Nada fuera de este fichero toca
 * `duel_pvp_ratings` ni `duel_pvp_rating_events`; el resto del servidor pide aquí.
 *
 * ─────────────────────────── DÓNDE ESTÁ LA AUTORIDAD ───────────────────────────
 *
 * No está en este fichero, y eso es lo importante — igual que en el 7.4.
 *
 * El rating se calcula y se escribe dentro de `duel_pvp_settle_match`, una función de PostgreSQL,
 * porque liquidar es «leer dos ratings + escribir dos filas de libro + actualizar dos ratings» de
 * forma INDIVISIBLE. El cliente de Supabase no sabe abrir transacciones de varias sentencias, así
 * que calcular aquí obligaría a un ciclo leer-calcular-escribir con reintentos: más piezas para
 * el mismo resultado, y una ventana en la que dos liquidaciones simultáneas pueden pisarse.
 *
 * Este fichero, por tanto, LEE y ORDENA. No decide un delta.
 *
 * ─────────────────────────── EL RATING NO SE MUEVE AQUÍ ───────────────────────────
 *
 * `settleMatch` existe, es atómica y es idempotente, pero **NADIE la llama todavía**. Ni al crear
 * una partida, ni al entrar en cola, ni al cancelarla, ni al terminar un duelo. Engancharla al
 * final del duelo es del bloque de resolución competitiva, no de este.
 *
 * Lo que este bloque entrega es RATING STORAGE READY. Lo que deja pendiente es RATING SETTLEMENT
 * WIRING. La diferencia está en que la función ya está escrita y verificada, no en que falte.
 *
 * ─────────────────────────── IDENTIDAD ───────────────────────────
 *
 * Ninguna función de aquí acepta un `userId` que venga del cuerpo de una petición. Las que sirven
 * a un usuario reciben el id que `getSession(req)` sacó del Bearer; las internas
 * (`settleMatch`) reciben un `matchId` y derivan los dos jugadores de la fila de la partida.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  INITIAL_RATING, isProvisional,
  type DuelRating, type RatingEvent, type SettleCode,
} from "@/domain/cardgame/rating";
import type { PvpResult } from "./duelsPvp";
// F84 · el movimiento de RANGO de una partida se deriva del asiento (rating viejo/nuevo + número de partida de temporada).
import { rankMovement, type RankMovement } from "@/domain/ranked/standing";

const fail = (status: number, error: string, code?: string): PvpResult<never> =>
  ({ ok: false, status, error, code });
const done = <T>(data: T): PvpResult<T> => ({ ok: true, status: 200, data });

async function rpc<T>(sb: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

interface RatingRow {
  user_id: string;
  rating: number;
  games_played: number;
  wins: number;
  losses: number;
  draws: number;
  updated_at: string;
}

/** Fila → modelo. Único sitio que conoce los nombres de columna del rating. */
function toRating(row: RatingRow): DuelRating {
  return {
    rating: row.rating,
    gamesPlayed: row.games_played,
    wins: row.wins,
    losses: row.losses,
    draws: row.draws,
    provisional: isProvisional(row.games_played),
    updatedAt: Date.parse(row.updated_at) || 0,
  };
}

/**
 * Rating de UN jugador, creándolo si es su primera vez.
 *
 * `duel_pvp_ensure_rating` es idempotente por clave primaria: dos llamadas simultáneas del mismo
 * usuario no pueden crear dos ratings, y no porque se compruebe antes de insertar —eso tiene
 * carrera— sino porque la segunda inserción choca contra la clave.
 *
 * El valor inicial lo pone el DEFAULT de la columna. Esta función no tiene ningún parámetro por
 * el que un rating pudiera entrar desde fuera, que es lo que hace imposible «nacer con 9999».
 */
export async function ensureRating(sb: SupabaseClient, userId: string): Promise<DuelRating> {
  const row = await rpc<RatingRow>(sb, "duel_pvp_ensure_rating", { p_user: userId });
  return toRating(row);
}

/**
 * Rating para MOSTRAR a su dueño. `userId` viene del Bearer; esta función no lo valida porque no
 * puede: quien la llama es el único que sabe de dónde salió, y el contrato es que salga del token.
 */
export async function getRating(
  sb: SupabaseClient, userId: string,
): Promise<PvpResult<DuelRating>> {
  try {
    return done(await ensureRating(sb, userId));
  } catch (e) {
    return fail(500, e instanceof Error ? e.message : "No se pudo leer el rating");
  }
}

/**
 * Historial de movimientos de un jugador, del más reciente al más antiguo.
 *
 * Existe para poder responder «¿de dónde sale mi 1137?» sin reconstruir nada: con `oldRating`,
 * `opponentRating`, `kFactor` y `result` el delta se recalcula exactamente.
 */
export async function getRatingHistory(
  sb: SupabaseClient, userId: string, limit = 20,
): Promise<PvpResult<RatingEvent[]>> {
  const { data, error } = await sb.from("duel_pvp_rating_events")
    .select("match_id, old_rating, delta, new_rating, opponent_rating, k_factor, result, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100));
  if (error) return fail(500, error.message);

  return done((data ?? []).map((r) => {
    const row = r as {
      match_id: string; old_rating: number; delta: number; new_rating: number;
      opponent_rating: number; k_factor: number; result: string; created_at: string;
    };
    return {
      matchId: row.match_id,
      oldRating: row.old_rating,
      delta: row.delta,
      newRating: row.new_rating,
      opponentRating: row.opponent_rating,
      kFactor: row.k_factor,
      result: row.result as RatingEvent["result"],
      createdAt: Date.parse(row.created_at) || 0,
    };
  }));
}

/**
 * Lo que una partida le hizo al rating de QUIEN PREGUNTA (Bloque 7.5).
 *
 * La pantalla de resultado necesita enseñar «1000 → 1020». Ese dato existe en
 * `duel_pvp_rating_events` y es server-authoritative: `oldRating`, `delta` y `newRating` los
 * escribió la liquidación. **El cliente no calcula el delta**; lo pide.
 *
 * Solo se devuelve el movimiento DEL SOLICITANTE. El del rival no sale de aquí: saber cuánto ha
 * subido o bajado la otra persona no hace falta para jugar y es información suya.
 *
 * `null` cuando la partida todavía no se ha liquidado — que es lo normal durante la partida y
 * durante los milisegundos que hay entre el cierre y la liquidación.
 */
/** Campos del asiento de rating que fijan el movimiento de rango (los escribió la liquidación; aquí solo se leen). */
interface RankEventFacts {
  old_rating: number; new_rating: number;
  competitive_season_id?: string | null; season_match_number?: number | null; rule?: string | null;
}

/**
 * F84 · RANGO ANTES → DESPUÉS, del ASIENTO (no de la ficha actual): dos pestañas, una recarga o un F5 una hora después
 * calculan exactamente lo mismo. La temporada del asiento fija la versión de fronteras y las partidas de colocación.
 * SOLO LECTURA: no toca el rating ni la liquidación; usa la misma función pura (`rankMovement`) para todos los llamadores.
 */
async function rankMovementOfEvent(sb: SupabaseClient, r: RankEventFacts): Promise<RankMovement> {
  let season: { placementGames: number; rankConfigVersion: string } | null = null;
  if (r.competitive_season_id) {
    const s = await sb.from("competitive_seasons").select("placement_games, rank_config_version").eq("id", r.competitive_season_id).maybeSingle();
    const row = s.data as { placement_games: number; rank_config_version: string } | null;
    if (row) season = { placementGames: row.placement_games, rankConfigVersion: row.rank_config_version };
  }
  return rankMovement({ oldRating: r.old_rating, newRating: r.new_rating, seasonMatchNumber: r.season_match_number ?? null, rule: r.rule ?? null }, season);
}

/**
 * RESULTADO ÚNICO · el movimiento de rango de la ÚLTIMA partida clasificatoria liquidada de este usuario, para que el
 * centro Competitivo enseñe la ceremonia que ya no está en el resultado del duelo. Lectura pura del último asiento de
 * `duel_pvp_rating_events` (los asientos solo existen para partidas clasificatorias). `null` si no hay ninguno.
 */
export async function getLatestRankMovement(
  sb: SupabaseClient, userId: string,
): Promise<{ matchId: string; at: number; movement: RankMovement } | null> {
  const { data, error } = await sb.from("duel_pvp_rating_events")
    .select("match_id, old_rating, new_rating, created_at, competitive_season_id, season_match_number, rule")
    .eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  const r = data as (RankEventFacts & { match_id: string; created_at: string }) | null;
  if (!r) return null;
  return { matchId: r.match_id, at: Date.parse(r.created_at) || 0, movement: await rankMovementOfEvent(sb, r) };
}

export async function getMatchRatingOutcome(
  sb: SupabaseClient, userId: string, matchId: string,
): Promise<PvpResult<{ outcome: RatingEvent | null; rating: number; rank: RankMovement | null }>> {
  // Pertenencia PRIMERO: quien no juega esta partida no averigua nada de ella, ni siquiera que
  // existe. Mismo criterio que el resto del PvP: 404, nunca 403.
  const { data, error } = await sb.from("duel_matches")
    .select("id, mode, user_id, player_b_id").eq("id", matchId).maybeSingle();
  if (error) return fail(500, error.message);
  const row = data as { mode: string; user_id: string; player_b_id: string | null } | null;
  if (!row || row.mode !== "PVP") return fail(404, "Partida no encontrada", "NOT_PVP");
  if (userId !== row.user_id && userId !== row.player_b_id) {
    return fail(404, "Partida no encontrada", "NOT_A_PLAYER");
  }

  const ev = await sb.from("duel_pvp_rating_events")
    .select("match_id, old_rating, delta, new_rating, opponent_rating, k_factor, result, created_at, competitive_season_id, season_match_number, rule")
    .eq("match_id", matchId).eq("user_id", userId).maybeSingle();
  if (ev.error) return fail(500, ev.error.message);

  const rating = (await ensureRating(sb, userId)).rating;
  if (!ev.data) return done({ outcome: null, rating, rank: null });

  const r = ev.data as {
    match_id: string; old_rating: number; delta: number; new_rating: number;
    opponent_rating: number; k_factor: number; result: string; created_at: string;
    competitive_season_id?: string | null; season_match_number?: number | null; rule?: string | null;
  };
  const rank = await rankMovementOfEvent(sb, r);
  return done({
    rank,
    outcome: {
      matchId: r.match_id, oldRating: r.old_rating, delta: r.delta, newRating: r.new_rating,
      opponentRating: r.opponent_rating, kFactor: r.k_factor,
      result: r.result as RatingEvent["result"], createdAt: Date.parse(r.created_at) || 0,
    },
    rating,
  });
}

export interface SettleOutcome {
  code: SettleCode;
  matchId?: string;
  a?: { userId: string; oldRating: number; delta: number; newRating: number; kFactor: number; result: string };
  b?: { userId: string; oldRating: number; delta: number; newRating: number; kFactor: number; result: string };
}

/**
 * LIQUIDA una partida PvP terminada. **Operación interna: hoy no la invoca ningún camino.**
 *
 * Lo único que recibe es un `matchId`. El ganador NO se pasa: se lee del resultado autoritativo
 * que el orquestador ya escribió en `duel_matches` (`status` + `winner`). No existe ningún
 * parámetro por el que un cliente pudiera declarar quién ganó, cuánto se mueve o contra quién.
 *
 * IDEMPOTENTE: `settleMatch(m)` dos veces produce EXACTAMENTE un movimiento por jugador. Lo
 * impone el índice único `(match_id, user_id)` del libro, no una comprobación previa.
 *
 * NO liquida partidas abandonadas (devuelve `ABANDONED_NOT_SETTLED`): el abandono es la deuda
 * D-PVP-7 y decidir su política —¿derrota completa?, ¿penalización?— es decidir el juego.
 */
export async function settleMatch(
  sb: SupabaseClient, matchId: string,
): Promise<PvpResult<SettleOutcome>> {
  try {
    const raw = await rpc<SettleOutcome>(sb, "duel_pvp_settle_match", { p_match: matchId });
    return done(raw);
  } catch (e) {
    return fail(500, e instanceof Error ? e.message : "No se pudo liquidar la partida");
  }
}

export { INITIAL_RATING };
export type { DuelRating, RatingEvent };
