/**
 * HEARTBEAT — mantiene viva la conexión y detecta caídas (Online Fase 1/7).
 *
 * Sobre el reloj LÓGICO: envía ping cada `intervalTicks` y declara caída si no llega pong en
 * `timeoutTicks`. Alimenta la reconexión (Connection Manager). PURO (el "ahora" se inyecta).
 */
export interface Heartbeat {
  intervalTicks: number;
  timeoutTicks: number;
  lastPingAt: number;
  lastPongAt: number;
  pingSeq: number;
}

export function newHeartbeat(intervalTicks = 20, timeoutTicks = 100, now = 0): Heartbeat {
  return { intervalTicks, timeoutTicks, lastPingAt: now, lastPongAt: now, pingSeq: 0 };
}

export function dueForPing(hb: Heartbeat, now: number): boolean {
  return now - hb.lastPingAt >= hb.intervalTicks;
}

export function timedOut(hb: Heartbeat, now: number): boolean {
  return now - hb.lastPongAt >= hb.timeoutTicks;
}

export function onPingSent(hb: Heartbeat, now: number): Heartbeat {
  return { ...hb, lastPingAt: now, pingSeq: hb.pingSeq + 1 };
}

export function onPongReceived(hb: Heartbeat, now: number): Heartbeat {
  return { ...hb, lastPongAt: now };
}
