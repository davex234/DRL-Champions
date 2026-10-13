/**
 * RATING PvP DE DUELOS — API pública (Bloque 7.4.1).
 *
 * Vocabulario y política del Elo de los duelos de cartas. El cálculo y la persistencia NO están
 * aquí: viven en PostgreSQL (migración 0033), que es donde puede ser atómico.
 *
 * NO CONFUNDIR con `src/competitive/`, que es el sistema competitivo del juego TÁCTICO 5v5:
 * congelado (docs/FROZEN.md), en memoria, con `coachRating`/`roster`/`mvp` y sin una sola
 * escritura a base de datos. Se auditó pieza a pieza y no era reutilizable como almacenamiento
 * ni como autoridad. Ver docs/pvp/PVP-RATING.md §3.
 */
export * from "./types";
