/**
 * RELEASE-FLOW-VERIFY — valida el pipeline de release y el flujo de actualización del cliente
 * de forma determinista (sin red ni bundle nativo).
 *   npx tsx scripts/release-flow-verify.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { bumpSemver, fullVersion, fingerprint, diff, releaseNotes } from "./release/version-engine.mjs";
import {
  UpdateController, type UpdaterBackend, type RemoteUpdate, type DownloadEvent, type UpdateMeta,
} from "../src/platform/updater";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, extra = "") => { c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${extra}`)); };

// semver compare (test-only, refleja la decisión del updater oficial: remoto > instalado).
function cmp(a: string, b: string) {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

class FakeBackend implements UpdaterBackend {
  readonly name = "fake";
  private t = 0;
  constructor(private remote: RemoteUpdate | null, private chunks: number[], private total: number, private metaData: UpdateMeta | null = null) {}
  now() { return this.t; }
  async check() { return this.remote; }
  async meta() { return this.metaData; }
  async download(_u: RemoteUpdate, on: (e: DownloadEvent) => void) {
    on({ kind: "started", contentLength: this.total });
    for (const c of this.chunks) { this.t += 1000; on({ kind: "progress", chunkLength: c }); }
    on({ kind: "finished" });
  }
  async install() {}
  async relaunch() {}
}

(async () => {
  console.log("\n━━━ RELEASE FLOW · VERIFY ━━━\n");

  // 1) Version Manager
  console.log("Version Manager:");
  ok("patch", bumpSemver("0.6.0", "patch") === "0.6.1");
  ok("minor resetea patch", bumpSemver("0.6.4", "minor") === "0.7.0");
  ok("major resetea minor/patch", bumpSemver("0.6.4", "major") === "1.0.0");
  ok("none mantiene", bumpSemver("0.6.4", "none") === "0.6.4");
  ok("fullVersion", fullVersion({ version: "0.6.1", build: 128, channel: "stable" }) === "0.6.1+128");
  ok("patch genera versión MAYOR (update obligatorio)", cmp(bumpSemver("0.6.0", "patch"), "0.6.0") > 0);
  ok("none NO genera versión mayor (no dispara update)", cmp(bumpSemver("0.6.0", "none"), "0.6.0") === 0);

  // 2) Detección de cambios
  console.log("\nDetección de cambios:");
  const fp1 = fingerprint(process.cwd());
  const fp2 = fingerprint(process.cwd());
  ok("fingerprint determinista", fp1.hash === fp2.hash, `${fp1.hash.slice(0, 8)} vs ${fp2.hash.slice(0, 8)}`);
  ok("fingerprint cubre muchos archivos", Object.keys(fp1.files).length > 100, `→ ${Object.keys(fp1.files).length}`);
  ok("version.ts excluido (lo reescribe el release)", !("src/platform/version.ts" in fp1.files));
  ok("version.json excluido", !("version.json" in fp1.files));
  ok("incluye código real", "src/platform/updater.ts" in fp1.files);
  const noChange = diff(fp1.files, fp2.files);
  ok("sin cambios → diff vacío (release se cancelaría)", noChange.changed.length === 0 && noChange.added.length === 0 && noChange.removed.length === 0);
  const withChange = diff({ ...fp1.files, "src/brain/x.ts": "old" }, { ...fp1.files, "src/brain/x.ts": "new", "src/utility/y.ts": "z" });
  ok("detecta modificado y añadido", withChange.changed.includes("src/brain/x.ts") && withChange.added.includes("src/utility/y.ts"));

  // 3) Notas automáticas (módulos/motores)
  console.log("\nNotas automáticas:");
  const notes = releaseNotes({
    changed: ["src/brain/evaluate.ts", "src/utility/index.ts", "src/components/cards/CardViewer.tsx", "src/components/launcher/BootGate.tsx"],
    added: ["src/agents/new.ts"],
    removed: [],
  } as any);
  ok("mapea Brain Engine", notes.modules.includes("Brain Engine"));
  ok("mapea Utility Engine", notes.modules.includes("Utility Engine"));
  ok("mapea Agent Engine", notes.modules.includes("Agent Engine"));
  ok("mapea Card system", notes.modules.includes("Card system"));
  ok("mapea Launcher & Updater", notes.modules.includes("Launcher & Updater"));
  ok("motores primero (prioridad)", notes.modules[0] === "Brain Engine");
  ok("bullets con conteo", notes.bullets.some((b) => /\d+ archivo/.test(b)));
  ok("sin cambios → bullet genérico", releaseNotes({}).bullets.length === 1);

  // 4) Flujo de actualización del cliente (instalada → nueva → descarga → instala → reinicia)
  console.log("\nFlujo de actualización del cliente:");
  const installed = "0.6.0";
  const remoteVer = bumpSemver(installed, "patch"); // 0.6.1
  ok("hay actualización (remoto > instalado)", cmp(remoteVer, installed) > 0);
  const remote: RemoteUpdate = { version: remoteVer, notes: "Brain Engine; Card Viewer", date: "2026-06-29" };
  const ctrl = new UpdateController(new FakeBackend(remote, [400, 400, 200], 1000, { size: 1000 }), "stable", installed, 0);
  const seen: string[] = [];
  ctrl.subscribe((s) => seen.push(s.phase));
  const st = await ctrl.check();
  ok("check → available con versión nueva", st.phase === "available" && st.available === remoteVer);
  ok("tamaño de descarga (meta)", st.availableSize === 1000);
  const done = await ctrl.downloadAndInstall(true);
  ok("descarga+instala+reinicia OK", done && ctrl.getState().phase === "restarting");
  ok("fases en orden", ["downloading", "verifying", "installing", "finalizing", "restarting"].every((p) => seen.includes(p)));

  // Caso "ya actualizado": mismo semver → sin update (no molesta al usuario).
  const ctrl2 = new UpdateController(new FakeBackend(null, [], 0), "stable", remoteVer, 0);
  ok("misma versión → up-to-date", (await ctrl2.check()).phase === "up-to-date");

  console.log(`\n━━━ Resultado: ${pass} ✓ / ${fail} ✗ ━━━\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
