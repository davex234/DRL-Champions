/**
 * MATCHMAKING PvP — vocabulario (Bloque 7.4).
 *
 * Esta capa NO empareja. El emparejamiento vive en PostgreSQL (migración 0032) porque es el
 * único sitio donde «elegir dos jugadores» puede ser INDIVISIBLE con varios procesos; un módulo
 * de TypeScript solo podría fingirlo. Lo que hay aquí son los NOMBRES: los estados de una
 * búsqueda, los códigos de rechazo y la forma de lo que ve el cliente.
 *
 * Se declara como módulo propio y NO dentro de `../pvp`, que documenta explícitamente que no
 * hace matchmaking. Son dos ciclos de vida distintos —una búsqueda no es una partida— y
 * mezclarlos sería el primer paso para reutilizar `duel_matches.status` como estado de cola.
 *
 * PURO: sin reloj propio, sin azar, sin red, sin Supabase.
 */

/**
 * Estado de una búsqueda. Mismo conjunto exacto que el CHECK de `duel_pvp_queue.state`: si
 * alguna vez divergen, la base de datos gana y este tipo está mal.
 *
 *   QUEUED    buscando. Único estado elegible para emparejar.
 *   PAIRING   reservada por un emparejador que está creando la partida. EFÍMERA y con
 *             arrendamiento: si el proceso muere, se recupera sola.
 *   MATCHED   hay partida; `matchId` la nombra.
 *   CANCELLED el jugador salió, o su mazo dejó de ser legal justo al emparejar.
 *   EXPIRED   se agotó el TTL sin rival.
 */
export type QueueState = "QUEUED" | "PAIRING" | "MATCHED" | "CANCELLED" | "EXPIRED";

/** Por qué se cerró una búsqueda que NO acabó en partida. */
export type QueueCloseReason = "USER" | "EXPIRED" | "DECK_INVALID" | "MATCH_FAILED";

/**
 * Códigos de resultado de las operaciones de cola. Son IDENTIFICADORES, nunca texto de interfaz:
 * la ruta los traduce a mensaje y a código HTTP en un solo sitio.
 */
export type MatchmakingCode =
  /** Entró en cola ahora mismo. */
  | "OK"
  /** Ya estaba buscando. NO es un error: es el mismo deseo repetido (doble clic, reintento). */
  | "ALREADY_QUEUED"
  /** Ese mazo no es suyo, o ya no es legal contra su inventario real. */
  | "DECK_NOT_OWNED"
  /** Tiene una partida PvP viva. Primero se termina o se abandona esa. */
  | "ACTIVE_MATCH"
  /** No estaba buscando nada (cancelar dos veces llega aquí, y no rompe nada). */
  | "NOT_QUEUED"
  /** Un emparejador tiene la entrada reservada: el desenlace se sabrá en el siguiente sondeo. */
  | "PAIRING"
  /** No hay búsqueda ni rastro reciente de ninguna. */
  | "IDLE"
  /** Carrera perdida contra una operación simultánea del mismo usuario. Reintentar es seguro. */
  | "RETRY";

/**
 * Lo que el cliente VE de su propia búsqueda. Nótese lo que NO está, y es deliberado: ningún
 * dato del rival, ninguna lista de candidatos, ningún tamaño de cola y el rating de NADIE MÁS.
 * La composición interna de la cola no sale del servidor.
 */
export interface QueueEntryView {
  entryId: string;
  deckId: string;
  state: QueueState;
  /**
   * Rating con el que este jugador ENTRÓ en cola. Lo sella el servidor y NO se recalcula
   * mientras espera: «mi rating ahora» y «el rating con el que entré» son cosas distintas y
   * pueden diferir si termina otra partida suya mientras busca. Ver docs/pvp/PVP-RATING.md §9.
   */
  ratingSnapshot: number;
  /** Solo cuando `state === "MATCHED"`. Es la puerta al Bloque 7.3. */
  matchId: string | null;
  reason: QueueCloseReason | null;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  matchedAt: number | null;
}

/** Respuesta completa de cualquier operación de cola. */
export interface MatchmakingView {
  code: MatchmakingCode;
  entry: QueueEntryView | null;
  /**
   * Cuántos jugadores llevan MÁS tiempo esperando. Es un agregado y no nombra a nadie.
   * `null` si no se está buscando.
   *
   * OJO a lo que NO significa desde el bloque 7.4.1: ya no es «los que van antes que yo». El
   * emparejamiento elige al buscador por antigüedad pero a su rival por cercanía de rating, así
   * que alguien con posición 3 puede emparejar antes que alguien con posición 1 si aparece su
   * rival compatible. Es una medida de espera, no un turno garantizado.
   */
  position: number | null;
  /**
   * Rating ACTUAL del solicitante. Es dato suyo y solo suyo: aquí no sale el rating de nadie
   * más, ni el del rival cuando lo hay. `null` únicamente si no se pudo leer.
   */
  rating: number | null;
  /** Reloj del SERVIDOR. El cliente calcula la espera con este, no con el suyo. */
  serverNow: number;
}

/** Estados de los que ya no se sale. Una entrada terminal no se reutiliza: se crea otra. */
export const TERMINAL_QUEUE_STATES: readonly QueueState[] = ["MATCHED", "CANCELLED", "EXPIRED"];

export const isTerminalQueueState = (s: QueueState): boolean => TERMINAL_QUEUE_STATES.includes(s);

/** Una búsqueda viva ocupa el hueco único del usuario en la cola. */
export const isActiveQueueState = (s: QueueState): boolean => s === "QUEUED" || s === "PAIRING";
