/**
 * FASE 43 · SUGERENCIAS POR OBJETIVO (PURO, DETERMINISTA). Nunca «el mejor equipo»: un equipo LEGAL con cartas
 * POSEÍDAS que prioriza el objetivo que el jugador pide.
 *
 * DEFINICIÓN MATEMÁTICA
 *   Sea D un equipo legal (2 jugadores distintos por rol, una calibración) formado con ejemplares poseídos.
 *   · STRONGHOLD / GAMESENSE / ENTRYFRAG (eje X): maximizar, en orden lexicográfico,
 *       (Σ X, Σ OVR, Σ otros dos ejes) y, a igualdad, identificadores de definición ascendentes.
 *     Como el rol de un jugador es fijo, el problema se separa por rol: los 2 jugadores de mayor clave por rol son
 *     el óptimo EXACTO (verificado contra fuerza bruta en tests y en la simulación).
 *   · EQUILIBRADO: con z_a = (media_a(D) − μ_a) / σ_a frente a la calibración de equipos legales,
 *       sujeto a  media OVR(D) ≥ media OVR(D_ovr) − σ_OVR   (D_ovr = equipo de máxima Σ OVR; σ_OVR = desviación de
 *                                                          la media de OVR en equipos legales: «sin destruir el OVR»)
 *       minimizar  (max_a z_a − min_a z_a); a igualdad, maximizar min_a z_a; después Σ OVR.
 *     Si el espacio de equipos legales es ≤ 200.000, se ENUMERA entero (óptimo exacto). Si no, búsqueda acotada:
 *     66 pesos del símplex (paso 0,1) resueltos exactamente por rol + el equipo de máxima OVR +
 *     mejora local por sustitución 1×1 y, si no mejora, 2×1 (las dos cartas de un rol) hasta no mejorar (≤ 60 pasadas). Heurística determinista; su distancia al
 *     óptimo exacto se mide por fuerza bruta en colecciones pequeñas (simulación de sugerencias).
 *   · OPCIONES NO DOMINADAS (Pareto) en (Σ OVR, Σ SH, Σ GS, Σ EF) entre los equipos de los objetivos y de la rejilla.
 *
 * No leen: serial, rareza, variante como poder, equipo, región, edición, favoritos, valor de mercado ni nada del rival.
 */
import type { RoleId } from "@/domain/cards/types";
import { DUEL_COMPOSITION, DUEL_ROLES } from "@/domain/cardgame/types";
import { checkDraft, type Pool } from "@/domain/deckBuilder/builder";
import { AXES, METRIC_LABEL, type Axis, type StrategyContext } from "./catalog";
import { analyzeDeck, canonicalOrder, type DeckAnalysis, type StrategyCard } from "./analysis";
import { ns, td } from "@/i18n/runtime";

const tr = ns("deckStrategy");

export type SuggestObjective = "BALANCED" | Axis;
export const OBJECTIVES: readonly SuggestObjective[] = ["BALANCED", "stronghold", "gamesense", "entryfrag"];
export const OBJECTIVE_LABEL: Record<SuggestObjective, string> = {
  BALANCED: "Equilibrado", stronghold: "Priorizar Stronghold", gamesense: "Priorizar Gamesense", entryfrag: "Priorizar Entryfrag",
};

export interface Totals { ovr: number; stronghold: number; gamesense: number; entryfrag: number }

export interface Suggestion {
  objective: SuggestObjective;
  ok: boolean;
  reason: string | null;
  uids: string[];
  cards: StrategyCard[];
  totals: Totals | null;
  analysis: DeckAnalysis | null;
  /** Qué se ha maximizado, en una frase. */
  rule: string;
  explored: number;
}

const strat = (c: StrategyCard): StrategyCard => ({ uid: c.uid, cardId: c.cardId, playerId: c.playerId, nick: c.nick, role: c.role, ovr: c.ovr, combat: c.combat, dataVersion: c.dataVersion });

