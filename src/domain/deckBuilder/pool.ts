/**
 * PANEL DE COLECCIÓN DEL CONSTRUCTOR (Fase 32) — filtro y orden sobre la colección REAL. PURO.
 *
 * Reutiliza Collection 2.0: el filtro de texto/rol/OVR es `applyFilter` (`@/collection`), el mismo que
 * usa `/coleccion`, aplicado a una proyección `CardView` de cada EJEMPLAR que llegó del servidor. No se
 * construye un segundo buscador: solo se añaden los criterios que dependen de la instancia (equipo,
 * rareza por `bucketForRank`, copias repetidas) y el orden «más reciente» por fecha de obtención.
 *
 * La proyección sale de la foto del servidor y no del catálogo de código: una carta del catálogo
 * persistido que el código no conozca sigue apareciendo.
 */
import { applyFilter } from "@/collection";
import type { CardView } from "@/collection/types";
import { getVariant } from "@/domain/cards/variants";
import type { PlayerStats, RoleId } from "@/domain/cards/types";
import { bucketForRank, type RarityBucket } from "@/domain/packs/types";
import { byOvr, type BuilderCard } from "./builder";

export type PoolSort = "ovr" | "name" | "rarity" | "recent";

export interface PoolFilter {
  text: string;
  role: RoleId | "";
  team: string;
  rarity: RarityBucket | "";
  minOvr: number;
  /** Solo cartas de las que tienes más de un ejemplar. */
  duplicates: boolean;
}

export const EMPTY_FILTER: PoolFilter = { text: "", role: "", team: "", rarity: "", minOvr: 0, duplicates: false };

export const SORTS: { id: PoolSort; label: string }[] = [
  { id: "ovr", label: "OVR" },
  { id: "name", label: "Nombre" },
  { id: "rarity", label: "Rareza" },
  { id: "recent", label: "Recientes" },
];

export const RARITIES: RarityBucket[] = ["legendary", "epic", "rare", "uncommon", "common"];

export const rarityOf = (c: Pick<BuilderCard, "variantId">): RarityBucket => bucketForRank(getVariant(c.variantId).rank);

const NO_STATS = {} as PlayerStats;

type UidView = CardView & { uid: string };

/** Proyección `CardView` de un ejemplar (lo que `applyFilter` lee: nick, equipo, variante, rol, OVR). */
export function viewOf(c: BuilderCard, count: number): UidView {
  const v = getVariant(c.variantId);
  const view: UidView = {
    uid: c.uid,
    cardId: c.cardId, playerId: c.playerId, variantId: c.variantId, nick: c.nick, team: c.team, teamTag: "",
    region: c.region, role: c.role, country: c.country, label: v.label, group: v.group, rank: v.rank, ovr: c.ovr,
    stats: NO_STATS, serialized: v.serialized, serialLimit: v.serialLimit ?? null,
    owned: true, count, bestSerial: c.serial ?? null, favorite: false, hidden: false, tags: [],
  } as UidView;
  return view;
}

export function copiesByCard(cards: readonly BuilderCard[]): Map<string, number> {
  const m = new Map<string, number>();
  // COLECCIONES ILIMITADAS · si el servidor dice cuántas copias hay, manda; si no, se cuentan los ejemplares del pool.
  const told = new Map<string, number>();
  for (const c of cards) {
    m.set(c.cardId, (m.get(c.cardId) ?? 0) + 1);
    if (typeof c.copies === "number") told.set(c.cardId, Math.max(told.get(c.cardId) ?? 0, c.copies));
  }
  for (const [id, n] of told) m.set(id, Math.max(n, m.get(id) ?? 0));
  return m;
}

export const teamsOf = (cards: readonly BuilderCard[]): string[] =>
  [...new Set(cards.map((c) => c.team).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));

const SORT: Record<PoolSort, (a: BuilderCard, b: BuilderCard) => number> = {
  ovr: byOvr,
  name: (a, b) => a.nick.localeCompare(b.nick, "es") || byOvr(a, b),
  rarity: (a, b) => getVariant(b.variantId).rank - getVariant(a.variantId).rank || byOvr(a, b),
  recent: (a, b) => b.obtainedAt - a.obtainedAt || byOvr(a, b),
};

/** Filtra y ordena los ejemplares. Solo trabaja con lo que el servidor dijo que es tuyo. */
export function filterPool(cards: readonly BuilderCard[], f: PoolFilter, sort: PoolSort): BuilderCard[] {
  const copies = copiesByCard(cards);
  const views = cards.map((c) => viewOf(c, copies.get(c.cardId) ?? 1));
  const kept = applyFilter(views, {
    text: f.text.trim() || undefined,
    roles: f.role ? [f.role] : undefined,
    minOvr: f.minOvr > 0 ? f.minOvr : undefined,
    owned: true,
  }) as UidView[];
  const allowed = new Set(kept.map((v) => v.uid));
  return cards
    .filter((c) => allowed.has(c.uid))
    .filter((c) => !f.team || c.team === f.team)
    .filter((c) => !f.rarity || rarityOf(c) === f.rarity)
    .filter((c) => !f.duplicates || (copies.get(c.cardId) ?? 0) > 1)
    .sort(SORT[sort]);
}

export const isFiltered = (f: PoolFilter): boolean =>
  !!(f.text.trim() || f.role || f.team || f.rarity || f.minOvr > 0 || f.duplicates);
