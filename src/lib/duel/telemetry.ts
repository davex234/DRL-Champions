/**
 * TELEMETRÍA DEL DUELO (Fase 26).
 *
 * Los siete momentos del bucle de partida que el producto quiere contar, como CONTEXTOS de un
 * `flow_started` de la taxonomía existente (Fase 14): sin eventos nuevos, sin claves nuevas.
 *
 * ─────────────────────── POR QUÉ HAY UNA PUERTA ───────────────────────
 *
 * La taxonomía es un conjunto CERRADO por un `CHECK` de base de datos (migración 0029): los flujos
 * admitidos son `deck_builder`, `pack_ceremony`, `pickem_form` y `market_listing_form`. El duelo no
 * tiene flujo propio, y darle uno exige una migración que esta fase no puede aplicar. Emitir con un
 * flujo prestado sería falsear el dato; emitir `duel_play` sería rechazado en el borde (`isFlow`) y,
 * si pasara, por el `CHECK`.
 *
 * Así que este módulo está CABLEADO en todas las pantallas y SOLO EMITE cuando el contrato conozca
 * el flujo del duelo. Hasta entonces es un no-op honesto. Está documentado como deuda de la fase.
 */
import { trackFlow } from "@/lib/telemetry/client";
import { isFlow, type Flow } from "@/lib/telemetry/contract";

export const DUEL_CONTEXTS = [
  "match_start",
  "card_selected",
  "card_locked",
  "round_resolved",
  "match_completed",
  "rematch",
  "reconnect",
] as const;
export type DuelContext = (typeof DUEL_CONTEXTS)[number];

/** Nombre del flujo que la taxonomía tendría que admitir. Coincide con el flujo crítico `duel_play`. */
export const DUEL_FLOW = "duel_play";

/** El flujo del duelo, si el contrato lo admite; `null` mientras no exista. */
export function duelFlow(): Flow | null {
  return isFlow(DUEL_FLOW) ? DUEL_FLOW : null;
}

/** Emite un momento del duelo. Nunca lanza, nunca bloquea, nunca inventa un flujo. */
export function trackDuel(context: DuelContext): void {
  try {
    const flow = duelFlow();
    if (!flow) return;
    trackFlow(flow, context);
  } catch { /* la telemetría no puede tumbar la partida */ }
}
