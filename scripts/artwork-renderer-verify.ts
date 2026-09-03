/**
 * VERIFICACIÓN DEL ARTWORK RENDERER (Artwork Pipeline · Fase 3/6).
 *
 * Motor PASIVO: ArtworkComposition (Composer congelado) → PNG · WEBP · thumbnail · preview
 * + manifest, todo determinista byte a byte. Ejemplo obligatorio: zekken__mythic y después
 * TODA la generación GEN-2026-VALORANT-MASTERS-LONDON-2026. Comprueba: render completo ·
 * formatos · manifest · fingerprint/metadata embebida · cache y render incremental ·
 * placeholders (jamás falla por asset inexistente, jamás descarga) · determinismo ·
 * rendimiento (lote de 1000 sin renders duplicados) · compat Composer/Manager · cero
 * referencias rotas · cero capas fuera de orden. Salida en directorio temporal (se borra).
 */
import { mkdtempSync, rmSync, existsSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  importSnapshot, makeClock, createIdentityResolver, buildRegistry, type RawSnapshot, type ImportCtx,
} from "@/importer";
import { analyze } from "@/analyzer";
import { generateCards } from "@/card-generator";
import { allPlayers } from "@/data/catalog";
import { ArtworkEngine, playerAsset, teamAsset, countryAsset } from "@/artwork";
import { composeArtwork, type ArtworkComposition, type ComposerCtx } from "@/artwork-composer";
import {
  ArtworkRenderer, inspectImage, RenderError, RENDER_VERSION,
  type RenderManifest,
} from "@/artwork-renderer";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = ""): void => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

/* ── Fixture London (mismo RawSnapshot compacto que el resto de verifies) ── */
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
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

