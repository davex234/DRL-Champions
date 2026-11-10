/**
 * MATCH SUMMARY — lo que un partido del Tactical Coach deja al terminar.
 *
 * FASE 69 · F68-010 — EL COACH ES ENTRENAMIENTO, NO ECONOMÍA. Aquí vivía una «recompensa» de
 * créditos y XP (150/50 por ronda, +10 por baja, +300 al ganar) que se aplicaba con
 * `applyReward` SOLO al store del navegador: el simulador corre en el cliente y el servidor no
 * puede verificar el marcador, así que nunca se abonó. El HUD enseñaba un saldo y un nivel que
 * no existían (9.430 → 12.280, nivel 3 → 6) y `CloudSync` los borraba al sincronizar.
 * Decisión de producto (F69): el Coach no da créditos, ni XP de cuenta, ni nada que implique una
 * recompensa autoritativa. Este módulo ya NO toca saldo ni XP; solo resume el partido (victoria,
 * bajas) para la ceremonia y alimenta dos registros LOCALES no económicos: el récord del store y
 * la Carrera del entrenador (modo local). El historial real sigue siendo `coach_matches`.
 */
import type { RoundState, Side } from "@/sim";
import type { MatchState } from "@/match";
import { useGameStore } from "@/store/useGameStore";
import { useManagerStore } from "@/store/useManagerStore";

export interface CoachMatchSummary {
  won: boolean;
  /** Bajas del equipo entrenado. */
  teamKills: number;
}

/** Resume una ronda terminada (PURO). */
export function summarizeRound(state: RoundState): CoachMatchSummary {
  const coachSide: Side = state.coachSide;
  return {
    won: state.winner === coachSide,
    teamKills: state.events.filter(
      (e) => e.type === "kill" && (e.data as { bySide?: Side }).bySide === coachSide,
    ).length,
  };
}

/** Resume un PARTIDO completo (PURO): quién ganó y las bajas del equipo entrenado. */
export function summarizeMatch(match: MatchState): CoachMatchSummary {
  let teamKills = 0;
  for (const round of match.rounds) teamKills += summarizeRound(round).teamKills;
  return { won: match.winner === "home", teamKills };
}

/**
 * Cierra el partido en los registros LOCALES no económicos y devuelve el resumen. Llamar UNA
 * vez al final. No concede créditos ni XP (F68-010): el HUD solo enseña lo que dice el servidor.
 */
export function recordCoachMatch(match: MatchState): CoachMatchSummary {
  const summary = summarizeMatch(match);
  useGameStore.getState().recordMatch(summary.won);
  // Carrera del ENTRENADOR (Career Engine, local): no-op si el usuario aún no creó su entrenador.
  useManagerStore.getState().applyMatch({
    won: summary.won,
    kills: summary.teamKills,
    teamName: match.config.teamNames?.home,
    opponentName: match.config.teamNames?.away,
    tier: "regional",
  });
  return summary;
}
