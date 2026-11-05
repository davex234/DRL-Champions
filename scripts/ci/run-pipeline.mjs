/**
 * CI/RUN-PIPELINE — orquestador del Build Cloud. REUTILIZA el mismo `ReleasePipeline` que
 * `npm run release` (cero lógica de build duplicada) y, como SIGUIENTE PASO, PUBLICA la release
 * en el destino configurado mediante el sistema de transporte (Fase 3), totalmente desacoplado.
 *
 *   Build/Sign/Manifest (ReleasePipeline) → Publish (Transport) → Verify → Ready
 *
 *   node scripts/ci/run-pipeline.mjs [--no-bundle] [--no-publish] [--channel <c>] [--minor|--major|--none]
 *
 * Entorno: RELEASE_CHANNEL · UPDATE_ENDPOINT · BUILD_CONFIGURATION · GITHUB_* · TAURI_SIGNING_*
 *   Publicación: DRL_PUBLISH_PROVIDER · DRL_PUBLISH_LOCAL_DIR · DRL_PUBLISH_FS_DIR/_URL ·
 *                R2_* · (GITHUB_TOKEN/GITHUB_REPOSITORY). Sin config → provider `local`.
 */
import { join } from "node:path";
import { existsSync } from "node:fs";
import { parseArgs } from "../release/core/args.mjs";
import { writeJson, ensureDir } from "../release/core/fsx.mjs";
import ReleasePipeline from "../release/pipeline.mjs";
import { createPipelineState, fromPipelinePhase, PHASE_LABEL } from "../release/pipeline-state.mjs";
import { publishRelease, buildTargets, distributeRelease } from "../release/transport/index.mjs";
import TransportEngine from "../release/transport/engine.mjs";
import { buildReport, writeReport } from "./report.mjs";

const { has, opt } = parseArgs();
const ROOT = process.cwd();
const channelArg = opt("channel") ?? process.env.RELEASE_CHANNEL ?? null;
const level = has("major") ? "major" : has("minor") ? "minor" : has("none") ? "none" : "patch";
const noBundle = has("no-bundle");
const noPublish = has("no-publish") || process.env.DRL_PUBLISH === "0";
const baseUrl = process.env.UPDATE_ENDPOINT ?? "https://update.drlchampions.com";
const date = opt("date") ?? new Date().toISOString();

const state = createPipelineState();
const t0 = Date.now();
const group = (s) => { console.log(`::group::[state] ${PHASE_LABEL[s] ?? s}`); console.log("::endgroup::"); };
const onState = (name) => group(state.transition(fromPipelinePhase(name)));

console.log("━━━ DRL BUILD CLOUD · run-pipeline (Fase 3/7 · publish) ━━━");

