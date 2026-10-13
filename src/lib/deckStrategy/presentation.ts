/**
 * FASE 43 · PRESENTACIÓN PURA DE LA CAPA ESTRATÉGICA. Traduce análisis / cambios / resúmenes a filas de pantalla.
 * No calcula estrategia (eso es `@/domain/deckStrategy`), no lee el reloj, no hace red.
 */
import type { DuelDeckCardDTO, DuelResultView, DuelTurnView } from "@/lib/duel/types";
import {
  AXES, METRICS, METRIC_LABEL, METRIC_ABBR, balanceText, signedText, deltaAria, summarizeMatch, turnFactsFromView,
  type Axis, type DeckAnalysis, type Metric, type StrategyCard, type SwapImpact, type MatchStrategySummary, type ResultFact,
} from "@/domain/deckStrategy";
import { catalogCards } from "./catalog";
import { pct } from "@/domain/deckStrategy/analysis";
import { ns, td, getIntlLocale } from "@/i18n/runtime";

const t = ns("deckStrategy");

export const AXIS_COLOR: Record<Axis, string> = { stronghold: "#d94a4a", gamesense: "#3f86c4", entryfrag: "#3fa85f" };
export const LEVEL_TEXT = { ALTO: "Alto", MEDIO: "Medio", BAJO: "Bajo" } as const;

export const fmt1 = (x: number): string => (Math.round(x * 10) / 10).toLocaleString(getIntlLocale(), { minimumFractionDigits: 0, maximumFractionDigits: 1 });
export const pLabel = (p: number | null | undefined): string => (p === null || p === undefined ? "—" : pct(p));

export interface AxisRow { metric: Metric; label: string; abbr: string; value: number; valueText: string; percentile: string; level: string | null; bar: number; aria: string }

export function axisRows(a: DeckAnalysis): AxisRow[] {
  return METRICS.map((m) => {
    const value = a.metrics[m].mean;
    const p = a.catalogPercentile?.[m] ?? null;
    const level = a.level ? LEVEL_TEXT[a.level[m]] : null;
    return {
      metric: m, label: METRIC_LABEL[m], abbr: METRIC_ABBR[m], value, valueText: a.count ? fmt1(value) : "—",
      percentile: pLabel(p), level, bar: p ?? Math.max(0, Math.min(100, value)),
      aria: a.count ? (p !== null
        ? t("{metric} media {value}, percentil {p} de las cartas del catálogo, {level}", { metric: td(METRIC_LABEL[m]), value: fmt1(value), p: Math.round(p), level: level ? td(level).toLowerCase() : undefined })
        : t("{metric} media {value}", { metric: td(METRIC_LABEL[m]), value: fmt1(value) })) : t("{v} sin cartas", { v: td(METRIC_LABEL[m]) }),
    };
  });
}

export interface IdentityModel { label: string; kind: string; balance: string | null; shape: string | null; partial: string | null }

export function identityModel(a: DeckAnalysis): IdentityModel {
  if (!a.complete) return { label: a.count === 0 ? t("Sin cartas") : t("Equipo incompleto"), kind: "PARTIAL", balance: null, shape: null, partial: a.count === 0 ? null : t("{count}/10: la orientación se calcula con las 10 cartas.", { count: a.count }) };
  const o = a.orientation!;
  return {
    label: o.label, kind: o.kind, balance: balanceText(o),
    shape: a.shape === "POLARIZED" ? t("Polarizado") : a.shape === "CONSISTENT" ? t("Consistente") : null,
    partial: null,
  };
}

export interface DeltaChip { metric: Metric; abbr: string; text: string; aria: string; tone: "up" | "down" | "same" }

export function deltaChips(d: Record<Metric, number>, decimals = 1): DeltaChip[] {
  return METRICS.map((m) => {
    const r = Math.round(d[m] * 10 ** decimals) / 10 ** decimals;
    return { metric: m, abbr: METRIC_ABBR[m], text: signedText(d[m], decimals), aria: deltaAria(m, d[m]), tone: r > 0 ? "up" : r < 0 ? "down" : "same" };
  });
}

/** «STRONGHOLD 76 → 79 (+3)» con medias a un decimal y delta exacto redondeado. */
export function impactLines(i: SwapImpact): { metric: Metric; label: string; before: string; after: string; delta: string; aria: string }[] {
  return METRICS.map((m) => ({ metric: m, label: METRIC_LABEL[m], before: fmt1(i.before[m]), after: fmt1(i.after[m]), delta: signedText(i.delta[m]), aria: t("{v} de {v2} a {v3}: {m}", { v: td(METRIC_LABEL[m]), v2: fmt1(i.before[m]), v3: fmt1(i.after[m]), m: deltaAria(m, i.delta[m]) }) }));
}

/* ───────────── cartas del cliente (DTO sin dataVersion) → carta estratégica ───────────── */

let versionIndex: Map<string, string> | null = null;
export function dtoToStrategy(c: DuelDeckCardDTO): StrategyCard {
  if (!versionIndex) versionIndex = new Map(catalogCards().map((x) => [x.cardId, x.dataVersion]));
  return { uid: c.uid, cardId: c.cardId, playerId: c.playerId, nick: c.nick, role: c.role, ovr: c.ovr, combat: c.combat, dataVersion: versionIndex.get(c.cardId) ?? "VCT-2026" };
}

/* ───────────── partida ───────────── */

export function resultFact(r: DuelResultView | null): ResultFact | null {
  return r ? { winner: r.winner, isDraw: r.isDraw, scoreYou: r.scoreYou, scoreRival: r.scoreRival, tiedEncounters: r.tiedEncounters, decidedBy: r.decidedBy, sumOvrYou: r.sumOvrYou, sumOvrRival: r.sumOvrRival, statTotalYou: r.statTotalYou, statTotalRival: r.statTotalRival } : null;
}

export function matchSummaryFromView(history: readonly DuelTurnView[], result: DuelResultView | null): MatchStrategySummary {
  return summarizeMatch(turnFactsFromView(history), resultFact(result));
}

/** Enlace «Ajustar equipo»: abre el constructor con ese equipo; el eje es CONTEXTO opcional, no una orden. */
export function adjustDeckHref(deckId: string | null | undefined, axis: Axis | null): string | null {
  if (!deckId) return null;
  return `/duelos/mazos?deck=${encodeURIComponent(deckId)}${axis ? `&eje=${axis}` : ""}`;
}

export const isAxis = (v: unknown): v is Axis => typeof v === "string" && (AXES as readonly string[]).includes(v);
