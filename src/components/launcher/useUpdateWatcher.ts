"use client";

/**
 * UPDATE WATCHER — comprobación PERIÓDICA de actualizaciones mientras la app está abierta.
 *
 * Reutiliza el MISMO `UpdateController` singleton que el BootGate/launcher (no duplica
 * lógica ni estado): solo añade un `setInterval` configurable (prefs.pollMinutes, def. 15)
 * que llama a `controller.check()` cuando procede. Así el launcher detecta una versión nueva
 * aunque el usuario lleve horas con el juego abierto, sin reiniciar. La descarga/instalación
 * siguen siendo el flujo oficial de Tauri del controlador.
 */
import { useEffect, useRef, useState } from "react";
import {
  getUpdateController, isOnline, loadUpdatePrefs, clampPollMinutes,
  recordUpdate, type UpdateState,
} from "@/platform";

// Fases en las que NO se debe lanzar otra comprobación (hay un flujo en curso).
const BUSY: ReadonlySet<UpdateState["phase"]> = new Set([
  "checking", "downloading", "verifying", "downloaded", "installing", "finalizing", "restarting",
]);

export function useUpdateWatcher(): { state: UpdateState; available: boolean } {
  const ctrl = useRef(getUpdateController());
  const [state, setState] = useState<UpdateState>(() => ctrl.current.getState());

  useEffect(() => {
    const unsub = ctrl.current.subscribe(setState);
    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    const tick = async () => {
      if (cancelled || !isOnline()) return;
      if (BUSY.has(ctrl.current.getState().phase)) return;
      try {
        await ctrl.current.check();
      } catch {
        /* offline / servidor caído: silencioso, se reintenta al siguiente tick */
      }
    };

    void loadUpdatePrefs().then((prefs) => {
      if (cancelled || !prefs.periodicCheck) return;
      const ms = clampPollMinutes(prefs.pollMinutes) * 60_000;
      recordUpdate(`Watcher activo: comprobación cada ${clampPollMinutes(prefs.pollMinutes)} min`);
      timer = setInterval(() => void tick(), ms);
    });

    // Al recuperar conexión, comprobar de inmediato.
    const onOnline = () => void tick();
    window.addEventListener("online", onOnline);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      window.removeEventListener("online", onOnline);
      unsub();
    };
  }, []);

  return { state, available: state.phase === "available" };
}
