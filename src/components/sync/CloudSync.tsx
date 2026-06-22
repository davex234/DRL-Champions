"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "@/lib/supabase/auth";
import { pullState, pushState } from "@/lib/supabase/cloud";
import { useGameStore } from "@/store/useGameStore";
import { useEventsStore } from "@/store/useEventsStore";

/**
 * Sincroniza el estado local con la nube cuando hay sesión:
 *  - Al iniciar sesión: descarga el estado remoto (si existe) o sube el local
 *    (migración progresiva localStorage → Supabase).
 *  - En cada cambio: sube (debounced) y actualiza los campos de ranking.
 * En modo local (sin Supabase) no hace nada.
 */
export function CloudSync() {
  const { user, configured, refreshProfile } = useAuth();
  const ready = useRef(false);

  useEffect(() => {
    ready.current = false;
    if (!configured || !user) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    (async () => {
      const had = await pullState(user.id);
      if (!had && !cancelled) await pushState(user.id);
      ready.current = true;
      refreshProfile();
    })();

    const schedule = () => {
      if (!ready.current) return;
      clearTimeout(timer);
      timer = setTimeout(async () => {
        await pushState(user.id);
        refreshProfile();
      }, 1500);
    };
    const unsubG = useGameStore.subscribe(schedule);
    const unsubE = useEventsStore.subscribe(schedule);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      unsubG();
      unsubE();
    };
  }, [user, configured, refreshProfile]);

  return null;
}
