/**
 * PUBLISH ENGINE — ensambla un objeto `Release` listo para publicar MÁS ADELANTE.
 *
 * En Fase 1 NO publica ni sube nada a ningún servidor: solo produce un descriptor `Release`
 * (determinista, serializable) y, opcionalmente, lo deja "staged" en disco junto a un
 * `release.json`. El transporte (servidor/CDN/CI) llegará en fases posteriores y consumirá
 * este mismo objeto — totalmente desacoplado del destino.
 */
import { join, basename } from "node:path";
import { copyFileSync } from "node:fs";
import { ensureDir, writeJson } from "./core/fsx.mjs";

/**
 * Construye el descriptor `Release` (en memoria). No toca disco.
 * @returns {{ id, version, build, full, channel, date, commit, hash, notes,
 *             baseUrl, installers, signatures, manifests, ready }}
 */
export function assembleRelease({
  version, build, channel, date, commit = null, hash = null, notes = "",
  baseUrl, installers = [], signatures = [], manifests = {},
}) {
  const full = `${version}+${build}`;
  const sigByName = new Map(signatures.map((s) => [s.name, s]));
  const files = installers.map((a) => {
    const s = sigByName.get(a.name);
    return { name: a.name, size: a.size, sha256: s?.sha256 ?? null, signed: !!s, kind: "installer" };
  });
  const signed = files.length > 0 && files.every((f) => f.signed);
  return {
    id: `${channel}-${full}`,
    version, build, full, channel, date, commit, hash, notes, baseUrl,
    files,
    manifests: { hasLatest: !!manifests.latest, hasMeta: !!manifests.meta, hasFiles: !!manifests.files },
    signed,
    // "ready" = listo para que un Publish transport (fase futura) lo suba.
    ready: !!manifests.files && !!manifests.meta,
  };
}

/**
 * Deja la release "staged" en disco (NO es publicar en servidor): copia instaladores al
 * destino del canal y escribe `release.json` con el descriptor. Devuelve rutas.
 */
export function stage(release, destDir, { installers = [] } = {}) {
  ensureDir(destDir);
  for (const a of installers) {
    try { copyFileSync(a.path, join(destDir, basename(a.path))); } catch { /* ya presente o sin bundle */ }
  }
  const descriptorPath = join(destDir, "release.json");
  writeJson(descriptorPath, release);
  return { destDir, descriptor: descriptorPath };
}

export const PublishEngine = { assembleRelease, stage };
export default PublishEngine;
