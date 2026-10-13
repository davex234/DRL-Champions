/**
 * FASE 41 · ASISTENCIA DE PRIMER EQUIPO (starter) — POLÍTICA PURA.
 *
 * Hasta la Fase 40 el Sobre Inicial costaba 0 y se podía comprar sin límite: era la ruta garantizada al primer equipo
 * y, a la vez, un grifo infinito (cartas → XP → misiones/logros de sobres → reciclaje en créditos). Aquí vive la
 * regla que lo cierra sin dejar a nadie atrapado:
 *
 *   · El Sobre Inicial GRATIS solo se concede mientras la cuenta NO puede formar una plantilla legal con sus cartas,
 *     no tiene ya un Sobre Inicial sin abrir y no ha agotado el tope de concesiones gratuitas.
 *   · Mientras la cuenta no puede formar plantilla, los primeros huecos de cada Sobre Inicial se sortean entre roles que
 *     le faltan (misma rareza, mismo motor: `openPack` con `assist`).
 *   · Con la plantilla posible, nada de esto existe: los Sobres Iniciales que ya posea se abren con normalidad.
 *
 * El cliente no decide nada: ni si es elegible, ni qué rol, ni qué carta. Lo decide el servidor leyendo `user_cards`.
 */
import type { RoleId } from "@/domain/cards/types";
import type { StarterAssist } from "@/domain/packs/openPack";
import { deckReadiness, type ReadinessCard } from "@/domain/journey";

/** Versión del contrato económico (sube cuando cambia un valor o una regla de economía; nunca reescribe el pasado). */
export const ECONOMY_VERSION = 3;

export const STARTER_POLICY = {
  /** Único sobre de asistencia. */
  packId: "inicial",
  /** Huecos asistidos por Sobre Inicial abierto sin plantilla posible (decidido por simulación, ver economy-simulation.md). */
  assistSlots: 2,
  /**
   * Tope de Sobres Iniciales GRATIS comprados (histórico, incluye los de antes de la Fase 41). Red de seguridad: con 2 huecos
   * asistidos la cola medida es ≤ 2 gratis extra; el tope solo existe para que ningún fallo futuro vuelva a ser un grifo.
   */
  maxFreeClaims: 8,
} as const;

export type StarterIneligibleReason = "DECK_READY" | "HAS_UNOPENED_STARTER" | "CLAIM_CAP" | "NOT_STARTER_PACK";

export interface StarterEligibility {
  eligible: boolean;
  reason: StarterIneligibleReason | null;
}

export interface StarterFacts {
  /** ¿Puede formar AHORA una plantilla legal con cartas propias? */
  deckReady: boolean;
  /** Sobres Iniciales sin abrir. */
  unopenedStarter: number;
  /** Sobres Iniciales gratis ya comprados (asientos `buy_pack:inicial` del libro mayor). */
  freeClaims: number;
}

/** ¿Puede recibir AHORA un Sobre Inicial gratis? Orden de motivos estable (lo enseña la interfaz). */
export function starterEligibility(f: StarterFacts): StarterEligibility {
  if (f.deckReady) return { eligible: false, reason: "DECK_READY" };
  if (f.unopenedStarter > 0) return { eligible: false, reason: "HAS_UNOPENED_STARTER" };
  if (f.freeClaims >= STARTER_POLICY.maxFreeClaims) return { eligible: false, reason: "CLAIM_CAP" };
  return { eligible: true, reason: null };
}

/** Clave de idempotencia de la N-ésima concesión: dos peticiones simultáneas calculan la misma y solo una concede. */
export const starterClaimGesture = (claimIndex: number) => `starter-assist-${claimIndex}`;

/**
 * Asistencia para abrir un Sobre Inicial con estas cartas. `null` si ya puede formar plantilla (sobre normal) o si el
 * sobre no es el de asistencia.
 */
export function starterAssistFor(
  packId: string, ownedCardIds: readonly string[], resolve: (cardId: string) => ReadinessCard | null,
): StarterAssist | null {
  if (packId !== STARTER_POLICY.packId) return null;
  const r = deckReadiness(ownedCardIds, resolve);
  if (r.ready) return null;
  const needByRole: Partial<Record<RoleId, number>> = {};
  for (const s of r.shortages) needByRole[s.role] = s.need - s.have;
  const ownedPlayers = new Set<string>();
  for (const id of new Set(ownedCardIds)) {
    const c = resolve(id);
    if (c && (r.dataVersion === null || c.dataVersion === r.dataVersion)) ownedPlayers.add(c.playerId);
  }
  return { slots: STARTER_POLICY.assistSlots, needByRole, ownedPlayers };
}

/** Texto único del recorrido cuando falta plantilla (Fase 41). */
export const STARTER_COPY = {
  collect: "Consigue las cartas que te faltan para completar tu equipo.",
  claimed: "Ya tienes un Sobre Inicial por abrir.",
  notNeeded: "Ya puedes formar tu plantilla: el Sobre Inicial gratis ya no es necesario.",
  cap: "Has recibido todos los Sobres Iniciales gratis.",
} as const;
