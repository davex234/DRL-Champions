/**
 * VERIFICACIÓN DEL ARTWORK ASSET MANAGER (Artwork Pipeline · Fase 1/6).
 *
 * El repositorio oficial de recursos gráficos SOLO administra assets (aún no se genera ni
 * compone ninguna imagen de carta). Comprueba: assets existentes REALES en disco ·
 * resolución/formatos válidos · registro por id/alias/hash · resolver en cascada con
 * placeholder garantizado · cache sin dobles cargas (dedupe por contenido + coalescing) ·
 * manifest (duplicados/faltantes/huérfanos/rotos) · determinismo · rendimiento · cero
 * referencias rotas. 100% offline (lector en memoria); no toca ningún motor del juego.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  ARTWORK_CATEGORIES, SEED_ASSETS, EXISTING_ASSETS, ALL_PLACEHOLDERS, makeAsset, artworkHash,
  playerAsset, teamAsset, countryAsset, ArtworkRegistry, ArtworkEngine,
  validateAsset, validateAssets, resolveCardArtwork, resolveRef, emptyRefs,
  type ArtworkAsset, type ArtworkReader, type ArtworkRefs,
} from "@/artwork";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = ""): void => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

const PUBLIC = join(process.cwd(), "public");

async function main(): Promise<void> {
  console.log("# Verificación del Artwork Asset Manager — DRL Champions (Artwork Fase 1/6)\n");

  // ── 1. ASSETS EXISTENTES (auditoría contra el disco REAL) ──
  console.log("## 1. Assets existentes");
  const existing = EXISTING_ASSETS();
  const onDisk = existing.filter((a) => existsSync(join(PUBLIC, a.path.replace(/^\//, ""))));
  check("TODOS los assets declarados como existentes están en public/ (cero rotos)",
    onDisk.length === existing.length, `${onDisk.length}/${existing.length}`);
  check("cubren branding (Apex Crest), favicons y PWA",
    existing.some((a) => a.path.includes("/branding/icon/")) &&
    existing.some((a) => a.path.includes("/branding/logo/")) &&
    existing.some((a) => a.id === "icon:app-512"));
  check("players/ y teams/ están VACÍOS (faltantes reales detectables)",
    !existsSync(join(PUBLIC, "players/zekken.png")) && !existsSync(join(PUBLIC, "teams/heretics.png")));

  // ── 2. RESOLUCIÓN Y FORMATOS VÁLIDOS ──
  console.log("\n## 2. Resolución y formatos");
  const seed = SEED_ASSETS();
  const v = validateAssets(seed);
  check("el SEED completo valida (ids, formatos por categoría, dimensiones, rutas)", v.ok,
    v.issues.filter((i) => i.severity === "error").map((i) => i.code).join(","));
  check("los PNG declaran resolución real (>0)", seed.filter((a) => a.format === "png").every((a) => a.width > 0 && a.height > 0));
  const badFormat = validateAsset(makeAsset({ id: "font:x", category: "font", name: "", path: "/x.png", format: "png", width: 1, height: 1 }));
  const badDims = validateAsset(makeAsset({ id: "team:x", category: "team", name: "", path: "/x.png", format: "png" }));
  const badId = validateAsset(makeAsset({ id: "SIN CATEGORIA", category: "icon", name: "", path: "/x.svg", format: "svg" }));
  const badPath = validateAsset(makeAsset({ id: "icon:y", category: "icon", name: "", path: "relativa.svg", format: "svg" }));
  check("detecta formato ilegal / dimensiones inválidas / id malformado / ruta inválida",
    !badFormat.ok && !badDims.ok && !badId.ok && !badPath.ok);
  check("duplicidad de id detectada", !validateAssets([seed[0], seed[0]]).ok);
  check("las 17 categorías del contrato tienen placeholder oficial",
    ARTWORK_CATEGORIES.length === 17 && ALL_PLACEHOLDERS().length === 17 && validateAssets(seed).ok);

  // ── 3. REGISTRO (id · alias · hash · sujeto) ──
  console.log("\n## 3. Registro");
  const reg = new ArtworkRegistry(seed);
  check("índice por id", reg.get("icon:app-512")?.path === "/icons/icon-512.png");
  check("índice por alias", reg.byAliasOrId("apex-crest")?.id === "icon:brand-icon");
  const someHash = reg.get("icon:app-512")!.hash;
  check("índice por hash", reg.idsByHash(someHash).includes("icon:app-512"));
  reg.add(playerAsset("zekken"));
  reg.add(teamAsset("heretics"));
  reg.add(countryAsset("ES"));
  check("índice por sujeto (player/team/country por convención)",
    reg.forSubject("player", "zekken")?.path === "/players/zekken.png" &&
    reg.forSubject("team", "heretics")?.path === "/teams/heretics.png" &&
    (reg.forSubject("country", "es")?.path.includes("flagcdn.com") ?? false));
  const before = reg.total;
  reg.add(playerAsset("zekken"));
  check("sustituir un id NO duplica índices", reg.total === before && reg.list("player").filter((a) => !a.placeholder).length === 1);

  // ── 4. RESOLVER (cascada + placeholder SIEMPRE) ──
  console.log("\n## 4. Resolver en cascada");
  const res = resolveCardArtwork(reg, {
    playerId: "zekken", teamSlug: "heretics", countryIso: "ES",
    tournamentId: "valorant-masters-london-2026", rarity: "epic", role: "duelist", region: "emea",
  });
  check("player → team → country resueltos con assets reales",
    !res.player.isPlaceholder && !res.team.isPlaceholder && !res.country.isPlaceholder);
  check("torneo sin logo ⇒ PLACEHOLDER oficial (nunca un hueco)",
    res.tournament.isPlaceholder && res.tournament.asset.id === "placeholder:tournament-logo" &&
    res.tournament.asset.path.startsWith("data:image/svg+xml"));
  check("background + frame por rareza desde el design system (css:)",
    !res.background.isPlaceholder && res.frame.asset.id === "frame:epic" && !res.frame.isPlaceholder);
  check("icons/effects presentes y faltantes reportados por categoría",
    res.icons.length >= 2 && res.effects.length >= 1 &&
    res.missing.includes("tournament-logo") && res.missing.includes("role") && !res.missing.includes("player"));
  const empty = resolveCardArtwork(reg, {});
  check("petición VACÍA ⇒ resolución completa 100% placeholders (jamás falla)",
    empty.player.isPlaceholder && empty.team.isPlaceholder && [empty.player, empty.team, empty.country, empty.tournament].every((r) => !!r.asset.path));
  check("resolveRef por id, por alias y por hash",
    resolveRef(reg, "icon:favicon")?.id === "icon:favicon" &&
    resolveRef(reg, "favicon")?.id === "icon:favicon" &&
    resolveRef(reg, someHash)?.id === "icon:app-512" &&
    resolveRef(reg, "no-existe") === null);

  // ── 5. CACHE + LOADER (jamás dos cargas del mismo asset) ──
  console.log("\n## 5. Cache y loader");
  const reads: string[] = [];
  const reader: ArtworkReader = async (path) => { reads.push(path); return new TextEncoder().encode(`BYTES:${path}`); };
  const eng = new ArtworkEngine({ reader });
  eng.register(playerAsset("zekken"));
  eng.register(makeAsset({ id: "player:zekken-alias", category: "player", name: "mismo fichero", path: "/players/zekken.png", format: "png", width: 512, height: 512, subjectId: "zekken-alias" }));
  const l1 = await eng.loadById("player:zekken");
  const l2 = await eng.loadById("player:zekken");
  check("cargar dos veces el mismo id ⇒ UNA sola lectura (cache por id)",
    reads.length === 1 && l1 === l2 && l1.bytes > 0);
  const l3 = await eng.loadById("player:zekken-alias");
  check("dos ids con el MISMO contenido ⇒ dedupe por hash (una entrada única)",
    l3.contentHash === l1.contentHash && eng.uniqueLoaded === 1 && reads.length === 2);
  const [c1, c2] = await Promise.all([eng.loadById("icon:app-512"), eng.loadById("icon:app-512")]);
  check("cargas CONCURRENTES del mismo asset se fusionan (coalescing)",
    c1 === c2 && reads.filter((r) => r.includes("icon-512")).length === 1);
  const ph = await eng.loadById("placeholder:player");
  check("los recursos virtuales (data:/css:) cargan SIN lector (0 E/S)",
    ph.bytes > 0 && !reads.some((r) => r.startsWith("data:")));
  const stats = eng.cacheStats();
  check("estadísticas de cache coherentes", stats.hits >= 2 && stats.misses >= 3 && stats.loaded === eng.uniqueLoaded);

  // ── 6. MANIFEST (duplicados · faltantes · huérfanos · rotos) ──
  console.log("\n## 6. Manifest");
  const refs: ArtworkRefs = { ...emptyRefs(), players: ["zekken", "lyncher"], teams: ["heretics"], countries: ["es"] };
  const m = eng.manifest(refs, 1_700_000_000_000);
  check("índice completo por categoría (cuadra con el total)",
    m.total === eng.registry.total && Object.values(m.byCategory).reduce((a, b) => a + b, 0) === m.total);
  check("DUPLICADOS: dos assets que declaran el mismo recurso comparten huella",
    m.duplicates.some((d) => d.assetIds.includes("player:zekken") && d.assetIds.includes("player:zekken-alias")));
  check("FALTANTES: sujeto vivo sin asset real (lyncher sin foto)",
    m.missing.some((x) => x.category === "player" && x.subjectId === "lyncher") &&
    !m.missing.some((x) => x.subjectId === "zekken"));
  check("HUÉRFANOS: asset de sujeto que nadie referencia",
    m.orphans.includes("player:zekken-alias"));
  check("CERO referencias rotas en el repositorio", m.broken.length === 0);
  const regBroken = new ArtworkRegistry([...SEED_ASSETS(),
    makeAsset({ id: "team:otra-cosa", category: "team", name: "", path: "/teams/x.png", format: "png", width: 1, height: 1, subjectId: "x" })]);
  const mBroken = new ArtworkRegistry(regBroken.list());
  check("una referencia rota SÍ se detecta (id ≠ convención de sujeto)",
    new ArtworkEngine({ assets: mBroken.list() }).manifest(emptyRefs(), 0).broken.some((b) => b.startsWith("subject:team:otra-cosa")));

  // ── 7. DETERMINISMO ──
  console.log("\n## 7. Determinismo");
  check("SEED byte a byte reproducible", JSON.stringify(SEED_ASSETS()) === JSON.stringify(SEED_ASSETS()));
  const m2 = eng.manifest(refs, 1_700_000_000_000);
  check("manifest determinista (misma huella)", m.fingerprint === m2.fingerprint && JSON.stringify(m) === JSON.stringify(m2));
  check("resolución determinista", JSON.stringify(eng.resolveCard({ playerId: "zekken" })) === JSON.stringify(eng.resolveCard({ playerId: "zekken" })));
  check("hash estable y bien formado", artworkHash("drl") === artworkHash("drl") && /^fnv1a:[0-9a-f]{8}$/.test(artworkHash("drl")));

  // ── 8. RENDIMIENTO ──
  console.log("\n## 8. Rendimiento");
  const bigEngine = new ArtworkEngine();
  const bigRefs: ArtworkRefs = {
    ...emptyRefs(),
    players: Array.from({ length: 5000 }, (_, i) => `p${i}`),
    teams: Array.from({ length: 500 }, (_, i) => `t${i}`),
    countries: ["es", "fr", "gb", "us", "kr"],
    tournaments: Array.from({ length: 100 }, (_, i) => `tor${i}`),
  };
  const t0 = Date.now();
  const added = bigEngine.registerFromRefs(bigRefs);
  const buildMs = Date.now() - t0;
  const t1 = Date.now();
  for (let i = 0; i < 100_000; i++) bigEngine.resolveCard({ playerId: `p${i % 5000}`, teamSlug: `t${i % 500}`, countryIso: "es", rarity: "rare" });
  const resolveMs = Date.now() - t1;
  const t2 = Date.now();
  const bigManifest = bigEngine.manifest(bigRefs, 0);
  const manifestMs = Date.now() - t2;
  check("5.6k assets registrados + 100k resoluciones + manifest en tiempo razonable",
    added === 5605 && buildMs < 1500 && resolveMs < 3000 && manifestMs < 1500,
    `build=${buildMs}ms · 100k resolves=${resolveMs}ms · manifest=${manifestMs}ms`);
  check("manifest del repositorio grande íntegro (0 faltantes de sujetos registrados, 0 rotos)",
    bigManifest.missing.length === 0 && bigManifest.broken.length === 0 && bigManifest.orphans.length === 0);

  // ── 9. CERO ESTADOS IMPOSIBLES ──
  console.log("\n## 9. Cero estados imposibles");
  check("toda categoría del contrato resuelve SIEMPRE (real o placeholder)",
    ARTWORK_CATEGORIES.every((c) => !!bigEngine.resolve(c, "nadie").asset.path));
  check("el repositorio completo valida tras registrar 5.6k assets", bigEngine.validate().ok);
  check("assets 100% serializables", (() => {
    const j = JSON.parse(JSON.stringify(bigEngine.registry.list())) as ArtworkAsset[];
    return j.length === bigEngine.registry.total && j.every((a) => typeof a.hash === "string");
  })());

  console.log(`\n${fail === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${fail} COMPROBACIÓN(ES) FALLARON`} — ${pass}/${pass + fail}`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
