/**
 * PROBABILIDADES COMPRENSIBLES DE UN SOBRE (Fase 25) — funciones PURAS.
 *
 * ────────────────────────── DE DÓNDE SALEN ──────────────────────────
 *
 * El motor no tiene «Legendaria 1 %»: tiene pesos por rareza (`PackDef.weights`), pools con
 * pesos por carta, garantías en la última carta (`guaranteedMin`) y pity. La única cifra
 * honesta por rareza es la MEDIDA: `packStats(packId).drawn` (20 000 aperturas con el motor
 * real, revalidada en `packStats.test.ts`). Este módulo no vuelve a tirar nada: toma esa
 * distribución por carta y la traduce a lo que un jugador entiende:
 *
 *   · por carta      → «de cada 100 cartas, N son épicas»          (medido)
 *   · por sobre      → «al menos una épica en el sobre: X %»      (derivado del medido)
 *   · garantía       → «garantiza al menos una rara»              (dato del catálogo)
 *   · equipo         → «probabilidad aumentada, no garantía»       (dato: el motor no conoce
 *                       el equipo; el boost vive en un pool con peso 5 frente a 1)
 *
 * «Al menos una» se deriva como 1 − (1 − p)^n tratando las cartas como independientes. Las
 * garantías rompen esa independencia en la última carta, así que la cifra se etiqueta como
 * aproximada y, cuando el sobre garantiza una rareza, se dice 100 % para ella y sus inferiores
 * NO se tocan (la garantía es un mínimo, no una promesa de cada rareza).
 *
 * Si no hay medición para el sobre, se cae a los pesos declarados normalizados y se marca
 * `source: "weights"`: sigue siendo la misma matemática del motor, sin garantías ni pools.
 */
import type { PackDef, RarityBucket } from "./types";
import { packPowerCap, type PackPowerCap } from "./power";
import { BUCKET_LABEL } from "./types";
import {
  effectiveFeatured, guaranteedIcons, iconChanceOf, packDistribution, packPlan, planTemplate, featuredGuarantee, classGuarantee, MAIN_PACK_LINE, packCardClass, PACK_CLASS_ORDER, PACK_CLASS_LABEL, PACK_CLASS_SCOPE,
  type PackCardClass,
} from "./packClass";
import { tierIdentity, type ClassPools } from "./tierIdentity";
import { CARDS, getPlayer } from "@/data/catalog";
import { activeIconQuality, iconValueLevels, ICON_QUALITY_PACKS, type IconQualityTable } from "./iconQuality";
import { marketValue } from "@/domain/economy/pricing";
import { getPack } from "@/data/packs";
import { packClassPools } from "./packPools";
import { ns, td, tdIn, getIntlLocale, getLocale } from "@/i18n/runtime";

const tr = ns("packs");

export const BUCKET_ORDER: RarityBucket[] = ["common", "uncommon", "rare", "epic", "legendary"];

export interface OddsRow {
  bucket: RarityBucket;
  label: string;
  /** Probabilidad por carta (0..1). */
  perCard: number;
  /** Probabilidad de que el sobre traiga AL MENOS una (0..1), aproximada. */
  atLeastOne: number;
  /** El catálogo garantiza al menos una carta de esta rareza o superior en el sobre. */
  guaranteed: boolean;
  /** No hay cartas de esta rareza para este sobre: nunca sale. */
  impossible: boolean;
}

export interface PackOdds {
  packId: string;
  cardCount: number;
  source: "measured" | "weights";
  rows: OddsRow[];
  /** Rareza mínima garantizada (última carta), si el catálogo la declara. */
  guaranteedMin: RarityBucket | null;
  /** Texto corto y honesto para el sobre de equipo, o null si no es de equipo. */
  teamBoost: { team: string; copy: string } | null;
  /** Hotfix 57.2 · techo de poder (`PACK_POWER_RULES`), o null si el sobre no tiene regla (hoy, ninguno). */
  powerCap: PackPowerCap | null;
  /**
   * Fase 57.3 · línea principal (Bronce, Plata, Oro, Masters, Champions, Icon): la tabla por clase que decide el sorteo.
   * Si existe, `rows` va vacío: la rareza no gobierna el producto y no se enseña.
   */
  classOdds: ClassOdds | null;
}

