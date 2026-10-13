/**
 * MAESTRÍA DE COLECCIÓN (Fase 13) — dominio PURO, derivado del catálogo.
 *
 * ────────────────────────── EL PROBLEMA QUE RESUELVE ──────────────────────────
 *
 * La Fase 11 lo detectó y la Fase 12 lo midió: **un jugador intensivo llega al 91 % del
 * catálogo y se queda sin nada que hacer.** El único sumidero son los sobres, y cuando ya
 * no quieres sobres, los créditos se acumulan sin destino y la colección deja de dar
 * objetivos.
 *
 * «Completar la colección» tampoco sirve como meta: son 772 cartas. Un objetivo que tarda
 * una temporada en moverse no orienta una sesión de juego.
 *
 * ────────────────────────── LA MATERIA PRIMA, MEDIDA ──────────────────────────
 *
 * `npm run content:audit` mide qué conjuntos existen ya en el catálogo, sin inventar nada:
 *
 *   Por región     4 conjuntos de 182–204 cartas   → demasiado grandes para ser una meta
 *   Por equipo    66 conjuntos de   6–25 cartas    → **esto sí es un objetivo**
 *   Por variante  25 conjuntos de   1–168 cartas   → sirven los pequeños
 *   Por jugador  353 conjuntos de   2–8 cartas     → demasiados y demasiado triviales
 *
 * De ahí salen los tres ejes de esta capa, y ninguno se ha inventado: son agrupaciones que
 * ya existían en los datos y que nadie había convertido en un objetivo.
 *
 * ────────────────────────── LA REGLA ECONÓMICA ──────────────────────────
 *
 * **La maestría NO paga un solo crédito.** Ni uno.
 *
 * Es deliberado y es la condición para que esta capa exista. La Fase 12 dejó medido que el
 * grifo de temporada son 124.900 créditos no repetibles; añadir 66 objetivos que pagaran
 * aunque fuera 500 créditos cada uno serían 33.000 más, un +26 %, y habríamos resuelto el
 * problema del endgame inflando la economía que acabábamos de calibrar.
 *
 * Lo que paga es **reconocimiento**: insignias, títulos y marcos. Cosméticos, que es lo
 * único que la Fase 12 dejó preparado para monetizar (§29) y lo único que no distorsiona
 * ningún precio.
 *
 * ────────────────────────── LAS INSIGNIAS NO SE ESCRIBEN A MANO ──────────────────────────
 *
 * 66 equipos son 66 insignias. Escribirlas una a una sería contenido muerto en cuanto
 * llegara un equipo nuevo. En su lugar, el id se DERIVA del conjunto
 * (`insignia:equipo:<equipo>`), y `domain/cosmetics/catalog` sabe pintar un cosmético que
 * no conoce a partir de su propio id. Un equipo nuevo trae su insignia sin que nadie la
 * escriba.
 */
import { CARDS, getPlayer } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";
import { bucketForRank, type RarityBucket } from "@/domain/packs/types";
import type { Reward } from "@/domain/events/types";
import { canonicalCardTeam } from "@/data/teamIdentities";

export type MasteryAxis = "equipo" | "region" | "variante" | "rareza";

export interface MasterySet {
  id: string;
  axis: MasteryAxis;
  /** Nombre visible. Sale del dato (el equipo, la región…), no de una lista escrita a mano. */
  label: string;
  /** Ids de carta que hay que reunir. */
  cardIds: string[];
  /** Escalones: fracción del conjunto → recompensa. Siempre cosmética. */
  tiers: MasteryTier[];
}

export interface MasteryTier {
  /** Fracción del conjunto, de 0 a 1. */
  at: number;
  label: string;
  reward: Reward;
}

/** Conjuntos con menos de esto no son un objetivo: se consiguen sin proponérselo. */
export const MIN_SET_SIZE = 5;

/**
 * Los escalones de un conjunto pequeño (equipos, variantes). Dos: la mitad y el pleno.
 *
 * Dos y no cinco a propósito: un objetivo con cinco escalones deja de ser un objetivo y
 * pasa a ser una barra de progreso. La mitad reconoce que vas en serio; el pleno es el
 * premio.
 */
function smallTiers(setId: string, label: string): MasteryTier[] {
  return [
    { at: 0.5, label: `${label} · a medias`, reward: { cosmetics: [`insignia:${setId}-medio`] } },
    { at: 1, label: `${label} · completo`, reward: { cosmetics: [`insignia:${setId}`] } },
  ];
}

/**
 * Los de una región son de 182 a 204 cartas: ahí sí tiene sentido escalonar, porque el
 * recorrido es largo y necesita hitos por el camino. El pleno da además un TÍTULO, que es
 * el cosmético más visible que hay.
 */
function regionTiers(setId: string, label: string): MasteryTier[] {
  return [
    { at: 0.25, label: `${label} · 25 %`, reward: { cosmetics: [`insignia:${setId}-25`] } },
    { at: 0.5, label: `${label} · 50 %`, reward: { cosmetics: [`insignia:${setId}-50`] } },
    { at: 0.75, label: `${label} · 75 %`, reward: { cosmetics: [`insignia:${setId}-75`] } },
    { at: 1, label: `${label} · completo`, reward: { cosmetics: [`insignia:${setId}`, `titulo:${setId}`] } },
  ];
}

const slug = (s: string): string =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * Construye los conjuntos a partir del catálogo VIVO.
 *
 * Se calcula una vez y se cachea contra la longitud del catálogo: `rebuildCatalog` puede
 * cambiarlo en caliente (publicaciones, importaciones), y una lista de objetivos que se
 * quedara con el catálogo viejo enseñaría metas imposibles.
 */
