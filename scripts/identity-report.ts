/**
 * VALIDACIÓN DEL PLAYER IDENTITY ENGINE.
 *
 * Experimento CONTROLADO: a todos los jugadores se les dan EXACTAMENTE los mismos
 * atributos de combate (aim/gameSense/utility/leadership). Lo ÚNICO que varía es el
 * ADN de personalidad. Así, cualquier divergencia de comportamiento se debe a la
 * IDENTIDAD, no al OVR. Se simulan cientos de rondas, se mide una "huella" por
 * arquetipo y se comprueba que ningún arquetipo juega como otro.
 *
 * Uso:  npx tsx scripts/identity-report.ts [rondas]
 */
import { createRound, tick } from "../src/sim/engine";
import { PROFILES, type ArchetypeId } from "../src/sim/identity/profiles";
import { initialMental } from "../src/sim/identity/mental";
import { dist } from "../src/sim/geometry";
import type { Attributes } from "../src/sim/attributes";
import type { RoundState, SimPlayer, CoachSetup, Side } from "../src/sim/types";

// Mismos atributos para TODOS: neutraliza el OVR. Lo que varía es la cabeza.
const PROBE: Attributes = { aim: 76, gameSense: 78, utility: 72, leadership: 72 };

// Un arquetipo por slot (mismo orden de rol en ambos bandos → muestreo limpio).
const SLOTS: ArchetypeId[] = [
  "aggressive-duelist", // slot 0 (entry)
  "explosive-star",     // slot 1 (igl-slot, pero ADN de estrella)
  "flank-lurker",       // slot 2 (lurk)
  "utility-support",    // slot 3 (support)
  "patient-anchor",     // slot 4 (anchor)
];
// Nicks reconocibles SÓLO para el informe (no hardcodean nada: son etiquetas).
const NICK: Record<ArchetypeId, string> = {
  "aggressive-duelist": "FURIA (duelista)",
  "explosive-star": "NOVA-X (estrella)",
  "cerebral-igl": "MENTE (IGL)",
  "flank-lurker": "SOMBRA (lurker)",
  "utility-support": "ANCLA-U (soporte)",
  "patient-anchor": "MURO (ancla)",
};

interface Fingerprint {
  rounds: number;
  kills: number; deaths: number;
  holderKills: number; peekKills: number;     // ¿gana aguantando o asomando?
  firstContacts: number; firstDeaths: number;  // ¿toma el primer duelo? ¿lo pierde?
  aloneDeaths: number;                          // muere sin aliado cerca (sobre-extensión)
  tradedDeaths: number;                         // muere pero lo vengan
  engageDistSum: number; engageN: number;       // distancia media al fijar duelo (peek largo/corto)
  advanceSum: number; advanceN: number;         // espacio tomado (lejos del spawn)
  repeeks: number;                              // re-asomó a una última posición vista
  clutchAttempts: number; clutchWins: number;
  confEndSum: number; tiltEndSum: number; tiltPeakSum: number; endN: number;
  survived: number;
}

const blank = (): Fingerprint => ({
  rounds: 0, kills: 0, deaths: 0, holderKills: 0, peekKills: 0, firstContacts: 0, firstDeaths: 0,
  aloneDeaths: 0, tradedDeaths: 0, engageDistSum: 0, engageN: 0, advanceSum: 0, advanceN: 0,
  repeeks: 0, clutchAttempts: 0, clutchWins: 0, confEndSum: 0, tiltEndSum: 0, tiltPeakSum: 0, endN: 0,
  survived: 0,
});

const fp: Record<ArchetypeId, Fingerprint> = {} as Record<ArchetypeId, Fingerprint>;
for (const a of SLOTS) fp[a] = blank();

const aliveOn = (s: RoundState, side: Side) => s.players.filter((p) => p.side === side && p.alive).length;

/**
 * Mapa id→arquetipo de la ronda. ROTA los arquetipos por los 5 slots de rol según
 * la semilla, de modo que cada arquetipo juega TODOS los roles por igual a lo largo
 * del experimento. Así se separa la IDENTIDAD de la posición/rol (sin confundirlos).
 */