export const totalsOf = (cards: readonly StrategyCard[]): Totals =>
  cards.reduce((t, c) => ({ ovr: t.ovr + c.ovr, stronghold: t.stronghold + c.combat.stronghold, gamesense: t.gamesense + c.combat.gamesense, entryfrag: t.entryfrag + c.combat.entryfrag }), { ovr: 0, stronghold: 0, gamesense: 0, entryfrag: 0 });

/** Jugadores por rol dentro de una calibración: cada jugador con sus DEFINICIONES distintas (una copia por definición, uid menor). */
type Groups = Map<string, Record<RoleId, StrategyCard[][]>>;

export function groupPool(pool: Pool): Groups {
  const byDef = new Map<string, StrategyCard>();
  for (const c of pool.values()) {
    const prev = byDef.get(`${c.dataVersion}|${c.cardId}`);
    if (!prev || c.uid.localeCompare(prev.uid) < 0) byDef.set(`${c.dataVersion}|${c.cardId}`, strat(c));
  }
  const groups: Groups = new Map();
  const players = new Map<string, StrategyCard[]>();
  for (const c of byDef.values()) players.set(`${c.dataVersion}|${c.playerId}`, [...(players.get(`${c.dataVersion}|${c.playerId}`) ?? []), c]);
  for (const [key, list] of [...players.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const version = key.split("|")[0];
    if (!groups.has(version)) groups.set(version, Object.fromEntries(DUEL_ROLES.map((r) => [r, [] as StrategyCard[][]])) as Record<RoleId, StrategyCard[][]>);
    list.sort((a, b) => a.cardId.localeCompare(b.cardId));
    /*
     * Con el catálogo diseñado (2026-09-21) el rol es de la CARTA y un jugador puede tener cartas de
     * varios roles. El óptimo de abajo es SEPARABLE por rol, y sólo lo es si cada jugador está en UN
     * rol: se le asigna el de su mejor carta (mayor OVR; empate por id) y entra con sus cartas de ese
     * rol. Límite declarado: la sugerencia no explora usarlo en su otro rol.
     */
    const mejor = [...list].sort((a, b) => b.ovr - a.ovr || a.cardId.localeCompare(b.cardId))[0];
    const deSuRol = list.filter((c) => c.role === mejor.role);
    groups.get(version)![mejor.role].push(deSuRol);
  }
  return groups;
}

const feasible = (g: Record<RoleId, StrategyCard[][]>) => DUEL_ROLES.every((r) => g[r].length >= DUEL_COMPOSITION[r]);

type Key = (c: StrategyCard) => number[];
const cmpKey = (a: number[], b: number[]) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return b[i] - a[i]; return 0; };

/** Óptimo separable: por rol, los jugadores con mayor clave (la mejor definición de cada jugador). Recorrido lineal. */
function pickByKey(g: Record<RoleId, StrategyCard[][]>, key: Key): StrategyCard[] {
  const out: StrategyCard[] = [];
  const beats = (a: StrategyCard, ka: number[], b: StrategyCard, kb: number[]) => { const c = cmpKey(ka, kb); return c < 0 || (c === 0 && a.cardId.localeCompare(b.cardId) < 0); };
  for (const role of DUEL_ROLES) {
    const need = DUEL_COMPOSITION[role];
    const top: { c: StrategyCard; k: number[] }[] = [];
    for (const defs of g[role]) {
      let best = defs[0]; let bk = key(best);
      for (let i = 1; i < defs.length; i++) { const k = key(defs[i]); if (beats(defs[i], k, best, bk)) { best = defs[i]; bk = k; } }
      let pos = top.length;
      while (pos > 0 && beats(best, bk, top[pos - 1].c, top[pos - 1].k)) pos--;
      if (pos < need) { top.splice(pos, 0, { c: best, k: bk }); if (top.length > need) top.pop(); }
    }
    out.push(...top.map((t) => t.c));
  }
  return out;
}

const cmpLex = (a: readonly StrategyCard[], b: readonly StrategyCard[]) => {
  const ia = canonicalOrder(a).map((c) => c.cardId).join(","); const ib = canonicalOrder(b).map((c) => c.cardId).join(",");
  return ia < ib ? -1 : ia > ib ? 1 : 0;
};

