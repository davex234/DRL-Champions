/**
 * ROLLBACK-VERIFY — valida el Automatic Rollback Engine (Fase 5/7) sin red ni build: publica un
 * anillo de releases firmadas con el provider local, ejecuta rollbacks REALES (TransportEngine.
 * rollback vía el Rollback Engine) y comprueba todo lo exigido:
 *
 *   rollback correcto · fallido · hashes · firma · manifests · provider · dashboard · history ·
 *   pipeline · updater/cliente · determinismo · seguridad (cancela y revierte).
 *
 *   npx tsx scripts/rollback-verify.ts   (o: npm run rollback:verify)
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import RollbackDefault from "./release/transport/rollback.mjs";
import EngineDefault from "./release/transport/engine.mjs";
import PublishDefault from "./release/transport/publish.mjs";
import LocalDefault from "./release/transport/providers/local.mjs";
import { readDashboard } from "../src/server/releases/reader";

// Los .mjs no llevan tipos: los tratamos como `any` en el harness (igual que en producción
// se cargan vía import dinámico). El comportamiento lo validan las aserciones, no el tipado.
const { rollbackRelease, planRollback, validateRollback } = RollbackDefault as any;
const TransportEngine = EngineDefault as any;
const { publishRelease } = PublishDefault as any;
const { createLocalProvider } = LocalDefault as any;

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, extra = "") => { c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${extra}`)); };
const ROOT = process.cwd();

/** Crea un fixture aislado con su provider local y un publicador de releases firmadas. */
function fixture() {
  const tmp = mkdtempSync(join(tmpdir(), "drl-rb-"));
  const provider = createLocalProvider({ env: { DRL_PUBLISH_LOCAL_DIR: join(tmp, "dist", "published") } as any, root: tmp });
  const channel = "stable";
  const stagedDir = join(tmp, "dist", "update", channel);

  const stageFiles = (version: string, build: number, signed: boolean) => {
    mkdirSync(stagedDir, { recursive: true });
    const full = `${version}+${build}`;
    const w = (name: string, obj: unknown) => writeFileSync(join(stagedDir, name), typeof obj === "string" ? obj : JSON.stringify(obj));
    w("latest.json", { version, notes: full, pub_date: "2026-06-30T00:00:00Z", platforms: { "windows-x86_64": { signature: `sig-${full}`, url: `u/${full}` } } });
    w("meta.json", { version, build, full, pub_date: "2026-06-30T00:00:00Z", platforms: { "windows-x86_64": { size: 100 } } });
    w("files.json", { version, channel, generatedAt: "2026-06-30T00:00:00Z", files: [{ path: "index.html", sha256: `h-${full}`, size: 10 }] });
    w("release.json", { id: `${channel}-${full}`, version, build, full, channel, date: `2026-06-3${build}T00:00:00.000Z`, commit: `c${build}`, hash: "fp", notes: `Notas ${full}`, baseUrl: "https://u", files: [{ name: "DRLChampionsSetup.exe", size: 50, sha256: `e-${full}`, signed, kind: "installer" }], manifests: { hasLatest: true, hasMeta: true, hasFiles: true }, signed, ready: true });
    w("DRLChampionsSetup.exe", `installer-bytes-${full}`);
    return { id: `${channel}-${full}`, version, build, full, channel, date: `2026-06-3${build}T00:00:00.000Z`, signed };
  };
  const publish = (version: string, build: number, signed = true) =>
    publishRelease({ release: stageFiles(version, build, signed) as any, stagedDir, channel, provider, keep: 5 });

  return { tmp, provider, channel, stagedDir, publish, cleanup: () => { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } } };
}

const counterNow = () => { let t = 1000; return () => (t += 5); };

