/**
 * CSS VARIABLES (Render/UI Fase 1/7) — proyecta un tema resuelto a variables CSS `--ui-*`.
 *
 * El motor SOLO produce el mapa (puro); el borde (React/DOM) lo escribe en `:root`. Reutiliza las
 * variables de fuente existentes. Determinista.
 */
import type { ResolvedTheme } from "./types";

/** Convierte un tema resuelto en un mapa de custom properties (`--ui-...` → valor). */
export function themeToCssVars(theme: ResolvedTheme): Record<string, string> {
  const v: Record<string, string> = {};
  const p = theme.palette;
  v["--ui-bg"] = p.bg;
  p.surface.forEach((c, i) => (v[`--ui-surface-${i}`] = c));
  v["--ui-border"] = p.border;
  v["--ui-border-strong"] = p.borderStrong;
  v["--ui-overlay"] = p.overlay;
  v["--ui-text"] = p.text.primary;
  v["--ui-text-secondary"] = p.text.secondary;
  v["--ui-text-muted"] = p.text.muted;
  v["--ui-text-inverse"] = p.text.inverse;
  v["--ui-on-accent"] = p.text.onAccent;
  v["--ui-accent"] = p.accent.base;
  v["--ui-accent-hover"] = p.accent.hover;
  v["--ui-accent-active"] = p.accent.active;
  v["--ui-accent-subtle"] = p.accent.subtle;
  v["--ui-accent-ring"] = p.accent.ring;
  for (const [k, c] of Object.entries(p.state)) v[`--ui-${k}`] = c;
  for (const [k, c] of Object.entries(p.rarity)) v[`--ui-rarity-${k}`] = c;

  for (const [k, n] of Object.entries(theme.spacing)) v[`--ui-space-${k}`] = `${n}px`;
  for (const [k, n] of Object.entries(theme.radius)) v[`--ui-radius-${k}`] = `${n}px`;
  for (const [k, n] of Object.entries(theme.border)) v[`--ui-border-${k}`] = `${n}px`;
  for (const [k, n] of Object.entries(theme.size)) v[`--ui-size-${k}`] = `${n}px`;
  for (const [k, s] of Object.entries(theme.shadow)) v[`--ui-shadow-${k}`] = s;
  for (const [k, n] of Object.entries(theme.typography.size)) v[`--ui-font-${k}`] = `${n}px`;
  for (const [k, n] of Object.entries(theme.typography.weight)) v[`--ui-weight-${k}`] = String(n);
  for (const [k, s] of Object.entries(theme.typography.family)) v[`--ui-family-${k}`] = s;
  for (const [k, n] of Object.entries(theme.motion.duration)) v[`--ui-dur-${k}`] = `${n}ms`;
  for (const [k, s] of Object.entries(theme.motion.easing)) v[`--ui-ease-${k}`] = s;
  for (const [k, n] of Object.entries(theme.z)) v[`--ui-z-${k}`] = String(n);
  v["--ui-blur"] = `${theme.blur}px`;
  v["--ui-transparency"] = String(theme.transparency);
  return v;
}
