"use client";

import { useCallback, useRef, useState } from "react";
import type { ToastState } from "@/components/ui/Toast";

export function useToast(duration = 2200) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const counter = useRef(0);

  const notify = useCallback(
    (msg: string, ok = true) => {
      counter.current += 1;
      setToast({ id: counter.current, msg, ok });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setToast(null), duration);
    },
    [duration],
  );

  return { toast, notify };
}
