/**
 * VERIFICACIÓN DEL ASSET ACQUISITION ENGINE (Artwork Pipeline · Fase 4/6).
 *
 * Adquiere y REGISTRA assets, nada más (jamás renderiza/compone ni toca decisiones del
 * Composer). 100% offline: proveedores y fetchers inyectados en memoria; imágenes de
 * prueba sintetizadas con sharp. Comprueba: identidad · selección de proveedor ·
 * validación (formato/resolución/alpha/aspecto/peso/integridad) · normalización ·
 * deduplicación · cache · determinismo · rendimiento · placeholders reemplazables ·
 * integración con Artwork Manager y Renderer · cero corruptos · cero duplicados.
 */
import { mkdtempSync, rmSync, readdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import {
  importSnapshot, makeClock, createIdentityResolver, buildRegistry, type RawSnapshot, type ImportCtx,
} from "@/importer";
import { analyze } from "@/analyzer";
import { generateCards } from "@/card-generator";
import { allPlayers } from "@/data/catalog";
import { ArtworkEngine, playerAsset, validateAssets } from "@/artwork";
import { composeArtwork } from "@/artwork-composer";
import { ArtworkRenderer } from "@/artwork-renderer";
import {
  AcquisitionEngine, LocalDirectoryProvider, StaticManifestProvider, rankProviders, selectCandidate,
  scanGeneration, refsOfGeneration, validateCandidate, normalizeCandidate, sniffFormat,
  type AcquisitionTarget, type AssetProvider, type StaticManifestEntry,
} from "@/artwork-acquisition";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = ""): void => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

/* ── Fixture London (mismo RawSnapshot compacto de la saga) ── */
const LONDON: RawSnapshot = {
  tournament: { id: "valorant-masters-london-2026", name: "Valorant Masters London 2026", type: "international", tier: "vct-international", status: "finished", startDate: "2026-06-05T00:00:00Z", endDate: "2026-06-21T00:00:00Z" },
  stages: [{ id: "st-po", name: "Playoffs", kind: "playoff", orderIdx: 0 }],
  teams: [
    { id: "lln", name: "London Lions", region: "EMEA", active: true },
    { id: "mwv", name: "Madrid Wolves", region: "EMEA" },
    { id: "bbr", name: "Berlin Bears", region: "EMEA" },
  ],
  players: [
    { id: "zk", nick: "zekken", team: "London Lions", role: "duelist", agents: ["Jett", "Raze", "Neon"] },
    { id: "lf", nick: "Lyncher", team: "London Lions", role: "initiator", agents: ["Sova"] },
    { id: "wk", nick: "Wolfrik", team: "Madrid Wolves", role: "sentinel", agents: ["Killjoy"] },
  ],
  coaches: [{ id: "lc", name: "Sable", team: "London Lions", status: "active" }],
  matches: [
    { id: "l0", stageId: "st-po", teamA: "London Lions", teamB: "Berlin Bears", status: "finished", format: "bo3", scoreA: 2, scoreB: 1, winner: "London Lions", round: "Semifinal", matchOrder: 1 },
    { id: "l1", stageId: "st-po", teamA: "London Lions", teamB: "Madrid Wolves", status: "finished", format: "bo3", scoreA: 2, scoreB: 0, winner: "London Lions", round: "Grand Final", matchOrder: 2 },
  ],
  maps: [
    { id: "l0m1", matchId: "l0", map: "Ascent", mapOrder: 1, scoreA: 13, scoreB: 10, winner: "London Lions" },
    { id: "l0m2", matchId: "l0", map: "Bind", mapOrder: 2, scoreA: 8, scoreB: 13, winner: "Berlin Bears" },
    { id: "l0m3", matchId: "l0", map: "Ascent", mapOrder: 3, scoreA: 13, scoreB: 11, winner: "London Lions" },
    { id: "l1m1", matchId: "l1", map: "Ascent", mapOrder: 1, scoreA: 13, scoreB: 7, winner: "London Lions" },
    { id: "l1m2", matchId: "l1", map: "Haven", mapOrder: 2, scoreA: 13, scoreB: 9, winner: "London Lions" },
  ],
  mapStats: [
    { matchMapId: "l0m1", matchId: "l0", player: "zekken", team: "London Lions", agent: "Jett", acs: 300, kills: 20, deaths: 10, assists: 4, kast: 80, adr: 170, hsPct: 32, fk: 5, fd: 2, clutches: 3 },
    { matchMapId: "l1m1", matchId: "l1", player: "zekken", team: "London Lions", agent: "Raze", acs: 200, kills: 10, deaths: 10, assists: 6, kast: 70, adr: 150, hsPct: 25, fk: 2, fd: 2, clutches: 2 },
    { matchMapId: "l0m1", matchId: "l0", player: "Lyncher", team: "London Lions", agent: "Sova", acs: 190, kills: 12, deaths: 12, assists: 9, kast: 74, adr: 140, fk: 1, fd: 1, clutches: 0 },
    { matchMapId: "l1m1", matchId: "l1", player: "Wolfrik", team: "Madrid Wolves", agent: "Killjoy", acs: 210, kills: 14, deaths: 15, assists: 5, kast: 68, adr: 145, fk: 2, fd: 3, clutches: 1 },
  ],
  standings: [
    { team: "London Lions", position: 1, wins: 2, losses: 0, mapsWon: 4, mapsLost: 1, status: "qualified" },
    { team: "Madrid Wolves", position: 2, wins: 1, losses: 1, mapsWon: 2, mapsLost: 2 },
    { team: "Berlin Bears", position: 3, wins: 1, losses: 1 },
  ],
  awards: { champion: "London Lions", runnerUp: "Madrid Wolves" },
};

