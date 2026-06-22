"use client";

import { useEffect, useState } from "react";
import { countdown } from "@/domain/events/time";

/** Cuenta atrás en vivo (días · horas · minutos · segundos) hasta `target`. */
export function Countdown({ target, accent = "#ff2e63" }: { target: number; accent?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const c = countdown(target - now);
  const units: [number, string][] = [
    [c.days, "Días"],
    [c.hours, "Horas"],
    [c.minutes, "Min"],
    [c.seconds, "Seg"],
  ];

  return (
    <div className="flex gap-2">
      {units.map(([v, label]) => (
        <div
          key={label}
          className="min-w-[52px] rounded-lg border px-2 py-1.5 text-center"
          style={{ borderColor: `${accent}55`, background: `${accent}14` }}
        >
          <div className="font-display text-xl font-bold tabular-nums text-white">
            {String(v).padStart(2, "0")}
          </div>
          <div className="text-[9px] uppercase tracking-widest text-white/45">{label}</div>
        </div>
      ))}
    </div>
  );
}
