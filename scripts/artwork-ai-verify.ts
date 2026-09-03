/**
 * VERIFICACIÓN DEL ARTWORK AI & QUALITY ASSISTANT (Artwork Pipeline · Fase 6/6, FINAL).
 *
 * Asistente 100% de SOLO LECTURA (sin IA generativa): analiza métricas objetivas y produce
 * QualityReport + sugerencias. Ejemplo obligatorio: GEN-2026-VALORANT-MASTERS-LONDON-2026.
 * Comprueba: análisis · duplicados · resolución · consistencia · recomendaciones · informes
 * · determinismo · rendimiento · integración con Manager/Renderer/Acquisition/Updater ·
 * CERO modificaciones del Registry · CERO modificaciones de imágenes · CERO decisiones.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import {
  importSnapshot, makeClock, createIdentityResolver, buildRegistry, type RawSnapshot, type ImportCtx,
} from "@/importer";
import { analyze } from "@/analyzer";
import { generateCards } from "@/card-generator";
import { allPlayers } from "@/data/catalog";
import { ArtworkEngine, makeAsset, teamAsset } from "@/artwork";
import { composeArtwork, type ArtworkComposition, type ComposerCtx } from "@/artwork-composer";
import { ArtworkRenderer } from "@/artwork-renderer";
import { AcquisitionEngine, StaticManifestProvider, refsOfGeneration, slugify } from "@/artwork-acquisition";
import { AssetLifecycleEngine, type IncomingAsset } from "@/artwork-updater";
import { artworkHash } from "@/artwork";
import {
  ArtworkQualityAssistant, analyzePixels, gradeOf,
  type QualityReport,
} from "@/artwork-ai";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = ""): void => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

const NOW = 1_700_000_000_000;
const GEN = "GEN-2026-VALORANT-MASTERS-LONDON-2026";

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

/* ── Imágenes sintéticas con defectos CONTROLADOS ── */
const goodPng = (seed: number, size = 512): Promise<Buffer> =>
  sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 3}" fill="rgb(${seed % 255},120,200)"/><circle cx="${size / 3}" cy="${size / 3}" r="${size / 8}" fill="#ffd166"/></svg>`))
    .png().toBuffer();
const opaquePng = (size = 512): Promise<Buffer> =>
  sharp({ create: { width: size, height: size, channels: 4, background: { r: 40, g: 90, b: 160, alpha: 1 } } }).png().toBuffer();
