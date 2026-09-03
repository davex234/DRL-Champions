/**
 * `npm run artwork:render <generationId|ruta.json> [outputDir]` — renderiza TODAS las cartas
 * de una generación (Artwork Pipeline F3): compone cada CardSpec con el Artwork Composer
 * (congelado) y las materializa con el Artwork Renderer a PNG · WEBP · thumbnail · preview
 * + manifest.json en `output/artwork/<generationId>/`.
 *
 *   npm run artwork:render GEN-2026-VALORANT-MASTERS-LONDON-2026   (demo offline oficial)
 *   npm run artwork:render ruta/a/generacion.json                  (CardGenerationResult)
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  importSnapshot, makeClock, createIdentityResolver, buildRegistry, type RawSnapshot, type ImportCtx,
} from "@/importer";
import { analyze } from "@/analyzer";
import { generateCards, type CardGenerationResult } from "@/card-generator";
import { allPlayers } from "@/data/catalog";
import { ArtworkEngine, playerAsset, teamAsset, countryAsset } from "@/artwork";
import { composeArtwork, type ArtworkComposition, type ComposerCtx } from "@/artwork-composer";
import { ArtworkRenderer } from "@/artwork-renderer";

const LONDON_GEN = "GEN-2026-VALORANT-MASTERS-LONDON-2026";

const slug = (s: string): string => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** Demo OFICIAL offline: la generación obligatoria (mismo fixture que los verifies). */
function londonGeneration(now: number): CardGenerationResult {
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
  const ictx: ImportCtx = { clock: makeClock(now), identity: createIdentityResolver(buildRegistry([])) };
  return generateCards(analyze(importSnapshot(LONDON, ictx).model), { roster: allPlayers(), now });
}

/** Compone TODA la generación (Composer congelado) con su contexto por carta. */
export function composeGeneration(gen: CardGenerationResult, artwork: ArtworkEngine): ArtworkComposition[] {
  for (const p of gen.players) {
    if (!p.playerId) continue;
    artwork.register(playerAsset(p.playerId));
    if (p.draft?.team) artwork.register(teamAsset(slug(p.draft.team)));
    if (p.draft?.country) artwork.register(countryAsset(p.draft.country));
  }
  return gen.cards.map((spec) => {
    const res = gen.players.find((p) => p.playerId === spec.playerId);
    const ctx: ComposerCtx = {
      nick: res?.nick,
      teamSlug: res?.draft?.team ? slug(res.draft.team) : undefined,
      countryIso: res?.draft?.country,
      role: res?.draft?.role?.toLowerCase(),
      region: res?.draft?.region?.toLowerCase(),
      tournamentId: gen.tournamentId,
      tournamentName: gen.tournamentName,
      generationId: gen.generationId,
      collectionName: gen.collection.name,
    };
    return composeArtwork(spec, artwork, ctx);
  });
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!arg) {
    console.error("Uso: npm run artwork:render <generationId|ruta.json> [outputDir]");
    process.exitCode = 1;
    return;
  }
  const now = Date.now();

  let gen: CardGenerationResult;
  if (arg === LONDON_GEN) {
    gen = londonGeneration(now);
  } else if (existsSync(arg)) {
    const raw = JSON.parse(readFileSync(arg, "utf8")) as CardGenerationResult | { generation: CardGenerationResult };
    gen = "generation" in raw ? raw.generation : raw;
  } else {
    console.error(`Generación desconocida: ${arg}\n(usa ${LONDON_GEN} para la demo offline, o la ruta a un CardGenerationResult en JSON)`);
    process.exitCode = 1;
    return;
  }

  const outputDir = process.argv[3] ?? join(process.cwd(), "output", "artwork", gen.generationId);
  const artwork = new ArtworkEngine();
  const comps = composeGeneration(gen, artwork);
  const renderer = new ArtworkRenderer(artwork, { outputDir, now, generationId: gen.generationId });

  console.log(`# Artwork Render — ${gen.generationId}`);
  console.log(`  cartas: ${comps.length} · salida: ${outputDir}\n`);
  const t0 = Date.now();
  const manifest = await renderer.renderGeneration(comps, gen.generationId);
  const ms = Date.now() - t0;

  const s = manifest.stats;
  console.log(`  ✓ renderizadas: ${s.rendered} · cache: ${s.cacheHits}`);
  console.log(`  ✓ assets cargados: ${s.assetLoads} · reutilizados: ${s.assetReuses}`);
  console.log(`  ✓ tamaño total: ${(s.totalBytes / 1024).toFixed(0)} KB · tiempo: ${ms} ms`);
  console.log(`  ✓ manifest: ${join(outputDir, "manifest.json")} (huella ${manifest.fingerprint})`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
