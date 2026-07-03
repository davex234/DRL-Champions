/**
 * CI/REPORT — informe de cada ejecución del Build Cloud. Reúne metadatos del entorno (CI o
 * local), el objeto Release y el estado del pipeline en un report JSON + Markdown que se
 * guarda como artefacto. No publica nada.
 */
import { ensureDir, writeJson, writeText } from "../release/core/fsx.mjs";
import { join } from "node:path";

/** Metadatos del entorno (GitHub Actions o local). */
export function ciEnv(env = process.env) {
  return {
    commit: env.GITHUB_SHA ?? null,
    branch: env.GITHUB_REF_NAME ?? null,
    author: env.GITHUB_ACTOR ?? env.USERNAME ?? env.USER ?? null,
    runId: env.GITHUB_RUN_ID ?? null,
    runner: env.RUNNER_OS ?? process.platform,
    ci: !!env.GITHUB_ACTIONS,
    buildConfiguration: env.BUILD_CONFIGURATION ?? "release",
    updateEndpoint: env.UPDATE_ENDPOINT ?? "https://update.drlchampions.com",
  };
}

export function buildReport({ release, state, env = process.env, tests = null, buildMs = 0, date, publish = null, distribution = null }) {
  const e = ciEnv(env);
  const files = (release?.files ?? []).map((f) => ({ name: f.name, size: f.size, sha256: f.sha256, signed: f.signed }));
  // El estado de publicación (Fase 3) manda sobre el estado vivo del pipeline para el status final.
  const status = publish
    ? (publish.ready ? "READY" : "FAILED")
    : state?.state === "ready" ? "READY" : state?.state === "failed" ? "FAILED" : "INCOMPLETE";
  return {
    title: "DRL Champions — Release Report",
    date: date ?? new Date().toISOString(),
    commit: e.commit,
    branch: e.branch,
    author: e.author,
    ci: e.ci,
    runner: e.runner,
    version: release?.version ?? null,
    build: release?.build ?? null,
    full: release?.full ?? null,
    channel: release?.channel ?? null,
    buildConfiguration: e.buildConfiguration,
    updateEndpoint: e.updateEndpoint,
    buildTimeMs: buildMs,
    tests: tests ?? "n/a",
    artifacts: files,
    hashes: files.map((f) => `${f.sha256 ?? "—"}  ${f.name}`),
    signed: release?.signed ?? false,
    manifests: release?.manifests ?? {},
    pipeline: state ?? null,
    status,
    published: !!publish?.ready,
    // Publicación (Fase 3) — datos para el dashboard de la Fase 4.
    publish: publish
      ? {
          provider: publish.provider,
          destination: publish.destination,
          channel: publish.channel,
          uploadMs: publish.uploadMs ?? null,
          totalBytes: publish.totalBytes ?? null,
          fileCount: publish.files?.length ?? 0,
          rollbackAvailable: publish.rollbackAvailable ?? false,
          rollbackTargets: publish.rollbackTargets ?? [],
          error: publish.error ?? null,
        }
      : null,
    // Distribución (Fase 6) — resumen multi-región para el report/dashboard.
    distribution: distribution
      ? {
          status: distribution.status,
          ready: distribution.ready,
          targets: distribution.analytics?.targets ?? 0,
          succeeded: distribution.analytics?.succeeded ?? 0,
          failed: distribution.analytics?.failed ?? 0,
          retries: distribution.analytics?.retries ?? 0,
          totalMs: distribution.analytics?.totalMs ?? null,
          bytes: distribution.analytics?.bytes ?? 0,
          regions: (distribution.regions ?? []).map((x) => ({ region: x.region, status: x.status, primary: x.primary })),
          missingRequired: distribution.missingRequired ?? [],
          primaryRegion: distribution.cdn?.primaryRegion ?? null,
        }
      : null,
  };
}

export function renderMarkdown(r) {
  const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;
  return [
    `# ${r.title}`,
    "",
    `| Campo | Valor |`,
    `|---|---|`,
    `| Estado | **${r.status}** |`,
    `| Versión | ${r.full ?? "—"} (${r.channel ?? "—"}) |`,
    `| Commit | \`${r.commit ?? "local"}\` |`,
    `| Branch | ${r.branch ?? "—"} |`,
    `| Autor | ${r.author ?? "—"} |`,
    `| Fecha | ${r.date} |`,
    `| Runner | ${r.runner} (${r.ci ? "CI" : "local"}) |`,
    `| Configuración | ${r.buildConfiguration} |`,
    `| Tiempo de build | ${secs(r.buildTimeMs)} |`,
    `| Tests | ${typeof r.tests === "object" ? `${r.tests.passed}/${r.tests.total}` : r.tests} |`,
    `| Firmado | ${r.signed ? "sí" : "no"} |`,
    `| Publicado | ${r.published ? `sí · ${r.publish?.provider} (${r.publish?.channel})` : "no"} |`,
    "",
    `## Artefactos (${r.artifacts.length})`,
    r.artifacts.length ? r.artifacts.map((f) => `- ${f.name} — ${f.size} B — \`${f.sha256 ?? "sin firma"}\``).join("\n") : "_(sin instaladores: build sin bundle firmado)_",
    "",
    `## Manifiestos`,
    `- latest.json: ${r.manifests.hasLatest ? "✓" : "—"} · meta.json: ${r.manifests.hasMeta ? "✓" : "—"} · files.json: ${r.manifests.hasFiles ? "✓" : "—"}`,
    "",
    `## Publicación`,
    r.publish
      ? [
          `- Destino: **${r.publish.provider}** → ${r.publish.destination}`,
          `- Subida: ${secs(r.publish.uploadMs ?? 0)} · ${r.publish.fileCount} ficheros · ${r.publish.totalBytes ?? 0} B`,
          `- Rollback disponible: ${r.publish.rollbackAvailable ? r.publish.rollbackTargets.join(", ") : "—"}`,
          r.publish.error ? `- ⚠ ${r.publish.error}` : "",
        ].filter(Boolean).join("\n")
      : "_(no publicado en esta ejecución)_",
    "",
    `## Pipeline`,
    (r.pipeline?.transitions ?? []).map((t) => `- ${t.state} (+${secs(t.elapsedMs)})`).join("\n") || "—",
    "",
  ].join("\n");
}

export function writeReport(destDir, report) {
  ensureDir(destDir);
  const jsonPath = join(destDir, "release-report.json");
  const mdPath = join(destDir, "RELEASE-REPORT.md");
  writeJson(jsonPath, report);
  writeText(mdPath, renderMarkdown(report));
  return { jsonPath, mdPath };
}

export default { ciEnv, buildReport, renderMarkdown, writeReport };
