/**
 * BUILD ENGINE — única responsabilidad: COMPILAR. Web, Desktop (export), Tauri (bundle), Assets.
 * No sabe de versiones, firmas ni manifiestos. Devuelve resultados estructurados.
 */
import { run } from "./core/proc.mjs";

/** Compila la web (Next SSR/estático estándar). */
export const buildWeb = () => ({ step: "web", ...run("npm run build") });

/** Export estático para escritorio (out/) — comparte código con la web. */
export const buildDesktopExport = () => ({ step: "desktop-export", ...run("npm run build:desktop") });

/** Bundle nativo firmado de Tauri (requiere TAURI_SIGNING_PRIVATE_KEY en el entorno). */
export const buildTauriBundle = (targets = "nsis,msi") => ({ step: "tauri-bundle", ...run(`npx tauri build --bundles ${targets}`) });

/** Regenera los assets de marca (icons/SVG/PNG) desde el branding. */
export const buildAssets = () => ({ step: "assets", ...run("npm run brand") });

/**
 * Compila lo necesario para una release.
 * @param {{web?:boolean, desktop?:boolean, bundle?:boolean, assets?:boolean, targets?:string}} o
 */
export function buildAll({ web = true, desktop = true, bundle = true, assets = false, targets = "nsis,msi" } = {}) {
  const results = [];
  if (assets) results.push(buildAssets());
  if (web) results.push(buildWeb());
  if (desktop) results.push(buildDesktopExport());
  if (bundle) results.push(buildTauriBundle(targets));
  return { ok: true, results, totalMs: results.reduce((a, r) => a + (r.ms ?? 0), 0) };
}

export const BuildEngine = { buildWeb, buildDesktopExport, buildTauriBundle, buildAssets, buildAll };
export default BuildEngine;
