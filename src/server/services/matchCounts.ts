/**
 * CORE GAME LOOP (2026-10-07) · «PARTIDAS QUE CUENTAN» — una sola definición para las misiones del pase, los desafíos
 * de evento, el vestíbulo y el recorrido del jugador.
 *
 * Antes cada lectura contaba `duel_matches` por `user_id` y solo excluía DRAFT_GAUNTLET. En PvP `user_id` es el
 * jugador A, así que:
 *   · un duelo PRIVADO o de TORNEO (`PVP_PRIVATE`) contaba para el asiento A («Gana 3 duelos», «Domina el evento»…),
 *     aunque el producto dice que una partida privada no da progreso (ni rating, ni misiones F73, ni XP de temporada);
 *   · el jugador B de una partida RANKED nunca progresaba.
 *
 * Ahora cuentan: PvE (rápida y campaña, `mode = PVE`, el humano es siempre A) y RANKED (`mode = PVP`) para LOS DOS
 * asientos, con la victoria del asiento propio. No cuentan: privadas y torneos (`PVP_PRIVATE`) ni el Draft
 * (`DRAFT_GAUNTLET`, que tiene su propia tabla de premios). Es el mismo criterio que el motor F73 y la temporada F83.
 *
 * Dos recuentos `head: true` por métrica (un asiento por columna; sin `or`, que el doble de pruebas no filtra), en paralelo.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Estados finales del orquestador: un empate o un desenlace sin resolver cuentan como partida jugada. */
export const FINISHED_MATCH_STATUSES = ["COMPLETED", "DRAW", "UNRESOLVED"] as const;

/** Modos cuyas partidas dan progreso de misiones y eventos. */
export const PROGRESS_MATCH_MODES = ["PVE", "PVP"] as const;

export interface MatchCountWindow {
  /** Columna de tiempo del servidor que acota la ventana (`updated_at` = cuándo terminó; `created_at` = cuándo empezó). */
  column: "updated_at" | "created_at";
  from?: string;
  to?: string;
}

type DbError = { message?: string; code?: string; hint?: string | null };
export interface MatchCount { count: number | null; error: DbError | null }

interface Seat { column: "user_id" | "player_b_id"; modes: readonly string[]; side: "A" | "B" }
/** El humano de PvE y el jugador A de ranked van en `user_id`; el jugador B de ranked, en `player_b_id`. */
const SEATS: readonly Seat[] = [
  { column: "user_id", modes: PROGRESS_MATCH_MODES, side: "A" },
  { column: "player_b_id", modes: ["PVP"], side: "B" },
];

async function countSeats(
  sb: SupabaseClient, userId: string, kind: "played" | "won", win: MatchCountWindow | null,
): Promise<MatchCount> {
  const parts = await Promise.all(SEATS.map((seat) => {
    let q = sb.from("duel_matches").select("id", { count: "exact", head: true })
      .eq(seat.column, userId).in("mode", [...seat.modes]);
    q = kind === "played" ? q.in("status", [...FINISHED_MATCH_STATUSES]) : q.eq("winner", seat.side);
    if (win?.from) q = q.gte(win.column, win.from);
    if (win?.to) q = q.lte(win.column, win.to);
    return q as unknown as PromiseLike<MatchCount>;
  }));
  const failed = parts.find((p) => p.error);
  if (failed) return { count: null, error: failed.error };
  return { count: parts.reduce((s, p) => s + (p.count ?? 0), 0), error: null };
}

/** Partidas terminadas que cuentan para progreso (opcionalmente dentro de una ventana). */
export function countPlayedMatches(sb: SupabaseClient, userId: string, win: MatchCountWindow | null = null): Promise<MatchCount> {
  return countSeats(sb, userId, "played", win);
}

/** Victorias que cuentan para progreso: las del asiento propio (opcionalmente dentro de una ventana). */
export function countWonMatches(sb: SupabaseClient, userId: string, win: MatchCountWindow | null = null): Promise<MatchCount> {
  return countSeats(sb, userId, "won", win);
}
