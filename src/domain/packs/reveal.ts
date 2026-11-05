/**
 * PACK OPENING 3.0 · LA REVELACIÓN (Fase 38) — PRESENTACIÓN PURA.
 *
 * EL SERVIDOR DECIDE, LA CEREMONIA PRESENTA. Aquí no hay sorteo, ni pesos, ni seriales, ni precios: entra el
 * resultado AUTORITATIVO de una apertura (instancias persistidas, en el orden que devolvió el servidor) y la foto de
 * la colección ANTES de abrir; sale lo que la pantalla necesita contar:
 *
 *   · por carta: rareza real (bucket del catálogo), NUEVA / NUEVA VARIANTE / DUPLICADA ×N, serial canónico y su
 *     prestigio visual (#1 / Top 10 / Top 100 — sin efecto de juego), cuánto dura la anticipación y la frase para
 *     lector de pantalla;
 *   · el resumen: nuevas, duplicadas, mejor rareza, carta destacada con criterio explícito, colección X → Y / TOTAL,
 *     % → %, hasta 3 sets que avanzan, sets completados (reconocimiento, sin recompensa) y «primera legendaria»;
 *   · una máquina de estados de PRESENTACIÓN (nunca se persiste) que hace imposible abrir dos veces con un gesto.
 *
 * «NUEVA» = antes de ESTA apertura había 0 copias de esa definición (nunca `obtained_at`). Si la misma definición
 * sale dos veces en el sobre, la primera es NUEVA y la segunda DUPLICADA ×2. Si no hay foto previa, el estado es
 * «desconocido» y la pantalla no afirma nada.
 */
import type { CardDef, Player } from "@/domain/cards/types";
import { getVariant } from "@/domain/cards/variants";
import type { RarityBucket } from "@/domain/packs/types";
import {
  BUCKET_LABEL, BUCKET_ORDER, buildCollectionSnapshot, cardHref, formatSerial, rarityOf, serialPrestige,
  type CollectionSetKind, type CollectionSnapshot, type OwnedInstanceFact, type SerialPrestigeTier,
} from "@/domain/collection/room";
import { ns, td } from "@/i18n/runtime";

const t = ns("packs");

/* ═══════════════════════ entrada ═══════════════════════ */

/** Una instancia PERSISTIDA devuelta por el servidor (uid real, carta real, serial real, versión real). */
export interface OpenedInstance {
  uid: string;
  cardId: string;
  serial: number | null;
  mintedVersion: number | null;
}

export interface RevealCatalog {
  cards: readonly CardDef[];
  getCard: (id: string) => CardDef | undefined;
  getPlayer: (id: string) => Player | undefined;
}

/* ═══════════════════════ ritmo por rareza ═══════════════════════ */

export type RevealMoment = "quick" | "presence" | "impact" | "strong" | "max";

/** Común rápida, poco común con presencia, rara con impacto, épica que para el ritmo, legendaria que es un momento. */
export const RARITY_MOMENT: Record<RarityBucket, RevealMoment> = {
  common: "quick", uncommon: "presence", rare: "impact", epic: "strong", legendary: "max",
};

/** Anticipación antes del giro (ms). Monótona en la rareza. */
export const REVEAL_HOLD_MS: Record<RarityBucket, number> = {
  common: 320, uncommon: 560, rare: 950, epic: 1450, legendary: 2200,
};

/** Pausa extra por prestigio de serial: solo presentación. */
export const PRESTIGE_EXTRA_MS: Record<SerialPrestigeTier, number> = { NUMBER_ONE: 900, TOP_10: 350, TOP_100: 150 };

/** Con movimiento reducido no se hace esperar: el giro es casi inmediato. */
export const REDUCED_HOLD_MS = 180;

export function revealHoldMs(rarity: RarityBucket, prestige: { tier: SerialPrestigeTier } | null, reduced = false): number {
  if (reduced) return REDUCED_HOLD_MS;
  return REVEAL_HOLD_MS[rarity] + (prestige ? PRESTIGE_EXTRA_MS[prestige.tier] : 0);
}

/** 0 = común … 4 = legendaria. */
export const rarityRank = (r: RarityBucket): number => BUCKET_ORDER.length - 1 - BUCKET_ORDER.indexOf(r);

/** El heraldo canta la rareza REAL y solo desde «rara»: las rarezas bajas no anuncian nada. */
export const heraldFor = (r: RarityBucket): string => (rarityRank(r) >= rarityRank("rare") ? BUCKET_LABEL[r] : "");