export function axisKey(axis: Axis): Key {
  return (c) => [c.combat[axis], c.ovr, AXES.filter((a) => a !== axis).reduce((s, a) => s + c.combat[a], 0)];
}

/** Valor del objetivo EQUILIBRADO: [cumple el suelo de OVR, −spread z, min z, Σ OVR] (mayor es mejor, lexicográfico). */
export function balancedValue(cards: readonly StrategyCard[], ctx: StrategyContext, ovrFloor = -Infinity): number[] {
  const t = totalsOf(cards);
  const n = cards.length || 1;
  const cal = ctx.calibration;
  const z = AXES.map((a) => (cal.sd[a] > 0 ? (t[a] / n - cal.mean[a]) / cal.sd[a] : 0));
  return [t.ovr / n >= ovrFloor - EPS ? 1 : 0, -(Math.max(...z) - Math.min(...z)), Math.min(...z), t.ovr];
}

/** Equipo de máxima Σ OVR (a igualdad, suma de los tres ejes) — referencia del suelo de OVR. */
const OVR_KEY: Key = (c) => [c.ovr, c.combat.stronghold + c.combat.gamesense + c.combat.entryfrag];
export const ovrFloorFor = (maxOvrDeck: readonly StrategyCard[], ctx: StrategyContext): number =>
  (maxOvrDeck.length ? totalsOf(maxOvrDeck).ovr / maxOvrDeck.length : 0) - ctx.calibration.sd.ovr;

const EPS = 1e-9;
const better = (a: number[], b: number[]) => { for (let i = 0; i < a.length; i++) { if (a[i] > b[i] + EPS) return true; if (a[i] < b[i] - EPS) return false; } return false; };

export const SIMPLEX_STEP = 0.1;
export function simplexWeights(step = SIMPLEX_STEP): [number, number, number][] {
  const k = Math.round(1 / step); const out: [number, number, number][] = [];
  for (let i = 0; i <= k; i++) for (let j = 0; j <= k - i; j++) out.push([i / k, j / k, (k - i - j) / k]);
  return out;
}

/** Tope de equipos legales para resolver EQUILIBRADO por enumeración exacta (colecciones pequeñas). */
export const BALANCED_EXACT_LIMIT = 200_000;

type Pair = { cards: [StrategyCard, StrategyCard]; t: Totals };
function rolePairs(g: Record<RoleId, StrategyCard[][]>, role: RoleId): Pair[] {
  const ps = g[role]; const out: Pair[] = [];
  for (let x = 0; x < ps.length; x++) for (let y = x + 1; y < ps.length; y++) for (const a of ps[x]) for (const b of ps[y]) out.push({ cards: [a, b], t: totalsOf([a, b]) });
  return out;
}

/** Enumeración EXACTA del objetivo equilibrado (sumas por rol precalculadas). `null` si el espacio supera el tope. */
function balancedExact(g: Record<RoleId, StrategyCard[][]>, ctx: StrategyContext, floor: number, counter: { n: number }): StrategyCard[] | null {
  const pairs = DUEL_ROLES.map((r) => rolePairs(g, r));
  if (pairs.reduce((p, x) => p * Math.max(1, x.length), 1) > BALANCED_EXACT_LIMIT) return null;
  const cal = ctx.calibration;
  let best: Pair[] | null = null; let bestV: number[] = [];
  const chosen: Pair[] = [];
  const rec = (ri: number, t: Totals) => {
    if (ri === DUEL_ROLES.length) {
      counter.n++;
      const z = AXES.map((a) => (cal.sd[a] > 0 ? (t[a] / 10 - cal.mean[a]) / cal.sd[a] : 0));
      const v = [t.ovr / 10 >= floor - EPS ? 1 : 0, -(Math.max(...z) - Math.min(...z)), Math.min(...z), t.ovr];
      if (!best || better(v, bestV)) { best = [...chosen]; bestV = v; }
      return;
    }
    for (const p of pairs[ri]) {
      chosen.push(p);
      rec(ri + 1, { ovr: t.ovr + p.t.ovr, stronghold: t.stronghold + p.t.stronghold, gamesense: t.gamesense + p.t.gamesense, entryfrag: t.entryfrag + p.t.entryfrag });
      chosen.pop();
    }
  };
  rec(0, { ovr: 0, stronghold: 0, gamesense: 0, entryfrag: 0 });
  return best ? (best as Pair[]).flatMap((p) => p.cards) : null;
}