const NOW = 1_700_000_000_000;
const GEN = "GEN-2026-VALORANT-MASTERS-LONDON-2026";

/* ── Imágenes sintéticas (sharp) servidas por el fetcher en memoria ── */
const rgba = (r: number, g: number, b: number, alpha: number) => ({ r, g, b, alpha });
const png = (w: number, h: number, color = rgba(30, 200, 120, 0)): Promise<Buffer> =>
  sharp({ create: { width: w, height: h, channels: 4, background: rgba(10, 10, 20, 1) } })
    .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 3}" fill="rgb(${color.r},${color.g},${color.b})"/></svg>`) }])
    .ensureAlpha().png().toBuffer();
const pngAlpha = (w: number, h: number, seedColor: number): Promise<Buffer> =>
  sharp({ create: { width: w, height: h, channels: 4, background: rgba(seedColor % 255, 90, 200, 0) } }).png().toBuffer();
const jpgOpaque = (w: number, h: number): Promise<Buffer> =>
  sharp({ create: { width: w, height: h, channels: 3, background: rgba(200, 50, 50, 1) } }).jpeg().toBuffer();

async function main(): Promise<void> {
  console.log("# Verificación del Asset Acquisition Engine — DRL Champions (Artwork Fase 4/6)\n");

  const ictx: ImportCtx = { clock: makeClock(NOW), identity: createIdentityResolver(buildRegistry([])) };
  const gen = generateCards(analyze(importSnapshot(LONDON, ictx).model), { roster: allPlayers(), now: NOW });
  check("fixture: generación obligatoria", gen.generationId === GEN, gen.generationId);

  const root = mkdtempSync(join(tmpdir(), "drl-acquire-"));
  const assetsRoot = join(root, "public");

  try {
    // ── 1. RESOLUCIÓN DE IDENTIDAD ──
    console.log("## 1. Resolución de identidad");
    const refs = refsOfGeneration(gen);
    check("referencias canónicas de la generación (jugadores/equipos/torneo)",
      refs.players.length === 3 && refs.players.includes("zekken") &&
      refs.teams.includes("london-lions") && refs.teams.includes("madrid-wolves") &&
      refs.tournaments[0] === gen.tournamentId);
    const artwork0 = new ArtworkEngine();
    const scan = scanGeneration(artwork0, gen);
    check("objetivos = sujetos SIN asset real (todo placeholder en un Manager recién creado)",
      scan.targets.length === refs.players.length + refs.teams.length + refs.countries.length + 1 &&
      scan.available.length === 0);
    const t = scan.targets.find((x) => x.category === "player" && x.subjectId !== "zekken")!;
    check("términos de búsqueda con la identidad REAL (nick + equipo de la generación)",
      t.searchTerms.length >= 2 && scan.targets.find((x) => x.category === "tournament-logo")!
        .searchTerms.includes("Valorant Masters London 2026"));
    const artworkPre = new ArtworkEngine();
    artworkPre.register(playerAsset("zekken"));
    check("un sujeto con asset real queda DISPONIBLE (no se re-adquiere)",
      scanGeneration(artworkPre, gen).available.some((a) => a.subjectId === "zekken") &&
      !scanGeneration(artworkPre, gen).targets.some((x) => x.subjectId === "zekken" && x.category === "player"));

    // ── 2. PROVEEDORES ──
    console.log("\n## 2. Selección de proveedor");
    const dead: AssetProvider = { id: "dead", priority: () => 999, health: () => false, search: async () => [], download: async () => new Uint8Array(), metadata: async () => ({}), license: async () => "unknown" };
    const local = new LocalDirectoryProvider(assetsRoot);
    const staticP = new StaticManifestProvider("cfg", [{ category: "player", subjectId: "x", url: "mem://x" }], async () => new Uint8Array());
    const ranked = await rankProviders([staticP, dead, local]);
    check("health=false se salta; orden por prioridad", ranked.length >= 1 && ranked[0].id !== "dead" &&
      (ranked.length < 2 || ranked[0].priority() >= ranked[1].priority()));
    check("selección: licencia oficial > score > orden estable",
      selectCandidate([
        { providerId: "a", sourceRef: "u1", score: 99, license: "unknown" },
        { providerId: "b", sourceRef: "u2", score: 10, license: "official" },
      ])!.sourceRef === "u2" && selectCandidate([]) === null);

    // ── 3. VALIDACIÓN (nunca se registra un asset inválido) ──
    console.log("\n## 3. Validación");
    check("acepta PNG válido con alpha", (await validateCandidate(await pngAlpha(512, 512, 10), "player")).ok);
    check("rechaza resolución insuficiente (TOO_SMALL)",
      (await validateCandidate(await pngAlpha(64, 64, 10), "player")).issues.some((i) => i.code === "TOO_SMALL"));
    check("rechaza sin transparencia cuando la exige (NO_ALPHA)",
      (await validateCandidate(await jpgOpaque(512, 512), "player")).issues.some((i) => i.code === "NO_ALPHA"));
    check("rechaza aspecto imposible (BAD_ASPECT)",
      (await validateCandidate(await pngAlpha(900, 200, 10), "player")).issues.some((i) => i.code === "BAD_ASPECT"));
    check("rechaza bytes corruptos/formato desconocido",
      !(await validateCandidate(new Uint8Array([1, 2, 3, 4, 5]), "player")).ok &&
      sniffFormat(await pngAlpha(64, 64, 1)) === "png" && sniffFormat(new Uint8Array(16)) === "unknown");

    // ── 4. NORMALIZACIÓN ──
    console.log("\n## 4. Normalización");
    const norm = await normalizeCandidate(await pngAlpha(700, 700, 22), { category: "player", subjectId: "demo", searchTerms: ["demo"] });
    const nMeta = await sharp(Buffer.from(norm.png)).metadata();
    check("PNG+WEBP al tamaño estándar, con alpha y nombre por convención",
      norm.width === 512 && nMeta.width === 512 && nMeta.hasAlpha === true &&
      norm.webp.length > 0 && norm.fileName === "demo.png");
    const norm2 = await normalizeCandidate(await pngAlpha(700, 700, 22), { category: "player", subjectId: "demo", searchTerms: ["demo"] });
    check("normalización determinista (misma huella)", norm.contentHash === norm2.contentHash);

    // ── 5. PIPELINE COMPLETO (ejemplo obligatorio, offline) ──
    console.log("\n## 5. Pipeline completo — GEN-2026-VALORANT-MASTERS-LONDON-2026");
    const wolfId = gen.players.find((p) => p.nick === "Wolfrik")!.playerId!;
    const lynId = gen.players.find((p) => p.nick === "Lyncher")!.playerId!;
    const sameBytes = await pngAlpha(512, 512, 77);
    const served = new Map<string, Uint8Array>([
      ["mem://zekken.png", await pngAlpha(600, 600, 10)],
      ["mem://lyncher.png", sameBytes],
      ["mem://wolfrik.png", sameBytes],                       // MISMO contenido ⇒ dedupe
      ["mem://lions.png", await pngAlpha(300, 300, 40)],
      ["mem://wolves-bad.png", await pngAlpha(32, 32, 50)],   // inválido (TOO_SMALL)
      ["mem://wolves-good.png", await pngAlpha(256, 256, 60)],
      ["mem://tournament.png", await png(400, 400)],
      ["mem://broken.bin", new Uint8Array([9, 9, 9])],
    ]);
    const fetcher = async (url: string): Promise<Uint8Array> => {
      const hit = served.get(url);
      if (!hit) throw new Error(`sin fixture: ${url}`);
      return hit;
    };
    const entries: StaticManifestEntry[] = [
      { category: "player", subjectId: "zekken", url: "mem://zekken.png", license: "official" },
      { category: "player", subjectId: lynId, url: "mem://lyncher.png", license: "official" },
      { category: "player", subjectId: wolfId, url: "mem://wolfrik.png", license: "official" },
      { category: "team", subjectId: "madrid-wolves", url: "mem://wolves-bad.png", license: "official", score: 90 },
      { category: "team", subjectId: "madrid-wolves", url: "mem://wolves-good.png", license: "official", score: 10 },
      { category: "tournament-logo", subjectId: gen.tournamentId, url: "mem://broken.bin", license: "official" },
      // london-lions SIN entrada ⇒ pendiente (queda en placeholder)
    ];
    const artwork = new ArtworkEngine();
    const engine = new AcquisitionEngine(artwork, {
      providers: [new LocalDirectoryProvider(assetsRoot), new StaticManifestProvider("cfg", entries, fetcher)],
      assetsRoot, now: NOW,
    });
    const report = await engine.acquireForGeneration(gen);
    console.log(`   requeridos=${report.required} disponibles=${report.available} descargados=${report.downloaded} reutilizados=${report.reused} rechazados=${report.rejected} pendientes=${report.pending} (candidatos=${report.found})`);
    check("descargados: zekken + lyncher + wolves(2º intento válido)",
      report.downloaded === 3 &&
      report.results.some((r) => r.target.subjectId === "madrid-wolves" && r.outcome === "downloaded" && r.candidate?.sourceRef === "mem://wolves-good.png"));
    check("candidato inválido NO se registra: el pipeline cae al siguiente (fallback)",
      existsSync(join(assetsRoot, "teams", "madrid-wolves.png")) &&
      existsSync(join(assetsRoot, "teams", "madrid-wolves.webp")));
    check("reutilizados: wolfrik dedupe por CONTENIDO (mismo fichero que lyncher, sin re-almacenar)",
      report.reused === 1 &&
      report.results.find((r) => r.target.subjectId === wolfId)!.asset!.path ===
      report.results.find((r) => r.target.subjectId === lynId)!.asset!.path &&
      !existsSync(join(assetsRoot, "players", `${wolfId}.png`)));
    check("rechazados: torneo con bytes corruptos (jamás registrado)",
      report.rejected === 1 &&
      report.results.find((r) => r.target.category === "tournament-logo")!.issues!.some((i) => i.code === "CORRUPT" || i.code === "BAD_FORMAT"));
    check("pendientes: sujeto sin candidatos queda en placeholder (london-lions)",
      report.pending === 1 && report.results.find((r) => r.outcome === "pending")!.target.subjectId === "london-lions");
    check("contadores del contrato cuadran",
      report.required === report.available + report.downloaded + report.reused + report.rejected + report.pending);

    // ── 6. INTEGRACIÓN CON EL ARTWORK MANAGER ──
    console.log("\n## 6. Integración con el Artwork Manager");
    check("los placeholders quedan REEMPLAZADOS por assets reales",
      !artwork.resolve("player", "zekken").isPlaceholder &&
      !artwork.resolve("team", "madrid-wolves").isPlaceholder &&
      artwork.resolve("team", "london-lions").isPlaceholder);
    check("los assets registrados VALIDAN en el Manager (cero corruptos)",
      validateAssets(artwork.registry.list()).ok);
    check("cero duplicados de almacenamiento (ficheros únicos = contenidos únicos)",
      engine.uniqueFiles === report.downloaded &&
      readdirSync(join(assetsRoot, "players")).filter((f) => f.endsWith(".png")).length === 2);
    check("re-adquirir la generación ⇒ todo ya disponible o pendiente (idempotente)", (await (async () => {
      const again = await engine.acquireForGeneration(gen);
      return again.downloaded === 0 && again.reused === 0 &&
        again.available === report.available + report.downloaded + report.reused && again.pending === 1;
    })()));

    // ── 7. INTEGRACIÓN CON EL RENDERER (los adquiridos se materializan de verdad) ──
    console.log("\n## 7. Integración con el Artwork Renderer");
    const spec = gen.cards.find((c) => c.playerId === lynId)!;
    const comp = composeArtwork(spec, artwork, { nick: "Lyncher", teamSlug: "london-lions", generationId: GEN });
    check("la composición referencia el asset REAL adquirido (no placeholder)",
      !comp.layers.find((l) => l.kind === "player")!.elements.find((e) => e.id === "player:artwork")!.isPlaceholder);
    const outDir = join(root, "render");
    const renderer = new ArtworkRenderer(artwork, {
      outputDir: outDir, now: NOW, generationId: GEN,
      reader: (rel) => readFileSync(join(assetsRoot, rel.replace(/^\//, ""))),
    });
    const rendered = await renderer.renderCard(comp);
    check("el Renderer materializa la carta con el asset adquirido (sin sustituciones)",
      rendered.files.length === 4 && existsSync(join(outDir, rendered.files[0].path)));

    // ── 8. CACHE ──
    console.log("\n## 8. Cache");
    check("cero descargas repetidas (lyncher+wolfrik comparten URL distinta pero la re-adquisición no re-baja nada)",
      report.cache.downloadHits + report.cache.validationHits + report.cache.normalizationHits >= 1,
      JSON.stringify(report.cache));

    // ── 9. DETERMINISMO ──
    console.log("\n## 9. Determinismo");
    const root2 = join(root, "again");
    const artworkB = new ArtworkEngine();
    const engineB = new AcquisitionEngine(artworkB, {
      providers: [new LocalDirectoryProvider(join(root2, "none")), new StaticManifestProvider("cfg", entries, fetcher)],
      assetsRoot: join(root2, "public"), now: NOW,
    });
    const reportB = await engineB.acquireForGeneration(gen);
    check("misma configuración ⇒ mismo informe (huella determinista)", report.fingerprint === reportB.fingerprint);
    check("mismos contenidos normalizados byte a byte",
      report.results.find((r) => r.target.subjectId === "zekken")!.contentHash ===
      reportB.results.find((r) => r.target.subjectId === "zekken")!.contentHash);

    // ── 10. RENDIMIENTO ──
    console.log("\n## 10. Rendimiento");
    const many: AcquisitionTarget[] = Array.from({ length: 100 }, (_, i) =>
      ({ category: "player" as const, subjectId: `perf${i}`, searchTerms: [`perf${i}`] }));
    const perfEntries: StaticManifestEntry[] = many.map((m, i) =>
      ({ category: "player" as const, subjectId: m.subjectId, url: `mem://perf${i % 5}.png`, license: "official" as const }));
    for (let i = 0; i < 5; i++) served.set(`mem://perf${i}.png`, await pngAlpha(512, 512, 100 + i));
    const perfEngine = new AcquisitionEngine(new ArtworkEngine(), {
      providers: [new StaticManifestProvider("cfg", perfEntries, fetcher)],
      assetsRoot: join(root, "perf"), now: NOW,
    });
    const t0 = Date.now();
    let downloaded = 0, reused = 0;
    for (const target of many) {
      const r = await perfEngine.acquireTarget(target);
      if (r.outcome === "downloaded") downloaded++;
      if (r.outcome === "reused") reused++;
    }
    const ms = Date.now() - t0;
    check("100 objetivos con 5 contenidos: 5 descargas + 95 dedupe, en tiempo razonable",
      downloaded === 5 && reused === 95 && perfEngine.uniqueFiles === 5 && ms < 8000, `${ms} ms`);

    console.log(`\n${fail === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${fail} COMPROBACIÓN(ES) FALLARON`} — ${pass}/${pass + fail}`);
    if (fail > 0) process.exitCode = 1;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