export interface ClassOddsRow {
  cls: PackCardClass;
  label: string;
  /** Qué ediciones/OVR entran en la clase. */
  scope: string;
  /** Probabilidad media por carta (0..1): promedio exacto de las ranuras del sobre. */
  perCard: number;
  /** Al menos una en el sobre (0..1). Exacta: 1 − (1 − normal)^(cartas − 1) · (1 − destacada). */
  atLeastOne: number;
}

/** Pack Opening 3.0 · lo que la ficha cuenta del reparto por ranuras y de la mejor carta (todo exacto, mismo plan). */
export interface ClassOddsSlots {
  /** Huecos normales (cartas − 1) y su tabla por clase (0..1). */
  regular: { count: number; rows: { cls: PackCardClass; label: string; p: number }[] };
  /** La ranura destacada (el último hueco) y su tabla por clase (0..1). */
  featured: { rows: { cls: PackCardClass; label: string; p: number }[] };
  /** λ de la inclinación por OVR dentro de cada clase (0 = uniforme). */
  ovrTilt: number;
  /** Probabilidad EXACTA por sobre de que la mejor carta tenga al menos ese OVR (0..1). */
  bestAtLeast: { ovr90: number; ovr93: number; ovr95: number };
}

/**
 * ICON POR SOBRE (2026-10-09) · lo que la ficha dice de la Icon, derivado del plan que sortea el servidor
 * (`iconChanceBp`) y del pool real del sobre. Nada escrito a mano.
 */
export interface IconOdds {
  /** Probabilidad EXACTA de al menos una Icon en el sobre (0..1). */
  atLeastOne: number;
  /** Todas las cartas del sobre son Icon (sobres ICON). */
  guaranteed: boolean;
  /** Cuántas Icon trae seguro (1 en `icon-single`, 3 en `icon`, 0 en el resto). */
  count: number;
  /** Sobres ICON de varias cartas: P(al menos una de la Icon de más OVR), exacta. */
  top: { ovr: number; atLeastOne: number } | null;
  /** La frase de la ficha. */
  text: string;
  /** Solo si `guaranteed`: probabilidad EXACTA de cada Icon POR CARTA (de menor a mayor valor). */
  cards: { cardId: string; label: string; ovr: number; value: number; p: number }[];
  /** Las Icon de menor valor son estrictamente más probables (solo entonces se afirma en la ficha). */
  favorsLowValue: boolean;
  /** La tabla de calidad APROBADA y su metodología, o `null` mientras esté pendiente. */
  quality: { table: IconQualityTable; levels: { value: number; p: number; cards: number }[]; method: string } | null;
}

export interface ClassOdds {
  rows: ClassOddsRow[];
  /** Icon por sobre, o `null` si el sobre no la fija por sobre (especiales: la Icon sale por su tabla). */
  icon: IconOdds | null;
  /** Solo si el sobre la cumple por construcción (Icon: «Icon garantizada»). */
  guarantee: string | null;
  /** Pack Opening 3.0 · ranuras, inclinación y mejor carta (exacto). */
  slots: ClassOddsSlots;
}

/**
 * Pools por clase de la línea principal: el catálogo agrupado por `packCardClass`. Es exactamente el pool de estos seis
 * sobres (en código no tienen restricciones y en producción su pool `pack-<id>` es el catálogo entero con peso 1; lo
 * comprueba `tierIdentity.test.ts` contra `classPool`).
 */
let MAIN_POOLS: ClassPools | null = null;
export function mainLinePools(): ClassPools {
  if (MAIN_POOLS) return MAIN_POOLS;
  const out = Object.fromEntries(PACK_CLASS_ORDER.map((c) => [c, [] as typeof CARDS])) as Record<PackCardClass, typeof CARDS>;
  for (const c of CARDS) { const k = packCardClass(c); if (k) out[k].push(c); }
  return (MAIN_POOLS = out);
}

const IDENTITY_CACHE = new Map<string, ClassOddsSlots>();

