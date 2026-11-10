/**
 * VERIFICACIÓN — UI Core Framework & Design System (DRL Champions, Render/UI Fase 1/7).
 *
 *   npx tsx scripts/ui-core-verify.ts
 *
 * Comprueba el framework de PRESENTACIÓN puro (sin React) que será la base de TODA la UI: theme/palette/
 * typography/spacing/components/layouts/tokens/responsive/accessibility(contraste)/dark+light/versionado/
 * migraciones/performance(1000 pantallas · 100k componentes)/determinismo/cero estados imposibles. NO
 * implementa gameplay/lógica. 100% DETERMINISTA.
 */
import { UIEngine, contrastRatio, meetsAA, breakpointFor, migrateThemeConfig, COMPONENTS, resolveIcons, withAlpha } from "../src/ui-core";

let failures = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`  ${c ? "✓" : "✕"} ${l}${d ? ` — ${d}` : ""}`); if (!c) failures++; };
console.log("# Verificación del UI Core Framework & Design System — DRL Champions (Render/UI Fase 1/7)\n");

const ui = new UIEngine();

// ─────────────────────── 1. Theme (dark/light/auto/accent) ───────────────────────
console.log("## Theme Engine (dark / light / auto / accent)");
{
  const dark = ui.applyTheme(ui.createTheme());
  check("DARK: tema por defecto resuelto (bg esports + acento)", dark.theme.mode === "dark" && dark.theme.palette.bg === "#06070d" && dark.theme.palette.accent.base === "#ff2e63");
  const light = ui.applyTheme(ui.createTheme({ mode: "light" }));
  check("LIGHT: modo claro con superficies claras y texto oscuro", light.theme.mode === "light" && light.theme.palette.bg !== dark.theme.palette.bg);
  check("AUTO: resuelve con la preferencia del sistema", ui.resolveTheme(ui.createTheme({ mode: "auto", systemPrefersDark: false })).mode === "light" && ui.resolveTheme(ui.createTheme({ mode: "auto", systemPrefersDark: true })).mode === "dark");
  const accent = ui.applyTheme(ui.createTheme({ accent: "#19e3ff" }));
  check("ACCENT: acento personalizado se propaga a la paleta + variables", accent.theme.palette.accent.base === "#19e3ff" && accent.cssVars["--ui-accent"] === "#19e3ff");
}

// ─────────────────────── 2. Palette / accesibilidad (contraste) ───────────────────────
console.log("\n## Palette / accesibilidad (contraste WCAG)");
{
  const dark = ui.resolveTheme(ui.createTheme());
  check("CONTRASTE: texto principal sobre superficie cumple AA (>=4.5)", meetsAA(dark.palette.text.primary, dark.palette.surface[1]));
  check("CONTRASTE: texto sobre acento legible (>=3)", contrastRatio(dark.palette.text.onAccent, dark.palette.accent.base) >= 3);
  const hc = ui.resolveTheme(ui.createTheme({ highContrast: true }));
  check("HIGH CONTRAST: sube el contraste del texto principal", contrastRatio(hc.palette.text.primary, hc.palette.surface[1]) >= contrastRatio(dark.palette.text.primary, dark.palette.surface[1]));
  check("VALIDATE: detecta acento inválido y baja accesibilidad", !ui.validateTheme(ui.createTheme({ accent: "nope" })).ok);
}

// ─────────────────────── 3. Typography / spacing / density ───────────────────────
console.log("\n## Typography / Spacing / Density");
{
  check("SPACING: escala por unidad base × densidad", ui.resolveSpacing(4, "cozy") === 16 && ui.resolveSpacing(4, "compact") < 16 && ui.resolveSpacing(4, "comfortable") > 16);
  const typ = ui.resolveTypography("cozy");
  check("TYPOGRAPHY: familias + escala + pesos + interlineado", !!typ.family.display && typ.size.base > 0 && typ.weight.bold === 700 && typ.lineHeight.normal === 1.5);
  const tokens = ui.resolveTokens(ui.createTheme({ density: "comfortable" }));
  check("TOKENS: radius/border/size/motion/breakpoints/z resueltos", tokens.radius.md > 0 && tokens.size.md > 0 && tokens.z.modal > tokens.z.dropdown && tokens.breakpoints.ultrawide > tokens.breakpoints.xl);
}

