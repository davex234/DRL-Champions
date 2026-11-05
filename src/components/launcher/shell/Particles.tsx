"use client";

/**
 * LAUNCHER — PARTÍCULAS DE AMBIENTE.
 *
 * Motas de ceniza subiendo por el hero. Están hechas con animaciones CSS puras (`transform` +
 * `opacity`) y posiciones deterministas calculadas UNA vez: ni canvas, ni bucle de JavaScript,
 * ni un solo cálculo por fotograma en el hilo principal. El compositor hace todo el trabajo.
 *
 * La cantidad la decide la intensidad de efectos de la configuración; a 0 no se monta nada.
 */
import { useMemo } from "react";
import { noise } from "@/launcher";

export function Particles({
  seed, color, count, className,
}: { seed: number; color: string; count: number; className?: string }) {
  const motes = useMemo(
    () =>
      Array.from({ length: Math.max(0, count) }, (_, i) => {
        const a = noise(seed, i);
        const b = noise(seed + 5000, i);
        const c = noise(seed + 9000, i);
        return {
          left: `${(a * 100).toFixed(2)}%`,
          bottom: `${(-10 + b * 45).toFixed(2)}%`,
          size: 1 + c * 2.4,
          duration: `${(11 + b * 14).toFixed(2)}s`,
          delay: `${(-a * 20).toFixed(2)}s`,
          drift: `${(-30 + c * 60).toFixed(1)}px`,
          opacity: 0.18 + c * 0.4,
        };
      }),
    [seed, count],
  );

  if (motes.length === 0) return null;

  return (
    <div className={className} aria-hidden>
      {motes.map((m, i) => (
        <span
          key={i}
          className="nx-mote"
          style={{
            left: m.left,
            bottom: m.bottom,
            width: m.size,
            height: m.size,
            background: color,
            animationDuration: m.duration,
            animationDelay: m.delay,
            ["--drift" as string]: m.drift,
            ["--mote-opacity" as string]: m.opacity.toFixed(2),
          }}
        />
      ))}
    </div>
  );
}
