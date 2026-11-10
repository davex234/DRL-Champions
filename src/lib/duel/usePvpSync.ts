"use client";

/**
 * HOOK DE SINCRONIZACIÓN PvP (Bloque 7.3).
 *
 * Envoltura fina sobre `PvpSyncPoller`. Aquí NO hay lógica de sondeo: ni intervalos, ni
 * backoff, ni reglas de admisión. Todo eso vive en el poller, que es puro y está probado.
 * Este fichero solo hace lo que la clase no puede hacer sola porque depende del navegador:
 *
 *   · crear UN poller por partida y destruirlo al desmontar;
 *   · conectar `visibilitychange` del documento;
 *   · re-renderizar cuando el poller publica un estado nuevo.
 *
 * Ese reparto es deliberado: el proyecto no tiene jsdom ni testing-library —los tests de React
 * usan `renderToStaticMarkup`, que no ejecuta efectos—, así que un hook con temporizadores sería
 * código no comprobable. Con esta separación, lo comprobable está comprobado y lo que queda sin
 * test automático son tres suscripciones de navegador que se validan en QA manual.
 *
 * NO está montado en ninguna pantalla todavía, a propósito: el Bloque 7.3 no construye la UI de
 * PvP. Es el punto de enganche para cuando se construya.
 */
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { getSupabase } from "@/lib/supabase/client";
import { createHttpTransport, type PvpPlayInput, type PvpSyncTransport } from "./pvpTransport";
import { PvpSyncPoller, initialSyncState, type SyncState } from "./pvpPoller";

/** Cabeceras con el Bearer de Supabase. El id de usuario JAMÁS viaja en el cuerpo. */
async function authHeaders(): Promise<Record<string, string>> {
  const sb = getSupabase();
  if (!sb) throw new Error("Los duelos necesitan una cuenta online");
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Inicia sesión para jugar");
  return { "content-type": "application/json", authorization: `Bearer ${token}` };
}

export interface UsePvpSync {
  state: SyncState;
  /** Refresco manual. Reutiliza el ÚNICO bucle; no crea otro ni duplica peticiones. */
  syncNow: () => void;
  play: (input: PvpPlayInput) => Promise<void>;
  abandon: () => Promise<void>;
}

export function usePvpSync(matchId: string | null, transport?: PvpSyncTransport): UsePvpSync {
  const ref = useRef<PvpSyncPoller | null>(null);
  // `useSyncExternalStore` necesita una referencia estable mientras no haya cambios.
  const emptyRef = useRef<SyncState>(initialSyncState());

  useEffect(() => {
    if (!matchId) return;

    const poller = new PvpSyncPoller(matchId, {
      transport: transport ?? createHttpTransport(authHeaders),
      now: () => Date.now(),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    });
    ref.current = poller;

    /*
     * La visibilidad INICIAL se lee antes de arrancar, no se supone.
     *
     * Lo encontró la QA en navegador del Bloque 7.3: si la pestaña ya estaba en segundo plano
     * al montar, `visibilitychange` no llega a dispararse nunca —solo notifica CAMBIOS— y el
     * bucle se quedaba con el ritmo de primer plano sondeando una pestaña que nadie mira.
     */
    poller.setVisibility(document.visibilityState === "hidden" ? "hidden" : "visible");
    poller.start();

    const onVisibility = () => {
      poller.setVisibility(document.visibilityState === "hidden" ? "hidden" : "visible");
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      poller.dispose();
      ref.current = null;
    };
    // El transporte solo se inyecta en pruebas; cambiarlo en caliente reiniciaría el bucle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  /*
   * `matchId` EN LAS DEPENDENCIAS, y es un arreglo, no un adorno (Bloque 7.5).
   *
   * Con `[]`, React llamaba a `subscribe` UNA vez, en el primer montaje. Y en la arena el primer
   * montaje ocurre SIN partida —`matchId` es `null` hasta que la cola empareja—, así que en ese
   * momento `ref.current` todavía es `null`, `subscribe` devolvía un no-op y **React no se
   * suscribía nunca**. Después el efecto creaba el poller, el poller sondeaba, recibía su 200… y
   * nadie se enteraba: `state.snapshot` se quedaba en `null` para siempre y la pantalla en
   * «Recuperando la partida…».
   *
   * No se había visto antes porque hasta este bloque el único consumidor era la superficie de
   * depuración del 7.3, que sacaba `matchId` de la URL: ahí nunca es `null` en el primer render.
   * Lo encontró la QA en navegador de este bloque.
   *
   * Cambiar la identidad de `subscribe`/`getState` cuando cambia `matchId` es justo lo que hace
   * que `useSyncExternalStore` vuelva a suscribirse y a leer contra el poller nuevo.
   */
  const subscribe = useCallback((cb: () => void) => {
    const poller = ref.current;
    if (!poller) return () => {};
    return poller.subscribe(() => cb());
  }, [matchId]);

  const getState = useCallback(
    () => ref.current?.getSnapshot() ?? emptyRef.current,
    [matchId],
  );

  const state = useSyncExternalStore(subscribe, getState, getState);

  const syncNow = useCallback(() => { ref.current?.syncNow(); }, []);
  const play = useCallback(async (input: PvpPlayInput) => { await ref.current?.play(input); }, []);
  const abandon = useCallback(async () => { await ref.current?.abandon(); }, []);

  return { state, syncNow, play, abandon };
}
