/**
 * F70 · `npx tsx scripts/ops/release-manifest.ts` — manifiesto de la Release Candidate. Cero escrituras en BD, sin red,
 * sin secretos: solo NOMBRES de variables (de .env.example, la plantilla canónica), versiones, recuentos y huellas.
 *
 * Huella del código: sha256 de (ruta + sha256 del contenido) de cada fichero del conjunto de release
 * (`docs/product/qa/fase70-rc/release-source.json → include`), en orden. Mismo árbol → misma huella.
 * Escribe docs/product/qa/fase70-rc/release-manifest.json.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { MIGRATION_HEAD, EXPECTED_SCHEMA_KEYS } from "../../src/server/ops/release";
import { PUBLIC_RELEASE_FLAG } from "../../src/server/ops/env";
import { CARDS } from "../../src/data/catalog";
import { AGENTS } from "../../src/data/esports/agents";
import { PACKS } from "../../src/data/packs";
import { GLOBAL_MARKET_ENABLED } from "../../src/config/features";
import { PAYMENTS_ENABLED } from "../../src/config/monetization";

const ROOT = process.cwd();
const OUT = join(ROOT, "docs/product/qa/fase70-rc");
const pkgVersion = (name: string): string => {
  try { return JSON.parse(readFileSync(join(ROOT, "node_modules", name, "package.json"), "utf8")).version; } catch { return "?"; }
};
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const buildIdPath = join(ROOT, ".next", "BUILD_ID");
const envNames = existsSync(join(ROOT, ".env.example"))
  ? [...new Set(readFileSync(join(ROOT, ".env.example"), "utf8").split(/\r?\n/).map((l) => l.replace(/^#\s*/, "")).filter((l) => /^[A-Z][A-Z0-9_]+=/.test(l)).map((l) => l.slice(0, l.indexOf("="))))]
  : [];

let fingerprint: { files: number; bytes: number; sha256: string; missing: number } | string = "release-source.json ausente";
const rsPath = join(OUT, "release-source.json");
if (existsSync(rsPath)) {
  const rs = JSON.parse(readFileSync(rsPath, "utf8"));
  const raw: unknown = rs.include ?? rs.includeFiles ?? rs.files;
  const list: string[] = Array.isArray(raw) ? raw.map((x) => (typeof x === "string" ? x : x.path)).filter(Boolean)
    : raw && typeof raw === "object" ? Object.values(raw as Record<string, unknown>).flatMap((g) => (Array.isArray(g) ? g : (g as { files?: string[] }).files ?? [])).map((x) => (typeof x === "string" ? x : (x as { path: string }).path))
    : [];
  const h = createHash("sha256"); let bytes = 0; let missing = 0;
  for (const p of [...new Set(list)].sort()) {
    const f = join(ROOT, p);
    if (!existsSync(f) || !statSync(f).isFile()) { missing++; continue; }
    const b = readFileSync(f); bytes += b.length; h.update(`${p}\0${sha(b)}\n`);
  }
  fingerprint = { files: list.length - missing, bytes, sha256: h.digest("hex"), missing };
}

(async () => {
// Huella que DEBE tener el build de la RC (misma función que usa `next build` y production:check).
const cfg = (await import(pathToFileURL(join(ROOT, "next.config.mjs")).href)).default as { generateBuildId?: () => string | null | Promise<string | null> };
const expectedBuildId = (await cfg.generateBuildId?.()) ?? null;

const manifest = {
  kind: "drlcards-release-manifest",
  generatedAt: new Date().toISOString(),
  version: pkg.version,
  buildId: existsSync(buildIdPath) ? readFileSync(buildIdPath, "utf8").trim() : null,
  expectedBuildId,
  buildMatchesSource: existsSync(buildIdPath) && readFileSync(buildIdPath, "utf8").trim() === expectedBuildId,
  migrationHead: MIGRATION_HEAD,
  expectedSchemaKeys: EXPECTED_SCHEMA_KEYS,
  runtime: { node: process.version, nodeEngines: pkg.engines?.node ?? null, next: pkgVersion("next"), react: pkgVersion("react"), sharp: pkgVersion("sharp"), typescript: pkgVersion("typescript"), supabaseJs: pkgVersion("@supabase/supabase-js") },
  featureFlags: { GLOBAL_MARKET_ENABLED, PAYMENTS_ENABLED, [PUBLIC_RELEASE_FLAG]: "off (se activa solo en la release pública)" },
  economy: "FROZEN (economyFinal.test)",
  catalog: { cards: CARDS.length, agents: AGENTS.length, packs: PACKS.length },
  dbExpectations: { migrationHead: MIGRATION_HEAD, cards: 331, agents: 29, anonProfilesRead: "401 (sonda privacy de /api/ready)", migrationRegistry: "schema_migrations registra hasta 0025; 0026–0066 aplicadas a mano (comprobar por estado, no por la tabla; 0059 = F73 y 0060 = desguace atómico, 2026-09-30; 0061 = Forja 2.0 + carta protegida, 2026-10-02; 0062 = Collection Sets, 2026-10-03; 0063 = equipo favorito del perfil, F89; 0064 = ruta de temporada, F83; 0065 = Ranked 2.0, F84; 0066 = Social 2.0, F85)" },
  requiredEnvNames: envNames,
  criticalAssets: {
    cards: CARDS.filter((c) => existsSync(join(ROOT, "public", String((c as { art?: string; image?: string }).art ?? (c as { image?: string }).image ?? "").replace(/^\//, "")))).length,
    agentsDirs: AGENTS.length,
    note: "cards = cartas del catálogo cuyo arte existe en public/",
  },
  sourceFingerprint: fingerprint,
  exposure: "127.0.0.1:3005 (loopback). Sin dominio público hasta la activación.",
};

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "release-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ version: manifest.version, buildId: manifest.buildId, head: manifest.migrationHead, cards: manifest.catalog.cards, agents: manifest.catalog.agents, fingerprint }, null, 0));
})();
