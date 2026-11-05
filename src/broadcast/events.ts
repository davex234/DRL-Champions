/**
 * DRL BROADCAST — kill feed y banderas de eventos (PURO).
 * Deriva el feed de bajas y las situaciones destacables (first blood, clutch,
 * ace, trade, plant, defuse) del event log + estado. Solo lee.
 */
import type { RoundState, Side } from "../sim";
import type { BroadcastFlags, KillFeedItem } from "./types";

const TRADE_WINDOW = 40; // ticks (~2 s)
const KILL_FEED_MAX = 6;

interface KillData {
  by: string; byName: string; bySide: Side; victim: string; victimName: string; held: boolean;
}

const killEvents = (s: RoundState) =>
  s.events.filter((e) => e.type === "kill").map((e) => ({ tick: e.tick, d: e.data as unknown as KillData }));

/** Feed de bajas (las más recientes). Calcula `trade` por baja. */
export function buildKillFeed(s: RoundState): KillFeedItem[] {
  const kills = killEvents(s);
  const items: KillFeedItem[] = kills.map((k, i) => {
    const traded = kills.some((j, jx) => jx < i && k.tick - j.tick <= TRADE_WINDOW && j.d.bySide !== k.d.bySide);
    return {
      killer: k.d.byName,
      victim: k.d.victimName,
      killerSide: k.d.bySide,
      victimSide: k.d.bySide === "ATK" ? "DEF" : "ATK",
      tick: k.tick,
      angle: Boolean(k.d.held),
      trade: traded,
    };
  });
  return items.slice(-KILL_FEED_MAX);
}

/** Jugador con más bajas de la ronda (MVP provisional del round). */
export function topFragger(s: RoundState): { name: string; kills: number; side: Side } | null {
  const by: Record<string, { n: number; name: string; side: Side }> = {};
  for (const k of killEvents(s)) {
    const e = (by[k.d.by] ||= { n: 0, name: k.d.byName, side: k.d.bySide });
    e.n++;
  }
  let best: { n: number; name: string; side: Side } | null = null;
  for (const id in by) if (!best || by[id].n > best.n) best = by[id];
  return best && best.n > 0 ? { name: best.name, kills: best.n, side: best.side } : null;
}

/** Banderas de situaciones destacables. */
export function detectFlags(s: RoundState): BroadcastFlags {
  const atkAlive = s.players.filter((p) => p.side === "ATK" && p.alive).length;
  const defAlive = s.players.filter((p) => p.side === "DEF" && p.alive).length;
  const live = s.phase !== "ENDED";

  const clutchSide: Side | null =
    live && atkAlive === 1 && defAlive >= 2 ? "ATK"
    : live && defAlive === 1 && atkAlive >= 2 ? "DEF" : null;

  // Ace: un jugador con 5+ bajas (arrasó al equipo rival de 5).
  const byKiller: Record<string, { n: number; name: string }> = {};
  for (const k of killEvents(s)) {
    const e = (byKiller[k.d.by] ||= { n: 0, name: k.d.byName });
    e.n++;
  }
  let aceBy: string | null = null;
  for (const id in byKiller) if (byKiller[id].n >= 5) aceBy = byKiller[id].name;

  // Trade reciente.
  const kills = killEvents(s);
  const lastTick = s.tick;
  const trade = kills.some((k, i) =>
    kills.some((j, jx) => jx < i && k.tick - j.tick <= TRADE_WINDOW && j.d.bySide !== k.d.bySide) &&
    lastTick - k.tick <= TRADE_WINDOW);

  return {
    firstBlood: s.events.some((e) => e.type === "firstblood"),
    clutch: clutchSide != null,
    clutchSide,
    ace: aceBy != null,
    aceBy,
    trade,
    plant: s.spike.planted,
    defuse: s.spike.defuseProgress > 0,
    timeout: false,
    tacticalPause: false,
  };
}
