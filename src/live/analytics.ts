/**
 * LIVE ECOSYSTEM — ANALYTICS.
 *
 * Registra TODO de cada ciclo: tiempos, proveedor usado, intentos/errores, duplicados
 * evitados, cartas creadas/mejoradas/especiales/mantenidas, noticias, eventos, desafíos,
 * jugadores nuevos y cambios de rating. Estructura plana para el dashboard/harness.
 */
import type { ProviderAttempt } from "./provider";

export interface Analytics {
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  providerUsed: string | null;
  attempts: ProviderAttempt[];
  tournamentsProcessed: number;
  tournamentsSkipped: number;
  newPlayers: number;
  cardsCreated: number;
  cardsImproved: number;
  cardsSpecial: number;
  cardsKept: number;
  duplicatesAvoided: number;
  news: number;
  events: number;
  challenges: number;
  ratingChanges: number;
  errors: string[];
}

export function createAnalytics(now: number): Analytics {
  return {
    startedAt: now, finishedAt: now, durationMs: 0, providerUsed: null, attempts: [],
    tournamentsProcessed: 0, tournamentsSkipped: 0, newPlayers: 0,
    cardsCreated: 0, cardsImproved: 0, cardsSpecial: 0, cardsKept: 0, duplicatesAvoided: 0,
    news: 0, events: 0, challenges: 0, ratingChanges: 0, errors: [],
  };
}

export function finalizeAnalytics(a: Analytics, now: number): Analytics {
  a.finishedAt = now;
  a.durationMs = now - a.startedAt;
  return a;
}
