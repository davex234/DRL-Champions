/**
 * IDENTIDAD DE PRODUCTO DEL SOBRE — la familia, sus categorías y sus variantes.
 *
 * ────────────────────────── EL PROBLEMA ──────────────────────────
 *
 * Los sobres del catálogo se distinguían en UNA sola variable: `accent`, su color. El Sobre
 * Inicial y el Sobre Icon eran el mismo objeto pintado de cian y de hueso. Un sobre de 20.000
 * créditos que se lee igual que el gratuito no comunica lo que es, y la tienda tenía que
 * explicarlo con texto porque el objeto no lo decía.
 *
 * Aquí vive lo que la interfaz necesita saber para dibujar CADA producto: su categoría, su
 * símbolo, su material, su artwork y —si es un sobre de equipo— el escudo que le corresponde.
 *
 * ══════════════════════════ DOS EJES, NO UNO ══════════════════════════
 *
 * **CATEGORÍA** — *qué clase de producto es*. Decide el SÍMBOLO y el rótulo.
 * **ESCALÓN** (`tier`) — *cuánto promete*. Decide el MATERIAL (foil, anillos, barrido…).
 *
 * Separarlos es lo que permite que un Sobre Champions y un Sobre Icon se parezcan en material
 * (los dos son la cúspide) y no se confundan (uno es competición, el otro es colección). Con
 * un solo eje habría hecho falta una entrada por sobre, que es la tabla que esto evita.
 *
 * ══════════════════════════ TODO SE DERIVA DE DATOS REALES ══════════════════════════
 *
 * Ni una regla por `packId`. La categoría sale de los campos que el catálogo YA declara, en
 * este orden de especificidad:
 *
 *     pack.team                        → `team`      (homenaje a un equipo)
 *     pack.eventId                     → `event`     (pertenece a un evento real)
 *     pack.guaranteedMin = legendary   → `icono`     (el único que promete legendaria)
 *     pack.price = 0                   → `inicial`   (el sobre de bienvenida)
 *     pack.restrictRegion              → `regional`  (sortea en una sola región)
 *     resto                            → `nexus`     (el producto base de la casa)
 *
 * Y el escalón, de la GARANTÍA que el sobre declara (`guaranteedMin`). Deliberadamente **no**
 * del precio: el precio cambia en cada rebalanceo y la identidad de un objeto no puede cambiar
 * porque se ajuste una tarifa.
 *
 * ══════════════════════════ LO QUE ESTO NO ES ══════════════════════════
 *
 * **No decide qué carta sale.** No toca pesos, pools ni probabilidades: el sorteo es entero de
 * `domain/packs/openPack`, y el sesgo de un Team Pack vive en un pool persistido. Un sobre
 * `legend` no tiene mejores probabilidades por ser `legend`: es `legend` PORQUE el catálogo ya
 * declaraba esa garantía.
 *
 * Y no es una segunda tabla de sobres: no hay una entrada por `packId`, hay funciones de la
 * forma del `PackDef`. Un sobre nuevo obtiene identidad el día que entra en el catálogo, sin
 * tocar este fichero. `packs.test.tsx` lo comprueba sobre el catálogo entero.
 */
import type { PackDef, RarityBucket } from "@/domain/packs/types";
import { bucketForRank } from "@/domain/packs/types";
import { packArtwork } from "@/data/packArtwork";
import { getTeam } from "@/data/teams";
import { PLAYERS } from "@/data/players";
import { CARDS } from "@/data/catalog";
import { isTeamPackCard } from "@/data/teamIdentities";
import { getVariant } from "@/domain/cards/variants";

/** Los cuatro escalones de material. Ordenados de menor a mayor ambición. */
export type PackTier = "base" | "premium" | "elite" | "legend";

export const TIER_ORDER: PackTier[] = ["base", "premium", "elite", "legend"];

/** Qué CLASE de producto es. Decide el símbolo y el rótulo, nunca el sorteo. */
export type PackCategory = "inicial" | "nexus" | "regional" | "team" | "event" | "icono";

/** El símbolo del troquel. Uno por categoría: es lo que hace que dos sobres no sean el mismo. */
export type PackSigilKind = "nexus" | "ascent" | "meridian" | "crest" | "laurel" | "medal";

export interface PackIdentity {
  category: PackCategory;
  tier: PackTier;
  /** Rótulo corto de la categoría, para la vitrina y el carril. */
  categoryLabel: string;
  /** Qué símbolo dibuja `PackSigil`. */
  sigil: PackSigilKind;
  /**
   * Monograma del troquel: las siglas del equipo en un Team Pack. `null` en los demás — el
   * símbolo ya los identifica y un monograma inventado no diría nada.
   */
  monogram: string | null;
  /** Fichero de artwork del sobre, o `null` si todavía no ha llegado. */
  artwork: string | null;

  // ── Material (el escalón) ──
  /** Densidad de las bandas de foil. Un sobre alto tiene más material por donde corre la luz. */
  foil: number;
  /** Anillos del troquel. Uno es un sello; tres son una acuñación. */
  rings: number;
  /** El sigilo lleva relleno degradado (solo la parte alta de la escalera). */
  richSigil: boolean;
  /** Intensidad del resplandor de fondo del objeto. */
  bloom: number;
  /** Barrido especular continuo. En los bajos no existe: un sobre mate no brilla. */
  sweep: boolean;
  /** Cantoneras troqueladas en las esquinas. */
  corners: boolean;
}

