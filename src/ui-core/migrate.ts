/**
 * MIGRACIÓN DE CONFIG VISUAL (Render/UI Fase 1/7).
 *
 * Normaliza una config de tema antigua/corrupta al esquema actual sin romper: valores fuera de rango se
 * acotan, campos inválidos vuelven a su default. SOLO configuración visual. Determinista.
 */
import { isHex } from "./color";
import { DENSITY, type Density } from "./tokens";
import { defaultThemeConfig } from "./theme";
import { UI_SCHEMA_VERSION, type ThemeConfig, type ThemeMode } from "./types";

const MODES: ThemeMode[] = ["dark", "light", "auto"];

export function migrateThemeConfig(raw: unknown): ThemeConfig {
  const d = defaultThemeConfig();
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Partial<ThemeConfig>;
  return {
    version: UI_SCHEMA_VERSION,
    mode: MODES.includes(r.mode as ThemeMode) ? (r.mode as ThemeMode) : d.mode,
    systemPrefersDark: typeof r.systemPrefersDark === "boolean" ? r.systemPrefersDark : undefined,
    accent: typeof r.accent === "string" && isHex(r.accent) ? r.accent : d.accent,
    density: (r.density as Density) in DENSITY ? (r.density as Density) : d.density,
    highContrast: !!r.highContrast,
    reducedMotion: !!r.reducedMotion,
    transparency: typeof r.transparency === "number" && Number.isFinite(r.transparency) ? Math.max(0, Math.min(1, r.transparency)) : d.transparency,
    blur: typeof r.blur === "number" && Number.isFinite(r.blur) && r.blur >= 0 ? r.blur : d.blur,
    customVars: r.customVars && typeof r.customVars === "object" ? sanitizeVars(r.customVars) : undefined,
  };
}

function sanitizeVars(v: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v)) if (typeof val === "string" && k.startsWith("--")) out[k] = val;
  return out;
}