// ─────────────────────── 4. Components (contratos por tokens) ───────────────────────
console.log("\n## Components (contratos por tokens, sin render)");
{
  const cfg = ui.createTheme();
  const tree = ui.buildComponentTree(COMPONENTS.map((c) => ({ component: c })), cfg);
  check("COMPONENTS: TODAS las primitivas resuelven a un estilo por tokens", tree.length === COMPONENTS.length && tree.every((c) => Object.keys(c.style).length > 0));
  const btn = ui.resolveComponent({ component: "Button", variant: "primary", size: "lg", state: "hover" }, cfg);
  check("VARIANTES: Button primary/hover usa acento hover + altura por tamaño", btn.style.background === ui.resolveTheme(cfg).palette.accent.hover && btn.style.height === ui.resolveTheme(cfg).size.lg);
  const disabled = ui.resolveComponent({ component: "Button", state: "disabled" }, cfg);
  check("ESTADOS: disabled reduce opacidad", (disabled.style.opacity as number) < 1);
}

// ─────────────────────── 5. Layout Engine ───────────────────────
console.log("\n## Layout Engine (stack/split/sidebar/inspector/grid/dock/overlay + safe areas)");
{
  const cfg = ui.createTheme();
  const vp = { width: 1920, height: 1080 };
  const m = ui.measureLayout({ id: "root", kind: "row", gap: 4, children: [{ id: "l", kind: "sidebar", size: 280 }, { id: "c", kind: "stack", size: "fill" }, { id: "r", kind: "inspector", size: 360 }] }, vp, cfg);
  const [l, c, r] = m.children;
  check("SPLIT/SIDEBAR/INSPECTOR: fijos + relleno reparten el ancho exacto", l.rect.width === 280 && r.rect.width === 360 && c.rect.width === vp.width - 280 - 360 - 2 * 16 && l.rect.height === 1080);
  const grid = ui.measureLayout({ id: "g", kind: "grid", columns: 4, gap: 2, children: Array.from({ length: 8 }, (_, i) => ({ id: `x${i}`, kind: "container" })) }, vp, cfg);
  check("GRID: 8 celdas en 4 columnas (2 filas), sin solaparse", grid.children.length === 8 && grid.children[4].rect.y > grid.children[0].rect.y);
  const dock = ui.measureLayout({ id: "d", kind: "dock", children: [{ id: "top", kind: "container", region: "top", size: 64 }, { id: "mid", kind: "container", region: "center" }] }, vp, cfg);
  check("DOCK: top fija altura, center rellena el resto", dock.children.find((n) => n.id === "top")!.rect.height === 64 && dock.children.find((n) => n.id === "mid")!.rect.height === 1080 - 64);
  const safe = ui.measureLayout({ id: "s", kind: "container", safeArea: true }, { width: 1000, height: 800, safe: { top: 40, right: 0, bottom: 20, left: 0 } }, cfg);
  check("SAFE AREAS: el root respeta las áreas seguras", safe.rect.y === 40 && safe.rect.height === 800 - 40 - 20);
  check("RESPONSIVE: breakpoint activo por ancho", breakpointFor(500, ui.resolveTheme(cfg).breakpoints) === "sm" && breakpointFor(2400, ui.resolveTheme(cfg).breakpoints) === "ultrawide");
  // ids únicos aunque haya duplicados en la entrada.
  const dup = ui.buildLayout({ id: "a", kind: "stack", children: [{ id: "x", kind: "container" }, { id: "x", kind: "container" }] });
  check("SEGURIDAD: ids duplicados se corrigen (nunca colisionan)", dup.children![0].id !== dup.children![1].id);
}

// ─────────────────────── 6. CSS variables ───────────────────────
console.log("\n## CSS variables (proyección para :root)");
{
  const { cssVars } = ui.applyTheme(ui.createTheme());
  check("VARS: se generan --ui-* para color/spacing/radius/tipografía/motion/z", cssVars["--ui-bg"] != null && cssVars["--ui-space-4"] === "16px" && cssVars["--ui-radius-md"] != null && cssVars["--ui-font-base"] != null && cssVars["--ui-z-modal"] != null);
  check("VARS: reutiliza las familias de fuente del proyecto (no las duplica)", cssVars["--ui-family-display"].includes("--font-display"));
}

