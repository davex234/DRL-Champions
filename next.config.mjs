/** @type {import('next').NextConfig} */
import { readFileSync } from "node:fs";

// Build de ESCRITORIO (Tauri): export estático a `out/` para servirlo en el WebView.
// Se activa SOLO con NEXT_DESKTOP=1 → el build web por defecto queda intacto.
// Nota: en modo desktop las 5 API routes server-only (admin/esports/market) NO forman
// parte del juego (requieren Supabase) y deben excluirse del bundle estático.
const desktop = process.env.NEXT_DESKTOP === "1";

// Build ID REPRODUCIBLE derivado de la versión (fuente única `version.json`). Hace que dos
// compilaciones de la misma versión produzcan `out/` byte-idéntico → artefactos del Build
// Cloud reproducibles (sin el build-id aleatorio por defecto de Next). Fallback al default.
function deterministicBuildId() {
  try {
    const v = JSON.parse(readFileSync(new URL("./version.json", import.meta.url)));
    return `drl-${v.version}-${v.build}`;
  } catch {
    return null; // → Next usa su id por defecto
  }
}

const nextConfig = {
  reactStrictMode: true,
  generateBuildId: deterministicBuildId,
  ...(desktop
    ? { output: "export", images: { unoptimized: true }, trailingSlash: true }
    : {}),
};

export default nextConfig;
