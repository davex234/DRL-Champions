/**
 * TOURNAMENT ENGINE / MANAGER / LIFECYCLE — el orquestador (Online Fase 6/7).
 *
 *   Tournament → Bracket → Match(config) → Gameplay → Competitive → Replay → Presentation
 *
 * Reutiliza el ÚNICO Gameplay (`makeMatchConfig`+`simulateMatch` por defecto; inyectable para
 * Online/verify), el Seed Engine, el Bracket Engine y las Series. NO crea otro Match/Bracket
 * paralelo. Lifecycle: registration→checkin→seeding→(group|playoff)→finished. DETERMINISTA.
 * SEGURIDAD: sin equipos duplicados, sin avanzar eliminados, admin autorizado, resultados válidos.
 */
import type { Region } from "@/domain/cards/types";
import type { CoachSetup } from "@/sim";
import { makeMatchConfig, simulateMatch } from "@/match";
import { buildRivalRoster, type RivalDifficulty } from "@/lib/match/roster";
import type {
  Team, TournamentFormat, SeedMethod, SeriesFormat, TournamentTier, TournamentStatus,
  Bracket, Fixture, PlayFn, TournamentAwards, CircuitStanding, TournamentEvent,
} from "./types";
import { seedTeams } from "./seed";
import { buildSingleElim, buildDoubleElim, buildRoundRobin, buildSwissRound1, nextSwissRound, buildGroupStage, advanceFixture, readyFixtures, pendingCount } from "./bracket";
import { resolveSeries } from "./series";
import { circuitPointsFor } from "./awards";

const SETUP: CoachSetup = { side: "ATK", approach: "default", tempo: "mid", aggression: "balanced" };
function difficultyFor(rating: number): RivalDifficulty { return rating >= 1650 ? "hard" : rating <= 1350 ? "easy" : "normal"; }

/** PlayFn por defecto: juega el mapa con el ÚNICO Gameplay (simulateMatch). Fuerza del roster ∝ rating. */
export function gameplayPlay(): PlayFn {
  return (ctx) => {
    const home = buildRivalRoster(ctx.mapSeed ^ 0x101, new Set(), difficultyFor(ctx.teamA.rating));
    const away = buildRivalRoster(ctx.mapSeed ^ 0x202, new Set(), difficultyFor(ctx.teamB.rating));
    const config = makeMatchConfig({ seed: ctx.mapSeed, rosters: { home, away }, homeSetup: SETUP, teamNames: { home: ctx.teamA.name, away: ctx.teamB.name }, coach: { mode: "ai" } });
    const m = simulateMatch(config);
    return { winner: m.winner === "home" ? "A" : "B", scoreHome: m.score.home, scoreAway: m.score.away, matchId: `${ctx.fixture.id}-m${ctx.mapIndex}` };
  };
}

export interface TeamInput { id: string; name: string; region: Region; rating: number; roster?: Team["roster"] }
export interface TournamentConfig {
  id: string; name: string; tier: TournamentTier; format: TournamentFormat;
  seedMethod: SeedMethod; seriesFormat: SeriesFormat; seed: number;
  swissRounds?: number; groupCount?: number; groupAdvance?: number; adminId?: string;
}

export class Tournament {
  readonly cfg: TournamentConfig;
  status: TournamentStatus = "registration";
  teams: Team[] = [];
  bracket: Bracket | null = null;
  paused = false;
  now = 0;
  events: TournamentEvent[] = [];
  onFixturePlayed?: (fixture: Fixture, teamA: Team, teamB: Team, winner: string) => void;
  private byId = new Map<string, Team>();
  private admins = new Set<string>();
  private play: PlayFn;
  private swissRound = 1;
  private groupArchive: Bracket | null = null;

  constructor(cfg: TournamentConfig, play?: PlayFn) { this.cfg = cfg; this.play = play ?? gameplayPlay(); if (cfg.adminId) this.admins.add(cfg.adminId); }

  private emit(type: string, data?: unknown): void { this.events.push({ type, at: this.now, data }); }

  register(t: TeamInput): { ok: boolean; error?: string } {
    if (this.status !== "registration") return { ok: false, error: "closed" };
    if (this.byId.has(t.id)) return { ok: false, error: "duplicate" };   // SEGURIDAD: sin equipos duplicados
    const team: Team = { id: t.id, name: t.name, region: t.region, seed: 0, rating: t.rating, roster: t.roster ?? null, status: "active", checkedIn: false, wins: 0, losses: 0, placement: null };
    this.teams.push(team); this.byId.set(t.id, team);
    return { ok: true };
  }
  checkIn(teamId: string): boolean { const t = this.byId.get(teamId); if (!t) return false; t.checkedIn = true; return true; }
  closeRegistration(): void { if (this.status === "registration") this.status = "checkin"; }

