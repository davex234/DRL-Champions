/**
 * MOTOR DE RONDA. Reductor PURO y determinista: `createRound` → `tick`* → fin.
 * Orquesta funciones puras (percepción → IA → combate → objetivos → victoria) sin
 * clases gigantes. Mismo `seed` + mismas órdenes ⇒ misma ronda.
 */
import { makeRng } from "./rng";
import { add, dist } from "./geometry";
import type { RosterEntry } from "./attributes";
import { DEMO_HOME, DEMO_AWAY } from "./mapping/demoRoster";
import {
  ZONES, PLANT_ZONE, PLANT_RADIUS, type ZoneId,
} from "./map/ascentA";
import { computeVisibility, canSee, enemies } from "./perception";
import { resolveCombat } from "./combat";
import { tickDirector } from "./ai/director";
import { actPlayer } from "./ai/playerBrain";
import { neutralIdentity } from "./identity/traits";
import { initialMental, carryMental, type MentalState } from "./identity/mental";
import { tickMental } from "./identity/modifiers";
import { initRuntime } from "../tactics/engine";
import type { TacticalSetup } from "../tactics/types";
import { buildLineup, analyzeComposition } from "../agents";
import type { AgentInstance } from "../agents/types";
import { createMapState, tickUtility } from "../utility";
import { createBrain, tickBrains } from "../brain";
import { emptyStats } from "../combat2/stats";
import { shieldHp } from "../combat2/ballistics";
import { emptyAbilityState } from "../abilities/types";
import type {
  CoachCall, CoachSetup, RoundState, SimPlayer, Side, TeamPlan,
} from "./types";

/**
 * Arrastre mental entre rondas de una misma partida (keyed por nombre de jugador).
 * Permite que la confianza/moral/fatiga/tilt persistan: de ahí salen las "historias"
 * (un jugador que se viene arriba ronda a ronda, otro que entra en tilt y no sale).
 */
export type MatchMemory = Record<string, MentalState>;

/**
 * Rosters de la ronda. `home` = equipo entrenado (lado de `setup.side`); `away` =
 * rival. Ambos los produce el Player Mapper a partir de cartas reales.
 */
export interface MatchRosters {
  home: RosterEntry[];
  away: RosterEntry[];
}

/** Loadouts de la ronda por lado (los produce la Buy Phase; opcional). */
export interface MatchLoadoutsBySide {
  home: import("./attributes").SimLoadout[];
  away: import("./attributes").SimLoadout[];
}

export const TPS = 20;
export const ROUND_TICKS = 85 * TPS;   // ~1:25 de fase de compra+acción
export const SPIKE_TICKS = 40 * TPS;   // ~40 s hasta detonación
const PLANT_RATE = 1 / (3.5 * TPS);
const DEFUSE_RATE = 1 / (5 * TPS);
const SITE_CLEAR_RADIUS = 130; // distancia a la que un enemigo bloquea plant/defuse

const DEFAULT_PLAN: TeamPlan = { approach: "default", tempo: "mid", aggression: "balanced" };
const DEFAULT_DEF_PLAN: TeamPlan = { approach: "balanced", tempo: "mid", aggression: "balanced" };

function spawnFor(side: Side, i: number): { pos: { x: number; y: number }; hold: { x: number; y: number } } {
  const base = side === "ATK" ? ZONES.atk_spawn : ZONES.def_spawn;
  const spread = (i - 2) * 26;
  // Pequeño offset de hold por jugador para que no se apilen.
  const hold = { x: ((i % 3) - 1) * 34, y: (Math.floor(i / 3) - 0.5) * 30 };
  return { pos: { x: base.x + spread, y: base.y + (side === "ATK" ? 0 : 0) }, hold };
}

