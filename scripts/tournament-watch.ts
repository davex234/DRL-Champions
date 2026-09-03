/**
 * `npm run tournament:watch [snapshots.json ...]` — Watch Engine (Tournament Watcher F1):
 * observa snapshots de torneos, detecta cambios y emite eventos. NUNCA ejecuta el pipeline,
 * ni publica, ni descarga: solo observación. Sin argumentos corre la demo offline oficial
 * (Masters London A → B con Heretics eliminado). Con rutas JSON (RawSnapshot o lista de
 * RawSnapshot) observa cada fichero en orden, persistiendo el registry entre pasadas.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { RawSnapshot } from "@/importer";
import {
  WatchEngine, createWatcherRegistry, watchMetrics, type WatcherRegistry,
} from "@/tournament-watcher";

const REGISTRY_PATH = join(process.cwd(), "output", "tournament-watcher.json");

const LONDON_A: RawSnapshot = {
  tournament: { id: "valorant-masters-london-2026", name: "Valorant Masters London 2026", type: "international", tier: "vct-international", status: "ongoing", startDate: "2026-06-05T00:00:00Z", endDate: "2026-06-21T00:00:00Z", location: "Copper Box Arena, London" },
  stages: [{ id: "st-po", name: "Playoffs", kind: "playoff", orderIdx: 0 }],
  teams: [
    { id: "lln", name: "London Lions", region: "EMEA", active: true },
    { id: "mwv", name: "Madrid Wolves", region: "EMEA" },
    { id: "th", name: "Team Heretics", region: "EMEA" },
  ],
  players: [
    { id: "zk", nick: "zekken", team: "London Lions", role: "duelist", agents: ["Jett"] },
    { id: "lf", nick: "Lyncher", team: "London Lions", role: "initiator", agents: ["Sova"] },
    { id: "wk", nick: "Wolfrik", team: "Madrid Wolves", role: "sentinel", agents: ["Killjoy"] },
  ],
  coaches: [],
  matches: [
    { id: "m1", stageId: "st-po", teamA: "London Lions", teamB: "Team Heretics", status: "live", format: "bo3", scoreA: 1, scoreB: 1, round: "Semifinal", matchOrder: 1 },
  ],
  maps: [
    { id: "m1a", matchId: "m1", map: "Ascent", mapOrder: 1, scoreA: 13, scoreB: 10, winner: "London Lions" },
  ],
  mapStats: [
    { matchMapId: "m1a", matchId: "m1", player: "zekken", team: "London Lions", agent: "Jett", acs: 280, kills: 18, deaths: 12, assists: 3 },
  ],
  standings: [
    { team: "London Lions", position: 1, wins: 1, losses: 0 },
    { team: "Madrid Wolves", position: 2, wins: 1, losses: 0 },
    { team: "Team Heretics", position: 3, wins: 0, losses: 0 },
  ],
  awards: {},
};

const LONDON_B: RawSnapshot = {
  ...LONDON_A,
  matches: [
    { ...LONDON_A.matches[0], status: "finished", scoreA: 2, scoreB: 1, winner: "London Lions" },
  ],
  maps: [
    // `RawSnapshot.maps` es opcional en el modelo canónico (`src/importer/types.ts`),
    // así que el spread necesita un array por defecto.
    ...(LONDON_A.maps ?? []),
    { id: "m1b", matchId: "m1", map: "Bind", mapOrder: 2, scoreA: 9, scoreB: 13, winner: "Team Heretics" },
    { id: "m1c", matchId: "m1", map: "Haven", mapOrder: 3, scoreA: 13, scoreB: 7, winner: "London Lions" },
  ],
  standings: [
    { team: "London Lions", position: 1, wins: 2, losses: 0, status: "qualified" },
    { team: "Madrid Wolves", position: 2, wins: 1, losses: 0 },
    { team: "Team Heretics", position: 3, wins: 0, losses: 1, status: "eliminated" },
  ],
};

async function main(): Promise<void> {
  const files = process.argv.slice(2);
  const now = Date.now();

  const registry: WatcherRegistry = files.length && existsSync(REGISTRY_PATH)
    ? (JSON.parse(readFileSync(REGISTRY_PATH, "utf8")) as WatcherRegistry)
    : createWatcherRegistry();
  const engine = new WatchEngine(registry);

  const batches: RawSnapshot[][] = files.length
    ? files.map((f) => {
        const raw = JSON.parse(readFileSync(f, "utf8")) as RawSnapshot | RawSnapshot[];
        return Array.isArray(raw) ? raw : [raw];
      })
    : [[LONDON_A], [LONDON_B]];

  console.log(`# Tournament Watch — Watch Engine (solo observación)`);
  const t0 = Date.now();
  let changes = 0, emitted = 0;
  for (const [i, batch] of batches.entries()) {
    const results = engine.observeBatch(batch, { at: now + i });
    for (const r of results) {
      changes += r.changed ? 1 : 0;
      emitted += r.events.length;
      for (const e of r.events) {
        console.log(`  · [${e.kind}] ${e.tournamentId}${e.subject && e.subject !== e.tournamentId ? ` — ${e.subject}` : ""}${e.detail ? ` (${e.detail})` : ""}`);
      }
    }
  }
  const ms = Date.now() - t0;
  const m = watchMetrics(engine.registry);

  console.log(`\n  torneos observados: ${m.observed} (activos ${m.active} · terminados ${m.finished} · retirados ${m.removed})`);
  console.log(`  cambios detectados: ${changes} · eventos emitidos: ${emitted} · revisiones: ${m.revisions}`);
  console.log(`  tiempo: ${ms} ms`);

  if (files.length) {
    mkdirSync(dirname(REGISTRY_PATH), { recursive: true });
    writeFileSync(REGISTRY_PATH, JSON.stringify(engine.registry, null, 2));
    console.log(`  registry persistido: ${REGISTRY_PATH}`);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
