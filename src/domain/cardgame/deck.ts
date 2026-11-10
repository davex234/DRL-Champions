/**
 * DUELOS — reglas del mazo (Fase 3).
 *
 * Validación, construcción y selección de cartas. TODO es puro y determinista: sin reloj, sin azar,
 * sin estado global. Los timestamps entran por parámetro para que la persistencia no contamine la
 * matemática.
 *
 * Estas reglas son de DOMINIO, no de interfaz: la UI no puede construir un mazo válido saltándoselas,
 * porque el estado `READY_FOR_DUEL` solo lo concede `validateDuelDeck`.
 */
import type {
  DuelCardResolution, DuelDeck, DuelDeckCard, DuelDeckError, DuelDeckResolver,
  DuelDeckSnapshot, DuelDeckStatus, DuelDeckValidation, RoleId,
} from "./types";
import {
  DUEL_COMPOSITION, DUEL_DECK_SCHEMA_VERSION, DUEL_DECK_SIZE, DUEL_ROLES,
} from "./types";

const emptyRoleCounts = (): Record<RoleId, number> =>
  ({ Duelista: 0, Controlador: 0, Iniciador: 0, Centinela: 0, Flex: 0 });

// ───────────────────────────── Construcción ─────────────────────────────

export interface CreateDeckInput {
  id: string;
  name: string;
  /** uids iniciales (opcional). Puede quedar incompleto: un mazo en construcción es válido como estado. */
  cards?: string[];
  /** Reloj inyectado. El dominio nunca llama a `Date.now()`. */
  now: number;
}

/** Crea un mazo vacío o parcial. No valida: construir es un proceso, validar es el final. */
export function createDuelDeck(input: CreateDeckInput): DuelDeck {
  return {
    id: input.id,
    name: input.name,
    cards: [...(input.cards ?? [])],
    createdAt: input.now,
    updatedAt: input.now,
    version: DUEL_DECK_SCHEMA_VERSION,
  };
}

/**
 * Añade una carta. Rechaza lo que sería un estado imposible incluso durante la construcción:
 * pasar de 10 cartas o repetir la misma instancia.
 */
export function addCard(deck: DuelDeck, uid: string, now: number): DuelDeck {
  if (deck.cards.includes(uid)) return deck;              // idempotente: añadir dos veces no duplica
  if (deck.cards.length >= DUEL_DECK_SIZE) return deck;   // el mazo nunca crece por encima de 10
  return { ...deck, cards: [...deck.cards, uid], updatedAt: now };
}

/** Quita una carta. Si no está, devuelve el mazo intacto (idempotente). */
export function removeCard(deck: DuelDeck, uid: string, now: number): DuelDeck {
  if (!deck.cards.includes(uid)) return deck;
  return { ...deck, cards: deck.cards.filter((u) => u !== uid), updatedAt: now };
}

/** Sustituye una carta conservando su POSICIÓN, para que la UI no reordene al cambiar un hueco. */
export function replaceCard(deck: DuelDeck, oldUid: string, newUid: string, now: number): DuelDeck {
  const i = deck.cards.indexOf(oldUid);
  if (i < 0) return deck;
  if (deck.cards.includes(newUid)) return deck;           // no se admite duplicar instancia
  const cards = [...deck.cards];
  cards[i] = newUid;
  return { ...deck, cards, updatedAt: now };
}

// ───────────────────────────── Validación ─────────────────────────────

/**
 * Valida un mazo completo. Devuelve TODOS los problemas encontrados, no solo el primero: el
 * constructor de mazos necesita poder señalar cada hueco a la vez.
 *
 * El orden de las cartas NO afecta al resultado.
 */
export function validateDuelDeck(deck: DuelDeck, resolve: DuelDeckResolver): DuelDeckValidation {
  const errors: DuelDeckError[] = [];
  const resolved: DuelDeckCard[] = [];
  const roleCounts = emptyRoleCounts();

  // 1. Instancias repetidas dentro del propio mazo.
  const seenUid = new Set<string>();
  for (const uid of deck.cards) {
    if (seenUid.has(uid)) errors.push({ code: "DUPLICATE_CARD", uid });
    seenUid.add(uid);
  }

  // 2. Resolución: existencia, propiedad y trío de combate.
  for (const uid of [...new Set(deck.cards)]) {
    const r: DuelCardResolution = resolve(uid);
    if (!r.ok) {
      errors.push({ code: r.reason, uid: r.uid, cardId: r.cardId });
      continue;
    }
    resolved.push(r.card);
  }

  // 3. Definiciones repetidas (dos instancias de la MISMA carta).
  const seenCardId = new Set<string>();
  for (const c of resolved) {
    if (seenCardId.has(c.cardId)) errors.push({ code: "DUPLICATE_CARD", uid: c.uid, cardId: c.cardId });
    seenCardId.add(c.cardId);
  }

  // 4. Mismo JUGADOR dos veces (aunque sean variantes distintas).
  //    Regla conservadora: el PDF no se pronuncia. Ver `ALLOW_SAME_PLAYER_TWICE`.
  if (!ALLOW_SAME_PLAYER_TWICE) {
    const seenPlayer = new Set<string>();
    for (const c of resolved) {
      if (seenPlayer.has(c.playerId)) errors.push({ code: "DUPLICATE_PLAYER", uid: c.uid, playerId: c.playerId });
      seenPlayer.add(c.playerId);
    }
  }

  // 5. Mezcla de temporadas.
  const versions = [...new Set(resolved.map((c) => c.dataVersion))].sort();
  if (versions.length > 1) errors.push({ code: "INCOMPATIBLE_DATA_VERSION", versions });

  // 6. Composición por rol.
  for (const c of resolved) roleCounts[c.role]++;
  const missingByRole = emptyRoleCounts();
  for (const role of DUEL_ROLES) {
    const expected = DUEL_COMPOSITION[role];
    const actual = roleCounts[role];
    missingByRole[role] = Math.max(0, expected - actual);
    if (actual !== expected) errors.push({ code: "ROLE_COUNT", role, expected, actual });
  }

  // 7. Tamaño. Se comprueba al final para que un mazo a medias explique primero qué le falta.
  if (deck.cards.length !== DUEL_DECK_SIZE) {
    errors.push({ code: "DECK_SIZE", expected: DUEL_DECK_SIZE, actual: deck.cards.length });
  }

  return { valid: errors.length === 0, errors, resolved, roleCounts, missingByRole };
}

