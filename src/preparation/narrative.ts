/**
 * ROUND PREPARATION × NARRATIVE — presión del partido en el momento de preparar.
 *
 * La narrativa influye automáticamente: rachas de derrotas, momentum frío, ir por
 * detrás o enfrentar match point aumentan la presión → más tendencia al force y a
 * cambios tácticos. No modifica el Narrative Engine: deriva la presión de las mismas
 * señales (racha económica, momentum, marcador) disponibles en la preparación.
 */
import type { NarrativePressure, PrepContext } from "./types";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function computePressure(ctx: PrepContext): NarrativePressure {
  const tags: string[] = [];
  let p = 0;

  const lossStreak = ctx.economy?.home.lossStreak ?? 0;
  if (lossStreak >= 3) { p += 0.4; tags.push("losing_streak"); }
  else if (lossStreak === 2) { p += 0.2; tags.push("under_pressure"); }

  if (ctx.momentum < -40) { p += 0.25; tags.push("cold_momentum"); }
  else if (ctx.momentum > 50) { tags.push("hot_momentum"); }

  const deficit = ctx.score.away - ctx.score.home;
  if (deficit >= 3) { p += 0.2; tags.push("behind"); }

  if (ctx.matchPoint.includes("away")) { p += 0.3; tags.push("facing_match_point"); }
  if (ctx.matchPoint.includes("home")) { tags.push("on_match_point"); }

  if (tags.length === 0) tags.push("calm");
  return { value: clamp(p, 0, 1), tags };
}
