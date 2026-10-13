/**
 * CONTEXT (Fase 3, ampliación aprobada) — dos bloques 100% OBJETIVOS:
 *
 * 1. NarrativeTags — etiquetas por equipo derivadas SOLO de resultados (flags del Team Analyzer
 *    F2 + standings + stages). Nunca historias: hechos.
 * 2. HistoricalContext — contexto derivado EXCLUSIVAMENTE del historial inyectado
 *    (`TournamentFact[]`, extraíble de AnalyzerResults previos). El Analyzer es puro: sin
 *    historial inyectado no se afirma nada (provided=false, 0 tags). Historial vacío = "no hay
 *    registro previo conocido" → los debuts/primeros títulos SÍ son afirmables sobre ese registro.
 *
 * Puro, determinista, O(n). Nada subjetivo, nada editorial.
 */
import type { CanonicalModel } from "@/importer";
import type { TournamentType } from "@/engine/types";
import type { TeamReport, PlayerReport, NarrativeTag, HistoricalTag, HistoricalContext, TournamentFact } from "./types";
import { ns } from "@/i18n/runtime";

const tr = ns("analyzer");

/* ── 1. NarrativeTags ─────────────────────────────────────────────────────── */

export function computeNarrativeTags(teams: TeamReport[], model: CanonicalModel): NarrativeTag[] {
  const tags: NarrativeTag[] = [];
  const swissStageIds = new Set(model.stages.filter((s) => s.kind === "swiss").map((s) => s.id));
  const hasGroupPhase = model.stages.some((s) => s.kind === "group" || s.kind === "swiss");
  const push = (kind: NarrativeTag["kind"], teamId: string, reason: string): void => { tags.push({ kind, teamId, reason }); };

  for (const t of teams) {
    if (t.champion) push("champion", t.teamId, tr("campeón ({wins}-{losses})", { wins: t.wins, losses: t.losses }));
    if (t.runnerUp) push("runner-up", t.teamId, tr("subcampeón"));
    if (t.champion || t.runnerUp) push("grand-finalist", t.teamId, tr("disputó la gran final"));
    // Buckets de placement excluyentes (el más ajustado; campeón/subcampeón ya etiquetados).
    if (typeof t.placement === "number" && !t.champion && !t.runnerUp) {
      if (t.placement <= 4) push("top4", t.teamId, tr("puesto {placement}", { placement: t.placement }));
      else if (t.placement <= 8) push("top8", t.teamId, tr("puesto {placement}", { placement: t.placement }));
    }
    if (t.perfectRun) push("perfect-run", t.teamId, tr("campeón sin perder mapas ({mapsWon}-0)", { mapsWon: t.mapsWon }));
    if (t.reverseSweep) push("reverse-sweep", t.teamId, tr("remontada desde 0-2 en una serie"));
    if (t.lowerBracketRun) push("lower-bracket-run", t.teamId, tr("llegó a la final desde el lower bracket"));
    if (t.cinderellaRun) push("cinderella-run", t.teamId, tr("finalista fuera del top-8 de ranking"));
    if (t.series > 0 && t.losses === 0 && t.wins > 0) push("undefeated", t.teamId, tr("{wins}-0 en series", { wins: t.wins }));
    // Dark horse: top-4 real con ranking mundial fuera del top-8 (requiere worldRanking).
    const wr = model.index.teamById.get(t.teamId)?.worldRanking;
    if (typeof t.placement === "number" && t.placement <= 4 && typeof wr === "number" && wr > 8) {
      push("dark-horse", t.teamId, tr("puesto {placement} con ranking mundial #{wr}", { placement: t.placement, wr }));
    }
    // Eliminado sin salir de la fase de grupos/swiss (si el torneo la tiene).
    if (hasGroupPhase && t.eliminated && !t.reachedPlayoff) push("group-stage-exit", t.teamId, tr("eliminado en fase de grupos"));
  }

  // Resultado swiss (solo vía standings con stageId de una stage swiss).
  for (const st of model.standings) {
    if (!st.stageId || !swissStageIds.has(st.stageId)) continue;
    if (st.status === "qualified") tags.push({ kind: "swiss-qualified", teamId: st.teamId, reason: `swiss ${st.wins}-${st.losses}` });
    else if (st.status === "eliminated") tags.push({ kind: "swiss-eliminated", teamId: st.teamId, reason: `swiss ${st.wins}-${st.losses}` });
  }

  return tags.sort((a, b) => a.teamId.localeCompare(b.teamId) || a.kind.localeCompare(b.kind));
}

/* ── 2. HistoricalContext ─────────────────────────────────────────────────── */

const INTERNATIONAL: readonly TournamentType[] = ["champions", "masters", "ewc"];

/** Hecho previo más reciente de un subconjunto (por endDate; sin fechas, el último de la lista). */
const mostRecent = (facts: TournamentFact[]): TournamentFact | undefined => {
  if (!facts.length) return undefined;
  let best = facts[0];
  for (const f of facts) if ((f.endDate ?? -1) >= (best.endDate ?? -1)) best = f;
  return best;
};

