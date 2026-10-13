/**
 * F86.1 · RITMO DEL SONDEO DE TORNEOS (puro). El servidor dice el nivel (`tier`) según MI cruce; aquí se traduce a
 * milisegundos y se aplica el retroceso ante fallos (nunca bombardear un servidor que falla).
 *
 *   hot  3 s  · cruce jugable y alguien listo (esperando al rival): la partida se descubre en ≤ ~3 s + red
 *   warm 5 s  · cruce jugable, o mi próximo rival sale de un cruce en juego ahora
 *   idle 20 s · cruce sin nada inmediato (ventana cerrada, en juego, en revisión)
 *   cold 60 s · sin cruces vivos (como el indicador de F86)
 * Pestaña oculta: no se lee (el navegador además frena los temporizadores); al volver o reconectar, lectura inmediata.
 */
import type { CupPollTier } from "@/server/services/cups";

export const CUP_POLL_MS: Record<CupPollTier, number> = { hot: 3_000, warm: 5_000, idle: 20_000, cold: 60_000 };
export const CUP_POLL_MAX_BACKOFF_MS = 120_000;

export function cupPollInterval(tier: CupPollTier | null | undefined, failures: number): number {
  const base = CUP_POLL_MS[tier ?? "cold"];
  if (failures <= 0) return base;
  // Retroceso exponencial desde el ritmo normal (mínimo 10 s tras un fallo), con techo.
  return Math.min(CUP_POLL_MAX_BACKOFF_MS, Math.max(10_000, base) * 2 ** Math.min(failures - 1, 4));
}

/** Peticiones por minuto de UNA pestaña visible en cada nivel (análisis de carga). */
export const perMinute = (tier: CupPollTier): number => Math.round(60_000 / CUP_POLL_MS[tier]);
