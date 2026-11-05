/**
 * TELEMETRÍA DE EQUIPOS (Fase 32) — seis momentos como CONTEXTOS de `flow_started`.
 *
 * Van en un flujo PROPIO, `deck_management`, y no en `deck_builder` (que sí está activo): la función
 * `analytics_flows` (0030) mide el abandono de `deck_builder` como «abrió el constructor y NO creó un
 * mazo después». Registrar ahí la edición o la activación de equipos que ya existen convertiría a
 * cada editor en un falso abandono. El inicio de CREAR un equipo sigue midiéndose como siempre
 * (`trackFlow("deck_builder", "first" | "additional")`).
 *
 * El contrato de flujos sigue cerrado (CHECK 0029). La migración local 0046 (NO aplicada) reserva
 * `deck_management`. Hasta que exista en la base de datos Y en `FLOWS`, este módulo es un no-op honesto.
 */
import { trackFlow } from "@/lib/telemetry/client";
import { isFlow, type Flow } from "@/lib/telemetry/contract";

export const DECK_CONTEXTS = [
  "deck_builder_view", "deck_created", "deck_saved", "deck_activated", "deck_autocomplete", "deck_compare",
] as const;
export type DeckContext = (typeof DECK_CONTEXTS)[number];

export const DECK_FLOW = "deck_management";

export function deckFlow(): Flow | null {
  return isFlow(DECK_FLOW) ? DECK_FLOW : null;
}

export function trackDeck(context: DeckContext): void {
  try {
    const flow = deckFlow();
    if (!flow) return;
    trackFlow(flow, context);
  } catch { /* nunca tumba la pantalla */ }
}

/** El inicio del flujo de CREAR (activo desde la Fase 14): se conserva tal cual. */
export function trackCreateStart(hasDecks: boolean): void {
  try { trackFlow("deck_builder", hasDecks ? "additional" : "first"); } catch { /* ídem */ }
}
