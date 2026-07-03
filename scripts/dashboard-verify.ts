/**
 * DASHBOARD-VERIFY — valida el Release Dashboard (Fase 4/7) SIN servidor: monta un `dist/`
 * sintético con los JSON reales de las fases 1-3 y comprueba que el reader agrega correctamente
 * lectura de JSON · estadísticas · filtros · historial · providers · health · artefactos · hashes
 * · pipeline · releases. El estado de providers usa el Transport Engine REAL del repo.
 *
 *   npx tsx scripts/dashboard-verify.ts   (o: npm run dashboard:verify)
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDashboard, resolveArtifact, listArtifacts } from "../src/server/releases/reader";
import type { ReleaseEntry } from "../src/server/releases/types";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, extra = "") => { c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${extra}`)); };

const ROOT = process.cwd();
const TMP = mkdtempSync(join(tmpdir(), "drl-dash-"));
const w = (p: string, obj: unknown) => { mkdirSync(join(TMP, p, ".."), { recursive: true }); writeFileSync(join(TMP, p), typeof obj === "string" ? obj : JSON.stringify(obj, null, 2)); };

function buildFixture() {
  // ── canal STABLE: release vigente 1.0.3+3 + anillo (1.0.2+2, 1.0.1+1) ──
  const files = [
    { name: "files.json", size: 100, sha256: "hashfiles3" },
    { name: "DRLChampionsSetup.exe", size: 5000, sha256: "hashexe3", url: "file:///pub/stable/DRLChampionsSetup.exe" },
  ];
  w("dist/update/stable/publish.json", {
    id: "stable-1.0.3+3", full: "1.0.3+3", version: "1.0.3", build: 3, channel: "stable",
    date: "2026-06-30T03:00:00.000Z", provider: "local", destination: "file:///pub/stable/latest.json",
    signed: true, status: "published", ready: true, error: null, uploadMs: 12, totalBytes: 5100,
    files: files.map((f) => ({ name: f.name, size: f.size, sha256: f.sha256, url: (f as { url?: string }).url ?? null, ms: 1 })),
    verify: { ok: true, checked: 2, mismatches: [], missing: [] },
    rollbackAvailable: true, rollbackTargets: ["1.0.2+2", "1.0.1+1"], history: { current: "1.0.3+3", count: 3 },
  });
  w("dist/update/stable/release.json", {
    id: "stable-1.0.3+3", version: "1.0.3", build: 3, full: "1.0.3+3", channel: "stable",
    date: "2026-06-30T03:00:00.000Z", commit: "abc1234", hash: "fp", notes: "Notas de prueba\n• Launcher", baseUrl: "https://update.drlchampions.com",
    files: [{ name: "DRLChampionsSetup.exe", size: 5000, sha256: "hashexe3", signed: true, kind: "installer" }],
    manifests: { hasLatest: true, hasMeta: true, hasFiles: true }, signed: true, ready: true,
  });
  w("dist/update/stable/release-report.json", {
    commit: "abc1234", branch: "main", author: "david", buildTimeMs: 25000, status: "READY", published: true,
  });
  w("dist/update/stable/pipeline-state.json", {
    state: "ready", label: "Ready", error: null, startedAt: 1000, finishedAt: 26000, durationMs: 25000,
    transitions: ["queued", "running", "building", "signing", "manifests", "uploading", "verifying", "published", "ready"]
      .map((s, i) => ({ state: s, at: 1000 + i * 100, elapsedMs: i * 100 })),
  });
  w("dist/update/stable/files.json", { version: "1.0.3", channel: "stable", files: [] });
  w("dist/update/stable/meta.json", { version: "1.0.3", build: 3 });
  w("dist/update/stable/latest.json", { version: "1.0.3", platforms: {} });
  w("dist/update/stable/RELEASE-REPORT.md", "# DRL Champions — Release Report\n\nREADY\n");
  w("dist/update/stable/DRLChampionsSetup.exe", "MZ-fake");

  const ring = (full: string, v: string, b: number, date: string) => ({
    full, version: v, build: b, date, signed: true, uploadMs: 10 + b,
    files: [{ name: "files.json", sha256: `hf${b}`, size: 100 }, { name: "DRLChampionsSetup.exe", sha256: `he${b}`, size: 5000 }],
  });
  w("dist/published/stable/releases/history.json", {
    channel: "stable", current: "1.0.3+3",
    releases: [ring("1.0.3+3", "1.0.3", 3, "2026-06-30T03:00:00.000Z"), ring("1.0.2+2", "1.0.2", 2, "2026-06-30T02:00:00.000Z"), ring("1.0.1+1", "1.0.1", 1, "2026-06-30T01:00:00.000Z")],
  });

  // ── canal BETA: release vigente fallida (sin publicar) ──
  w("dist/update/beta/publish.json", {
    id: "beta-2.0.0+9", full: "2.0.0+9", version: "2.0.0", build: 9, channel: "beta",
    date: "2026-06-30T04:00:00.000Z", provider: "local", destination: "file:///pub/beta/latest.json",
    signed: false, status: "failed", ready: false, error: "verificación: faltan 1", uploadMs: 5, totalBytes: 100,
    files: [{ name: "files.json", size: 100, sha256: "betafiles", url: null, ms: 1 }],
    verify: { ok: false, checked: 1, mismatches: [], missing: ["beta/latest.json"] },
    rollbackAvailable: false, rollbackTargets: [],
  });
  w("dist/update/beta/release.json", {
    id: "beta-2.0.0+9", version: "2.0.0", build: 9, full: "2.0.0+9", channel: "beta", date: "2026-06-30T04:00:00.000Z",
    commit: "def5678", notes: "beta", baseUrl: "https://u", files: [], manifests: { hasLatest: false, hasMeta: true, hasFiles: true }, signed: false, ready: false,
  });
  w("dist/update/beta/files.json", { version: "2.0.0", channel: "beta", files: [] });
  w("dist/update/beta/DRLChampionsSetup.exe", "x"); // por si acaso, no firmado igualmente
}

(async () => {
  console.log("\n━━━ RELEASE DASHBOARD · VERIFY (Fase 4/7) ━━━\n");
  buildFixture();
  const data = await readDashboard({ root: TMP, scriptsRoot: ROOT, env: { ...process.env, DRL_PUBLISH_LOCAL_DIR: join(TMP, "dist", "published") }, now: () => "2026-06-30T05:00:00.000Z" });

  // ── 1. Lectura de JSON + canales ──
  console.log("Lectura de JSON / canales:");
  ok("descubre 2 canales (beta, stable)", JSON.stringify(data.channels) === JSON.stringify(["beta", "stable"]), JSON.stringify(data.channels));
  ok("hasData", data.hasData === true);
  ok("generatedAt determinista (inyectable)", data.generatedAt === "2026-06-30T05:00:00.000Z");

  // ── 2. Releases (vigente + historial) ──
  console.log("\nReleases (vigente + historial):");
  const stable = data.releases.filter((r) => r.channel === "stable");
  ok("stable: 3 releases (vigente + 2 del anillo)", stable.length === 3, String(stable.length));
  ok("vigente marcada isCurrent", stable.filter((r) => r.isCurrent).length === 1);
  ok("vigente = 1.0.3+3", stable.find((r) => r.isCurrent)?.full === "1.0.3+3");
  ok("historial NO duplica la vigente", !stable.filter((r) => !r.isCurrent).some((r) => r.full === "1.0.3+3"));
  ok("historial trae 1.0.2 y 1.0.1", ["1.0.2+2", "1.0.1+1"].every((f) => stable.some((r) => r.full === f)));
  ok("orden global newest-first", data.releases[0].date! >= data.releases[data.releases.length - 1].date!);

  // ── 3. Estadísticas ──
  console.log("\nEstadísticas:");
  ok("releases totales = 4 (3 stable + 1 beta)", data.stats.releases === 4, String(data.stats.releases));
  ok("publicadas = 3 (anillo+vigente stable)", data.stats.published === 3, String(data.stats.published));
  ok("fallidas/errores = 1 (beta)", data.stats.failed === 1 && data.stats.errors === 1);
  ok("rollbackReady ≥ 1", data.stats.rollbackReady >= 1);
  ok("canales = 2", data.stats.channels === 2);
  ok("provider activo = local", data.stats.activeProvider === "local");
  ok("tamaño medio calculado", data.stats.avgBytes != null && data.stats.avgBytes > 0);
  ok("tiempo medio build calculado", data.stats.avgBuildMs === 25000);

  // ── 4. Filtros (misma lógica que la UI) ──
  console.log("\nFiltros:");
  const filt = (rs: ReleaseEntry[], f: (r: ReleaseEntry) => boolean) => rs.filter(f);
  ok("por canal beta → 1", filt(data.releases, (r) => r.channel === "beta").length === 1);
  ok("por estado failed → 1", filt(data.releases, (r) => r.status === "failed").length === 1);
  ok("por estado published → 3", filt(data.releases, (r) => r.status === "published").length === 3);
  ok("por provider local → vigentes (2)", filt(data.releases, (r) => r.provider === "local").length === 2);
  ok("búsqueda por commit", filt(data.releases, (r) => (r.commit ?? "").includes("abc1234")).length === 1);

  // ── 5. Artefactos + hashes ──
  console.log("\nArtefactos + hashes:");
  const cur = stable.find((r) => r.isCurrent)!;
  ok("vigente lista artefactos del directorio", cur.files.length >= 5 && cur.files.some((f) => f.name === "DRLChampionsSetup.exe"));
  ok("hash del exe tomado de publish.json", cur.files.find((f) => f.name === "DRLChampionsSetup.exe")?.sha256 === "hashexe3");
  ok("url pública del exe presente", cur.files.find((f) => f.name === "DRLChampionsSetup.exe")?.url === "file:///pub/stable/DRLChampionsSetup.exe");
  ok("artefactos del anillo con hash", stable.find((r) => r.full === "1.0.2+2")!.files.every((f) => !!f.sha256));
  ok("listArtifacts lee tamaños", listArtifacts(join(TMP, "dist", "update", "stable")).some((a) => a.name === "files.json" && a.size > 0));

  // ── 6. Pipeline ──
  console.log("\nPipeline:");
  ok("pipeline vigente presente", !!data.pipeline);
  ok("estado = ready", data.pipeline?.state === "ready");
  ok("incluye fases de publicación", ["uploading", "verifying", "published", "ready"].every((s) => data.pipeline!.transitions.some((t) => t.state === s)));

  // ── 7. Providers (Transport Engine real) ──
  console.log("\nProviders (Transport Engine):");
  const prov = (n: string) => data.providers.find((p) => p.name === n);
  ok("4 providers (local/filesystem/github/r2)", ["local", "filesystem", "github", "r2"].every((n) => !!prov(n)));
  ok("local configurado + healthy", prov("local")!.configured && prov("local")!.healthy);
  ok("local marcado activo", prov("local")!.active);
  ok("local con latencia medida", prov("local")!.latencyMs != null);
  ok("r2 NO configurado (sin secrets)", prov("r2")!.configured === false);
  ok("github NO configurado", prov("github")!.configured === false);
  ok("local última publicación = vigente", prov("local")!.lastPublish?.full === "1.0.3+3");

  // ── 8. Health ──
  console.log("\nDashboard Health:");
  const h = (k: string) => data.health.find((x) => x.key === k);
  ok("incluye todos los componentes", ["release-system", "build-cloud", "publish-cloud", "updater", "transport", "storage", "local", "filesystem", "github", "r2"].every((k) => !!h(k)));
  ok("build-cloud verde (pipeline ready)", h("build-cloud")!.level === "green");
  ok("publish-cloud amarillo (publicada + canal fallido)", h("publish-cloud")!.level === "yellow", h("publish-cloud")!.level);
  ok("transport verde (provider activo healthy)", h("transport")!.level === "green");
  ok("r2 off (no configurado)", h("r2")!.level === "off");

  // ── 9. Seguridad de descarga ──
  console.log("\nDescarga de artefactos:");
  ok("resolveArtifact encuentra fichero real", resolveArtifact(TMP, "stable", "files.json") != null);
  ok("resolveArtifact rechaza traversal", resolveArtifact(TMP, "stable", "../../secret") === null);
  ok("resolveArtifact rechaza canal con barra", resolveArtifact(TMP, "../etc", "files.json") === null);

  console.log(`\n━━━ Resultado: ${pass} ✓ / ${fail} ✗ ━━━\n`);
  rmSync(TMP, { recursive: true, force: true });
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { rmSync(TMP, { recursive: true, force: true }); console.error(e); process.exit(1); });
