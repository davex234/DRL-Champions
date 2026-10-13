/**
 * COLECCIÓN POR EQUIPO (Fase 21.3, §8).
 *
 * Proyección PURA y de solo lectura de «cuánto llevo de cada equipo», derivada de datos que ya
 * existen: las cartas que posee el usuario (`OwnedCard[]` del store), el catálogo (`CARDS`), las
 * identidades de equipo (`teamIdentities`) y las mismas fórmulas de valor y rareza que usa el
 * resto de NEXUS. **No crea un segundo sistema de equipos, de mint ni de seriales; no recalcula
 * OVR ni el valor de mercado.** Solo agrupa y cuenta.
 *
 * El grupo es el equipo canónico de la CARTA (`canonicalCardTeam`: el impreso en el catálogo diseñado),
 * igual que maestría, logros y colección. Team Heretics no es un caso especial: es un equipo más.
 */
import type { CardDef, OwnedCard } from "@/domain/cards/types";
import { CARDS, getPlayer } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";
import { bucketForRank, type RarityBucket } from "@/domain/packs/types";
import { instanceValue } from "@/domain/economy/pricing";
import { canonicalCardTeam } from "@/data/teamIdentities";

/** Una casilla de carta dentro de un equipo: la definición + cuántas copias posee y su mejor serie. */
export interface TeamCardCell {
  cardId: string;
  def: CardDef;
  /** uid del ejemplar representado (el de serie más baja): con él, `CardVisual` pinta SU artwork. */
  uid: string;
  /** Copias que posee el usuario de esta carta (>1 ⇒ duplicada). */
  count: number;
  /** Serie más baja poseída (si la variante es serializada). Real, del ejemplar; nunca inventada. */
  serial?: number;
  /** Valor de la instancia representada (misma fórmula del dominio; no se recalcula aquí). */
  value: number;
  bucket: RarityBucket;
  /** Instante de obtención más reciente entre las copias (para ordenar por «reciente»). */
  obtainedAt: number;
}

export interface TeamCollectionEntry {
  /**
   * Clave canónica del equipo de la CARTA (catálogo diseñado: el equipo impreso), la misma que usan
   * maestría, logros y colección. «FNATIC» y la plantilla «FNC» son un equipo; Derke con VIT impreso, otro.
   */
  team: string;
  /** Etiqueta para mostrar (de `teamIdentities` si resuelve; si no, el propio `team`). */
  displayName: string;
  /** Sigla corta si la identidad la tiene. */
  tag?: string;
  region?: string;
  /** Cartas del equipo que existen en el catálogo. */
  total: number;
  /** Cartas DISTINTAS del equipo que posee el usuario. */
  ownedDistinct: number;
  /** Copias totales que posee (incluye duplicados). */
  ownedCopies: number;
  /** Progreso 0..1. */
  progress: number;
  /** Solo las casillas que el usuario POSEE, ordenadas por rareza desc y luego OVR. */
  cards: TeamCardCell[];
}

/** Clave canónica del equipo de una carta del catálogo. */
const teamOfCard = (c: CardDef) => canonicalCardTeam(c, getPlayer(c.playerId));

/** Total de cartas del catálogo por equipo canónico (denominador REAL; no se inventa). */
export function teamTotals(): Map<string, number> {
  const totals = new Map<string, number>();
  for (const c of CARDS) {
    const { key } = teamOfCard(c);
    totals.set(key, (totals.get(key) ?? 0) + 1);
  }
  return totals;
}

/**
 * Construye la colección por equipo del usuario. `ownedOnly` (por defecto) devuelve solo los
 * equipos de los que posee al menos una carta; con `false`, todos los equipos del catálogo.
 */
export function buildTeamCollection(owned: OwnedCard[], opts: { includeEmpty?: boolean } = {}): TeamCollectionEntry[] {
  const totals = teamTotals();

  // Copias poseídas por cardId.
  const byCard = new Map<string, OwnedCard[]>();
  for (const o of owned) {
    const list = byCard.get(o.cardId) ?? [];
    list.push(o);
    byCard.set(o.cardId, list);
  }

  const entries: TeamCollectionEntry[] = [];
  for (const [team, total] of totals) {
    // Cartas del catálogo de este equipo.
    const teamCards: CardDef[] = CARDS.filter((c) => teamOfCard(c).key === team);

    const cells: TeamCardCell[] = [];
    for (const def of teamCards) {
      const copies = byCard.get(def.id);
      if (!copies || copies.length === 0) continue; // solo lo que posee
      const sorted = [...copies].sort((a, b) => (a.serial ?? Infinity) - (b.serial ?? Infinity));
      const rep = sorted[0];
      cells.push({
        cardId: def.id,
        def,
        uid: rep.uid,
        count: copies.length,
        serial: rep.serial,
        value: instanceValue(def, rep.serial),
        bucket: bucketForRank(getVariant(def.variantId).rank),
        obtainedAt: Math.max(...copies.map((c) => c.obtainedAt)),
      });
    }

    if (cells.length === 0 && !opts.includeEmpty) continue;

    cells.sort((a, b) =>
      getVariant(b.def.variantId).rank - getVariant(a.def.variantId).rank || b.def.ovr - a.def.ovr,
    );

    const canon = teamCards[0] ? teamOfCard(teamCards[0]) : { key: team, label: team, identity: undefined };
    const identity = canon.identity;
    const player0 = getPlayer(teamCards[0]?.playerId ?? "");
    entries.push({
      team,
      displayName: canon.label,
      tag: identity?.tag,
      region: identity?.region ?? player0?.region,
      total,
      ownedDistinct: cells.length,
      ownedCopies: cells.reduce((s, c) => s + c.count, 0),
      progress: total > 0 ? cells.length / total : 0,
      cards: cells,
    });
  }

  // Orden: primero por nº de cartas poseídas (desc), luego alfabético.
  entries.sort((a, b) => b.ownedDistinct - a.ownedDistinct || a.displayName.localeCompare(b.displayName));
  return entries;
}

/** Ordenaciones disponibles para las cartas de un equipo (§5), sobre datos que ya existen. */
export type TeamCardSort = "rareza" | "ovr" | "valor" | "reciente" | "jugador";

export function sortTeamCards(cards: TeamCardCell[], sort: TeamCardSort): TeamCardCell[] {
  const out = [...cards];
  switch (sort) {
    case "ovr": out.sort((a, b) => b.def.ovr - a.def.ovr); break;
    case "valor": out.sort((a, b) => b.value - a.value); break;
    case "reciente": out.sort((a, b) => b.obtainedAt - a.obtainedAt); break;
    case "jugador":
      out.sort((a, b) => (getPlayer(a.def.playerId)?.nick ?? "").localeCompare(getPlayer(b.def.playerId)?.nick ?? ""));
      break;
    case "rareza":
    default:
      out.sort((a, b) => getVariant(b.def.variantId).rank - getVariant(a.def.variantId).rank || b.def.ovr - a.def.ovr);
  }
  return out;
}
