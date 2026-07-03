/**
 * REPLAY EXPORT / SHARE CODE / COMPRESSION (Online Fase 5/7).
 *
 * Exporta/importa un replay con un hook de COMPRESIÓN inyectable (identidad por defecto, listo
 * para gzip/delta binaria). El share code es un identificador corto DETERMINISTA (checksum). Al
 * importar, VERIFICA integridad y versión (replay inválido detectado). PURO.
 */
import type { Replay } from "./types";
import { verifyReplay, checksumReplay } from "./engine";

export interface ReplayCompressor { compress(s: string): string; decompress(s: string): string }
export const identityCompressor: ReplayCompressor = { compress: (s) => s, decompress: (s) => s };

/** Serializa un replay (con compresión inyectable). */
export function encodeReplay(replay: Replay, comp: ReplayCompressor = identityCompressor): string {
  return comp.compress(JSON.stringify(replay));
}

/** Deserializa + VERIFICA (checksum/versión). null si es inválido. */
export function decodeReplay(raw: string, comp: ReplayCompressor = identityCompressor): Replay | null {
  try {
    const r = JSON.parse(comp.decompress(raw)) as Replay;
    return verifyReplay(r).ok ? r : null;
  } catch { return null; }
}

/** Código corto para compartir/buscar un replay (determinista). */
export function shareCode(replay: Replay): string {
  const cs = checksumReplay(replay.config, replay.log);
  return `DRL-${replay.version}-${cs.toString(36).toUpperCase()}`;
}
