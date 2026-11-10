/**
 * VIBRACIÓN (Fase 33) — mejora progresiva, nunca dependencia.
 *
 * Solo si el navegador tiene `navigator.vibrate`, el sonido no está silenciado y el usuario no pidió
 * movimiento reducido. Pulsos cortos (≤ 60 ms). Sin estado guardado.
 */
import { isMuted } from "@/lib/sound";

export type HapticKind = "select" | "lock" | "point" | "match";

const PATTERN: Record<HapticKind, number | number[]> = { select: 8, lock: 16, point: [20, 40, 20], match: [30, 50, 60] };

export function hapticsAvailable(): boolean {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return false;
  /*
   * Sin gesto previo del usuario el navegador BLOQUEA la llamada y lo registra como error de consola
   * (medido en QA: revelación PvP llegada por sondeo, resultado al reconectar). Donde existe
   * `userActivation`, solo se vibra tras una interacción real; donde no existe, se intenta y ya.
   */
  const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  if (activation && !activation.hasBeenActive) return false;
  if (typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  return !isMuted();
}

export function buzz(kind: HapticKind): void {
  try {
    if (!hapticsAvailable()) return;
    navigator.vibrate(PATTERN[kind]);
  } catch { /* opcional */ }
}
