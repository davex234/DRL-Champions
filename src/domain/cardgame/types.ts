/**
 * DUELOS — vocabulario del dominio (Fase 3).
 *
 * Capa PURA del sistema de mazos del juego de cartas del PDF. NO es el simulador táctico 5v5:
 * `@/deck` y `@/match` modelan otra cosa (quinteto de titulares + suplentes, partido por rondas)
 * y NO se reutilizan aquí. Todo lo de este dominio lleva prefijo `Duel*` para que la colisión de
 * nombres sea imposible.
 *
 *   Catálogo (CardRegistry) + Propiedad (OwnershipIndex) → resolver → DuelDeck → validación → snapshot
 *
 * Depende solo de `@/domain/cards`. Nadie de aquí importa `@/store`, `@/app` ni Supabase.
 */
import type { CombatStats } from "@/domain/cards/combat";
import type { Region, RoleId, VariantId } from "@/domain/cards/types";

export type { CombatStats, Region, RoleId, VariantId };

/** Versión del esquema persistible del mazo de duelos. */
export const DUEL_DECK_SCHEMA_VERSION = 1;

/** Número exacto de cartas de un mazo de duelos (PDF: "un mazo compuesto por 10 cartas"). */
export const DUEL_DECK_SIZE = 10;

/** Cartas exigidas por rol (PDF: "2 de Smoker, 2 Duelistas, 2 Flex, 2 Centinelas y 2 Iniciadores"). */
export const DUEL_ROLE_QUOTA = 2;

/**
 * Los cinco roles del mazo, en el orden en que se presentan.
 * `Controlador` es el «Smoker» del documento de diseño: mismo rol, distinta etiqueta.
 */
export const DUEL_ROLES: RoleId[] = ["Duelista", "Controlador", "Iniciador", "Centinela", "Flex"];

/** Composición exigida: rol → cuántas cartas. Es LA regla del mazo. */
export const DUEL_COMPOSITION: Record<RoleId, number> = {
  Duelista: DUEL_ROLE_QUOTA,
  Controlador: DUEL_ROLE_QUOTA,
  Iniciador: DUEL_ROLE_QUOTA,
  Centinela: DUEL_ROLE_QUOTA,
  Flex: DUEL_ROLE_QUOTA,
};

// ───────────────────────────── Mazo ─────────────────────────────

/**
 * Mazo de duelos. Guarda ÚNICAMENTE identificadores de instancia poseída (`uid`), nunca copias de
 * estadísticas: las estadísticas viven en el catálogo y se congelan al hacer el snapshot.
 *
 * Un mazo en construcción PUEDE ser inválido (menos de 10 cartas, roles incompletos). Solo el
 * snapshot exige un mazo válido.
 */
export interface DuelDeck {
  id: string;
  name: string;
  /** uids de instancias poseídas. Orden irrelevante para la validez. */
  cards: string[];
  createdAt: number;
  updatedAt: number;
  version: number;
}

// ───────────────────────────── Resolución ─────────────────────────────

/** Motivo por el que un `uid` no se pudo resolver a una carta jugable. */
export type DuelResolveFailure =
  | "CARD_NOT_OWNED"   // el uid no está en la propiedad del usuario
  | "CARD_NOT_FOUND"   // el cardId de la instancia no existe en el catálogo
  | "CARD_NO_COMBAT";  // la carta existe pero no tiene trío de combate

/**
 * Carta de mazo ya resuelta: instancia + definición + jugador, con todo lo que el combate
 * necesitará. Se compone desde el catálogo y la propiedad; NO se recalcula nada.
 */
export interface DuelDeckCard {
  /** Identidad de la INSTANCIA poseída. */
  uid: string;
  /** Identidad de la DEFINICIÓN del catálogo. */
  cardId: string;
  playerId: string;
  playerName: string;
  team: string;
  region: Region;
  /** Rol editorial. NO interviene en combat ni en ovr; solo en composición y filtros. */
  role: RoleId;
  variantId: VariantId;
  /** Trío con el statBoost de la variante YA aplicado (lo calculó `deriveCard`). */
  combat: CombatStats;
  ovr: number;
  statBoost: number;
  dataVersion: string;
  serial: number | null;
}

/** Resultado de resolver un uid: la carta, o el motivo del fallo. */
export type DuelCardResolution =
  | { ok: true; card: DuelDeckCard }
  | { ok: false; uid: string; reason: DuelResolveFailure; cardId?: string };

/** Puerto de resolución. El dominio no sabe de dónde salen las cartas ni la propiedad. */
export type DuelDeckResolver = (uid: string) => DuelCardResolution;

// ───────────────────────────── Validación ─────────────────────────────

/** Códigos de error. Son identificadores de dominio, NUNCA texto de interfaz. */
export type DuelDeckErrorCode =
  | "DECK_SIZE"
  | "ROLE_COUNT"
  | "DUPLICATE_CARD"
  | "DUPLICATE_PLAYER"
  | "CARD_NOT_FOUND"
  | "CARD_NOT_OWNED"
  | "CARD_NO_COMBAT"
  | "INCOMPATIBLE_DATA_VERSION"
  | "INVALID_CARD";

/** Error de validación estructurado: código + datos, más un mensaje explicable aparte. */
export interface DuelDeckError {
  code: DuelDeckErrorCode;
  /** Rol afectado (solo en ROLE_COUNT). */
  role?: RoleId;
  /** Cantidad esperada y observada (DECK_SIZE, ROLE_COUNT). */
  expected?: number;
  actual?: number;
  /** Instancia afectada. */
  uid?: string;
  /** Definición afectada. */
  cardId?: string;
  /** Jugador afectado (DUPLICATE_PLAYER). */
  playerId?: string;
  /** Versiones encontradas (INCOMPATIBLE_DATA_VERSION). */
  versions?: string[];
}

/** Resultado de validar un mazo. Nunca es un booleano suelto. */
export interface DuelDeckValidation {
  valid: boolean;
  errors: DuelDeckError[];
  /** Cartas resueltas correctamente, en el orden del mazo. */
  resolved: DuelDeckCard[];
  /** Cuántas cartas hay de cada rol ahora mismo. */
  roleCounts: Record<RoleId, number>;
  /** Cuántas faltan de cada rol (0 si está completo o sobrado). */
  missingByRole: Record<RoleId, number>;
}

/** Estado del mazo de cara a la interfaz y al futuro emparejamiento. */
export type DuelDeckStatus = "EMPTY" | "INCOMPLETE" | "INVALID" | "READY_FOR_DUEL";

// ───────────────────────────── Snapshot ─────────────────────────────

/**
 * Instantánea CONGELADA de un mazo válido, lista para entrar en una partida.
 *
 * Contiene todo lo que el futuro Combat Resolver necesita, de modo que la partida NO dependa del
 * catálogo mientras se juega: si el admin republica el catálogo o el usuario vende una carta a
 * mitad de partida, el resultado no cambia.
 *
 * NO incluye química ni estado de partida: eso es responsabilidad de fases posteriores.
 */
export interface DuelDeckSnapshot {
  deckId: string;
  deckName: string;
  /** Las 10 cartas con sus estadísticas ya congeladas. */
  cards: DuelDeckCard[];
  /** Versión de calibración común a todas las cartas. */
  dataVersion: string;
  /** Versión del esquema del mazo. */
  schemaVersion: number;
  /** Momento de congelación (inyectado; el dominio no lee el reloj). */
  takenAt: number;
  /** Huella determinista del contenido: mismas cartas ⇒ misma huella. */
  checksum: string;
}