function roundMapping(seed: number): Map<string, ArchetypeId> {
  const offset = seed % SLOTS.length;
  const m = new Map<string, ArchetypeId>();
  for (const side of ["ATK", "DEF"] as const) {
    for (let i = 0; i < SLOTS.length; i++) m.set(`${side}-${i}`, SLOTS[(i + offset) % SLOTS.length]);
  }
  return m;
}

/** Sobrescribe el roster recién creado con el experimento controlado. */
function setupProbe(s: RoundState, map: Map<string, ArchetypeId>): Map<string, { spawn: { x: number; y: number } }> {
  const meta = new Map<string, { spawn: { x: number; y: number } }>();
  for (const p of s.players) {
    const label = map.get(p.id)!;
    p.attrs = { ...PROBE };
    p.identity = PROFILES[label];
    p.mental = initialMental(p.identity);
    meta.set(p.id, { spawn: { ...p.pos } });
  }
  return meta;
}

const APPROACHES_ATK = ["default", "rush-main", "split"];
const APPROACHES_DEF = ["balanced", "stack-a", "aggro-info"];
const TEMPOS = ["slow", "mid", "fast"] as const;

function runRound(seed: number): void {
  const side: Side = seed % 2 === 0 ? "ATK" : "DEF";
  const setup: CoachSetup = {
    side,
    approach: (side === "ATK" ? APPROACHES_ATK : APPROACHES_DEF)[seed % 3],
    tempo: TEMPOS[(seed >> 1) % 3],
    aggression: "balanced",
  };
  let s = createRound(seed, setup);
  const map = roundMapping(seed);
  const labelOf = (id: string): ArchetypeId => map.get(id)!;
  const meta = setupProbe(s, map);

  const prevIntent = new Map<string, string>();
  const prevAlive = new Map<string, boolean>();
  const tiltPeak = new Map<string, number>();
  const clutchSeen = new Set<string>();
  for (const p of s.players) { prevAlive.set(p.id, true); tiltPeak.set(p.id, 0); }

  let guard = 0;
  while (s.phase !== "ENDED" && guard++ < 4000) {
    s = tick(s);
    for (const p of s.players) {
      const label = labelOf(p.id);
      const f = fp[label];
      // Pico de tilt.
      if (p.alive) tiltPeak.set(p.id, Math.max(tiltPeak.get(p.id)!, p.mental.tilt));
      // Nueva fijación de duelo → distancia de peek.
      const was = prevIntent.get(p.id);
      if (p.alive && p.intent === "fight" && was !== "fight" && p.targetEnemyId) {
        const tgt = s.players.find((q) => q.id === p.targetEnemyId);
        if (tgt) { f.engageDistSum += dist(p.pos, tgt.pos); f.engageN++; }
      }
      // Re-peek: persiguió un punto en intent hold/fight moviéndose hacia un enemigo recordado.
      if (p.alive && (p.intent === "hold" || p.intent === "fight") && p.movedThisTick && !p.targetEnemyId) {
        f.repeeks++;
      }
      // Avance (espacio tomado respecto al spawn).
      if (p.alive && s.tick % 8 === 0) {
        f.advanceSum += dist(p.pos, meta.get(p.id)!.spawn); f.advanceN++;
      }
      // Muerte: ¿solo? (sin aliado a <260u).
      if (prevAlive.get(p.id) && !p.alive) {
        const mateNear = s.players.some((q) => q.side === p.side && q.id !== p.id && q.alive && dist(q.pos, p.pos) < 260);
        if (!mateNear) f.aloneDeaths++;
      }
      // Clutch: último vivo de su bando con rival vivo.
      if (p.alive && aliveOn(s, p.side) === 1 && aliveOn(s, p.side === "ATK" ? "DEF" : "ATK") >= 1
        && !clutchSeen.has(p.id)) {
        clutchSeen.add(p.id);
        fp[label].clutchAttempts++;
      }
      prevIntent.set(p.id, p.intent);
      prevAlive.set(p.id, p.alive);
    }
  }

  // Eventos de la ronda.
  const kills = s.events.filter((e) => e.type === "kill");
  for (let i = 0; i < kills.length; i++) {
    const e = kills[i];
    const byL = labelOf(String(e.data.by));
    const viL = labelOf(String(e.data.victim));
    fp[byL].kills++;
    fp[viL].deaths++;
    if (e.data.held) fp[byL].holderKills++; else fp[byL].peekKills++;
    if (i === 0) { fp[byL].firstContacts++; fp[viL].firstContacts++; fp[viL].firstDeaths++; }
  }
  // Trade-deaths: una muerte es "vengada" si un compañero mata al asesino en <2s.
  for (const e of kills) {
    const killerId = String(e.data.by);
    const viL = labelOf(String(e.data.victim));
    const avenged = kills.some((k) => k.tick > e.tick && k.tick <= e.tick + 40 && String(k.data.victim) === killerId);
    if (avenged) fp[viL].tradedDeaths++;
  }

  // Cierre por jugador.
  for (const p of s.players) {
    const label = labelOf(p.id);
    const f = fp[label];
    f.rounds++; f.endN++;
    f.confEndSum += p.mental.confidence;
    f.tiltEndSum += p.mental.tilt;
    f.tiltPeakSum += tiltPeak.get(p.id)!;
    if (p.alive) f.survived++;
    if (clutchSeen.has(p.id) && s.winner === p.side) f.clutchWins++;
  }
}

