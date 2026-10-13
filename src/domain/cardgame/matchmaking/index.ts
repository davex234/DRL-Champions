/**
 * MATCHMAKING PvP — API pública (Bloque 7.4).
 *
 * Vocabulario y política de la cola de emparejamiento de DUELOS DE CARTAS. El emparejamiento en
 * sí NO está aquí: vive en PostgreSQL (migración 0032), que es el único sitio donde elegir dos
 * jugadores puede ser indivisible entre varios procesos.
 *
 * NO CONFUNDIR con `src/matchmaking/`, que es la cola del juego TÁCTICO 5v5: congelada
 * (docs/FROZEN.md), en memoria, con `PlayerProfile`/`roster`/`region`/`ready check` y sin una
 * sola línea de persistencia. Se auditó pieza a pieza antes de escribir esto y no era
 * reutilizable: comparten la palabra «cola» y nada más. Ver docs/pvp/PVP-MATCHMAKING.md §2.
 */
export * from "./types";
export { QUEUE_TTL_SECONDS, PAIR_LEASE_SECONDS, PAIRING_CRITERION } from "./policy";
export { matchedEntryVerdict, type MatchedEntryVerdict, type MatchedMatchFacts } from "./resume";