/** Porcentaje de una tabla/media con un decimal y coma (62,6 %, 0,3 %): nunca se redondea a «0 %» ni a «<1 %». */
export function tablePct(p: number): string {
  return `${(Math.round(p * 1000) / 10).toLocaleString(getIntlLocale())} %`;
}
/** Probabilidad exacta pequeña con dos cifras útiles (0,31 %, 8,2 %, 62 %). */
export function finePct(p: number): string {
  const v = p * 100;
  const r = v >= 10 ? Math.round(v) : v >= 1 ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100;
  return `${r.toLocaleString(getIntlLocale())} %`;
}
/** Las tres frases de ranuras y mejor carta que enseñan la ficha y el detalle de compra (mismo texto, mismo cálculo). */
export function slotLines(slots: ClassOddsSlots): { regular: string | null; featured: string; best: string; tilt: string | null } {
  return {
    // Un sobre de 1 carta (Icon) no tiene huecos normales: no se enseña una línea vacía.
    regular: slots.regular.count === 0 ? null : `${slots.regular.count} ${slots.regular.count === 1 ? tr("carta normal") : tr("cartas normales")}: ${slots.regular.rows.map((r) => `${tdIn("packs", r.label)} ${tablePct(r.p)}`).join(" · ")}`,
    featured: tr("Carta destacada (1 por sobre): {v}", { v: slots.featured.rows.map((r) => `${tdIn("packs", r.label)} ${tablePct(r.p)}`).join(" · ") }),
    best: tr("Mejor carta del sobre: OVR 90+ {ovr90} · 93+ {ovr93} · 95 {ovr95}", { ovr90: finePct(slots.bestAtLeast.ovr90), ovr93: finePct(slots.bestAtLeast.ovr93), ovr95: finePct(slots.bestAtLeast.ovr95) }),
    tilt: slots.ovrTilt > 0 ? tr("Dentro de cada clase, en este sobre las cartas de OVR más alto son menos probables; todas pueden salir.") : null,
  };
}

/**
 * La ficha por clase de un sobre con plan (línea principal y, desde Pack Opening 3.1, regionales, de equipo y EWC), o
 * null. Deriva SOLO del plan (`packPlan`) y del pool REAL del sobre con sus pesos (`packClassPools`): lo que sortea el
 * servidor.
 */
export function classOddsFor(pack: Pick<PackDef, "id" | "cardCount">): ClassOdds | null {
  const table = packDistribution(pack.id);
  const plan = packPlan(pack.id);
  if (!table || !plan) return null;
  const feat = effectiveFeatured(plan);
  const regTotal = PACK_CLASS_ORDER.reduce((a, c) => a + plan.regular[c], 0) || 1;
  const featTotal = PACK_CLASS_ORDER.reduce((a, c) => a + feat[c], 0) || 1;
  const nReg = Math.max(0, plan.cards - 1);
  const rows = PACK_CLASS_ORDER.filter((c) => table[c] > 0).map((c) => ({
    cls: c, label: PACK_CLASS_LABEL[c], scope: PACK_CLASS_SCOPE[c],
    perCard: table[c] / 100,
    atLeastOne: 1 - Math.pow(1 - plan.regular[c] / regTotal, nReg) * (1 - feat[c] / featTotal),
  }));
  let slots = IDENTITY_CACHE.get(pack.id);
  if (!slots) {
    const pp = packClassPools(getPack(pack.id) ?? pack);
    const id = tierIdentity(plan, pp.pools, marketValue, pp.weightOf);
    slots = {
      regular: { count: nReg, rows: PACK_CLASS_ORDER.filter((c) => plan.regular[c] > 0).map((c) => ({ cls: c, label: PACK_CLASS_LABEL[c], p: plan.regular[c] / regTotal })) },
      featured: { rows: PACK_CLASS_ORDER.filter((c) => feat[c] > 0).map((c) => ({ cls: c, label: PACK_CLASS_LABEL[c], p: feat[c] / featTotal })) },
      ovrTilt: plan.ovrTilt,
      bestAtLeast: { ovr90: id.bestAtLeast[90], ovr93: id.bestAtLeast[93], ovr95: id.bestAtLeast[95] },
    };
    IDENTITY_CACHE.set(pack.id, slots);
  }
  // Pack Opening 3.1 · la garantía de la carta destacada solo se comunica en los especiales (EWC): la ficha de la línea
  // principal no cambia.
  const featured = MAIN_PACK_LINE.includes(pack.id) ? null : featuredGuarantee(plan)?.label ?? null;
  return { rows, guarantee: classGuarantee(table)?.label ?? featured, slots, icon: iconOddsFor(pack) };
}

/** «1 %», «12,5 %»: puntos básicos con los decimales que tengan (nunca redondeados). */
export function bpPct(p: number): string {
  return `${(Math.round(p * 1e6) / 1e4).toLocaleString(getIntlLocale(), { maximumFractionDigits: 2 })} %`;
}

