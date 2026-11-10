/**
 * BALANCE ENGINE — empareja por MUCHO más que MMR (Online Fase 2/7).
 *
 * Combina MMR (base Elo REUTILIZADA: `expectedScore`), ping, región, tiempo en cola, tamaño de
 * party, skill, nivel, experiencia, coachRating y composición. NUNCA solo por MMR. Devuelve una
 * calidad 0..100 (100 = emparejamiento perfecto). PURO y DETERMINISTA.
 */
import { expectedScore } from "@/domain/esports/predict/elo";
import type { PlayerProfile, SearchWindow } from "./types";
import { pairPing } from "./region";
import { compositionScore } from "./profile";

const closeness = (a: number, b: number, scale: number): number => Math.max(0, 1 - Math.abs(a - b) / scale);

/**
 * Calidad de emparejar a los perfiles `a` y `b`. `waitA`/`waitB` = ticks en cola (más espera ⇒
 * el sistema tolera más). Ponderación multi-factor (nunca un único eje).
 */
export function matchQuality(a: PlayerProfile, b: PlayerProfile, waitA = 0, waitB = 0): number {
  // MMR: probabilidad esperada; 0.5 (igualdad) = perfecto.
  const mmrFair = 1 - Math.min(1, Math.abs(expectedScore(a.mmr, b.mmr) - 0.5) * 2);
  const ping = pairPing(a, b);
  const pingScore = Math.max(0, 1 - ping / 200);
  const regionScore = a.region === b.region ? 1 : 0.5;
  const skillScore = closeness(a.skill, b.skill, 60);
  const levelScore = closeness(a.level, b.level, 40);
  const expScore = closeness(a.experience, b.experience, 2000);
  const coachScore = closeness(a.coachRating, b.coachRating, 80);
  const compScore = (compositionScore(a.roster) + compositionScore(b.roster)) / 200;
  const partyScore = (a.partyId ? 1 : 0) === (b.partyId ? 1 : 0) ? 1 : 0.7;

  const raw =
    mmrFair * 0.34 + pingScore * 0.20 + regionScore * 0.10 + skillScore * 0.12 +
    levelScore * 0.06 + expScore * 0.04 + coachScore * 0.06 + compScore * 0.04 + partyScore * 0.04;

  // La espera relaja la exigencia (empuja la calidad hacia arriba con el tiempo).
  const patience = Math.min(0.15, (waitA + waitB) / 2000);
  return Math.round(Math.min(100, (raw + patience) * 100));
}

/** Equilibrio global de dos equipos (0..100): compara sus MMR medios. */
export function teamBalance(home: PlayerProfile[], away: PlayerProfile[]): number {
  if (home.length === 0 || away.length === 0) return 50;
  const avg = (xs: PlayerProfile[]) => xs.reduce((a, p) => a + p.mmr, 0) / xs.length;
  const fair = 1 - Math.min(1, Math.abs(expectedScore(avg(home), avg(away)) - 0.5) * 2);
  return Math.round(fair * 100);
}

/** ¿Es aceptable este emparejamiento con la ventana de búsqueda actual? */
export function acceptable(a: PlayerProfile, b: PlayerProfile, window: SearchWindow, waitA = 0, waitB = 0): boolean {
  if (Math.abs(a.mmr - b.mmr) > window.mmrRange) return false;
  if (pairPing(a, b) > window.pingMax) return false;
  if (window.regionStrict && a.region !== b.region) return false;
  return matchQuality(a, b, waitA, waitB) >= window.minQuality;
}
