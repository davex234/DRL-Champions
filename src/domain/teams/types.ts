/**
 * ROSTER BUILDER — Tipos y validación de los EQUIPOS del entrenador.
 *
 * Un entrenador crea MÚLTIPLES equipos (Principal, Academy, Ranked…). Cada equipo
 * referencia cartas POSEÍDAS por su `uid` (no copia datos de carta): la fuente de
 * verdad de las stats sigue siendo la colección. Aquí solo vive la COMPOSICIÓN.
 *
 * Módulo PURO (sin React, sin store): la validación se reutiliza en store, UI y tests.
 */

/**
 * Tipo de deck/plantilla (Collection Fase 3/7). Solo semántica + reglas de validación por defecto; no
 * cambia el flujo ni el Gameplay. Todo por datos.
 */
export type DeckKind =
  | "competitive" | "ranked" | "casual" | "event" | "tournament" | "training" | "custom";

/** Versión del esquema persistible de decks (migraciones/compat futura). */
export const DECK_SCHEMA_VERSION = 1;

export interface Team {
  id: string;
  name: string;
  /** Logo del equipo (preparado: por ahora un id/emoji opcional). */
  logo?: string;
  /** Cinco titulares: uids de cartas poseídas (OwnedCard.uid). */
  starters: string[];
  /** Suplentes (banquillo): uids de cartas poseídas. */
  subs: string[];
  createdAt: number;
  lastUsedAt: number | null;

  // ───────── Deck & Squad Builder (Collection Fase 3/7) — todo OPCIONAL ⇒ decks antiguos válidos ─────────
  /** Versión del esquema (para migración). */
  version?: number;
  /** Tipo de deck (competitive/ranked/casual/event/tournament/training/custom). Por defecto "custom". */
  kind?: DeckKind;
  /** Reservas (tercer nivel tras titulares y banquillo): uids de cartas poseídas. */
  reserves?: string[];
  /** Capitán designado (uid de un titular). Metadato de escuadra (no altera el Gameplay). */
  captainUid?: string;
  /** IGL designado (uid de un titular). Si se define, el Player Mapper lo fuerza como IGL. */
  iglUid?: string;
  /** Coach designado (uid de una carta / referencia). Metadato de escuadra. */
  coachUid?: string;
  /** Deck favorito. */
  favorite?: boolean;
  /** Etiquetas del usuario. */
  tags?: string[];
  /** Última modificación (reloj lógico; el store pasa el valor). */
  updatedAt?: number;
}

/** Alias semántico: un Deck ES un Team con las capacidades de la Fase 3 (misma persistencia). */
export type Deck = Team;

export const MAX_STARTERS = 5;
/** Cupo por defecto de banquillo y reservas (configurable en la validación). */
export const MAX_SUBS = 5;
export const MAX_RESERVES = 10;

export type TeamErrorCode =
  | "EMPTY_NAME"
  | "NOT_ENOUGH_STARTERS"
  | "TOO_MANY_STARTERS"
  | "DUPLICATE_CARD"
  | "DUPLICATE_PLAYER"
  | "UNKNOWN_CARD"
  | "STARTER_IN_SUBS"
  // ── Deck & Squad Builder (Collection Fase 3/7) — emitidos por `validateDeck` ──
  | "CAPTAIN_NOT_STARTER"
  | "IGL_NOT_STARTER"
  | "COACH_IN_STARTERS"
  | "RESERVE_OVERLAP"
  | "TOO_MANY_SUBS"
  | "TOO_MANY_RESERVES"
  | "MISSING_ROLE_COVERAGE"
  | "LOCKED_CARD";

export interface TeamError {
  code: TeamErrorCode;
  message: string;
}

/** Lo mínimo que la validación necesita saber de cada carta seleccionada. */
export interface CardRef {
  uid: string;
  /** Id del jugador real (para impedir dos cartas del MISMO jugador). */
  playerId: string;
}

/**
 * Valida una composición de equipo de forma PURA y devuelve TODOS los errores
 * (no corta en el primero) para que la UI los muestre con claridad.
 *
 * @param resolve  Resuelve un uid de carta a su CardRef, o null si no existe / no
 *                 pertenece al usuario (carta inexistente).
 */
export function validateTeam(
  team: Pick<Team, "name" | "starters" | "subs">,
  resolve: (uid: string) => CardRef | null,
): TeamError[] {
  const errors: TeamError[] = [];

  if (!team.name.trim()) {
    errors.push({ code: "EMPTY_NAME", message: "El equipo necesita un nombre." });
  }

  if (team.starters.length < MAX_STARTERS) {
    errors.push({
      code: "NOT_ENOUGH_STARTERS",
      message: `Faltan titulares: ${team.starters.length}/${MAX_STARTERS}.`,
    });
  }
  if (team.starters.length > MAX_STARTERS) {
    errors.push({
      code: "TOO_MANY_STARTERS",
      message: `Demasiados titulares: ${team.starters.length}/${MAX_STARTERS}.`,
    });
  }

  // Cartas inexistentes / no poseídas.
  const refs: CardRef[] = [];
  for (const uid of team.starters) {
    const ref = resolve(uid);
    if (!ref) {
      errors.push({ code: "UNKNOWN_CARD", message: `Carta inexistente en tu colección (${uid}).` });
    } else {
      refs.push(ref);
    }
  }

  // Cartas duplicadas (misma instancia repetida).
  const seenUid = new Set<string>();
  for (const uid of team.starters) {
    if (seenUid.has(uid)) {
      errors.push({ code: "DUPLICATE_CARD", message: "No puedes alinear la misma carta dos veces." });
      break;
    }
    seenUid.add(uid);
  }

  // Dos cartas del MISMO jugador (p. ej. dos Aspas) no pueden jugar a la vez.
  const seenPlayer = new Set<string>();
  for (const ref of refs) {
    if (seenPlayer.has(ref.playerId)) {
      errors.push({
        code: "DUPLICATE_PLAYER",
        message: "No puedes alinear dos cartas del mismo jugador.",
      });
      break;
    }
    seenPlayer.add(ref.playerId);
  }

  // Un titular no puede estar además en el banquillo.
  const starterSet = new Set(team.starters);
  if (team.subs.some((uid) => starterSet.has(uid))) {
    errors.push({ code: "STARTER_IN_SUBS", message: "Un titular no puede estar también en suplentes." });
  }

  return errors;
}

export function isTeamValid(
  team: Pick<Team, "name" | "starters" | "subs">,
  resolve: (uid: string) => CardRef | null,
): boolean {
  return validateTeam(team, resolve).length === 0;
}
