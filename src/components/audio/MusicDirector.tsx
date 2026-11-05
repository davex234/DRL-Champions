"use client";

/**
 * FASE 44.1 · DIRECTOR DE MÚSICA — montado UNA vez en el GameShell. Traduce la ruta a contexto musical, desbloquea el
 * audio con el primer gesto real del jugador (política de autoplay: nada suena al cargar) y funde la música al ocultar
 * la pestaña. No pinta nada.
 */
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { musicContextForPath, type MusicContext } from "@/lib/audio/music";
import { duckMusic, musicDebug, pushMusicOverride, setMusicHidden, setMusicRoute, unlockMusic } from "@/lib/audio/musicEngine";

const GESTURES = ["pointerdown", "keydown", "touchstart"] as const;

export function MusicDirector() {
  const pathname = usePathname();
  useEffect(() => { setMusicRoute(musicContextForPath(pathname ?? "/")); }, [pathname]);
  useEffect(() => {
    // Foto de solo lectura para la QA en navegador (estado del motor; ningún dato del jugador).
    (window as unknown as { __nexusMusic?: typeof musicDebug }).__nexusMusic = musicDebug;
    const unlock = () => { unlockMusic(); for (const g of GESTURES) window.removeEventListener(g, unlock, true); };
    for (const g of GESTURES) window.addEventListener(g, unlock, { capture: true, passive: true });
    const onVisibility = () => setMusicHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      for (const g of GESTURES) window.removeEventListener(g, unlock, true);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  return null;
}

/** Una pantalla impone su contexto mientras está montada (p. ej. RESULT en el resultado del partido). */
export function useMusicOverride(context: MusicContext | null): void {
  useEffect(() => (context ? pushMusicOverride(context) : undefined), [context]);
}

/** Agacha la música mientras `on` sea cierto (apertura de sobre). */
export function useMusicDuck(on: boolean): void {
  useEffect(() => (on ? duckMusic() : undefined), [on]);
}