  start(now: number): { ok: boolean; error?: string } {
    this.now = now;
    const active = this.teams.filter((t) => t.status === "active" && t.checkedIn);
    if (active.length < 2) return { ok: false, error: "not-enough-teams" };
    this.status = "seeding";
    const seeded = seedTeams(active, this.cfg.seedMethod, this.cfg.seed);
    for (const s of seeded) { const t = this.byId.get(s.id)!; t.seed = s.seed; }
    const teams = seeded.map((s) => this.byId.get(s.id)!);
    switch (this.cfg.format) {
      case "single_elim": this.bracket = buildSingleElim(teams, this.cfg.seriesFormat); this.status = "playoff"; break;
      case "double_elim": this.bracket = buildDoubleElim(teams, this.cfg.seriesFormat); this.status = "playoff"; break;
      case "round_robin": this.bracket = buildRoundRobin(teams, this.cfg.seriesFormat); this.status = "live"; break;
      case "swiss": this.bracket = buildSwissRound1(teams, this.cfg.swissRounds ?? Math.ceil(Math.log2(teams.length)), this.cfg.seriesFormat); this.status = "live"; break;
      case "groups": this.bracket = buildGroupStage(teams, this.cfg.groupCount ?? 2, this.cfg.seriesFormat); this.status = "group"; break;
    }
    this.emit("started", { teams: teams.length, format: this.cfg.format });
    return { ok: true };
  }

  playFixture(fixtureId: string): { ok: boolean; error?: string } {
    const b = this.bracket; if (!b) return { ok: false, error: "no-bracket" };
    if (this.paused) return { ok: false, error: "paused" };
    const f = b.fixtures[fixtureId]; if (!f || f.status !== "ready") return { ok: false, error: "not-ready" };
    const A = this.byId.get(f.slotA!), B = this.byId.get(f.slotB!);
    if (!A || !B) return { ok: false, error: "missing-team" };
    f.status = "live";
    const { winner, loser } = resolveSeries(f, A, B, this.play, this.cfg.seed);
    advanceFixture(b, fixtureId, winner, loser);
    this.byId.get(winner)!.wins++; this.byId.get(loser)!.losses++;
    // Eliminación: en single elim el perdedor cae; en double elim solo si estaba en lower/final (sin loserTo).
    if (f.stage !== "upper" && f.stage !== "group" && f.stage !== "rr" && f.stage !== "swiss" && f.stage !== "bronze" && !f.loserTo) this.byId.get(loser)!.status = "eliminated";
    this.onFixturePlayed?.(f, A, B, winner);
    this.emit("fixture_done", { fixtureId, winner, loser });
    return { ok: true };
  }

  private advanceLifecycle(): boolean {
    const b = this.bracket!;
    if (this.cfg.format === "swiss") {
      const total = this.cfg.swissRounds ?? Math.ceil(Math.log2(this.teams.length));
      if (this.swissRound < total && pendingCount(b) === 0) { this.swissRound++; return nextSwissRound(b, this.teams.filter((t) => t.status !== "disqualified"), this.swissRound).length > 0; }
    }
    if (this.cfg.format === "groups" && this.status === "group" && pendingCount(b) === 0) { this.buildPlayoff(); return true; }
    return false;
  }

  private buildPlayoff(): void {
    const b = this.bracket!;
    const perGroup = this.cfg.groupAdvance ?? 2;
    const qualified: Team[] = [];
    for (const [g, ids] of Object.entries(b.groups)) {
      const ranked = ids.map((id) => this.byId.get(id)!).sort((a, x) => x.wins - a.wins || a.seed - x.seed);
      qualified.push(...ranked.slice(0, perGroup));
      ranked.slice(perGroup).forEach((t) => { if (t.status === "active") t.status = "eliminated"; });
    }
    this.groupArchive = b;
    const reseeded = seedTeams(qualified, "rank", this.cfg.seed);
    for (const s of reseeded) this.byId.get(s.id)!.seed = s.seed;
    this.bracket = buildSingleElim(reseeded.map((s) => this.byId.get(s.id)!), this.cfg.seriesFormat);
    this.status = "playoff";
    this.emit("playoff_built", { qualified: qualified.length });
  }

