/**
 * CANVAS — el lienzo del render: convierte el espacio FRACCIONAL del Composer (0..1,
 * proporción 5:7) a coordenadas del documento SVG maestro, resuelve anclajes y abre/cierra
 * el documento (con la máscara de recorte de carta). Solo geometría: cero decisiones.
 */
import type { Anchor, ElementLayout } from "@/artwork-composer";
import type { RenderSize } from "./types";

/** Radio de esquina de carta (fracción del ancho). */
export const CORNER_RADIUS = 0.055;

export interface Placed {
  /** Esquina superior-izquierda del slot en px del lienzo. */
  x: number;
  y: number;
  /** Tamaño del slot en px (base cuadrada `scale × ancho`, ajustada por elemento). */
  w: number;
  h: number;
  opacity: number;
  rotation: number;
  /** Centro (para rotaciones). */
  cx: number;
  cy: number;
}

const ANCHOR_OFFSET: Record<Anchor, [number, number]> = {
  "center": [0.5, 0.5], "top": [0.5, 0], "bottom": [0.5, 1], "left": [0, 0.5], "right": [1, 0.5],
  "top-left": [0, 0], "top-right": [1, 0], "bottom-left": [0, 1], "bottom-right": [1, 1],
};

/** Coloca un layout fraccional sobre el lienzo. `aspect` = alto/ancho del elemento. */
export function place(layout: ElementLayout, size: RenderSize, aspect = 1): Placed {
  const w = layout.scale * size.width;
  const h = w * aspect;
  const [ax, ay] = ANCHOR_OFFSET[layout.anchor];
  const x = layout.x * size.width - ax * w;
  const y = layout.y * size.height - ay * h;
  return { x, y, w, h, opacity: layout.opacity, rotation: layout.rotation, cx: x + w / 2, cy: y + h / 2 };
}

export const n = (v: number): string => (Math.round(v * 100) / 100).toString();

/** Atributos comunes de un elemento colocado (opacidad + rotación sobre su centro). */
export function placedAttrs(p: Placed): string {
  const parts: string[] = [];
  if (p.opacity < 1) parts.push(`opacity="${n(p.opacity)}"`);
  if (p.rotation !== 0) parts.push(`transform="rotate(${n(p.rotation)} ${n(p.cx)} ${n(p.cy)})"`);
  return parts.length ? " " + parts.join(" ") : "";
}

/** Abre el documento SVG maestro con el clip de carta (esquinas redondeadas). */
export function openDocument(size: RenderSize): string {
  const r = size.width * CORNER_RADIUS;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}" viewBox="0 0 ${size.width} ${size.height}">` +
    `<defs><clipPath id="card-clip"><rect x="0" y="0" width="${size.width}" height="${size.height}" rx="${n(r)}"/></clipPath></defs>` +
    `<g clip-path="url(#card-clip)">`;
}

export const closeDocument = (): string => `</g></svg>`;