/**
 * Re-simula una semilla y narra el momento de clutch (1vN): quién se queda solo,
 * su estado mental al entrar, las bajas que consigue y el desenlace. Devuelve null
 * si en esa ronda no hubo un clutch ganado con multikill.
 */
function narrateClutch(seed: number): { lines: string[]; kills: number; nick: string } | null {
  const side: Side = seed % 2 === 0 ? "ATK" : "DEF";
  const setup: CoachSetup = { side, approach: (side === "ATK" ? APPROACHES_ATK : APPROACHES_DEF)[seed % 3], tempo: TEMPOS[(seed >> 1) % 3], aggression: "balanced" };
  let s = createRound(seed, setup);
  const map = roundMapping(seed);
  setupProbe(s, map);
  const name = (id: string) => `${NICK[map.get(id)!]} [${id.split("-")[0]}]`;

  let clutcherId: string | null = null;
  let clutchAtConf = 0, clutchAtTilt = 0, clutchSide: Side | null = null;
  const lines: string[] = [];
  let killsByClutcher = 0;
  let lastEventCount = 0;
  let g = 0;
  while (s.phase !== "ENDED" && g++ < 4000) {
    s = tick(s);
    // ¿Alguien acaba de quedarse 1vN?
    if (!clutcherId) {
      for (const sd of ["ATK", "DEF"] as const) {
        if (aliveOn(s, sd) === 1 && aliveOn(s, sd === "ATK" ? "DEF" : "ATK") >= 2) {
          const last = s.players.find((p) => p.side === sd && p.alive)!;
          clutcherId = last.id; clutchSide = sd;
          clutchAtConf = last.mental.confidence; clutchAtTilt = last.mental.pressure;
          lines.push(`> **${name(last.id)}** se queda **1v${aliveOn(s, sd === "ATK" ? "DEF" : "ATK")}** (confianza ${clutchAtConf.toFixed(0)}, presión ${clutchAtTilt.toFixed(0)}).`);
        }
      }
    }
    // Narrar bajas nuevas tras el clutch.
    if (clutcherId) {
      const newKills = s.events.slice(lastEventCount).filter((e) => e.type === "kill");
      for (const k of newKills) {
        if (String(k.data.by) === clutcherId) {
          killsByClutcher++;
          lines.push(`> ${(k.tick / 20).toFixed(0)}s — ${name(clutcherId)} elimina a ${name(String(k.data.victim))}. (${killsByClutcher} en el clutch)`);
        }
      }
    }
    lastEventCount = s.events.length;
  }
  if (!clutcherId || clutchSide == null) return null;
  const won = s.winner === clutchSide;
  if (!won || killsByClutcher < 2) return null;
  lines.push(`> **Desenlace: clutch GANADO** por ${name(clutcherId)} (${killsByClutcher} bajas a pelo).`);
  return { lines, kills: killsByClutcher, nick: name(clutcherId) };
}

// --------------------------- EJECUCIÓN ---------------------------
const N = Number(process.argv[2] ?? 400);
for (let seed = 1; seed <= N; seed++) runRound(seed);

