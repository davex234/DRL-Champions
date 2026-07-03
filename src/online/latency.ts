/**
 * LATENCY MONITOR — RTT y jitter a partir de muestras de ping (Online Fase 1/7). PURO.
 */
export interface LatencyMonitor { samples: number[]; rtt: number; jitter: number }

export function newLatency(): LatencyMonitor { return { samples: [], rtt: 0, jitter: 0 }; }

/** Registra una muestra de RTT (ventana de 16). Devuelve un nuevo monitor. */
export function recordRtt(m: LatencyMonitor, rtt: number): LatencyMonitor {
  const samples = [...m.samples, Math.max(0, rtt)].slice(-16);
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  const jitter = samples.length > 1 ? Math.sqrt(samples.reduce((a, b) => a + (b - avg) ** 2, 0) / samples.length) : 0;
  return { samples, rtt: Math.round(avg), jitter: Math.round(jitter) };
}

/** Calidad de conexión 0..100 (para HUD). */
export function connectionQuality(m: LatencyMonitor): number {
  return Math.max(0, Math.min(100, Math.round(100 - m.rtt / 4 - m.jitter)));
}
