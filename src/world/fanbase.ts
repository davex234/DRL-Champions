/**
 * AFICIÓN — fanbase, popularidad, prestigio y RIVALIDADES (clásicos) de los equipos.
 * El éxito sube prestigio y fans; enfrentarse en finales crea rivalidad persistente. PURO.
 */
import type { WorldState } from "./types";
import type { SeasonResult } from "./season";

const clamp100 = (n: number) => Math.max(0, Math.min(100, n));

export function updateFanbase(world: WorldState, result: SeasonResult): void {
  const total = Object.keys(world.teams).length;
  for (const s of result.standings) {
    const t = world.teams[s.teamId];
    if (!t) continue;
    const perf = 100 - (s.pos - 1) * (80 / Math.max(1, total));
    t.prestige = clamp100(t.prestige + (perf - 55) * 0.08);
    t.fanbase = Math.max(0, Math.round(t.fanbase * 0.98 + perf * 2 + (s.teamId === result.championId ? 250 : 0)));
  }
  // Rivalidad: los finalistas se odian un poco más cada vez (clásico).
  if (result.finalPair) {
    const [a, b] = result.finalPair;
    const ta = world.teams[a], tb = world.teams[b];
    if (ta) ta.rivalries[b] = clamp100((ta.rivalries[b] ?? 0) + 14);
    if (tb) tb.rivalries[a] = clamp100((tb.rivalries[a] ?? 0) + 14);
  }
}