function makePlayer(entry: RosterEntry, side: Side, i: number, memory?: MatchMemory, loadout?: import("./attributes").SimLoadout, agent?: AgentInstance): SimPlayer {
  const { pos, hold } = spawnFor(side, i);
  const identity = entry.identity ?? neutralIdentity();
  const carried = memory?.[entry.name];
  const mental = carried ? { ...carried, pressure: 0 } : initialMental(identity);
  return {
    id: `${side}-${i}`,
    name: entry.name,
    side,
    role: entry.role,
    attrs: entry.attrs,
    meta: entry.meta,
    loadout,
    identity,
    agent,
    brain: createBrain(),
    mental,
    pos,
    facing: side === "ATK" ? -Math.PI / 2 : Math.PI / 2,
    alive: true,
    hp: 100,
    shield: shieldHp(loadout?.armor ?? "none"),
    cstat: emptyStats(),
    dmgFrom: {},
    abil: emptyAbilityState(),
    targetZone: side === "ATK" ? "a_main" : "site",
    holdPos: hold, // offset relativo al centro de la zona de hold
    intent: side === "ATK" ? "move" : "hold",
    targetEnemyId: null,
    lastSeen: {},
    flashedUntil: -1,
    movedThisTick: false,
    actionProgress: 0,
    reactBuffer: 0,
  };
}

/**
 * Crea el estado inicial de la ronda. HOME = equipo entrenado; AWAY = rival.
 * `memory` (opcional) arrastra el estado mental de la ronda anterior de la partida.
 */
export function createRound(
  seed: number,
  setup: CoachSetup,
  memory?: MatchMemory,
  tactical?: TacticalSetup,
  rosters?: MatchRosters,
  loadouts?: MatchLoadoutsBySide,
  opts?: { brain?: boolean },
): RoundState {
  const homeSide: Side = setup.side;
  const awaySide: Side = homeSide === "ATK" ? "DEF" : "ATK";

  // Rosters reales de la colección. Solo se cae a DEMO_* si no se pasan rosters
  // (scripts/tests). El juego real SIEMPRE pasa los equipos del entrenador.
  const home = rosters?.home ?? DEMO_HOME;
  const away = rosters?.away ?? DEMO_AWAY;

  // AGENT ENGINE: asigna agentes (por rol+ADN, con variedad) → cada equipo es una
  // COMPOSICIÓN, no 5 clones. Determinista. Cambia la forma de jugar, no el aim.
  const toInput = (e: RosterEntry) => ({ name: e.name, role: e.role, identity: e.identity ?? neutralIdentity() });
  const homeLineup = buildLineup(home.map(toInput));
  const awayLineup = buildLineup(away.map(toInput));

  const players: SimPlayer[] = [
    ...home.map((e, i) => makePlayer(e, homeSide, i, memory, loadouts?.home[i], homeLineup[i])),
    ...away.map((e, i) => makePlayer(e, awaySide, i, memory, loadouts?.away[i], awayLineup[i])),
  ];

  const idBy = (lineup: AgentInstance[], roster: RosterEntry[]): Record<string, ReturnType<typeof neutralIdentity>> => {
    const m: Record<string, ReturnType<typeof neutralIdentity>> = {};
    for (const e of roster) m[e.name] = e.identity ?? neutralIdentity();
    return m;
  };
  const homeComp = analyzeComposition(homeLineup, idBy(homeLineup, home));
  const awayComp = analyzeComposition(awayLineup, idBy(awayLineup, away));
  const composition = {
    ATK: homeSide === "ATK" ? homeComp : awayComp,
    DEF: homeSide === "DEF" ? homeComp : awayComp,
  };

  const coachedPlan: TeamPlan = {
    approach: setup.approach,
    tempo: setup.tempo,
    aggression: setup.aggression,
  };

  const plans: { ATK: TeamPlan; DEF: TeamPlan } = {
    ATK: homeSide === "ATK" ? coachedPlan : DEFAULT_PLAN,
    DEF: homeSide === "DEF" ? coachedPlan : DEFAULT_DEF_PLAN,
  };

  const state: RoundState = {
    seed: seed >>> 0,
    tick: 0,
    phase: "SETUP",
    players,
    spike: { planted: false, carrierId: null, pos: null, plantedTick: null, plantProgress: 0, defuseBy: null, defuseProgress: 0 },
    events: [],
    coachSide: homeSide,
    plans,
    voz: { left: 3, total: 3 },
    winner: null,
    endReason: null,
    executeTick: null,
    forcedExecute: false,
    retakeFlashed: false,
    composition,
    map: createMapState(players),
    comms: [],
    brainEnabled: opts?.brain !== false,
    coachFlags: {
      fallbackUntil: 0, forceRetake: false, retakeTick: null,
      tempoBias: 0, aggressionBias: 0, laneFocus: null, stack: false,
      forceRotation: false, saveUtility: false, pushUtility: false, iglOverrideId: null,
    },
  };

  // Tactical Intelligence Engine (opt-in): construye los planes de ambos equipos.
  if (tactical) initRuntime(state, tactical, makeRng((seed >>> 0) ^ 0x7a7a7a7a));

  return state;
}