/**
 * ¿Puede el mismo jugador aparecer dos veces en un mazo, con variantes distintas?
 *
 * DECISIÓN PENDIENTE DE PRODUCTO. El PDF no lo especifica en ningún punto: solo dice que las 10
 * cartas deben pertenecer a la colección del jugador. Se elige el comportamiento CONSERVADOR
 * (prohibido), que es la norma del género y protege la futura química de degenerar en un mazo de
 * diez copias del mismo jugador. Cambiar esta constante invierte la regla sin tocar nada más.
 */
export const ALLOW_SAME_PLAYER_TWICE = false;

/** Estado del mazo para la interfaz. `READY_FOR_DUEL` solo si la validación pasa. */
export function duelDeckStatus(deck: DuelDeck, validation: DuelDeckValidation): DuelDeckStatus {
  if (deck.cards.length === 0) return "EMPTY";
  if (validation.valid) return "READY_FOR_DUEL";
  const onlyIncomplete = validation.errors.every(
    (e) => (e.code === "DECK_SIZE" && (e.actual ?? 0) < DUEL_DECK_SIZE) ||
           (e.code === "ROLE_COUNT" && (e.actual ?? 0) < (e.expected ?? 0)),
  );
  return onlyIncomplete ? "INCOMPLETE" : "INVALID";
}

// ───────────────────────────── Selección de cartas ─────────────────────────────

export interface EligibilityContext {
  /** Todas las instancias que el usuario posee, ya resueltas. */
  available: DuelDeckCard[];
  deck: DuelDeck;
  validation: DuelDeckValidation;
}

/**
 * Cartas que el usuario puede poner AHORA en un hueco de este rol.
 *
 * Excluye: las que ya están en el mazo, las de otro rol, las de un jugador ya presente y las de
 * otra temporada. Si el rol ya tiene su cupo cubierto, devuelve vacío.
 *
 * La interfaz NO debe recalcular esto por su cuenta.
 */
export function getEligibleCardsForSlot(ctx: EligibilityContext, role: RoleId): DuelDeckCard[] {
  const { available, deck, validation } = ctx;
  if ((validation.roleCounts[role] ?? 0) >= DUEL_COMPOSITION[role]) return [];

  const inDeckUids = new Set(deck.cards);
  const inDeckCardIds = new Set(validation.resolved.map((c) => c.cardId));
  const inDeckPlayers = new Set(validation.resolved.map((c) => c.playerId));
  const deckVersion = validation.resolved[0]?.dataVersion;

  return available.filter((c) => {
    if (c.role !== role) return false;
    if (inDeckUids.has(c.uid)) return false;
    if (inDeckCardIds.has(c.cardId)) return false;
    if (!ALLOW_SAME_PLAYER_TWICE && inDeckPlayers.has(c.playerId)) return false;
    if (deckVersion && c.dataVersion !== deckVersion) return false;
    return true;
  });
}

/** Todos los roles a los que todavía les faltan cartas, en el orden de presentación. */
export function rolesNeeded(validation: DuelDeckValidation): RoleId[] {
  return DUEL_ROLES.filter((r) => validation.missingByRole[r] > 0);
}

// ───────────────────────────── Snapshot ─────────────────────────────

/**
 * Huella determinista del contenido del mazo. Ordena por `uid` para que reordenar las cartas
 * NO cambie la huella: dos mazos con las mismas cartas son el mismo mazo.
 */
export function deckChecksum(cards: DuelDeckCard[]): string {
  const parts = [...cards]
    .map((c) => `${c.uid}:${c.cardId}:${c.combat.stronghold}-${c.combat.gamesense}-${c.combat.entryfrag}:${c.ovr}`)
    .sort();
  let h = 2166136261 >>> 0;
  const s = parts.join("|");
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * Congela un mazo VÁLIDO para una partida. Devuelve `null` si el mazo no es válido: nunca se
 * congela un estado imposible.
 *
 * A partir de aquí la partida no vuelve a mirar el catálogo ni el inventario.
 */
export function takeDeckSnapshot(
  deck: DuelDeck,
  validation: DuelDeckValidation,
  takenAt: number,
): DuelDeckSnapshot | null {
  if (!validation.valid) return null;
  const cards = [...validation.resolved].sort((a, b) => a.uid.localeCompare(b.uid));
  return {
    deckId: deck.id,
    deckName: deck.name,
    cards,
    dataVersion: cards[0].dataVersion,
    schemaVersion: DUEL_DECK_SCHEMA_VERSION,
    takenAt,
    checksum: deckChecksum(cards),
  };
}