/** Frases EXACTAS de la ficha (el encargo las fija). */
export const ICON_COPY = {
  chance: (p: number) => tr("Probabilidad de conseguir al menos una carta ICON en este sobre: {p}", { p: bpPct(p) }),
  guaranteed: (n: number) => (n === 1 ? tr("Contiene exactamente 1 carta ICON garantizada.") : tr("Contiene exactamente {n} cartas ICON garantizadas.", { n })),
  independent: "Cada carta se sortea por separado: pueden repetirse.",
  favorsLow: "Las ICON de menor valor tienen mayor probabilidad de aparecer.",
  topAtLeastOne: (ovr: number, p: number) => tr("Probabilidad de al menos una ICON de {ovr} OVR: {v} %.", { ovr, v: (Math.round(p * 10000) / 100).toLocaleString(getIntlLocale()) }),
} as const;

const ICON_ODDS_CACHE = new Map<string, IconOdds | null>();

/**
 * La Icon de un sobre de la línea principal (o `null` fuera de ella). Bronce…Champions: su probabilidad POR SOBRE. Sobres
 * ICON: cuántas garantiza y la probabilidad EXACTA de cada Icon POR CARTA (pool real × tabla de calidad aprobada).
 */
export function iconOddsFor(pack: Pick<PackDef, "id">): IconOdds | null {
  const cacheKey = `${getLocale()}:${pack.id}`;
  if (ICON_ODDS_CACHE.has(cacheKey)) return ICON_ODDS_CACHE.get(cacheKey)!;
  const atLeastOne = iconChanceOf(pack.id);
  if (atLeastOne === null) { ICON_ODDS_CACHE.set(cacheKey, null); return null; }
  const count = guaranteedIcons(pack.id);
  const plan = packPlan(pack.id)!;
  const guaranteed = count > 0 && count === plan.cards;
  let cards: IconOdds["cards"] = [];
  let favorsLowValue = false;
  let quality: IconOdds["quality"] = null;
  let top: IconOdds["top"] = null;
  if (guaranteed) {
    const pp = packClassPools(getPack(pack.id) ?? (pack as PackDef));
    const icons = pp.pools.icon;
    const w = icons.map((c) => Math.max(0, pp.weightOf(c)));
    const tw = w.reduce((a, b) => a + b, 0) || 1;
    cards = icons.map((c, i) => ({ cardId: c.id, label: `${getPlayer(c.playerId)?.nick ?? c.playerId}`, ovr: c.ovr, value: marketValue(c), p: w[i] / tw }))
      .sort((a, b) => a.value - b.value || a.cardId.localeCompare(b.cardId));
    // «Las de menor valor, más probables»: toda carta de valor menor es ESTRICTAMENTE más probable que cualquiera de valor mayor.
    favorsLowValue = cards.length > 1 && cards.every((a) => cards.every((b) => !(a.value < b.value) || a.p > b.p + 1e-12));
    const t = planTemplate(pack.id);
    const table = t !== null && ICON_QUALITY_PACKS.has(t) ? activeIconQuality() : null;
    if (table) {
      const levels = iconValueLevels(icons, marketValue);
      quality = {
        table,
        levels: levels.map((lv, i) => ({ value: lv.value, p: table.shares[i] / 1000, cards: lv.cardIds.length })),
        method: tr("Cada Icon pertenece a un nivel según su valor de mercado (mismo valor, mismo nivel). Para cada carta se sortea primero el nivel con su probabilidad y después una carta del nivel, todas con la misma probabilidad."),
      };
    }
    // Varias cartas: probabilidad EXACTA de al menos una de la Icon de más OVR (independientes): 1 − (1 − p)^n.
    if (count > 1 && cards.length) {
      const maxOvr = Math.max(...cards.map((c) => c.ovr));
      const pTop = cards.filter((c) => c.ovr === maxOvr).reduce((a, c) => a + c.p, 0);
      top = { ovr: maxOvr, atLeastOne: 1 - Math.pow(1 - pTop, count) };
    }
  }
  const text = guaranteed
    ? [ICON_COPY.guaranteed(count), ...(count > 1 ? [td(ICON_COPY.independent)] : []), ...(favorsLowValue ? [td(ICON_COPY.favorsLow)] : [])].join(" ")
    : ICON_COPY.chance(atLeastOne);
  const out: IconOdds = { atLeastOne, guaranteed, count, text, cards, favorsLowValue, quality, top };
  ICON_ODDS_CACHE.set(cacheKey, out);
  return out;
}