  /** Juega todos los fixtures listos y avanza el lifecycle hasta terminar (headless). */
  run(): void {
    if (this.status === "registration") this.closeRegistration();
    if (this.status === "checkin" || this.status === "seeding") this.start(this.now);
    let guard = 0;
    while (!this.isFinished() && !this.paused && guard++ < 100000) {
      const ready = readyFixtures(this.bracket!);
      if (ready.length === 0) { if (!this.advanceLifecycle()) break; continue; }
      for (const f of ready) this.playFixture(f.id);
    }
    if (this.isFinished()) this.finalize();
  }

  isFinished(): boolean {
    const b = this.bracket; if (!b) return false;
    if (this.cfg.format === "round_robin") return pendingCount(b) === 0;
    if (this.cfg.format === "swiss") return this.swissRound >= (this.cfg.swissRounds ?? Math.ceil(Math.log2(this.teams.length))) && pendingCount(b) === 0;
    if (this.cfg.format === "groups") return b.format === "single_elim" && !!b.finalId && b.fixtures[b.finalId].status === "done";
    return !!b.finalId && b.fixtures[b.finalId].status === "done";
  }

  champion(): string | null {
    if (this.cfg.format === "round_robin" || this.cfg.format === "swiss") return this.standings()[0]?.teamId ?? null;
    const fid = this.bracket?.finalId; return fid ? this.bracket!.fixtures[fid].winner : null;
  }

  private finalize(): void {
    this.status = "finished";
    const champ = this.champion();
    const standings = this.standings();
    standings.forEach((s, i) => { const t = this.byId.get(s.teamId); if (t) t.placement = i + 1; });
    if (champ) { const t = this.byId.get(champ); if (t) t.status = "champion"; }
    this.emit("finished", { champion: champ });
  }

  standings(): { teamId: string; name: string; wins: number; losses: number; seed: number }[] {
    return [...this.teams].filter((t) => t.status !== "disqualified").sort((a, b) => {
      const ap = a.placement ?? 999, bp = b.placement ?? 999;
      return (ap - bp) || (b.wins - a.wins) || (a.losses - b.losses) || (a.seed - b.seed);
    }).map((t) => ({ teamId: t.id, name: t.name, wins: t.wins, losses: t.losses, seed: t.seed }));
  }

  awards(): TournamentAwards {
    const s = this.standings();
    return { championId: s[0]?.teamId ?? null, runnerUpId: s[1]?.teamId ?? null, thirdId: s[2]?.teamId ?? null, mvpTeamId: s[0]?.teamId ?? null };
  }
  circuitPoints(): CircuitStanding[] {
    const field = this.teams.length;
    return this.standings().map((s, i) => ({ teamId: s.teamId, name: s.name, points: circuitPointsFor(this.cfg.tier, i + 1, field), best: i + 1 }));
  }

  // ── Admin ──
  addAdmin(id: string): void { this.admins.add(id); }
  private auth(by: string): boolean { return this.admins.has(by); }
  pause(by: string): { ok: boolean; error?: string } { if (!this.auth(by)) return { ok: false, error: "not-admin" }; this.paused = true; return { ok: true }; }
  resume(by: string): { ok: boolean; error?: string } { if (!this.auth(by)) return { ok: false, error: "not-admin" }; this.paused = false; return { ok: true }; }
  disqualify(by: string, teamId: string): { ok: boolean; error?: string } { if (!this.auth(by)) return { ok: false, error: "not-admin" }; const t = this.byId.get(teamId); if (!t) return { ok: false, error: "no-team" }; t.status = "disqualified"; this.emit("disqualified", { teamId }); return { ok: true }; }
  /** Walkover: adjudica un fixture al equipo `winnerSlot` (rival ausente). Admin. */
  walkover(by: string, fixtureId: string, winnerSlot: "A" | "B"): { ok: boolean; error?: string } {
    if (!this.auth(by)) return { ok: false, error: "not-admin" };
    const f = this.bracket?.fixtures[fixtureId]; if (!f) return { ok: false, error: "no-fixture" };
    const winner = winnerSlot === "A" ? f.slotA : f.slotB; const loser = winnerSlot === "A" ? f.slotB : f.slotA;
    if (!winner) return { ok: false, error: "no-team" };
    const r = advanceFixture(this.bracket!, fixtureId, winner, loser ?? winner);
    if (r.ok) { f.status = "walkover"; this.emit("walkover", { fixtureId, winner }); }
    return r;
  }
  forfeit(by: string, fixtureId: string, loserSlot: "A" | "B"): { ok: boolean; error?: string } { return this.walkover(by, fixtureId, loserSlot === "A" ? "B" : "A"); }
}
