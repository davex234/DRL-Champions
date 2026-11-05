/**
 * MATCH ENGINE — Reglas CONFIGURABLES (puras) y configuración por defecto.
 *
 * Nada de números mágicos en el motor: la condición de victoria, el cambio de lado
 * y el tope de rondas se deciden aquí. La prórroga queda preparada (arquitectura)
 * pero NO se implementa en esta fase.
 */
import type { MatchConfig, MatchScore, OvertimeRules, TeamSlot, WinRules } from "./types";
import type { CoachSetup, MatchRosters } from "@/sim";
import type { EconomyRules } from "@/economy";
import { DEFAULT_RULES } from "@/economy";
import type { CoachConfig } from "@/coach";

/** Valores tipo Valorant, pero todos configurables. */
export const DEFAULT_WIN: WinRules = { firstTo: 13, winBy: 1 };
export const DEFAULT_SWITCH_AFTER = 12;
export const DEFAULT_OVERTIME: OvertimeRules = { enabled: false, firstTo: 4, winBy: 2 };

/** Tope de rondas en regulación (seguridad). Para winBy=1 es exacto: firstTo*2-1. */
export function regulationMaxRounds(win: WinRules): number {
  return win.firstTo * 2 - 1;
}

export interface MatchConfigInput {
  seed: number;
  rosters: MatchRosters;
  homeSetup: CoachSetup;
  win?: Partial<WinRules>;
  switchAfter?: number;
  maxRounds?: number;
  overtime?: Partial<OvertimeRules>;
  /** Reglas económicas; `null` desactiva el Economy Engine. Por defecto: activo. */
  economy?: EconomyRules | null;
  /** Alimentar al Tactical Engine con la economía (por defecto false). */
  useEconomyTactics?: boolean;
  /** Integrar el Loadout en el combate (Combat2). Por defecto true. */
  useLoadoutCombat?: boolean;
  /** Entrenador: por defecto IA. */
  coach?: CoachConfig;
  teamNames?: { home: string; away: string };
  /** FASE 51.1 · mapa canónico de presentación (el motor no lo lee). */
  mapId?: string;
}

/** Construye una `MatchConfig` completa a partir de lo mínimo + defaults. */
export function makeMatchConfig(input: MatchConfigInput): MatchConfig {
  const win: WinRules = { ...DEFAULT_WIN, ...input.win };
  return {
    seed: input.seed >>> 0,
    rosters: input.rosters,
    homeSetup: input.homeSetup,
    win,
    switchAfter: input.switchAfter ?? DEFAULT_SWITCH_AFTER,
    maxRounds: input.maxRounds ?? regulationMaxRounds(win),
    overtime: { ...DEFAULT_OVERTIME, ...input.overtime },
    economy: input.economy === undefined ? DEFAULT_RULES : input.economy,
    useEconomyTactics: input.useEconomyTactics ?? false,
    useLoadoutCombat: input.useLoadoutCombat ?? true,
    coach: input.coach ?? { mode: "ai" },
    teamNames: input.teamNames,
    ...(input.mapId ? { mapId: input.mapId } : {}),
  };
}

/** ¿Hay ganador del partido con el marcador dado? Devuelve el equipo o null. */
export function matchWinner(score: MatchScore, win: WinRules): TeamSlot | null {
  if (score.home >= win.firstTo && score.home - score.away >= win.winBy) return "home";
  if (score.away >= win.firstTo && score.away - score.home >= win.winBy) return "away";
  return null;
}

/** ¿Toca cambiar de lado tras `roundsPlayed` rondas? (un cambio en la media parte). */
export function shouldSwitchSide(roundsPlayed: number, config: MatchConfig): boolean {
  return roundsPlayed === config.switchAfter;
}

/** Equipos a punto de ganar (match point): ganarían la SIGUIENTE ronda. */
export function matchPointTeams(score: MatchScore, win: WinRules): TeamSlot[] {
  const teams: TeamSlot[] = [];
  if (matchWinner({ home: score.home + 1, away: score.away }, win) === "home") teams.push("home");
  if (matchWinner({ home: score.home, away: score.away + 1 }, win) === "away") teams.push("away");
  return teams;
}
