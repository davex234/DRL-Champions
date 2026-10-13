"use client";

/**
 * GLIFOS DE UTILIDAD.
 *
 * Dibujados en SVG, no emoji. Es la misma decisión que ya tomó `PassRail`: 💨 y 🔥 cambian
 * de dibujo en cada sistema operativo, y una pizarra táctica en la que el humo se ve
 * distinto en el portátil del entrenador y en el móvil del jugador no sirve para señalar
 * nada.
 *
 * Cada glifo se dibuja dentro de un cuadrado de −10..10 para poder colocarlo con un
 * `transform` y escalarlo con el mapa sin recalcular ninguna coordenada.
 */
import type { UtilityKind } from "@/domain/tactics";

export function UtilityGlyph({ kind }: { kind: UtilityKind }) {
  const s = {
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  switch (kind) {
    case "smoke":
      return (
        <g>
          <circle cx={-3.5} cy={0.5} r={4.2} {...s} />
          <circle cx={3.2} cy={-1.5} r={3.4} {...s} />
          <circle cx={2} cy={3.5} r={2.8} {...s} />
        </g>
      );
    case "flash":
      return (
        <g>
          <circle cx={0} cy={0} r={3} {...s} />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
            <line
              key={a}
              x1={Math.cos((a * Math.PI) / 180) * 5}
              y1={Math.sin((a * Math.PI) / 180) * 5}
              x2={Math.cos((a * Math.PI) / 180) * 8.5}
              y2={Math.sin((a * Math.PI) / 180) * 8.5}
              {...s}
            />
          ))}
        </g>
      );
    case "molly":
      return (
        <g>
          <path d="M0 -8c3.2 3.4 5 5.6 5 8.4A5 5 0 0 1 -5 0.4C-5 -2.4 -3.2 -4.6 0 -8Z" {...s} />
          <path d="M0 -1.5c1.4 1.6 2.2 2.6 2.2 3.8A2.2 2.2 0 0 1 -2.2 2.3c0-1.2.8-2.2 2.2-3.8Z" {...s} />
        </g>
      );
    case "stun":
      return (
        <g>
          <circle cx={0} cy={0} r={2} {...s} />
          <path d="M-5 -5A7 7 0 0 1 5 -5" {...s} />
          <path d="M-8 -8A11 11 0 0 1 8 -8" {...s} />
          <path d="M-5 5A7 7 0 0 0 5 5" {...s} />
        </g>
      );
    case "wall":
      return (
        <g>
          <path d="M-8.5 -4h17v8h-17Z" {...s} />
          <path d="M-8.5 0h17M-3 -4v8M3 -4v8" {...s} strokeWidth={1.2} />
        </g>
      );
    case "recon":
      return (
        <g>
          <path d="M-9 0C-6 -5.2 -2.8 -7 0 -7s6 1.8 9 7c-3 5.2-6.2 7-9 7S-6 5.2-9 0Z" {...s} />
          <circle cx={0} cy={0} r={2.6} {...s} />
        </g>
      );
    case "spike":
      return (
        <g>
          <circle cx={0} cy={1.5} r={6} {...s} />
          <path d="M0 -4.5v-4" {...s} />
          <path d="M-2.5 1.5h5M0 -1v5" {...s} strokeWidth={1.2} />
        </g>
      );
    case "waypoint":
      return (
        <g>
          <path d="M0 8c0 0-6-5.4-6-9.4A6 6 0 0 1 6 -1.4C6 2.6 0 8 0 8Z" {...s} />
          <circle cx={0} cy={-1.6} r={2.2} {...s} />
        </g>
      );
    case "marker":
    default:
      return (
        <g>
          <path d="M0 -8 8 0 0 8 -8 0Z" {...s} />
          <circle cx={0} cy={0} r={1.6} fill="currentColor" stroke="none" />
        </g>
      );
  }
}
