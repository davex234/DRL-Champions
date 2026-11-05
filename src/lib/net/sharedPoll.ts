"use client";

/**
 * FASE 64 · SONDEO COMPARTIDO — una lectura para toda la app, no una por componente.
 *
 * Medido en F64: el armazón llama a `useBadges()` en cuatro sitios (barra, menú, dock, hoja) y cada uno abría su propio
 * sondeo de `/api/game/social?badge=1` y `/api/game/live-events?badge=1`. Resultado: 8 + 8 peticiones al cargar CUALQUIER
 * pantalla (también `/como-jugar`), y el limitador (429) saltaba a las ~15 navegaciones. Aquí hay UN temporizador, UNA
 * petición en vuelo y UN valor por clave de usuario, compartidos por todos los suscriptores (`useSyncExternalStore`).
 *
 * Mismo contrato que antes: refresco periódico con la pestaña visible, al volver a la pestaña y ante eventos de la app;
 * sin sesión, el valor inicial y ninguna petición. Un fallo conserva el último valor (nunca inventa uno).
 */
import { useCallback, useSyncExternalStore } from "react";

export interface SharedPollOptions<T> {
  fetch: () => Promise<T>;
  initial: T;
  intervalMs: number;
  /** Eventos de ventana que fuerzan una relectura (p. ej. `nexus:social-changed`). */
  events?: readonly string[];
  /** No se relee antes de este margen salvo que se fuerce (evita ráfagas al montar varios suscriptores). */
  minGapMs?: number;
  /**
   * F86.1 · ADAPTATIVO (opcional). Si existe, el siguiente refresco se programa con el intervalo que devuelva a partir
   * del ÚLTIMO valor y de los fallos seguidos (retroceso), en vez del `intervalMs` fijo. Además relee en el acto al
   * recuperar el foco o la conexión. Sin esta opción, el sondeo se comporta exactamente como en F64.
   */
  intervalFor?: (value: T, failures: number) => number;
}

export interface SharedPoll<T> {
  subscribe: (key: string, listener: () => void) => () => void;
  get: () => T;
  /** Solo para pruebas y diagnósticos: cuántas peticiones lanzó. */
  stats: () => { requests: number; subscribers: number; key: string | null };
  refresh: (force?: boolean) => void;
}

export function createSharedPoll<T>(o: SharedPollOptions<T>): SharedPoll<T> {
  const minGap = o.minGapMs ?? 5_000;
  let value = o.initial;
  let key: string | null = null;
  let lastAt = 0;
  let inflight: Promise<void> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let next: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;
  let requests = 0;
  const listeners = new Set<() => void>();
  const emit = () => { for (const l of listeners) l(); };
  const visible = () => typeof document === "undefined" || document.visibilityState === "visible";

  const read = (force = false) => {
    if (!key || !visible() || inflight) return;
    if (!force && Date.now() - lastAt < minGap) return;
    const k = key;
    requests++;
    lastAt = Date.now();
    inflight = o.fetch()
      .then((v) => { failures = 0; if (key === k) { value = v; emit(); } })
      .catch(() => { failures++; })
      .finally(() => { inflight = null; schedule(); });
  };
  const onVisible = () => read();
  const onEvent = () => read(true);
  const onWake = () => read(true);
  /** Adaptativo: UN temporizador de un solo disparo, reprogramado tras cada lectura con el intervalo del valor actual. */
  const schedule = () => {
    if (!o.intervalFor || listeners.size === 0) return;
    if (next) clearTimeout(next);
    next = setTimeout(() => { next = null; if (visible()) read(true); else schedule(); }, Math.max(1_000, o.intervalFor(value, failures)));
  };

  const start = () => {
    read();
    if (o.intervalFor) schedule(); else timer = setInterval(() => read(), o.intervalMs);
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
    if (typeof window !== "undefined") {
      for (const e of o.events ?? []) window.addEventListener(e, onEvent);
      if (o.intervalFor) { window.addEventListener("focus", onWake); window.addEventListener("online", onWake); }
    }
  };
  const stop = () => {
    if (timer) clearInterval(timer);
    if (next) clearTimeout(next);
    timer = null; next = null;
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
    if (typeof window !== "undefined") {
      for (const e of o.events ?? []) window.removeEventListener(e, onEvent);
      if (o.intervalFor) { window.removeEventListener("focus", onWake); window.removeEventListener("online", onWake); }
    }
  };

  return {
    subscribe(k, listener) {
      if (key !== k) { key = k; value = o.initial; lastAt = 0; emit(); if (listeners.size > 0) read(true); }
      listeners.add(listener);
      if (listeners.size === 1) start();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) { stop(); }
      };
    },
    get: () => value,
    stats: () => ({ requests, subscribers: listeners.size, key }),
    refresh: (force = true) => read(force),
  };
}

/** Valor compartido del sondeo. `userKey` nulo = sin sesión: valor inicial y ninguna petición. */
export function useSharedPoll<T>(poll: SharedPoll<T>, userKey: string | null, initial: T): T {
  // Suscripción ESTABLE: si cambiara en cada render, React se daría de baja y de alta sin parar (y cada alta relee).
  const subscribe = useCallback((l: () => void) => (userKey ? poll.subscribe(userKey, l) : () => undefined), [poll, userKey]);
  const getSnap = useCallback(() => (userKey ? poll.get() : initial), [poll, userKey, initial]);
  return useSyncExternalStore(subscribe, getSnap, () => initial);
}
