"use client";

import { useEffect } from "react";
import { useAuth } from "@/lib/supabase/auth";
import { syncFromServer } from "@/lib/game/sync";
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
  const { user, configured } = useAuth();

  useEffect(() => {
    if (!configured || !user) return;
    let cancelled = false;

    (async () => {
      try {
        await syncFromServer();
      } catch (e) {
        // No romper la app por un fallo de red: la UI mostrará su propio estado
        // de error donde corresponda y el usuario puede reintentar.
        console.error("[sync] no se pudo cargar el estado del servidor:", e);
      }
      if (!cancelled) useGameStore.setState({ hydrated: true });
    })();

    return () => { cancelled = true; };
  }, [user, configured]);

  return null;
}
