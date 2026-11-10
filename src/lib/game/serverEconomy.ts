"use client";

/**
 * ¿La economía de este jugador la lleva el SERVIDOR?
 *
 * FASE 69 · auditoría de autoridad del HUD (tras F68-010). Con cuenta, créditos, XP, sobres, cartas y materiales
 * viven en el servidor y `CloudSync` sobrescribe el store local; cualquier pantalla que los mueva en el navegador
 * enseña un saldo inventado que desaparece al sincronizar. Los modos locales (colecciones, forja, mercado contra
 * bots, logros de la carrera) solo pueden conceder o cobrar SIN cuenta.
 *
 * Mientras la sesión se está resolviendo (`loading`) se responde «sí»: durante ese instante no se sabe si hay
 * cuenta, y abrir el camino local para cerrarlo después dejaba una ventana de milisegundos en la que un clic podía
 * inventar saldo (hallazgo transversal de F69).
 */
import { useAuth } from "@/lib/supabase/auth";
import { useGameStore } from "@/store/useGameStore";
import { economyView, storedSessionPresent, type EconomyView } from "./localEconomy";

export function useServerEconomy(): boolean {
  const { user, loading, configured } = useAuth();
  return configured && (loading || !!user);
}

/**
 * F69 · lo que ve quien pulsa comprar/abrir/desguazar en el instante en que la sesión aún se está resolviendo: ni
 * camino local (inventaría saldo) ni servidor (todavía no hay token). Basta con volver a pulsar.
 */
export const SESSION_PENDING = "Comprobando tu sesión… vuelve a intentarlo en un momento.";

/** Motivo, escrito una vez, de por qué un modo local no concede ni cobra con cuenta. */
export const SERVER_ECONOMY_ONLY =
  "Con tu cuenta iniciada, créditos, XP y cartas los lleva el servidor: este modo local no concede ni cobra nada.";

/**
 * F81.2 · la vista de la economía para pintar (ver `economyView`): un único criterio para el HUD, las pantallas con
 * inventario y la portada. Mientras no sea `server` o `guest`, ninguna cifra del store se enseña.
 */
export function useEconomyView(): EconomyView {
  const { user, loading, configured } = useAuth();
  const serverOwner = useGameStore((s) => s.serverOwner);
  const cacheOwner = useGameStore((s) => s.cacheOwner);
  const syncError = useGameStore((s) => s.syncError);
  return economyView({
    configured, loading, userId: user?.id ?? null, serverOwner, cacheOwner, syncError,
    sessionStored: configured && !loading && !user ? storedSessionPresent() : false,
  });
}
