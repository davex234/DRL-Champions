/**
 * TACTICAL INTELLIGENCE ENGINE — Modelo del rival (lectura + anti-strat).
 *
 * Memoria de partido: aprende por dónde ataca/defiende el rival, qué jugador domina
 * y qué patrón repite, infiriéndolo de las posiciones finales (los muertos conservan
 * su posición de muerte → revela el carril). De aquí salen "stack este carril",
 * "ataca por donde no defiende" y "rompe su patrón con una finta".
 */
import type { RoundState, Side } from "../sim";
import type { Lane, OpponentModel } from "./types";
import { LANES } from "./types";
import { laneOfPos } from "./map";
import { ns, td } from "@/i18n/runtime";

const t = ns("tactics");

/** Carril dominante de un conjunto de jugadores (voto por posición final). */
function majorityLane(s: RoundState, side: Side): Lane {
  const tally: Record<Lane, number> = { main: 0, tree: 0, mid: 0 };
  for (const p of s.players) if (p.side === side) tally[laneOfPos(p.pos)]++;
  return LANES.reduce((a, b) => (tally[b] > tally[a] ? b : a), "main");
}

/**
 * Actualiza el modelo que NOSOTROS (ourSide) tenemos del rival tras una ronda.
 * No muta el RoundState.
 */
export function learnRound(model: OpponentModel, s: RoundState, ourSide: Side): void {
  const enemy: Side = ourSide === "ATK" ? "DEF" : "ATK";
  model.rounds++;

  if (enemy === "ATK") {
    const lane = majorityLane(s, "ATK");
    model.attackLane[lane]++;
    model.recentAttack.push(lane);
    if (model.recentAttack.length > 4) model.recentAttack.shift();
  } else {
    // El rival defendió: densidad de holds por carril.
    for (const p of s.players) if (p.side === "DEF") model.defendLane[laneOfPos(p.pos)]++;
  }

  if (ourSide === "ATK") {
    const ourLane = majorityLane(s, "ATK");
    const weWon = s.winner === "ATK";
    if (weWon) model.ourLaneWon[ourLane]++; else model.ourLaneLost[ourLane]++;
  }

  // Jugador dominante del rival (bajas acumuladas).
  for (const e of s.events) {
    if (e.type !== "kill") continue;
    if (s.players.find((p) => p.id === e.data.by)?.side !== enemy) continue;
    const name = String(e.data.byName ?? e.data.by);
    model.fragCount[name] = (model.fragCount[name] ?? 0) + 1;
  }
  let top: string | null = null, tc = 1;
  for (const [n, c] of Object.entries(model.fragCount)) if (c > tc) { tc = c; top = n; }
  model.dominantFragger = top;
}

// ---- Lecturas ----

/** Carril que el rival MÁS ataca (con confianza 0..1). */
export function predictedAttackLane(m: OpponentModel): { lane: Lane; confidence: number } {
  const total = LANES.reduce((a, l) => a + m.attackLane[l], 0) || 1;
  const lane = LANES.reduce((a, b) => (m.attackLane[b] > m.attackLane[a] ? b : a), "main");
  return { lane, confidence: m.attackLane[lane] / total };
}

/** Fuerza del patrón reciente (mismos carriles seguidos → alto). */
export function patternStrength(m: OpponentModel): { lane: Lane; strength: number } {
  const r = m.recentAttack;
  if (r.length < 2) return { lane: "main", strength: 0 };
  const last = r[r.length - 1];
  let same = 0;
  for (let i = r.length - 1; i >= 0 && r[i] === last; i--) same++;
  return { lane: last, strength: Math.min(1, same / 3) };
}

/** Carril que el rival MENOS defiende (mejor objetivo de ataque). */
export function leastDefendedLane(m: OpponentModel): Lane {
  const total = LANES.reduce((a, l) => a + m.defendLane[l], 0);
  if (total === 0) return "mid";
  return LANES.reduce((a, b) => (m.defendLane[b] < m.defendLane[a] ? b : a), "main");
}

/** Carril donde llevamos perdiendo más al atacar (a evitar / fintar). */
export function worstAttackLane(m: OpponentModel): { lane: Lane; net: number } {
  let worst: Lane = "main", net = -Infinity;
  for (const l of LANES) {
    const n = m.ourLaneLost[l] - m.ourLaneWon[l];
    if (n > net) { net = n; worst = l; }
  }
  return { lane: worst, net };
}

// FULL GAME AUDIT (2026-10-07) · zonas por su función (`ZONE_LABEL`): «A Main»/«B/Tree» son de Ascent y no existen en los otros once mapas.
const LANE_NAME: Record<Lane, string> = { main: "la entrada principal", tree: "el flanco", mid: "mid" };

/**
 * LECTURAS EN VIVO del rival (Tactical Director 2.0) — frases emergentes derivadas del modelo,
 * que el Director usa para ADAPTAR y el broadcast muestra. Solo con datos suficientes.
 */
export function tacticalReads(m: OpponentModel): string[] {
  const reads: string[] = [];
  if (m.rounds < 2) return reads;
  const atk = predictedAttackLane(m);
  const pat = patternStrength(m);
  const least = leastDefendedLane(m);
  if (pat.strength >= 0.66) reads.push(t("repiten {v} (patrón {v2}%)", { v: td(LANE_NAME[pat.lane]), v2: (pat.strength * 100) | 0 }));
  if (atk.confidence >= 0.5) reads.push(t("atacan sobre todo por {v}", { v: td(LANE_NAME[atk.lane]) }));
  const defTotal = LANES.reduce((a, l) => a + m.defendLane[l], 0);
  if (defTotal > 0) reads.push(t("no defienden {v}", { v: td(LANE_NAME[least]) }));
  if (m.dominantFragger) reads.push(t("jugador clave: {dominantFragger}", { dominantFragger: td(m.dominantFragger) }));
  return reads;
}
