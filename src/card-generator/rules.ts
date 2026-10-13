/**
 * RULE ENGINE (Fase 4) — intérprete del RuleSet. Las reglas son DATOS: cada una selecciona
 * hechos del `AnalyzerResult` (premios/tags/candidatos/outliers/líderes) y concede
 * accolades/badges/retiros con trazabilidad (ruleId + evidencia). Nunca ifs por jugador.
 * Determinista: prioridad desc → id asc; primer grant gana en empate (dedup por clave).
 * Los ids emitidos son del ANALYZER (el motor los traduce tras la resolución de identidad).
 */
import type { AnalyzerResult, PlayerReport, ConfidenceLevel } from "@/analyzer";
import type { TournamentType } from "@/engine/types";
import type { RuleSet, Rule, AccoladeGrant, BadgeGrant } from "./types";
import { ns, td } from "@/i18n/runtime";

const tr = ns("cardgenerator");

export interface RuleEvaluation {
  grants: AccoladeGrant[];
  badges: BadgeGrant[];
  retires: { playerId: string; ruleId: string; evidence: string }[];
  issues: string[];
}

/** Campos numéricos de PlayerReport accesibles desde reglas (leader/playerReport). */
const FIELD: Record<string, (p: PlayerReport) => number> = {
  rating: (p) => p.rating, impact: (p) => p.impact, mvpScore: (p) => p.mvpScore,
  acs: (p) => p.acs, adr: (p) => p.adr, kast: (p) => p.kast, hsPct: (p) => p.hsPct,
  kills: (p) => p.kills, deaths: (p) => p.deaths, assists: (p) => p.assists,
  fk: (p) => p.fk, clutches: (p) => p.clutches, consistency: (p) => p.consistency,
};

interface Target { playerId?: string; teamId?: string; value?: number; evidence: string }

const CONF_ORDER: Record<ConfidenceLevel, number> = { low: 0, medium: 1, high: 2 };

function targetsOf(rule: Rule, analysis: AnalyzerResult): Target[] {
  const { source, kind } = rule.when;
  const r = analysis.report;
  switch (source) {
    case "award":
      return r.awards.filter((a) => a.kind === kind)
        .map((a) => ({ playerId: a.playerId, teamId: a.teamId, value: a.value, evidence: `award ${a.kind} (${a.reason})` }));
    case "narrativeTag":
      return analysis.narrativeTags.filter((t) => t.kind === kind)
        .map((t) => ({ teamId: t.teamId, evidence: `narrativeTag ${t.kind} (${t.reason})` }));
    case "historicalTag":
      return analysis.historicalContext.tags.filter((t) => t.kind === kind)
        .map((t) => ({ playerId: t.playerId, teamId: t.teamId, value: t.value, evidence: `historicalTag ${t.kind} (${t.reason})` }));
    case "candidate":
      if (kind === "mvp") {
        const top = analysis.candidates.mvp[0];
        return top ? [{ playerId: top.playerId, value: top.mvpScore, evidence: `candidato MVP (mvpScore ${top.mvpScore})` }] : [];
      }
      if (kind === "allstar") {
        return analysis.candidates.allStar.map((s) => ({ playerId: s.playerId, value: s.score, evidence: `all-star ${s.slot} (${s.score})` }));
      }
      return [];
    case "outlier":
      return analysis.outliers.filter((o) => o.metric === kind && o.direction === "high" && (rule.when.minZ === undefined || o.zscore >= rule.when.minZ))
        .map((o) => ({ playerId: o.playerId, value: o.zscore, evidence: `outlier ${o.metric} z=${o.zscore}` }));
    case "highlight":
      return analysis.candidates.highlights.filter((h) => h.metric === kind && (rule.when.minZ === undefined || h.zscore >= rule.when.minZ))
        .map((h) => ({ playerId: h.playerId, value: h.value, evidence: `highlight ${h.metric}=${h.value} (z=${h.zscore})` }));
    case "record":
      return r.records.filter((rec) => rec.kind === kind && rec.playerId)
        .map((rec) => ({ playerId: rec.playerId, teamId: rec.teamId, value: rec.value, evidence: `record ${rec.kind} (${rec.value})` }));
    case "leader": {
      const f = FIELD[kind];
      if (!f) return [];
      const played = r.players.filter((p) => p.maps > 0);
      if (!played.length) return [];
      const best = played.reduce((a, b) => (f(b) > f(a) || (f(b) === f(a) && b.playerId < a.playerId) ? b : a));
      return [{ playerId: best.playerId, teamId: best.teamId, value: f(best), evidence: tr("líder del torneo en {kind} ({best})", { kind: td(kind), best: f(best) }) }];
    }
    case "playerReport": {
      const f = FIELD[kind];
      if (!f) return [];
      return r.players.filter((p) => p.maps > 0)
        .map((p) => ({ playerId: p.playerId, teamId: p.teamId, value: f(p), evidence: `${kind} ${f(p)}` }));
    }
  }
}