/** RNG determinista por tick (sin estado mutable que arrastrar). */
const rngFor = (s: RoundState): ReturnType<typeof makeRng> =>
  makeRng((s.seed ^ Math.imul(s.tick + 1, 2654435761)) >>> 0);

/** Avanza la simulación un tick. Devuelve un NUEVO estado (inmutable). */
export function tick(prev: RoundState): RoundState {
  if (prev.phase === "ENDED") return prev;
  const s: RoundState = structuredClone(prev);
  s.tick++;
  const rng = rngFor(s);

  tickUtility(s, rng);      // UTILITY ENGINE: mapa vivo (control/visión/info/presión) + despliegue emergente
  computeVisibility(s);     // percepción (LOS + sonido + memoria, ya consume el overlay)
  tickMental(s);            // identidad: decaimiento mental + presión situacional
  tickDirector(s, rng);     // capa de equipo (fases + objetivos por rol) = el PLAN del coach
  tickBrains(s, rng);       // BRAIN ENGINE: cada jugador interpreta el plan, duda, comunica y decide
  for (const p of s.players) actPlayer(s, p); // ejecución clásica (los jugadores con cerebro ya actuaron)
  resolveCombat(s, rng);    // duelos del tick (con trades)
  progressObjectives(s);    // plant / defuse
  checkWin(s);              // condiciones de victoria

  return s;
}

const aliveCount = (s: RoundState, side: Side) =>
  s.players.filter((p) => p.side === side && p.alive).length;

/** ¿Hay enemigos del bando `side` cerca/visibles para `p`? (para plant/defuse seguro). */
function areaContested(s: RoundState, p: SimPlayer, pos: { x: number; y: number }): boolean {
  for (const e of enemies(s, p)) {
    if (canSee(p, e)) return true;
    if (dist(e.pos, pos) < SITE_CLEAR_RADIUS) return true;
  }
  return false;
}

function progressObjectives(s: RoundState): void {
  if (s.phase === "EXECUTE" && !s.spike.planted) {
    // Planter = atacante vivo más cercano al plant, en la zona y con el sitio limpio.
    const candidates = s.players
      .filter((p) => p.side === "ATK" && p.alive && dist(p.pos, PLANT_ZONE) < PLANT_RADIUS)
      .sort((a, b) => dist(a.pos, PLANT_ZONE) - dist(b.pos, PLANT_ZONE));
    const planter = candidates.find((p) => !areaContested(s, p, PLANT_ZONE));
    if (planter) {
      planter.intent = "plant";
      s.spike.plantProgress += PLANT_RATE;
      if (s.spike.plantProgress >= 1) {
        s.spike.planted = true;
        s.spike.carrierId = planter.id;
        s.spike.pos = { ...PLANT_ZONE };
        s.spike.plantedTick = s.tick;
        s.phase = "POSTPLANT";
        s.events.push({ tick: s.tick, type: "plant", data: { by: planter.id, byName: planter.name } });
        s.events.push({ tick: s.tick, type: "phase", data: { phase: "POSTPLANT" } });
      }
    }
  }

  if (s.spike.planted && s.spike.pos) {
    const defuser = s.players
      .filter((p) => p.side === "DEF" && p.alive && dist(p.pos, s.spike.pos!) < PLANT_RADIUS)
      .find((p) => !areaContested(s, p, s.spike.pos!));
    if (defuser) {
      defuser.intent = "defuse";
      s.spike.defuseBy = defuser.id;
      s.spike.defuseProgress += DEFUSE_RATE;
    } else {
      // Interrumpido: el defuse se reinicia (realista).
      s.spike.defuseBy = null;
      s.spike.defuseProgress = 0;
    }
  }
}

