/**
 * AWARDS ENGINE — detecta premios con REGLAS OBJETIVAS (nada aleatorio, nada manual). Emite premios
 * OBJETIVOS (playerId/teamId/coachId + valor + razón), SIN cartas/variant/accolade. Si no hay
 * evidencia suficiente para un premio, se OMITE (nunca se inventa). Puro y determinista.
 */
import type { CanonicalModel } from "@/importer";
import type { PlayerReport, TeamReport, AwardResult, AwardKind } from "./types";

/** Primer máximo estable (items ya vienen ordenados de forma determinista). */
function best<T>(items: T[], val: (t: T) => number, filter?: (t: T) => boolean): { item: T; value: number } | undefined {
  let bi: T | undefined, bv = -Infinity;
  for (const it of items) { if (filter && !filter(it)) continue; const v = val(it); if (v > bv) { bv = v; bi = it; } }
  return bi !== undefined ? { item: bi, value: bv } : undefined;
}

export function computeAwards(players: PlayerReport[], teams: TeamReport[], model: CanonicalModel): AwardResult[] {
  const out: AwardResult[] = [];
  const roleIs = (p: PlayerReport, r: string): boolean => (p.role ?? "").toLowerCase().includes(r);
  const agentCount = new Map(model.players.map((p) => [p.id, new Set(p.agents ?? []).size]));
  const push = (kind: AwardKind, pick: { item: PlayerReport; value: number } | undefined, reason: string, minV = 1): void => {
    if (pick && pick.value >= minV) out.push({ kind, playerId: pick.item.playerId, teamId: pick.item.teamId, value: Math.round(pick.value), reason });
  };

  // MVP — mayor mvpScore (jugadores ya ordenados por mvpScore).
  if (players.length) out.push({ kind: "mvp", playerId: players[0].playerId, teamId: players[0].teamId, value: players[0].mvpScore, reason: `mvpScore ${players[0].mvpScore}` });

  // Mejores por rol (aptitud objetiva).
  push("best-duelist", best(players, (p) => p.roles.duelist), "mayor duelist score");
  push("best-controller", best(players, (p) => p.roles.controller), "mayor controller score");
  push("best-sentinel", best(players, (p) => p.roles.sentinel), "mayor sentinel score");
  push("best-initiator", best(players, (p) => p.roles.initiator), "mayor initiator score");
  push("best-entry", best(players, (p) => p.roles.entry), "mayor entry score");
  push("best-support", best(players, (p) => p.roles.support), "mayor support score");
  push("best-clutch", best(players, (p) => p.clutches), "más clutches", 1);

  // Best flex — más agentes distintos (evidencia). Omite si nadie tiene ≥3.
  const flex = best(players, (p) => agentCount.get(p.playerId) ?? 0);
  if (flex && flex.value >= 3) out.push({ kind: "best-flex", playerId: flex.item.playerId, teamId: flex.item.teamId, value: flex.value, reason: `${flex.value} agentes distintos` });

  // Best rookie / IGL — solo si el rol/estatus lo evidencia; si no, se OMITE.
  push("best-rookie", best(players, (p) => p.mvpScore, (p) => (model.index.playerById.get(p.playerId)?.status ?? "").toLowerCase().includes("rookie")), "mejor rookie");
  push("best-igl", best(players, (p) => p.mvpScore, (p) => roleIs(p, "igl")), "mejor IGL");

  // Best coach — coach del campeón (objetivo). Omite si no hay coach.
  const champ = teams.find((t) => t.champion);
  if (champ) {
    const coach = model.coaches.find((c) => c.teamId === champ.teamId);
    if (coach) out.push({ kind: "best-coach", coachId: coach.id, teamId: champ.teamId, value: 100, reason: `coach del campeón (${champ.name})` });
  }

  // Best team — campeón; si no hay, mayor winrate.
  const bestTeam = champ ?? best(teams, (t) => t.winrate * 1000 + t.roundDiff)?.item;
  if (bestTeam) out.push({ kind: "best-team", teamId: bestTeam.teamId, value: Math.round(bestTeam.winrate * 100), reason: champ ? "campeón" : "mejor winrate" });

  // Sorpresa / decepción — requiere worldRanking; si no hay, se OMITE (no se inventa).
  const ranked = teams.map((t) => ({ t, wr: model.index.teamById.get(t.teamId)?.worldRanking })).filter((x): x is { t: TeamReport; wr: number } => typeof x.wr === "number" && typeof x.t.placement === "number");
  if (ranked.length) {
    const surprise = ranked.reduce((a, b) => ((b.wr - b.t.placement!) > (a.wr - a.t.placement!) ? b : a));
    if (surprise.wr - surprise.t.placement! > 3) out.push({ kind: "biggest-surprise", teamId: surprise.t.teamId, value: surprise.wr - surprise.t.placement!, reason: `puesto ${surprise.t.placement} con ranking #${surprise.wr}` });
    const disap = ranked.reduce((a, b) => ((b.t.placement! - b.wr) > (a.t.placement! - a.wr) ? b : a));
    if (disap.t.placement! - disap.wr > 3) out.push({ kind: "biggest-disappointment", teamId: disap.t.teamId, value: disap.t.placement! - disap.wr, reason: `puesto ${disap.t.placement} con ranking #${disap.wr}` });
  }

  // most-improved: requiere historial entre torneos (no disponible en un solo torneo) → se OMITE.
  return out;
}
