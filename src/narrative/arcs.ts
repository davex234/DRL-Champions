/**
 * MATCH NARRATIVE ENGINE — Arcos de jugador.
 *
 * Construye la trayectoria de cada jugador a lo largo del partido: impacto agregado,
 * rachas, forma, rondas decisivas, rivalidades (duelos repetidos) y ETIQUETAS de
 * estado (caliente, frío, tilt, clutch, presión, desaparecido, dominante, líder).
 * Todo se deriva de la memoria; nada se escribe a mano.
 */
import type { PlayerArc, PlayerStateTag, TeamId, RivalryRecord } from "./types";
import type { RoundRecord } from "./memory";

/** Datos estáticos del jugador (capturados de la identidad en la 1ª ronda). */
export interface StaticPlayer {
  name: string;
  team: TeamId;
  role: string;
  leadershipDrive: number;
  selfBelief: number;
  aggression: number;
}

export function buildArcs(records: RoundRecord[], statics: Record<string, StaticPlayer>): PlayerArc[] {
  const names = Object.keys(statics);
  const nRounds = records.length;
  // Matriz de bajas a->b (para rivalidades).
  const m: Record<string, Record<string, number>> = {};
  const bump = (a: string, b: string) => { (m[a] ??= {})[b] = ((m[a] ??= {})[b] ?? 0) + 1; };
  for (const r of records) {
    for (const e of r.events) {
      if (e.type !== "kill" && e.type !== "trade" && e.type !== "first_blood") continue;
      const s = e.participants.find((p) => p.as === "subject");
      const v = e.participants.find((p) => p.as === "victim");
      if (s && v) bump(s.name, v.name);
    }
  }

  const arcs: PlayerArc[] = [];
  for (const name of names) {
    const st = statics[name];
    const presence: number[] = [];
    let kills = 0, deaths = 0, fb = 0, fd = 0, multikills = 0, aces = 0;
    let clutches = 0, clutchWins = 0, tradeKills = 0, tiltPeak = 0, confidenceEnd = 50;
    let impactScore = 0, roundsDecisive = 0;

    for (const r of records) {
      const l = r.lines[name];
      if (!l) { presence.push(0); continue; }
      presence.push(l.presence);
      kills += l.kills; deaths += l.deaths; fb += l.firstBlood ? 1 : 0; fd += l.firstDeath ? 1 : 0;
      if (l.multikill >= 3) multikills++;
      if (l.ace) aces++;
      if (l.clutch > 0) { clutches++; if (l.clutchWon) clutchWins++; }
      tradeKills += l.tradeKills;
      tiltPeak = Math.max(tiltPeak, l.tilt);
      confidenceEnd = l.confidenceEnd;
      // Aporte agregado: eventos donde es protagonista.
      for (const e of r.events) {
        if (e.participants.some((p) => p.name === name && p.as === "subject")) impactScore += e.importance;
      }
      // ¿Fue el jugador decisivo de su equipo esta ronda?
      if (r.winner === st.team) {
        const best = topPresence(r, st.team);
        if ((best && best === name && l.presence > 2) || l.clutchWon) roundsDecisive++;
      }
    }
    impactScore = Math.round(impactScore + roundsDecisive * 8);

    const { best: bestStreak, worst: worstStreak } = streaks(presence);
    const form = Math.tanh(ewma(presence) / 3);
    const rivalries = buildRivalries(name, names, statics, m);
    const states = tagStates({
      st, presence, form, tiltPeak, clutchWins, roundsDecisive, nRounds,
      avgPressure: avg(records.map((r) => r.lines[name]?.pressure ?? 0)),
      isLeader: isTeamLeader(name, statics),
    });

    arcs.push({
      name, team: st.team, role: st.role, kills, deaths, firstBloods: fb, firstDeaths: fd,
      multikills, aces, clutches, clutchWins, tradeKills, impactScore, roundsDecisive,
      presence, form, bestStreak, worstStreak, states, rivalries, confidenceEnd, tiltPeak,
    });
  }
  return arcs.sort((a, b) => b.impactScore - a.impactScore);
}

function topPresence(r: RoundRecord, team: TeamId): string | null {
  let best: string | null = null, bp = -Infinity;
  for (const l of Object.values(r.lines)) {
    if (l.team !== team) continue;
    if (l.presence > bp) { bp = l.presence; best = l.name; }
  }
  return best;
}

function buildRivalries(
  name: string, names: string[], statics: Record<string, StaticPlayer>,
  m: Record<string, Record<string, number>>,
): RivalryRecord[] {
  const out: RivalryRecord[] = [];
  for (const opp of names) {
    if (statics[opp].team === statics[name].team) continue;
    const a = m[name]?.[opp] ?? 0;
    const b = m[opp]?.[name] ?? 0;
    if (a + b >= 3) out.push({ vs: opp, record: [a, b] });
  }
  return out.sort((x, y) => (y.record[0] + y.record[1]) - (x.record[0] + x.record[1])).slice(0, 3);
}

interface TagInput {
  st: StaticPlayer; presence: number[]; form: number; tiltPeak: number;
  clutchWins: number; roundsDecisive: number; nRounds: number; avgPressure: number; isLeader: boolean;
}
function tagStates(t: TagInput): PlayerStateTag[] {
  const tags: PlayerStateTag[] = [];
  if (t.form > 0.4) tags.push("hot");
  if (t.form < -0.3) tags.push("cold");
  if (t.tiltPeak > 45) tags.push("tilt");
  if (t.clutchWins >= 1) tags.push("clutch");
  if (t.avgPressure > 28) tags.push("pressure");
  if (t.roundsDecisive >= Math.max(2, t.nRounds * 0.22)) tags.push("dominant");
  if (t.isLeader) tags.push("leader");
  if (t.st.role === "anchor") tags.push("anchor");
  // Desaparecido: arrancó presente y se apagó en el último tercio.
  if (t.nRounds >= 6) {
    const third = Math.floor(t.nRounds / 3);
    const early = avg(t.presence.slice(0, third));
    const late = avg(t.presence.slice(-third));
    if (early > 2.2 && late < 0.8) tags.push("disappeared");
  }
  return tags;
}

function isTeamLeader(name: string, statics: Record<string, StaticPlayer>): boolean {
  const me = statics[name];
  let best = name, bestLd = me.leadershipDrive;
  for (const n of Object.keys(statics)) {
    if (statics[n].team !== me.team) continue;
    if (statics[n].leadershipDrive > bestLd) { bestLd = statics[n].leadershipDrive; best = n; }
  }
  return best === name;
}

function streaks(presence: number[]): { best: number; worst: number } {
  let best = 0, worst = 0, hot = 0, cold = 0;
  for (const p of presence) {
    if (p >= 3) { hot++; best = Math.max(best, hot); } else hot = 0;
    if (p <= 0) { cold++; worst = Math.max(worst, cold); } else cold = 0;
  }
  return { best, worst };
}
function ewma(xs: number[], decay = 0.6): number {
  let v = 0; let init = false;
  for (const x of xs) { v = init ? decay * v + (1 - decay) * x : x; init = true; }
  return v;
}
const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
