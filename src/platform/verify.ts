/**
 * PLATFORM — VERIFICACIÓN E INTEGRIDAD de archivos (estilo "Reparar" de Battle.net).
 *
 * Complementa al updater oficial de Tauri (que reemplaza el bundle firmado completo): aquí
 * se valida la INTEGRIDAD de los recursos del juego instalados (assets/datos) contra un
 * manifiesto `files.json` con SHA256 por archivo. Si algo falta o está corrupto, "reparar"
 * = re-ejecutar el updater oficial para reinstalar la versión actual (Tauri no permite
 * descarga delta por-archivo; esta es la vía honesta y la documentamos como tal).
 *
 * El lector de archivos y el digest son INYECTABLES para poder testar la lógica de diff de
 * forma determinista; en producción se enchufa Tauri fs + Web Crypto.
 */
import { isTauri, tauri } from "./env";
import { info as logInfo, warn as logWarn, error as logError } from "./log";

export interface FileEntry {
  path: string; // relativo a la raíz de recursos
  sha256: string; // hex minúscula
  size: number; // bytes
}

export interface FileManifest {
  version: string;
  channel?: string;
  generatedAt?: string;
  files: FileEntry[];
}

export interface VerifyReport {
  ok: boolean;
  checked: number;
  missing: string[];
  corrupt: string[];
  okFiles: string[];
  durationMs: number;
}

/** Lector inyectable: devuelve los bytes de un recurso o null si no existe. */
export type FileReader = (path: string) => Promise<Uint8Array | null>;
/** Digest inyectable: SHA256 hex de unos bytes. */
export type Digest = (bytes: Uint8Array) => Promise<string>;

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

/** SHA256 hex usando Web Crypto (disponible en navegador, Tauri WebView y Node 20+). */
export const sha256Hex: Digest = async (bytes) => {
  const subtle = (globalThis.crypto && globalThis.crypto.subtle) || null;
  if (!subtle) throw new Error("Web Crypto no disponible para SHA256");
  // copia a ArrayBuffer limpio (evita problemas con SharedArrayBuffer/offset)
  const buf = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? (bytes.buffer as ArrayBuffer)
    : bytes.slice().buffer;
  const digest = await subtle.digest("SHA-256", buf);
  const view = new Uint8Array(digest);
  let out = "";
  for (let i = 0; i < view.length; i++) out += HEX[view[i]];
  return out;
};

/** Lector de producción: Tauri fs (AppData) — null si no hay Tauri o no existe. */
export function tauriReader(): FileReader {
  return async (path: string) => {
    const t = tauri();
    if (!t?.fs?.readFile) return null;
    try {
      const data: Uint8Array = await t.fs.readFile(path, { baseDir: t.fs.BaseDirectory?.AppData });
      return data;
    } catch {
      return null;
    }
  };
}

/**
 * Verifica un manifiesto: lee cada archivo, calcula SHA256 y compara. PURO respecto a sus
 * dependencias inyectadas (reader/digest) → testeable sin sistema de ficheros.
 */
export async function verifyManifest(
  manifest: FileManifest,
  reader: FileReader,
  digest: Digest = sha256Hex,
  now: () => number = () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
): Promise<VerifyReport> {
  const t0 = now();
  const missing: string[] = [];
  const corrupt: string[] = [];
  const okFiles: string[] = [];
  for (const f of manifest.files) {
    const bytes = await reader(f.path);
    if (!bytes) {
      missing.push(f.path);
      continue;
    }
    if (typeof f.size === "number" && f.size >= 0 && bytes.length !== f.size) {
      corrupt.push(f.path);
      continue;
    }
    const hex = await digest(bytes);
    if (hex.toLowerCase() !== f.sha256.toLowerCase()) corrupt.push(f.path);
    else okFiles.push(f.path);
  }
  return {
    ok: missing.length === 0 && corrupt.length === 0,
    checked: manifest.files.length,
    missing,
    corrupt,
    okFiles,
    durationMs: Math.round(now() - t0),
  };
}

/** Descarga el manifiesto de integridad publicado para una versión/canal. */
export async function fetchFileManifest(baseUrl: string, channel: string): Promise<FileManifest | null> {
  try {
    const url = `${baseUrl.replace(/\/$/, "")}/${channel}/files.json`;
    const res = await fetch(url, { headers: { "X-DRL-Channel": channel } });
    if (!res.ok) return null;
    return (await res.json()) as FileManifest;
  } catch (e) {
    logWarn("verify", `No se pudo obtener files.json: ${(e as Error).message}`);
    return null;
  }
}

/**
 * Verifica la instalación actual contra el manifiesto remoto. Fuera de Tauri devuelve un
 * informe vacío "ok" (no aplica). En Tauri usa el lector real.
 */
export async function verifyInstallation(baseUrl: string, channel: string): Promise<VerifyReport> {
  if (!isTauri()) {
    return { ok: true, checked: 0, missing: [], corrupt: [], okFiles: [], durationMs: 0 };
  }
  const manifest = await fetchFileManifest(baseUrl, channel);
  if (!manifest) {
    logWarn("verify", "Sin manifiesto remoto; no se puede verificar integridad.");
    return { ok: true, checked: 0, missing: [], corrupt: [], okFiles: [], durationMs: 0 };
  }
  const report = await verifyManifest(manifest, tauriReader());
  if (report.ok) logInfo("verify", `Integridad OK (${report.checked} archivos, ${report.durationMs} ms)`);
  else logError("verify", `Integridad FALLA: ${report.missing.length} faltan, ${report.corrupt.length} corruptos`);
  return report;
}
