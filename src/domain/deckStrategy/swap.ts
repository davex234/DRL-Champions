/**
 * FASE 43 · CAMBIOS DE CARTA (PURO) — «si meto esta, ¿qué cambia?».
 *
 * LEGALIDAD PRIMERO: una alternativa solo existe si `tryReplace` del constructor —que ejecuta EL validador canónico
 * `validateDuelDeck` (rol, tamaño, carta y jugador únicos, propiedad, calibración)— la acepta. Aquí no se reimplementa
 * ninguna regla. Solo cartas del `pool` (la colección del propio jugador): son las únicas accionables.
 *
 * INSTANCIAS: varias copias de la misma definición son UNA opción (mismas estadísticas); se representa con el uid
 * menor. El serial nunca interviene.
 *
 * DELTAS EXACTOS: medias del equipo después − antes, calculadas con las cartas presentes. La pantalla redondea.
 */
import { tryReplace, checkDraft, draftCards, type Pool } from "@/domain/deckBuilder/builder";
import { AXES, METRICS, METRIC_LABEL, metricOf, type Axis, type Metric, type StrategyContext } from "./catalog";
import { analyzeDeck, type DeckAnalysis, type OrientationKind, type StrategyCard } from "./analysis";

export type MetricDelta = Record<Metric, number>;

export interface SwapImpact {
  before: Record<Metric, number>;
  after: Record<Metric, number>;
  delta: MetricDelta;
  /** Estadística de la carta nueva − la de la sustituida. */
  cardDelta: MetricDelta;
  orientationBefore: { kind: OrientationKind; label: string } | null;
  orientationAfter: { kind: OrientationKind; label: string } | null;
  identityChanged: boolean;
  /** Distancia entre el eje más alto y el más bajo (desviaciones típicas), antes y después. */
  spreadBefore: number | null;
  spreadAfter: number | null;
  /** Frases de encaje, factuales (máx. 3). */
  fit: string[];
  noChange: boolean;
}

export interface SwapAlternative {
  card: StrategyCard;
  /** Todas las copias poseídas de esta definición (misma opción). */
  copies: string[];
  impact: SwapImpact;
  nextUids: string[];
}

const toStrategy = (c: StrategyCard): StrategyCard => ({ uid: c.uid, cardId: c.cardId, playerId: c.playerId, nick: c.nick, role: c.role, ovr: c.ovr, combat: c.combat, dataVersion: c.dataVersion });

const means = (cards: readonly StrategyCard[]): Record<Metric, number> =>
  Object.fromEntries(METRICS.map((m) => [m, cards.length ? cards.reduce((s, c) => s + metricOf(c, m), 0) / cards.length : 0])) as Record<Metric, number>;

const signs = (d: number) => (d > 0 ? "sube" : d < 0 ? "baja" : "igual");

