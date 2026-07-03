/**
 * ROLLBACK ENGINE (Fase 5/7) — punto de entrada ÚNICO para volver a una versión anterior, igual
 * que Steam/Riot/Epic. NO duplica lógica: orquesta los engines que ya existen.
 *
 *   validate → select → provider → restore → verify → publish → ready
 *
 * Reutiliza EXACTAMENTE:
 *   - Transport Engine: rollback() (restaura el set archivado), verify() (byte-idéntico),
 *     readHistory()/writeHistory() (anillo), health(), rollbackTargets(), channelKey/archiveKey.
 *   - pipeline-state.mjs: createPipelineState() (la misma máquina de estados del dashboard).
 *   - core/hash, core/fsx.
 *
 * Los manifiestos (latest/meta/files/release.json) los restaura Transport Engine.rollback() desde
 * la copia archivada — aquí NO se regeneran. Solo se producen los descriptores que el dashboard
 * lee (publish.json + pipeline-state.json + el log del anillo) reutilizando las mismas formas.
 *
 * SEGURIDAD: cancela COMPLETAMENTE (y revierte) ante versión inexistente / sin firma / hashes
 * incorrectos / archivo corrupto / otro canal / verify fallido / restauración parcial.
 */
import { join } from "node:path";
import { writeFileSync, rmSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { writeJson } from "../core/fsx.mjs";
import * as Transport from "./engine.mjs";
import { createPipelineState } from "../pipeline-state.mjs";

const PUBLISHABLE = /\.(exe|msi)$/i;
const MANIFEST_NAMES = new Set(["latest.json", "meta.json", "files.json", "release.json"]);
const STATE_NAMES = new Set(["publish.json", "pipeline-state.json", "rollback.json"]);

/** Valida que un rollback al destino es SEGURO. Pura (recibe el history ya leído). */
export function validateRollback({ history, channel, toFull, allowUnsigned = false }) {
  if (!history || !Array.isArray(history.releases)) return { ok: false, code: "NO_HISTORY", reason: `sin historial para el canal ${channel}` };
  const target = history.releases.find((r) => r.full === toFull);
  if (!target) return { ok: false, code: "NOT_FOUND", reason: `la versión ${toFull} no existe en el anillo del canal ${channel}` };
  if (history.current === toFull) return { ok: false, code: "ALREADY_CURRENT", reason: `${toFull} ya es la versión vigente` };
  if (!Array.isArray(target.files) || target.files.length === 0) return { ok: false, code: "EMPTY", reason: "release destino sin archivos (corrupta)" };
  if (target.files.some((f) => !f.sha256)) return { ok: false, code: "NO_HASH", reason: "hashes incompletos en el destino (posible corrupción)" };
  if (!target.files.some((f) => MANIFEST_NAMES.has(f.name))) return { ok: false, code: "NO_MANIFEST", reason: "el destino no contiene manifiestos" };
  if (!allowUnsigned && target.signed !== true) return { ok: false, code: "UNSIGNED", reason: "la versión destino no está firmada (rollback sin firma no permitido)" };
  return { ok: true, target };
}

/** PLAN — comparación actual vs destino (Paso 3). Solo lee, no toca nada. */
export async function planRollback({ provider, channel, toFull }) {
  const history = await Transport.readHistory(provider, channel);
  const current = history.releases.find((r) => r.full === history.current) ?? null;
  const target = history.releases.find((r) => r.full === toFull) ?? null;
  const v = validateRollback({ history, channel, toFull });
  const curFiles = new Map((current?.files ?? []).map((f) => [f.name, f]));
  const tgtFiles = new Map((target?.files ?? []).map((f) => [f.name, f]));
  const changed = [], added = [], removed = [];
  for (const [name, f] of tgtFiles) {
    if (!curFiles.has(name)) added.push(name);
    else if (curFiles.get(name).sha256 !== f.sha256) changed.push(name);
  }
  for (const name of curFiles.keys()) if (!tgtFiles.has(name)) removed.push(name);
  return {
    channel,
    valid: v.ok, code: v.ok ? "OK" : v.code, reason: v.ok ? null : v.reason,
    current: current ? summary(current, channel, provider) : null,
    target: target ? summary(target, channel, provider) : null,
    diff: { changed, added, removed, affected: [...new Set([...changed, ...added, ...removed])] },
    availableTargets: history.releases.filter((r) => r.full !== history.current).map((r) => summary(r, channel, provider)),
  };
}

function summary(rel, channel, provider) {
  return {
    full: rel.full, version: rel.full.split("+")[0], build: rel.full.includes("+") ? Number(rel.full.split("+")[1]) : null,
    date: rel.date ?? null, signed: rel.signed === true, channel,
    files: (rel.files ?? []).map((f) => ({ name: f.name, sha256: f.sha256, size: f.size })),
    totalBytes: (rel.files ?? []).reduce((s, f) => s + (f.size ?? 0), 0),
    destination: provider.url(Transport.channelKey(channel, "latest.json")),
  };
}

/**
 * ROLLBACK REAL. Devuelve un resultado rico (publish.json-compatible + metadatos de rollback) y
 * NUNCA lanza por un fallo de validación/verificación: cancela y revierte, devolviendo ok:false.
 */
export async function rollbackRelease({
  provider, channel, toFull, reason = "", user = "system", stagedDir = null,
  onPhase = () => {}, now = () => Date.now(), date = new Date().toISOString(),
  allowUnsigned = false, keep = 3,
}) {
  const t0 = now();
  const state = createPipelineState({ now });
  const phases = [];
  const phase = (key, label) => { state.transition(key); phases.push({ phase: key, label, elapsedMs: now() - t0 }); onPhase(key, { label }); };

  const finish = async (ok, code, error, extra = {}) => {
    if (!ok) state.fail(error); else if (state.current !== "ready") state.transition("ready");
    const result = buildResult({ provider, channel, toFull, user, reason, date, ok, code, error, durationMs: now() - t0, phases, state, ...extra });
    await logEvent(provider, channel, result);
    await writePublishedState(provider, channel, result, state);
    if (stagedDir) await mirrorToStaged(provider, channel, stagedDir, result, state, ok);
    return result;
  };

  // 0) Provider health.
  const health = await Transport.health(provider);
  if (!health.ok) return finish(false, "PROVIDER", `destino no saludable: ${health.detail}`, { from: null, health });

  // 1) Leer history + validar (seguridad).
  const history = await Transport.readHistory(provider, channel);
  const previousCurrent = history.current;
  const v = validateRollback({ history, channel, toFull, allowUnsigned });
  if (!v.ok) return finish(false, v.code, v.reason, { from: previousCurrent, health });
  const target = v.target;

  // 2) Pre-verificar la COPIA ARCHIVADA (no restaurar corrupción).
  const archiveExpected = target.files.map((f) => ({ key: Transport.archiveKey(channel, toFull, f.name), sha256: f.sha256, size: f.size }));
  const preVerify = await Transport.verify(provider, archiveExpected);
  if (!preVerify.ok) return finish(false, "CORRUPT_ARCHIVE", `copia archivada corrupta/ausente (faltan ${preVerify.missing.length}, difieren ${preVerify.mismatches.length})`, { from: previousCurrent, health, verify: preVerify });

  // 3) RESTORE — TransportEngine.rollback() (reutilizado, sin otra lógica).
  phase("running", "Rolling back");
  phase("uploading", "Rolling back");
  const rb = await Transport.rollback(provider, channel, toFull);
  if (!rb.ok) {
    if (previousCurrent && previousCurrent !== toFull) await Transport.rollback(provider, channel, previousCurrent);
    return finish(false, "RESTORE", `restauración fallida: ${rb.reason}`, { from: previousCurrent, health, reverted: true });
  }

  // 4) VERIFY — raíz del canal byte-idéntica + firma + accesible (Paso 6).
  phase("verifying", "Verifying");
  const rootExpected = target.files.map((f) => ({ key: Transport.channelKey(channel, f.name), sha256: f.sha256, size: f.size }));
  const verify = await Transport.verify(provider, rootExpected);
  const signedOk = allowUnsigned || target.signed === true;
  const manifestsOk = target.files.some((f) => f.name === "latest.json" || f.name === "files.json");
  if (!verify.ok || !signedOk || !manifestsOk) {
    // Cancelar COMPLETAMENTE: revertir a la versión previa.
    if (previousCurrent && previousCurrent !== toFull) await Transport.rollback(provider, channel, previousCurrent);
    return finish(false, "VERIFY", `verificación post-restore falló (faltan ${verify.missing.length}, difieren ${verify.mismatches.length}${signedOk ? "" : ", sin firma"})`, { from: previousCurrent, health, verify, reverted: !!previousCurrent });
  }

  // 5) PUBLISH/READY — manifiestos ya restaurados; aquí solo descriptores del dashboard.
  phase("published", "Publishing");
  const rollbackTargets = await Transport.rollbackTargets(provider, channel);
  phase("ready", "Ready");
  return finish(true, "OK", null, { from: previousCurrent, health, verify, target, rollbackTargets, restored: rb.restored });
}

/** Construye el descriptor (publish.json-compatible + rollback). */
function buildResult({ provider, channel, toFull, user, reason, date, ok, code, error, durationMs, phases, state, from = null, health = null, verify = null, target = null, rollbackTargets = [], restored = 0, reverted = false }) {
  const [version, buildStr] = String(toFull).split("+");
  const files = (target?.files ?? []).map((f) => ({ name: f.name, size: f.size, sha256: f.sha256, url: provider.url(Transport.channelKey(channel, f.name)) }));
  return {
    kind: "rollback",
    id: `${channel}-${toFull}`,
    full: toFull, version, build: buildStr != null ? Number(buildStr) : null,
    channel, date,
    provider: provider.name,
    destination: provider.url(Transport.channelKey(channel, "latest.json")),
    health,
    signed: target?.signed === true,
    status: ok ? "published" : "failed",
    ok, ready: ok, error, code,
    published: ok, verified: ok,
    // metadatos de rollback
    rolledBackFrom: from, user, reason, durationMs, reverted,
    uploadMs: durationMs,
    totalBytes: files.reduce((s, f) => s + (f.size ?? 0), 0),
    files,
    verify,
    rollbackAvailable: rollbackTargets.length > 0,
    rollbackTargets,
    restored,
    phases,
    pipeline: state.snapshot(),
  };
}

/** Registra el evento en history.events (log profesional, append-only). Reutiliza writeHistory. */
async function logEvent(provider, channel, result) {
  const history = await Transport.readHistory(provider, channel);
  const event = {
    type: "rollback", at: result.date, from: result.rolledBackFrom, to: result.full, channel,
    provider: result.provider, user: result.user, reason: result.reason || null,
    durationMs: result.durationMs, result: result.ok ? "ok" : "failed", code: result.code,
    files: result.files?.length ?? 0, signed: result.signed, error: result.error, reverted: !!result.reverted,
    verify: result.verify ?? null,
  };
  history.events = [event, ...(Array.isArray(history.events) ? history.events : [])].slice(0, 200);
  await Transport.writeHistory(provider, channel, history);
}

/** Escribe publish.json + pipeline-state.json + rollback.json en la raíz del canal del provider. */
async function writePublishedState(provider, channel, result, state) {
  const put = (name, obj) => provider.put({ key: Transport.channelKey(channel, name), bytes: Buffer.from(JSON.stringify(obj, null, 2) + "\n") });
  await put("publish.json", result);
  await put("pipeline-state.json", state.snapshot());
  await put("rollback.json", result);
}

/** Refleja la release vigente en stagedDir (dist/update/<canal>) para que el dashboard la vea. */
async function mirrorToStaged(provider, channel, stagedDir, result, state, ok) {
  mkdirSync(stagedDir, { recursive: true });
  // Limpia el set publicable previo (evita instaladores obsoletos de otra versión).
  for (const f of safeList(stagedDir)) {
    if (PUBLISHABLE.test(f) || MANIFEST_NAMES.has(f) || STATE_NAMES.has(f)) rmSync(join(stagedDir, f), { force: true });
  }
  if (ok) {
    for (const f of result.files) {
      const bytes = await provider.getBytes(Transport.channelKey(channel, f.name));
      if (bytes) writeFileSync(join(stagedDir, f.name), bytes);
    }
  }
  writeJson(join(stagedDir, "publish.json"), result);
  writeJson(join(stagedDir, "pipeline-state.json"), state.snapshot());
  writeJson(join(stagedDir, "rollback.json"), result);
}

function safeList(dir) {
  try { return existsSync(dir) ? readdirSync(dir) : []; } catch { return []; }
}

export const RollbackEngine = { validateRollback, planRollback, rollbackRelease };
export default RollbackEngine;
