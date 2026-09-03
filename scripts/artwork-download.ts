/**
 * `npm run artwork:download <generationId|ruta.json> [--manifest proveedores.json]` —
 * recorre TODAS las cartas de una generación, detecta los assets que faltan (Artwork
 * Manager) y ejecuta el Asset Acquisition Engine. SOLO adquiere y registra assets:
 * no genera cartas, no renderiza imágenes.
 *
 *   npm run artwork:download GEN-2026-VALORANT-MASTERS-LONDON-2026
 *   npm run artwork:download GEN-... -- --manifest mis-proveedores.json
 *
 * El manifiesto de proveedores es un JSON [{category, subjectId, url, license?, score?}].
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  importSnapshot, makeClock, createIdentityResolver, buildRegistry, type RawSnapshot, type ImportCtx,
} from "@/importer";
import { analyze } from "@/analyzer";
import { generateCards, type CardGenerationResult } from "@/card-generator";
import { allPlayers } from "@/data/catalog";
import { ArtworkEngine } from "@/artwork";
import {
  AcquisitionEngine, LocalDirectoryProvider, StaticManifestProvider,
  type AssetProvider, type StaticManifestEntry,
} from "@/artwork-acquisition";

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
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const arg = args[0];
  if (!arg) {
    console.error("Uso: npm run artwork:download <generationId|ruta.json> [--manifest proveedores.json]");
    process.exitCode = 1;
    return;
  }
  const now = Date.now();

  let gen: CardGenerationResult;
  if (arg === LONDON_GEN) gen = londonGeneration(now);
  else if (existsSync(arg)) {
    const raw = JSON.parse(readFileSync(arg, "utf8")) as CardGenerationResult | { generation: CardGenerationResult };
    gen = "generation" in raw ? raw.generation : raw;
  } else {
    console.error(`Generación desconocida: ${arg} (usa ${LONDON_GEN} para la demo offline o una ruta JSON)`);
    process.exitCode = 1;
    return;
  }

  const assetsRoot = join(process.cwd(), "public");
  const providers: AssetProvider[] = [new LocalDirectoryProvider(assetsRoot)];
  const mIdx = args.indexOf("--manifest");
  if (mIdx >= 0 && args[mIdx + 1]) {
    const entries = JSON.parse(readFileSync(args[mIdx + 1], "utf8")) as StaticManifestEntry[];
    providers.push(new StaticManifestProvider("static-manifest", entries, async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
      return new Uint8Array(await res.arrayBuffer());
    }));
  }

  const artwork = new ArtworkEngine();
  const engine = new AcquisitionEngine(artwork, { providers, assetsRoot, now });

  console.log(`# Artwork Download — ${gen.generationId}`);
  const t0 = Date.now();
  const report = await engine.acquireForGeneration(gen);
  const ms = Date.now() - t0;

  console.log(`\n  assets requeridos:   ${report.required}`);
  console.log(`  ya disponibles:      ${report.available}`);
  console.log(`  encontrados:         ${report.found} candidato(s)`);
  console.log(`  descargados:         ${report.downloaded}`);
  console.log(`  reutilizados:        ${report.reused}`);
  console.log(`  rechazados:          ${report.rejected}`);
  console.log(`  pendientes:          ${report.pending}`);
  console.log(`  cache: descargas ${report.cache.downloadHits} · validaciones ${report.cache.validationHits} · conversiones ${report.cache.normalizationHits}`);
  console.log(`  tiempo: ${ms} ms · huella: ${report.fingerprint}`);
  for (const r of report.results.filter((x) => x.outcome === "pending" || x.outcome === "rejected")) {
    console.log(`    · ${r.outcome === "pending" ? "⏳" : "✗"} ${r.target.category}:${r.target.subjectId}${r.issues?.length ? ` — ${r.issues[0].code}` : ""}`);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
