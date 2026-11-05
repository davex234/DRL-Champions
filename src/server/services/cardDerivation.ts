/**
 * DERIVACIÓN DE UNA DEFINICIÓN DE CARTA — la autoridad del servidor (Bloque 8.4.2).
 *
 * ────────────────────────── QUÉ PROBLEMA RESUELVE ──────────────────────────
 *
 * El bloque 8.4.1 dejó la ruta de administración aceptando `ovr`, `stats`, `stat_boost`,
 * `rarity_rank` y `rarity_bucket` **tal como llegaban del navegador**. La auditoría de 8.4.2
 * lo midió contra el servidor en marcha:
 *
 *   · publicar `{ ovr: 99 }` sin tocar el trío → se guardó 99 sobre un trío de 84/80/65,
 *     un OVR que ninguna función del dominio produce. Y de ahí pasó al ancla de mercado:
 *     `fairValue` 127.775 calculado sobre una cifra inventada.
 *   · publicar `{ combat: { stronghold: 500, gamesense: -20, entryfrag: 0 } }` → se guardó
 *     tal cual. La escala del dominio es 0-99 y no había ni una comprobación de rango.
 *   · al publicar, el `checksum` quedaba en cadena vacía, porque la RPC hacía
 *     `coalesce(p_patch->>'checksum', '')` y la ruta nunca lo enviaba.
 *
 * No es que el panel «permitiera un valor raro»: es que el catálogo dejaba de ser derivable.
 * La trazabilidad del OVR hasta métricas reales costó los bloques 1 y 2, y un formulario no
 * puede deshacerla.
 *
 * ────────────────────────── LA REGLA ──────────────────────────
 *
 * Una definición de carta tiene **exactamente una entrada administrable**: el trío de
 * combate. Todo lo demás se deriva de (jugador, variante, trío) con las MISMAS funciones que
 * construyen el catálogo desde el bloque 1:
 *
 *     combat  ──deriveCard()───────────────→  combat final + ovr
 *     variante ─────────────────────────────→  statBoost, rarityRank, rarityBucket
 *     jugador + boost ──applyStatBoost()───→  las 6 estadísticas heredadas
 *     todo lo anterior ──cardChecksum()────→  checksum
 *
 * Este módulo es el único sitio donde se compone eso para el panel. `createCard`, la edición
 * de borrador y la publicación de versión pasan por aquí. Si mañana cambia la fórmula,
 * cambia en `domain/cards/combat.ts` y este módulo la sigue sin enterarse.
 *
 * ────────────────────────── POR QUÉ EL CLIENTE PUEDE CALCULARLO IGUAL ──────────────────────────
 *
 * La previsualización del formulario llama a `deriveCard()` para enseñar el OVR mientras se
 * teclea. Eso NO es duplicar la fórmula: es la misma función pura del dominio, importada. Lo
 * que el cliente calcula es una PREDICCIÓN; lo que se guarda lo vuelve a derivar el servidor
 * y descarta cualquier cifra que venga en la petición. Si las dos coinciden —y coinciden,
 * porque es la misma función— el administrador ve antes de guardar exactamente lo que se va
 * a guardar.
 */
import type { CardDef, PlayerStats, Player, VariantDef, VariantId, CardStatsSource } from "@/domain/cards/types";
import type { CombatStats } from "@/domain/cards/combat";
import { deriveCard, applyCombatBoost, DATA_VERSION } from "@/domain/cards/combat";
import { applyStatBoost } from "@/domain/cards/ovr";
import { bucketForRank } from "@/domain/packs/types";
import { cardChecksum } from "@/server/catalog/rows";

/** Escala de una estadística de combate. La misma que el dominio: enteros de 0 a 99. */
export const COMBAT_MIN = 0;
export const COMBAT_MAX = 99;

/**
 * Los campos que un administrador escribe. Uno.
 *
 * Se declara como constante para que la ruta pueda rechazar por nombre cualquier otro y
 * decir en el error **por qué** no se acepta, en vez de ignorarlo en silencio.
 */
export const ADMIN_INPUT_FIELDS = ["combat"] as const;

/**
 * Campos que llegan derivados y que NUNCA se aceptan de la petición, con la razón que se le
 * devuelve a quien los envíe. Un panel que los mandara estaría equivocado y conviene que se
 * entere en el momento, no tres versiones después.
 */
export const DERIVED_FIELDS: Record<string, string> = {
  ovr: "el OVR sale del trío con computeCombatOvr(); no se escribe a mano",
  stats: "las 6 estadísticas heredadas salen del jugador más el boost de la variante",
  stat_boost: "el boost lo fija la variante",
  rarity_rank: "el rank lo fija la variante",
  rarity_bucket: "el bucket sale de bucketForRank(rank)",
  checksum: "la huella la calcula el servidor sobre lo que va a guardar",
  data_version: "la calibración vigente la fija el dominio",
  generated_at: "la marca de generación la fija el servidor",
  source: "el origen de las estadísticas lo decide quién las puso, no la petición",
};

