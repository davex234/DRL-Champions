/**
 * REGLAS DE RESULTADO VERSIONADAS (Fase 7).
 *
 * El PDF cierra la comparación, el marcador y UN desempate («en caso de quedar empate, el desempate
 * se decidirá sumando las medias de las cartas en los mazos»). NO dice qué pasa cuando un
 * enfrentamiento individual empata (OPD-05) ni cuando esa suma también empata (OPD-08). Esas dos
 * son DECISIONES DE PRODUCTO, y por eso viven aquí, explícitas y versionadas, en vez de escondidas
 * dentro del resolver.
 *
 * POR QUÉ VERSIONADAS: cambiar una regla de resultado cambiaría el ganador de partidas ya jugadas.
 * Un `CombatResult` guarda `resolverVersion`; volver a resolver ese plan con ESA versión devuelve
 * exactamente el mismo resultado. Una partida antigua nunca se reinterpreta en silencio.
 *
 * PURO: constantes y tipos. Sin reloj, sin azar, sin estado.
 */

/** Qué ocurre cuando los dos valores de un enfrentamiento son idénticos (OPD-05). */
export type EncounterTiePolicy =
  /** Nadie puntúa. Es lo único que se deduce de «gana el valor mayor»: si no hay mayor, no hay ganador. */
  | "NO_POINT";

/** Segundo —y último— desempate, cuando marcador y suma de OVR quedan igualados (OPD-08). */
export type FinalTiebreakPolicy =
  /** No existe. El resultado queda sin resolver. */
  | "NONE"
  /**
   * Diferencia total de estadística declarada en los 10 enfrentamientos. Usa SOLO información que
   * ya está en el audit trail, es simétrica entre los dos bandos y no mira nada del mazo —que por
   * definición ya empató en OVR—, así que es el único criterio capaz de resolver un espejo.
   */
  | "STAT_MARGIN";

/** Estado terminal cuando ningún desempate decide. */
export type TerminalPolicy =
  /** Sin resultado: el motor declara que no sabe. */
  | "UNRESOLVED"
  /** Empate EXPLÍCITO: un resultado válido, distinguible de un error. */
  | "DRAW";

/** Un juego de reglas de resultado completo. */
export interface CombatRuleset {
  version: string;
  encounterTie: EncounterTiePolicy;
  finalTiebreak: FinalTiebreakPolicy;
  terminal: TerminalPolicy;
}

/** Reglas de la Fase 4-6. Se conservan SOLO para volver a resolver partidas antiguas. */
export const COMBAT_RULES_V1: CombatRuleset = {
  version: "duel-combat-1",
  encounterTie: "NO_POINT",
  finalTiebreak: "NONE",
  terminal: "UNRESOLVED",
};

/**
 * Reglas vigentes (Fase 7).
 *
 * OPD-05 — sin cambio: un enfrentamiento empatado no puntúa para nadie. Medido: repartir ese punto
 * al atacante o al defensor no reduce los empates de marcador (los sube: 16 % → 24 % / 28 % en
 * espejo) y decidirlo por el OVR de la carta metería el OVR dentro de un enfrentamiento, que el
 * PDF define como comparación de UNA estadística.
 *
 * OPD-08 — un único desempate adicional, la diferencia total de estadística declarada, y después
 * un empate explícito. Es el único criterio medido que resuelve algo en un espejo: cualquier
 * criterio derivado del contenido de los mazos vale lo mismo para los dos y resuelve el 0 %.
 */
export const COMBAT_RULES_V2: CombatRuleset = {
  version: "duel-combat-2",
  encounterTie: "NO_POINT",
  finalTiebreak: "STAT_MARGIN",
  terminal: "DRAW",
};

/** Todos los juegos de reglas conocidos, por versión. */
export const COMBAT_RULESETS: Record<string, CombatRuleset> = {
  [COMBAT_RULES_V1.version]: COMBAT_RULES_V1,
  [COMBAT_RULES_V2.version]: COMBAT_RULES_V2,
};

/** Reglas con las que se juega HOY. */
export const CURRENT_COMBAT_RULES = COMBAT_RULES_V2;

/**
 * Reglas de una versión guardada. Devuelve `null` si la versión es desconocida: un resultado
 * grabado con reglas que este binario no conoce NO se reinterpreta con las actuales.
 */
export function getCombatRuleset(version: string): CombatRuleset | null {
  return COMBAT_RULESETS[version] ?? null;
}