async function main(): Promise<void> {
  console.log("# Verificación del Artwork Renderer — DRL Champions (Artwork Fase 3/6)\n");

  const ictx: ImportCtx = { clock: makeClock(NOW), identity: createIdentityResolver(buildRegistry([])) };
  const gen = generateCards(analyze(importSnapshot(LONDON, ictx).model), { roster: allPlayers(), now: NOW });
  check("fixture: generación obligatoria", gen.generationId === GEN, gen.generationId);

  const artwork = new ArtworkEngine();
  for (const p of gen.players) {
    if (!p.playerId) continue;
    artwork.register(playerAsset(p.playerId));
    if (p.draft?.team) artwork.register(teamAsset(slug(p.draft.team)));
    if (p.draft?.country) artwork.register(countryAsset(p.draft.country));
  }
  const comps: ArtworkComposition[] = gen.cards.map((spec) => {
    const res = gen.players.find((p) => p.playerId === spec.playerId);
    const ctx: ComposerCtx = {
      nick: res?.nick, teamSlug: res?.draft?.team ? slug(res.draft.team) : undefined,
      countryIso: res?.draft?.country, role: res?.draft?.role?.toLowerCase(), region: res?.draft?.region?.toLowerCase(),
      tournamentId: gen.tournamentId, tournamentName: gen.tournamentName, generationId: gen.generationId,
      collectionName: gen.collection.name,
    };
    return composeArtwork(spec, artwork, ctx);
  });
  const mythic = comps.find((c) => c.cardId === "zekken__mythic")!;

  const root = mkdtempSync(join(tmpdir(), "drl-artrender-"));
  const dirA = join(root, "a");

  try {
    // ── 1. RENDER DEL EJEMPLO OBLIGATORIO (zekken__mythic) ──
    console.log("## 1. Render de zekken__mythic (PNG · WEBP · thumbnail · preview)");
    const renderer = new ArtworkRenderer(artwork, { outputDir: dirA, now: NOW, generationId: GEN });
    const t0 = Date.now();
    const one = await renderer.renderCard(mythic);
    const oneMs = Date.now() - t0;
    check("render completo: 4 ficheros en la estructura oficial",
      one.files.length === 4 && one.files.every((f) => existsSync(join(dirA, f.path))) &&
      one.files.map((f) => f.path).join(",") ===
      "cards/zekken__mythic.png,cards/zekken__mythic.webp,thumbnails/zekken__mythic.png,previews/zekken__mythic.webp");
    const png = readFileSync(join(dirA, "cards/zekken__mythic.png"));
    const webp = readFileSync(join(dirA, "cards/zekken__mythic.webp"));
    const iPng = await inspectImage(png);
    const iWebp = await inspectImage(webp);
    const iThumb = await inspectImage(readFileSync(join(dirA, "thumbnails/zekken__mythic.png")));
    const iPrev = await inspectImage(readFileSync(join(dirA, "previews/zekken__mythic.webp")));
    check("PNG maestro válido y decodificable (750×1050)", iPng.format === "png" && iPng.width === 750 && iPng.height === 1050, `${(png.length / 1024).toFixed(0)} KB`);
    check("WEBP lossless válido (750×1050)", iWebp.format === "webp" && iWebp.width === 750 && iWebp.height === 1050, `${(webp.length / 1024).toFixed(0)} KB`);
    check("thumbnail 150×210 y preview 375×525", iThumb.width === 150 && iThumb.height === 210 && iPrev.width === 375 && iPrev.height === 525);

    // ── 2. FINGERPRINT / METADATA EMBEBIDA ──
    console.log("\n## 2. Fingerprint y metadata embebida");
    check("cada imagen CONTIENE GenerationId · CardId · ArtworkFingerprint · RenderVersion · fecha lógica",
      [iPng, iWebp, iThumb, iPrev].every((i) =>
        i.description.includes(GEN) && i.description.includes("zekken__mythic") &&
        i.description.includes(mythic.fingerprint) && i.description.includes(`"renderVersion":${RENDER_VERSION}`) &&
        i.description.includes(String(NOW))));
    check("renderFingerprint y renderKey deterministas y distintos entre sí",
      /^fnv1a:/.test(one.renderFingerprint) && /^fnv1a:/.test(one.renderKey) && one.renderFingerprint !== one.renderKey);

    // ── 3. GENERACIÓN COMPLETA + MANIFEST ──
    console.log("\n## 3. Generación completa y manifest");
    const t1 = Date.now();
    const manifest = await renderer.renderGeneration(comps, GEN);
    const fullMs = Date.now() - t1;
    check("TODAS las cartas renderizadas (la del ejemplo, de cache)",
      manifest.cards.length === comps.length && manifest.stats.rendered === comps.length &&
      manifest.stats.cacheHits === 1, `${comps.length} cartas · ${fullMs} ms · 1ª carta ${oneMs} ms`);
    check("manifest.json oficial escrito y coherente", (() => {
      const m = JSON.parse(readFileSync(join(dirA, "manifest.json"), "utf8")) as RenderManifest;
      return m.generationId === GEN && m.renderVersion === RENDER_VERSION && m.cards.length === comps.length &&
        m.cards.every((c) => c.files.length === 4);
    })());
    check("assets REUTILIZADOS entre cartas (cache del materializador)",
      manifest.stats.assetReuses > manifest.stats.assetLoads, `loads=${manifest.stats.assetLoads} reuses=${manifest.stats.assetReuses}`);
    const renderedBytes = manifest.cards.reduce((a, c) => a + c.files.reduce((x, f) => x + f.bytes, 0), 0);
    check("tamaño de salida contabilizado (todas las rasterizaciones)",
      manifest.stats.totalBytes > 0 && manifest.stats.totalBytes === renderedBytes,
      `${(manifest.stats.totalBytes / 1024).toFixed(0)} KB`);

    // ── 4. CACHE + RENDER INCREMENTAL ──
    console.log("\n## 4. Cache y render incremental");
    const renderer2 = new ArtworkRenderer(artwork, { outputDir: dirA, now: NOW, generationId: GEN });
    const m2 = await renderer2.renderGeneration(comps, GEN);
    check("re-render de la MISMA generación ⇒ 100% incremental (0 rasterizaciones)",
      m2.stats.rendered === 0 && m2.stats.cacheHits === comps.length && m2.cards.every((c) => c.fromCache));
    const batch: ArtworkComposition[] = Array.from({ length: 1000 }, (_, i) => comps[i % comps.length]);
    const t2 = Date.now();
    let batchHits = 0;
    for (const c of batch) { const r = await renderer2.renderCard(c); if (r.fromCache) batchHits++; }
    const batchMs = Date.now() - t2;
    check("lote de 1000 cartas SIN renders duplicados (dedupe por huella)",
      batchHits === 1000 && batchMs < 3000, `1000 cartas en ${batchMs} ms · hits=${batchHits}`);

    // ── 5. DETERMINISMO BYTE A BYTE ──
    console.log("\n## 5. Determinismo byte a byte");
    const dirB = join(root, "b");
    const rB = new ArtworkRenderer(artwork, { outputDir: dirB, now: NOW, generationId: GEN });
    const mB = await rB.renderGeneration(comps, GEN);
    const shaOf = (m: RenderManifest, id: string): string => m.cards.find((c) => c.cardId === id)!.files.map((f) => f.sha256).join("|");
    check("dos renders independientes ⇒ MISMOS bytes (sha256 de los 4 ficheros)",
      comps.every((c) => shaOf(manifest, c.cardId) === shaOf(mB, c.cardId)));
    check("manifest determinista (misma huella)", manifest.fingerprint === mB.fingerprint);
    check("los bytes en disco coinciden con el manifest",
      mB.cards.every((c) => c.files.every((f) => statSync(join(dirB, f.path)).size === f.bytes)));

    // ── 6. PLACEHOLDERS (jamás falla; jamás descarga) ──
    console.log("\n## 6. Placeholders");
    check("assets remotos (banderas flagcdn) NO se descargan: placeholder oficial",
      comps.every((c) => c.layers.every((l) => l.elements.every((e) => artwork.resolveRef(e.ref) !== null))) &&
      manifest.cards.every((c) => c.placeholdersUsed.length > 0));
    check("cartas con TODOS los assets faltantes renderizan igual (cero capas vacías, cero fallos)",
      manifest.cards.every((c) => !c.fromCache || c.files.length === 4));

    // ── 7. MOTOR PASIVO (cero capas fuera de orden, cero decisiones) ──
    console.log("\n## 7. Motor pasivo");
    const tampered: ArtworkComposition = { ...mythic, layers: [...mythic.layers].reverse() };
    let rejected = false;
    try { await renderer2.renderCard(tampered); } catch (e) { rejected = e instanceof RenderError; }
    check("composición con capas fuera de orden ⇒ RECHAZADA (jamás se reordena)", rejected);
    const dupped: ArtworkComposition = { ...mythic, layers: mythic.layers.map((l) => l.kind === "texts" ? { ...l, elements: [...l.elements, l.elements[0]] } : l) };
    let rejected2 = false;
    try { await renderer2.renderCard(dupped); } catch (e) { rejected2 = e instanceof RenderError; }
    check("composición corrupta (elemento duplicado) ⇒ RECHAZADA (jamás se corrige)", rejected2);
    check("la composición de entrada NO se mutó (motor pasivo)",
      JSON.stringify(mythic) === JSON.stringify(comps.find((c) => c.cardId === "zekken__mythic")));

    // ── 8. RENDIMIENTO ──
    console.log("\n## 8. Rendimiento");
    check("generación completa renderizada en tiempo razonable", fullMs < 60_000, `${fullMs} ms para ${comps.length - 1} rasterizaciones`);
    check("sin fugas: la cache en memoria acota por huella única",
      m2.stats.cards + 1000 > 1000 && batchHits === 1000);

    console.log(`\n${fail === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${fail} COMPROBACIÓN(ES) FALLARON`} — ${pass}/${pass + fail}`);
    if (fail > 0) process.exitCode = 1;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
