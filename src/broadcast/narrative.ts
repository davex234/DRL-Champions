/**
 * PRESENTACIÓN × NARRATIVA — los 16 hitos de RETRANSMISIÓN (sin frases de UI).
 *
 * Reutiliza el Narrative Engine (`NarrativeState`: shape/keyMoments/momentum/heroes) + los
 * eventos tácticos/coach ya detectados + los datos de ronda, siguiendo el mismo patrón
 * `detect*Events`. No crea otro motor narrativo: lee el que ya existe. PURO/determinista.
 */
import type { MatchState } from "../match";
import type { RoundState } from "../sim";
import { coachRating } from "../lib/match/moments";
import { ns as i18nNs } from "@/i18n/runtime";

const tr = i18nNs("broadcast");

export type PresentationEventType =
  | "legendary_clutch" | "great_tactical_read" | "perfect_retake" | "perfect_execute"
  | "the_turning_point" | "momentum_swing" | "coach_masterclass" | "mental_collapse"
  | "historic_victory" | "historic_defeat" | "map_domination" | "reverse_sweep"
  | "game_saving_play" | "match_point_pressure" | "impossible_comeback" | "final_mvp";

export interface PresentationEvent {
  type: PresentationEventType;
  round: number;        // 0 = nivel de partido
  team: "home" | "away";
  magnitude: number;    // 1..100
  detail?: string;
  name?: string;
}

const m = (n: number) => Math.min(100, Math.max(1, Math.round(n)));

export function detectPresentationEvents(match: MatchState): PresentationEvent[] {
  const out: PresentationEvent[] = [];
  const ns = match.narrative;
  const homeWon = match.winner === "home";
  const push = (type: PresentationEventType, team: "home" | "away", magnitude: number, round = 0, detail?: string, name?: string) =>
    out.push({ type, round, team, magnitude: m(magnitude), detail, name });

  // — Clutches legendarios (1vX, X≥3) desde el timeline narrativo —
  if (ns) {
    for (const ev of ns.timeline) {
      if (ev.type === "clutch") {
        const size = Number((ev.data as { clutchSize?: number }).clutchSize ?? 1);
        const team = ev.favors === "A" ? "home" : "away";
        if (size >= 3) push("legendary_clutch", team, 80 + size * 4, ev.round, `1v${size}`, ev.participants[0]?.name);
        if (ev.round >= match.config.win.firstTo - 1) push("game_saving_play", team, 78, ev.round, tr("jugada que salva el partido"), ev.participants[0]?.name);
      }
    }
  }

  // — Eventos tácticos: lectura / retake / execute —
  for (const t of match.tacticalEvents) {
    if (t.type === "anti_strat_success") push("great_tactical_read", t.team, 60 + t.magnitude * 0.3, t.round, tr("lectura perfecta del rival"));
    if (t.type === "retake_masterclass") push("perfect_retake", t.team, 70 + t.magnitude * 0.3, t.round, t.detail);
    if (t.type === "fast_execute") push("perfect_execute", t.team, 60 + t.magnitude * 0.3, t.round, tr("ejecución relámpago"));
  }

  // — Coach masterclass —
  const cr = coachRating(match);
  if (cr.grade === "S" || cr.grade === "A") push("coach_masterclass", homeWon ? "home" : "away", cr.score, 0, tr("nota {grade} del entrenador", { grade: cr.grade }));
  for (const c of match.coachEvents) if (c.type === "tactical_genius" || c.type === "brilliant_call") push("coach_masterclass", c.team, 55 + c.magnitude * 0.3, c.round, c.detail);

  // — Momentum / punto de inflexión —
  if (ns) {
    for (const sh of ns.momentum.shifts) if (sh.magnitude >= 30) push("momentum_swing", sh.to === "A" ? "home" : "away", 50 + sh.magnitude, sh.round, tr("vuelco de momentum"));
    if (ns.summary.turningPoint != null) push("the_turning_point", homeWon ? "home" : "away", 70, ns.summary.turningPoint, tr("el punto de inflexión"));
  }

  // — Forma del partido: blowout/comeback/miracle —
  if (ns) {
    const shape = ns.match.shape.id;
    const winnerTeam = homeWon ? "home" : "away";
    const loserTeam = homeWon ? "away" : "home";
    if (shape === "blowout" || shape === "dominance" || shape === "one_sided") {
      push("historic_victory", winnerTeam, 85, 0, tr("victoria aplastante"));
      push("historic_defeat", loserTeam, 80, 0, tr("derrota histórica"));
      push("map_domination", winnerTeam, 80, 0, tr("dominio total"));
    }
    if (shape === "comeback" || shape === "collapse") push("reverse_sweep", winnerTeam, 82, 0, tr("le dan la vuelta"));
    if (shape === "miracle") push("impossible_comeback", winnerTeam, 95, 0, tr("remontada imposible"));
  }

  // — Map domination por control acumulado (si no salió por shape) —
  if (!out.some((e) => e.type === "map_domination") && match.rounds.length >= 3) {
    let home = 0, away = 0;
    for (const r of match.rounds) {
      if (!r.map) continue;
      home += r.map.control[r.coachSide];
      away += r.map.control[r.coachSide === "ATK" ? "DEF" : "ATK"];
    }
    if (home >= away * 1.5 && home > 0) push("map_domination", "home", 70, 0, tr("control de mapa dominante"));
    else if (away >= home * 1.5 && away > 0) push("map_domination", "away", 70, 0, tr("control de mapa dominante"));
  }

  // — Match point + MVP final —
  const target = match.config.win.firstTo;
  if (match.score.home >= target - 1 || match.score.away >= target - 1) {
    const side = match.score.home >= match.score.away ? "home" : "away";
    push("match_point_pressure", side, 75, match.roundNumber, tr("presión de match point"));
  }
  // Mental collapse: villano que se desvanece.
  if (ns && ns.villains[0]?.tags.includes("disappeared")) push("mental_collapse", ns.villains[0].team === "A" ? "home" : "away", 70, 0, ns.villains[0].reason, ns.villains[0].name);
  // MVP final.
  if (ns?.heroes[0]) push("final_mvp", ns.heroes[0].team === "A" ? "home" : "away", 90, 0, ns.heroes[0].reason, ns.heroes[0].name);
  else if (match.mvp) push("final_mvp", match.mvp.team, 85, 0, `${match.mvp.kills} bajas`, match.mvp.name);

  return out;
}