function build(): MasterySet[] {
  const sets: MasterySet[] = [];

  // ── Por equipo. El eje principal: 66 conjuntos de tamaño humano. ──
  // Agrupa por el equipo canónico de la CARTA (`canonicalCardTeam`: el impreso en el catálogo diseñado),
  // así «TH» y «Team Heretics» son un conjunto y Derke, con VIT impreso, cuenta para Team Vitality. El id
  // es `equipo:<slug de la etiqueta>`: para los equipos de siempre coincide con el de antes.
  const byTeam = new Map<string, string[]>();
  for (const c of CARDS) {
    const p = getPlayer(c.playerId);
    if (!p) continue;
    const { label } = canonicalCardTeam(c, p);
    const list = byTeam.get(label) ?? [];
    list.push(c.id);
    byTeam.set(label, list);
  }
  for (const [team, cardIds] of [...byTeam.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (cardIds.length < MIN_SET_SIZE) continue;
    const id = `equipo:${slug(team)}`;
    sets.push({ id, axis: "equipo", label: team, cardIds, tiers: smallTiers(id, team) });
  }

  // ── Por región. Cuatro recorridos largos con hitos. ──
  const byRegion = new Map<string, string[]>();
  for (const c of CARDS) {
    const p = getPlayer(c.playerId);
    if (!p) continue;
    const list = byRegion.get(p.region) ?? [];
    list.push(c.id);
    byRegion.set(p.region, list);
  }
  for (const [region, cardIds] of [...byRegion.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (cardIds.length < MIN_SET_SIZE) continue;
    const id = `region:${slug(region)}`;
    sets.push({ id, axis: "region", label: region, cardIds, tiers: regionTiers(id, region) });
  }

  // ── Por variante. Solo las que son un objetivo alcanzable y no la mitad del catálogo. ──
  const byVariant = new Map<string, string[]>();
  for (const c of CARDS) {
    const list = byVariant.get(c.variantId) ?? [];
    list.push(c.id);
    byVariant.set(c.variantId, list);
  }
  for (const [variantId, cardIds] of [...byVariant.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    /*
     * Se descartan por los dos extremos: menos de 5 se consigue sin querer, y más de 60 es
     * un maratón (las metálicas base y las regionales, que son casi el catálogo entero). El techo
     * es 60 o el 15 % del catálogo si es menor: con el catálogo diseñado (329 cartas) 60 sería
     * casi una quinta parte de la colección, justo lo que esta capa no quiere.
     */
    if (cardIds.length < MIN_SET_SIZE || cardIds.length > 60 || cardIds.length >= CARDS.length * 0.15) continue;
    const v = getVariant(variantId as never);
    const id = `variante:${slug(variantId)}`;
    sets.push({ id, axis: "variante", label: v.label, cardIds, tiers: smallTiers(id, v.label) });
  }

  // ── Por rareza alta. Dos conjuntos cortos y muy difíciles: son el techo real. ──
  const byBucket = new Map<RarityBucket, string[]>();
  for (const c of CARDS) {
    const b = bucketForRank(getVariant(c.variantId).rank);
    const list = byBucket.get(b) ?? [];
    list.push(c.id);
    byBucket.set(b, list);
  }
  for (const b of ["epic", "legendary"] as RarityBucket[]) {
    const cardIds = byBucket.get(b) ?? [];
    if (cardIds.length < MIN_SET_SIZE) continue;
    const label = b === "epic" ? "Todas las épicas" : "Todas las legendarias";
    const id = `rareza:${b}`;
    sets.push({ id, axis: "rareza", label, cardIds, tiers: smallTiers(id, label) });
  }

  return sets;
}

let CACHE: { size: number; sets: MasterySet[] } | null = null;

export function masterySets(): MasterySet[] {
  if (!CACHE || CACHE.size !== CARDS.length) CACHE = { size: CARDS.length, sets: build() };
  return CACHE.sets;
}

export function masterySet(id: string): MasterySet | null {
  return masterySets().find((s) => s.id === id) ?? null;
}

export interface MasteryProgress {
  set: MasterySet;
  owned: number;
  total: number;
  /** Escalones alcanzados, en orden. */
  reached: MasteryTier[];
  /** El siguiente, o `null` si ya está el pleno. */
  next: MasteryTier | null;
  /** Cuántas cartas faltan para el siguiente escalón. */
  toNext: number;
}

/**
 * Progreso de un conjunto contra las cartas que se poseen.
 *
 * Recibe un `Set` de ids: quien llama decide de dónde salen (del servidor, del store local
 * sin cuenta). Este módulo no sabe de sesiones ni de bases de datos, y por eso se puede
 * probar sin ninguna de las dos.
 */
export function progressFor(set: MasterySet, owned: Set<string>): MasteryProgress {
  const have = set.cardIds.reduce((n, id) => n + (owned.has(id) ? 1 : 0), 0);
  const frac = set.cardIds.length === 0 ? 0 : have / set.cardIds.length;
  const reached = set.tiers.filter((t) => frac >= t.at);
  const next = set.tiers.find((t) => frac < t.at) ?? null;
  const toNext = next === null ? 0 : Math.max(0, Math.ceil(next.at * set.cardIds.length) - have);
  return { set, owned: have, total: set.cardIds.length, reached, next, toNext };
}

/** Clave de idempotencia y, a la vez, id con el que se guarda en `user_achievements`. */
export const masteryRef = (setId: string, at: number): string =>
  `mastery:${setId}:${Math.round(at * 100)}`;

/**
 * Todo lo que la maestría puede repartir. Se usa en la vitrina y en la prueba que
 * comprueba que **no hay un solo crédito** en toda la capa.
 */
export function allMasteryRewards(): Reward[] {
  return masterySets().flatMap((s) => s.tiers.map((t) => t.reward));
}
