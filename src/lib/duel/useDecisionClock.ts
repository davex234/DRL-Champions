"use client";

/**
 * F72.8 · EL CONTADOR DE LA DECISIÓN, en el cliente. Solo PINTA: `deadline − hora del servidor`, corregida por lo que
 * ha pasado desde que llegó la respuesta (`serverNow` + reloj monótono local). Nada de aquí decide que el tiempo se
 * acabó: al llegar a cero, quien lo usa PREGUNTA al servidor, y es el servidor el que comprueba el plazo y juega.
 */
import { useEffect, useRef, useState } from "react";
import { remainingMs } from "./turnClock";
import type { DuelTimeoutView } from "./types";

/** Milisegundos que quedan de la decisión en curso, o `null` si no hay plazo que enseñar. Se refresca cada 250 ms. */
export function useDecisionClock(deadlineAt: number | null | undefined, serverNow: number | undefined, active: boolean): number | null {
  const [receivedAt, setReceivedAt] = useState(0);
  const [now, setNow] = useState(0);
  // Cada respuesta nueva del servidor (otra `serverNow`) fija el instante local en que se recibió.
  useEffect(() => { const t = Date.now(); setReceivedAt(t); setNow(t); }, [serverNow, deadlineAt]);
  useEffect(() => {
    if (!active || deadlineAt === null || deadlineAt === undefined) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [active, deadlineAt]);
  if (!active || deadlineAt === null || deadlineAt === undefined || serverNow === undefined || receivedAt === 0) return null;
  return remainingMs(deadlineAt, serverNow, receivedAt, now);
}

/**
 * «TIEMPO AGOTADO · JUGADA AUTOMÁTICA»: se enciende unos segundos cuando aparece una decisión agotada NUEVA en la vista
 * del servidor (la propia o la del rival). La primera vista de una partida (entrar, recargar) no enseña nada: solo lo
 * que ocurre mientras miras. Sin modal y sin pedir nada: la partida ya siguió.
 */
export function useTimeoutNotice(matchId: string | null | undefined, timeouts: readonly DuelTimeoutView[] | undefined, holdMs = 2800): DuelTimeoutView | null {
  const seen = useRef<{ id: string | null; count: number } | null>(null);
  const [notice, setNotice] = useState<DuelTimeoutView | null>(null);
  useEffect(() => {
    const list = timeouts ?? [];
    const id = matchId ?? null;
    if (!seen.current || seen.current.id !== id) { seen.current = { id, count: list.length }; return; }
    if (list.length > seen.current.count) setNotice(list[list.length - 1]);
    seen.current.count = list.length;
  }, [matchId, timeouts]);
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), holdMs);
    return () => window.clearTimeout(t);
  }, [notice, holdMs]);
  return notice;
}
