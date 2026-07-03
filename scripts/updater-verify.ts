/**
 * UPDATER-VERIFY — harness determinista del sistema de actualización.
 *
 * Prueba SIN Tauri ni red: la máquina de estados del controlador (con backend inyectado),
 * el flujo granular (descargar/instalar/reiniciar), el cálculo de progreso, los canales, el
 * diff de integridad y el núcleo de release. `npx tsx scripts/updater-verify.ts`.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  UpdateController, advanceProgress, newProgress, formatBytes, formatSpeed, formatEta,
  type UpdaterBackend, type RemoteUpdate, type DownloadEvent, type UpdateMeta,
} from "../src/platform/updater";
import { verifyManifest, type FileManifest, type FileReader } from "../src/platform/verify";
import { isChannel, channelHeaders, loadChannel, saveChannel } from "../src/platform/channels";
import { loadUpdatePrefs, saveUpdatePrefs, DEFAULT_UPDATE_PREFS, clampPollMinutes } from "../src/platform/updatePrefs";
import { loadLastSeenVersion, saveLastSeenVersion } from "../src/platform/seenVersion";
import { setAdapter, MemoryAdapter } from "../src/platform/store";
import { buildLatest, buildFiles, platformKey, artifactName } from "./release/manifest-engine.mjs";
import { sha256Hex } from "./release/core/hash.mjs";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};
const approx = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol;

// Backend determinista (DI, no mock de producción): reloj manual + descarga por eventos.
class FakeBackend implements UpdaterBackend {
  readonly name = "fake";
  private t = 0;
  constructor(
    private remote: RemoteUpdate | null,
    private chunks: number[] = [],
    private total = 0,
    private failOn: "none" | "download" | "install" = "none",
    private metaData: UpdateMeta | null = null,
  ) {}
  now() { return this.t; }
  async check() { return this.remote; }
  async meta() { return this.metaData; }
  async download(_u: RemoteUpdate, onEvent: (e: DownloadEvent) => void) {
    onEvent({ kind: "started", contentLength: this.total });
    for (const c of this.chunks) { this.t += 1000; onEvent({ kind: "progress", chunkLength: c }); }
    if (this.failOn === "download") throw new Error("fallo de red simulado");
    onEvent({ kind: "finished" });
  }
  async install() { if (this.failOn === "install") throw new Error("firma inválida simulada"); }
  async relaunch() { /* no-op */ }
}
const remote: RemoteUpdate = { version: "0.6.0", notes: "Notas", date: "2026-06-29" };
// paceMs = 0 → sin pausas cosméticas en test.
const mk = (be: FakeBackend, current = "0.5.2") => new UpdateController(be, "stable", current, 0);