const croppedPng = (size = 512): Promise<Buffer> =>
  sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect x="0" y="${size * 0.1}" width="${size}" height="${size * 0.8}" fill="#c0392b"/></svg>`))
    .png().toBuffer();
const noAlphaPng = (size = 512): Promise<Buffer> =>
  sharp({ create: { width: size, height: size, channels: 3, background: { r: 200, g: 60, b: 60 } } }).png().toBuffer();

async function main(): Promise<void> {
  console.log("# Verificación del Artwork AI & Quality Assistant — DRL Champions (Artwork Fase 6/6)\n");

  const ictx: ImportCtx = { clock: makeClock(NOW), identity: createIdentityResolver(buildRegistry([])) };
  const gen = generateCards(analyze(importSnapshot(LONDON, ictx).model), { roster: allPlayers(), now: NOW });
  check("fixture: generación obligatoria", gen.generationId === GEN, gen.generationId);

  const root = mkdtempSync(join(tmpdir(), "drl-quality-"));
  const assetsRoot = join(root, "public");
  mkdirSync(join(assetsRoot, "players"), { recursive: true });
  mkdirSync(join(assetsRoot, "teams"), { recursive: true });
  mkdirSync(join(assetsRoot, "badges"), { recursive: true });

  try {
    // ── MONTAJE: Manager + Acquisition REAL + Lifecycle + composiciones + defectos ──
    const artwork = new ArtworkEngine();
    const lynId = gen.players.find((p) => p.nick === "Lyncher")!.playerId!;
    const wolfId = gen.players.find((p) => p.nick === "Wolfrik")!.playerId!;
    const acq = new AcquisitionEngine(artwork, {
      providers: [new StaticManifestProvider("cfg", [
        { category: "player", subjectId: "zekken", url: "mem://zekken.png", license: "official" },
        { category: "team", subjectId: "london-lions", url: "mem://lions.png", license: "official" },
      ], async (url) => url.includes("zekken") ? await goodPng(10) : await goodPng(60, 300))],
      assetsRoot, now: NOW,
    });
    await acq.acquireForGeneration(gen);

    // Defectos controlados registrados a mano (ficheros REALES en el árbol temporal).
    const put = async (rel: string, bytes: Buffer): Promise<void> => writeFileSync(join(assetsRoot, rel), bytes);
    await put(`players/${lynId}.png`, await opaquePng());        // fondo sin eliminar
    await put(`players/${wolfId}.png`, await noAlphaPng());      // transparencia perdida
    await put("teams/madrid-wolves.png", await croppedPng(300)); // bordes recortados
    // berlin-bears apunta al MISMO fichero que el logo adquirido de lions ⇒ duplicado real.
    await put("badges/mvp.png", await goodPng(5, 32));           // demasiado pequeño
    await put("teams/rotos.png", Buffer.from([1, 2, 3, 4]));     // corrupto
    const reg = (id: string, cat: "player" | "team" | "badge", subject: string, rel: string, w = 512, h = 512): void =>
      artwork.register(makeAsset({ id, category: cat, name: subject, path: `/${rel}`, format: "png", width: w, height: h, aliases: [subject], subjectId: subject }));
    reg(`player:${lynId}`, "player", lynId, `players/${lynId}.png`);
    reg(`player:${wolfId}`, "player", wolfId, `players/${wolfId}.png`);
    reg("team:madrid-wolves", "team", "madrid-wolves", "teams/madrid-wolves.png", 300, 300);
    reg("team:berlin-bears", "team", "berlin-bears", "teams/london-lions.png", 256, 256);
    reg("badge:mvp", "badge", "mvp", "badges/mvp.png", 32, 32);
    reg("team:rotos", "team", "rotos", "teams/rotos.png", 300, 300);

    // Ciclo de vida: licencias + versión anticuada (rollback) + divergencia de la oficial.
    const lifecycle = new AssetLifecycleEngine(new ArtworkEngine());
    const inc = (id: string, checksum: string, license?: "official" | "cc"): IncomingAsset => ({
      asset: artwork.registry.get(id)!, checksum, provider: "cfg", license,
    });
    lifecycle.sync([
      inc("player:zekken", artworkHash("zk-v1"), "official"),
      inc("team:london-lions", artworkHash("lions-v1"), "official"),
      inc(`player:${lynId}`, artworkHash("lyn-v1"), "official"),
    ], { actor: "qa", at: NOW });
    lifecycle.sync([
      inc("player:zekken", artworkHash("zk-v2"), "official"),
      inc("team:london-lions", artworkHash("lions-v2"), "cc"),   // vigente NO oficial ≠ oficial v1
      inc(`player:${lynId}`, artworkHash("lyn-v1"), "official"),
    ], { actor: "qa", at: NOW + 1 });
    lifecycle.rollback("player:zekken", 1, { actor: "qa", at: NOW + 2 }); // hay v2 más reciente

    // Composiciones REALES del Composer (uso + consistencia); una inconsistencia simulada.
    const comps: ArtworkComposition[] = gen.cards.map((spec) => {
      const res = gen.players.find((x) => x.playerId === spec.playerId);
      const ctx: ComposerCtx = {
        nick: res?.nick, teamSlug: res?.draft?.team ? slugify(res.draft.team) : "london-lions",
        tournamentId: gen.tournamentId, tournamentName: gen.tournamentName, generationId: gen.generationId,
      };
      return composeArtwork(spec, artwork, ctx);
    });
    artwork.register(makeAsset({ id: "player:zekken-alt", category: "player", name: "zekken alt", path: "/players/zekken.png", format: "png", width: 512, height: 512, subjectId: "zekken" }));
    const altComp = composeArtwork(gen.cards.find((c) => c.playerId === "zekken")!, artwork, { nick: "zekken", teamSlug: "london-lions", generationId: GEN });
    comps.push(altComp);

    const refs = refsOfGeneration(gen); // team:rotos y zekken-alt quedan huérfanos
    const reader = (rel: string): Uint8Array => readFileSync(join(assetsRoot, rel.replace(/^\//, "")));

    const registryBefore = JSON.stringify(artwork.registry.list());
    const compsBefore = JSON.stringify(comps);
    const filesBefore = readdirSync(join(assetsRoot, "players")).length + readdirSync(join(assetsRoot, "teams")).length + readdirSync(join(assetsRoot, "badges")).length;

    const assistant = new ArtworkQualityAssistant(artwork, {
      reader, lifecycle: lifecycle.state, refs, compositions: comps, now: NOW, scope: GEN,
    });
    const report = await assistant.analyze();

    // ── 1. EJEMPLO OBLIGATORIO ──
    console.log("## 1. Ejemplo obligatorio — informe de Masters London 2026");
    console.log(`   total=${report.analyzed} · media=${report.averageScore} · exc=${report.byGrade.excelente} bue=${report.byGrade.bueno} ace=${report.byGrade.aceptable} def=${report.byGrade.deficiente} cri=${report.byGrade["crítico"]}`);
    console.log(`   duplicados=${report.duplicates.length} · sinLicencia=${report.unlicensed.length} · huérfanos=${report.orphans.length}`);
    report.suggestions.slice(0, 10).forEach((s, i) => console.log(`   ${String(i + 1).padStart(2)}. [${s.code}] ${s.message}`));
    check("informe completo con totales/media/grados/duplicados/licencias/huérfanos",
      report.analyzed >= 9 && report.averageScore > 0 && report.averageScore < 100 &&
      Object.values(report.byGrade).reduce((a, b) => a + b, 0) === report.analyzed &&
      report.ranking.length === report.analyzed && report.suggestions.length >= 10);

    // ── 2. DETECCIONES ──
    console.log("\n## 2. Detecciones automáticas");
    const codes = (id: string): string[] => report.issues.filter((i) => i.assetId === id).map((i) => i.code);
    check("fondo no eliminado (jugador opaco de borde a borde)", codes(`player:${lynId}`).includes("BACKGROUND_NOT_REMOVED"));
    check("transparencia perdida (sin canal alfa)", codes(`player:${wolfId}`).includes("NO_TRANSPARENCY"));
    check("bordes recortados", codes("team:madrid-wolves").includes("CROPPED_EDGES"));
    check("imagen demasiado pequeña (badge 32px)", codes("badge:mvp").includes("TOO_SMALL"));
    check("asset corrupto", codes("team:rotos").includes("CORRUPT"));
    check("duplicados por CONTENIDO decodificado (lions = berlin-bears)",
      report.duplicates.some((d) => d.assetIds.includes("team:london-lions") && d.assetIds.includes("team:berlin-bears")));
    check("logo antiguo (existe versión más reciente tras rollback)", codes("player:zekken").includes("OUTDATED_VERSION"));
    check("logo diferente al oficial registrado", codes("team:london-lions").includes("UNOFFICIAL_MISMATCH"));
    check("huérfano (sujeto sin referencias vivas)", report.orphans.includes("team:rotos"));
    check("sin licencia registrada (fuera del ciclo de vida)", report.unlicensed.includes("badge:mvp"));
    check("mismo jugador con imágenes distintas (consistencia)",
      report.issues.some((i) => i.code === "INCONSISTENT_SUBJECT" && i.assetId.startsWith("player:zekken")));

    // ── 3. QUALITY SCORE ──
    console.log("\n## 3. Quality Score");
    const q = (id: string) => report.assets.find((a) => a.assetId === id)!;
    check("0..100 con 7 dimensiones y grados coherentes",
      report.assets.every((a) => a.score >= 0 && a.score <= 100 && a.grade === gradeOf(a.score) &&
        Object.values(a.dimensions).every((d) => d >= 0 && d <= 100)));
    check("el corrupto es CRÍTICO y el limpio supera al defectuoso",
      q("team:rotos").grade === "crítico" && q("player:zekken").score > q(`player:${wolfId}`).score &&
      q("badge:mvp").score < q("player:zekken").score);

    // ── 4. RECOMENDACIONES (solo texto; jamás correcciones) ──
    console.log("\n## 4. Recomendaciones");
    const texts = report.suggestions.map((s) => s.message).join(" | ");
    check("frases del contrato presentes",
      texts.includes("demasiado pequeño") && texts.includes("fondo") &&
      texts.includes("versión más reciente") && texts.includes("idénticos"));
    check("priorizadas (corrupto/crítico primero)",
      report.suggestions[0].priority >= report.suggestions[report.suggestions.length - 1].priority &&
      ["CORRUPT", "TOO_SMALL", "NO_TRANSPARENCY"].includes(report.suggestions[0].code));

    // ── 5. CERO MODIFICACIONES / CERO DECISIONES ──
    console.log("\n## 5. Solo lectura garantizada");
    const filesAfter = readdirSync(join(assetsRoot, "players")).length + readdirSync(join(assetsRoot, "teams")).length + readdirSync(join(assetsRoot, "badges")).length;
    check("CERO modificaciones del Registry (byte a byte)", JSON.stringify(artwork.registry.list()) === registryBefore);
    check("CERO imágenes creadas/modificadas/borradas", filesAfter === filesBefore &&
      readFileSync(join(assetsRoot, "badges", "mvp.png")).length > 0);
    check("CERO modificaciones de composiciones", JSON.stringify(comps) === compsBefore);
    check("CERO decisiones automáticas: el informe es la única salida",
      !("apply" in report) && !("fix" in report) && report.suggestions.every((s) => typeof s.message === "string"));

    // ── 6. INTEGRACIONES ──
    console.log("\n## 6. Integraciones");
    check("Manager: analiza exactamente sus assets reales (sin placeholders)",
      report.assets.every((a) => !!artwork.registry.get(a.assetId)) &&
      report.assets.every((a) => !artwork.registry.get(a.assetId)!.placeholder));
    check("Acquisition: los assets adquiridos entran al análisis con su fichero real",
      q("player:zekken").dimensions.resolution >= 75);
    check("Updater: licencias/versiones del ciclo de vida alimentan el score",
      q(`player:${lynId}`).dimensions.license === 100 && q("badge:mvp").dimensions.license <= 30);
    const rendered = await new ArtworkRenderer(artwork, { outputDir: join(root, "render"), now: NOW, generationId: GEN, reader })
      .renderCard(comps[0]);
    check("Renderer: puede materializar tras el análisis y el Registry sigue intacto",
      rendered.files.length === 4 && JSON.stringify(artwork.registry.list()) === registryBefore);

    // ── 7. DETERMINISMO ──
    console.log("\n## 7. Determinismo");
    const report2 = await assistant.analyze();
    check("mismo contexto ⇒ mismo informe (huella)", report.fingerprint === report2.fingerprint &&
      JSON.stringify(report) === JSON.stringify(report2));
    check("análisis de píxeles determinista",
      (await analyzePixels(await goodPng(7))).contentHash === (await analyzePixels(await goodPng(7))).contentHash);

    // ── 8. RENDIMIENTO ──
    console.log("\n## 8. Rendimiento");
    const bigArt = new ArtworkEngine();
    for (let i = 0; i < 500; i++) bigArt.register(teamAsset(`t${i}`));
    const bigAssistant = new ArtworkQualityAssistant(bigArt, { now: NOW });
    const t0 = Date.now();
    const bigReport = await bigAssistant.analyze();
    const ms = Date.now() - t0;
    check("500 assets (metadatos) analizados en tiempo razonable",
      bigReport.analyzed >= 500 && ms < 3000, `${ms} ms (${bigReport.analyzed} assets)`);

    console.log(`\n${fail === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${fail} COMPROBACIÓN(ES) FALLARON`} — ${pass}/${pass + fail}`);
    if (fail > 0) process.exitCode = 1;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
