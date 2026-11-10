"use client";

/**
 * LAS LÍNEAS DEL CUADRO (Fase 24.3) — SVG ligero sobre las cajas, medido del DOM.
 *
 * Solo dibuja las aristas que el dominio ha VERIFICADO (`model.edges`): del lado derecho de
 * la caja origen al lado izquierdo de la caja destino, con un codo a mitad de camino. Ganador
 * en línea continua; perdedor (cuadro bajo) en línea discontinua. Nada más: si el modelo no
 * tiene aristas, aquí no hay ni una línea.
 *
 * Es decorativo (`aria-hidden`): la estructura semántica la dan las secciones y artículos.
 * Se recalcula al cambiar el tamaño del contenedor (ResizeObserver), nunca en un bucle.
 */
import { useLayoutEffect, useState, type RefObject } from "react";
import type { BracketEdge, EdgeMeta } from "@/domain/pickems/bracket";

/** Arista con su procedencia ya resuelta por el contenedor. */
export type DrawableEdge = BracketEdge & { kind?: EdgeMeta["kind"] };

interface Line { d: string; source: BracketEdge["source"]; kind: EdgeMeta["kind"] }

export function BracketConnectors({
  containerRef, edges, version,
}: {
  /** El contenido desplazable que contiene las cajas (`[data-match-id]`). */
  containerRef: RefObject<HTMLElement | null>;
  edges: DrawableEdge[];
  /** Cambia cuando cambia lo que hay dentro, para volver a medir. */
  version: string | number;
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    const measure = () => {
      const base = root.getBoundingClientRect();
      const boxes = new Map<string, DOMRect>();
      root.querySelectorAll<HTMLElement>("[data-match-id]").forEach((el) => {
        boxes.set(el.dataset.matchId!, el.getBoundingClientRect());
      });
      const out: Line[] = [];
      for (const e of edges) {
        const a = boxes.get(e.from), b = boxes.get(e.to);
        if (!a || !b) continue;
        const x1 = a.right - base.left + root.scrollLeft, y1 = a.top + a.height / 2 - base.top + root.scrollTop;
        const x2 = b.left - base.left + root.scrollLeft;
        // Entra por la fila del hueco que ocupa (arriba = a, abajo = b); sin hueco conocido, por el centro.
        const y2 = b.top + (e.slot === "a" ? b.height * 0.36 : e.slot === "b" ? b.height * 0.64 : b.height * 0.5) - base.top + root.scrollTop;
        if (x2 > x1 + 4) {
          // Hacia la derecha: sale por el lado derecho, codo a mitad de camino, entra por la izquierda.
          const mx = x1 + (x2 - x1) / 2;
          out.push({ d: `M ${x1} ${y1} H ${mx} V ${y2} H ${x2}`, source: e.source, kind: e.kind ?? "RESULT_VERIFIED" });
        } else if (b.top > a.bottom) {
          // Hacia abajo (perdedor que cae al cuadro bajo en la misma columna): sale por debajo y
          // entra por arriba, con el codo entre las dos filas.
          const cx1 = a.left + a.width / 2 - base.left + root.scrollLeft;
          const cx2 = b.left + b.width / 2 - base.left + root.scrollLeft;
          const by1 = a.bottom - base.top + root.scrollTop;
          const by2 = b.top - base.top + root.scrollTop;
          const my = by1 + (by2 - by1) / 2;
          out.push({ d: `M ${cx1} ${by1} V ${my} H ${cx2} V ${by2}`, source: e.source, kind: e.kind ?? "RESULT_VERIFIED" });
        } else if (b.bottom < a.top) {
          // Hacia arriba (la Final Baja sube a la Gran Final, que vive en la fila alta): sale por
          // encima y entra por debajo, con el codo entre las dos filas.
          const cx1 = a.left + a.width / 2 - base.left + root.scrollLeft;
          const cx2 = b.left + b.width / 2 - base.left + root.scrollLeft;
          const ty1 = a.top - base.top + root.scrollTop;
          const ty2 = b.bottom - base.top + root.scrollTop;
          const my = ty2 + (ty1 - ty2) / 2;
          out.push({ d: `M ${cx1} ${ty1} V ${my} H ${cx2} V ${ty2}`, source: e.source, kind: e.kind ?? "RESULT_VERIFIED" });
        }
        // Hacia atrás en la misma fila: no se dibuja. El cuadro avanza en un sentido.
      }
      setLines(out);
      setSize({ w: root.scrollWidth, h: root.scrollHeight });
    };

    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(root);
    window.addEventListener("resize", measure);
    return () => { ro?.disconnect(); window.removeEventListener("resize", measure); };
  }, [containerRef, edges, version]);

  if (lines.length === 0) return null;

  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute left-0 top-0"
      width={size.w}
      height={size.h}
      viewBox={`0 0 ${size.w} ${size.h}`}
      data-connectors={lines.length}
    >
      {lines.map((l, i) => (
        <g key={i} className="nx-bracket-line" data-kind={l.kind} data-source={l.source}>
          <path d={l.d} fill="none" stroke="rgba(0,0,0,0.6)" strokeWidth="4" strokeLinejoin="round" />
          <path
            d={l.d}
            fill="none"
            stroke={l.source === "WINNER" ? "var(--nx-cyan)" : "rgba(238,241,248,0.35)"}
            strokeWidth="1.5"
            strokeDasharray={l.source === "LOSER" ? "5 4" : undefined}
            strokeLinejoin="round"
            // Estructura confirmada aún sin resultado: la misma línea, un punto más tenue; se enciende al verificarse.
            opacity={l.kind === "STRUCTURAL" ? 0.75 : 1}
            style={l.source === "WINNER" ? { filter: "drop-shadow(0 0 4px rgba(25,227,255,0.45))" } : undefined}
          />
        </g>
      ))}
    </svg>
  );
}
