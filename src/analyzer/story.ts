/**
 * STORY ENGINE — narrativa OBJETIVA como ETIQUETAS ESTRUCTURADas (nunca frases, nunca IA generativa).
 * Cada tag se deriva SOLO de datos; los que exigen historial entre torneos (dynasty/redemption/
 * new-generation) se OMITEN por falta de evidencia. Puro y determinista.
 */
import type { CanonicalModel } from "@/importer";
import type { TeamReport, StoryTag } from "./types";

export function computeStory(teams: TeamReport[], model: CanonicalModel): StoryTag[] {
  const tags: StoryTag[] = [];
  const champ = teams.find((t) => t.champion);
  const teamName = (id?: string): string => model.index.teamById.get(id ?? "")?.name ?? id ?? "?";

  // Partido de la Gran Final (por etiqueta de ronda; el de mayor orden si hay varios).
  const finals = model.matches.filter((m) => (m.round ?? "").toLowerCase().includes("final"));
  const grandFinal = finals.length ? finals.reduce((a, b) => ((b.matchOrder ?? 0) > (a.matchOrder ?? 0) ? b : a)) : undefined;

  if (champ) {
    if (champ.perfectRun) tags.push({ kind: "perfect-playoffs", teamId: champ.teamId, reason: `campeón sin perder mapas (${champ.mapsWon}-0)` });
    if (champ.winrate === 1 && champ.roundDiff >= 20 && champ.series >= 3) tags.push({ kind: "dominated", teamId: champ.teamId, reason: `100% series, +${champ.roundDiff} rounds` });
    if (champ.cinderellaRun) { tags.push({ kind: "underdog", teamId: champ.teamId, reason: "campeón fuera del top-8 de ranking" }); tags.push({ kind: "miracle-run", teamId: champ.teamId, reason: "campeón partiendo de baja semilla" }); }
  }

  if (grandFinal && grandFinal.winnerTeamId && grandFinal.scoreA != null && grandFinal.scoreB != null) {
    const diff = Math.abs(grandFinal.scoreA - grandFinal.scoreB);
    const loserMaps = Math.min(grandFinal.scoreA, grandFinal.scoreB);
    if (loserMaps === 0) tags.push({ kind: "flawless-finals", teamId: grandFinal.winnerTeamId, reason: `final ${Math.max(grandFinal.scoreA, grandFinal.scoreB)}-0` });
    else if (diff <= 1) tags.push({ kind: "close-finals", reason: `final ${grandFinal.scoreA}-${grandFinal.scoreB}` });
  }

  // Reverse sweep (flag objetivo del Team Analyzer).
  for (const t of teams) if (t.reverseSweep) tags.push({ kind: "reverse-sweep", teamId: t.teamId, reason: "remontada desde 0-2 en una serie" });

  // Upset — mayor sorpresa por ranking (requiere worldRanking; si no hay, se omite).
  let bestUpset: { winner: string; loser: string; gap: number } | undefined;
  for (const m of model.matches) {
    if (!m.winnerTeamId) continue;
    const w = model.index.teamById.get(m.winnerTeamId)?.worldRanking;
    const loserId = m.winnerTeamId === m.teamAId ? m.teamBId : m.teamAId;
    const l = model.index.teamById.get(loserId ?? "")?.worldRanking;
    if (typeof w === "number" && typeof l === "number" && w - l >= 5) {
      const gap = w - l;
      if (!bestUpset || gap > bestUpset.gap) bestUpset = { winner: m.winnerTeamId, loser: loserId!, gap };
    }
  }
  if (bestUpset) tags.push({ kind: "upset", teamId: bestUpset.winner, reason: `venció a un top-${model.index.teamById.get(bestUpset.loser)?.worldRanking} (${teamName(bestUpset.loser)})` });

  // Collapse — cabeza de grupo que cae eliminado en playoffs sin podio.
  for (const t of teams) {
    if (t.groupWinner && t.eliminated && (t.placement ?? 99) > 3) tags.push({ kind: "collapse", teamId: t.teamId, reason: `1º de grupo, eliminado en puesto ${t.placement}` });
  }

  return tags;
}
