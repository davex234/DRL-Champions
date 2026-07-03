/**
 * TRANSPORT ENGINE — decide CÓMO mover una Release a un destino, sobre un Provider cualquiera.
 * El Release Pipeline NO conoce el servidor: solo entrega bytes; este motor los transporta.
 *
 *   upload() → verify() → health() → rollback() → cleanup()
 *
 * Convención de claves (aislamiento por canal + anillo de rollback):
 *   <canal>/<archivo>                       ← versión vigente (lo que leen los launchers)
 *   <canal>/releases/<version+build>/<arch>  ← copia archivada de cada release (rollback)
 *   <canal>/releases/history.json            ← anillo ordenado (newest first) + puntero vigente
 */
import { sha256Hex } from "../core/hash.mjs";

export const channelKey = (channel, name) => `${channel}/${name}`;
export const archiveKey = (channel, full, name) => `${channel}/releases/${full}/${name}`;
export const historyKey = (channel) => `${channel}/releases/history.json`;

/** Comprobación de destino accesible (delegada al provider). */
export async function health(provider) {
  return provider.health();
}

/**
 * Sube una lista de ficheros. `files`: [{ key, path?, bytes? }]. Devuelve por cada uno
 * { key, size, sha256, url, ms }. No verifica: eso es verify().
 */
export async function upload(provider, files, { now = () => Date.now() } = {}) {
  const out = [];
  for (const f of files) {
    const t0 = now();
    const r = await provider.put(f);
    out.push({ ...r, ms: now() - t0 });
  }
  return out;
}

/**
 * Verifica que lo subido está realmente accesible y es BYTE-IDÉNTICO a lo esperado.
 * `expected`: [{ key, sha256, size }]. Re-descarga del provider y compara hash + tamaño.
 */
export async function verify(provider, expected) {
  const mismatches = [], missing = [];
  let checked = 0;
  for (const e of expected) {
    const bytes = await provider.getBytes(e.key);
    if (!bytes) { missing.push(e.key); continue; }
    checked++;
    const sha = sha256Hex(bytes);
    if (sha !== e.sha256 || (e.size != null && bytes.length !== e.size)) mismatches.push(e.key);
  }
  return { ok: missing.length === 0 && mismatches.length === 0, checked, mismatches, missing };
}

/** Lee el anillo de historial del canal (o uno vacío). */
export async function readHistory(provider, channel) {
  const buf = await provider.getBytes(historyKey(channel));
  if (!buf) return { channel, current: null, releases: [] };
  try { return JSON.parse(buf.toString("utf8")); } catch { return { channel, current: null, releases: [] }; }
}

/** Escribe el anillo de historial del canal. */
export async function writeHistory(provider, channel, history) {
  const bytes = Buffer.from(JSON.stringify(history, null, 2) + "\n");
  await provider.put({ key: historyKey(channel), bytes });
}

/**
 * Archiva el set de una release bajo releases/<full>/ y actualiza el anillo (newest first).
 * `entries`: lista de { name, sha256, size } ya subidos a la raíz del canal.
 */
export async function archive(provider, channel, full, entries, meta = {}) {
  for (const e of entries) {
    await provider.copy(channelKey(channel, e.name), archiveKey(channel, full, e.name));
  }
  const history = await readHistory(provider, channel);
  history.channel = channel;
  history.current = full;
  history.releases = [
    { full, files: entries.map((e) => ({ name: e.name, sha256: e.sha256, size: e.size })), ...meta },
    ...history.releases.filter((r) => r.full !== full),
  ];
  await writeHistory(provider, channel, history);
  return history;
}

/**
 * ROLLBACK — vuelve a una release anterior del anillo restaurando su copia archivada a la raíz
 * del canal (lo que leen los launchers). Arquitectura preparada; sin UI en esta fase.
 */
export async function rollback(provider, channel, toFull) {
  const history = await readHistory(provider, channel);
  const target = history.releases.find((r) => r.full === toFull);
  if (!target) return { ok: false, reason: `release ${toFull} no está en el anillo` };
  for (const f of target.files) {
    const ok = await provider.copy(archiveKey(channel, toFull, f.name), channelKey(channel, f.name));
    if (!ok) return { ok: false, reason: `falta archivo archivado: ${f.name}` };
  }
  history.current = toFull;
  await writeHistory(provider, channel, history);
  return { ok: true, current: toFull, restored: target.files.length };
}

/** Releases disponibles para rollback (las archivadas, vigente excluida). */
export async function rollbackTargets(provider, channel) {
  const history = await readHistory(provider, channel);
  return history.releases.filter((r) => r.full !== history.current).map((r) => r.full);
}

/**
 * CLEANUP — mantiene el anillo en `keep` entradas (p.ej. N, N-1, N-2): poda los archivos
 * archivados de releases más antiguas y recorta el historial.
 */
export async function cleanup(provider, channel, keep = 3) {
  const history = await readHistory(provider, channel);
  const survivors = history.releases.slice(0, keep);
  const pruned = history.releases.slice(keep);
  for (const r of pruned) {
    for (const f of r.files) await provider.remove(archiveKey(channel, r.full, f.name));
  }
  history.releases = survivors;
  await writeHistory(provider, channel, history);
  return { kept: survivors.map((r) => r.full), pruned: pruned.map((r) => r.full) };
}

export const TransportEngine = {
  channelKey, archiveKey, historyKey,
  health, upload, verify, readHistory, writeHistory, archive, rollback, rollbackTargets, cleanup,
};
export default TransportEngine;