/* ═══════════════════════ plan ═══════════════════════ */

export type RevealStatus = "new" | "duplicate" | "unknown";

export interface RevealItem {
  /** Posición en la presentación (0…n-1), en el orden autoritativo. */
  index: number;
  uid: string;
  cardId: string;
  card: CardDef;
  player: Player | null;
  rarity: RarityBucket;
  rarityLabel: string;
  variantLabel: string;
  serial: number | null;
  serialText: string | null;
  prestige: { tier: SerialPrestigeTier; label: string } | null;
  mintedVersion: number | null;
  status: RevealStatus;
  /** Definición nueva de un jugador que ya tenías (antes o antes en este mismo sobre). */
  newVariant: boolean;
  /** Copias de esta definición DESPUÉS de esta instancia (null si no hay foto previa). */
  copiesAfter: number | null;
  moment: RevealMoment;
  holdMs: number;
  herald: string;
  announcement: string;
  href: string;
}

export interface SetDelta {
  id: string;
  kind: CollectionSetKind;
  key: string;
  label: string;
  before: number;
  after: number;
  total: number;
  /** Se completa con ESTA apertura. Reconocimiento visual: no concede nada. */
  completed: boolean;
}

export interface CollectionDelta {
  catalogTotal: number;
  uniqueBefore: number;
  uniqueAfter: number;
  copiesBefore: number;
  copiesAfter: number;
  pctBefore: number;
  pctAfter: number;
  gainedUnique: number;
}

export interface RevealSummary {
  total: number;
  newCount: number | null;
  duplicateCount: number | null;
  newVariantCount: number | null;
  bestRarity: RarityBucket | null;
  featured: RevealItem | null;
  featuredCriterion: string;
  serialHighlight: RevealItem | null;
  collection: CollectionDelta | null;
  sets: SetDelta[];
  completedSets: SetDelta[];
  firstLegendary: boolean | null;
  /** Instancias cuyo `cardId` no está en el catálogo vivo (no se inventa su cara). */
  unresolved: number;
}

export interface RevealPlan {
  items: RevealItem[];
  summary: RevealSummary;
  /** F81 · la carta protagonista de ESTA apertura (mayor OVR; desempate estable). null si no se puede elegir. */
  hero: HeroPick;
  /** F81 · orden de PRESENTACIÓN del resumen: la hero primero y el resto por OVR descendente (empates: orden del servidor). */
  order: RevealItem[];
}

/* ═══════════════════════ F81 · HERO CARD ═══════════════════════ */

/**
 * La HERO CARD no es una rareza: es la carta que protagoniza la apertura. Regla canónica: la de MAYOR OVR del
 * catálogo (`CardDef.ovr`), nunca la rareza, el precio, la edición ni las stats. Si varias empatan en el OVR máximo
 * se elige EXACTAMENTE UNA con un desempate pseudoaleatorio pero ESTABLE para esa apertura: el hash de los uids
 * PERSISTIDOS del resultado (los genera el servidor al guardar las cartas y vuelven idénticos al recuperar la
 * apertura). Nada de `Math.random()` por render: la misma apertura da siempre la misma hero, y la selección no toca
 * el resultado (qué cartas hay, su OVR, el inventario): solo elige cuál se presenta primero.
 */
export type HeroPick =
  | { ok: true; hero: RevealItem; tied: RevealItem[] }
  | { ok: false; reason: "EMPTY" | "INVALID_OVR"; detail: string };

export const HERO_CRITERION = "Mayor OVR; a igualdad, una sola elegida al azar y fija para esta apertura";

/** FNV-1a de 32 bits: determinista, sin dependencias, suficiente para repartir empates (no es criptografía). */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** La clave de la apertura: los uids persistidos, ordenados (no depende del orden en que se pinten). */
export const openingKey = (uids: readonly string[]): string => [...uids].sort().join("|");

/** Peso de desempate de una candidata dentro de SU apertura. El menor gana. */
export const heroTieWeight = (key: string, uid: string): number => fnv1a(`${key}#${uid}`);

export function selectHero(items: readonly RevealItem[]): HeroPick {
  if (items.length === 0) return { ok: false, reason: "EMPTY", detail: t("la apertura no trae cartas") };
  const bad = items.filter((i) => typeof i.card.ovr !== "number" || !Number.isFinite(i.card.ovr));
  if (bad.length > 0) return { ok: false, reason: "INVALID_OVR", detail: t("sin OVR válido: {v}", { v: bad.map((i) => i.cardId).join(", ") }) };
  const max = Math.max(...items.map((i) => i.card.ovr));
  const tied = items.filter((i) => i.card.ovr === max);
  if (tied.length === 1) return { ok: true, hero: tied[0], tied };
  const key = openingKey(items.map((i) => i.uid));
  const hero = [...tied].sort((a, b) => heroTieWeight(key, a.uid) - heroTieWeight(key, b.uid) || a.index - b.index)[0];
  return { ok: true, hero, tied };
}

