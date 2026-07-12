// ❄️ FROZEN (Consolidation F1.1, 2026-07-06): motor completo y verificado SIN consumidores de
// producto hoy. Se conserva por valor de roadmap (wire before kill). NO crecer ni integrar
// sin decision explicita. Registro y criterios: docs/FROZEN.md
/**
 * UI CORE FRAMEWORK & DESIGN SYSTEM — API pública (Render/UI Fase 1/7).
 *
 * Base ÚNICA sobre la que se construirá TODA la UI del juego. Framework de presentación PURO y
 * framework-agnóstico (sin React): Design System por tokens + Theme Engine (dark/light/auto/accent/
 * high-contrast/accesibilidad) + Layout Engine + contratos de primitivas + iconos, resueltos en valores
 * concretos y variables CSS. La UI SOLO proyecta; nunca es dueña del estado. NO implementa gameplay/
 * lógica/HUD/pantallas/animaciones/navegación/render. Determinista, versionado, migrable.
 *
 *   Theme → Design Tokens → Primitives → Components → Layouts → (Pages/Features/Screens)
 */
export * from "./types";
export * from "./tokens";
export {
  isHex, hexToRgb, rgbToHex, hexToHsl, hslToHex, lighten, darken, saturate, withAlpha, mix,
  contrastRatio, meetsAA, readableOn,
} from "./color";
export { resolvePalette } from "./palette";
export { resolveTypography } from "./typography";
export { createTheme, defaultThemeConfig, resolveTheme, validateTheme, effectiveMode } from "./theme";
export { themeToCssVars } from "./cssvars";
export { buildLayout, measureLayout, breakpointFor } from "./layout";
export { COMPONENTS, resolveComponent, buildComponentTree, type ComponentName } from "./components";
export { ICONS, resolveIcons, getIcon, type IconDef } from "./icons";
export { migrateThemeConfig } from "./migrate";
export { UIEngine, type AppliedTheme } from "./engine";
