/**
 * COMENTARISTAS IA — la voz de la retransmisión (NO IA generativa, NO frases aleatorias).
 *
 * Cada línea nace de DATOS reales: el log de eventos de la ronda, los flags del Broadcast,
 * el estado mental/control del mapa, y —en post-ronda/post-partido— las frases YA
 * deterministas del Narrative Engine (`analyze` causes, `keyMoments.why`, `summary.beats`,
 * `answerQuestions`). Extiende el Broadcast: no crea otro motor. PURO/determinista.
 */
import type { RoundState, SimPlayer, Side } from "../sim";
import { analyze } from "../sim";
import type { MatchState } from "../match";
import { answerQuestions } from "../narrative";
import { detectRoundMoments } from "../lib/match/moments";
import type { BroadcastState } from "./types";

export type CasterVoice = "pbp" | "color" | "analista";
export type CasterTone = "hype" | "tenso" | "calmado" | "analisis";

export interface CasterLine {
  id: string;
  voice: CasterVoice;
  tone: CasterTone;
  text: string;
  /** Tick del evento (vivo) o número de ronda (post). Para ordenar/dedup. */
  at: number;
}

export interface CasterNames { atk: string; def: string }
const teamName = (names: CasterNames | undefined, side: Side) => names ? names[side === "ATK" ? "atk" : "def"] : (side === "ATK" ? "el ataque" : "la defensa");
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/**
 * Comentario EN VIVO a partir del estado actual: bajas del tick, flags, situación del
 * observer, estado mental del rival y control del mapa. Determinista (sin RNG).
 */
export function liveCasters(snap: RoundState, bs: BroadcastState, names?: CasterNames): CasterLine[] {
  const out: CasterLine[] = [];
  const f = bs.events.flags;
  const push = (voice: CasterVoice, tone: CasterTone, key: string, text: string) =>
    out.push({ id: `c:${snap.tick}:${key}`, voice, tone, text, at: snap.tick });

  // — Jugada por jugada: bajas del tick actual —
  for (const e of snap.events.filter((e) => e.tick === snap.tick && e.type === "kill")) {
    const d = e.data as { byName?: string; headshot?: boolean; oneShot?: boolean; wallbang?: boolean; traded?: boolean };
    const who = d.byName ?? "alguien";
    if (d.wallbang) push("pbp", "hype", `wb:${who}`, `¡WALLBANG de ${who}! Sabía exactamente dónde estaba.`);
    else if (d.oneShot && d.headshot) push("pbp", "hype", `ot:${who}`, `¡ONE TAP de ${who}! Un solo balazo a la cabeza.`);
    else if (d.traded) push("pbp", "tenso", `tr:${who}`, `¡${who} responde el trade al instante!`);
    else if (d.headshot) push("pbp", "hype", `hs:${who}`, `¡${who} se lleva el duelo a la cabeza!`);
    else push("pbp", "hype", `k:${who}`, `¡Baja de ${who}!`);
  }

  // — Flags grandes —
  if (f.ace && f.aceBy) push("pbp", "hype", "ace", `¡¡ACE de ${f.aceBy}!! Se los ha llevado a todos.`);
  if (f.clutch && f.clutchSide) push("pbp", "tenso", "clutch", `${bs.observer.focusName ?? "Un jugador"} se queda SOLO en el clutch. Silencio absoluto.`);
  if (f.firstBlood) push("pbp", "hype", "fb", "¡Primera sangre! Arranca la ronda con ventaja.");
  if (f.plant) push("pbp", "tenso", "plant", "¡Spike plantada! Empieza la cuenta atrás.");
  if (f.defuse) push("pbp", "tenso", "defuse", "¡Están desactivando! ¿Llegan a tiempo?");

  // — Color: lecturas de estado (mental, mapa, números) —
  const enemy: Side = snap.coachSide === "ATK" ? "DEF" : "ATK";
  const enemPlayers = snap.players.filter((p) => p.side === enemy);
  const enemTilt = avg(enemPlayers.map((p) => p.mental.tilt));
  const enemConf = avg(enemPlayers.map((p) => p.mental.confidence));
  if (enemTilt >= 55 || enemConf <= 36) push("color", "analisis", "broken", `${teamName(names, enemy)} está completamente roto mentalmente.`);
  else {
    const us = snap.players.filter((p) => p.side === snap.coachSide);
    if (avg(us.map((p) => p.mental.confidence)) >= 70) push("color", "calmado", "conf", `${teamName(names, snap.coachSide)} juega con una confianza enorme ahora mismo.`);
  }
  if (snap.map) {
    const ctrl = snap.map.control;
    const dom: Side | null = ctrl.ATK >= ctrl.DEF + 6 ? "ATK" : ctrl.DEF >= ctrl.ATK + 6 ? "DEF" : null;
    if (dom) push("color", "analisis", "map", `El mapa pertenece a ${teamName(names, dom)}.`);
  }
  if (Math.abs(bs.stats.numbersAdvantage) >= 2) {
    const side = bs.stats.numbersAdvantage > 0 ? snap.coachSide : enemy;
    push("color", "tenso", "adv", `Ventaja numérica clara para ${teamName(names, side)}.`);
  }

  return out;
}