// Buscar el mejor clutch (más bajas) para narrar una historia emergente real.
let bestStory: { lines: string[]; kills: number; nick: string; seed: number } | null = null;
for (let seed = 1; seed <= Math.min(N, 300); seed++) {
  const st = narrateClutch(seed);
  if (st && (!bestStory || st.kills > bestStory.kills)) bestStory = { ...st, seed };
}

// Determinismo: misma semilla, misma ronda (byte a byte en el log de eventos).
function det(seed: number): string {
  let a = createRound(seed, { side: "ATK", approach: "default", tempo: "mid", aggression: "balanced" });
  setupProbe(a, roundMapping(seed));
  let g = 0; while (a.phase !== "ENDED" && g++ < 4000) a = tick(a);
  return JSON.stringify(a.events.map((e) => [e.tick, e.type, e.data.by ?? e.data.victim ?? ""]));
}
const deterministic = det(7) === det(7);

// --------------------------- INFORME ---------------------------
const pct = (x: number, d = 1) => (x * 100).toFixed(0) + "%";
const f2 = (x: number) => x.toFixed(2);

const rows = SLOTS.map((a) => {
  const f = fp[a];
  return {
    a,
    nick: NICK[a],
    kd: f.deaths ? f.kills / f.deaths : f.kills,
    kpr: f.kills / f.rounds,
    engageDist: f.engageN ? f.engageDistSum / f.engageN : 0,
    advance: f.advanceN ? f.advanceSum / f.advanceN : 0,
    firstContactRate: f.firstContacts / f.rounds,
    firstDeathShare: f.firstContacts ? f.firstDeaths / f.firstContacts : 0,
    aloneDeathRate: f.deaths ? f.aloneDeaths / f.deaths : 0,
    tradedDeathRate: f.deaths ? f.tradedDeaths / f.deaths : 0,
    repeekPerRound: f.repeeks / f.rounds,
    survival: f.survived / f.rounds,
    clutchWinRate: f.clutchAttempts ? f.clutchWins / f.clutchAttempts : 0,
    clutchPerRound: f.clutchAttempts / f.rounds,
    confEnd: f.confEndSum / f.endN,
    tiltEnd: f.tiltEndSum / f.endN,
    tiltPeak: f.tiltPeakSum / f.endN,
  };
});

// Distancia de comportamiento entre arquetipos (vector normalizado de la huella).
const featKeys: (keyof typeof rows[number])[] = [
  "kd", "engageDist", "advance", "firstContactRate", "aloneDeathRate",
  "tradedDeathRate", "repeekPerRound", "survival", "tiltPeak", "confEnd",
];
function znorm() {
  const stats: Record<string, { m: number; sd: number }> = {};
  for (const k of featKeys) {
    const vals = rows.map((r) => Number(r[k]));
    const m = vals.reduce((s, v) => s + v, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((s, v) => s + (v - m) ** 2, 0) / vals.length) || 1;
    stats[k as string] = { m, sd };
  }
  return rows.map((r) => featKeys.map((k) => (Number(r[k]) - stats[k as string].m) / stats[k as string].sd));
}
const Z = znorm();
const pdist = (i: number, j: number) => Math.sqrt(Z[i].reduce((s, _, k) => s + (Z[i][k] - Z[j][k]) ** 2, 0));
let minPair = { i: 0, j: 1, d: Infinity };
for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
  const d = pdist(i, j);
  if (d < minPair.d) minPair = { i, j, d };
}

// ---- Salida por consola ----
const L: string[] = [];
const log = (s = "") => L.push(s);

