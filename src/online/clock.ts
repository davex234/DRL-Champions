/**
 * CLOCK SYNCHRONIZATION — estima el offset con el reloj del servidor (Online Fase 1/7).
 *
 * Estilo NTP sobre el reloj LÓGICO: cada ping/pong da (enviado, tiempoServidor, recibido) →
 * offset = tiempoServidor − (enviado+recibido)/2, rtt = recibido − enviado. Mediana de muestras
 * para robustez. PURO, sin wall-clock: el "ahora" lo inyecta el llamador.
 */
export interface ClockSample { clientSent: number; serverTime: number; clientRecv: number }
export interface NetClock { offset: number; rtt: number; samples: number }

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function estimateClock(samples: ClockSample[]): NetClock {
  if (samples.length === 0) return { offset: 0, rtt: 0, samples: 0 };
  const offs = samples.map((s) => s.serverTime - (s.clientSent + s.clientRecv) / 2);
  const rtts = samples.map((s) => s.clientRecv - s.clientSent);
  return { offset: Math.round(median(offs)), rtt: Math.round(median(rtts)), samples: samples.length };
}

/** Tick del servidor estimado desde el reloj local + offset. */
export function serverTickEstimate(localNow: number, clock: NetClock): number {
  return Math.round(localNow + clock.offset);
}
