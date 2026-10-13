/**
 * FASE 44.1 · GATES FINALES (instrumento `_`, fuera de CI) — `node scripts/_fase44-1-gates.mjs [grupo]`
 *
 * Ejecuta en serie los verificadores de regresión del encargo (y los nuevos de la fase) y deja la evidencia en
 * docs/product/qa/fase44-1/gates.json. OJO: correr con el túnel SSH CERRADO (sin 127.0.0.1:54521): con él abierto
 * `.env.local` apunta a la BD real y un verificador podría escribir en ella.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { createConnection } from "node:net";
import { join } from "node:path";

const ROOT = process.cwd();
const scripts = Object.keys(JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts);
const PREFIXES = ["security", "pack", "content", "distribution", "combat", "deck", "social", "replay", "competitive", "season", "campaign", "daily-loop", "pack-objective", "collection", "pack-opening", "draft-gauntlet", "player-journey", "economy", "live-service", "deck-strategy", "battlepass", "game-experience", "importer-vlr", "game-immersion", "game-environment", "game-audio", "game-scroll", "game-atmosphere"];
const group = process.argv[2] ?? null;
const list = scripts.filter((k) => k.endsWith(":verify") && PREFIXES.some((p) => k === `${p}:verify` || k.startsWith(`${p}-`)))
  .filter((k) => !group || k.startsWith(group));

const tunnelOpen = await new Promise((res) => { const s = createConnection({ host: "127.0.0.1", port: 54521 }); s.once("connect", () => { s.destroy(); res(true); }); s.once("error", () => res(false)); s.setTimeout(1500, () => { s.destroy(); res(false); }); });
if (tunnelOpen) { console.error("✗ El túnel a la BD real (127.0.0.1:54521) está ABIERTO: ciérralo antes de correr los gates."); process.exit(2); }

const outFile = join(ROOT, "docs/product/qa/fase44-1", group ? `gates-${group}.json` : "gates.json");
const prev = existsSync(outFile) ? JSON.parse(readFileSync(outFile, "utf8")) : null;
const rows = [];
for (const name of list) {
  const t0 = Date.now();
  const r = spawnSync("npm", ["run", "-s", name], { cwd: ROOT, shell: true, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 45 * 60 * 1000 });
  const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  const summary = out.split(/\r?\n/).filter((l) => /\d+\s*✓|✓ ·|pass|fail|✗/.test(l)).slice(-2).join(" | ").slice(0, 240);
  const row = { name, ok: r.status === 0, status: r.status, seconds: Math.round((Date.now() - t0) / 1000), summary };
  rows.push(row);
  console.log(`${row.ok ? "✓" : "✗"} ${name} (${row.seconds} s) ${row.ok ? "" : summary}`);
  writeFileSync(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), tunnelOpen, total: list.length, done: rows.length, passed: rows.filter((x) => x.ok).length, rows, previous: prev ? { passed: prev.passed, total: prev.total } : null }, null, 2) + "\n");
}
const failed = rows.filter((x) => !x.ok);
console.log(`\n${rows.length - failed.length}/${rows.length} verificadores en verde`);
if (failed.length) process.exitCode = 1;
