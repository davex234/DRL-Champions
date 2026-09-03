import type { CardDef, CardStatsSource, Player, VariantId, AccoladeId } from "@/domain/cards/types";
import { applyStatBoost } from "@/domain/cards/ovr";
import { getVariant, baseMetalForOvr } from "@/domain/cards/variants";
import {
  DATA_VERSION, computeCombatOvr, deriveCard, deriveCombat, type CombatStats,
} from "@/domain/cards/combat";
import { PLAYERS } from "./players";

/**
 * Marca de generación del catálogo. Es una constante del build, no un reloj vivo: dos
 * ejecuciones del mismo código producen el mismo catálogo, byte a byte.
 */
export const CATALOG_GENERATED_AT = "2026-08-31T00:00:00.000Z";

/** Mapea cada accolade a la(s) variante(s) que desbloquea. */
export function variantsForAccolade(acc: AccoladeId, player: Player): VariantId[] {
  const regionKey = player.region.toLowerCase() as "emea" | "americas" | "pacific" | "china";
  switch (acc) {
    case "masters":
      return ["masters"];
    case "champions":
      return ["champions"];
    case "ewc":
      return ["ewc"];
    case "regional-winner":
      return [`${regionKey}-winner` as VariantId];
    case "regional-mvp":
      return [`${regionKey}-mvp` as VariantId];
    case "masters-winner":
      return ["masters", "masters-winner"];
    case "masters-mvp":
      return ["masters", "masters-mvp"];
    case "champions-winner":
      return ["champions", "champions-winner"];
    case "champions-mvp":
      return ["champions", "champions-mvp"];
    case "ewc-winner":
      return ["ewc", "ewc-winner"];
    case "ewc-mvp":
      return ["ewc", "ewc-mvp"];
    case "prime":
      return ["prime"];
    case "game-changers":
      return ["game-changers"];
    case "icon":
      return ["icon-series"];
    case "hall-of-fame":
      return ["hall-of-fame"];
    case "tournament-mvp":
      return ["mythic"];
    case "tournament-champion":
      return ["champion-edition"];
    case "tournament-rookie":
      return ["rookie"];
    case "tournament-clutch":
      return ["clutch"];
    case "tournament-top-acs":
      return ["top-acs"];
    case "tournament-top-rating":
      return ["top-rating"];
    case "tournament-top-hs":
      return ["top-hs"];
    case "tournament-top-kills":
      return ["top-kills"];
    case "tournament-top-assists":
      return ["top-assist"];
    default:
      return [];
  }
}

/**
 * TRÍO BASE de un jugador (sin bonus de variante), con su origen.
 *
 * Dos vías, y solo dos: métricas reales derivadas por el dominio, o autoría editorial explícita.
 * Si no hay ninguna, se devuelve el MOTIVO — nunca estadísticas por defecto.
 */
export function playerCombatBase(
  player: Player,
): { ok: true; combat: CombatStats; source: CardStatsSource } | { ok: false; reason: string } {
  const derived = deriveCombat(player.metrics);
  if (derived.ok && derived.combat) return { ok: true, combat: derived.combat, source: "vlr" };

  // Vía editorial: jugadores retirados o históricos, autorizados a mano y con motivo.
  if (player.editorial) return { ok: true, combat: player.editorial.combat, source: "editorial" };

  return { ok: false, reason: derived.reason ?? "NO_METRICS" };
}

function buildCard(
  player: Player,
  variantId: VariantId,
  base: CombatStats,
  source: CardStatsSource,
  generatedAt: string,
): CardDef {
  const variant = getVariant(variantId);
  // ÚNICA ruta de cálculo: el dominio compone boost + OVR. Aquí no se hace matemática.
  const { combat, ovr } = deriveCard(base, variant.statBoost);
  return {
    id: `${player.id}__${variantId}`,
    playerId: player.id,
    variantId,
    // Las 6 estadísticas heredadas se conservan para el simulador y el pipeline de esports,
    // que quedan fuera del alcance del PDF. No participan en `ovr` ni en el combate.
    stats: applyStatBoost(player.stats, variant.statBoost),
    ovr,
    combat,
    statBoost: variant.statBoost,
    dataVersion: DATA_VERSION,
    source,
    generatedAt,
  };
}

