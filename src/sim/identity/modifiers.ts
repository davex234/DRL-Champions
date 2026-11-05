/**
 * PLAYER IDENTITY ENGINE — Modificadores de comportamiento.
 *
 * Traduce (ADN + estado mental + situación) → NÚMEROS concretos que el motor aplica:
 * dónde se coloca un jugador (peek/hold), cuánto tarda en reaccionar, cuánto rinde
 * en el duelo, si re-asoma o se esconde, quién lidera la entrada, etc. Aquí es donde
 * "la identidad pesa más que el OVR": el mismo aim produce duelos distintos según la
 * cabeza del jugador. Puro y determinista (todo azar entra por el `Rng` del motor).
 */
import type { Rng } from "../rng";
import type { RoundState, SimPlayer, Side } from "../types";
import type { Vec2 } from "../geometry";
import { add, norm, scale, sub } from "../geometry";
import { ZONES } from "../map/ascentA";
import { allies, enemies } from "../perception";
import { clampTrait, unit, type Identity, type TraitKey } from "./traits";
import {
  bumpFromKill, clamp100, decayMental, type MentalState,
} from "./mental";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const aliveOn = (s: RoundState, side: Side) => s.players.filter((p) => p.side === side && p.alive).length;
const blinded = (p: SimPlayer, tick: number) => p.flashedUntil > tick;

/** ¿Es `p` el último vivo de su bando? (situación de clutch). */
export function isClutch(s: RoundState, p: SimPlayer): boolean {
  return p.alive && aliveOn(s, p.side) === 1 && aliveOn(s, p.side === "ATK" ? "DEF" : "ATK") >= 1;
}

/** Sangre fría EFECTIVA ahora (0..1): composure + un extra de clutch si está solo. */
export function composureNow(s: RoundState, p: SimPlayer): number {
  let c = clampTrait(p.identity.composure) / 100;
  if (isClutch(s, p)) c = Math.min(1, c + 0.5 * (clampTrait(p.identity.clutchFactor) / 100));
  return c;
}

// ---------------------------------------------------------------------------
// PRESIÓN SITUACIONAL y EVOLUCIÓN MENTAL POR TICK
// ---------------------------------------------------------------------------

/** Presión (0..100) por desventaja numérica, clutch, ceguera y reloj de postplant. */
export function computePressure(s: RoundState, p: SimPlayer): number {
  const mine = aliveOn(s, p.side);
  const opp = aliveOn(s, p.side === "ATK" ? "DEF" : "ATK");
  let pr = clamp(opp - mine, 0, 4) * 16; // desventaja numérica (hasta 64)
  if (mine === 1 && opp >= 1) pr += 22; // último vivo
  if (blinded(p, s.tick)) pr += 18;
  if (s.spike.planted && p.side === "DEF" && s.spike.defuseProgress < 1) pr += 10; // urgencia de retake
  return clamp100(pr);
}

/** Decae el estado mental y refresca la presión de cada jugador vivo (1 vez por tick). */
export function tickMental(s: RoundState): void {
  for (const p of s.players) {
    if (!p.alive) continue;
    decayMental(p.mental, p.identity);
    p.mental.pressure = computePressure(s, p);
  }
}

/** Aplica el impacto mental de una baja a asesino, compañeros y rivales cercanos. */
export function onKillMental(s: RoundState, killer: SimPlayer, victim: SimPlayer, traded: boolean): void {
  bumpFromKill(killer.mental, killer.identity, +1, { self: true, traded });
  // Compañeros del asesino: pequeño empujón de moral por la baja del equipo.
  for (const mate of allies(s, killer)) bumpFromKill(mate.mental, mate.identity, +1, { self: false, traded });
  // Compañeros de la víctima: bajón (más fuerte si estaban cerca, "se nos cae uno clave").
  for (const mate of s.players) {
    if (mate.side !== victim.side || !mate.alive) continue;
    const near = dist2(mate.pos, victim.pos) < 320 * 320;
    bumpFromKill(mate.mental, mate.identity, -1, { self: near, traded });
  }
}

const dist2 = (a: Vec2, b: Vec2) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