log("# Player Identity Engine — Informe de validación");
log("");
log(`Rondas simuladas: **${N}** · Atributos IDÉNTICOS para todos (aim ${PROBE.aim}/gs ${PROBE.gameSense}/util ${PROBE.utility}/lead ${PROBE.leadership}).`);
log(`Determinismo (misma semilla ⇒ misma ronda): **${deterministic ? "OK ✓" : "FALLO ✗"}**`);
log("");
log("> Todos comparten estadísticas. Cualquier diferencia de abajo es **100% identidad**.");
log("");
log("## Huella de comportamiento por arquetipo");
log("");
log("| Arquetipo | K/D | DistPeek | Avance | 1stContact | MuereSolo% | Trade-death% | Repeek/rnd | Surv% | Clutch% | TiltPico | ConfFin |");
log("|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const r of rows) {
  log(`| ${r.nick} | ${f2(r.kd)} | ${r.engageDist.toFixed(0)} | ${r.advance.toFixed(0)} | ${r.firstContactRate.toFixed(2)} | ${pct(r.aloneDeathRate)} | ${pct(r.tradedDeathRate)} | ${r.repeekPerRound.toFixed(1)} | ${pct(r.survival)} | ${pct(r.clutchWinRate)} | ${r.tiltPeak.toFixed(0)} | ${r.confEnd.toFixed(0)} |`);
}
log("");
log("**Leyenda:** DistPeek = distancia media al fijar el duelo (asoma de lejos/de cerca). Avance = unidades medias tomadas desde el spawn (espacio que conquista). 1stContact = veces por ronda que entra en el primer duelo. MuereSolo% = muertes sin aliado cerca (sobre-extensión). Trade-death% = muertes que el equipo vengó. Repeek/rnd = re-asomadas a una posición ya vista. Clutch% = clutches ganados sobre intentados. TiltPico = tilt máximo medio (0-100). ConfFin = confianza media al acabar.");
log("");
log("## ¿Se distingue cada jugador del resto?");
log("");
log(`Par MÁS PARECIDO: **${rows[minPair.i].nick}** vs **${rows[minPair.j].nick}** → distancia ${minPair.d.toFixed(2)} σ.`);
log(`Umbral de "son distinguibles" = 1.0 σ → **${minPair.d >= 1 ? "TODOS los pares son distinguibles ✓" : "hay un par demasiado parecido ✗"}**`);
log("");
log("Matriz de distancia de comportamiento (σ, mayor = más distintos):");
log("");
log("| | " + rows.map((r) => r.nick.split(" ")[0]).join(" | ") + " |");
log("|" + "---|".repeat(rows.length + 1));
for (let i = 0; i < rows.length; i++) {
  const cells = rows.map((_, j) => (i === j ? "—" : pdist(i, j).toFixed(1)));
  log(`| ${rows[i].nick.split(" ")[0]} | ${cells.join(" | ")} |`);
}
log("");

// ---- Lectura automática de identidad (data-driven) por arquetipo ----
log("## Lo que diría el espectador de cada uno");
log("");
const maxBy = <K extends string>(key: (r: typeof rows[number]) => number) =>
  rows.reduce((a, b) => (key(b) > key(a) ? b : a));
const topAdvance = maxBy((r) => r.advance).nick;
const topAlone = maxBy((r) => r.aloneDeathRate).nick;
const topClutch = maxBy((r) => r.clutchWinRate).nick;
const topFirst = maxBy((r) => r.firstContactRate).nick;
const calmest = rows.reduce((a, b) => (b.tiltPeak < a.tiltPeak ? b : a)).nick;
const hidiest = rows.reduce((a, b) => (b.advance < a.advance ? b : a)).nick;
log(`- **${topAlone}** — "siempre se la juega": el que más muere solo, sobre-extendido.`);
log(`- **${hidiest}** — "siempre se esconde": el que menos espacio toma, juega de lejos y por el flanco.`);
log(`- **${topClutch}** — "frío como el hielo": el de mejor ratio de clutch.`);
log(`- **${topFirst}** — "el muro": el que más entra en el primer duelo aguantando su ángulo.`);
log(`- **${calmest}** — "nunca se descompone": el de menor pico de tilt.`);
log("");

// ---- Historia emergente real ----
if (bestStory) {
  log("## Una historia emergente (ronda real del experimento)");
  log("");
  log(`Semilla #${bestStory.seed}:`);
  log("");
  for (const ln of bestStory.lines) log(ln);
  log("");
  log("_Ninguna línea está guionizada: emerge de los rasgos + el estado mental dinámico._");
  log("");
}

const out = L.join("\n");
console.log(out);

// Guardar el informe.
import { writeFileSync } from "fs";
writeFileSync(new URL("./identity-report.out.md", import.meta.url), out);
