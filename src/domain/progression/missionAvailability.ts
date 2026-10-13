/**
 * QUÉ MISIONES SE PUEDEN OFRECER HOY — elegibilidad por funcionalidad (2026-09-21).
 *
 * Una misión que mide una métrica que el jugador NO puede mover no es un objetivo: es una promesa
 * imposible. Con el Marketplace cerrado (`GLOBAL_MARKET_ENABLED = false`, `config/features.ts`) nadie
 * puede comprar ni vender entre jugadores, así que las misiones de `market_buy`/`market_sell` no se
 * sortean, no se enseñan y no se reclaman.
 *
 * Las DEFINICIONES no se tocan (`data/events.ts`, `data/seasons.ts`): se filtran aquí, al ofrecerlas.
 * Cuando el Marketplace se abra (el mismo interruptor), vuelven a ser elegibles sin reescribir nada.
 * `flags` existe para poder probar ese caso sin tocar el interruptor real.
 *
 * CORE GAME LOOP (2026-10-07) · lo mismo con `picks_made` («Haz una predicción»): mide respuestas del Pick'em LEGACY
 * (`pickem_answers`), retirado en 0072 (no se crean Pick'ems legacy nuevos; Pick'ems 2.0 guarda sus predicciones en
 * sus propias tablas y no mueve esta métrica). Una diaria que salía en ~3 de cada 5 tandas era imposible casi siempre.
 * No se sortea ni se enseña en el hub; una ya asignada caduca con su tanda. Si algún día una métrica de predicción
 * vuelve a moverse, `legacyPickems: true` la devuelve sin reescribir el pool.
 */
import { GLOBAL_MARKET_ENABLED } from "@/config/features";

/** Métricas que solo se mueven comprando o vendiendo en el Marketplace entre jugadores. */
export const MARKET_METRICS: ReadonlySet<string> = new Set(["market_buy", "market_sell"]);

/** Métricas que solo mueve el Pick'em legacy (retirado en 0072). */
export const LEGACY_PICKEM_METRICS: ReadonlySet<string> = new Set(["picks_made"]);

export interface MissionFlags {
  marketEnabled: boolean;
  /** Pick'em legacy abierto a predicciones nuevas. Ausente = retirado (0072). */
  legacyPickems?: boolean;
}

/** Los interruptores reales del producto. */
export const LIVE_MISSION_FLAGS: MissionFlags = Object.freeze({ marketEnabled: GLOBAL_MARKET_ENABLED, legacyPickems: false });

export const requiresMarketplace = (m: { metric: string }): boolean => MARKET_METRICS.has(m.metric);
export const requiresLegacyPickems = (m: { metric: string }): boolean => LEGACY_PICKEM_METRICS.has(m.metric);

/** ¿Se puede ofrecer esta misión con estos interruptores? */
export function isMissionAvailable(m: { metric: string }, flags: MissionFlags = LIVE_MISSION_FLAGS): boolean {
  if (requiresLegacyPickems(m) && !flags.legacyPickems) return false;
  return flags.marketEnabled || !requiresMarketplace(m);
}

/** Las misiones de la lista que se pueden ofrecer, en su orden. */
export function availableMissions<T extends { metric: string }>(list: readonly T[], flags: MissionFlags = LIVE_MISSION_FLAGS): T[] {
  return list.filter((m) => isMissionAvailable(m, flags));
}
