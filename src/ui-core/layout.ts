/**
 * LAYOUT ENGINE (Render/UI Fase 1/7) — cálculo de layout PURO (sin React, sin DOM).
 *
 * `buildLayout` normaliza un árbol de nodos (defaults por tipo, ids únicos); `measureLayout` calcula los
 * rectángulos dado un viewport (stack/row/grid/split/sidebar/inspector/dock/overlay + safe areas). Box
 * math determinista, O(nodos). Preparado para docenas de regiones por pantalla.
 */
import type { LayoutNode, MeasuredNode, Viewport, Rect, SafeArea } from "./types";

const NO_SAFE: SafeArea = { top: 0, right: 0, bottom: 0, left: 0 };
const rowKinds = new Set(["row", "split", "sidebar", "inspector"]);

/** Normaliza el árbol: dirección por defecto, gap/padding, ids únicos. No lanza; corrige duplicados. */
export function buildLayout(node: LayoutNode): LayoutNode {
  const seen = new Set<string>();
  let counter = 0;
  const walk = (n: LayoutNode): LayoutNode => {
    let id = n.id || `n${counter++}`;
    while (seen.has(id)) id = `${id}_${counter++}`;
    seen.add(id);
    const direction = n.direction ?? (rowKinds.has(n.kind) ? "row" : "column");
    return {
      ...n, id, direction,
      gap: n.gap ?? 0, padding: n.padding ?? 0,
      children: (n.children ?? []).map(walk),
    };
  };
  return walk(node);
}

const px = (spacing: Record<string, number>, step: number): number => spacing[String(step)] ?? step * 4;

/** Reparte un tamaño principal entre hijos (fijos por px, "fill" comparten el resto). */
function distribute(children: LayoutNode[], total: number, gap: number): number[] {
  const gaps = Math.max(0, children.length - 1) * gap;
  let fixed = 0, fillCount = 0;
  for (const c of children) {
    if (typeof c.size === "number") fixed += c.size;
    else if (c.size === "auto") fixed += c.min ?? 0;
    else fillCount++;
  }
  const remaining = Math.max(0, total - gaps - fixed);
  const per = fillCount > 0 ? remaining / fillCount : 0;
  return children.map((c) => {
    if (typeof c.size === "number") return c.size;
    if (c.size === "auto") return c.min ?? 0;
    let v = per;
    if (c.min != null) v = Math.max(v, c.min);
    if (c.max != null) v = Math.min(v, c.max);
    return v;
  });
}

function measureNode(node: LayoutNode, rect: Rect, spacing: Record<string, number>): MeasuredNode {
  const pad = px(spacing, node.padding ?? 0);
  const inner: Rect = { x: rect.x + pad, y: rect.y + pad, width: Math.max(0, rect.width - pad * 2), height: Math.max(0, rect.height - pad * 2) };
  const gap = px(spacing, node.gap ?? 0);
  const kids = node.children ?? [];
  const out: MeasuredNode = { id: node.id, kind: node.kind, rect, region: node.region, children: [] };
  if (kids.length === 0) return out;

  if (node.kind === "overlay" || node.kind === "container" || node.kind === "navhost") {
    out.children = kids.map((c) => measureNode(c, inner, spacing));
    return out;
  }

  if (node.kind === "grid") {
    const cols = Math.max(1, node.columns ?? 2);
    const cw = (inner.width - gap * (cols - 1)) / cols;
    const rows = Math.ceil(kids.length / cols);
    const ch = rows > 0 ? (inner.height - gap * (rows - 1)) / rows : inner.height;
    out.children = kids.map((c, i) => {
      const r = Math.floor(i / cols), col = i % cols;
      return measureNode(c, { x: Math.round(inner.x + col * (cw + gap)), y: Math.round(inner.y + r * (ch + gap)), width: Math.round(cw), height: Math.round(ch) }, spacing);
    });
    return out;
  }

  if (node.kind === "dock") { out.children = measureDock(kids, inner, gap, spacing); return out; }

  // Flex (stack/row/split/sidebar/inspector).
  const dir = node.direction ?? (rowKinds.has(node.kind) ? "row" : "column");
  const mainTotal = dir === "row" ? inner.width : inner.height;
  const sizes = distribute(kids, mainTotal, gap);
  let cursor = dir === "row" ? inner.x : inner.y;
  out.children = kids.map((c, i) => {
    const s = sizes[i];
    const r: Rect = dir === "row"
      ? { x: Math.round(cursor), y: inner.y, width: Math.round(s), height: inner.height }
      : { x: inner.x, y: Math.round(cursor), width: inner.width, height: Math.round(s) };
    cursor += s + gap;
    return measureNode(c, r, spacing);
  });
  return out;
}

/** Dock 2D: top/bottom (ancho completo), left/right (alto restante), center (relleno). */
function measureDock(kids: LayoutNode[], inner: Rect, gap: number, spacing: Record<string, number>): MeasuredNode[] {
  let { x, y, width, height } = inner;
  const byRegion = (r: string) => kids.find((k) => k.region === r);
  const result: MeasuredNode[] = [];
  const consume = (region: string, edge: "top" | "bottom" | "left" | "right") => {
    const k = byRegion(region); if (!k) return;
    const size = typeof k.size === "number" ? k.size : 0;
    let r: Rect;
    if (edge === "top") { r = { x, y, width, height: size }; y += size + gap; height -= size + gap; }
    else if (edge === "bottom") { r = { x, y: y + height - size, width, height: size }; height -= size + gap; }
    else if (edge === "left") { r = { x, y, width: size, height }; x += size + gap; width -= size + gap; }
    else { r = { x: x + width - size, y, width: size, height }; width -= size + gap; }
    result.push(measureNode(k, { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(Math.max(0, r.width)), height: Math.round(Math.max(0, r.height)) }, spacing));
  };
  consume("top", "top"); consume("bottom", "bottom"); consume("left", "left"); consume("right", "right");
  const center = byRegion("center") ?? byRegion("main");
  if (center) result.push(measureNode(center, { x: Math.round(x), y: Math.round(y), width: Math.round(Math.max(0, width)), height: Math.round(Math.max(0, height)) }, spacing));
  return result;
}

/** Calcula los rectángulos del árbol para un viewport. Determinista. */
export function measureLayout(node: LayoutNode, viewport: Viewport, spacing: Record<string, number> = {}): MeasuredNode {
  const built = buildLayout(node);
  const safe = built.safeArea ? (viewport.safe ?? NO_SAFE) : NO_SAFE;
  const rect: Rect = { x: safe.left, y: safe.top, width: Math.max(0, viewport.width - safe.left - safe.right), height: Math.max(0, viewport.height - safe.top - safe.bottom) };
  return measureNode(built, rect, spacing);
}

/** Resuelve el breakpoint activo para un ancho. */
export function breakpointFor(width: number, breakpoints: Record<string, number>): string {
  const entries = Object.entries(breakpoints).sort((a, b) => b[1] - a[1]);
  for (const [name, min] of entries) if (width >= min) return name;
  return entries[entries.length - 1]?.[0] ?? "xs";
}
