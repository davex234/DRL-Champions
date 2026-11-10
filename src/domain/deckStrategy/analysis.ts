/**
 * FASE 43 · ANÁLISIS DESCRIPTIVO DE UN EQUIPO (PURO).
 *
 * Lee SOLO OVR, Stronghold, Gamesense, Entryfrag, rol y jugador. No crea ninguna estadística, no pondera por
 * rareza/serial/equipo/región/edición, no predice resultados y no da una «puntuación de estrategia».
 *
 * FÓRMULAS (contrato: docs/product/card-mastery-strategy-contract.md)
 *   · Resumen por métrica: media, mediana, mínimo, máximo, desviación poblacional, rango.
 *   · Percentil de la media (el que se enseña y da el nivel): rango percentil (punto medio) de la MEDIA del equipo
 *     frente a las CARTAS del catálogo de su calibración. Nivel: ALTO ≥ P66,7 · BAJO ≤ P33,3 · MEDIO entre medias
 *     (terciles). QA real: frente a equipos legales simulados casi cualquier equipo cuidado sale P9x (la media de 10
 *     cartas aleatorias tiene σ ≈ 2 de OVR), así que no distinguía nada.
 *   · Percentil frente a equipos legales simulados: se conserva (detalles avanzados) junto a la calibración.
 *   · z de eje: (media − media de la calibración) / desviación de la calibración.
 *   · Orientación (solo con 10 cartas): z ordenados z1 ≥ z2 ≥ z3.
 *       z1 − z2 ≥ 1      → ORIENTADO al eje 1 (destaca una desviación típica sobre los otros dos)
 *       si no, z1 − z3 < 0,5 → EQUILIBRADO
 *       si no            → MIXTO (dos ejes por encima del tercero)
 *   · Forma: desviación del OVR de las 10 cartas frente a la calibración: ≥ P90 POLARIZADO · ≤ P10 CONSISTENTE.
 *   · Valores atípicos: fuera de las vallas de Tukey (Q1 − 1,5·IQR, Q3 + 1,5·IQR) de las cartas del equipo.
 *   · Orden de las cartas irrelevante: todo se calcula sobre el multiconjunto, ordenado de forma estable.
 */
import type { RoleId } from "@/domain/cards/types";
import { DUEL_DECK_SIZE, DUEL_ROLES } from "@/domain/cardgame/types";
import { AXES, METRICS, METRIC_LABEL, metricOf, type Axis, type CatalogCard, type Metric, type StrategyContext } from "./catalog";
import { finite, percentileRank, quantile, summarize, type Summary } from "./stats";
import { ns, td, getIntlLocale } from "@/i18n/runtime";

const t = ns("deckStrategy");

/** Lo que el análisis lee de una carta del equipo (un ejemplar poseído o una definición). */
export interface StrategyCard extends CatalogCard {
  uid: string;
  nick: string;
}

export type Level = "ALTO" | "MEDIO" | "BAJO";
export const LEVEL_HIGH = 200 / 3;
export const LEVEL_LOW = 100 / 3;
export const levelOf = (p: number): Level => (p >= LEVEL_HIGH ? "ALTO" : p <= LEVEL_LOW ? "BAJO" : "MEDIO");

/** Umbrales de orientación en DESVIACIONES TÍPICAS de la distribución de equipos legales. */
export const ORIENTED_GAP_SD = 1;
export const BALANCED_SPREAD_SD = 0.5;
export const POLARIZED_P = 90;
export const CONSISTENT_P = 10;

export type OrientationKind = "ORIENTED" | "BALANCED" | "MIXED";
export interface Orientation {
  kind: OrientationKind;
  /** Eje dominante (ORIENTED) o los dos altos (MIXED). */
  axes: Axis[];
  /** Eje más bajo, si el perfil no es equilibrado. */
  weakest: Axis | null;
  label: string;
  /** Diferencia entre el eje más alto y el siguiente / el más bajo, en desviaciones típicas. */
  gapSd: number;
  spreadSd: number;
}

export type Shape = "POLARIZED" | "CONSISTENT" | "REGULAR";

export interface Insight { id: string; text: string; metric?: Metric; uids?: string[] }

export interface RoleProfile {
  role: RoleId;
  count: number;
  uids: string[];
  mean: Record<Metric, number | null>;
  /** Eje con mayor media dentro del rol (empate → orden canónico SH, GS, EF). */
  mainAxis: Axis | null;
  /** Diferencia de OVR entre las dos cartas del rol (null con menos de 2). */
  ovrGap: number | null;
  /** Media del rol − media del equipo, por métrica. */
  vsDeck: Record<Metric, number | null>;
}

