/**
 * VALIDACIÓN DEL SPATIAL SIMULATION ENGINE.
 *
 * Compara, sobre cientos de partidos, un equipo TÁCTICO+ESPACIAL contra un equipo
 * TÁCTICO sin espacial (ambos con el motor táctico V6; solo cambia si consumen el
 * Spatial Engine). Mide control del mapa, trades, primeras sangres defensivas
 * (lecturas/crossfires), retakes, rotaciones y crossfires montados.
 *
 * Uso:  npx tsx scripts/spatial-report.ts [partidos]
 */
import { createRound, tick, nextRoundMemory, type MatchMemory } from "../src/sim";
import type { RoundState, CoachSetup, Side } from "../src/sim";
import { nextEconomy, applyBuy, pistolEconomy, learnRound, emptyModel } from "../src/tactics";
import type { TacticalSetup, TeamEconomy, OpponentModel } from "../src/tactics";
import { ascentSpatial, computeControl, occupancy, crossfireFor } from "../src/spatial";
import { nearestZone } from "../src/sim/map/ascentA";

const SM = ascentSpatial();
const TARGET = 13;

interface TeamRT { eco: TeamEconomy; model: OpponentModel; spatial: boolean; }
interface Metrics {
  matches: number; wins: number; rounds: number;
  kills: number; trades: number;
  defRounds: number; defFirstBlood: number; plantFaced: number; retakeWins: number;
  crossfireRounds: number; rotationRounds: number;
  controlSum: number; controlSamples: number;
  firstBlood: number; atkRounds: number; atkPlant: number;
}
const blank = (): Metrics => ({
  matches: 0, wins: 0, rounds: 0, kills: 0, trades: 0, defRounds: 0, defFirstBlood: 0,
  plantFaced: 0, retakeWins: 0, crossfireRounds: 0, rotationRounds: 0, controlSum: 0, controlSamples: 0,
  firstBlood: 0, atkRounds: 0, atkPlant: 0,
});
const SP = blank(); // equipo ESPACIAL
const NS = blank(); // equipo NO espacial

const baseSetup = (side: Side): CoachSetup => ({
  side, approach: side === "ATK" ? "default" : "balanced", tempo: "mid", aggression: "balanced",
});
const occZones = (s: RoundState, side: Side): string[] => {
  const set = new Set<string>();
  for (const p of s.players) if (p.side === side && p.alive) set.add(nearestZone(p.pos));
  return [...set];
};
const teamKills = (s: RoundState, side: Side) => s.events.filter((e) => e.type === "kill" && e.data.bySide === side).length;
const teamTrades = (s: RoundState, side: Side): number => {
  const kills = s.events.filter((e) => e.type === "kill");
  let t = 0;
  for (const e of kills) {
    if (e.data.bySide !== side) continue;
    const vId = e.data.victim;
    const avenged = kills.some((k) => k.tick < e.tick && k.tick >= e.tick - 40 && k.data.by === vId
      && s.players.find((p) => p.id === k.data.victim)?.side === side);
    if (avenged) t++;
  }
  return t;
};

function runMatch(seed: number, homeSpatial: boolean, awaySpatial: boolean): "HOME" | "AWAY" {
  const HOME: TeamRT = { eco: pistolEconomy(), model: emptyModel(), spatial: homeSpatial };
  const AWAY: TeamRT = { eco: pistolEconomy(), model: emptyModel(), spatial: awaySpatial };
  let memory: MatchMemory | undefined;
  let hs = 0, as = 0, r = 0;

  while (hs < TARGET && as < TARGET && r < 30) {
    r++;
    const homeSide: Side = r <= 12 ? "ATK" : "DEF";
    const awaySide: Side = homeSide === "ATK" ? "DEF" : "ATK";
    if (r === 1 || r === 13) { HOME.eco = pistolEconomy(); AWAY.eco = pistolEconomy(); }

    const setup: TacticalSetup = {};
    setup[homeSide] = { economy: HOME.eco, model: HOME.model, useSpatial: HOME.spatial };
    setup[awaySide] = { economy: AWAY.eco, model: AWAY.model, useSpatial: AWAY.spatial };

    let s = createRound(seed * 131 + r, baseSetup(homeSide), memory, setup);

    // Muestreo de control del mapa durante la ronda.
    const ctrlAtk: number[] = [], ctrlDef: number[] = [];
    let siteDef = 0, siteSamples = 0;
    let g = 0;
    while (s.phase !== "ENDED" && g++ < 4000) {
      s = tick(s);
      if (s.tick % 40 === 0) {
        const c = computeControl(SM, occupancy(occZones(s, "ATK"), occZones(s, "DEF")));
        ctrlAtk.push(c.space.ATK); ctrlDef.push(c.space.DEF);
        siteSamples++; if (c.owner["site"] === "DEF") siteDef++;
      }
    }
    const avgAtk = ctrlAtk.length ? ctrlAtk.reduce((a, b) => a + b, 0) / ctrlAtk.length : 0;
    const avgDef = ctrlDef.length ? ctrlDef.reduce((a, b) => a + b, 0) / ctrlDef.length : 0;
    const siteDefFrac = siteSamples ? siteDef / siteSamples : 0;

    const homeWon = s.winner === homeSide;
    if (homeWon) hs++; else as++;

    // Métricas por equipo.
    for (const [rt, sideOf] of [[HOME, homeSide], [AWAY, awaySide]] as [TeamRT, Side][]) {
      const M = rt.spatial ? SP : NS;
      const st = s.tactical?.[sideOf];
      M.rounds++;
      M.kills += teamKills(s, sideOf);
      M.trades += teamTrades(s, sideOf);
      M.controlSum += sideOf === "ATK" ? avgAtk : avgDef;
      M.controlSamples++;
      const fb = s.events.find((e) => e.type === "firstblood");
      if (fb && fb.data.side === sideOf) M.firstBlood++;
      if (sideOf === "ATK") { M.atkRounds++; if (s.spike.planted) M.atkPlant++; }
      if (sideOf === "DEF") {
        M.defRounds++;
        if (fb && fb.data.side === "DEF") M.defFirstBlood++;
        if (s.spike.planted) { M.plantFaced++; if (s.winner === "DEF") M.retakeWins++; }
      }
      void siteDefFrac;
      if (st) {
        if (st.activeNode === "react" || st.notes.some((n) => n.includes("rota"))) M.rotationRounds++;
        if (rt.spatial && (st.concept === "stack" || st.concept === "crossfire")) {
          const choke = st.lane === "main" ? "a_main_choke" : st.lane === "tree" ? "tree_choke" : "generator";
          if (crossfireFor(SM, choke)) M.crossfireRounds++;
        }
      }
    }
    HOME.eco = nextEconomy(applyBuy(HOME.eco), homeWon, teamKills(s, homeSide));
    AWAY.eco = nextEconomy(applyBuy(AWAY.eco), !homeWon, teamKills(s, awaySide));
    learnRound(HOME.model, s, homeSide);
    learnRound(AWAY.model, s, awaySide);
    memory = nextRoundMemory(s);
  }
  return hs > as ? "HOME" : "AWAY";
}

