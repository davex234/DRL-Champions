/**
 * PLAYER JOURNEY · PRIMER EQUIPO (Fase 40) — puro.
 *
 * El primer equipo cuenta cuando está GUARDADO y es LEGAL (validador canónico del servidor: `deck.valid`). Si con ese
 * guardado el jugador pasa a tener su PRIMER equipo legal y no tiene ninguno activo, la pantalla lo activa con la acción
 * existente (`set_active`, que vuelve a validar en el servidor) y LO DICE. Nunca en otro caso: un jugador con equipos
 * no ve su equipo activo cambiado por guardar.
 */
export interface AutoActivateInput {
  savedValid: boolean;
  activeSupported: boolean;
  activeDeckId: string | null;
  /** Equipos legales que YA tenía antes de este guardado (sin contar el guardado). */
  otherValidDecks: number;
}

export const shouldAutoActivate = (i: AutoActivateInput): boolean =>
  i.savedValid && i.activeSupported && i.activeDeckId === null && i.otherValidDecks === 0;

export const AUTO_ACTIVATED_NOTICE = "Plantilla lista: equipo guardado y activado. Ya puedes jugar tu primer combate.";
export const AUTO_ACTIVATE_FAILED_NOTICE = "Equipo guardado y listo para duelo. No se pudo activar: actívalo desde Mis equipos.";

/** ¿Es el primer equipo del jugador? (ningún equipo legal guardado todavía). Solo decide si se enseña el coach. */
export const isFirstTeamContext = (decks: readonly { valid: boolean }[]) => decks.every((d) => !d.valid);
