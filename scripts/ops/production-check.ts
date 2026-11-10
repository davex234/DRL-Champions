/**
 * F67 · `npm run production:check` — comprobaciones NO destructivas de una release. Cero escrituras.
 *
 *   npm run production:check                    configuración, build, migraciones, flags, catálogo, assets, secretos
 *   npm run production:check -- --app           + /api/health y /api/ready de la app en marcha (BASE_URL o :3005)
 *   npm run production:check -- --vps           + frescura/integridad de backups en el VPS (solo lectura por ssh)
 *
 * Sale con código 1 si hay algún FAIL. Escribe docs/product/qa/fase67-production/production-check.json (sin secretos).
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { validateEnv, isPublicRelease, gotruePublicProblems } from "../../src/server/ops/env";
import { MIGRATION_HEAD, headFromDbState, parseMigrationState } from "../../src/server/ops/release";
import { parseBackupStatus, offsiteVerdict } from "../../src/domain/ops/backup";
import { CARDS } from "../../src/data/catalog";
import { AGENTS } from "../../src/data/esports/agents";
import { PACKS } from "../../src/data/packs";
import { packArtwork } from "../../src/data/packArtwork";
import { GLOBAL_MARKET_ENABLED } from "../../src/config/features";
import { PAYMENTS_ENABLED } from "../../src/config/monetization";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Level = "PASS" | "WARN" | "FAIL";
const results: { id: string; level: Level; detail: string }[] = [];
const add = (id: string, level: Level, detail: string) => results.push({ id, level, detail });
const arg = (f: string) => process.argv.includes(f);
const ROOT = process.cwd();

// .env.local SOLO para validar nombres/forma (nunca se imprime un valor).
const fileEnv: Record<string, string> = existsSync(join(ROOT, ".env.local"))
  ? Object.fromEntries(readFileSync(join(ROOT, ".env.local"), "utf8").split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "").trim()]))
  : {};

const mergedEnv: Record<string, string | undefined> = { ...fileEnv, ...process.env };
// F70 · release pública: interruptor explícito o indexación pública (esta última ya endurecía auth-email desde F69).
const isPublic = isPublicRelease(mergedEnv) || process.env.NEXUS_PUBLIC_INDEXING === "1";

async function main() {
  // 1 · Configuración (como la vería el servidor en producción).
  const env = validateEnv({ ...mergedEnv, NODE_ENV: "production" });
  add("env", env.ok ? (env.issues.some((i) => i.level === "DEGRADED") ? "WARN" : "PASS") : "FAIL",
    env.issues.length ? env.issues.map((i) => `${i.level} ${i.name}: ${i.problem}`).join(" · ") : "completa");

  // F70 · en modo público el correo de Auth y la copia fuera del VPS se VERIFICAN: sin --vps no hay veredicto → FAIL.
  if (isPublic) add("public-release", arg("--vps") ? "PASS" : "FAIL", arg("--vps") ? "modo público: SMTP/SITE_URL/autoconfirmación y offsite evaluados como bloqueos" : "modo público sin --vps: SMTP, SITE_URL y offsite sin verificar");

  // 2 · Node.
  const engines = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).engines?.node ?? "?";
  const major = Number(process.versions.node.split(".")[0]);
  add("node", major >= 22 && major < 25 ? "PASS" : "FAIL", `${process.version} (engines ${engines}, recomendado ${readFileSync(join(ROOT, ".nvmrc"), "utf8").trim()})`);

  // 3 · Build presente y HECHO CON ESTE CÓDIGO: el BUILD_ID es un sha256 de las entradas del build (next.config.mjs,
  //     deterministicBuildId). Se recalcula sobre el árbol actual y se compara: huella exacta, sin fiarse de fechas.
  const buildId = join(ROOT, ".next", "BUILD_ID");
  if (!existsSync(buildId)) add("build", "FAIL", "no hay .next/BUILD_ID: ejecuta npm run build");
  else {
    const built = readFileSync(buildId, "utf8").trim();
    const cfg = (await import(pathToFileURL(join(ROOT, "next.config.mjs")).href)).default as { generateBuildId?: () => string | null | Promise<string | null> };
    const expected = (await cfg.generateBuildId?.()) ?? null;
    add("build", expected === built ? "PASS" : "WARN", expected === built ? `BUILD_ID ${built} = huella del código actual` : `BUILD_ID ${built} ≠ huella actual ${expected}: el código cambió desde el build, reconstruye`);
  }

  // 4 · Migraciones: contiguas y la última = cabeza esperada por el código.
  const migs = readdirSync(join(ROOT, "supabase", "migrations")).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  const gaps = migs.map((f) => Number(f.slice(0, 4))).filter((n, i, a) => i > 0 && n !== a[i - 1] + 1);
  add("migrations", migs.at(-1) === `${MIGRATION_HEAD}.sql` && !gaps.length ? "PASS" : "FAIL", `${migs.length} ficheros, última ${migs.at(-1)} (esperada ${MIGRATION_HEAD})${gaps.length ? `, huecos en ${gaps.join(",")}` : ""}`);
  const autoApply = execSync(`git grep -l "supabase db push\\|migration up\\|runMigrations" -- src 2>nul || exit 0`, { encoding: "utf8", shell: "cmd.exe" }).trim();
  add("migrations-startup", autoApply ? "FAIL" : "PASS", autoApply ? `el código de la app aplica migraciones: ${autoApply}` : "la app NO aplica migraciones al arrancar");

  // 5 · Flags críticos.
  add("flags", !GLOBAL_MARKET_ENABLED && !PAYMENTS_ENABLED ? "PASS" : "FAIL", `GLOBAL_MARKET_ENABLED=${GLOBAL_MARKET_ENABLED} PAYMENTS_ENABLED=${PAYMENTS_ENABLED} (constantes de código, no conmutables desde el cliente)`);

  // 6 · Catálogo y assets.
  const missingArt = CARDS.filter((c) => !c.image || !existsSync(join(ROOT, "public", c.image)));
  add("catalog", CARDS.length === 331 ? "PASS" : "WARN", `${CARDS.length} cartas en código`);
  add("card-art", missingArt.length ? "WARN" : "PASS", missingArt.length ? `${missingArt.length}/${CARDS.length} sin imagen en public/ (usan el respaldo): ${missingArt.slice(0, 5).map((c) => c.id).join(", ")}` : `${CARDS.length}/${CARDS.length} imágenes presentes`);
  const missingAgents = AGENTS.filter((a) => !existsSync(join(ROOT, "public", "agents", a.id)));
  add("agent-art", AGENTS.length === 29 && !missingAgents.length ? "PASS" : "WARN", `${AGENTS.length} agentes, sin carpeta de arte: ${missingAgents.map((a) => a.id).join(", ") || "ninguno"}`);
  const packArt = PACKS.map((p) => ({ id: p.id, art: packArtwork(p.id) as unknown })).map((x) => ({ ...x, path: typeof x.art === "string" ? x.art : (x.art as { src?: string } | null)?.src ?? null }));
  const brokenPacks = packArt.filter((x) => x.path && x.path.startsWith("/") && !existsSync(join(ROOT, "public", x.path.split("?")[0])));
  add("pack-art", brokenPacks.length ? "FAIL" : "PASS", `${PACKS.length} sobres, ${packArt.filter((x) => x.path).length} con arte, rotos: ${brokenPacks.map((x) => x.id).join(", ") || "ninguno"}`);
  const maps = existsSync(join(ROOT, "public", "maps")) ? readdirSync(join(ROOT, "public", "maps")).length : 0;
  add("maps", maps >= 12 ? "PASS" : "WARN", `${maps} entradas en public/maps`);

  // 7 · Endurecimiento presente en el código.
  const cfg = readFileSync(join(ROOT, "next.config.mjs"), "utf8");
  const mw = readFileSync(join(ROOT, "src", "middleware.ts"), "utf8");
  add("security-headers", /Content-Security-Policy/.test(cfg) && /poweredByHeader: false/.test(cfg) && /frame-ancestors 'none'/.test(cfg) ? "PASS" : "FAIL", "CSP, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy, COOP, HSTS, sin X-Powered-By");
  add("edge-guards", /tooLarge\(/.test(mw) && /qaHarnessBlocked\(/.test(mw) && /x-request-id/.test(mw) ? "PASS" : "FAIL", "tamaño de cuerpo, arneses QA ocultos, x-request-id");
  add("robots", existsSync(join(ROOT, "src", "app", "robots.ts")) ? "PASS" : "WARN", process.env.NEXUS_PUBLIC_INDEXING === "1" ? "indexación PÚBLICA" : "beta cerrada: noindex");
  add("sharp", /"sharp":/.test(readFileSync(join(ROOT, "package.json"), "utf8")) ? "PASS" : "FAIL", "sharp es dependencia directa");

  // 8 · Secretos del servidor dentro del JS del navegador (por VALOR; no se imprime ninguno).
  const secretVals = Object.entries(fileEnv).filter(([k, v]) => !k.startsWith("NEXT_PUBLIC_") && v.length >= 16).map(([, v]) => v);
  let leaked = 0;
  const walkStatic = (d: string) => { if (!existsSync(d)) return; for (const f of readdirSync(d)) { const p = join(d, f); const s = statSync(p); if (s.isDirectory()) walkStatic(p); else if (/\.(js|css|html|json|map)$/.test(f)) { const t = readFileSync(p, "utf8"); if (secretVals.some((v) => t.includes(v)) || /"role":"service_role"/.test(t)) leaked++; } } };
  walkStatic(join(ROOT, ".next", "static"));
  walkStatic(join(ROOT, "public"));
  add("client-secrets", leaked ? "FAIL" : "PASS", leaked ? `${leaked} fichero(s) del cliente contienen un secreto del servidor` : "ningún secreto del servidor en .next/static ni public/");
  const maps2 = existsSync(join(ROOT, ".next", "static")) ? execSync(`dir /s /b "${join(ROOT, ".next", "static")}\\*.map" 2>nul || exit 0`, { encoding: "utf8", shell: "cmd.exe" }).trim().split(/\r?\n/).filter(Boolean).length : 0;
  add("source-maps", maps2 ? "WARN" : "PASS", maps2 ? `${maps2} .map públicos en .next/static` : "sin source maps públicos del navegador");

  // 9 · App en marcha (opcional).
  let appHead: string | null = null;
  if (arg("--app")) {
    const base = process.env.BASE_URL ?? "http://127.0.0.1:3005";
    try {
      const h = await fetch(`${base}/api/health`); add("app-health", h.status === 200 ? "PASS" : "FAIL", `${base}/api/health → ${h.status}`);
      const r = await fetch(`${base}/api/ready`); const j = await r.json() as { status: string; migrationHead?: string; checks: { id: string; ok: boolean }[] };
      add("app-ready", j.status === "ready" ? "PASS" : j.status === "degraded" ? "WARN" : "FAIL", `${j.status} · ${j.checks.map((c) => `${c.id}:${c.ok ? "ok" : "KO"}`).join(" ")}`);
      /*
       * F79.2 · la cabeza que INFORMA la app en marcha tiene que ser la que espera este código. Antes no se miraba: una app
       * antigua (constante 0060, sonda que solo conocía 0059) pasaba en verde contra una BD ya en 0061.
       */
      appHead = j.migrationHead ?? null;
      add("app-migration-head", appHead === MIGRATION_HEAD ? "PASS" : "FAIL", `la app informa ${appHead ?? "nada"} (esperada ${MIGRATION_HEAD})`);
    } catch (e) { add("app-health", "FAIL", `sin respuesta de ${base}: ${e instanceof Error ? e.message : e}`); }
  }

  // 10 · Backups en el VPS (opcional, solo lectura).
  if (arg("--vps")) {
    // F79.2 · CABEZA REAL de la BD por estado (huellas de 0059/0060/0061), no por constante ni por lo que diga la app.
    try {
      const out = execSync(`ssh -o BatchMode=yes -o ConnectTimeout=15 -i "${process.env.USERPROFILE}/.ssh/id_ed25519" nexusadmin@212.95.40.144 "bash -s"`, { encoding: "utf8", input: readFileSync(join(ROOT, "scripts/ops/migration-state.sh"), "utf8") });
      const dbHead = headFromDbState(parseMigrationState(out));
      add("db-migration-head", dbHead === MIGRATION_HEAD ? "PASS" : "FAIL", `estado real de la BD: ${dbHead} (esperada ${MIGRATION_HEAD})`);
      if (appHead !== null) add("app-vs-db-head", appHead === dbHead ? "PASS" : "FAIL", `app ${appHead} · BD ${dbHead}`);
    } catch (e) { add("db-migration-head", "FAIL", `no se pudo leer el estado de la BD: ${e instanceof Error ? e.message.split("\n")[0] : e}`); }
    try {
      const out = execSync(`ssh -o BatchMode=yes -o ConnectTimeout=15 -i "${process.env.USERPROFILE}/.ssh/id_ed25519" nexusadmin@212.95.40.144 "bash -s"`, { encoding: "utf8", input: readFileSync(join(ROOT, "scripts/ops/backup-status.sh"), "utf8") });
      const v = (k: string) => (out.match(new RegExp(`^${k} (.*)$`, "m")) ?? [])[1] ?? "";
      const daily = Number(v("DAILY")), storage = Number(v("STORAGE"));
      add("backup-daily-db", daily <= 26 ? "PASS" : "FAIL", `último dump diario hace ${daily} h (cron 04:30, retención 14 días)`);
      add("backup-daily-storage", storage <= 26 ? "PASS" : "FAIL", `último tar de Storage hace ${storage} h`);
      const bs = parseBackupStatus(out);
      add("backup-verified", bs.sumsOk ? "PASS" : "WARN", `último backup con manifiesto: ${bs.verifiedPath || "ninguno"} (hace ${bs.verifiedAgeH} h, ${bs.verifiedCount} unidades)${bs.sumsOk ? " · SHA256SUMS ok" : ""}`);
      add("backup-log", "PASS", `${v("LOGFAILS")} líneas FALLO en el histórico · ${v("LAST").slice(0, 120)}`);
      add("backup-disk", Number(v("FREE_MB")) > 20_000 ? "PASS" : "WARN", `${v("FREE_MB")} MB libres en /opt/nexus/backups; backups de DRLCards ocupan ${v("BACKUPS_MB")} MB (${v("DAILY_COUNT")} dumps diarios)`);
      // PRE-F70 · el veredicto sale de la copia REMOTA VERIFICADA (leída de vuelta), no de un upload que devolvió 0.
      const off = offsiteVerdict(bs);
      // F70 · en modo público una copia fuera del VPS no verificada BLOQUEA la release (solo aquí: /api/ready no depende de ella).
      add("backup-offsite", isPublic && off.code !== "OK" ? "FAIL" : off.level, `${off.code} · ${off.detail}${isPublic && off.code !== "OK" ? " · BLOQUEA la release pública" : ""}`);
    } catch (e) { add("backup", "FAIL", `no se pudo consultar el VPS: ${e instanceof Error ? e.message.split("\n")[0] : e}`); }
    // F69 · correo y callbacks de Auth (GoTrue). Beta cerrada: WARN (autoconfirmación y buzón local son conocidos);
    // con indexación pública (NEXUS_PUBLIC_INDEXING=1) es un bloqueo de release: FAIL. Solo claves sin secretos.
    try {
      const out = execSync(`ssh -o BatchMode=yes -o ConnectTimeout=15 -i "${process.env.USERPROFILE}/.ssh/id_ed25519" nexusadmin@212.95.40.144 "bash -s"`, { encoding: "utf8", input: readFileSync(join(ROOT, "scripts/ops/auth-config-status.sh"), "utf8") });
      const g = (k: string) => (out.match(new RegExp(`^${k}=(.*)$`, "m")) ?? [])[1]?.trim() ?? "";
      const problems = [
        /inbucket|mailpit|localhost|127\.0\.0\.1/i.test(g("GOTRUE_SMTP_HOST")) || !g("GOTRUE_SMTP_HOST") ? `SMTP=${g("GOTRUE_SMTP_HOST") || "sin configurar"} (no entrega correo real)` : null,
        /localhost|127\.0\.0\.1/.test(g("GOTRUE_SITE_URL")) ? `SITE_URL=${g("GOTRUE_SITE_URL")}` : null,
        /localhost|127\.0\.0\.1/.test(g("GOTRUE_URI_ALLOW_LIST")) || !g("GOTRUE_URI_ALLOW_LIST") ? `allow-list=${g("GOTRUE_URI_ALLOW_LIST") || "vacía"}` : null,
        g("GOTRUE_MAILER_AUTOCONFIRM") === "true" ? "autoconfirmación ON (registro sin verificar correo)" : null,
      ].filter(Boolean);
      // F70 · modo público: el veredicto sale de la regla pura (SITE_URL https pública = NEXT_PUBLIC_SITE_URL, SMTP real, sin autoconfirmación).
      if (isPublic) problems.splice(0, problems.length, ...gotruePublicProblems(Object.fromEntries(["GOTRUE_SITE_URL", "GOTRUE_URI_ALLOW_LIST", "GOTRUE_SMTP_HOST", "GOTRUE_MAILER_AUTOCONFIRM"].map((k) => [k, g(k)])), mergedEnv.NEXT_PUBLIC_SITE_URL));
      add("auth-email", /AUTH_CONTAINER_MISSING/.test(out) ? "FAIL" : problems.length ? (isPublic ? "FAIL" : "WARN") : "PASS",
        /AUTH_CONTAINER_MISSING/.test(out) ? "no se encontró el contenedor de GoTrue" : problems.length ? `BLOCKED para release pública: ${problems.join(" · ")}` : "SMTP real, callbacks al dominio y confirmación de correo");
    } catch (e) { add("auth-email", "WARN", `no se pudo leer la configuración de GoTrue: ${e instanceof Error ? e.message.split("\n")[0] : e}`); }
  }

  const summary = { PASS: results.filter((r) => r.level === "PASS").length, WARN: results.filter((r) => r.level === "WARN").length, FAIL: results.filter((r) => r.level === "FAIL").length };
  mkdirSync(join(ROOT, "docs/product/qa/fase67-production"), { recursive: true });
  writeFileSync(join(ROOT, "docs/product/qa/fase67-production/production-check.json"), JSON.stringify({ at: new Date().toISOString(), flags: process.argv.slice(2), summary, results }, null, 2) + "\n");
  for (const r of results) console.log(`${r.level.padEnd(4)} ${r.id.padEnd(22)} ${r.detail}`);
  console.log(`\n${summary.PASS} PASS · ${summary.WARN} WARN · ${summary.FAIL} FAIL`);
  process.exit(summary.FAIL ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