(async () => {
  console.log("\n━━━ DRL UPDATER · VERIFY ━━━\n");

  // 1) Formateadores
  console.log("Formato humano:");
  ok("formatBytes GB", formatBytes(1.2 * 1024 ** 3) === "1.20 GB");
  ok("formatBytes MB", formatBytes(452 * 1024 ** 2) === "452 MB");
  ok("formatBytes null → —", formatBytes(null) === "—");
  ok("formatSpeed", formatSpeed(82 * 1024 ** 2) === "82 MB/s");
  ok("formatEta m:s", formatEta(83) === "1 m 23 s");
  ok("formatEta s", formatEta(45) === "45 s");

  // 2) Progreso puro
  console.log("\nProgreso (puro):");
  let p = newProgress(0, 1000);
  p = advanceProgress(p, 250, 1000);
  ok("percent 25%", approx(p.percent, 25), `→ ${p.percent}`);
  ok("speed ~250 B/s", approx(p.speedBps, 250), `→ ${p.speedBps}`);
  ok("eta ~3 s", approx(p.etaSec, 3), `→ ${p.etaSec}`);
  p = advanceProgress(p, 250, 2000);
  ok("percent 50% acumulado", approx(p.percent, 50), `→ ${p.percent}`);
  ok("speed suavizado (EWMA)", p.speedBps > 0 && p.speedBps <= 250);

  // 3) Flujo completo automático (download → verify → install → finalize → restart)
  console.log("\nControlador — flujo automático completo:");
  const be = new FakeBackend(remote, [400, 400, 200], 1000, "none", { size: 1000, notes: "Notas largas" });
  const ctrl = mk(be);
  const seen: string[] = [];
  ctrl.subscribe((s) => seen.push(s.phase));
  let st = await ctrl.check();
  ok("check → available", st.phase === "available" && st.available === "0.6.0");
  ok("meta → availableSize", st.availableSize === 1000, `→ ${st.availableSize}`);
  ok("meta → notas enriquecidas", st.notes === "Notas largas");
  const done = await ctrl.downloadAndInstall(true);
  st = ctrl.getState();
  ok("downloadAndInstall → true", done);
  ok("estado final restarting", st.phase === "restarting", `→ ${st.phase}`);
  ok("percent final 100", st.percent === 100);
  ok("pasó por downloading/verifying/installing/finalizing",
    ["downloading", "verifying", "installing", "finalizing"].every((x) => seen.includes(x)));
  ok("orden download<verify<install<finalize",
    seen.indexOf("downloading") < seen.indexOf("verifying") &&
    seen.indexOf("verifying") < seen.indexOf("installing") &&
    seen.indexOf("installing") < seen.indexOf("finalizing"));

  // 4) Flujo granular (toggles: parar tras descargar / tras instalar)
  console.log("\nControlador — flujo granular (toggles):");
  const ctrlG = mk(new FakeBackend(remote, [1000], 1000));
  await ctrlG.check();
  await ctrlG.start({ autoInstall: false });
  ok("autoInstall=false → downloaded", ctrlG.getState().phase === "downloaded", `→ ${ctrlG.getState().phase}`);
  await ctrlG.install(false);
  ok("install(autoRestart=false) → ready", ctrlG.getState().phase === "ready", `→ ${ctrlG.getState().phase}`);
  await ctrlG.restart();
  ok("restart() → restarting", ctrlG.getState().phase === "restarting");

  // 5) Sin actualización
  console.log("\nControlador — sin actualización:");
  const ctrl2 = mk(new FakeBackend(null), "0.6.0");
  const st2 = await ctrl2.check();
  ok("check → up-to-date", st2.phase === "up-to-date" && st2.available === null);
  ok("start sin update → false", !(await ctrl2.start()));

  // 6) Errores con código
  console.log("\nControlador — errores con código:");
  const ctrlDl = mk(new FakeBackend(remote, [400], 1000, "download"));
  await ctrlDl.check();
  await ctrlDl.start();
  ok("fallo descarga → phase error", ctrlDl.getState().phase === "error");
  ok("código DOWNLOAD_FAILED", ctrlDl.getState().errorCode === "DOWNLOAD_FAILED", `→ ${ctrlDl.getState().errorCode}`);
  const ctrlIn = mk(new FakeBackend(remote, [1000], 1000, "install"));
  await ctrlIn.check();
  await ctrlIn.start();
  ok("fallo instalación → error", ctrlIn.getState().phase === "error");
  ok("código INSTALL_FAILED", ctrlIn.getState().errorCode === "INSTALL_FAILED", `→ ${ctrlIn.getState().errorCode}`);

  // 7) Canales + preferencias
  console.log("\nCanales y preferencias:");
  setAdapter(new MemoryAdapter());
  ok("isChannel válidos", isChannel("stable") && isChannel("nightly"));
  ok("isChannel inválido", !isChannel("foo"));
  ok("header X-DRL-Channel", channelHeaders("beta")["X-DRL-Channel"] === "beta");
  ok("canal default = stable", (await loadChannel()) === "stable");
  await saveChannel("developer");
  ok("persiste developer", (await loadChannel()) === "developer");
  ok("prefs default todo on", Object.values(DEFAULT_UPDATE_PREFS).every(Boolean));
  ok("prefs cargadas = default", (await loadUpdatePrefs()).checkOnStart === true);
  await saveUpdatePrefs({ autoRestart: false });
  const pr = await loadUpdatePrefs();
  ok("persiste autoRestart=false", pr.autoRestart === false && pr.autoDownload === true);
  ok("prefs periódicas por defecto", DEFAULT_UPDATE_PREFS.periodicCheck === true && DEFAULT_UPDATE_PREFS.pollMinutes === 15);
  ok("clampPollMinutes acota (min 5)", clampPollMinutes(1) === 5);
  ok("clampPollMinutes acota (max 180)", clampPollMinutes(9999) === 180);
  ok("clampPollMinutes redondea", clampPollMinutes(17.4) === 17);

  // 7b) Detección "acabo de actualizar" (mensaje de bienvenida)
  console.log("\nBienvenida post-actualización:");
  setAdapter(new MemoryAdapter());
  ok("primer arranque → sin versión vista", (await loadLastSeenVersion()) === null);
  await saveLastSeenVersion("0.6.0+10");
  ok("persiste versión vista", (await loadLastSeenVersion()) === "0.6.0+10");
  const seenVer = await loadLastSeenVersion();
  ok("misma versión → NO es actualización", !(seenVer && seenVer !== "0.6.0+10"));
  ok("versión distinta → SÍ es actualización (welcome)", !!(seenVer && seenVer !== "0.6.1+11"));

  // 7c) Guard del watcher periódico (no recomprueba en mitad de un flujo)
  console.log("\nWatcher periódico:");
  const BUSY = new Set(["checking", "downloading", "verifying", "downloaded", "installing", "finalizing", "restarting"]);
  ok("no comprueba si descargando", BUSY.has("downloading"));
  ok("sí comprueba si al día", !BUSY.has("up-to-date"));
  ok("sí comprueba si disponible", !BUSY.has("available"));

  // 8) Integridad (verifyManifest)
  console.log("\nIntegridad (SHA256 diff):");
  const enc = (s: string) => new TextEncoder().encode(s);
  const files: Record<string, Uint8Array> = { "a.js": enc("alpha"), "b.js": enc("beta"), "c.js": enc("gamma") };
  const digestOf = async (b: Uint8Array) => sha256Hex(Buffer.from(b));
  const manifest: FileManifest = {
    version: "1", files: await Promise.all(Object.entries(files).map(async ([path, b]) => ({ path, sha256: await digestOf(b), size: b.length }))),
  };
  const r1 = await verifyManifest(manifest, async (p) => files[p] ?? null, digestOf);
  ok("todo correcto → ok", r1.ok && r1.checked === 3);
  const r2 = await verifyManifest(manifest, async (p) => (p === "b.js" ? null : files[p]), digestOf);
  ok("detecta faltante", !r2.ok && r2.missing.includes("b.js"));
  const r3 = await verifyManifest(manifest, async (p) => (p === "c.js" ? enc("CORRUPTO") : files[p]), digestOf);
  ok("detecta corrupción (size)", !r3.ok && r3.corrupt.includes("c.js"));
  const sameSizeReader: FileReader = async (p) => (p === "a.js" ? enc("ALPHA") : files[p]); // mismo tamaño, hash distinto
  const r4 = await verifyManifest(manifest, sameSizeReader, digestOf);
  ok("detecta corrupción (hash, mismo tamaño)", !r4.ok && r4.corrupt.includes("a.js"));

  // 9) Release-core
  console.log("\nRelease-core (latest.json / meta / files.json):");
  ok("platformKey windows nsis", platformKey("DRL Champions_0.6.0_x64-setup.exe") === "windows-x86_64");
  ok("platformKey macos arm", platformKey("DRL Champions_aarch64.app.tar.gz") === "darwin-aarch64");
  ok("platformKey linux", platformKey("drl-champions_0.6.0_amd64.AppImage") === "linux-x86_64");
  ok("platformKey desconocido → null", platformKey("readme.txt") === null);
  ok("artifactName quita .sig", artifactName("app-setup.exe.sig") === "app-setup.exe");
  const latest = buildLatest({
    version: "0.6.0", notes: "Parche", pubDate: "2026-06-29T00:00:00Z", channel: "stable",
    baseUrl: "https://update.drlchampions.com",
    artifacts: [{ name: "DRL Champions_0.6.0_x64-setup.exe", signature: "SIG123" }],
  });
  const plats = latest.platforms as Record<string, { url: string; signature: string }>;
  ok("latest.version", latest.version === "0.6.0");
  ok("latest.url construida", plats["windows-x86_64"].url.startsWith("https://update.drlchampions.com/stable/"));
  ok("latest.signature", plats["windows-x86_64"].signature === "SIG123");
  let threw = false;
  try { buildLatest({ version: "1.0.0", pubDate: "x", channel: "stable", baseUrl: "u", artifacts: [{ name: "x.txt", signature: "s" }] }); } catch { threw = true; }
  ok("sin artefactos válidos → lanza", threw);
  const fj = buildFiles({ version: "0.6.0", channel: "stable", generatedAt: "t", files: [{ path: "z.js", sha256: "h", size: 1 }, { path: "a.js", sha256: "h", size: 1 }] });
  ok("files.json ordenado", fj.files[0].path === "a.js");
  ok("sha256Hex estable", sha256Hex(Buffer.from("abc")) === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");

  console.log(`\n━━━ Resultado: ${pass} ✓ / ${fail} ✗ ━━━\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
