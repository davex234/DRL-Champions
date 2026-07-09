/**
 * EDITORIAL ENGINE (Fase 4) — ciclo de vida y estados. REUTILIZA `decideCard` (intel) para
 * new/improve/keep/special contra el historial inyectado; anti-dup por
 * `${playerId}:${family}:${season}` (convención del Live Timeline); confianza objetiva estilo
 * engine A (penalizaciones por datos faltantes) ⇒ releaseState draft/pending/approved.
 * Los overrides (la ÚNICA intervención manual) se aplican AL FINAL y quedan trazados.
 */
import { decideCard, type CardDecision, type PlayerHistory } from "@/intel/decide";
import type { AnalyzerResult } from "@/analyzer";
import type {
  AccoladeGrant, EditorialOverride, GeneratorLedger, OmittedCard, PlayerResolution, ReleaseState, RetiredCard,
} from "./types";

/* ── Overrides sobre GRANTS (set-mvp / grant-accolade / retire-card) ─────────
 * Los grants llegan con ids del ANALYZER; los overrides usan ids de CATÁLOGO, así que se
 * traducen con el mapa inverso de resoluciones. */
export function applyGrantOverrides(
  grants: AccoladeGrant[],
  overrides: EditorialOverride[],
  resolutions: PlayerResolution[],
): { grants: AccoladeGrant[]; retires: RetiredCard[]; applied: EditorialOverride[] } {
  const toAnalyzer = new Map(resolutions.filter((r) => r.playerId).map((r) => [r.playerId!, r.analyzerId]));
  let out = [...grants];
  const retires: RetiredCard[] = [];
  const applied: EditorialOverride[] = [];

  for (const ov of overrides) {
    const analyzerId = toAnalyzer.get(ov.playerId);
    if (ov.kind === "set-mvp") {
      if (!analyzerId) continue;
      out = out.filter((g) => g.accolade !== "tournament-mvp");
      out.push({ playerId: analyzerId, accolade: "tournament-mvp", ruleId: `override:${ov.kind}`, evidence: ov.reason, priority: 1000 });
      applied.push(ov);
    } else if (ov.kind === "grant-accolade" && ov.accolade) {
      if (!analyzerId) continue;
      if (!out.some((g) => g.playerId === analyzerId && g.accolade === ov.accolade)) {
        out.push({ playerId: analyzerId, accolade: ov.accolade, ruleId: `override:${ov.kind}`, evidence: ov.reason, priority: 1000 });
      }
      applied.push(ov);
    } else if (ov.kind === "retire-card") {
      retires.push({ playerId: ov.playerId, cardId: ov.family ? `${ov.playerId}__${ov.family}` : undefined, reason: ov.reason });
      applied.push(ov);
    }
    // block-card / force-variant se aplican sobre los SPECS (en el motor), no sobre grants.
  }
  return { grants: out, retires, applied };
}

/* ── Ciclo de vida por (jugador, familia) ─────────────────────────────────── */

export interface LifecycleResult {
  /** familia (accolade) → decisión para cada grant EMITIBLE. */
  decisions: Map<string, CardDecision>; // clave `${analyzerId}:${family}`
  omitted: OmittedCard[];
}

export function decideLifecycle(
  grants: AccoladeGrant[],
  analysis: AnalyzerResult,
  resolutions: PlayerResolution[],
  ledger: GeneratorLedger,
  season: number,
): LifecycleResult {
  const toCatalog = new Map(resolutions.filter((r) => r.playerId).map((r) => [r.analyzerId, r.playerId!]));
  const reportOf = new Map(analysis.report.players.map((p) => [p.playerId, p]));
  const champion = analysis.report.teams.find((t) => t.champion)?.teamId;
  const keys = new Set(ledger.cardKeys);

  const decisions = new Map<string, CardDecision>();
  const omitted: OmittedCard[] = [];

  for (const g of grants) {
    const catalogId = toCatalog.get(g.playerId);
    const rep = reportOf.get(g.playerId);
    if (!catalogId || !rep) continue; // ambiguos: sin carta (quedan en players[] para resolver)
    const family = g.accolade;

    // Anti-dup: misma (jugador, familia, temporada) jamás se emite dos veces.
    if (keys.has(`${catalogId}:${family}:${season}`)) {
      omitted.push({ playerId: catalogId, family, action: "duplicate", reason: `ya emitida en la temporada ${season}` });
      continue;
    }

    const history: PlayerHistory = ledger.history[catalogId] ?? { bestRating: null, ownsFamilies: [] };
    const d = decideCard({
      rating: rep.rating,
      won: !!champion && rep.teamId === champion,
      mvp: family === "tournament-mvp",
      family,
      history,
    });
    if (d.action === "keep") {
      omitted.push({ playerId: catalogId, family, action: "keep", reason: d.reason });
      continue;
    }
    decisions.set(`${g.playerId}:${family}`, d);
  }
  return { decisions, omitted };
}

/* ── Confianza objetiva → releaseState ────────────────────────────────────── */

export interface ConfidenceInput {
  resolution: PlayerResolution;
  analyzerConfidence: "low" | "medium" | "high";
  hasImage: boolean;
  hasCountry: boolean;
}

/** Penalizaciones OBJETIVAS (estilo engine A): nunca juicio manual. */
export function confidenceOf(i: ConfidenceInput): { confidence: number; issues: string[] } {
  let c = 0.95;
  const issues: string[] = [];
  if (i.resolution.status === "created") { c -= 0.05; issues.push("jugador nuevo (draft)"); }
  if (!i.hasImage) { c -= 0.02; issues.push("sin foto"); }
  if (!i.hasCountry) { c -= 0.04; issues.push("país sin resolver"); }
  if (i.analyzerConfidence === "low") { c -= 0.1; issues.push("muestra estadística baja"); }
  else if (i.analyzerConfidence === "medium") { c -= 0.03; issues.push("muestra estadística media"); }
  return { confidence: Math.round(c * 100) / 100, issues };
}

export function releaseStateOf(resolution: PlayerResolution, confidence: number): ReleaseState {
  if (resolution.status === "created") return "draft";
  return confidence >= 0.9 ? "approved" : "pending";
}
