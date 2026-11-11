/**
 * CI VERIFY RUNNER — ejecuta TODOS los `scripts/*-verify.ts` y sale con código !=0 si alguno falla.
 *
 * Cada verify fija `process.exitCode = 1` cuando una comprobación falla (gate real, no decorativo).
 * Este runner los agrega en un solo comando para CI (`npm run verify:all`) y para uso local.
 *
 * VERIFY_EXCLUDE="a-verify.ts,b-verify.ts" permite excluir verifies dependientes del entorno
 * (p. ej. los que requieren artefactos de build de escritorio).
 *
 * ────────────────────────── TIEMPO ──────────────────────────
 *
 * Antes se lanzaban los 134 en serie, en orden alfabético y con `npx tsx` a través de una shell. En CI el job se
 * cancelaba a los 25 min sin haber ejecutado ~40 verifies: `preparation-verify` (simulación de solo CPU, ~20 min)
 * caía en el puesto 93 y no dejaba sitio al resto. Ahora:
 *   - cada verify se lanza con `node --import tsx` directamente (sin npx ni shell por verify);
 *   - en CI se ejecutan VARIOS a la vez (VERIFY_CONCURRENCY; por defecto min(3, núcleos)). En local, uno a uno salvo
 *     que se pida otra cosa: los equipos de desarrollo ya van justos de memoria;
 *   - los lentos conocidos (SLOW_FIRST) arrancan primero, para que no queden para el final;
 *   - cada resultado lleva su duración, el resumen lista los más lentos, y si el job se cancela se imprimen los
 *     verifies que estaban en curso.
 * La regla de aprobado NO cambia: cualquier verify con salida != 0 (o terminado por señal) es FAIL.
 *
 * Concurrencia revisada: los verifies que escriben ficheros usan directorios temporales únicos (`mkdtemp`); solo
 * `game-experience-verify` escribe en el repo y solo `sw-verify` compila y levanta un servidor (puerto fijo 3123);
 * los que abren Chrome usan perfil propio y un puerto de depuración aleatorio (9800–9979).
 */
import { readdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { availableParallelism } from "node:os";
import { join } from "node:path";

const DIR = "scripts";
const ROOT = process.cwd();
const IN_CI = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";

/** Lentos medidos en CI (s, ejecución de 2026-11-10/11). Arrancan los primeros; el resto, en orden alfabético. */
const SLOW_FIRST = [
  "preparation-verify.ts", // > 700 (no llegó a terminar)
  "sw-verify.ts", // compila la app (`npm run build`) antes de probar
  "combat-verify.ts", // 109–187
  "platform-verify.ts", // 82–150
  "buy-verify.ts", // 82–144
  "career-transfermarket-verify.ts", // 85–113
  "career-endgame-verify.ts", // 57–77
  "pack-verify.ts", // 43–74
  "online-verify.ts", // 35–64
  "player-journey-verify.ts", // 32–52
];

const all = readdirSync(DIR).filter((f) => f.endsWith("-verify.ts")).sort();
const exclude = new Set((process.env.VERIFY_EXCLUDE ?? "").split(",").map((s) => s.trim()).filter(Boolean));
const slow = SLOW_FIRST.filter((f) => all.includes(f));
const files = [...slow, ...all.filter((f) => !slow.includes(f))];

const requested = Number.parseInt(process.env.VERIFY_CONCURRENCY ?? "", 10);
const concurrency = Number.isInteger(requested) && requested >= 1
  ? requested
  : IN_CI ? Math.max(1, Math.min(3, availableParallelism())) : 1;

const secs = (ms) => `${(ms / 1000).toFixed(1)} s`;
const tail = (s) => s.split("\n").slice(-12).join("\n") + "\n";

const failed = [];
const skipped = [];
const durations = [];
const running = new Map(); // fichero → { child, start }
const t0 = Date.now();

function runOne(f) {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn(process.execPath, ["--import", "tsx", join(DIR, f)], { cwd: ROOT, env: process.env, shell: false });
    running.set(f, { child, start });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    const finish = (code, signal, spawnError) => {
      if (!running.has(f)) return;
      running.delete(f);
      const ms = Date.now() - start;
      durations.push([f, ms]);
      if (code === 0) {
        console.log(`✓  PASS  ${f}  (${secs(ms)})`);
      } else {
        failed.push(f);
        const why = spawnError ? ` — no arrancó: ${spawnError}` : signal ? ` — terminado por ${signal}` : "";
        // Un solo write por verify: con varios a la vez, su bloque no se mezcla con el de otro.
        process.stdout.write(`✗  FAIL  ${f}  (${secs(ms)})${why}\n` + (out ? tail(out) : ""));
        if (err) process.stderr.write(tail(err));
      }
      resolve();
    };
    child.on("error", (e) => finish(null, null, e.code ?? e.message));
    child.on("close", (code, signal) => finish(code, signal, null));
  });
}

// Si GitHub cancela el job (límite de tiempo), dejar dicho qué estaba en curso y qué no llegó a empezar.
let pending = [];
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    const now = Date.now();
    console.log(`\n⏹  ${sig} a los ${secs(now - t0)} — verifies EN CURSO:`);
    for (const [f, { start }] of running) console.log(`  - ${f} (${secs(now - start)})`);
    console.log(`  sin empezar: ${pending.length}${pending.length ? ` (${pending.join(", ")})` : ""}`);
    for (const { child } of running.values()) child.kill("SIGTERM");
    process.exit(sig === "SIGINT" ? 130 : 143);
  });
}

pending = files.filter((f) => {
  if (!exclude.has(f)) return true;
  skipped.push(f);
  console.log(`⏭  SKIP  ${f}`);
  return false;
});
console.log(`[verify:all] ${pending.length} verifies · concurrencia ${concurrency}${IN_CI ? " (CI)" : ""} · lentos primero: ${slow.length}`);

async function worker() {
  while (pending.length) {
    const f = pending.shift();
    await runOne(f);
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));

const ran = files.length - skipped.length;
console.log(`\n${failed.length === 0 ? "✅" : "❌"} verifies: ${ran - failed.length}/${ran} passed` + (skipped.length ? ` (${skipped.length} skipped)` : "") + ` · ${secs(Date.now() - t0)} en total`);
console.log("Más lentos:\n" + durations.sort((a, b) => b[1] - a[1]).slice(0, 10).map(([f, ms]) => `  ${secs(ms).padStart(8)}  ${f}`).join("\n"));
if (failed.length) {
  console.log("FAILED:\n" + [...failed].sort().map((f) => "  - " + f).join("\n"));
  process.exit(1);
}