/**
 * Genera TODAS las cartas de un jugador (base por metal + regional + variantes
 * de palmarés). Este es el "generador automático": añadir un jugador y obtener
 * todas sus cartas se reduce a llamar a esta función.
 *
 * Devuelve `[]` si el jugador no es elegible (sin métricas, o por debajo del mínimo de rondas).
 */
export function cardsForPlayer(player: Player, generatedAt = CATALOG_GENERATED_AT): CardDef[] {
  const base = playerCombatBase(player);
  if (!base.ok) return [];

  const variantIds = new Set<VariantId>();
  // El metal base lo decide el OVR del trío SIN bonus: es la gama real del jugador.
  variantIds.add(baseMetalForOvr(computeCombatOvr(base.combat)));
  variantIds.add(player.region.toLowerCase() as VariantId);
  for (const acc of player.accolades) {
    for (const v of variantsForAccolade(acc, player)) variantIds.add(v);
  }
  return [...variantIds].map((variantId) =>
    buildCard(player, variantId, base.combat, base.source, generatedAt),
  );
}

/**
 * OVR de un jugador para una variante concreta, SIN construir la carta.
 *
 * Es el único punto de entrada para quien necesite el OVR fuera del catálogo (generador de
 * torneos, admin, previsualizaciones). Evita que nadie recomponga `boost + OVR` por su cuenta.
 * Devuelve `null` si el jugador no es elegible.
 */
export function cardOvrFor(player: Player, variantId: VariantId): number | null {
  const base = playerCombatBase(player);
  if (!base.ok) return null;
  return deriveCard(base.combat, getVariant(variantId).statBoost).ovr;
}

/** Metal base (bronce/plata/oro) que corresponde al jugador por su trío sin bonus. */
export function baseMetalFor(player: Player): VariantId | null {
  const base = playerCombatBase(player);
  if (!base.ok) return null;
  return baseMetalForOvr(computeCombatOvr(base.combat));
}

/** Jugadores rechazados por el generador, con su motivo. Para auditar el catálogo. */
export function ineligiblePlayers(players: Player[]): { id: string; nick: string; reason: string }[] {
  const out: { id: string; nick: string; reason: string }[] = [];
  for (const p of players) {
    const base = playerCombatBase(p);
    if (!base.ok) out.push({ id: p.id, nick: p.nick, reason: base.reason });
  }
  return out;
}

function buildCatalog(players: Player[]): CardDef[] {
  const cards: CardDef[] = [];
  const seen = new Set<string>();
  for (const player of players) {
    for (const card of cardsForPlayer(player)) {
      if (!seen.has(card.id)) {
        seen.add(card.id);
        cards.push(card);
      }
    }
  }
  return cards;
}

/**
 * Catálogo del juego. Es DINÁMICO: arranca con los datos semilla y se
 * reconstruye cuando el panel de administración importa/edita jugadores
 * (vía `rebuildCatalog`). Se exportan como `let` para que los `import`
 * (bindings vivos) reflejen siempre el catálogo actual.
 */
export let CARDS: CardDef[] = buildCatalog(PLAYERS);
export let TOTAL_CARDS: number = CARDS.length;

let CARD_BY_ID = new Map(CARDS.map((c) => [c.id, c]));
let PLAYER_BY_ID = new Map(PLAYERS.map((p) => [p.id, p]));

/** Reconstruye el catálogo a partir de un roster efectivo (semilla + importados). */
export function rebuildCatalog(players: Player[]): void {
  CARDS = buildCatalog(players);
  TOTAL_CARDS = CARDS.length;
  CARD_BY_ID = new Map(CARDS.map((c) => [c.id, c]));
  PLAYER_BY_ID = new Map(players.map((p) => [p.id, p]));
}

export function getCard(id: string): CardDef | undefined {
  return CARD_BY_ID.get(id);
}

export function getPlayer(id: string): Player | undefined {
  return PLAYER_BY_ID.get(id);
}

export function allPlayers(): Player[] {
  return [...PLAYER_BY_ID.values()];
}

export function cardsByVariant(variantId: VariantId): CardDef[] {
  return CARDS.filter((c) => c.variantId === variantId);
}

export function totalCards(): number {
  return CARDS.length;
}