const MATERIAL: Record<PackTier, Pick<PackIdentity, "foil" | "rings" | "richSigil" | "bloom" | "sweep" | "corners">> = {
  base:    { foil: 0.55, rings: 1, richSigil: false, bloom: 0.34, sweep: false, corners: false },
  premium: { foil: 0.8,  rings: 1, richSigil: true,  bloom: 0.42, sweep: true,  corners: true },
  elite:   { foil: 1.0,  rings: 2, richSigil: true,  bloom: 0.5,  sweep: true,  corners: true },
  legend:  { foil: 1.25, rings: 3, richSigil: true,  bloom: 0.6,  sweep: true,  corners: true },
};

const CATEGORY: Record<PackCategory, { label: string; sigil: PackSigilKind }> = {
  inicial:  { label: "Bienvenida", sigil: "ascent" },
  nexus:    { label: "Nexus",      sigil: "nexus" },
  regional: { label: "Regional",   sigil: "meridian" },
  team:     { label: "Equipo",     sigil: "crest" },
  event:    { label: "Evento",     sigil: "laurel" },
  icono:    { label: "Icono",      sigil: "medal" },
};

/** El escalón que declara la garantía del sobre. Sin garantía, es un sobre base. */
export function tierForPack(pack: Pick<PackDef, "guaranteedMin">): PackTier {
  const byGuarantee: Partial<Record<RarityBucket, PackTier>> = {
    rare: "premium",
    epic: "elite",
    legendary: "legend",
  };
  return (pack.guaranteedMin && byGuarantee[pack.guaranteedMin]) || "base";
}

/** La clase de producto, derivada de lo que el catálogo declara. De más específico a menos. */
export function categoryForPack(
  pack: Pick<PackDef, "team" | "eventId" | "guaranteedMin" | "price" | "restrictRegion">,
): PackCategory {
  if (pack.team) return "team";
  if (pack.eventId) return "event";
  if (pack.guaranteedMin === "legendary") return "icono";
  if (pack.price === 0) return "inicial";
  if (pack.restrictRegion) return "regional";
  return "nexus";
}

/**
 * SIGLAS DEL EQUIPO. Salen del registro de equipos cuando está, y si no, del propio nombre.
 *
 * Hace falta el respaldo porque `Player.team` no es homogéneo: unos equipos se guardan con el
 * nombre completo («Team Heretics», «Fnatic») y otros con su etiqueta («NAVI», «G2»), así que
 * `getTeam("NAVI")` no encuentra nada — su clave en `data/teams.ts` es «Natus Vincere». En ese
 * caso el propio valor YA es la etiqueta, y usarlo es leer el dato, no inventarlo.
 *
 * Queda anotado como deuda de datos en el informe de la fase; homogeneizar `Player.team`
 * tocaría el catálogo de jugadores, que esta fase no abre.
 */
export function teamMonogram(team: string): string {
  const def = getTeam(team);
  if (def) return def.tag;
  return team.length <= 4 ? team.toUpperCase() : team.slice(0, 3).toUpperCase();
}

/** La receta visual completa de un sobre. Presentación pura. */
export function packIdentity(
  pack: Pick<PackDef, "id" | "guaranteedMin" | "team" | "eventId" | "price" | "restrictRegion">,
): PackIdentity {
  const tier = tierForPack(pack);
  const category = categoryForPack(pack);
  const cat = CATEGORY[category];
  return {
    category,
    tier,
    categoryLabel: cat.label,
    sigil: cat.sigil,
    monogram: pack.team ? teamMonogram(pack.team) : null,
    artwork: packArtwork(pack.id),
    ...MATERIAL[tier],
  };
}

/**
 * CUÁNTAS CARTAS DE ESTE EQUIPO EXISTEN DE VERDAD, y de qué rareza.
 *
 * Es el dato que convierte «más probabilidad de cartas de Fnatic» en algo comprobable. Cuenta las
 * cartas con el equipo IMPRESO del sobre (`isTeamPackCard`, la misma regla del sesgo): con el
 * catálogo diseñado, Team Heretics tiene 11 y Fnatic 6, y la tienda no insinúa que sean iguales.
 *
 * Se DERIVA del catálogo en cada llamada; no hay una cifra escrita a mano que pueda quedarse
 * mintiendo cuando entren cartas nuevas. Y es un RECUENTO, no una probabilidad: lo que cada
 * carta pesa en el sorteo lo decide el pool persistido, no esto.
 */
export function teamCardCount(team: string): { total: number; porRareza: Partial<Record<RarityBucket, number>> } {
  const byId = new Map(PLAYERS.map((p) => [p.id, p]));
  const porRareza: Partial<Record<RarityBucket, number>> = {};
  let total = 0;
  for (const c of CARDS) {
    if (!isTeamPackCard(c, byId.get(c.playerId), team)) continue;
    total += 1;
    const b = bucketForRank(getVariant(c.variantId).rank);
    porRareza[b] = (porRareza[b] ?? 0) + 1;
  }
  return { total, porRareza };
}