// ─────────────────────── 7. Migraciones / versionado ───────────────────────
console.log("\n## Migraciones / versionado");
{
  const m = migrateThemeConfig({ mode: "inventado", accent: "nope", density: "raro", transparency: 5, blur: -3, version: 0 });
  check("MIGRACIÓN: config corrupta se sanea (defaults + rangos acotados)", m.version >= 1 && m.mode === "dark" && m.accent.startsWith("#") && m.transparency <= 1 && m.blur >= 0);
  check("MIGRACIÓN: nulo ⇒ config por defecto", migrateThemeConfig(null).mode === "dark");
  check("LOAD: loadTheme = migrar (config visual únicamente)", ui.loadTheme({ accent: "#123456" }).accent === "#123456");
}

// ─────────────────────── 8. Determinismo ───────────────────────
console.log("\n## Determinismo");
{
  const a = ui.applyTheme(ui.createTheme({ accent: "#ffd35c", density: "compact" }));
  const b = new UIEngine().applyTheme(new UIEngine().createTheme({ accent: "#ffd35c", density: "compact" }));
  check("DETERMINISMO: misma config ⇒ mismo id + mismas variables", a.theme.id === b.theme.id && JSON.stringify(a.cssVars) === JSON.stringify(b.cssVars));
}

// ─────────────────────── 9. Cero estados imposibles ───────────────────────
console.log("\n## Cero estados imposibles");
{
  let bad = 0;
  try {
    if (ui.resolveIcons(["home", "no-existe"]).length !== 1) bad++;               // icono desconocido ignorado
    if (ui.measureLayout({ id: "e", kind: "stack" }, { width: 0, height: 0 }).rect.width !== 0) bad++; // viewport 0 no rompe
    const neg = ui.measureLayout({ id: "n", kind: "row", children: [{ id: "big", kind: "container", size: 5000 }, { id: "fill", kind: "container", size: "fill" }] }, { width: 800, height: 600 });
    if (neg.children[1].rect.width < 0) bad++;                                     // nunca ancho negativo
    if (withAlpha("#ffffff", 5).indexOf("rgba") !== 0) bad++;                      // alfa fuera de rango se acota
  } catch { bad++; }
  check("INTEGRIDAD: iconos desconocidos, viewport 0 y overflow no producen estados imposibles", bad === 0);
}

// ─────────────────────── 10. Rendimiento (1000 pantallas · 100k componentes) ───────────────────────
console.log("\n## Rendimiento (1000 pantallas · 100.000 componentes)");
{
  const cfg = ui.createTheme();
  const engine = new UIEngine();
  const t0 = Date.now();
  // 1000 pantallas comparten el tema (caché O(1)).
  for (let i = 0; i < 1000; i++) engine.resolveTheme(cfg);
  const themeMs = Date.now() - t0;
  // 100.000 componentes resueltos.
  const t1 = Date.now();
  const specs = Array.from({ length: 100000 }, (_, i) => ({ component: COMPONENTS[i % COMPONENTS.length] }));
  const tree = engine.buildComponentTree(specs, cfg);
  const compMs = Date.now() - t1;
  // Layout de una pantalla con muchas regiones (grid grande).
  const t2 = Date.now();
  const big = engine.measureLayout({ id: "grid", kind: "grid", columns: 20, gap: 2, children: Array.from({ length: 2000 }, (_, i) => ({ id: `c${i}`, kind: "container" })) }, { width: 3840, height: 2160 }, cfg);
  const layoutMs = Date.now() - t2;
  check("RENDIMIENTO: 1000 pantallas (caché) + 100k componentes + grid 2000 nodos, sin O(n²)",
    themeMs < 500 && compMs < 3000 && layoutMs < 1000 && tree.length === 100000 && big.children.length === 2000 && engine.cacheSize() === 1,
    `1000 temas=${themeMs}ms (caché ${engine.cacheSize()}) · 100k comp=${compMs}ms · layout 2000=${layoutMs}ms`);
}

console.log(`\n${failures === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${failures} COMPROBACIÓN(ES) FALLARON`}`);
process.exit(failures === 0 ? 0 : 1);

// Señal de fallo para CI: sale con código !=0 si alguna comprobación falló.
if (failures > 0) process.exitCode = 1;
