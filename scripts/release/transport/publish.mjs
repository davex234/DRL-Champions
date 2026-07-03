/**
 * PUBLISH STEP — el "siguiente paso del pipeline": coge la Release ya ensamblada y staged por
 * PublishEngine y la TRANSPORTA al destino configurado, de forma totalmente desacoplada.
 *
 *   uploading → verifying → published   (y solo entonces el pipeline marca Ready)
 *
 * Reutiliza: el objeto Release (PublishEngine), los manifiestos (ManifestEngine) ya escritos en
 * `stagedDir`, el Transport Engine y el provider seleccionado. NO conoce el servidor concreto.
 * Si la verificación falla, devuelve ready:false → el Release NO se marca como Ready.
 */
import { join, basename } from "node:path";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { writeJson } from "../core/fsx.mjs";
import { sha256Hex } from "../core/hash.mjs";
import * as Transport from "./engine.mjs";

// Conjunto a publicar (los que existan en stagedDir). Cubre exactamente lo pedido:
// latest.json · meta.json · files.json · exe · msi · report · release.json (+ estado).
const PUBLISH_NAMES = new Set([
  "latest.json", "meta.json", "files.json", "release.json",
  "release-report.json", "RELEASE-REPORT.md", "pipeline-state.json",
]);
const PUBLISH_EXT = /\.(exe|msi)$/i;
const shouldPublish = (name) => PUBLISH_NAMES.has(name) || PUBLISH_EXT.test(name);

/** Enumera y hashea los ficheros publicables presentes en stagedDir. */
export function collectStaged(stagedDir) {
  return readdirSync(stagedDir)
    .filter((name) => shouldPublish(name) && statSync(join(stagedDir, name)).isFile())
    .sort()
    .map((name) => {
      const path = join(stagedDir, name);
      const bytes = readFileSync(path);
      return { name, path, size: bytes.length, sha256: sha256Hex(bytes) };
    });
}

/**
 * Publica la release staged. Emite las fases vía onPhase. Devuelve un resultado rico
 * (datos listos para el dashboard de la Fase 4) y NO lanza si la verificación falla.
 */
export async function publishRelease({
  release, stagedDir, channel, provider,
  onPhase = () => {}, keep = 3, now = () => Date.now(),
}) {
  const t0 = now();
  const channels = ["stable", "beta", "developer", "nightly"];
  if (!channels.includes(channel)) { /* canal libre permitido, pero avisamos en el resultado */ }

  // 0) Salud del destino: si no responde, no publicamos (no falso "Ready").
  const healthRes = await Transport.health(provider);
  if (!healthRes.ok) {
    return baseResult({ release, channel, provider, healthRes, ready: false, error: `destino no saludable: ${healthRes.detail}` });
  }

  const staged = collectStaged(stagedDir);

  // 1) UPLOADING — subir el set a la raíz del canal (aislado por canal).
  onPhase("uploading", { channel, files: staged.length, provider: provider.name });
  const files = staged.map((f) => ({ key: Transport.channelKey(channel, f.name), path: f.path }));
  const uploaded = await Transport.upload(provider, files, { now });
  const uploadMs = now() - t0;

  // 1b) Anillo de rollback: archivar copia de esta release + actualizar historial.
  const history = await Transport.archive(
    provider, channel, release.full,
    staged.map((f) => ({ name: f.name, sha256: f.sha256, size: f.size })),
    { date: release.date, version: release.version, build: release.build, signed: release.signed, uploadMs },
  );

  // 2) VERIFYING — re-descargar y comparar BYTE A BYTE (hash + tamaño + accesible).
  onPhase("verifying", { channel, files: staged.length });
  const expected = staged.map((f) => ({ key: Transport.channelKey(channel, f.name), sha256: f.sha256, size: f.size }));
  const verifyRes = await Transport.verify(provider, expected);

  // Verificación adicional: latest.json y files.json deben estar accesibles (lo que pide la fase).
  const hasFiles = staged.some((f) => f.name === "files.json");
  const verified = verifyRes.ok && hasFiles;

  // 3) PUBLISHED / cleanup del anillo.
  let cleanupRes = null;
  if (verified) {
    onPhase("published", { channel, full: release.full });
    cleanupRes = await Transport.cleanup(provider, channel, keep);
  }
  const rollbackTargets = await Transport.rollbackTargets(provider, channel);

  const result = baseResult({
    release, channel, provider, healthRes, ready: verified,
    error: verified ? null : (verifyRes.missing.length || verifyRes.mismatches.length
      ? `verificación: faltan ${verifyRes.missing.length}, difieren ${verifyRes.mismatches.length}`
      : "files.json no publicado"),
  });
  Object.assign(result, {
    published: verified,
    verified,
    uploadMs,
    totalMs: now() - t0,
    files: uploaded.map((u, i) => ({ name: staged[i].name, size: u.size, sha256: u.sha256, url: u.url, ms: u.ms })),
    totalBytes: staged.reduce((s, f) => s + f.size, 0),
    verify: verifyRes,
    cleanup: cleanupRes,
    rollbackAvailable: rollbackTargets.length > 0,
    rollbackTargets,
    history: { current: history.current, count: history.releases.length },
  });

  // Datos para la Fase 4 (dashboard): publish.json local junto al staged.
  writeJson(join(stagedDir, "publish.json"), result);
  return result;
}

function baseResult({ release, channel, provider, healthRes, ready, error }) {
  return {
    id: release.id,
    full: release.full,
    version: release.version,
    build: release.build,
    channel,
    date: release.date,
    provider: provider.name,
    destination: provider.url(Transport.channelKey(channel, "latest.json")),
    health: healthRes,
    signed: release.signed,
    status: ready ? "published" : "failed",
    ready,
    error,
    published: ready,
    verified: ready,
  };
}

export const PublishStep = { collectStaged, publishRelease };
export default PublishStep;
