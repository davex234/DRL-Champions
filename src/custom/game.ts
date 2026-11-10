/**
 * CUSTOM GAME ENGINE — lobby privado + controles de árbitro/host (Online Fase 5/7).
 *
 * Crear/unirse(password)/slots(observer/coach/referee)/ready check/team switch/side swap/kick/
 * bot replace/settings + pausa/resume/restart. PRODUCE una `MatchConfig` reutilizando
 * `makeMatchConfig` + `buildRivalRoster` (jugadores reales). NUNCA crea otro Match/Server. El
 * servidor es autoritativo; aquí se gobierna la sala. Determinista.
 */
import type { CoachSetup } from "@/sim";
import { makeMatchConfig, type MatchConfig } from "@/match";
import { buildRivalRoster } from "@/lib/match/roster";
import type { CustomGame, CustomSettings, CustomSlot, SlotKind, CustomControls } from "./types";

const DEFAULT_SETUP: CoachSetup = { side: "ATK", approach: "default", tempo: "mid", aggression: "balanced" };

function defaultSettings(over: Partial<CustomSettings>): CustomSettings {
  return { privacy: "private", password: null, observerSlots: 2, coachSlots: 2, refereeSlots: 1, seed: 1, firstTo: 13, economy: "normal", sideSwapAllowed: true, mode: "custom", region: "EMEA", ...over };
}

export class CustomGameEngine {
  private games = new Map<string, CustomGame>();
  private userGame = new Map<string, string>();
  private counter = 0;
  private seedBase: number;
  constructor(seedBase = 1) { this.seedBase = seedBase; }

  get(id: string): CustomGame | undefined { return this.games.get(id); }
  gameOf(userId: string): CustomGame | null { const id = this.userGame.get(userId); return id ? this.games.get(id) ?? null : null; }
  size(): number { return this.games.size; }

  create(host: { id: string; name: string }, settings: Partial<CustomSettings>, now: number): CustomGame {
    if (this.userGame.has(host.id)) this.leave(host.id);
    const s = defaultSettings(settings);
    const slots: CustomSlot[] = [];
    let i = 0;
    slots.push({ index: i++, kind: "player", side: "home", userId: host.id, name: host.name, ready: false, bot: false });
    slots.push({ index: i++, kind: "player", side: "away", userId: null, name: null, ready: false, bot: false });
    for (let k = 0; k < s.coachSlots; k++) slots.push({ index: i++, kind: "coach", side: k % 2 ? "away" : "home", userId: null, name: null, ready: false, bot: false });
    for (let k = 0; k < s.observerSlots; k++) slots.push({ index: i++, kind: "observer", side: null, userId: null, name: null, ready: false, bot: false });
    for (let k = 0; k < s.refereeSlots; k++) slots.push({ index: i++, kind: "referee", side: null, userId: null, name: null, ready: false, bot: false });
    const game: CustomGame = { id: `custom-${this.seedBase}-${this.counter++}`, hostId: host.id, settings: s, slots, state: "config", controls: { paused: false, roundRestarts: 0, matchRestarts: 0 }, createdAt: now };
    this.games.set(game.id, game); this.userGame.set(host.id, game.id);
    return game;
  }

  join(gameId: string, user: { id: string; name: string }, kind: SlotKind, password: string | null): { ok: boolean; error?: string; slot?: number } {
    const g = this.games.get(gameId); if (!g) return { ok: false, error: "no-game" };
    if (g.state !== "config") return { ok: false, error: "in-progress" };
    if (g.settings.privacy === "password" && g.settings.password !== password) return { ok: false, error: "bad-password" };
    if (this.userGame.get(user.id) === gameId) return { ok: true };
    if (this.userGame.has(user.id)) return { ok: false, error: "already-in-game" };
    const slot = g.slots.find((s) => s.kind === kind && !s.userId && !s.bot);
    if (!slot) return { ok: false, error: "no-slot" };
    slot.userId = user.id; slot.name = user.name; slot.ready = false; slot.bot = false;
    this.userGame.set(user.id, gameId);
    return { ok: true, slot: slot.index };
  }

  leave(userId: string): void {
    const id = this.userGame.get(userId); if (!id) return;
    const g = this.games.get(id)!;
    for (const s of g.slots) if (s.userId === userId) { s.userId = null; s.name = null; s.ready = false; }
    this.userGame.delete(userId);
    if (g.slots.every((s) => !s.userId && !s.bot)) { this.games.delete(id); return; }
    if (g.hostId === userId) { const next = g.slots.find((s) => s.userId); if (next) g.hostId = next.userId!; }
  }

  /** Cambio de equipo/rol (host). */
  setSlot(gameId: string, byHost: string, userId: string, kind: SlotKind, side: "home" | "away" | null): { ok: boolean; error?: string } {
    const g = this.games.get(gameId); if (!g) return { ok: false, error: "no-game" };
    if (g.hostId !== byHost) return { ok: false, error: "not-host" };
    const cur = g.slots.find((s) => s.userId === userId); if (!cur) return { ok: false, error: "not-member" };
    const target = g.slots.find((s) => s.kind === kind && (side == null || s.side === side) && !s.userId && !s.bot); if (!target) return { ok: false, error: "no-slot" };
    target.userId = userId; target.name = cur.name; target.ready = false;
    cur.userId = null; cur.name = null; cur.ready = false;
    return { ok: true };
  }

