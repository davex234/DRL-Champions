/**
 * PUBLISH-VERIFY — valida el sistema de PUBLICACIÓN (Fase 3/7) sin compilar ni red: providers,
 * Transport Engine (upload/verify/health/rollback/cleanup), aislamiento por canal, anillo de
 * rollback, verificación byte-idéntica, selección de provider y fallback sin secrets.
 *
 *   node scripts/publish-verify.mjs   (o: npm run publish:verify)
 */
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { selectProvider, createProvider } from "./release/transport/provider.mjs";
import { createLocalProvider } from "./release/transport/providers/local.mjs";
import { createFilesystemProvider } from "./release/transport/providers/filesystem.mjs";
import { createGitHubProvider } from "./release/transport/providers/github.mjs";
import { createR2Provider } from "./release/transport/providers/r2.mjs";
import TransportEngine from "./release/transport/engine.mjs";
import { publishRelease, collectStaged } from "./release/transport/publish.mjs";
import { sha256File } from "./release/core/hash.mjs";
import { PHASES } from "./release/pipeline-state.mjs";

let pass = 0, fail = 0;
const ok = (n, c, extra = "") => { c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${extra}`)); };

const TMP = mkdtempSync(join(tmpdir(), "drl-pub-"));
const cleanupAll = () => { try { rmSync(TMP, { recursive: true, force: true }); } catch { /* */ } };

/** Crea un stagedDir realista (manifiestos + report + installer simulado). */
function makeStaged(dir, { version = "1.2.3", build = 7 } = {}) {
  mkdirSync(dir, { recursive: true });
  const w = (name, obj) => writeFileSync(join(dir, name), typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) + "\n");
  w("latest.json", { version, notes: "x", pub_date: "2026-06-30T00:00:00Z", platforms: { "windows-x86_64": { signature: "S", url: "u" } } });
  w("meta.json", { version, build, full: `${version}+${build}`, platforms: { "windows-x86_64": { size: 123 } } });
  w("files.json", { version, channel: "stable", files: [{ path: "index.html", sha256: "abc", size: 10 }] });
  w("release.json", { id: `stable-${version}+${build}`, version, build, full: `${version}+${build}`, channel: "stable" });
  w("release-report.json", { title: "report", full: `${version}+${build}` });
  w("RELEASE-REPORT.md", "# report\n");
  w("DRLChampionsSetup.exe", "MZ-fake-installer-bytes");
  return dir;
}

function makeRelease({ version = "1.2.3", build = 7, channel = "stable", signed = true } = {}) {
  return { id: `${channel}-${version}+${build}`, version, build, full: `${version}+${build}`, channel, date: "2026-06-30T00:00:00Z", signed };
}

await (async () => {
  console.log("\n━━━ PUBLISH SYSTEM · VERIFY (Fase 3/7) ━━━\n");

  // ── 1. Providers: interfaz uniforme ──
  console.log("Providers (interfaz uniforme):");
  const env0 = {};
  const provs = {
    local: createLocalProvider({ env: { DRL_PUBLISH_LOCAL_DIR: join(TMP, "p-local") }, root: TMP }),
    filesystem: createFilesystemProvider({ env: { DRL_PUBLISH_FS_DIR: join(TMP, "p-fs") } }),
    github: createGitHubProvider({ env: env0, root: TMP }),
    r2: createR2Provider({ env: env0 }),
  };
  const CONTRACT = ["configured", "health", "put", "getBytes", "list", "remove", "copy", "url"];
  for (const [name, p] of Object.entries(provs)) {
    ok(`${name}: implementa el contrato`, CONTRACT.every((m) => typeof p[m] === "function"), `faltan: ${CONTRACT.filter((m) => typeof p[m] !== "function")}`);
    ok(`${name}: name correcto`, p.name === name);
  }

  // ── 2. "Funciona aunque falten Secrets" ──
  console.log("\nFunciona sin secrets (configured):");
  ok("local SIEMPRE configurado", provs.local.configured() === true);
  ok("filesystem sin raíz → NO configurado", createFilesystemProvider({ env: {} }).configured() === false);
  ok("github sin token/repo → NO configurado", provs.github.configured() === false);
  ok("r2 sin credenciales → NO configurado", provs.r2.configured() === false);

  // ── 3. Selección de provider ──
  console.log("\nSelección de provider:");
  ok("auto sin secrets → local", selectProvider({ env: {}, root: TMP }).provider.name === "local");
  ok("DRL_PUBLISH_PROVIDER fuerza", selectProvider({ env: { DRL_PUBLISH_PROVIDER: "filesystem", DRL_PUBLISH_FS_DIR: join(TMP, "x") }, root: TMP }).provider.name === "filesystem");
  ok("auto prefiere r2 si configurado", selectProvider({ env: { R2_ACCOUNT_ID: "a", R2_ACCESS_KEY_ID: "k", R2_SECRET_ACCESS_KEY: "s", R2_BUCKET: "b" }, root: TMP }).provider.name === "r2");
  let threw = false; try { createProvider("nope"); } catch { threw = true; }
  ok("provider desconocido lanza", threw);

  // ── 4. Transport Engine: upload + verify byte-idéntico ──
  console.log("\nTransport Engine (upload + verify byte-idéntico):");
  const provider = provs.local;
  const stagedA = makeStaged(join(TMP, "staged-a"));
  const health = await TransportEngine.health(provider);
  ok("health() del destino OK", health.ok, health.detail);
  const staged = collectStaged(stagedA);
  ok("collectStaged incluye exe + manifiestos + report", staged.some((f) => f.name.endsWith(".exe")) && staged.some((f) => f.name === "latest.json") && staged.some((f) => f.name === "files.json"));
  const files = staged.map((f) => ({ key: TransportEngine.channelKey("stable", f.name), path: f.path }));
  const uploaded = await TransportEngine.upload(provider, files);
  ok("upload devuelve sha256+size+url por fichero", uploaded.every((u) => u.sha256 && u.size > 0 && u.url));
  const expected = staged.map((f) => ({ key: TransportEngine.channelKey("stable", f.name), sha256: f.sha256, size: f.size }));
  const v = await TransportEngine.verify(provider, expected);
  ok("verify() OK tras subir", v.ok, JSON.stringify(v));
  // byte-idéntico real: comparar archivo publicado vs staged
  const pubExe = await provider.getBytes(TransportEngine.channelKey("stable", "DRLChampionsSetup.exe"));
  ok("publicado == staged (byte a byte)", Buffer.compare(pubExe, readFileSync(join(stagedA, "DRLChampionsSetup.exe"))) === 0);
  // corromper destino → verify falla
  await provider.put({ key: TransportEngine.channelKey("stable", "latest.json"), bytes: Buffer.from("tampered") });
  const v2 = await TransportEngine.verify(provider, expected);
  ok("verify() detecta manipulación", v2.ok === false && v2.mismatches.includes("stable/latest.json"));
  ok("verify() detecta ausencia", (await TransportEngine.verify(provider, [{ key: "stable/missing", sha256: "x", size: 1 }])).missing.length === 1);

  // ── 5. publishRelease end-to-end + fases ──
  console.log("\npublishRelease (end-to-end + fases uploading/verifying/published):");
  const prov2 = createLocalProvider({ env: { DRL_PUBLISH_LOCAL_DIR: join(TMP, "pub2") }, root: TMP });
  const stagedB = makeStaged(join(TMP, "staged-b"));
  const phases = [];
  const res = await publishRelease({ release: makeRelease(), stagedDir: stagedB, channel: "stable", provider: prov2, onPhase: (n) => phases.push(n) });
  ok("emite uploading→verifying→published", phases.join(">") === "uploading>verifying>published", phases.join(">"));
  ok("resultado ready/published/verified", res.ready && res.published && res.verified);
  ok("destino apunta a latest.json del canal", res.destination.includes("stable/latest.json") || res.destination.includes("stable%2Flatest.json"));
  ok("totalBytes y uploadMs presentes", res.totalBytes > 0 && typeof res.uploadMs === "number");
  ok("escribe publish.json (datos Fase 4)", existsSync(join(stagedB, "publish.json")));
  ok("hashes por fichero en el resultado", res.files.every((f) => f.sha256));

  // ── 6. Aislamiento por canal ──
  console.log("\nAislamiento por canal:");
  const provCh = createLocalProvider({ env: { DRL_PUBLISH_LOCAL_DIR: join(TMP, "channels") }, root: TMP });
  for (const ch of ["stable", "beta", "developer", "nightly"]) {
    await publishRelease({ release: makeRelease({ channel: ch, version: `1.0.${ch.length}` }), stagedDir: makeStaged(join(TMP, `st-${ch}`), { version: `1.0.${ch.length}` }), channel: ch, provider: provCh });
  }
  const stableLatest = await provCh.getBytes("stable/latest.json");
  const betaLatest = await provCh.getBytes("beta/latest.json");
  ok("cada canal tiene su latest.json", !!stableLatest && !!betaLatest);
  ok("canales aislados (contenido distinto)", Buffer.compare(stableLatest, betaLatest) !== 0);
  ok("4 canales presentes", ["stable", "beta", "developer", "nightly"].every((c) => existsSync(join(TMP, "channels", c, "files.json"))));

  // ── 7. Anillo de rollback N, N-1, N-2 ──
  console.log("\nAnillo de rollback (N, N-1, N-2):");
  const provRing = createLocalProvider({ env: { DRL_PUBLISH_LOCAL_DIR: join(TMP, "ring") }, root: TMP });
  const fulls = [];
  for (let i = 1; i <= 4; i++) {
    const version = `2.0.${i}`;
    await publishRelease({ release: makeRelease({ version, build: i }), stagedDir: makeStaged(join(TMP, `ring-${i}`), { version, build: i }), channel: "stable", provider: provRing, keep: 3 });
    fulls.push(`${version}+${i}`);
  }
  const hist = await TransportEngine.readHistory(provRing, "stable");
  ok("anillo conserva 3 (keep=3)", hist.releases.length === 3, `=${hist.releases.length}`);
  ok("current = última release", hist.current === fulls[3]);
  ok("la más antigua fue podada", !hist.releases.some((r) => r.full === fulls[0]));
  ok("archivos archivados de la release podada borrados", !existsSync(join(TMP, "ring", "stable", "releases", fulls[0], "files.json")));
  const targets = await TransportEngine.rollbackTargets(provRing, "stable");
  ok("rollbackTargets = N-1, N-2", targets.length === 2 && targets.includes(fulls[2]) && targets.includes(fulls[1]));

  // rollback real → repunta latest a una versión anterior
  const before = JSON.parse((await provRing.getBytes("stable/meta.json")).toString());
  const rb = await TransportEngine.rollback(provRing, "stable", fulls[2]); // N-1
  ok("rollback() OK", rb.ok && rb.current === fulls[2]);
  const after = JSON.parse((await provRing.getBytes("stable/meta.json")).toString());
  ok("rollback repuntó el contenido vigente", before.full !== after.full && after.full === fulls[2]);
  ok("rollback a versión inexistente falla limpio", (await TransportEngine.rollback(provRing, "stable", "9.9.9+9")).ok === false);

  // ── 8. cleanup explícito ──
  console.log("\ncleanup:");
  const cl = await TransportEngine.cleanup(provRing, "stable", 1);
  ok("cleanup(keep=1) deja 1", (await TransportEngine.readHistory(provRing, "stable")).releases.length === 1);
  ok("cleanup reporta podadas", cl.pruned.length >= 1);

  // ── 9. Verificación rechaza release no firmada sin files.json ──
  console.log("\nVerificación bloquea Ready si falta integridad:");
  const provBad = createLocalProvider({ env: { DRL_PUBLISH_LOCAL_DIR: join(TMP, "bad") }, root: TMP });
  const stagedBad = join(TMP, "staged-bad");
  mkdirSync(stagedBad, { recursive: true });
  writeFileSync(join(stagedBad, "meta.json"), "{}"); // sin files.json
  const badRes = await publishRelease({ release: makeRelease(), stagedDir: stagedBad, channel: "stable", provider: provBad });
  ok("sin files.json → NO ready", badRes.ready === false && badRes.status === "failed");

  // ── 10. Determinismo de hashes (mismo staged → mismos sha) ──
  console.log("\nDeterminismo:");
  const s1 = collectStaged(stagedA).map((f) => f.sha256).join();
  const s2 = collectStaged(stagedA).map((f) => f.sha256).join();
  ok("collectStaged determinista", s1 === s2);
  ok("sha256File coincide con collectStaged", collectStaged(stagedA).find((f) => f.name === "files.json").sha256 === sha256File(join(stagedA, "files.json")));

  // ── 11. Máquina de estados extendida ──
  console.log("\nMáquina de estados (Fase 3):");
  for (const ph of ["uploading", "verifying", "published"]) ok(`PHASES incluye '${ph}'`, PHASES.includes(ph));
  ok("orden: manifests < uploading < verifying < published < ready", PHASES.indexOf("manifests") < PHASES.indexOf("uploading") && PHASES.indexOf("uploading") < PHASES.indexOf("verifying") && PHASES.indexOf("verifying") < PHASES.indexOf("published") && PHASES.indexOf("published") < PHASES.indexOf("ready"));

  console.log(`\n━━━ Resultado: ${pass} ✓ / ${fail} ✗ ━━━\n`);
})().then(() => { cleanupAll(); process.exit(fail === 0 ? 0 : 1); }).catch((e) => { cleanupAll(); console.error(e); process.exit(1); });