/**
 * ¿Hay cinemática para este plan? Solo si se puede elegir hero Y todas las cartas persistidas se resuelven en el
 * catálogo: si alguna no (corrupción o catálogo desfasado), no se presenta un sobre «incompleto» como si nada; se va al
 * resumen y se dice cuántas no se pudieron mostrar (siguen guardadas en la colección).
 */
export function cinematicFor(plan: Pick<RevealPlan, "hero" | "summary">): { ok: true } | { ok: false; reason: "EMPTY" | "INVALID_OVR" | "UNRESOLVED"; detail: string } {
  if (plan.summary.unresolved > 0) return { ok: false, reason: "UNRESOLVED", detail: t("{unresolved} carta(s) fuera del catálogo vivo", { unresolved: plan.summary.unresolved }) };
  if (!plan.hero.ok) return { ok: false, reason: plan.hero.reason, detail: plan.hero.detail };
  return { ok: true };
}

/** Hero primero; el resto por OVR descendente y, a igualdad, en el orden autoritativo del servidor. */
export function presentationOrder(items: readonly RevealItem[], heroUid: string | null): RevealItem[] {
  const hero = heroUid ? items.find((i) => i.uid === heroUid) : undefined;
  const rest = items.filter((i) => i !== hero).sort((a, b) => b.card.ovr - a.card.ovr || a.index - b.index);
  return hero ? [hero, ...rest] : rest;
}

export const FEATURED_CRITERION = HERO_CRITERION;
export const MAX_SET_DELTAS = 3;

const KIND_PRIORITY: Record<CollectionSetKind, number> = { team: 0, region: 1, edition: 2, role: 3, rarity: 4 };

const factsOf = (instances: readonly OwnedInstanceFact[]) => ({ instances: [...instances], favorites: [], showcaseUids: [], decks: [] });

/** Del resultado que ya tiene la pantalla (`OpenedResult`) a instancias: se LEEN uid, carta, serial y versión, no se componen. */
export function toOpenedInstances(results: readonly { uid: string; card: { id: string }; serial?: number | null; mintedVersion?: number | null }[]): OpenedInstance[] {
  return results.map((r) => ({ uid: r.uid, cardId: r.card.id, serial: r.serial ?? null, mintedVersion: r.mintedVersion ?? null }));
}

/** Una copia poseída (store local o foto del servidor) como hecho de colección. */
export function toInstanceFact(o: { uid: string; cardId: string; serial?: number | null; mintedVersion?: number | null }): OwnedInstanceFact {
  return { uid: o.uid, cardId: o.cardId, serial: o.serial ?? null, mintedVersion: o.mintedVersion ?? null };
}

/** La foto previa a partir de la colección ACTUAL (p. ej. tras recargar): se quitan las instancias de esta apertura. */
export function beforeExcluding(current: readonly OwnedInstanceFact[], opened: readonly Pick<OpenedInstance, "uid">[]): OwnedInstanceFact[] {
  const uids = new Set(opened.map((o) => o.uid));
  return current.filter((i) => !uids.has(i.uid));
}

/**
 * COLECCIONES ILIMITADAS · copias por carta de la foto previa. Con cuenta, la foto de ejemplares trae uno por carta y
 * no sirve para decir «ahora tienes N»: las copias las da el servidor. Debe ser del MISMO momento que la foto previa
 * (antes de esta apertura); `holdingsPlus` / `holdingsMinus` la llevan de una apertura a la siguiente o la deshacen.
 */
export type PriorHoldings = Readonly<Record<string, { count: number; numbered: number }>>;

