"use client";

/**
 * ICONOS DE HERRAMIENTA — qué hace el siguiente gesto sobre el mapa.
 *
 * ────────────────────────── POR QUÉ EXISTE ──────────────────────────
 *
 * El rail de la pizarra tenía las seis formas de dibujo como seis RÓTULOS DE TEXTO del mismo
 * tamaño —«Flecha», «Línea», «Círculo», «Rectángulo», «Zona», «Trazo»— uno al lado de otro. A
 * un metro del portátil son seis rectángulos idénticos y hay que leerlos de uno en uno; con la
 * mano en el mapa y el equipo esperando, eso es fricción pura.
 *
 * Cada icono dibuja LO QUE LA HERRAMIENTA PRODUCE. No es decoración: es la misma figura que va
 * a aparecer sobre el mapa. Por eso `free` es un garabato y no un lápiz, y `zone` un polígono y
 * no un cubo de pintura: el icono enseña el resultado, no el instrumento.
 *
 * Son SVG en un `viewBox` de 16×16 con `currentColor`, como el resto de los glifos del
 * Entrenador: escalan, heredan el color del botón y no dependen de ninguna fuente de iconos.
 */
import type { DrawKind } from "@/domain/tactics";

export type ToolGlyphKind = DrawKind | "select" | "text";

export function ToolGlyph({ kind, size = 14, color }: {
  kind: ToolGlyphKind;
  size?: number;
  /** Para las formas: el color con el que se va a dibujar. Sin él, hereda el del botón. */
  color?: string;
}) {
  const s = {
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      aria-hidden
      className="shrink-0"
      style={color ? { color } : undefined}
    >
      {kind === "select" && (
        /* El puntero de siempre: la flecha que agarra y mueve. */
        <g {...s}><path d="M3 2l9 5.2-4 1-1.6 4z" /></g>
      )}
      {kind === "arrow" && (
        <g {...s}><path d="M2.5 13L12 4" /><path d="M7.5 3.4H12.6V8.5" /></g>
      )}
      {kind === "line" && (
        <g {...s}><path d="M2.5 13L13 3.5" /></g>
      )}
      {kind === "circle" && (
        <g {...s}><circle cx="8" cy="8" r="5.3" /></g>
      )}
      {kind === "rect" && (
        <g {...s}><rect x="2.7" y="3.6" width="10.6" height="8.8" rx="0.8" /></g>
      )}
      {kind === "zone" && (
        /* Un polígono a mano: lo que sale al cerrar un área. */
        <g {...s}><path d="M3 6.2l3.4-3.1 6.3 2.2-1.3 6.4-6.6 1z" /></g>
      )}
      {kind === "free" && (
        <g {...s}><path d="M2.5 10.6c2-4.6 3.4 2.4 5.2-.6s2.4-6.2 5.6-4.4" /></g>
      )}
      {kind === "text" && (
        <g {...s}><path d="M3.4 4.2h9.2" /><path d="M8 4.2v8.2" /></g>
      )}
    </svg>
  );
}