/** Campos que definen QUÉ carta es. Cambiarlos sería crear otra, no editar esta. */
export const IMMUTABLE_FIELDS: Record<string, string> = {
  card_id: "la identidad de la carta",
  player_id: "cambiarlo haría de esta carta otra carta distinta",
  variant_id: "cambiarlo haría de esta carta otra carta distinta",
  ordinal: "el orden del catálogo decide el reparto de sobres (8.1)",
  origin: "de dónde salió la definición",
  lifecycle: "se mueve con la acción de ciclo de vida, no con una edición",
  definition_version: "lo lleva el versionado",
};

export interface DerivedDefinition {
  /** La carta completa, tal como la construiría el generador. */
  card: CardDef;
  /** Fila lista para las RPC de contenido. Todo derivado, nada de la petición. */
  row: {
    player_id: string;
    variant_id: string;
    ovr: number;
    stats: PlayerStats;
    combat: CombatStats;
    stat_boost: number;
    rarity_rank: number;
    rarity_bucket: string;
    data_version: string;
    source: CardStatsSource;
    generated_at: string;
    checksum: string;
  };
}

/** Un trío válido: tres enteros dentro de la escala. Cualquier otra cosa se rechaza con motivo. */
export function validateCombat(input: unknown): { ok: true; combat: CombatStats } | { ok: false; error: string } {
  if (input === null || typeof input !== "object") {
    return { ok: false, error: "El trío de combate debe ser un objeto con stronghold, gamesense y entryfrag" };
  }
  const raw = input as Record<string, unknown>;
  const out = {} as CombatStats;
  for (const k of ["stronghold", "gamesense", "entryfrag"] as const) {
    const v = raw[k];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      return { ok: false, error: `${k} debe ser un número` };
    }
    if (!Number.isInteger(v)) {
      return { ok: false, error: `${k} debe ser un entero (llegó ${v})` };
    }
    if (v < COMBAT_MIN || v > COMBAT_MAX) {
      return { ok: false, error: `${k} está fuera de la escala ${COMBAT_MIN}-${COMBAT_MAX} (llegó ${v})` };
    }
    out[k] = v;
  }
  return { ok: true, combat: out };
}

/**
 * Compone la definición completa a partir de lo único que un humano decide.
 *
 * `baseCombat` es el trío **sin** el bonus de la variante: es lo que sale de las métricas del
 * jugador o lo que autoriza la vía editorial. `deriveCard` le aplica el boost y calcula el
 * OVR; el resto cae de la variante y del jugador.
 */
export function deriveDefinition(args: {
  player: Player;
  variant: VariantDef;
  baseCombat: CombatStats;
  source: CardStatsSource;
  generatedAt: string;
}): DerivedDefinition {
  const { player, variant, baseCombat, source, generatedAt } = args;

  // ÚNICA ruta de cálculo. Aquí no se suma ni un punto a mano, igual que en `buildCard`.
  const { combat, ovr } = deriveCard(baseCombat, variant.statBoost);

  const card: CardDef = {
    id: `${player.id}__${variant.id}`,
    playerId: player.id,
    variantId: variant.id as VariantId,
    stats: applyStatBoost(player.stats, variant.statBoost),
    ovr,
    combat,
    statBoost: variant.statBoost,
    dataVersion: DATA_VERSION,
    source,
    generatedAt,
  };

  return {
    card,
    row: {
      player_id: card.playerId,
      variant_id: card.variantId,
      ovr: card.ovr,
      stats: card.stats,
      combat,
      stat_boost: variant.statBoost,
      rarity_rank: variant.rank,
      rarity_bucket: bucketForRank(variant.rank),
      data_version: DATA_VERSION,
      source,
      generated_at: generatedAt,
      // La huella se calcula sobre la carta YA derivada: describe lo que se va a guardar.
      checksum: cardChecksum(card),
    },
  };
}

/**
 * El trío BASE que hay detrás de un trío ya guardado.
 *
 * Lo que persiste `content_cards.combat` es el trío **con** el boost de la variante aplicado;
 * `deriveDefinition` espera la base, así que hay que deshacer ese paso para poder editarlo.
 *
 * La vuelta no siempre es exacta, porque `applyCombatBoost` satura en 0 y en 99: un 99 con
 * boost 12 pudo venir de un 87 o de un 95. Se devuelve el mínimo compatible y se comprueba
 * **volviendo a aplicar el boost**: si no reproduce el trío guardado, `exact` es falso y el
 * editor lo avisa. Nunca se cambia un número por la espalda sin decirlo.
 *
 * Para una carta generada la vuelta SIEMPRE es exacta, porque `final = clamp(base + boost)`
 * garantiza `final >= boost`; `exact: false` solo puede salir de una fila editada a mano
 * antes de que este bloque cerrase esa puerta.
 */
export function unboost(combat: CombatStats, statBoost: number): { base: CombatStats; exact: boolean } {
  const back = (v: number): number =>
    Math.max(COMBAT_MIN, Math.min(COMBAT_MAX, v - statBoost));
  const base: CombatStats = {
    stronghold: back(combat.stronghold),
    gamesense: back(combat.gamesense),
    entryfrag: back(combat.entryfrag),
  };
  const vuelta = applyCombatBoost(base, statBoost);
  const exact =
    vuelta.stronghold === combat.stronghold &&
    vuelta.gamesense === combat.gamesense &&
    vuelta.entryfrag === combat.entryfrag;
  return { base, exact };
}