export interface MeasuredStats {
  drawn: Record<RarityBucket, number>;
  impossible: RarityBucket[];
}

const rank = (b: RarityBucket): number => BUCKET_ORDER.indexOf(b);

/** Normaliza los pesos declarados (fallback sin medición). */
export function normalizedWeights(weights: Record<RarityBucket, number>): Record<RarityBucket, number> {
  const total = BUCKET_ORDER.reduce((s, b) => s + Math.max(0, weights[b] ?? 0), 0);
  const out = {} as Record<RarityBucket, number>;
  for (const b of BUCKET_ORDER) out[b] = total > 0 ? Math.max(0, weights[b] ?? 0) / total : 0;
  return out;
}

/** 1 − (1 − p)^n, acotado. */
export function atLeastOneIn(perCard: number, cardCount: number): number {
  const p = Math.min(1, Math.max(0, perCard));
  const n = Math.max(0, Math.floor(cardCount));
  return 1 - Math.pow(1 - p, n);
}

/** Copia del sobre de equipo: aumentada, nunca «contiene». */
export function teamBoostCopy(team: string, teamCards: number): string {
  return teamCards > 0
    ? tr("Probabilidad aumentada de jugadores de {team}: {teamCards} cartas del equipo pueden salir y son más probables que el resto, pero no están garantizadas.", { team, teamCards })
    : tr("Probabilidad aumentada de jugadores de {team}. No está garantizado que salga uno.", { team });
}

export function packOddsFor(
  pack: Pick<PackDef, "id" | "cardCount" | "weights" | "guaranteedMin" | "team">,
  measured: MeasuredStats | null | undefined,
  teamCards = 0,
): PackOdds {
  const classOdds = classOddsFor(pack);
  if (classOdds) {
    // Fase 57.3 · la tabla por clase manda; ni rarezas ni garantías por rareza (no gobiernan este producto).
    return {
      packId: pack.id, cardCount: pack.cardCount, source: "weights", rows: [], guaranteedMin: null,
      teamBoost: pack.team ? { team: pack.team, copy: teamBoostCopy(pack.team, teamCards) } : null,
      powerCap: null, classOdds,
    };
  }
  const source: PackOdds["source"] = measured ? "measured" : "weights";
  const per = measured ? measured.drawn : normalizedWeights(pack.weights);
  const impossible = new Set(measured?.impossible ?? []);
  const gMin = pack.guaranteedMin ?? null;
  /*
   * Fase 57.3 · FIX F25. La garantía es «al menos una de esta rareza O SUPERIOR». Eso NO garantiza ninguna rareza
   * concreta mientras pueda salir una superior (Plata marcaba «Común · Garantizada», y hasta «Rara · Garantizada» era
   * falso: la última carta puede ser épica). Una fila solo es «Garantizada» si es la rareza garantizada Y no hay
   * ninguna superior posible; si no, se enseña su cifra derivada y el texto de la garantía va aparte.
   */
  const perOf = (b: RarityBucket) => (impossible.has(b) ? 0 : per[b] ?? 0);
  const aboveGMinPossible = gMin !== null && BUCKET_ORDER.some((x) => rank(x) > rank(gMin) && perOf(x) > 0);
  const rows: OddsRow[] = BUCKET_ORDER.map((b) => {
    const perCard = perOf(b);
    const guaranteed = gMin !== null && b === gMin && !aboveGMinPossible && !impossible.has(b) && perCard > 0;
    return {
      bucket: b,
      label: BUCKET_LABEL[b],
      perCard,
      atLeastOne: guaranteed ? 1 : atLeastOneIn(perCard, pack.cardCount),
      guaranteed,
      impossible: impossible.has(b) || (measured != null && perCard === 0),
    };
  });
  return {
    packId: pack.id,
    cardCount: pack.cardCount,
    source,
    rows,
    guaranteedMin: gMin,
    teamBoost: pack.team ? { team: pack.team, copy: teamBoostCopy(pack.team, teamCards) } : null,
    powerCap: packPowerCap(pack.id),
    classOdds: null,
  };
}

/** Porcentaje legible: 0 → «0 %», 0.004 → «<1 %», 0.37 → «37 %». */
export function pct(p: number): string {
  if (p <= 0) return "0 %";
  if (p < 0.01) return "<1 %";
  if (p >= 0.995) return "100 %";
  return `${Math.round(p * 100)} %`;
}
