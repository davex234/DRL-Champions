/**
 * COMPONENT SPECS (Render/UI Fase 1/7) — contratos de estilo por TOKENS (no renderiza nada).
 *
 * Cada primitiva mapea (variant/size/state) → estilo resuelto en valores del tema. La capa React futura
 * aplicará estos estilos; aquí solo se define el CONTRATO. Puro y determinista.
 */
import type { ResolvedTheme, ComponentSpec, ResolvedComponent, SizeToken } from "./types";

/** Catálogo de primitivas soportadas (infraestructura, sin lógica). */
export const COMPONENTS = [
  "Button", "IconButton", "Card", "Surface", "Container", "Panel", "Badge", "Avatar", "Chip", "Tag",
  "Divider", "Progress", "Spinner", "Input", "Dropdown", "Checkbox", "Switch", "Slider", "Tabs",
  "Tooltip", "Toast", "Modal", "Drawer", "ContextMenu", "Scrollable", "VirtualList",
] as const;
export type ComponentName = (typeof COMPONENTS)[number];

const padFor = (t: ResolvedTheme, size: SizeToken): number => ({ xs: t.spacing["2"], sm: t.spacing["3"], md: t.spacing["4"], lg: t.spacing["5"], xl: t.spacing["6"] }[size]);
const fontFor = (t: ResolvedTheme, size: SizeToken): number => ({ xs: t.typography.size.xs, sm: t.typography.size.sm, md: t.typography.size.base, lg: t.typography.size.md, xl: t.typography.size.lg }[size]);

/** Resuelve una primitiva a su estilo (valores concretos del tema). */
export function resolveComponent(spec: ComponentSpec, theme: ResolvedTheme): ResolvedComponent {
  const size = spec.size ?? "md";
  const variant = spec.variant ?? "default";
  const state = spec.state ?? "default";
  const p = theme.palette;
  const disabled = state === "disabled";
  const base: Record<string, string | number> = { fontFamily: theme.typography.family.sans, opacity: disabled ? 0.45 : 1 };

  const style = ((): Record<string, string | number> => {
    switch (spec.component) {
      case "Button":
      case "IconButton": {
        const bg = variant === "primary" ? (state === "hover" ? p.accent.hover : state === "active" ? p.accent.active : p.accent.base)
          : variant === "danger" ? p.state.danger
          : variant === "ghost" ? "transparent" : p.surface[2];
        const color = variant === "primary" || variant === "danger" ? p.text.onAccent : p.text.primary;
        return { ...base, height: theme.size[size], padding: spec.component === "IconButton" ? 0 : `0 ${padFor(theme, size)}px`, width: spec.component === "IconButton" ? theme.size[size] : "auto", background: bg, color, borderRadius: theme.radius.md, border: variant === "ghost" ? `${theme.border.hairline}px solid ${p.border}` : "none", fontSize: fontFor(theme, size), fontWeight: theme.typography.weight.semibold, boxShadow: variant === "primary" ? theme.shadow.glow : "none" };
      }
      case "Card":
      case "Surface":
      case "Panel": {
        const level = variant === "raised" ? 3 : variant === "sunken" ? 0 : 1;
        return { ...base, background: p.surface[level], borderRadius: theme.radius.lg, border: `${theme.border.hairline}px solid ${p.border}`, boxShadow: theme.shadow[String(Math.min(4, level + 1))], padding: theme.spacing["4"] };
      }
      case "Container": return { ...base, background: "transparent", padding: theme.spacing["4"], maxWidth: 1280 };
      case "Badge":
      case "Tag":
      case "Chip": {
        const active = state === "active";
        return { ...base, background: active ? p.accent.base : p.accent.subtle, color: active ? p.text.onAccent : p.accent.base, borderRadius: theme.radius.full, padding: `${theme.spacing["1"]}px ${theme.spacing["3"]}px`, fontSize: theme.typography.size.xs, fontWeight: theme.typography.weight.semibold };
      }
      case "Avatar": return { ...base, width: theme.size[size], height: theme.size[size], borderRadius: theme.radius.full, background: p.surface[3], border: `${theme.border.base}px solid ${p.border}` };
      case "Divider": return { ...base, background: p.border, height: theme.border.hairline };
      case "Progress": return { ...base, background: p.surface[0], height: theme.spacing["2"], borderRadius: theme.radius.full, color: p.accent.base };
      case "Spinner": return { ...base, width: theme.size[size], height: theme.size[size], color: p.accent.base };
      case "Input":
      case "Dropdown": return { ...base, height: theme.size[size], padding: `0 ${padFor(theme, size)}px`, background: p.surface[0], color: p.text.primary, border: `${theme.border.hairline}px solid ${state === "focus" ? p.accent.ring : p.border}`, borderRadius: theme.radius.md, fontSize: fontFor(theme, size) };
      case "Checkbox":
      case "Switch": return { ...base, width: theme.size.sm, height: theme.size.xs, background: state === "active" ? p.accent.base : p.surface[3], borderRadius: theme.radius.full, border: `${theme.border.hairline}px solid ${p.border}` };
      case "Slider": return { ...base, height: theme.spacing["2"], background: p.surface[3], color: p.accent.base, borderRadius: theme.radius.full };
      case "Tabs": return { ...base, background: p.surface[1], borderRadius: theme.radius.md, padding: theme.spacing["1"], color: p.text.secondary };
      case "Tooltip": return { ...base, background: p.surface[4], color: p.text.primary, borderRadius: theme.radius.sm, padding: `${theme.spacing["2"]}px ${theme.spacing["3"]}px`, fontSize: theme.typography.size.xs, boxShadow: theme.shadow["3"], zIndex: theme.z.tooltip };
      case "Toast": return { ...base, background: p.surface[3], color: p.text.primary, borderRadius: theme.radius.lg, border: `${theme.border.hairline}px solid ${p.border}`, padding: theme.spacing["4"], boxShadow: theme.shadow["4"], zIndex: theme.z.toast };
      case "Modal": return { ...base, background: p.surface[1], borderRadius: theme.radius.xl, border: `${theme.border.hairline}px solid ${p.border}`, boxShadow: theme.shadow["5"], zIndex: theme.z.modal, padding: theme.spacing["6"] };
      case "Drawer": return { ...base, background: p.surface[1], boxShadow: theme.shadow["5"], zIndex: theme.z.drawer, padding: theme.spacing["5"] };
      case "ContextMenu": return { ...base, background: p.surface[2], borderRadius: theme.radius.md, border: `${theme.border.hairline}px solid ${p.border}`, boxShadow: theme.shadow["3"], zIndex: theme.z.dropdown, padding: theme.spacing["1"] };
      case "Scrollable":
      case "VirtualList": return { ...base, background: "transparent", overflow: "auto" };
      default: return { ...base, background: p.surface[1], color: p.text.primary, borderRadius: theme.radius.md };
    }
  })();

  return { component: spec.component, variant, size, state, style };
}

/** Resuelve un árbol/lote de specs a componentes con estilo. O(n). */
export function buildComponentTree(specs: ComponentSpec[], theme: ResolvedTheme): ResolvedComponent[] {
  return specs.map((s) => resolveComponent(s, theme));
}
