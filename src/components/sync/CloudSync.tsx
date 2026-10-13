"use client";

import { useEffect } from "react";
import { useAuth } from "@/lib/supabase/auth";
import { hydrateAccount, syncFromServer } from "@/lib/game/sync";
import { storedSessionPresent } from "@/lib/game/localEconomy";
import { useGameStore } from "@/store/useGameStore";

/**
 * Carga el estado REAL del servidor en el store de UI al iniciar sesión.
 *
 * Qué cambió en la Fase B:
 *   Antes este componente SUBÍA el estado local a la nube (`pushState`), lo que
 *   convertía al navegador en la autoridad. Ahora hace justo lo contrario: el
 *   servidor manda y el store local es una caché de presentación.
 *
 *   El antiguo volcado en `game_state.data` se conserva intacto en la base de
 *   datos como respaldo histórico, pero ya no se escribe ni se lee: la propiedad
 *   de cartas, el saldo y el pity viven en `user_cards`, `profiles` y `user_game`.
 *
 * Sin sesión no hace nada: el juego sigue en modo local de un solo jugador.
 */
export function CloudSync() {
  const { user, loading, configured } = useAuth();

  useEffect(() => {
    if (!configured || !user) return;
    let cancelled = false;

    (async () => {
      // F81.2 · un fallo NO rompe la app ni cae a la demo: queda en `syncError` y las pantallas ofrecen reintentar.
      await hydrateAccount(() => !cancelled);
      if (!cancelled) useGameStore.setState({ hydrated: true });
    })();

    return () => { cancelled = true; };
  }, [user, configured]);

  /*
   * F81.2 · VISITANTE CONFIRMADO (sesión resuelta, sin usuario y sin rastro de sesión) con la caché de una cuenta
   * (salió, o su sesión caducó): esa caché NO es su demo. Se vuelve al inventario de demostración antes de enseñar nada
   * (`economyView` responde `unknown` mientras `cacheOwner` siga puesto).
   */
  useEffect(() => {
    if (!configured || loading || user || storedSessionPresent()) return;
    const s = useGameStore.getState();
    if (s.cacheOwner || s.serverOwner) {
      s.resetGame();
      useGameStore.setState({ syncError: null });
    }
  }, [configured, loading, user]);

  /*
   * F68 · VOLVER A LA PESTAÑA. Con dos pestañas abiertas, lo que se compra o se reclama en una no llegaba a la otra
   * hasta recargar (medido en la beta: la 2.ª seguía con 5.310 créditos cuando el servidor ya tenía 2.810, también tras
   * navegar dentro de la app). Al recuperar el foco o volver a ser visible se relee el estado del servidor —una sola
   * lectura, idempotente— con un mínimo de RESYNC_MIN_MS entre lecturas para no inflar el presupuesto de peticiones (F64).
   */
  useEffect(() => {
    if (!configured || !user) return;
    let last = Date.now();
    const resync = () => {
      if (Date.now() - last < RESYNC_MIN_MS) return;
      last = Date.now();
      syncFromServer().catch(() => undefined);
    };
    const onVisible = () => { if (document.visibilityState === "visible") resync(); };
    window.addEventListener("focus", resync);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", resync);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [user, configured]);

  return null;
}

/** F68 · mínimo entre relecturas al volver a la pestaña. */
export const RESYNC_MIN_MS = 5_000;
