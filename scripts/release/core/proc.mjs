/**
 * RELEASE/CORE/PROC — ejecución de comandos (única implementación compartida).
 * Aísla `spawnSync` para que ningún engine lo invoque directamente.
 */
import { spawnSync } from "node:child_process";

/** Ejecuta un comando heredando stdio. Lanza si el código de salida no es 0. */
export function run(cmd, { env = {}, cwd } = {}) {
  const t0 = Date.now();
  const r = spawnSync(cmd, { stdio: "inherit", shell: true, cwd, env: { ...process.env, ...env } });
  const code = r.status ?? 1;
  if (code !== 0) throw new Error(`Command failed (exit ${code}): ${cmd}`);
  return { ok: true, cmd, ms: Date.now() - t0 };
}

/** Ejecuta y captura stdout (no lanza; devuelve ok/out/code). Para git, versiones, etc. */
export function capture(cmd, { cwd } = {}) {
  const r = spawnSync(cmd, { shell: true, cwd, encoding: "utf8" });
  return { ok: (r.status ?? 1) === 0, out: (r.stdout || "").trim(), code: r.status ?? 1 };
}
