/**
 * FASE 43 · COMPARADOR DE DOS EQUIPOS PROPIOS (PURO). Diferencias, sin ganador: «A tiene +4 Entryfrag», nunca
 * «A es mejor».
 */
import type { RoleId } from "@/domain/cards/types";
import { DUEL_ROLES } from "@/domain/cardgame/types";
import { METRICS, METRIC_LABEL, type Metric, type StrategyContext } from "./catalog";
import { analyzeDeck, type DeckAnalysis, type StrategyCard } from "./analysis";
import { signedText } from "./swap";
import { ns, td } from "@/i18n/runtime";

const t = ns("deckStrategy");

export interface CompareRowM { metric: Metric; label: string; a: number; b: number; diff: number; text: string }
export interface CompareRoleRow { role: RoleId; a: number | null; b: number | null; diff: number | null }

export interface DeckComparison {
  nameA: string;
  nameB: string;
  a: DeckAnalysis;
  b: DeckAnalysis;
  rows: CompareRowM[];
  roles: CompareRoleRow[];
  orientation: { a: string | null; b: string | null };
  /** Frases de diferencia, nunca un veredicto. */
  summary: string[];
}

export function diffText(nameA: string, nameB: string, metric: Metric, diff: number): string {
  const r = Math.round(diff * 10) / 10;
  if (r === 0) return t("Mismo {v} medio.", { v: td(METRIC_LABEL[metric]) });
  const who = r > 0 ? nameA : nameB;
  return t("{who} tiene {v} de {v2} medio.", { who: td(who), v: signedText(Math.abs(r)), v2: td(METRIC_LABEL[metric]) });
}

export function compareDecks(nameA: string, cardsA: readonly StrategyCard[], nameB: string, cardsB: readonly StrategyCard[], ctx: StrategyContext): DeckComparison {
  const a = analyzeDeck(cardsA, ctx);
  const b = analyzeDeck(cardsB, ctx);
  const rows = METRICS.map((m) => {
    const diff = a.metrics[m].mean - b.metrics[m].mean;
    return { metric: m, label: METRIC_LABEL[m], a: a.metrics[m].mean, b: b.metrics[m].mean, diff, text: diffText(nameA, nameB, m, diff) };
  });
  const roles = DUEL_ROLES.map((role) => {
    const ra = a.roles.find((r) => r.role === role)!.mean.ovr;
    const rb = b.roles.find((r) => r.role === role)!.mean.ovr;
    return { role, a: ra, b: rb, diff: ra !== null && rb !== null ? ra - rb : null };
  });
  return {
    nameA, nameB, a, b, rows, roles,
    orientation: { a: a.orientation?.label ?? null, b: b.orientation?.label ?? null },
    summary: rows.filter((r) => Math.round(r.diff * 10) !== 0).map((r) => r.text),
  };
}