export interface CardContribution {
  uid: string;
  cardId: string;
  nick: string;
  role: RoleId;
  values: Record<Metric, number>;
  vsDeck: Record<Metric, number>;
  /** Frente a la otra carta de su rol (null si no la hay). */
  vsPartner: Record<Metric, number> | null;
  partnerUid: string | null;
  catalogPercentile: Record<Metric, number>;
  /** Hechos: «Mayor Entryfrag del equipo». */
  facts: string[];
}

export interface Outlier { uid: string; metric: Metric; direction: "LOW" | "HIGH"; value: number }

export interface DeckAnalysis {
  count: number;
  complete: boolean;
  roleDistribution: Record<RoleId, number>;
  metrics: Record<Metric, Summary>;
  /** Percentil de la media frente a las cartas del catálogo (lo que se enseña; da el nivel). */
  catalogPercentile: Record<Metric, number> | null;
  /** Percentil de la media frente a los equipos legales simulados (detalles avanzados). */
  deckPercentile: Record<Metric, number> | null;
  level: Record<Metric, Level> | null;
  z: Record<Axis, number> | null;
  orientation: Orientation | null;
  shape: Shape | null;
  dispersionPercentile: number | null;
  strengths: Insight[];
  weaknesses: Insight[];
  outliers: Outlier[];
  roles: RoleProfile[];
  contributions: CardContribution[];
}

const ROLE_ORDER = new Map(DUEL_ROLES.map((r, i) => [r, i]));
const PLURAL: Record<RoleId, string> = { Duelista: "Duelistas", Iniciador: "Iniciadores", Controlador: "Controladores", Centinela: "Centinelas", Flex: "Flex" };

/** Orden estable e independiente del orden de entrada: rol canónico, definición, uid. */
export const canonicalOrder = <T extends { role: RoleId; cardId: string; uid: string }>(cards: readonly T[]): T[] =>
  [...cards].sort((a, b) => (ROLE_ORDER.get(a.role)! - ROLE_ORDER.get(b.role)!) || a.cardId.localeCompare(b.cardId) || a.uid.localeCompare(b.uid));

/** «P84»; los extremos se dicen como tales («P>99», «P<1») en vez de redondear a P100/P0. */
export const pct = (p: number) => (p >= 99.5 ? "P>99" : p < 0.5 ? "P<1" : `P${Math.round(p)}`);
const fmt1 = (x: number) => (Math.round(x * 10) / 10).toLocaleString(getIntlLocale(), { maximumFractionDigits: 1 });

export function orientationOf(z: Record<Axis, number>): Orientation {
  const ranked = [...AXES].sort((a, b) => z[b] - z[a] || AXES.indexOf(a) - AXES.indexOf(b));
  const [a1, a2, a3] = ranked;
  const gapSd = finite(z[a1] - z[a2]);
  const spreadSd = finite(z[a1] - z[a3]);
  if (gapSd >= ORIENTED_GAP_SD) {
    return { kind: "ORIENTED", axes: [a1], weakest: a3, label: t("Orientado a {v}", { v: td(METRIC_LABEL[a1]) }), gapSd, spreadSd };
  }
  if (spreadSd < BALANCED_SPREAD_SD) {
    return { kind: "BALANCED", axes: [], weakest: null, label: t("Equilibrado"), gapSd, spreadSd };
  }
  return { kind: "MIXED", axes: [a1, a2], weakest: a3, label: t("Perfil mixto"), gapSd, spreadSd };
}

/** Frase de balance entre los tres ejes. */
export function balanceText(o: Orientation): string {
  if (o.kind === "BALANCED") return t("Perfil equilibrado: los tres ejes están a menos de media desviación típica entre sí.");
  if (o.kind === "ORIENTED") return t("{v} destaca; {v2} es el eje más débil.", { v: td(METRIC_LABEL[o.axes[0]]), v2: td(METRIC_LABEL[o.weakest!]) });
  return t("{v} y {v2} por encima de {v3}.", { v: td(METRIC_LABEL[o.axes[0]]), v2: td(METRIC_LABEL[o.axes[1]]), v3: td(METRIC_LABEL[o.weakest!]) });
}

