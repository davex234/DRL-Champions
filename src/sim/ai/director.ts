/**
 * Director (capa de EQUIPO / IGL): transiciones de fase y reparto de objetivos por
 * rol. El TIMING de las transiciones depende del `leadership` del IGL cuando el
 * coach no interviene → de ahí salen análisis como "el IGL ejecutó/rotó tarde".
 */
import type { Rng } from "../rng";
import { dist } from "../geometry";
import { iglLatencyTicks, flashBlindTicks, applyBlind } from "../attributes";
import {
  ATTACK_STAGING, DEFENSE_HOLDS, ZONES, type ZoneId,
} from "../map/ascentA";
import { iglLatencyMult, topByTrait, shouldAdapt } from "../identity/modifiers";
import { clampTrait } from "../identity/traits";
import { stepTactics } from "../../tactics/runner";
import type { RoundState, SimPlayer, Side, Tempo } from "../types";

const tempoBase = (t: Tempo): number => (t === "fast" ? 45 : t === "slow" ? 130 : 85);

const igl = (s: RoundState, side: Side): SimPlayer | undefined => {
  // El entrenador puede designar IGL (Coach Command Layer) para el lado entrenado.
  const over = s.coachSide === side && s.coachFlags.iglOverrideId
    ? s.players.find((p) => p.id === s.coachFlags.iglOverrideId && p.side === side && p.alive)
    : undefined;
  return over
    ?? s.players.find((p) => p.side === side && p.role === "igl" && p.alive)
    ?? s.players.find((p) => p.side === side && p.alive);
};

const alive = (s: RoundState, side: Side) => s.players.filter((p) => p.side === side && p.alive);

export function tickDirector(s: RoundState, rng: Rng): void {
  // Tactical Intelligence Engine (opt-in y POR LADO): cada bando usa táctica o el
  // director clásico de forma independiente → permite "táctico vs estático".
  const t = s.tactical;

  // Fase de ataque: el timing lo decide la táctica del ATK si la tiene; si no, el clásico.
  if (s.phase === "SETUP") {
    if (t?.ATK) { if (s.forcedExecute || s.tick >= t.ATK.commitTick) doExecute(s, rng); }
    else handlePhase(s, rng);
  }

  handleRetakeUtil(s, rng);
  if (t) stepTactics(s, rng); // asigna objetivos a los lados tácticos presentes

  // Lados SIN táctica → director clásico por rol.
  for (const p of s.players) {
    if (!p.alive) continue;
    if (p.side === "ATK") { if (!t?.ATK) objectiveATK(s, p); }
    else if (!t?.DEF) objectiveDEF(s, p);
  }
}

// ---- Transiciones de fase (centradas en el progreso del ataque) ----
function handlePhase(s: RoundState, rng: Rng): void {
  if (s.phase === "SETUP") {
    const ai = igl(s, "ATK");
    // El timing del execute lo afina la IDENTIDAD del que más manda + el ánimo del
    // equipo (liderazgo alto y equipo confiado → antes; tilt/baja moral → más tarde).
    let latency = (s.coachSide === "ATK" && s.forcedExecute)
      ? 0
      : Math.round(iglLatencyTicks(ai?.attrs.leadership ?? 50) * iglLatencyMult(s, "ATK"));
    // Equipo adaptable y por detrás: juega más lento (busca picks antes de comprometer).
    if (!s.forcedExecute && shouldAdapt(s, "ATK")) latency += 25;
    // UTILITY ENGINE: si la DEFENSA ya gastó su utilidad, ejecuta ANTES (sin herramientas
    // de parada, el execute es más limpio). Reacción táctica al estado del mapa.
    if (s.map && s.map.charges.DEF > 0 && s.map.spent.DEF / s.map.charges.DEF >= 0.6) latency = Math.max(0, latency - 35);
    const execAt = tempoBase(s.plans.ATK.tempo) + latency;
    if (s.forcedExecute || s.tick >= execAt) doExecute(s, rng);
  }
}

/** Compromete el execute: cambia de fase y lanza la utilidad de entrada. */
function doExecute(s: RoundState, rng: Rng): void {
  s.phase = "EXECUTE";
  s.executeTick = s.tick;
  s.events.push({ tick: s.tick, type: "execute", data: { forced: s.forcedExecute } });
  // Utilidad de entrada: la lanza quien más se apoya en utilidad (no su rol nominal),
  // y su CALIDAD depende de ese `utilityLean` además del atributo de utilidad.
  const support = topByTrait(s, "ATK", "utilityLean") ?? alive(s, "ATK")[0];
  if (!support) return;
  const lean = 0.7 + 0.6 * (clampTrait(support.identity.utilityLean) / 100);
  const blind = Math.round(flashBlindTicks(support.attrs.utility) * lean);
  s.events.push({ tick: s.tick, type: "util", data: { by: support.id, kind: "flash", blind } });
  for (const d of alive(s, "DEF")) {
    if (dist(d.pos, ZONES.a_main_choke) < 220 || dist(d.pos, ZONES.site) < 200) {
      applyBlind(d, s.tick, blind, rng);
    }
  }
}

