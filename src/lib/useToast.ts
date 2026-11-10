"use client";

import { useCallback, useRef, useState } from "react";
import type { ToastState } from "@/components/ui/Toast";

/**
 * Aviso breve de la pantalla. F64 · SIN SPAM: el mismo mensaje repetido mientras está en pantalla NO vuelve a entrar
 * (no reanima, no vuelve a sonar): se agrega como «×N» y alarga su tiempo. Un mensaje distinto sustituye al anterior
 * (el último manda: nunca una pila de seis avisos tapando la pantalla).
 */
export function useToast(duration = 2200) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const counter = useRef(0);
  const current = useRef<ToastState | null>(null);

  const notify = useCallback(
    (msg: string, ok = true) => {
      const cur = current.current;
      const next: ToastState = cur && cur.msg === msg && cur.ok === ok
        ? { ...cur, count: (cur.count ?? 1) + 1 }
        : { id: (counter.current += 1), msg, ok, count: 1 };
      current.current = next;
      setToast(next);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => { current.current = null; setToast(null); }, duration);
    },
    [duration],
  );

  return { toast, notify };
}