function shiftHoldings(h: PriorHoldings, opened: readonly Pick<OpenedInstance, "cardId" | "serial">[], sign: 1 | -1): PriorHoldings {
  const out: Record<string, { count: number; numbered: number }> = { ...h };
  for (const o of opened) {
    const cur = out[o.cardId] ?? { count: 0, numbered: 0 };
    const next = { count: Math.max(0, cur.count + sign), numbered: Math.max(0, cur.numbered + (o.serial != null ? sign : 0)) };
    if (next.count === 0) delete out[o.cardId]; else out[o.cardId] = next;
  }
  return out;
}
/** Las copias tras sumar lo que salió en una apertura (la foto previa de la siguiente). */
export const holdingsPlus = (h: PriorHoldings, opened: readonly Pick<OpenedInstance, "cardId" | "serial">[]): PriorHoldings => shiftHoldings(h, opened, 1);
/** Las copias de ANTES a partir de las actuales (recuperación): se restan las de esta apertura. */
export const holdingsMinus = (h: PriorHoldings, opened: readonly Pick<OpenedInstance, "cardId" | "serial">[]): PriorHoldings => shiftHoldings(h, opened, -1);

function statusText(item: Pick<RevealItem, "status" | "copiesAfter" | "newVariant">): string {
  if (item.status === "new") return item.newVariant ? (" " + t("Nueva variante en tu colección.")) : (" " + t("Nueva en tu colección."));
  if (item.status === "duplicate") return t(" Duplicada, ahora tienes {copiesAfter}.", { copiesAfter: item.copiesAfter });
  return "";
}

export function buildRevealPlan(
  opened: readonly OpenedInstance[],
  before: readonly OwnedInstanceFact[] | null,
  catalog: RevealCatalog,
  opts: { reduced?: boolean; holdings?: PriorHoldings | null } = {},
): RevealPlan {
  const openedUids = new Set(opened.map((o) => o.uid));
  const prior = before ? before.filter((i) => !openedUids.has(i.uid)) : null;

  const copiesBefore = new Map<string, number>();
  const playersBefore = new Set<string>();
  for (const i of prior ?? []) {
    copiesBefore.set(i.cardId, (copiesBefore.get(i.cardId) ?? 0) + 1);
    const c = catalog.getCard(i.cardId);
    if (c) playersBefore.add(c.playerId);
  }
  // Con recuentos del servidor, MANDAN: los ejemplares de la foto son uno por carta.
  const holdings = prior ? opts.holdings ?? null : null;
  if (holdings) {
    copiesBefore.clear();
    for (const id in holdings) {
      copiesBefore.set(id, holdings[id].count);
      const c = catalog.getCard(id);
      if (c) playersBefore.add(c.playerId);
    }
  }

  const seen = new Map<string, number>();
  const playersSeen = new Set<string>();
  const items: RevealItem[] = [];
  let unresolved = 0;

  for (const o of opened) {
    const card = catalog.getCard(o.cardId);
    if (!card) { unresolved++; continue; }
    const variant = getVariant(card.variantId);
    const rarity = rarityOf(card);
    const prestige = serialPrestige(o.serial);
    const had = copiesBefore.get(card.id) ?? 0;
    const soFar = seen.get(card.id) ?? 0;
    const status: RevealStatus = prior ? (had + soFar === 0 ? "new" : "duplicate") : "unknown";
    const newVariant = status === "new" && (playersBefore.has(card.playerId) || playersSeen.has(card.playerId));
    seen.set(card.id, soFar + 1);
    playersSeen.add(card.playerId);
    items.push({
      index: items.length,
      uid: o.uid,
      cardId: card.id,
      card,
      player: catalog.getPlayer(card.playerId) ?? null,
      rarity,
      rarityLabel: BUCKET_LABEL[rarity],
      variantLabel: variant.label,
      serial: o.serial,
      serialText: formatSerial(o.serial, variant.serialLimit),
      prestige,
      mintedVersion: o.mintedVersion,
      status,
      newVariant,
      copiesAfter: prior ? had + soFar + 1 : null,
      moment: RARITY_MOMENT[rarity],
      holdMs: revealHoldMs(rarity, prestige, opts.reduced),
      herald: prestige?.tier === "NUMBER_ONE" ? "Serial #1" : heraldFor(rarity),
      announcement: "",
      href: cardHref(card.id),
    });
  }

  for (const it of items) {
    const who = it.player?.nick ?? it.cardId;
    it.announcement = t("Carta {v} de {length}. {who}. {rarityLabel}. OVR {ovr}.{v2}{it}", { v: it.index + 1, length: items.length, who: td(who), rarityLabel: td(it.rarityLabel), ovr: it.card.ovr, v2: it.serialText ? ` Serial ${it.serialText}.` : "", it: statusText(it) });
  }

  const hero = selectHero(items);
  const heroItem = hero.ok ? hero.hero : null;
  return { items, summary: summarize(items, prior, opened, catalog, unresolved, heroItem, holdings), hero, order: presentationOrder(items, heroItem?.uid ?? null) };
}