(async () => {
  console.log("\n━━━ ROLLBACK ENGINE · VERIFY (Fase 5/7) ━━━\n");

  // ── 1. Validación / seguridad (unitario, sin tocar nada) ──
  console.log("Seguridad (validateRollback):");
  const hist = {
    current: "1.0.3+3",
    releases: [
      { full: "1.0.3+3", signed: true, files: [{ name: "latest.json", sha256: "a", size: 1 }, { name: "files.json", sha256: "b", size: 1 }] },
      { full: "1.0.2+2", signed: true, files: [{ name: "latest.json", sha256: "c", size: 1 }, { name: "files.json", sha256: "d", size: 1 }] },
      { full: "1.0.1+1", signed: false, files: [{ name: "latest.json", sha256: "e", size: 1 }] },
      { full: "1.0.0+0", signed: true, files: [{ name: "x.txt", sha256: null, size: 1 }] },
    ],
  };
  ok("versión inexistente → NOT_FOUND", validateRollback({ history: hist, channel: "stable", toFull: "9.9.9+9" }).code === "NOT_FOUND");
  ok("versión vigente → ALREADY_CURRENT", validateRollback({ history: hist, channel: "stable", toFull: "1.0.3+3" }).code === "ALREADY_CURRENT");
  ok("sin firma → UNSIGNED (bloqueado)", validateRollback({ history: hist, channel: "stable", toFull: "1.0.1+1" }).code === "UNSIGNED");
  ok("sin firma + allowUnsigned → permitido", validateRollback({ history: hist, channel: "stable", toFull: "1.0.1+1", allowUnsigned: true }).ok === true);
  ok("hash incompleto → NO_HASH (corrupto)", validateRollback({ history: hist, channel: "stable", toFull: "1.0.0+0" }).code === "NO_HASH");
  ok("destino válido firmado → ok", validateRollback({ history: hist, channel: "stable", toFull: "1.0.2+2" }).ok === true);

  // ── 2. Rollback correcto (end-to-end real) ──
  console.log("\nRollback correcto (end-to-end):");
  const f = fixture();
  await f.publish("1.0.1", 1);
  await f.publish("1.0.2", 2);
  await f.publish("1.0.3", 3);
  const phases: string[] = [];
  const res = await rollbackRelease({ provider: f.provider, channel: f.channel, toFull: "1.0.2+2", reason: "regresión", user: "tester", stagedDir: f.stagedDir, onPhase: (_n: string, i: any) => phases.push(i.label) });
  ok("rollback ok + ready", res.ok && res.ready);
  ok("status published", res.status === "published");
  ok("rolledBackFrom = 1.0.3+3", res.rolledBackFrom === "1.0.3+3");
  ok("emite fases Rolling back→Verifying→Publishing→Ready", ["Rolling back", "Verifying", "Publishing", "Ready"].every((p) => phases.includes(p)), phases.join(">"));
  ok("kind = rollback", (res as any).kind === "rollback");

  // ── 3. Provider: la versión vigente es ahora la destino ──
  console.log("\nProvider / manifests / updater (cliente):");
  const histAfter = await TransportEngine.readHistory(f.provider, f.channel);
  ok("history.current = 1.0.2+2", histAfter.current === "1.0.2+2");
  const metaBuf = await f.provider.getBytes(TransportEngine.channelKey(f.channel, "meta.json"));
  const meta = JSON.parse(metaBuf!.toString());
  ok("meta.json publicado = versión destino (cliente detecta)", meta.version === "1.0.2" && meta.full === "1.0.2+2");
  const latestBuf = await f.provider.getBytes(TransportEngine.channelKey(f.channel, "latest.json"));
  ok("latest.json accesible (updater lo lee)", !!latestBuf && JSON.parse(latestBuf.toString()).version === "1.0.2");

  // ── 4. Hashes / verificación byte-idéntica ──
  console.log("\nHashes / verificación:");
  ok("verify post-rollback ok", res.verify?.ok === true);
  const target = histAfter.releases.find((r: any) => r.full === "1.0.2+2")!;
  const rootCheck = await TransportEngine.verify(f.provider, target.files.map((x: any) => ({ key: TransportEngine.channelKey(f.channel, x.name), sha256: x.sha256, size: x.size })));
  ok("raíz del canal byte-idéntica al destino", rootCheck.ok, JSON.stringify(rootCheck));

  // ── 5. JSON actualizados (publish/pipeline en el provider y staged) ──
  console.log("\nManifiestos/estado actualizados (Paso 7):");
  ok("provider tiene publish.json de rollback", !!(await f.provider.getBytes(TransportEngine.channelKey(f.channel, "publish.json"))));
  const ps = await f.provider.getBytes(TransportEngine.channelKey(f.channel, "pipeline-state.json"));
  ok("provider tiene pipeline-state.json (ready)", !!ps && JSON.parse(ps.toString()).state === "ready");
  ok("provider tiene rollback.json", !!(await f.provider.getBytes(TransportEngine.channelKey(f.channel, "rollback.json"))));

  // ── 6. History / log profesional ──
  console.log("\nHistory / log:");
  ok("history.events registra el rollback", Array.isArray(histAfter.events) && histAfter.events.length === 1);
  ok("evento con from/to/user/reason/result", histAfter.events[0].from === "1.0.3+3" && histAfter.events[0].to === "1.0.2+2" && histAfter.events[0].user === "tester" && histAfter.events[0].reason === "regresión" && histAfter.events[0].result === "ok");

  // ── 7. Dashboard refleja el rollback (sin recrear lógica) ──
  console.log("\nDashboard:");
  const dash = await readDashboard({ root: f.tmp, scriptsRoot: ROOT, env: { ...process.env, DRL_PUBLISH_LOCAL_DIR: join(f.tmp, "dist", "published") } });
  const cur = dash.releases.find((r) => r.isCurrent && r.channel === "stable");
  ok("dashboard: vigente = 1.0.2+2", cur?.full === "1.0.2+2");
  ok("dashboard: marcado kind rollback", cur?.kind === "rollback" && cur?.rolledBackFrom === "1.0.3+3");
  ok("dashboard: rollbacks/timeline poblados", dash.rollbacks.length === 1 && dash.timeline.some((t) => t.type === "rollback"));
  ok("dashboard: pipeline ready", dash.pipeline?.state === "ready");

  // ── 8. Segundo rollback (Release→Rollback→Rollback) + back-to-newest ──
  console.log("\nEncadenado (Release ↔ Rollback):");
  const res2 = await rollbackRelease({ provider: f.provider, channel: f.channel, toFull: "1.0.3+3", reason: "volver", user: "tester", stagedDir: f.stagedDir });
  ok("rollback de vuelta a 1.0.3+3 ok", res2.ok && (await TransportEngine.readHistory(f.provider, f.channel)).current === "1.0.3+3");
  ok("history.events ahora con 2 eventos", (await TransportEngine.readHistory(f.provider, f.channel)).events.length === 2);
  f.cleanup();

  // ── 9. Rollback FALLIDO: archivo archivado corrupto → cancela y NO cambia current ──
  console.log("\nRollback fallido (seguridad: cancela + revierte):");
  const g = fixture();
  await g.publish("2.0.1", 1);
  await g.publish("2.0.2", 2);
  // Corromper la copia archivada del destino.
  await g.provider.put({ key: TransportEngine.archiveKey(g.channel, "2.0.1+1", "latest.json"), bytes: Buffer.from("CORRUPTO") });
  const bad = await rollbackRelease({ provider: g.provider, channel: g.channel, toFull: "2.0.1+1", stagedDir: g.stagedDir });
  ok("rollback corrupto → ok:false code CORRUPT_ARCHIVE", bad.ok === false && bad.code === "CORRUPT_ARCHIVE");
  ok("current NO cambió (sigue 2.0.2+2)", (await TransportEngine.readHistory(g.provider, g.channel)).current === "2.0.2+2");
  ok("evento fallido registrado en el log", (await TransportEngine.readHistory(g.provider, g.channel)).events.some((e: any) => e.result === "failed"));
  // Inexistente / canal cruzado:
  const nf = await rollbackRelease({ provider: g.provider, channel: g.channel, toFull: "9.9.9+9", stagedDir: g.stagedDir });
  ok("inexistente → NOT_FOUND (no cambia nada)", nf.ok === false && nf.code === "NOT_FOUND");
  g.cleanup();

  // ── 10. Plan (comparación) ──
  console.log("\nPlan / comparación:");
  const h = fixture();
  await h.publish("3.0.1", 1);
  await h.publish("3.0.2", 2);
  const plan = await planRollback({ provider: h.provider, channel: h.channel, toFull: "3.0.1+1" });
  ok("plan válido", plan.valid === true);
  ok("plan: current=3.0.2+2 target=3.0.1+1", plan.current?.full === "3.0.2+2" && plan.target?.full === "3.0.1+1");
  ok("plan: archivos afectados detectados", plan.diff.affected.length > 0);
  ok("plan: targets disponibles del anillo", plan.availableTargets.some((t: any) => t.full === "3.0.1+1"));

  // ── 11. Determinismo ──
  console.log("\nDeterminismo:");
  const run = async () => {
    const fx = fixture();
    await fx.publish("4.0.1", 1);
    await fx.publish("4.0.2", 2);
    const r = await rollbackRelease({ provider: fx.provider, channel: fx.channel, toFull: "4.0.1+1", reason: "x", user: "u", stagedDir: fx.stagedDir, now: counterNow(), date: "2026-06-30T00:00:00.000Z" });
    fx.cleanup();
    return JSON.stringify({ full: r.full, version: r.version, build: r.build, from: r.rolledBackFrom, status: r.status, ok: r.ok, verify: r.verify?.ok, phases: r.phases.length, durationMs: r.durationMs });
  };
  ok("dos rollbacks idénticos → resultado idéntico", (await run()) === (await run()));
  h.cleanup();

  console.log(`\n━━━ Resultado: ${pass} ✓ / ${fail} ✗ ━━━\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
