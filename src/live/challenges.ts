/**
 * LIVE ECOSYSTEM — DESAFÍOS automáticos.
 *
 * De los eventos del universo nacen misiones temáticas ("Gana con jugadores de Clutch",
 * "Gana con un jugador de {equipo} campeón"). Reglas, no hardcode. PURO y determinista.
 */
import type { EcoEvent } from "./events";

export interface Challenge {
  id: string;
  title: string;
  description: string;
  kind: "ability" | "team" | "player";
  criteria: Record<string, string | number>;
  season: number;
  reward: { credits: number; xp: number };
}

const mk = (c: Omit<Challenge, "id">): Challenge => ({ id: `chg:${c.kind}:${JSON.stringify(c.criteria)}:${c.season}`.toLowerCase().replace(/\s+/g, "_"), ...c });

/** Genera desafíos a partir de los eventos (dedup por id). */
export function generateChallenges(events: EcoEvent[]): Challenge[] {
  const out = new Map<string, Challenge>();
  const add = (c: Challenge) => { if (!out.has(c.id)) out.set(c.id, c); };

  for (const e of events) {
    if (e.type === "champion" && e.team) {
      add(mk({ kind: "team", season: e.season, title: `Reta a ${e.team}`, description: `Gana un partido con un jugador campeón de ${e.tournamentName}.`, criteria: { team: e.team }, reward: { credits: 2000, xp: 80 } }));
    }
    if (e.type === "historic_ace" && e.player) {
      add(mk({ kind: "ability", season: e.season, title: "Reyes del clutch", description: "Gana usando jugadores con alta habilidad de Clutch.", criteria: { ability: "Clutch" }, reward: { credits: 1500, xp: 60 } }));
    }
    if (e.type === "mvp" && e.player) {
      add(mk({ kind: "player", season: e.season, title: `Como ${e.player}`, description: `Gana un partido con ${e.player} en tu quinteto.`, criteria: { player: e.player }, reward: { credits: 1800, xp: 70 } }));
    }
  }
  return [...out.values()];
}
