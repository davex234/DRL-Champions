/**
 * COMPETITIVE ENGINE — el orquestador del ÚNICO flujo (Online Fase 3/7).
 *
 *   Match End → MMR → División → Temporada → Leaderboard → (Career/World/Presentation)
 *
 * `applyMatchResult` es la única entrada: valida (solo competitive, temporada correcta, no
 * duplicado), actualiza AMBOS perfiles (Elo suma-cero), refresca leaderboards INCREMENTALES y
 * devuelve un `CompetitiveUpdate` para Career/World/Presentation. Los bots no puntúan. Todo
 * DETERMINISTA y calculado SOLO desde el MatchResult autoritativo (nunca del cliente).
 */
import type { Region } from "@/domain/cards/types";
import type { CompetitiveProfile, CompetitiveMatchResult, CompetitiveUpdate, LeaderboardEntry, RankEvent, SeasonReward } from "./types";
import { newProfile, recordMatch, rankOf, inPlacement } from "./profile";
import { Leaderboard } from "./leaderboard";
import { newSeasonState, softReset, type SeasonState } from "./season";
import { applyDecay, DEFAULT_DECAY, type DecayConfig } from "./decay";
import { seasonReward } from "./rewards";
import { DEFAULT_RATING } from "./mmr";

const isBot = (id: string): boolean => id.startsWith("bot-");

export interface CompetitiveEngineOptions { season?: number; startedAt?: number; seasonLength?: number | null; decay?: DecayConfig }

export class CompetitiveEngine {
  now = 0;
  season: SeasonState;
  private profiles = new Map<string, CompetitiveProfile>();
  private processed = new Set<string>();
  global = new Leaderboard("global");
  private regional = new Map<Region, Leaderboard>();
  coach = new Leaderboard("coach");
  events: RankEvent[] = [];
  private decayCfg: DecayConfig;

  constructor(opts: CompetitiveEngineOptions = {}) {
    this.season = newSeasonState(opts.season ?? 1, opts.startedAt ?? 0, opts.seasonLength ?? null);
    this.decayCfg = opts.decay ?? DEFAULT_DECAY;
  }

  ensure(id: string, name: string, region: Region, coachRating = 0): CompetitiveProfile {
    let p = this.profiles.get(id);
    if (!p) { p = newProfile(id, name, region, { coachRating, season: this.season.number }); this.profiles.set(id, p); }
    return p;
  }
  profile(id: string): CompetitiveProfile | undefined { return this.profiles.get(id); }
  rankLabelOf(id: string): string { const p = this.profiles.get(id); return p ? rankOf(p) : "—"; }
  regionalBoard(region: Region): Leaderboard { let b = this.regional.get(region); if (!b) { b = new Leaderboard("regional", region); this.regional.set(region, b); } return b; }
  playerCount(): number { return this.profiles.size; }

  private entryOf(p: CompetitiveProfile): LeaderboardEntry { return { id: p.id, name: p.name, mmr: p.mmr, region: p.region, league: p.league, division: p.division, wins: p.wins, losses: p.losses }; }
  private updateBoards(p: CompetitiveProfile): void {
    if (inPlacement(p)) return;                 // no entra en leaderboard hasta colocar
    const e = this.entryOf(p);
    this.global.upsert(e); this.regionalBoard(p.region).upsert(e);
    if (p.coachRating > 0) this.coach.upsert(e);
  }

  /** ÚNICA VÍA de actualización. Devuelve el update para Career/World/Presentation. */
  applyMatchResult(r: CompetitiveMatchResult): CompetitiveUpdate {
    const empty: CompetitiveUpdate = { matchId: r.matchId, players: [], events: [] };
    if (r.mode !== "competitive") return empty;          // solo competitive puntúa
    if (r.season !== this.season.number) return empty;   // anti corrupción de temporada
    if (this.processed.has(r.matchId)) return empty;     // anti doble-actualización (idempotente)
    this.processed.add(r.matchId);
    this.now = r.at;

    const homeWon = r.winner === "home";
    const homeMmr = isBot(r.homeId) ? (this.profiles.get(r.homeId)?.mmr ?? DEFAULT_RATING) : this.ensure(r.homeId, r.homeId, r.region).mmr;
    const awayMmr = isBot(r.awayId) ? (this.profiles.get(r.awayId)?.mmr ?? DEFAULT_RATING) : this.ensure(r.awayId, r.awayId, r.region).mmr;

    const players: CompetitiveUpdate["players"] = [];
    const evs: RankEvent[] = [];
    if (!isBot(r.homeId)) players.push(this.updateSide(r.homeId, r.region, homeWon, awayMmr, r.scoreHome, r.scoreAway, r.mvp === "home", r.matchId, r.at, evs));
    if (!isBot(r.awayId)) players.push(this.updateSide(r.awayId, r.region, !homeWon, homeMmr, r.scoreAway, r.scoreHome, r.mvp === "away", r.matchId, r.at, evs));

    this.events.push(...evs);
    return { matchId: r.matchId, players, events: evs };
  }

  private updateSide(id: string, region: Region, won: boolean, oppMmr: number, scoreFor: number, scoreAgainst: number, mvp: boolean, matchId: string, at: number, evs: RankEvent[]): CompetitiveUpdate["players"][number] {
    const before = this.ensure(id, id, region);
    const mmrBefore = before.mmr, rankBefore = rankOf(before);
    const { profile, events } = recordMatch(before, { matchId, won, opponentMmr: oppMmr, scoreFor, scoreAgainst, mvp, at }, this.now);
    this.profiles.set(id, profile);
    this.updateBoards(profile);
    evs.push(...events);
    return { id, mmrBefore, mmrAfter: profile.mmr, mmrDelta: profile.mmr - mmrBefore, rankBefore, rankAfter: rankOf(profile), won };
  }

  /** Cierra la temporada: recompensas + soft reset de todos + leaderboards nuevos. */
  endSeason(now: number): SeasonReward[] {
    this.now = now;
    const rewards = [...this.profiles.values()].map(seasonReward);
    const next = this.season.number + 1;
    for (const [id, p] of this.profiles) this.profiles.set(id, softReset(p, next, now));
    this.global = new Leaderboard("global"); this.regional.clear(); this.coach = new Leaderboard("coach");
    const length = this.season.endsAt != null ? this.season.endsAt - this.season.startedAt : null;
    this.season = newSeasonState(next, now, length);
    return rewards;
  }

  /** Aplica decay por inactividad a todos los perfiles elegibles. */
  tickDecay(now: number): RankEvent[] {
    this.now = now; const evs: RankEvent[] = [];
    for (const [id, p] of this.profiles) { const r = applyDecay(p, now, this.decayCfg); if (r.event) { this.profiles.set(id, r.profile); this.updateBoards(r.profile); evs.push(r.event); } }
    this.events.push(...evs); return evs;
  }
}
