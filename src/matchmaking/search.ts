/**
 * SEARCH ENGINE — estricto al principio, relajando con el tiempo (Online Fase 2/7).
 *
 * La ventana de búsqueda se ensancha con el tiempo en cola: MMR, ping, región y calidad. Todo
 * configurable. PURO y DETERMINISTA (función del tiempo esperado).
 */
import type { SearchWindow } from "./types";

export interface SearchConfig {
  base: SearchWindow;
  mmrPerTick: number;
  pingPerTick: number;
  relaxRegionAfter: number; // ticks tras los que se permite cruzar región
  qualityFloor: number;
  qualityPerTick: number;
}

export const DEFAULT_SEARCH: SearchConfig = {
  base: { mmrRange: 100, pingMax: 60, regionStrict: true, minQuality: 78 },
  mmrPerTick: 6, pingPerTick: 4, relaxRegionAfter: 30, qualityFloor: 40, qualityPerTick: 0.8,
};

/** Ventana ampliada según los ticks esperados. Nunca se estrecha. */
export function expandWindow(cfg: SearchConfig, waitTicks: number): SearchWindow {
  const w = Math.max(0, waitTicks);
  return {
    mmrRange: cfg.base.mmrRange + w * cfg.mmrPerTick,
    pingMax: cfg.base.pingMax + w * cfg.pingPerTick,
    regionStrict: cfg.base.regionStrict && w < cfg.relaxRegionAfter,
    minQuality: Math.max(cfg.qualityFloor, cfg.base.minQuality - w * cfg.qualityPerTick),
  };
}

/** Espera estimada (ticks) a partir del tamaño de cola y el ritmo de emparejamiento. */
export function estimatedWait(queueSize: number, matchRatePerTick = 0.2): number {
  if (queueSize <= 1) return 60;
  return Math.round(queueSize / Math.max(0.05, matchRatePerTick));
}

/** Salud de la cola 0..100 (población alta + espera baja = sana). */
export function queueHealth(size: number, oldestWait: number): number {
  return Math.max(0, Math.min(100, Math.round(100 - oldestWait / 2 + Math.min(30, size * 2))));
}