// ---------------------------------------------------------------------------
// MODIFICADORES DE COMBATE
// ---------------------------------------------------------------------------

/**
 * Multiplicador de letalidad por el ESTADO mental + ADN. Centro = 1.0.
 * Confianza y momentum suman; tilt, presión y fatiga restan (amortiguados por
 * sangre fría/clutch); la inconsistencia añade varianza (semilla del motor).
 */
export function aimMult(s: RoundState, p: SimPlayer, rng: Rng): number {
  const m = p.mental;
  const id = p.identity;
  const comp = composureNow(s, p);
  const conf = (m.confidence - 50) / 50;
  const tiltPen = (m.tilt / 100) * 0.22 * (1 - 0.6 * comp);
  const presPen = (m.pressure / 100) * 0.20 * (1 - comp);
  const fatPen = (m.fatigue / 100) * 0.08;
  const mom = (m.momentum / 100) * 0.10;
  let mult = 1 + 0.15 * conf - tiltPen - presPen - fatPen + mom;
  // Inconsistencia: cuanto más bajo `consistency`, más amplio el azar por duelo.
  const spread = (1 - clampTrait(id.consistency) / 100) * 0.28;
  mult *= 1 + (rng.next() * 2 - 1) * spread;
  return clamp(mult, 0.55, 1.6);
}

/** Ticks EXTRA (o menos) de reacción por el estado mental (se suma al buffer base). */
export function reactDelta(p: SimPlayer): number {
  const m = p.mental;
  const comp = clampTrait(p.identity.composure) / 100;
  const conf = (m.confidence - 50) / 50;
  let d = 0;
  d += (m.tilt / 100) * 3 * (1 - 0.5 * comp);
  d += (m.pressure / 100) * 2.2 * (1 - comp);
  d -= conf > 0 ? conf * 1.2 : 0; // confiado = más suelto
  d -= unit(p.identity.tradeInstinct) * 0.6; // listo para refrag
  return Math.round(d);
}

/** Radio de ventana de trade del jugador (la comunicación/instinto lo amplían). */
export function tradeRadius(p: SimPlayer): number {
  const base = 360;
  return base * (1 + 0.25 * unit(p.identity.communication) + 0.25 * unit(p.identity.tradeInstinct));
}

// ---------------------------------------------------------------------------
// MODIFICADORES DE MOVIMIENTO / DECISIÓN INDIVIDUAL
// ---------------------------------------------------------------------------

/** Punto de amenaza por bando (hacia dónde "mira" el peligro). */
const threatOf = (p: SimPlayer): Vec2 => (p.side === "ATK" ? ZONES.site : ZONES.a_main_choke);

/** Hash estable de un id → signo determinista (para off-angles sin azar global). */
function sign01(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (h & 1) === 0 ? 1 : -1;
}

/**
 * Sesgo ADELANTE/ATRÁS del hold (-1 = repliegue profundo, +1 = ángulo agresivo).
 * Agresividad/entry/confianza/ego empujan; paciencia/disciplina/presión retraen.
 */
export function forwardBias(s: RoundState, p: SimPlayer): number {
  const id = p.identity;
  const m = p.mental;
  const conf = (m.confidence - 50) / 50;
  const comp = composureNow(s, p);
  const greed = Math.max(0, conf) * unit(id.ego); // sólo se envalentona si va confiado
  const presPull = (m.pressure / 100) * (1 - comp);
  let f =
    0.28 * unit(id.aggression) +
    0.20 * unit(id.entryDrive) +
    0.15 * unit(id.riskAppetite) -
    0.25 * unit(id.patience) -
    0.15 * unit(id.discipline);
  f += 0.15 * conf + 0.12 * greed - 0.30 * presPull + 0.10 * (m.momentum / 100);
  return clamp(f, -1, 1);
}

/** Sesgo LATERAL del hold (off-angle); la creatividad lo abre, determinista por id. */
export function lateralBias(p: SimPlayer): number {
  return sign01(p.id) * Math.max(0, unit(p.identity.creativity));
}

const FWD_RANGE = 64;
const LAT_RANGE = 48;

