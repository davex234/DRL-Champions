/**
 * COMPOSICIÓN DE EQUIPO (capa de presentación/coach).
 *
 * Puente puro entre los rosters de cartas y el Agent Engine: asigna agentes y analiza
 * la composición de ambos equipos + el matchup. Lo usan Preparation, Coach, Broadcast
 * y la ceremonia para razonar sobre composiciones (no solo estrategias). Solo LEE.
 */
import type { RosterEntry } from "@/sim";
import { neutralIdentity } from "@/sim";
import {
  buildLineup, analyzeComposition, compareCompositions,
  type CompositionProfile, type CompositionMatchup,
} from "@/agents";

const toInput = (e: RosterEntry) => ({ name: e.name, role: e.role, identity: e.identity ?? neutralIdentity() });
const idBy = (roster: RosterEntry[]) => Object.fromEntries(roster.map((e) => [e.name, e.identity ?? neutralIdentity()]));

/** Composición de un equipo (asigna agentes + analiza). */
export function teamComposition(roster: RosterEntry[]): CompositionProfile {
  return analyzeComposition(buildLineup(roster.map(toInput)), idBy(roster));
}

export interface MatchCompositions {
  ours: CompositionProfile;
  theirs: CompositionProfile;
  matchup: CompositionMatchup;
}

/** Composiciones de ambos equipos + recomendaciones del matchup (para el coach). */
export function matchCompositions(home: RosterEntry[], away: RosterEntry[]): MatchCompositions {
  const ours = teamComposition(home);
  const theirs = teamComposition(away);
  return { ours, theirs, matchup: compareCompositions(ours, theirs) };
}
