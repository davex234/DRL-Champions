/**
 * DRL PREDICT — proyección de jugadores: MVP probable y jugador revelación.
 * Funciones PURAS sobre la forma de jugador (`PlayerForm`).
 */
import type { PlayerForm, PlayerProjection } from "./types";

/**
 * MVP probable: el jugador con mayor rating proyectado del equipo favorito.
 * `mvpProb` reparte la probabilidad por softmax del rating dentro del equipo.
 */
export function projectMvp(forms: PlayerForm[], favoredTeamId: string): PlayerProjection | null {
  const squad = forms.filter((p) => p.teamId === favoredTeamId && p.maps > 0);
  if (!squad.length) return null;
  const temp = 4; // temperatura del softmax sobre el rating reciente
  const exps = squad.map((p) => Math.exp((p.recentRating - 1) * temp));
  const total = exps.reduce((a, b) => a + b, 0) || 1;
  let best = 0;
  for (let i = 1; i < squad.length; i++) if (squad[i].recentRating > squad[best].recentRating) best = i;
  const p = squad[best];
  return {
    playerId: p.playerId,
    teamId: p.teamId,
    kind: "mvp",
    projectedRating: Math.round(p.recentRating * 100) / 100,
    mvpProb: Math.round((exps[best] / total) * 1000) / 1000,
  };
}

/**
 * Jugador revelación: mayor momento positivo (rendimiento reciente muy por
 * encima de su línea base). Premia a quien sube fuerte desde un histórico bajo.
 */
export function projectBreakout(forms: PlayerForm[]): PlayerProjection | null {
  const pool = forms.filter((p) => p.maps > 0);
  if (!pool.length) return null;
  const score = (p: PlayerForm) => {
    const delta = p.recentRating - p.baselineRating; // subida de forma
    const lowBaseBonus = Math.max(0, 1.05 - p.baselineRating) * 0.5; // partir de bajo suma
    return delta * 0.7 + lowBaseBonus + p.recentRating * 0.1;
  };
  let best = pool[0];
  for (const p of pool) if (score(p) > score(best)) best = p;
  // Solo cuenta como "revelación" si realmente ha subido.
  if (best.recentRating <= best.baselineRating) return null;
  return {
    playerId: best.playerId,
    teamId: best.teamId,
    kind: "breakout",
    projectedRating: Math.round(best.recentRating * 100) / 100,
    breakoutScore: Math.round(score(best) * 1000) / 1000,
  };
}
