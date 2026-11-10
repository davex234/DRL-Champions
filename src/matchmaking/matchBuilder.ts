/**
 * MATCH BUILDER — de tickets emparejados a una partida del Online Core (Online Fase 2/7).
 *
 * Construye la propuesta (equipos + bot fill + servidor + seed + calidad + ready check) y la
 * traduce a un `LobbyDraft` del ÚNICO Online Core (no crea Lobby/Match/Server nuevos). Los
 * rosters REUTILIZAN el del jugador o `buildRivalRoster` (jugadores reales). PURO/DETERMINISTA.
 */
import type { LobbyDraft } from "@/online";
import type { CoachSetup, RosterEntry } from "@/sim";
import type { CoachConfig } from "@/coach";
import { buildRivalRoster } from "@/lib/match/roster";
import { seedFrom } from "@/sim/rng";
import type { QueueMode, QueueTicket, ServerNode, MatchProposal, PlayerProfile } from "./types";
import { bestRegionFor } from "./region";
import { selectServer } from "./server";
import { teamBalance } from "./balance";
import { fillSide, isBot } from "./botfill";
import { newReadyCheck } from "./readycheck";

export type RosterProvider = (seed: number, exclude: Set<string>, difficulty?: "easy" | "normal" | "hard") => RosterEntry[];
export const defaultRosterProvider: RosterProvider = (seed, exclude, diff = "normal") => buildRivalRoster(seed, exclude, diff);

const DEFAULT_SETUP: CoachSetup = { side: "ATK", approach: "default", tempo: "mid", aggression: "balanced" };

export function seedFor(base: number, proposalId: string): number { return seedFrom(`${base}:${proposalId}`) >>> 0; }

/** Construye una propuesta a partir de los tickets de cada lado (rellena a 1 coach por lado con bots). */
export function buildProposal(
  mode: QueueMode, homeTickets: QueueTicket[], awayTickets: QueueTicket[],
  nodes: ServerNode[], now: number, seedBase: number, propId: string, readyTimeout: number, needsReady: boolean,
): MatchProposal {
  const homeP = homeTickets.map((t) => t.profile);
  const awayP = awayTickets.map((t) => t.profile);
  const all: PlayerProfile[] = [...homeP, ...awayP];
  const region = bestRegionFor(all.length ? all : homeP);
  const targetMmr = all.length ? Math.round(all.reduce((a, p) => a + p.mmr, 0) / all.length) : 1500;
  const home = fillSide(homeP, 1, seedBase, region, targetMmr);
  const away = fillSide(awayP, 1, seedBase + 1, region, targetMmr);
  const server = selectServer(mode, region, nodes);
  const seed = seedFor(seedBase, propId);
  const quality = teamBalance(home.profiles, away.profiles);
  const needed = needsReady ? [...homeTickets, ...awayTickets].filter((t) => !isBot(t.profile.id)).map((t) => t.id) : [];
  return {
    id: propId, mode, createdAt: now,
    teamHome: homeTickets.map((t) => t.id), teamAway: awayTickets.map((t) => t.id),
    botsHome: home.bots, botsAway: away.bots, server, seed, quality,
    readyCheck: newReadyCheck(propId, needed, now + readyTimeout),
  };
}

/** Traduce una propuesta a un `LobbyDraft` del Online Core. Reutiliza rosters reales/bot. */
export function toLobbyDraft(proposal: MatchProposal, ticketsById: Map<string, QueueTicket>, rosterProvider: RosterProvider = defaultRosterProvider): LobbyDraft {
  const homeTicket = proposal.teamHome[0] ? ticketsById.get(proposal.teamHome[0]) : undefined;
  const awayTicket = proposal.teamAway[0] ? ticketsById.get(proposal.teamAway[0]) : undefined;
  const homeRoster = homeTicket?.profile.roster ?? rosterProvider(proposal.seed ^ 0x11, new Set(), "normal");
  const awayRoster = awayTicket?.profile.roster ?? rosterProvider(proposal.seed ^ 0x22, new Set(), "normal");
  const humanHome = !!homeTicket && !isBot(homeTicket.profile.id);
  const coach: CoachConfig = { mode: humanHome ? "manual" : "ai" };
  return {
    seed: proposal.seed,
    rosters: { home: homeRoster, away: awayRoster },
    homeSetup: DEFAULT_SETUP,
    teamNames: { home: homeTicket?.profile.name ?? "Home", away: awayTicket?.profile.name ?? "Away" },
    coach,
  };
}