function balancedFor(g: Record<RoleId, StrategyCard[][]>, ctx: StrategyContext, counter: { n: number }): StrategyCard[] {
  const cal = ctx.calibration;
  const maxOvr = pickByKey(g, OVR_KEY);
  const floor = ovrFloorFor(maxOvr, ctx);
  const exact = balancedExact(g, ctx, floor, counter);
  if (exact) return exact;
  let best: StrategyCard[] | null = null; let bestV: number[] = [];
  const starts = [maxOvr, ...simplexWeights().map((w) => pickByKey(g, (c) => [AXES.reduce((s, a, i) => s + (w[i] * c.combat[a]) / (cal.sd[a] || 1), 0), c.ovr]))];
  for (const deck of starts) {
    counter.n++;
    const v = balancedValue(deck, ctx, floor);
    if (!best || better(v, bestV) || (!better(bestV, v) && cmpLex(deck, best) < 0)) { best = deck; bestV = v; }
  }
  // Mejora local 1×1 (jugador distinto del mismo rol).
  for (let pass = 0; pass < 60 && best; pass++) {
    let move: { deck: StrategyCard[]; v: number[] } | null = null;
    const inDeck = new Set(best.map((c) => c.playerId));
    for (let i = 0; i < best.length; i++) {
      for (const defs of g[best[i].role]) {
        if (inDeck.has(defs[0].playerId)) continue;
        for (const d of defs) {
          const deck = best.map((c, k) => (k === i ? d : c)); counter.n++;
          const v = balancedValue(deck, ctx, floor);
          if (better(v, move?.v ?? bestV)) move = { deck, v };
        }
      }
    }
    if (!move) {
      // Movimiento 2×1: sustituir A LA VEZ las dos cartas de un rol (sale de mínimos locales del 1×1).
      for (const role of DUEL_ROLES) {
        const idx = best.map((c, k) => (c.role === role ? k : -1)).filter((k) => k >= 0);
        const others = new Set(best.filter((c) => c.role !== role).map((c) => c.playerId));
        const ps = g[role].filter((defs) => !others.has(defs[0].playerId));
        for (let x = 0; x < ps.length; x++) for (let y = x + 1; y < ps.length; y++) for (const d1 of ps[x]) for (const d2 of ps[y]) {
          const deck = best.map((c, k) => (k === idx[0] ? d1 : k === idx[1] ? d2 : c)); counter.n++;
          const v = balancedValue(deck, ctx, floor);
          if (better(v, move?.v ?? bestV)) move = { deck, v };
        }
      }
    }
    if (!move) break;
    best = move.deck; bestV = move.v;
  }
  return best ?? [];
}

const RULE: Record<SuggestObjective, string> = {
  BALANCED: "Minimiza la distancia entre los tres ejes (en desviaciones típicas de equipos legales) sin bajar el OVR medio más de una desviación típica respecto a tu equipo de máxima OVR.",
  stronghold: "Maximiza la suma de Stronghold; a igualdad, OVR y después los otros ejes.",
  gamesense: "Maximiza la suma de Gamesense; a igualdad, OVR y después los otros ejes.",
  entryfrag: "Maximiza la suma de Entryfrag; a igualdad, OVR y después los otros ejes.",
};