// ---- Utilidad de RETAKE: la defensa flashea el postplant al comprometer ----
function handleRetakeUtil(s: RoundState, rng: Rng): void {
  if (!s.spike.planted || s.retakeFlashed || !s.spike.pos) return;
  if (!retakeCommitted(s)) return;
  // Lanzar el flash AL CONTACTO (cuando un defensor llega al sitio), no al
  // comprometer: así la ceguera coincide con la entrada al postplant.
  const onContact = alive(s, "DEF").some((d) => dist(d.pos, s.spike.pos!) < 260);
  if (!onContact) return;
  s.retakeFlashed = true;
  const support = topByTrait(s, "DEF", "utilityLean") ?? alive(s, "DEF")[0];
  if (!support) return;
  const lean = 0.7 + 0.6 * (clampTrait(support.identity.utilityLean) / 100);
  const blind = Math.round(flashBlindTicks(support.attrs.utility) * lean);
  s.events.push({ tick: s.tick, type: "util", data: { by: support.id, kind: "flash-retake", blind } });
  for (const a of alive(s, "ATK")) {
    if (dist(a.pos, s.spike.pos) < 180) {
      applyBlind(a, s.tick, blind, rng);
    }
  }
}

// ---- Objetivos del ATAQUE ----
function objectiveATK(s: RoundState, p: SimPlayer): void {
  if (s.tick < s.coachFlags.fallbackUntil && s.coachSide === "ATK") {
    p.targetZone = ATTACK_STAGING[p.role];
    p.intent = "fallback";
    return;
  }
  if (s.phase === "SETUP") {
    p.targetZone = ATTACK_STAGING[p.role];
    p.intent = "move";
    return;
  }
  if (s.phase === "EXECUTE") {
    p.targetZone = entryPathZone(s, p);
    p.intent = "push";
    return;
  }
  // POSTPLANT: aguantar el sitio en torno al spike.
  p.targetZone = "plant";
  p.intent = "hold";
}

/** Por dónde entra cada jugador: el lurker DESIGNADO (más `lurkTendency`) flanquea. */
function entryPathZone(s: RoundState, p: SimPlayer): ZoneId {
  const approach = s.plans.ATK.approach;
  const lurker = topByTrait(s, "ATK", "lurkTendency");
  // El jugador con más vena de lurk se separa por Tree, lo diga su rol o no.
  const isLurker = lurker?.id === p.id && clampTrait(p.identity.lurkTendency) > 55;
  if (approach === "rush-main") return isLurker ? "tree_choke" : "site";
  if (approach === "split") {
    return isLurker || p.role === "anchor" ? "tree_choke" : "site";
  }
  // default / fake-commit
  if (isLurker || p.role === "lurk") return "tree_choke";
  return "site";
}

// ---- Objetivos de la DEFENSA ----
function objectiveDEF(s: RoundState, p: SimPlayer): void {
  // Retake en postplant (con retardo de IGL si el coach no fuerza).
  if (s.spike.planted) {
    const retakeReady = retakeCommitted(s);
    if (retakeReady) {
      p.targetZone = "plant";
      p.intent = "push";
    } else {
      p.targetZone = DEFENSE_HOLDS[p.role];
      p.intent = "hold";
    }
    return;
  }
  // Pre-plant: mantener ángulos (con variaciones de approach).
  let zone = DEFENSE_HOLDS[p.role];
  const approach = s.plans.DEF.approach;
  if (approach === "stack-a" && (p.role === "igl" || p.role === "support")) zone = "site";
  if (approach === "aggro-info" && p.role === "entry") zone = "a_main_choke";
  // Equipo adaptable y por detrás: repliega al sitio (juega más seguro, menos info agresiva).
  if (shouldAdapt(s, "DEF") && p.role === "entry") zone = "site";
  p.targetZone = zone;
  p.intent = "hold";
}

/** ¿La defensa ya comprometió el retake? (coach o IGL por latencia). */
function retakeCommitted(s: RoundState): boolean {
  if (s.coachSide === "DEF" && s.coachFlags.forceRetake) return true;
  const plantedAt = s.spike.plantedTick ?? s.tick;
  const di = igl(s, "DEF");
  const delay = Math.round(iglLatencyTicks(di?.attrs.leadership ?? 50) * iglLatencyMult(s, "DEF"));
  return s.tick >= plantedAt + delay;
}