function tukey(values: { uid: string; v: number }[], metric: Metric): Outlier[] {
  if (values.length < 4) return [];
  const sorted = values.map((x) => x.v).sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25); const q3 = quantile(sorted, 0.75); const iqr = q3 - q1;
  const lo = q1 - 1.5 * iqr; const hi = q3 + 1.5 * iqr;
  const out: Outlier[] = [];
  for (const x of values) {
    if (x.v < lo) out.push({ uid: x.uid, metric, direction: "LOW", value: x.v });
    else if (x.v > hi) out.push({ uid: x.uid, metric, direction: "HIGH", value: x.v });
  }
  return out;
}

export function analyzeDeck(input: readonly StrategyCard[], ctx: StrategyContext): DeckAnalysis {
  const cards = canonicalOrder(input);
  const count = cards.length;
  const complete = count === DUEL_DECK_SIZE;
  const roleDistribution = Object.fromEntries(DUEL_ROLES.map((r) => [r, cards.filter((c) => c.role === r).length])) as Record<RoleId, number>;
  const metrics = Object.fromEntries(METRICS.map((m) => [m, summarize(cards.map((c) => metricOf(c, m)))])) as Record<Metric, Summary>;
  const cal = ctx.calibration;
  const hasCal = cal.sample > 0;

  let deckPercentile: DeckAnalysis["deckPercentile"] = null;
  let catalogPercentile: DeckAnalysis["catalogPercentile"] = null;
  const refVersion = cards[0]?.dataVersion ?? ctx.catalog.dataVersion;
  const catalogSorted = ctx.catalog.sorted[refVersion] ?? ctx.catalog.sorted[ctx.catalog.dataVersion];
  let level: DeckAnalysis["level"] = null;
  let z: DeckAnalysis["z"] = null;
  let orientation: Orientation | null = null;
  let shape: Shape | null = null;
  let dispersionPercentile: number | null = null;
  if (complete && hasCal) {
    deckPercentile = Object.fromEntries(METRICS.map((m) => [m, percentileRank(cal.sorted[m], metrics[m].mean)])) as Record<Metric, number>;
    catalogPercentile = Object.fromEntries(METRICS.map((m) => [m, catalogSorted ? percentileRank(catalogSorted[m], metrics[m].mean) : 50])) as Record<Metric, number>;
    level = Object.fromEntries(METRICS.map((m) => [m, levelOf(catalogPercentile![m])])) as Record<Metric, Level>;
    z = Object.fromEntries(AXES.map((a) => [a, cal.sd[a] > 0 ? finite((metrics[a].mean - cal.mean[a]) / cal.sd[a]) : 0])) as Record<Axis, number>;
    orientation = orientationOf(z);
    dispersionPercentile = percentileRank(cal.ovrDispersion, metrics.ovr.sd);
    shape = dispersionPercentile >= POLARIZED_P ? "POLARIZED" : dispersionPercentile <= CONSISTENT_P ? "CONSISTENT" : "REGULAR";
  }

  // ── roles ──
  const roles: RoleProfile[] = DUEL_ROLES.map((role) => {
    const inRole = cards.filter((c) => c.role === role);
    const mean = Object.fromEntries(METRICS.map((m) => [m, inRole.length ? summarize(inRole.map((c) => metricOf(c, m))).mean : null])) as Record<Metric, number | null>;
    const mainAxis = inRole.length ? [...AXES].sort((a, b) => (mean[b]! - mean[a]!) || AXES.indexOf(a) - AXES.indexOf(b))[0] : null;
    const vsDeck = Object.fromEntries(METRICS.map((m) => [m, mean[m] === null ? null : mean[m]! - metrics[m].mean])) as Record<Metric, number | null>;
    return { role, count: inRole.length, uids: inRole.map((c) => c.uid), mean, mainAxis, ovrGap: inRole.length >= 2 ? Math.abs(inRole[0].ovr - inRole[1].ovr) : null, vsDeck };
  });

  // ── aportación de cada carta ──
  const sortedCatalog = catalogSorted;
  const contributions: CardContribution[] = cards.map((c) => {
    const partner = cards.find((o) => o.role === c.role && o.uid !== c.uid) ?? null;
    const values = Object.fromEntries(METRICS.map((m) => [m, metricOf(c, m)])) as Record<Metric, number>;
    const facts: string[] = [];
    if (count >= 2) {
      for (const m of METRICS) {
        const others = cards.filter((o) => o.uid !== c.uid).map((o) => metricOf(o, m));
        if (values[m] > Math.max(...others)) facts.push(t("Mayor {v} del equipo", { v: td(METRIC_LABEL[m]) }));
        else if (values[m] < Math.min(...others)) facts.push(t("Menor {v} del equipo", { v: td(METRIC_LABEL[m]) }));
      }
    }
    return {
      uid: c.uid, cardId: c.cardId, nick: c.nick, role: c.role, values,
      vsDeck: Object.fromEntries(METRICS.map((m) => [m, values[m] - metrics[m].mean])) as Record<Metric, number>,
      vsPartner: partner ? (Object.fromEntries(METRICS.map((m) => [m, values[m] - metricOf(partner, m)])) as Record<Metric, number>) : null,
      partnerUid: partner?.uid ?? null,
      catalogPercentile: Object.fromEntries(METRICS.map((m) => [m, sortedCatalog ? percentileRank(sortedCatalog[m], values[m]) : 50])) as Record<Metric, number>,
      facts,
    };
  });

  // ── valores atípicos ──
  const outliers: Outlier[] = [];
  for (const m of METRICS) outliers.push(...tukey(cards.map((c) => ({ uid: c.uid, v: metricOf(c, m) })), m));

  // ── fortalezas y debilidades (máx. 3, solo lo que es cierto) ──
  const strengths: Insight[] = [];
  const weaknesses: Insight[] = [];
  if (complete && catalogPercentile && level && orientation) {
    const cp = catalogPercentile;
    if (orientation.kind === "ORIENTED") {
      const a = orientation.axes[0];
      strengths.push({ id: `oriented-${a}`, metric: a, text: t("{v} destaca sobre los otros dos ejes (media en {v2} del catálogo).", { v: td(METRIC_LABEL[a]), v2: pct(cp[a]) }) });
    }
    for (const a of [...AXES].sort((x, y) => cp[y] - cp[x])) {
      if (level[a] === "ALTO" && !strengths.some((s) => s.metric === a)) strengths.push({ id: `high-${a}`, metric: a, text: t("{v} alto: la media está en {v2} de las cartas del catálogo.", { v: td(METRIC_LABEL[a]), v2: pct(cp[a]) }) });
    }
    if (level.ovr === "ALTO") strengths.push({ id: "high-ovr", metric: "ovr", text: t("OVR medio alto: {mean} ({ovr} del catálogo).", { mean: fmt1(metrics.ovr.mean), ovr: pct(cp.ovr) }) });
    if (shape === "CONSISTENT") strengths.push({ id: "consistent", metric: "ovr", text: t("Plantilla consistente: poca diferencia de OVR entre cartas ({v} de dispersión).", { v: pct(dispersionPercentile!) }) });

    if (orientation.weakest) {
      const w = orientation.weakest;
      weaknesses.push({ id: `weakest-${w}`, metric: w, text: t("{v} es tu eje más bajo (media en {v2} del catálogo).", { v: td(METRIC_LABEL[w]), v2: pct(cp[w]) }) });
    }
    for (const a of [...AXES].sort((x, y) => cp[x] - cp[y])) {
      if (level[a] === "BAJO" && !weaknesses.some((s) => s.metric === a)) weaknesses.push({ id: `low-${a}`, metric: a, text: t("{v} bajo: la media está en {v2} de las cartas del catálogo.", { v: td(METRIC_LABEL[a]), v2: pct(cp[a]) }) });
    }
    const focus = orientation.weakest;
    if (focus) {
      for (const r of roles) {
        if (r.count === 2 && r.uids.every((u) => metricOf(cards.find((c) => c.uid === u)!, focus) < metrics[focus].mean)) {
          weaknesses.push({ id: `role-${r.role}-${focus}`, metric: focus, uids: r.uids, text: t("Los dos {v} están por debajo de la media del equipo en {v2}.", { v: td(PLURAL[r.role]), v2: td(METRIC_LABEL[focus]) }) });
          break;
        }
      }
    }
    for (const o of outliers.filter((x) => x.metric === "ovr" && x.direction === "LOW")) {
      const c = cards.find((x) => x.uid === o.uid)!;
      weaknesses.push({ id: `outlier-${o.uid}`, metric: "ovr", uids: [o.uid], text: t("{nick} tiene un OVR muy por debajo del resto del equipo ({value}).", { nick: c.nick, value: o.value }) });
    }
    if (shape === "POLARIZED") weaknesses.push({ id: "polarized", metric: "ovr", text: t("Plantilla polarizada: mucha diferencia de OVR entre cartas ({v} de dispersión).", { v: pct(dispersionPercentile!) }) });
  }

  return {
    count, complete, roleDistribution, metrics, catalogPercentile, deckPercentile, level, z, orientation, shape, dispersionPercentile,
    strengths: strengths.slice(0, 3), weaknesses: weaknesses.slice(0, 3), outliers, roles, contributions,
  };
}
