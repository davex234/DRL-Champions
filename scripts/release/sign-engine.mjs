/**
 * SIGN ENGINE — toda la FIRMA e integridad aislada aquí.
 *
 * El bundle lo firma Tauri (minisign/ed25519) durante `tauri build` produciendo ficheros
 * `.sig` junto a cada artefacto; este engine los LOCALIZA y los expone, calcula SHA256 e
 * informa de si la firma está disponible. Preparado para verificaciones futuras (minisign).
 * No reimplementa criptografía propia: reutiliza el sistema oficial de Tauri.
 */
import { basename } from "node:path";
import { walk, exists, readText, fileSize } from "./core/fsx.mjs";
import { sha256Hex, sha256File } from "./core/hash.mjs";

export { sha256Hex, sha256File };

/** ¿Hay clave de firma disponible en el entorno? (para builds firmados reales). */
export const signingAvailable = () =>
  !!(process.env.TAURI_SIGNING_PRIVATE_KEY || process.env.TAURI_SIGNING_PRIVATE_KEY_PATH);

/** Localiza las firmas `.sig` bajo un directorio y las empareja con su artefacto. */
export function collectSignatures(bundleDir) {
  if (!exists(bundleDir)) return [];
  const out = [];
  for (const sig of walk(bundleDir).filter((p) => p.toLowerCase().endsWith(".sig"))) {
    const artifact = sig.slice(0, -4);
    if (!exists(artifact)) continue;
    out.push({
      name: basename(artifact),
      artifact,
      signature: readText(sig).trim(),
      size: fileSize(artifact),
      sha256: sha256File(artifact),
    });
  }
  return out;
}

/**
 * Verificación de firma. En Fase 1 la realiza el runtime de Tauri al instalar (minisign
 * contra el `pubkey` de tauri.conf.json). Aquí se documenta el punto de extensión futuro.
 */
export function verify(signed) {
  return { verifiedBy: "tauri-runtime", hasSignature: !!signed?.signature, sha256: signed?.sha256 ?? null };
}

export const SignEngine = { signingAvailable, collectSignatures, verify, sha256Hex, sha256File };
export default SignEngine;