export function suggestDeck(pool: Pool, objective: SuggestObjective, ctx: StrategyContext): Suggestion {
  const counter = { n: 0 };
  let best: { cards: StrategyCard[]; v: number[] } | null = null;
  for (const [, g] of [...groupPool(pool).entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!feasible(g)) continue;
    const cards = objective === "BALANCED" ? balancedFor(g, ctx, counter) : pickByKey(g, axisKey(objective));
    if (objective !== "BALANCED") counter.n++;
    const t = totalsOf(cards);
    const v = objective === "BALANCED" ? balancedValue(cards, ctx, ovrFloorFor(pickByKey(g, OVR_KEY), ctx)) : [t[objective], t.ovr, AXES.filter((a) => a !== objective).reduce((s, a) => s + t[a], 0)];
    if (!best || better(v, best.v)) best = { cards, v };
  }
  const empty = { objective, uids: [], cards: [], totals: null, analysis: null, rule: RULE[objective], explored: counter.n };
  if (!best) return { ...empty, ok: false, reason: tr("No tienes cartas suficientes de todos los roles para un equipo legal.") };
  const cards = canonicalOrder(best.cards);
  const uids = cards.map((c) => c.uid);
  // Red de seguridad: lo que sale lo firma el validador canónico.
  if (!checkDraft(uids, pool).ready) return { ...empty, ok: false, reason: tr("No se pudo formar un equipo legal con tus cartas.") };
  return { objective, ok: true, reason: null, uids, cards, totals: totalsOf(cards), analysis: analyzeDeck(cards, ctx), rule: RULE[objective], explored: counter.n };
}

/* ───────────────────────────── opciones no dominadas ───────────────────────────── */

export interface ParetoOption { uids: string[]; cards: StrategyCard[]; totals: Totals; labels: string[] }

const dominates = (a: Totals, b: Totals) =>
  (a.ovr >= b.ovr && a.stronghold >= b.stronghold && a.gamesense >= b.gamesense && a.entryfrag >= b.entryfrag) &&
  (a.ovr > b.ovr || a.stronghold > b.stronghold || a.gamesense > b.gamesense || a.entryfrag > b.entryfrag);

export function paretoOptions(pool: Pool, ctx: StrategyContext, max = 5): ParetoOption[] {
  const decks: StrategyCard[][] = [];
  let floor = -Infinity;
  for (const [, g] of [...groupPool(pool).entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!feasible(g)) continue;
    floor = Math.max(floor, ovrFloorFor(pickByKey(g, OVR_KEY), ctx));
    decks.push(pickByKey(g, OVR_KEY));
    for (const a of AXES) decks.push(pickByKey(g, axisKey(a)));
    decks.push(balancedFor(g, ctx, { n: 0 }));
    for (const w of simplexWeights(0.25)) decks.push(pickByKey(g, (c) => [AXES.reduce((s, a, i) => s + w[i] * c.combat[a], 0), c.ovr]));
  }
  const seen = new Set<string>();
  const uniq = decks.map(canonicalOrder).filter((d) => { const k = d.map((c) => c.uid).join(","); if (seen.has(k)) return false; seen.add(k); return true; });
  const withT = uniq.map((cards) => ({ cards, totals: totalsOf(cards) }));
  const front = withT.filter((x) => !withT.some((y) => y !== x && dominates(y.totals, x.totals)));
  const bal = (x: { cards: StrategyCard[] }) => balancedValue(x.cards, ctx, floor);
  const picks: { cards: StrategyCard[]; totals: Totals; label: string }[] = [];
  const add = (label: string, cmp: (a: typeof front[number], b: typeof front[number]) => number) => {
    const top = [...front].sort((a, b) => cmp(a, b) || cmpLex(a.cards, b.cards))[0];
    if (top) picks.push({ ...top, label });
  };
  add(tr("Más OVR"), (a, b) => b.totals.ovr - a.totals.ovr);
  for (const ax of AXES) add(tr("Más {eje}", { eje: td(METRIC_LABEL[ax]) }), (a, b) => b.totals[ax] - a.totals[ax]);
  add(tr("Más equilibrado"), (a, b) => (better(bal(a), bal(b)) ? -1 : better(bal(b), bal(a)) ? 1 : 0));
  const merged = new Map<string, ParetoOption>();
  for (const p of picks) {
    const k = p.cards.map((c) => c.uid).join(",");
    const prev = merged.get(k);
    if (prev) prev.labels.push(p.label);
    else merged.set(k, { uids: p.cards.map((c) => c.uid), cards: p.cards, totals: p.totals, labels: [p.label] });
  }
  return [...merged.values()].slice(0, max);
}