export function computeHistoricalContext(
  teams: TeamReport[],
  players: PlayerReport[],
  type: TournamentType,
  history?: TournamentFact[],
): HistoricalContext {
  if (history === undefined) return { provided: false, tournaments: 0, tags: [] };
  const tags: HistoricalTag[] = [];
  const push = (t: HistoricalTag): void => { tags.push(t); };

  const teamIn = (f: TournamentFact, teamId: string): boolean =>
    (f.teamIds ?? []).includes(teamId) || f.championTeamId === teamId || (f.placements ?? []).some((p) => p.teamId === teamId);
  const playerIn = (f: TournamentFact, playerId: string): boolean =>
    (f.playerIds ?? []).includes(playerId) || (f.playerRatings ?? []).some((r) => r.playerId === playerId);

  // ── Títulos del campeón actual ──
  const champ = teams.find((t) => t.champion);
  if (champ) {
    const priorTitles = history.filter((f) => f.championTeamId === champ.teamId);
    const total = priorTitles.length + 1;
    if (total === 1) push({ kind: "first-title", teamId: champ.teamId, value: 1, reason: tr("primer título del registro") });
    else if (total === 2) push({ kind: "second-title", teamId: champ.teamId, value: 2, reason: tr("segundo título del registro") });
    else push({ kind: "three-titles", teamId: champ.teamId, value: total, reason: tr("{total} títulos en el registro", { total }) });

    const sameType = history.filter((f) => f.type === type);
    const priorSameType = sameType.filter((f) => f.championTeamId === champ.teamId);
    if (priorSameType.length) {
      push({ kind: "repeat-champion", teamId: champ.teamId, value: priorSameType.length + 1, reason: tr("ya fue campeón de un {type}", { type }) });
      if (mostRecent(sameType)?.championTeamId === champ.teamId) {
        push({ kind: "back-to-back-champion", teamId: champ.teamId, reason: tr("campeón del {type} anterior consecutivo", { type }) });
      }
    }
  }

  // ── Primeras participaciones de EQUIPO (solo equipos que jugaron series) ──
  for (const t of teams) {
    if (t.series === 0) continue;
    const priors = history.filter((f) => teamIn(f, t.teamId));
    if (INTERNATIONAL.includes(type) && !priors.some((f) => INTERNATIONAL.includes(f.type))) {
      push({ kind: "first-international", teamId: t.teamId, reason: tr("primer internacional del registro") });
    }
    if (type === "masters" && !priors.some((f) => f.type === "masters")) push({ kind: "first-masters", teamId: t.teamId, reason: tr("primer Masters del registro") });
    if (type === "champions" && !priors.some((f) => f.type === "champions")) push({ kind: "first-champions", teamId: t.teamId, reason: tr("primer Champions del registro") });

    // Mejor placement de su registro (requiere placements previos del equipo).
    const priorPlacements = priors.flatMap((f) => (f.placements ?? []).filter((p) => p.teamId === t.teamId).map((p) => p.position));
    if (typeof t.placement === "number" && priorPlacements.length && t.placement < Math.min(...priorPlacements)) {
      push({ kind: "best-placement", teamId: t.teamId, value: t.placement, reason: tr("mejor puesto del registro ({placement} < {Math})", { placement: t.placement, Math: Math.min(...priorPlacements) }) });
    }
  }

  // ── Debuts y récords de JUGADOR (solo jugadores con stats) ──
  for (const p of players) {
    if (p.maps === 0) continue;
    const priors = history.filter((f) => playerIn(f, p.playerId));
    if (!priors.length) push({ kind: "debut-lan", playerId: p.playerId, teamId: p.teamId, reason: tr("primera aparición del registro") });
    if (INTERNATIONAL.includes(type) && !priors.some((f) => INTERNATIONAL.includes(f.type))) {
      push({ kind: "debut-international", playerId: p.playerId, teamId: p.teamId, reason: tr("primer internacional del registro") });
    }
    const priorRatings = priors.flatMap((f) => (f.playerRatings ?? []).filter((r) => r.playerId === p.playerId).map((r) => r.rating));
    if (priorRatings.length) {
      if (p.rating > Math.max(...priorRatings)) push({ kind: "career-high", playerId: p.playerId, value: p.rating, reason: tr("rating {rating} > máximo previo {Math}", { rating: p.rating, Math: Math.max(...priorRatings) }) });
      else if (p.rating < Math.min(...priorRatings)) push({ kind: "career-low", playerId: p.playerId, value: p.rating, reason: tr("rating {rating} < mínimo previo {Math}", { rating: p.rating, Math: Math.min(...priorRatings) }) });
    }
  }

  tags.sort((a, b) => (a.teamId ?? a.playerId ?? "").localeCompare(b.teamId ?? b.playerId ?? "") || a.kind.localeCompare(b.kind));
  return { provided: true, tournaments: history.length, tags };
}