function setDeltas(before: CollectionSnapshot, after: CollectionSnapshot): SetDelta[] {
  const out: SetDelta[] = [];
  for (const kind of ["team", "region", "edition", "role", "rarity"] as const) {
    const prev = new Map(before.sets[kind].map((s) => [s.id, s]));
    for (const s of after.sets[kind]) {
      const b = prev.get(s.id);
      const was = b?.owned ?? 0;
      if (s.owned > was) out.push({ id: s.id, kind, key: s.key, label: s.label, before: was, after: s.owned, total: s.total, completed: s.complete && !(b?.complete ?? false) });
    }
  }
  return out.sort((a, b) => Number(b.completed) - Number(a.completed)
    || KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind]
    || b.after / b.total - a.after / a.total
    || a.label.localeCompare(b.label, "es"));
}

function summarize(items: RevealItem[], prior: OwnedInstanceFact[] | null, opened: readonly OpenedInstance[], catalog: RevealCatalog, unresolved: number, hero: RevealItem | null, holdings: PriorHoldings | null = null): RevealSummary {
  const known = prior !== null;
  const bestRarity = items.reduce<RarityBucket | null>((best, i) => (best === null || rarityRank(i.rarity) > rarityRank(best) ? i.rarity : best), null);
  /* F81 · la destacada del resumen ES la hero de la apertura (mayor OVR), la misma que protagonizó el revelado. */
  const featured = hero;
  const serialHighlight = items.filter((i) => i.prestige).sort((a, b) => (a.serial ?? 0) - (b.serial ?? 0) || a.index - b.index)[0] ?? null;

  let collection: CollectionDelta | null = null;
  let sets: SetDelta[] = [];
  let firstLegendary: boolean | null = null;
  if (prior) {
    const openedFacts: OwnedInstanceFact[] = opened.filter((o) => catalog.getCard(o.cardId)).map((o) => ({ uid: o.uid, cardId: o.cardId, serial: o.serial, mintedVersion: o.mintedVersion }));
    const b = buildCollectionSnapshot(catalog.cards, catalog.getPlayer, { ...factsOf(prior), holdings });
    const a = buildCollectionSnapshot(catalog.cards, catalog.getPlayer, { ...factsOf([...prior, ...openedFacts]), holdings: holdings ? holdingsPlus(holdings, openedFacts) : null });
    collection = {
      catalogTotal: a.catalogTotal,
      uniqueBefore: b.uniqueOwned, uniqueAfter: a.uniqueOwned,
      copiesBefore: b.totalCopies, copiesAfter: a.totalCopies,
      pctBefore: b.completionPct, pctAfter: a.completionPct,
      gainedUnique: a.uniqueOwned - b.uniqueOwned,
    };
    sets = setDeltas(b, a);
    const legBefore = b.sets.rarity.find((s) => s.key === "legendary")?.owned ?? 0;
    const legAfter = a.sets.rarity.find((s) => s.key === "legendary")?.owned ?? 0;
    firstLegendary = legBefore === 0 && legAfter > 0;
  }

  return {
    total: items.length,
    newCount: known ? items.filter((i) => i.status === "new").length : null,
    duplicateCount: known ? items.filter((i) => i.status === "duplicate").length : null,
    newVariantCount: known ? items.filter((i) => i.newVariant).length : null,
    bestRarity,
    featured,
    featuredCriterion: FEATURED_CRITERION,
    serialHighlight,
    collection,
    sets: sets.slice(0, MAX_SET_DELTAS),
    completedSets: sets.filter((s) => s.completed),
    firstLegendary,
    unresolved,
  };
}

/* ═══════════════════════ fallos de apertura ═══════════════════════ */

export type OpenFailureKind = "NETWORK" | "SERVER" | "NO_PACK" | "AUTH" | "UNAVAILABLE" | "SESSION" | "INVALID";

export interface OpenFailure {
  kind: OpenFailureKind;
  title: string;
  message: string;
  /** Reintentar repite la MISMA operación (misma clave): recupera lo abierto o abre por primera vez, nunca dos. */
  retrySameKey: boolean;
}

