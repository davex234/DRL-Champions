import type { CardDef, CardStatsSource, Player, VariantId, AccoladeId } from "@/domain/cards/types";
import { applyStatBoost } from "@/domain/cards/ovr";
import { getVariant, baseMetalForOvr } from "@/domain/cards/variants";
import {
  DATA_VERSION, computeCombatOvr, deriveCard, deriveCombat, type CombatStats,
} from "@/domain/cards/combat";
import { PLAYERS } from "./players";
import { CARD_MANIFEST } from "./cardCatalog";
import { printedTeamTag } from "./teamText";
import type { CardManifestEntry, RoleId } from "@/domain/cards/types";

/**
 * Marca de generación del catálogo. Es una constante del build, no un reloj vivo: dos
 * ejecuciones del mismo código producen el mismo catálogo, byte a byte.
 */
export const CATALOG_GENERATED_AT = "2026-09-21T00:00:00.000Z";

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

/**
 * UNA CARTA DEL CATÁLOGO DISEÑADO (`Cartas\` → `src/data/cardCatalog.ts`).
 *
 * Lo IMPRESO manda (decisión del usuario, 2026-09-21): OVR, rol y las 6 estadísticas de la carta.
 * El trío de combate NO se imprime y NO se inventa: sale de las métricas reales del jugador por la
 * única ruta del dominio (`playerCombatBase` → `deriveCard`), sin bonus por edición. Una carta cuyo
 * jugador no es elegible no entra (devuelve `null`): el importador ya las deja fuera.
 */
export function cardFromManifest(entry: CardManifestEntry, player: Player, generatedAt = CATALOG_GENERATED_AT): CardDef | null {
  const base = playerCombatBase(player);
  if (!base.ok) return null;
  const variant = getVariant(entry.variantId as VariantId);
  const { combat } = deriveCard(base.combat, variant.statBoost);
  const role = entry.role as RoleId;
  return {
    id: entry.id,
    playerId: player.id,
    variantId: variant.id,
    ovr: entry.ovr,
    // Las 6 estadísticas heredadas del JUGADOR (modelo anterior, con COM) siguen aquí porque las
    // consumen el simulador y la suma de control; lo que se ENSEÑA es `printed.stats`.
    stats: applyStatBoost(player.stats, 0),
    combat,
    statBoost: variant.statBoost,
    dataVersion: DATA_VERSION,
    source: base.source,
    generatedAt,
    printed: { ovr: entry.ovr, role, stats: { ...entry.stats } },
    role,
    image: `/cards/${entry.id}.webp`,
    team: printedTeamTag(entry.source),
  };
}

/**
 * El catálogo: una carta por entrada del manifiesto cuyo jugador esté en el roster efectivo.
 * Ya NO se generan cartas por jugador × variante (eso era el catálogo anterior, retirado el
 * 2026-09-21); `cardsForPlayer` sigue existiendo para las herramientas de torneo y de admin.
 */
function buildCatalog(players: Player[]): CardDef[] {
  const byId = new Map(players.map((p) => [p.id, p]));
  const cards: CardDef[] = [];
  const seen = new Set<string>();
  for (const entry of CARD_MANIFEST) {
    const player = byId.get(entry.playerId);
    if (!player || seen.has(entry.id)) continue;
    const card = cardFromManifest(entry, player);
    if (!card) continue;
    seen.add(card.id);
    cards.push(card);
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

/**
 * DA DE ALTA EN EL CATÁLOGO DEL CLIENTE LAS CARTAS QUE SOLO EXISTEN EN EL SERVIDOR.
 *
 * ────────────────────────── QUÉ PROBLEMA CIERRA ──────────────────────────
 *
 * Este catálogo se construye con `buildCatalog(PLAYERS)`, es decir, con el roster COMPILADO
 * en el bundle. Desde el bloque 8.4.2 un administrador puede crear una carta desde el panel:
 * esa carta vive en `content_cards`, el servidor la reparte en sobres y la acuña — pero
 * `getCard()` no la conoce, y todas las pantallas del jugador la descartan en silencio
 * (`return []`, `if (!def) return null`, `.filter(x => !!x.def)`).
 *
 * Medido antes de esta función: un jugador con 32 ejemplares de una carta creada desde el
 * panel veía la cabecera de su álbum decir «CONSEGUIDAS 4» y la rejilla pintar 3. Y el
 * revelado del sobre se saltaba la carta, porque `toOpenedResults` también hace `if (!card)
 * continue`.
 *
 * ────────────────────────── POR QUÉ AQUÍ Y NO EN OTRO SITIO ──────────────────────────
 *
 * Porque este módulo YA es el punto de entrada mutable del catálogo del cliente: `rebuildCatalog`
 * lo reescribe entero desde el panel de roster desde hace bloques. Esto es la misma puerta,
 * usada para lo que le falta — no una segunda fuente de verdad y no una capa nueva. La
 * autoridad sigue siendo el servidor: aquí solo se guarda lo que el servidor ya ha dicho.
 *
 * ────────────────────────── ES ADITIVO, A PROPÓSITO ──────────────────────────
 *
 * Solo se da de alta lo que NO existe. Una carta que ya está en el catálogo compilado se
 * queda como está, aunque el servidor mande su versión acuñada. Servir la versión histórica
 * en la interfaz es lo correcto y sigue siendo deuda (D-2 de 8.2), pero es un cambio en lo
 * que hoy se pinta: hacerlo aquí, de paso, sería colar una decisión de producto dentro de un
 * arreglo. Esto solo hace visible lo que era invisible.
 *
 * Devuelve cuántas cartas y jugadores se han dado de alta — 0 en el caso normal.
 */
export function registerServerCards(
  cards: readonly CardDef[], players: readonly Player[] = [],
): { cards: number; players: number } {
  let nuevasCartas = 0;
  let nuevosJugadores = 0;

  for (const p of players) {
    if (PLAYER_BY_ID.has(p.id)) continue;
    PLAYER_BY_ID.set(p.id, p);
    nuevosJugadores++;
  }
  for (const c of cards) {
    if (CARD_BY_ID.has(c.id)) continue;
    CARD_BY_ID.set(c.id, c);
    CARDS = [...CARDS, c];
    nuevasCartas++;
  }
  if (nuevasCartas > 0) TOTAL_CARDS = CARDS.length;

  return { cards: nuevasCartas, players: nuevosJugadores };
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