async function main() {
  // 1) BUILD/SIGN/MANIFEST — el mismo ReleasePipeline. Ignoramos su "ready": en el Build Cloud
  //    Ready solo se alcanza tras publicar y verificar.
  const r = await ReleasePipeline.run({
    channel: channelArg, level, noBundle, baseUrl, date,
    force: true, // CI produce una Release en cada ejecución
    onPhase: (name) => { if (name !== "ready") onState(name); },
  });
  const buildMs = Date.now() - t0;
  const channel = r.release?.channel ?? channelArg ?? "stable";
  const dest = ensureDir(join(ROOT, "dist", "update", channel));

  // 2) PUBLISH / DISTRIBUTE — el Provider Manager decide los destinos (1 = publish clásico,
  //    N = distribución multi-región). Reutiliza publishRelease/distributeRelease.
  let publish = null, distribution = null;
  const targets = buildTargets({ env: process.env, root: ROOT });
  const provider = targets[0].provider; // primario (mensajes/addendum)
  const successProviders = [];
  if (noPublish) {
    console.log("ℹ --no-publish: se omite la publicación (solo build + manifiestos).");
  } else if (!r.release) {
    console.log("ℹ Sin objeto Release (build sin cambios/dry): no se publica.");
  } else if (targets.length > 1) {
    console.log(`▶ Distribuyendo a ${targets.length} destinos (${[...new Set(targets.map((t) => t.region))].join(", ")}) · canal '${channel}'…`);
    distribution = await distributeRelease({ release: r.release, stagedDir: dest, channel, targets, onPhase: (name) => onState(name), keep: 3 });
    publish = distribution.primary;
    successProviders.push(...targets.filter((t) => distribution.targets.find((d) => d.id === t.id && d.ok)).map((t) => t.provider));
    if (!distribution.ready) {
      state.fail(`distribución incompleta: faltan regiones requeridas ${distribution.missingRequired.join(", ") || "—"}`);
      const report = buildReport({ release: r.release, state: state.snapshot(), buildMs, date, publish, distribution });
      writeReport(dest, report);
      writeJson(join(dest, "pipeline-state.json"), state.snapshot());
      console.error(`\n❌ Distribución no lista: regiones requeridas pendientes ${distribution.missingRequired.join(", ")}`);
      process.exit(1);
    }
  } else {
    console.log(`▶ Publicando con provider '${provider.name}' · canal '${channel}'…`);
    publish = await publishRelease({ release: r.release, stagedDir: dest, channel, provider, onPhase: (name) => onState(name), keep: 3 });
    if (publish.ready) successProviders.push(provider);
    if (!publish.ready) {
      state.fail(publish.error ?? "publicación no verificada");
      const report = buildReport({ release: r.release, state: state.snapshot(), buildMs, date, publish });
      writeReport(dest, report);
      writeJson(join(dest, "pipeline-state.json"), state.snapshot());
      console.error(`\n❌ Publicación fallida: ${publish.error}`);
      process.exit(1);
    }
  }

  // 3) READY — release publicada y verificada (o build-only si --no-publish).
  state.transition("ready");

  // 4) REPORT + estado (con resultado de publicación/distribución) y subida del addendum.
  const report = buildReport({ release: r.release, state: state.snapshot(), buildMs, date, publish, distribution });
  const { jsonPath, mdPath } = writeReport(dest, report);
  writeJson(join(dest, "pipeline-state.json"), state.snapshot());

  if (publish?.ready) {
    // El report + estado (+ distribution) se generan tras publicar: addendum a cada destino OK.
    const names = ["release-report.json", "RELEASE-REPORT.md", "pipeline-state.json", "publish.json", "distribution.json", "analytics.json"];
    const present = names.filter((n) => existsSync(join(dest, n)));
    for (const p of successProviders) {
      const files = present.map((n) => ({ key: TransportEngine.channelKey(channel, n), path: join(dest, n) }));
      await TransportEngine.upload(p, files);
    }
    console.log(`   addendum subido a ${successProviders.length} destino(s): ${present.join(", ")}`);
  }

  console.log(`\n✅ ${report.status} · ${report.full ?? "—"} (${channel}) en ${(buildMs / 1000).toFixed(1)}s`);
  console.log(`   report: ${mdPath}`);
  if (distribution) {
    console.log(`   distribución: ${distribution.status} · ${distribution.analytics.succeeded}/${distribution.analytics.targets} destinos · regiones: ${distribution.regions.map((x) => `${x.region}:${x.status}`).join(" ")}`);
    if (distribution.missingRequired.length) console.log(`   ⚠ regiones requeridas pendientes: ${distribution.missingRequired.join(", ")}`);
  } else if (publish?.ready) {
    console.log(`   publicado: ${provider.name} → ${publish.destination}`);
    console.log(`   subida: ${(publish.uploadMs / 1000).toFixed(2)}s · ${publish.totalBytes} B · rollback: ${publish.rollbackAvailable ? publish.rollbackTargets.join(",") : "—"}`);
  }
  if (!r.written?.latest) console.log("⚠ Sin latest.json (build sin instalador firmado: usa host con clave de firma).");
  process.exit(0);
}

main().catch((e) => {
  state.fail(e);
  const dest = ensureDir(join(ROOT, "dist", "update", channelArg ?? "stable"));
  const report = buildReport({ release: null, state: state.snapshot(), buildMs: Date.now() - t0, date });
  writeReport(dest, report);
  writeJson(join(dest, "pipeline-state.json"), state.snapshot());
  console.error(`\n❌ Build Cloud falló: ${e.message}`);
  process.exit(1);
});