export function fitSentences(current: StrategyCard, candidate: StrategyCard, before: DeckAnalysis): string[] {
  const out: string[] = [];
  const up = AXES.filter((a) => candidate.combat[a] > current.combat[a]).map((a) => METRIC_LABEL[a]);
  const down = AXES.filter((a) => candidate.combat[a] < current.combat[a]).map((a) => METRIC_LABEL[a]);
  const join = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`);
  if (up.length && down.length) out.push(`Sube ${join(up)}, pero reduce ${join(down)}.`);
  else if (up.length) out.push(`Sube ${join(up)}.`);
  else if (down.length) out.push(`Reduce ${join(down)}.`);
  else out.push("Mismos valores en los tres ejes.");
  const weakest = before.orientation?.weakest ?? null;
  if (weakest && candidate.combat[weakest] > current.combat[weakest]) out.push(`Mejora el eje más débil del equipo (${METRIC_LABEL[weakest]}).`);
  const order = (c: StrategyCard) => [...AXES].sort((a, b) => c.combat[b] - c.combat[a] || AXES.indexOf(a) - AXES.indexOf(b)).join(">");
  if (order(current) === order(candidate)) out.push(`Mantiene el mismo orden de ejes que ${current.nick}.`);
  return out.slice(0, 3);
}

export function swapImpact(deck: readonly StrategyCard[], currentUid: string, candidate: StrategyCard, ctx: StrategyContext, before?: DeckAnalysis): SwapImpact {
  const current = deck.find((c) => c.uid === currentUid)!;
  const next = deck.map((c) => (c.uid === currentUid ? toStrategy(candidate) : c));
  const a0 = before ?? analyzeDeck(deck, ctx);
  const a1 = analyzeDeck(next, ctx);
  const mb = means(deck); const ma = means(next);
  const delta = Object.fromEntries(METRICS.map((m) => [m, ma[m] - mb[m]])) as MetricDelta;
  const cardDelta = Object.fromEntries(METRICS.map((m) => [m, metricOf(candidate, m) - metricOf(current, m)])) as MetricDelta;
  const o0 = a0.orientation ? { kind: a0.orientation.kind, label: a0.orientation.label } : null;
  const o1 = a1.orientation ? { kind: a1.orientation.kind, label: a1.orientation.label } : null;
  return {
    before: mb, after: ma, delta, cardDelta,
    orientationBefore: o0, orientationAfter: o1,
    identityChanged: (o0?.label ?? null) !== (o1?.label ?? null),
    spreadBefore: a0.orientation?.spreadSd ?? null,
    spreadAfter: a1.orientation?.spreadSd ?? null,
    fit: fitSentences(current, candidate, a0),
    noChange: METRICS.every((m) => cardDelta[m] === 0),
  };
}

export type AlternativeSort = "ovr" | Axis;

/**
 * Alternativas LEGALES y POSEÍDAS para el hueco de `slotUid`. Una por definición. Orden explícito (no «la mejor»):
 * por el delta del eje elegido (por defecto OVR), después nick y uid. `limit` acota la lista.
 */
export function swapAlternatives(uids: readonly string[], slotUid: string, pool: Pool, ctx: StrategyContext, opts: { sort?: AlternativeSort; limit?: number } = {}): SwapAlternative[] {
  const current = pool.get(slotUid);
  if (!current || !uids.includes(slotUid)) return [];
  const deck = draftCards(uids, pool).map(toStrategy);
  const before = analyzeDeck(deck, ctx);
  const check = checkDraft(uids, pool);
  const byDef = new Map<string, StrategyCard[]>();
  for (const c of pool.values()) {
    if (c.role !== current.role || c.cardId === current.cardId || uids.includes(c.uid)) continue;
    byDef.set(c.cardId, [...(byDef.get(c.cardId) ?? []), c]);
  }
  const out: SwapAlternative[] = [];
  for (const copies of byDef.values()) {
    const sorted = [...copies].sort((a, b) => a.uid.localeCompare(b.uid));
    const rep = sorted[0];
    const r = tryReplace(uids, slotUid, rep.uid, pool, check);
    if (!r.ok) continue;
    out.push({ card: toStrategy(rep), copies: sorted.map((c) => c.uid), impact: swapImpact(deck, slotUid, rep, ctx, before), nextUids: r.uids });
  }
  const key = opts.sort ?? "ovr";
  out.sort((a, b) => b.impact.delta[key] - a.impact.delta[key] || a.card.nick.localeCompare(b.card.nick, "es") || a.card.uid.localeCompare(b.card.uid));
  return opts.limit ? out.slice(0, opts.limit) : out;
}

/** «+3», «−2», «=» con un decimal si hace falta. El signo va en texto. */
export function signedText(d: number, decimals = 1): string {
  const r = Math.round(d * 10 ** decimals) / 10 ** decimals;
  const abs = Math.abs(r).toLocaleString("es-ES", { maximumFractionDigits: decimals });
  return r > 0 ? `+${abs}` : r < 0 ? `−${abs}` : "=";
}

/** «Gamesense sube 0,3», para lectores de pantalla. */
export function deltaAria(m: Metric, d: number): string {
  const r = Math.round(d * 10) / 10;
  return r === 0 ? `${METRIC_LABEL[m]} sin cambios` : `${METRIC_LABEL[m]} ${signs(r)} ${Math.abs(r).toLocaleString("es-ES")}`;
}

/**
 * Comparación INFORMATIVA con una definición que NO se posee: mismos deltas, pero nunca accionable (sin `nextUids`).
 */
export function informativeImpact(deck: readonly StrategyCard[], currentUid: string, definition: StrategyCard, ctx: StrategyContext): SwapImpact & { actionable: false } {
  return { ...swapImpact(deck, currentUid, { ...definition, uid: `def:${definition.cardId}` }, ctx), actionable: false };
}
