/**
 * LIVE INTEL — RATING CONTEXTUAL.
 *
 * El rendimiento NO es una media simple: pesa la importancia del torneo, la ronda
 * (grupos/playoffs/final), el impacto (ACS/KAST/clutch/KD) y se compara con el NIVEL
 * histórico del propio jugador (regresión + delta). Devuelve 0..100. Puro y determinista.
 */
import type { TournamentType } from "@/engine/types";

export type Stage = "groups" | "playoffs" | "final";

export interface PlayerPerf {
  acs?: number;
  kast?: number;
  kills?: number;
  deaths?: number;
  assists?: number;
  clutches?: number;
  hsPct?: number;
}

export interface RatingContext {
  type: TournamentType;
  stage?: Stage;
  /** Rating histórico del jugador (su nivel base), si se conoce. */
  baseline?: number;
}

/** Importancia del torneo (un Champions pesa más que un regional). */
export const TOURNAMENT_WEIGHT: Record<TournamentType, number> = {
  champions: 1.0, masters: 0.92, ewc: 0.86, "game-changers": 0.8,
  regional: 0.74, ascension: 0.7, "off-season": 0.6, other: 0.62,
};
const STAGE_WEIGHT: Record<Stage, number> = { groups: 0.92, playoffs: 1.0, final: 1.08 };

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Rendimiento bruto 0..100 a partir de las estadísticas (impacto real). */
export function rawPerformance(p: PlayerPerf): number {
  const acs = clamp((p.acs ?? 200) / 300, 0, 1.25);        // 240 ≈ sólido, 300+ estrella
  const kast = clamp((p.kast ?? 70) / 100, 0, 1);
  const kd = clamp((p.kills ?? 15) / Math.max(1, p.deaths ?? 15), 0, 2) / 2;
  const clutch = clamp((p.clutches ?? 0) / 6, 0, 1);
  const score = acs * 0.5 + kast * 0.22 + kd * 0.18 + clutch * 0.1;
  return clamp(score * 80, 0, 100);
}

/**
 * Rating contextual final 0..100. Combina rendimiento × peso de torneo/ronda y lo
 * mezcla con el nivel histórico (el contexto eleva una gran actuación; un torneo menor
 * la modera). Un MVP de la Gran Final de Champions > los mismos números en grupos regional.
 */
export function contextualRating(perf: PlayerPerf, ctx: RatingContext): number {
  const raw = rawPerformance(perf);
  const w = TOURNAMENT_WEIGHT[ctx.type] ?? 0.7;
  const s = STAGE_WEIGHT[ctx.stage ?? "groups"];
  // El contexto escala alrededor de 50 (no aplasta a los flojos ni infla a los medios).
  const contextual = 50 + (raw - 50) * (0.7 + w * s * 0.6);
  // Mezcla con el histórico: el rendimiento manda (0.7), el nivel base estabiliza (0.3).
  const blended = ctx.baseline != null ? contextual * 0.72 + ctx.baseline * 0.28 : contextual;
  return Math.round(clamp(blended, 1, 99));
}

/** Convierte un rating 0..99 a un OVR de carta plausible (40..99). */
export const ratingToOvr = (rating: number): number => Math.round(clamp(40 + (rating / 99) * 59, 40, 99));

/** Rating contextual a partir de las 6 stats de carta (cuando no hay perf cruda). */
export function ratingFromCardStats(s: { dmg: number; scr: number; com: number; hs: number; ast: number; clu: number }, ctx: RatingContext): number {
  return contextualRating(
    { acs: 140 + s.scr * 1.4, kast: s.com, kills: s.dmg, deaths: Math.max(8, 99 - s.com * 0.5), assists: s.ast, clutches: Math.round(s.clu / 16), hsPct: s.hs },
    ctx,
  );
}