/** Punto de hold AJUSTADO por identidad: agresivo adelanta, paciente repliega, creativo abre ángulo. */
export function holdSpot(s: RoundState, p: SimPlayer): Vec2 {
  const base = add(ZONES[p.targetZone], p.holdPos);
  const dir = norm(sub(threatOf(p), base));
  const perp = { x: -dir.y, y: dir.x };
  const fwd = scale(dir, forwardBias(s, p) * FWD_RANGE);
  const lat = scale(perp, lateralBias(p) * LAT_RANGE);
  return add(add(base, fwd), lat);
}

/**
 * ¿Quiere RE-ASOMAR a una última posición conocida en vez de aguantar?
 * Agresividad/riesgo/tilt/ego empujan a cazar; paciencia/disciplina a esperar.
 * Esta es la decisión individual que separa al que "siempre hace locuras" del
 * que "siempre se esconde".
 */
export function wantsRepeek(p: SimPlayer): boolean {
  const id = p.identity;
  const m = p.mental;
  const conf = (m.confidence - 50) / 50;
  let drive =
    0.30 * unit(id.aggression) +
    0.20 * unit(id.riskAppetite) -
    0.30 * unit(id.patience) -
    0.22 * unit(id.discipline);
  drive += 0.25 * (m.tilt / 100) * (1 - clampTrait(id.discipline) / 100); // el tilt vuelve codicioso
  drive += 0.20 * Math.max(0, conf) * unit(id.ego);
  return drive > 0.15;
}

// ---------------------------------------------------------------------------
// SELECCIÓN DE ROLES "BLANDOS" (capa de equipo / director)
// ---------------------------------------------------------------------------

/** Jugador VIVO del bando que maximiza un rasgo (determinista; desempata por id). */
export function topByTrait(s: RoundState, side: Side, key: TraitKey): SimPlayer | undefined {
  let best: SimPlayer | undefined;
  for (const p of s.players) {
    if (p.side !== side || !p.alive) continue;
    if (!best || p.identity[key] > best.identity[key]) best = p;
  }
  return best;
}

/**
 * Multiplicador de la latencia del IGL (timing de decisiones de equipo).
 * Un líder con `leadershipDrive` alto y equipo confiado decide ANTES; el tilt y la
 * baja moral ralentizan. <1 = más rápido, >1 = más lento.
 */
export function iglLatencyMult(s: RoundState, side: Side): number {
  const lead = topByTrait(s, side, "leadershipDrive");
  const driveK = lead ? 1 - 0.4 * unit(lead.identity.leadershipDrive) : 1;
  const team = teamMental(s, side);
  const moodK = 1 - 0.10 * (team.confidence - 50) / 50 + 0.20 * (team.tilt / 100) - 0.08 * (team.morale - 50) / 50;
  return clamp(driveK * moodK, 0.5, 1.8);
}

/** Estado mental AGREGADO del bando vivo (para decisiones de equipo). */
export function teamMental(s: RoundState, side: Side): MentalState {
  const live = s.players.filter((p) => p.side === side && p.alive);
  const acc: MentalState = { confidence: 0, tilt: 0, morale: 0, momentum: 0, fatigue: 0, pressure: 0 };
  if (!live.length) return { ...acc, confidence: 50, morale: 50 };
  for (const p of live) {
    acc.confidence += p.mental.confidence; acc.tilt += p.mental.tilt; acc.morale += p.mental.morale;
    acc.momentum += p.mental.momentum; acc.fatigue += p.mental.fatigue; acc.pressure += p.mental.pressure;
  }
  const n = live.length;
  return {
    confidence: acc.confidence / n, tilt: acc.tilt / n, morale: acc.morale / n,
    momentum: acc.momentum / n, fatigue: acc.fatigue / n, pressure: acc.pressure / n,
  };
}

/** ¿El equipo (vía un IGL adaptable y con baja moral) debería jugar pasivo/picks? */
export function shouldAdapt(s: RoundState, side: Side): boolean {
  const lead = topByTrait(s, side, "adaptability");
  if (!lead) return false;
  const team = teamMental(s, side);
  const behind = aliveOn(s, side) < aliveOn(s, side === "ATK" ? "DEF" : "ATK");
  return clampTrait(lead.identity.adaptability) > 60 && (behind || team.morale < 42);
}
