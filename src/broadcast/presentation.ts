/**
 * PRESENTACIÓN EN VIVO — el productor maestro que el HUD/overlay consume cada frame:
 * comentaristas, estadísticas, observer, fase táctica, coach call, control del mapa, moral
 * de equipo, win prob y momentum. TODO sale de datos ya existentes (Broadcast/Sim/Match):
 * cero cálculo de simulación nuevo. Extiende el Broadcast. PURO.
 */
import type { RoundState, Side } from "../sim";
import type { MatchState } from "../match";
import type { BroadcastState } from "./types";
import { liveCasters, type CasterLine, type CasterNames } from "./casters";
import { liveStats, spaceControl, type LiveStatLine } from "./liveStats";

export interface LivePresentation {
  casters: CasterLine[];
  stats: LiveStatLine[];
  observer: { situation: string; reason: string; focusName: string | null; priority: number };
  tacticalPhase: string | null;
  coachCall: string | null;
  control: { atk: number; def: number };
  teamMental: { us: number; them: number };
  winProbCoach: number;
  momentum: number;
}

const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);

export function buildLivePresentation(snap: RoundState, bs: BroadcastState, match: MatchState, names?: CasterNames): LivePresentation {
  const us = snap.coachSide;
  const them: Side = us === "ATK" ? "DEF" : "ATK";
  const ours = us === "ATK" ? snap.tactical?.ATK : snap.tactical?.DEF;
  const calls = snap.events.filter((e) => e.type === "coachCall");
  const coachCall = calls.length ? String((calls[calls.length - 1].data as { id?: string }).id ?? "") : (bs.plan?.concept ?? null);

  return {
    casters: liveCasters(snap, bs, names),
    stats: liveStats(match, snap),
    observer: { situation: bs.observer.situation, reason: bs.observer.reason, focusName: bs.observer.focusName, priority: bs.observer.priority },
    tacticalPhase: ours?.phase ?? null,
    coachCall,
    control: spaceControl(snap),
    teamMental: {
      us: avg(snap.players.filter((p) => p.side === us).map((p) => p.mental.confidence)),
      them: avg(snap.players.filter((p) => p.side === them).map((p) => p.mental.confidence)),
    },
    winProbCoach: bs.stats.winProb.coach,
    momentum: match.momentum,
  };
}
