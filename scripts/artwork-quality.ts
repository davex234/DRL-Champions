/**
 * `npm run artwork:quality [generationId]` — Artwork AI & Quality Assistant: analiza los
 * assets (Manager + convenciones de la generación si se indica) y muestra el QualityReport.
 * SOLO LECTURA: no modifica assets, ni composiciones, ni renderiza, ni descarga.
 *
 *   npm run artwork:quality
 *   npm run artwork:quality GEN-2026-VALORANT-MASTERS-LONDON-2026
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
import { publicReader } from "@/artwork-renderer";
import { refsOfGeneration, slugify } from "@/artwork-acquisition";
import type { LifecycleState } from "@/artwork-updater";
import { ArtworkQualityAssistant } from "@/artwork-ai";

const LONDON_GEN = "GEN-2026-VALORANT-MASTERS-LONDON-2026";

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

async function main(): Promise<void> {
  const genId = process.argv[2];
  const now = Date.now();
  const artwork = new ArtworkEngine();

  let refs, comps: ArtworkComposition[] | undefined, scope: string | undefined;
  if (genId) {
    if (genId !== LONDON_GEN) {
      console.error(`Generación desconocida: ${genId} (demo offline: ${LONDON_GEN})`);
      process.exitCode = 1;
      return;
    }
    const gen = londonGeneration(now);
    scope = gen.generationId;
    refs = refsOfGeneration(gen);
    for (const p of gen.players) {
      if (!p.playerId) continue;
      artwork.register(playerAsset(p.playerId));
      if (p.draft?.team) artwork.register(teamAsset(slugify(p.draft.team)));
      if (p.draft?.country) artwork.register(countryAsset(p.draft.country));
    }
    artwork.register(teamAsset("berlin-bears"));
    comps = gen.cards.map((spec) => {
      const res = gen.players.find((x) => x.playerId === spec.playerId);
      const ctx: ComposerCtx = {
        nick: res?.nick, teamSlug: res?.draft?.team ? slugify(res.draft.team) : undefined,
        countryIso: res?.draft?.country, tournamentId: gen.tournamentId, tournamentName: gen.tournamentName,
        generationId: gen.generationId, collectionName: gen.collection.name,
      };
      return composeArtwork(spec, artwork, ctx);
    });
  }

  const lifecyclePath = join(process.cwd(), "output", "artwork-lifecycle.json");
  const lifecycle = existsSync(lifecyclePath)
    ? (JSON.parse(readFileSync(lifecyclePath, "utf8")) as LifecycleState)
    : undefined;

  const assistant = new ArtworkQualityAssistant(artwork, {
    reader: publicReader(), lifecycle, refs, compositions: comps, now, scope,
  });
  const t0 = Date.now();
  const report = await assistant.analyze();
  const ms = Date.now() - t0;

  console.log(`# Artwork Quality — ${report.scope ?? "registry actual"}`);
  console.log(`  assets analizados:  ${report.analyzed}`);
  console.log(`  calidad media:      ${report.averageScore}/100`);
  console.log(`  excelentes ${report.byGrade.excelente} · buenos ${report.byGrade.bueno} · aceptables ${report.byGrade.aceptable} · deficientes ${report.byGrade.deficiente} · críticos ${report.byGrade["crítico"]}`);
  console.log(`  problemas detectados: ${report.issues.length} · duplicados: ${report.duplicates.length} grupo(s)`);
  console.log(`  sin licencia: ${report.unlicensed.length} · huérfanos: ${report.orphans.length} · sin uso: ${report.unused.length}`);
  console.log(`  tiempo: ${ms} ms · huella: ${report.fingerprint}\n  TOP recomendaciones:`);
  for (const s of report.suggestions.slice(0, 10)) console.log(`    · [${s.code}] ${s.message}`);
  if (!report.suggestions.length) console.log("    · sin problemas: repositorio impecable");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