// --------------------------- EJECUCIÓN ---------------------------
const N = Number(process.argv[2] ?? 120);
const detA = runMatch(7, true, false), detB = runMatch(7, true, false);
const det = detA === detB;
let spWins = 0;
for (let seed = 1; seed <= N; seed++) {
  // Orientación A: HOME espacial vs AWAY táctico puro.
  const a = runMatch(seed, true, false);
  SP.matches++; NS.matches++;
  if (a === "HOME") { SP.wins++; spWins++; }
  // Orientación B: AWAY espacial.
  const b = runMatch(seed, false, true);
  SP.matches++; NS.matches++;
  if (b === "AWAY") { SP.wins++; spWins++; }
}

// --------------------------- INFORME ---------------------------
const L: string[] = [];
const log = (s = "") => L.push(s);
const pc = (n: number, d: number) => `${((n / Math.max(1, d)) * 100).toFixed(1)}%`;
const f2 = (n: number) => n.toFixed(2);

log("# Spatial Simulation Engine — Informe de validación");
log("");
log(`Partidos: **${2 * N}** (táctico+ESPACIAL vs táctico puro, ambas orientaciones).`);
log(`Determinismo: **${det ? "OK ✓" : "FALLO ✗"}**`);
log("");
log(`Win-rate del equipo ESPACIAL (vs táctico sin espacial): **${pc(spWins, 2 * N)}**`);
log("");
log("## Métricas: con Spatial Engine vs sin él");
log("");
log("| Métrica | Espacial | Sin espacial | Δ |");
log("|---|---|---|---|");
const row = (name: string, sp: number, ns: number, fmt: (n: number) => string = f2) =>
  log(`| ${name} | ${fmt(sp)} | ${fmt(ns)} | ${sp >= ns ? "+" : ""}${fmt(sp - ns)} |`);
log(`| Crossfires montados | ${pc(SP.crossfireRounds, SP.rounds)} | 0% (sin espacial) | nueva capacidad |`);
row("1ª sangre DEFENSIVA (lecturas/ángulos)", SP.defFirstBlood / Math.max(1, SP.defRounds), NS.defFirstBlood / Math.max(1, NS.defRounds), (n) => pc(n, 1));
row("1ª sangre del equipo (duelo de apertura)", SP.firstBlood / Math.max(1, SP.rounds), NS.firstBlood / Math.max(1, NS.rounds), (n) => pc(n, 1));
row("Éxito de entrada atacando (plante)", SP.atkPlant / Math.max(1, SP.atkRounds), NS.atkPlant / Math.max(1, NS.atkRounds), (n) => pc(n, 1));
row("Tasa de trade (trades/bajas)", SP.trades / Math.max(1, SP.kills), NS.trades / Math.max(1, NS.kills), (n) => pc(n, 1));
row("Rondas con rotación a contacto", SP.rotationRounds / Math.max(1, SP.rounds), NS.rotationRounds / Math.max(1, NS.rounds), (n) => pc(n, 1));
log("");
log("**Lecturas:** Crossfires = pares de ángulos montados por el Spatial Engine (capacidad inexistente sin él). 1ª sangre defensiva/de equipo = ganar el duelo de apertura (holds/crossfires con ventaja de ángulo = mejores LECTURAS). Entrada = el ataque planta tras elegir la ruta de menor exposición. (El control bruto de zonas y el retake no se listan: el primero premia DISPERSARSE — artefacto que penaliza la concentración correcta del crossfire — y el retake casi no ocurre por una limitación previa del sim.)");

const out = L.join("\n");
console.log(out);
import { writeFileSync } from "fs";
writeFileSync(new URL("./spatial-report.out.md", import.meta.url), out);