export function evaluateRules(analysis: AnalyzerResult, ruleset: RuleSet, ttype: TournamentType): RuleEvaluation {
  const issues: string[] = [];
  const seenIds = new Set<string>();
  for (const rule of ruleset.rules) {
    if (seenIds.has(rule.id)) issues.push(`regla duplicada: ${rule.id}`);
    seenIds.add(rule.id);
  }

  const confOf = new Map(analysis.performance.map((p) => [p.playerId, p.confidence.level]));
  const playersOfTeam = (teamId: string): PlayerReport[] =>
    analysis.report.players.filter((p) => p.teamId === teamId && p.maps > 0);

  const rules = [...ruleset.rules].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  const grants: AccoladeGrant[] = [];
  const badges: BadgeGrant[] = [];
  const retires: RuleEvaluation["retires"] = [];
  const grantKey = new Set<string>();
  const badgeKey = new Set<string>();

  for (const rule of rules) {
    if (rule.when.tournamentTypes && !rule.when.tournamentTypes.includes(ttype)) continue;
    for (const t of targetsOf(rule, analysis)) {
      if (rule.when.minValue !== undefined && (t.value === undefined || t.value < rule.when.minValue)) continue;

      // Expansión a roster: hecho de equipo → jugadores del equipo.
      const playerIds: string[] = t.playerId
        ? [t.playerId]
        : rule.when.teamScope === "roster" && t.teamId
          ? playersOfTeam(t.teamId).map((p) => p.playerId)
          : [];

      if (rule.grant.accolade || rule.grant.retire || (rule.grant.badge && playerIds.length)) {
        for (const pid of playerIds) {
          if (rule.when.minConfidence && CONF_ORDER[confOf.get(pid) ?? "low"] < CONF_ORDER[rule.when.minConfidence]) continue;
          if (rule.grant.accolade) {
            const key = `${pid}:${rule.grant.accolade}`;
            if (!grantKey.has(key)) {
              grantKey.add(key);
              grants.push({ playerId: pid, accolade: rule.grant.accolade, ruleId: rule.id, evidence: t.evidence, priority: rule.priority });
            }
          }
          if (rule.grant.badge) {
            const key = `p:${pid}:${rule.grant.badge}`;
            if (!badgeKey.has(key)) { badgeKey.add(key); badges.push({ badge: rule.grant.badge, ruleId: rule.id, evidence: t.evidence, playerId: pid }); }
          }
          if (rule.grant.retire) retires.push({ playerId: pid, ruleId: rule.id, evidence: t.evidence });
        }
      }
      // Badge de EQUIPO (sin expansión): se adjunta al teamId.
      if (rule.grant.badge && !t.playerId && t.teamId && !rule.when.teamScope) {
        const key = `t:${t.teamId}:${rule.grant.badge}`;
        if (!badgeKey.has(key)) { badgeKey.add(key); badges.push({ badge: rule.grant.badge, ruleId: rule.id, evidence: t.evidence, teamId: t.teamId }); }
      }
    }
  }

  return { grants, badges, retires, issues };
}
