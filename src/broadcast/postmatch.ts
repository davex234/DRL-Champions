/**
 * POST-PARTIDO — el resumen televisivo: jugador del partido, coach del partido, mejor
 * execute/retake, mayor clutch, timeline completo, highlights, estadísticas comparadas y
 * narrativa. Compone el Narrative Engine + moments + liveStats + highlights ya existentes.
 * PURO. No recalcula nada del combate.
 */
import type { MatchState } from "../match";
import { coachRating, type CoachRating } from "../lib/match/moments";
import { liveStats, type LiveStatLine } from "./liveStats";
import { extractHighlights, type HighlightClip } from "./replay";
import { detectPresentationEvents, type PresentationEvent } from "./narrative";
import type { WorldHistory } from "../world";
import { ns as i18nNs } from "@/i18n/runtime";

const t = i18nNs("broadcast");

export interface PostMatch {
  headline: string;
  shape: string;
  beats: string[];
  playerOfMatch: { name: string; reason: string } | null;
  coachOfMatch: CoachRating;
  bestExecute: { team: string; round: number; detail?: string } | null;
  bestRetake: { team: string; round: number; detail?: string } | null;
  biggestClutch: { name?: string; round: number; detail?: string } | null;
  scoreboard: LiveStatLine[];
  highlights: HighlightClip[];
  timeline: { round: number; text: string; importance: number }[];
  events: PresentationEvent[];
}

export function buildPostMatch(match: MatchState, worldHistory?: WorldHistory): PostMatch {
  const ns = match.narrative;
  const hero = ns?.heroes[0];
  const bestExec = [...match.tacticalEvents].filter((e) => e.type === "fast_execute").sort((a, b) => b.magnitude - a.magnitude)[0];
  const bestRetk = [...match.tacticalEvents].filter((e) => e.type === "retake_masterclass").sort((a, b) => b.magnitude - a.magnitude)[0];
  const clutch = ns?.timeline.filter((e) => e.type === "clutch").sort((a, b) => b.impact - a.impact)[0];

  return {
    headline: ns?.summary.headline ?? (match.winner === "home" ? t("Victoria") : t("Derrota")),
    shape: ns?.match.shape.id ?? "—",
    beats: ns?.summary.beats.map((b) => b.text) ?? [],
    playerOfMatch: hero ? { name: hero.name, reason: hero.reason } : (match.mvp ? { name: match.mvp.name, reason: `${match.mvp.kills} bajas` } : null),
    coachOfMatch: coachRating(match),
    bestExecute: bestExec ? { team: bestExec.team, round: bestExec.round, detail: bestExec.detail } : null,
    bestRetake: bestRetk ? { team: bestRetk.team, round: bestRetk.round, detail: bestRetk.detail } : null,
    biggestClutch: clutch ? { name: clutch.participants[0]?.name, round: clutch.round, detail: `1v${Number((clutch.data as { clutchSize?: number }).clutchSize ?? 1)}` } : null,
    scoreboard: liveStats(match),
    highlights: extractHighlights(match, worldHistory),
    timeline: (ns?.keyMoments ?? []).map((km) => ({ round: km.event.round, text: km.why, importance: km.event.importance })),
    events: detectPresentationEvents(match),
  };
}