function end(s: RoundState, winner: Side, reason: string): void {
  s.winner = winner;
  s.endReason = reason;
  s.phase = "ENDED";
  s.events.push({ tick: s.tick, type: "end", data: { winner, reason } });
}

function checkWin(s: RoundState): void {
  if (s.phase === "ENDED") return;
  const atk = aliveCount(s, "ATK");
  const def = aliveCount(s, "DEF");

  if (s.spike.planted) {
    if (s.spike.defuseProgress >= 1) return end(s, "DEF", "defuse");
    if (def === 0) return end(s, "ATK", "detonation"); // nadie para desactivar
    if (s.spike.plantedTick != null && s.tick >= s.spike.plantedTick + SPIKE_TICKS) {
      return end(s, "ATK", "detonation");
    }
    return;
  }

  // Pre-plant: la defensa gana eliminando al ataque o agotando el tiempo. El
  // ataque NO gana por eliminación: debe PLANTAR (si limpia el sitio, plantará
  // sin oposición y ganará por detonación). Esto es la regla real de Valorant.
  if (atk === 0) return end(s, "DEF", "elimination");
  if (s.tick >= ROUND_TICKS) return end(s, "DEF", "timeout");
}

/**
 * Extrae el arrastre mental para la siguiente ronda: regresa parcialmente a la base
 * (según `resilience`), ajusta por victoria/derrota y acumula fatiga.
 */
export function nextRoundMemory(s: RoundState): MatchMemory {
  const mem: MatchMemory = {};
  for (const p of s.players) {
    const won = s.winner === p.side;
    mem[p.name] = carryMental(p.mental, p.identity, won);
  }
  return mem;
}

// ---- Órdenes del entrenador (consumen "Voz") ----
export function applyCall(prev: RoundState, call: CoachCall): RoundState {
  if (prev.phase === "ENDED" || prev.voz.left <= 0) return prev;
  const s: RoundState = structuredClone(prev);
  const side = s.coachSide;
  const ai = s.players.find((p) => p.side === side && p.role === "igl" && p.alive)
    ?? s.players.find((p) => p.side === side && p.alive);
  const effective = (ai?.attrs.leadership ?? 50) >= 50; // calls claras necesitan un IGL competente

  switch (call.id) {
    case "execute":
      if (side === "ATK") { s.forcedExecute = true; }
      break;
    case "rush":
      if (side === "ATK") { s.forcedExecute = true; s.plans.ATK = { ...s.plans.ATK, tempo: "fast", aggression: "aggressive" }; }
      break;
    case "rotate-tree":
      if (side === "ATK") s.plans.ATK = { ...s.plans.ATK, approach: "split" };
      break;
    case "play-picks":
      s.plans[side] = { ...s.plans[side], aggression: "passive" };
      break;
    case "plant-default":
      break; // el motor ya prioriza el plant por defecto
    case "regroup":
    case "save":
      s.coachFlags.fallbackUntil = s.tick + (call.id === "save" ? 9999 : 3 * TPS);
      break;
  }

  if (side === "DEF" && (call.id === "rush" || call.id === "execute")) {
    s.coachFlags.forceRetake = true;
    if (s.coachFlags.retakeTick == null) s.coachFlags.retakeTick = s.tick;
  }

  s.voz.left -= 1;
  s.events.push({ tick: s.tick, type: "coachCall", data: { id: call.id, effective } });
  return s;
}