/**
 * Comentario de FIN DE RONDA: reutiliza `analyze` (causas ya verbalizadas), los momentos
 * de producción y un jugador en racha (cross-round). Determinista.
 */
export function roundEndCasters(match: MatchState, finished: RoundState, names?: CasterNames): CasterLine[] {
  const out: CasterLine[] = [];
  const n = match.roundNumber;
  const a = analyze(finished);
  out.push({ id: `re:${n}:head`, voice: "pbp", tone: "hype", text: `${a.headline}.`, at: n });
  for (const [i, c] of a.causes.slice(0, 2).entries()) {
    out.push({ id: `re:${n}:c${i}`, voice: "analista", tone: "analisis", text: c.text, at: n });
  }
  const moments = detectRoundMoments(match, finished);
  if (moments[0]) out.push({ id: `re:${n}:mom`, voice: "pbp", tone: "hype", text: `${moments[0].label}${moments[0].sub ? ` · ${moments[0].sub}` : ""}.`, at: n });

  // Jugador en racha (3 rondas dominando).
  const last3 = [...match.rounds.slice(-2), finished];
  const k: Record<string, number> = {};
  for (const r of last3) for (const e of r.events) if (e.type === "kill") { const nm = String((e.data as { byName?: string }).byName ?? ""); if (nm) k[nm] = (k[nm] ?? 0) + 1; }
  const star = Object.entries(k).sort((x, y) => y[1] - x[1])[0];
  if (last3.length >= 3 && star && star[1] >= 6) out.push({ id: `re:${n}:star`, voice: "color", tone: "analisis", text: `${star[0]} lleva tres rondas dominando: ${star[1]} bajas en ese tramo.`, at: n });
  return out;
}

/** Comentario POST-PARTIDO: usa las frases deterministas del Narrative Engine. */
export function postMatchCasters(match: MatchState): CasterLine[] {
  const out: CasterLine[] = [];
  const ns = match.narrative;
  if (!ns) return out;
  out.push({ id: "pm:head", voice: "pbp", tone: "hype", text: `${ns.summary.headline}.`, at: 0 });
  for (const [i, b] of ns.summary.beats.slice(0, 4).entries()) out.push({ id: `pm:b${i}`, voice: "analista", tone: "analisis", text: b.text, at: i + 1 });
  const q = answerQuestions(ns);
  out.push({ id: "pm:why", voice: "color", tone: "analisis", text: q.whyWon.text, at: 5 });
  if (q.biggestMoment?.text) out.push({ id: "pm:big", voice: "pbp", tone: "hype", text: q.biggestMoment.text, at: 6 });
  return out;
}