export function classifyOpenFailure(error: unknown): OpenFailure {
  const msg = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  // F81.1 · con cuenta, el motor local está prohibido: ni cartas locales ni «no tienes»; se reintenta (irá al servidor).
  if (/los sobres los abre el servidor/i.test(msg)) {
    return { kind: "SESSION", title: t("Recuperando tu cuenta"), message: t("Con tu cuenta, los sobres los abre el servidor. Vuelve a intentarlo en un momento: no se ha abierto nada."), retrySameKey: true };
  }
  // F81.1 · el servidor respondió algo que no se puede presentar: se dice, no se filtra ni se completa en el navegador.
  if (/resultado de apertura no válido/i.test(msg)) {
    return { kind: "INVALID", title: t("No se pudo mostrar la apertura"), message: t("El servidor devolvió un resultado que no se puede mostrar. Si el sobre llegó a abrirse, tus cartas están guardadas en tu colección."), retrySameKey: false };
  }
  if (error instanceof TypeError || /failed to fetch|networkerror|network request|load failed|fetch failed|sin conexión|timed out|timeout|aborted/i.test(msg) || (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError"))) {
    return { kind: "NETWORK", title: t("Se perdió la conexión"), message: t("La conexión se cortó mientras se abría el sobre. Reintenta: si el servidor ya lo abrió, recuperarás exactamente las mismas cartas."), retrySameKey: true };
  }
  if (/no tienes ese sobre/i.test(msg)) {
    return { kind: "NO_PACK", title: t("No te queda este sobre"), message: t("No queda ninguna unidad de este sobre. Si lo abriste en otra pestaña, tus cartas ya están en tu colección."), retrySameKey: false };
  }
  if (/no autenticado|sesión/i.test(msg)) {
    return { kind: "AUTH", title: t("Inicia sesión"), message: t("Tu sesión ha caducado. Inicia sesión para abrir el sobre."), retrySameKey: false };
  }
  if (/no encontrado|no está disponible|no disponible/i.test(msg)) {
    return { kind: "UNAVAILABLE", title: t("Sobre no disponible"), message: t("Este sobre no está disponible para abrir."), retrySameKey: false };
  }
  return { kind: "SERVER", title: t("No se pudo abrir"), message: t("El servidor no pudo completar la apertura. Reintentar es seguro: si llegó a abrirse recuperas las mismas cartas; si no, el sobre sigue en tu inventario."), retrySameKey: true };
}

/* ═══════════════════════ máquina de estados de PRESENTACIÓN (F81) ═══════════════════════ */

/**
 * F81 · CINEMATIC PACK OPENING. Estados VISUALES explícitos (nunca se persisten; el resultado ya está guardado en el
 * servidor antes de salir de `requesting`):
 *
 *   ready → requesting → opening (intro: el sobre se rasga) → buildup (la energía se concentra en UNA carta)
 *         → hero (la HERO gira) → hero_hold (el jugador la mira; CONTINUAR) → rest (las demás, escalonadas) → summary
 *
 * Un gesto (toque/Enter) AVANZA un paso sin saltarse la hero; OMITIR va directo al resumen de las MISMAS cartas. Sin
 * hero válida (OVR corrupto) no hay cinemática: resumen directo y la inconsistencia se registra (`cinematic: false`).
 */
export type RevealPhase = "ready" | "requesting" | "opening" | "walkout" | "buildup" | "hero" | "hero_hold" | "rest" | "summary" | "error" | "recovering" | "no_pack";

export interface RevealState {
  phase: RevealPhase;
  /** Cartas del resultado autoritativo (0 hasta recibirlo). */
  count: number;
  requests: number;
  repeated: boolean;
  recovered: boolean;
  skipped: boolean;
  /** false = el resultado no permite elegir hero (OVR inválido): se presenta el resumen sin cinemática. */
  cinematic: boolean;
  failure: OpenFailure | null;
  /**
   * WALKOUT 0.5 · cuántas cartas especiales se presentan con un walkout (0 = la ceremonia de siempre), cuál va ahora, si
   * la hero es una de ellas (su walkout ES su presentación: no se repite) y cuántas quedan para el resto escalonado.
   * Solo presentación: lo calcula la pantalla con el resultado YA guardado (`domain/walkout/packWalkout · walkoutFlow`).
   */
  walkouts: number;
  walkoutIndex: number;
  heroWalked: boolean;
  rest: number;
  /**
   * APERTURA 2026-10-15 · el resto se revela CARTA A CARTA (cada una con su ambiente de rareza): cuál está en escena
   * (0…rest-1) y si ya giró. Solo presentación: el orden es el de `plan.order` sin la hero, nunca se reordena.
   */
  restIndex: number;
  restShown: boolean;
  /** La última carta del resto que YA giró (-1 = ninguna): al volver a avanzar tras retroceder, esas no giran otra vez. */
  restSeen: number;
}

export type RevealEvent =
  | { type: "OPEN_REQUESTED" }
  | { type: "OPEN_SUCCEEDED"; count: number; repeated: boolean; cinematic?: boolean; walkouts?: number; heroWalked?: boolean; rest?: number }
  | { type: "OPEN_FAILED"; failure: OpenFailure }
  | { type: "RECOVER_STARTED" }
  | { type: "RECOVERED"; count: number }
  | { type: "INTRO_DONE" }
  | { type: "BUILDUP_DONE" }
  | { type: "HERO_SHOWN" }
  | { type: "ADVANCE" }
  | { type: "CONTINUE" }
  | { type: "REST_DONE" }
  | { type: "REST_SHOWN" }
  | { type: "BACK" }
  | { type: "WALKOUT_DONE" }
  | { type: "SKIP" }
  | { type: "DISMISS_ERROR" }
  | { type: "RESET" };

export const INITIAL_REVEAL: RevealState = {
  phase: "ready", count: 0, requests: 0, repeated: false, recovered: false, skipped: false, cinematic: true, failure: null,
  walkouts: 0, walkoutIndex: 0, heroWalked: false, rest: 0, restIndex: 0, restShown: false, restSeen: -1,
};

const RESULT_PHASES: readonly RevealPhase[] = ["opening", "walkout", "buildup", "hero", "hero_hold", "rest", "summary"];
/** Con resultado autoritativo en mano (se puede omitir, avanzar, ver el resumen). */
export const hasResult = (s: RevealState): boolean => s.count > 0 && RESULT_PHASES.includes(s.phase);
export const canOpen = (s: RevealState): boolean => s.phase === "ready";
/** Tras la hero: el resto escalonado solo si quedan cartas (sin walkouts, las demás); con una sola, la hero ES el sobre. */
const afterHero = (s: RevealState): RevealState => (s.rest > 0 ? { ...s, phase: "rest", restIndex: 0, restShown: s.restSeen >= 0 } : { ...s, phase: "summary" });
/** Un paso en el resto: girar la carta en escena; si ya giró, la siguiente (boca arriba si ya se vio); tras la última, el resumen. */
const restStep = (s: RevealState): RevealState => {
  if (!s.restShown) return { ...s, restShown: true, restSeen: Math.max(s.restSeen, s.restIndex) };
  if (s.restIndex + 1 >= s.rest) return { ...s, phase: "summary" };
  const next = s.restIndex + 1;
  return { ...s, restIndex: next, restShown: next <= s.restSeen };
};
/** Tras la intro: los walkouts (si los hay) y después la hero de siempre. */
const afterIntro = (s: RevealState): RevealState => (s.walkouts > 0 ? { ...s, phase: "walkout", walkoutIndex: 0 } : { ...s, phase: "buildup" });
/** Tras el último walkout: la hero de siempre, salvo que la hero ya haya salido en su walkout. */
const afterWalkouts = (s: RevealState): RevealState => (s.heroWalked ? afterHero(s) : { ...s, phase: "buildup" });

export function revealReducer(s: RevealState, e: RevealEvent): RevealState {
  switch (e.type) {
    case "OPEN_REQUESTED":
      // Un gesto = una petición: fuera de `ready` se ignora (doble clic, Enter repetido, dos manos).
      return s.phase === "ready" ? { ...s, phase: "requesting", requests: s.requests + 1, failure: null } : s;
    case "OPEN_SUCCEEDED": {
      if (s.phase !== "requesting" && s.phase !== "recovering") return s;
      // Un sobre nunca trae 0 cartas: sin resultado no hay ceremonia falsa, hay error honesto.
      if (e.count <= 0) return { ...s, phase: "error", failure: classifyOpenFailure("") };
      const cinematic = e.cinematic !== false;
      // WALKOUT 0.5 · sin datos de walkout, la ceremonia de siempre: 0 walkouts y «resto» = las demás cartas
      const walkouts = Math.max(0, Math.min(e.count, Math.floor(e.walkouts ?? 0)));
      const heroWalked = walkouts > 0 && e.heroWalked === true;
      const rest = Math.max(0, Math.min(e.count, Math.floor(e.rest ?? e.count - 1 - (walkouts - (heroWalked ? 1 : 0)))));
      const flow = { walkouts, walkoutIndex: 0, heroWalked, rest };
      if (s.phase === "recovering" || !cinematic) return { ...s, ...flow, phase: "summary", count: e.count, repeated: e.repeated, recovered: s.phase === "recovering", cinematic };
      return { ...s, ...flow, phase: "opening", count: e.count, repeated: e.repeated, cinematic };
    }
    case "OPEN_FAILED":
      if (s.phase !== "requesting" && s.phase !== "recovering") return s;
      return e.failure.kind === "NO_PACK" ? { ...s, phase: "no_pack", failure: e.failure } : { ...s, phase: "error", failure: e.failure };
    case "RECOVER_STARTED":
      return s.phase === "ready" ? { ...s, phase: "recovering" } : s;
    case "RECOVERED":
      return s.phase === "ready" || s.phase === "recovering" ? { ...s, phase: "summary", count: e.count, recovered: true } : s;
    case "INTRO_DONE":
      return s.phase === "opening" ? afterIntro(s) : s;
    case "WALKOUT_DONE":
      // «Continuar» de un walkout: el siguiente o, tras el último, lo que quede de la ceremonia. Fuera de un walkout no hace nada.
      if (s.phase !== "walkout") return s;
      return s.walkoutIndex + 1 < s.walkouts ? { ...s, walkoutIndex: s.walkoutIndex + 1 } : afterWalkouts(s);
    case "BUILDUP_DONE":
      return s.phase === "buildup" ? { ...s, phase: "hero" } : s;
    case "HERO_SHOWN":
      return s.phase === "hero" ? { ...s, phase: "hero_hold" } : s;
    case "ADVANCE":
      // Un toque avanza UN paso y nunca se salta la hero: intro/tensión → hero; hero girando → quieta; quieta → resto.
      // WALKOUT 0.5 · con walkouts, un toque en la intro lleva al PRIMERO (el walkout avanza con su propio «Continuar»).
      if (s.phase === "opening" && s.walkouts > 0) return afterIntro(s);
      if (s.phase === "walkout") return s;
      if (s.phase === "opening" || s.phase === "buildup") return { ...s, phase: "hero" };
      if (s.phase === "hero") return { ...s, phase: "hero_hold" };
      if (s.phase === "hero_hold") return afterHero(s);
      if (s.phase === "rest") return restStep(s);
      return s;
    case "REST_SHOWN":
      return s.phase === "rest" ? { ...s, restShown: true, restSeen: Math.max(s.restSeen, s.restIndex) } : s;
    case "BACK":
      // Volver a una carta YA vista (sin girarla otra vez); desde la primera del resto, a la hero quieta. Nada más retrocede.
      if (s.phase !== "rest") return s;
      return s.restIndex > 0 ? { ...s, restIndex: s.restIndex - 1, restShown: true } : { ...s, phase: "hero_hold" };
    case "CONTINUE":
      // El botón CONTINUAR solo existe con la hero quieta: un doble clic no encadena «resto → resumen».
      return s.phase === "hero_hold" ? afterHero(s) : s;
    case "REST_DONE":
      return s.phase === "rest" ? { ...s, phase: "summary" } : s;
    case "SKIP":
      return hasResult(s) && s.phase !== "summary" ? { ...s, phase: "summary", skipped: true } : s;
    case "DISMISS_ERROR":
      return s.phase === "error" ? { ...s, phase: "ready" } : s;
    case "RESET":
      // «Abrir otro»: otra operación (nueva clave la pone la capa de sync), la anterior ya está cerrada.
      return s.phase === "summary" || s.phase === "no_pack" ? { ...INITIAL_REVEAL, requests: s.requests } : s;
  }
}

/* ═══════════════════════ F81 · tiempos (presentación) ═══════════════════════ */

/** Intro (el sobre se rasga y suelta sus cartas) + tensión ≈ 3 s; con movimiento reducido ≈ 2,1 s. La hero, rápida. */
export const BUILDUP_MS: Record<RarityBucket, number> = { common: 650, uncommon: 750, rare: 850, epic: 1000, legendary: 1150 };
export const BUILDUP_REDUCED_MS = 550;
export const HERO_FLIP_MS = 850;
export const HERO_FLIP_REDUCED_MS = 450;
/** (F81, cascada antigua del resto; desde 2026-10-15 el resto va carta a carta: ver `domain/packs/atmosphere`.) */
export const REST_STAGGER_MS = 110;
export const REST_STAGGER_REDUCED_MS = 70;
export const REST_SETTLE_MS = 650;

export const buildupMs = (rarity: RarityBucket | null, reduced: boolean): number => (reduced ? BUILDUP_REDUCED_MS : BUILDUP_MS[rarity ?? "common"]);
export const restRevealMs = (rest: number, reduced: boolean): number => Math.max(0, rest) * (reduced ? REST_STAGGER_REDUCED_MS : REST_STAGGER_MS) + REST_SETTLE_MS;
