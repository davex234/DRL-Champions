/**
 * Geometría 2D mínima para la simulación: vectores, distancias e intersección de
 * segmentos (para línea de visión / cobertura). Puro y sin dependencias.
 */
export interface Vec2 {
  x: number;
  y: number;
}

export const v = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });

export function len(a: Vec2): number {
  return Math.hypot(a.x, a.y);
}
export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
export function norm(a: Vec2): Vec2 {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l };
}

/** Avanza `from` hacia `to` un máximo de `maxStep` unidades. */
export function moveToward(from: Vec2, to: Vec2, maxStep: number): Vec2 {
  const d = dist(from, to);
  if (d <= maxStep || d === 0) return { ...to };
  const dir = norm(sub(to, from));
  return add(from, scale(dir, maxStep));
}

/** Ángulo (radianes) de `from` hacia `to`. */
export function angleTo(from: Vec2, to: Vec2): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

/** Segmento de muro (para LOS / cobertura). */
export interface Segment {
  a: Vec2;
  b: Vec2;
}

/** ¿Se cruzan los segmentos p1p2 y p3p4? */
export function segmentsIntersect(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): boolean {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (d === 0) return false;
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/** Línea de visión libre entre a y b (no cruza ningún muro). */
export function lineClear(a: Vec2, b: Vec2, walls: readonly Segment[]): boolean {
  for (const w of walls) {
    if (segmentsIntersect(a, b, w.a, w.b)) return false;
  }
  return true;
}

/** Construye los 4 segmentos de un rectángulo (muro/cobertura). */
export function box(x: number, y: number, w: number, h: number): Segment[] {
  const tl = v(x, y), tr = v(x + w, y), br = v(x + w, y + h), bl = v(x, y + h);
  return [
    { a: tl, b: tr },
    { a: tr, b: br },
    { a: br, b: bl },
    { a: bl, b: tl },
  ];
}