  /** Intercambio de lados (host). */
  sideSwap(gameId: string, byHost: string): { ok: boolean; error?: string } {
    const g = this.games.get(gameId); if (!g) return { ok: false, error: "no-game" };
    if (g.hostId !== byHost) return { ok: false, error: "not-host" };
    if (!g.settings.sideSwapAllowed) return { ok: false, error: "not-allowed" };
    const home = g.slots.find((s) => s.kind === "player" && s.side === "home")!;
    const away = g.slots.find((s) => s.kind === "player" && s.side === "away")!;
    [home.userId, away.userId] = [away.userId, home.userId];
    [home.name, away.name] = [away.name, home.name];
    [home.bot, away.bot] = [away.bot, home.bot];
    return { ok: true };
  }

  ready(gameId: string, userId: string, ready: boolean): void { const s = this.games.get(gameId)?.slots.find((x) => x.userId === userId); if (s) s.ready = ready; }
  /** Ready check: los slots de JUGADOR ocupados están listos. */
  readyCheck(gameId: string): boolean { const g = this.games.get(gameId); if (!g) return false; const players = g.slots.filter((s) => s.kind === "player" && s.userId); return players.length > 0 && players.every((s) => s.ready); }

  kick(gameId: string, by: string, target: string): { ok: boolean; error?: string } {
    const g = this.games.get(gameId); if (!g) return { ok: false, error: "no-game" };
    const authorized = by === g.hostId || g.slots.some((s) => s.kind === "referee" && s.userId === by); // host o árbitro
    if (!authorized) return { ok: false, error: "not-authorized" };
    const s = g.slots.find((x) => x.userId === target); if (!s) return { ok: false, error: "not-member" };
    s.userId = null; s.name = null; s.ready = false; this.userGame.delete(target);
    return { ok: true };
  }

  /** Sustituye a un jugador por un bot (host). */
  replaceWithBot(gameId: string, byHost: string, target: string): { ok: boolean; error?: string } {
    const g = this.games.get(gameId); if (!g) return { ok: false, error: "no-game" };
    if (g.hostId !== byHost) return { ok: false, error: "not-host" };
    const s = g.slots.find((x) => x.userId === target); if (!s) return { ok: false, error: "not-member" };
    this.userGame.delete(target);
    s.userId = `bot-${gameId}-${s.index}`; s.name = `Bot ${s.index}`; s.ready = true; s.bot = true;
    return { ok: true };
  }

  setSettings(gameId: string, byHost: string, patch: Partial<CustomSettings>): { ok: boolean; error?: string } {
    const g = this.games.get(gameId); if (!g) return { ok: false, error: "no-game" };
    if (g.hostId !== byHost) return { ok: false, error: "not-host" };
    g.settings = { ...g.settings, ...patch };
    return { ok: true };
  }

  // ── Controles en partida (host/árbitro autorizado) ──
  private canControl(g: CustomGame, by: string): boolean { return by === g.hostId || g.slots.some((s) => s.kind === "referee" && s.userId === by); }
  pauseMatch(gameId: string, by: string): { ok: boolean; error?: string } { const g = this.games.get(gameId); if (!g) return { ok: false, error: "no-game" }; if (!this.canControl(g, by)) return { ok: false, error: "not-authorized" }; g.controls.paused = true; return { ok: true }; }
  resumeMatch(gameId: string, by: string): { ok: boolean; error?: string } { const g = this.games.get(gameId); if (!g) return { ok: false, error: "no-game" }; if (!this.canControl(g, by)) return { ok: false, error: "not-authorized" }; g.controls.paused = false; return { ok: true }; }
  restartRound(gameId: string, by: string): { ok: boolean; error?: string } { const g = this.games.get(gameId); if (!g) return { ok: false, error: "no-game" }; if (!this.canControl(g, by)) return { ok: false, error: "not-authorized" }; g.controls.roundRestarts++; return { ok: true }; }
  restartMatch(gameId: string, by: string): { ok: boolean; error?: string; config?: MatchConfig } { const g = this.games.get(gameId); if (!g) return { ok: false, error: "no-game" }; if (!this.canControl(g, by)) return { ok: false, error: "not-authorized" }; g.controls.matchRestarts++; g.state = "ready_check"; return { ok: true, config: this.toMatchConfig(gameId) ?? undefined }; }
  setState(gameId: string, state: CustomGame["state"]): void { const g = this.games.get(gameId); if (g) g.state = state; }

  /** Produce la `MatchConfig` del Online Core desde los ajustes de la sala. Determinista. */
  toMatchConfig(gameId: string): MatchConfig | null {
    const g = this.games.get(gameId); if (!g) return null;
    const home = g.slots.find((s) => s.kind === "player" && s.side === "home");
    const away = g.slots.find((s) => s.kind === "player" && s.side === "away");
    const homeRoster = buildRivalRoster(g.settings.seed ^ 0x101, new Set(), "normal");
    const awayRoster = buildRivalRoster(g.settings.seed ^ 0x202, new Set(), "normal");
    const humanHome = !!home?.userId && !home.bot;
    return makeMatchConfig({
      seed: g.settings.seed,
      rosters: { home: homeRoster, away: awayRoster },
      homeSetup: DEFAULT_SETUP,
      win: { firstTo: g.settings.firstTo },
      economy: g.settings.economy === "normal" ? undefined : null,   // infinite/off ⇒ sin economía = buy infinito
      teamNames: { home: home?.name ?? "Home", away: away?.name ?? "Away" },
      coach: { mode: humanHome ? "manual" : "ai" },
    });
  }
}
