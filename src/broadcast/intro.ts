/**
 * INTRO DEL PARTIDO — la presentación de "gran final": equipos, jugadores, favorito,
 * underdog, win probability, mapa, entrenador e historia. Compone datos del Match Engine
 * (rosters/config) sin tocar nada. PURO/determinista.
 */
import type { MatchState } from "../match";
import type { RosterEntry } from "../sim";
import { ns, td } from "@/i18n/runtime";

const t = ns("broadcast");

export interface IntroPlayer { name: string; role: string; ovr: number }
export interface IntroTeam { name: string; players: IntroPlayer[]; strength: number }

export interface MatchIntro {
  home: IntroTeam;
  away: IntroTeam;
  map: string;
  coachMode: string;
  favorite: "home" | "away";
  underdog: "home" | "away";
  winProbability: { home: number; away: number };
  /** Racha / historial opcionales (los aporta el contexto: record, mundo). */
  homeStreak?: number;
  h2h?: { home: number; away: number };
  storyline: string;
}

const playerOvr = (e: RosterEntry): number =>
  e.meta?.ovr ?? Math.round((e.attrs.aim + e.attrs.gameSense + e.attrs.utility + e.attrs.leadership) / 4);

function introTeam(name: string, roster: RosterEntry[]): IntroTeam {
  const players = roster.map((e) => ({ name: e.name, role: e.role, ovr: playerOvr(e) }));
  const strength = players.length ? Math.round(players.reduce((a, p) => a + p.ovr, 0) / players.length) : 50;
  return { name, players, strength };
}

export function buildMatchIntro(match: MatchState, opts: { homeStreak?: number; h2h?: { home: number; away: number } } = {}): MatchIntro {
  const names = match.config.teamNames ?? { home: "Local", away: "Rival" };
  const home = introTeam(names.home, match.config.rosters.home);
  const away = introTeam(names.away, match.config.rosters.away);

  // Win probability por diferencia de fuerza (logística).
  const pHome = 1 / (1 + Math.exp(-(home.strength - away.strength) / 6));
  const winProbability = { home: Math.round(pHome * 100), away: Math.round((1 - pHome) * 100) };
  const favorite = pHome >= 0.5 ? "home" : "away";
  const underdog = favorite === "home" ? "away" : "home";

  const gap = Math.abs(home.strength - away.strength);
  const favName = favorite === "home" ? home.name : away.name;
  const dogName = underdog === "home" ? home.name : away.name;
  const storyline = gap >= 6
    ? t("{favName} parte como claro favorito, pero {dogName} buscará la sorpresa.", { favName: td(favName), dogName: td(dogName) })
    : t("Duelo parejo entre {name} y {name2}: cualquier detalle decidirá.", { name: home.name, name2: away.name });

  return {
    home, away, map: "Ascent",
    coachMode: match.config.coach.mode,
    favorite, underdog, winProbability,
    homeStreak: opts.homeStreak, h2h: opts.h2h,
    storyline,
  };
}
