/**
 * FASE 44 · MOMENTOS DE EQUIPO — puros, solo con lo que devolvió el servidor.
 *
 *   · PLANTILLA LISTA: el equipo guardado es legal (`deck.valid` del validador canónico en servidor) y ANTES no lo era
 *     (o es nuevo). Guardar un equipo que ya era legal no repite la celebración. Sin recompensa: es reconocimiento.
 *   · EQUIPO ACTIVO: el servidor aceptó `set_active` para ese equipo.
 */
import type { Moment } from "./moments";

export interface DeckFactForMoment { id: string; name: string; valid: boolean; version?: string | null; updatedAt?: string | number | null }

export function deckReadyMoment(wasValid: boolean | null, saved: DeckFactForMoment): Moment | null {
  if (!saved.valid || wasValid === true) return null;
  return { key: `deck-ready:${saved.id}:${saved.version ?? saved.updatedAt ?? "v"}`, kind: "deck-ready", fact: `${saved.name} · 10 cartas, 2 por rol`, reward: null };
}

export function deckActiveMoment(deck: DeckFactForMoment, stamp: number): Moment {
  return { key: `deck-active:${deck.id}:${stamp}`, kind: "deck-active", fact: `${deck.name} jugará tus partidas`, reward: null };
}
