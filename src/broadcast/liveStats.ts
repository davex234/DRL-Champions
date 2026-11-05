/**
 * ESTADÍSTICAS EN VIVO — el scoreboard pro por jugador. Reutiliza `cstat` (Combat 3.0) y
 * el log de eventos para agregar ADR/ACS/KAST/HS%/trades/entry%/clutch%/utilidad/impacto a
 * lo largo del partido. Lo que el sim no guarda (ACS/KAST/entry/clutch) se DERIVA de datos
 * existentes; nada se inventa. Extiende el Broadcast. PURO.
 */
import type { RoundState, Side } from "../sim";
import type { MatchState } from "../match";

export interface LiveStatLine {
  id: string; name: string; side: Side;
  kills: number; deaths: number; assists: number;
  adr: number; acs: number; kast: number; hsPct: number;
  trades: number; firstBloods: number; firstDeaths: number;
  entryPct: number; clutchPct: number; utilUsed: number; impact: number;
}

interface Acc {
  name: string; side: Side; kills: number; deaths: number; assists: number;
  damage: number; shotsHit: number; headshots: number; rounds: number;
  kast: number; trades: number; fb: number; fd: number; util: number;
  clutchSit: number; clutchWin: number;
}

/** Estadísticas agregadas por jugador del partido (rondas terminadas + ronda en curso). */
export function liveStats(match: MatchState, current?: RoundState | null): LiveStatLine[] {
  const rounds: RoundState[] = [...match.rounds];
  if (current && current.phase !== "ENDED") rounds.push(current);
  if (rounds.length === 0 && match.currentRound) rounds.push(match.currentRound);

  const acc: Record<string, Acc> = {};
  const ensure = (name: string, side: Side): Acc =>
    (acc[name] ??= { name, side, kills: 0, deaths: 0, assists: 0, damage: 0, shotsHit: 0, headshots: 0, rounds: 0, kast: 0, trades: 0, fb: 0, fd: 0, util: 0, clutchSit: 0, clutchWin: 0 });

  for (const r of rounds) {
    const idToName: Record<string, string> = {};
    for (const p of r.players) idToName[p.id] = p.name;
    const aliveEnd: Record<string, boolean> = {};
    const sideAlive: Record<Side, number> = { ATK: 0, DEF: 0 };
    for (const p of r.players) { aliveEnd[p.name] = p.alive; if (p.alive) sideAlive[p.side]++; }

    const tradedDeath: Record<string, boolean> = {};
    for (const e of r.events) {
      if (e.type === "kill") {
        const d = e.data as { byName?: string; victimName?: string; traded?: boolean };
        if (d.victimName && d.traded) tradedDeath[d.victimName] = true;
      }
    }

    for (const p of r.players) {
      const a = ensure(p.name, p.side);
      a.rounds++;
      const c = p.cstat;
      if (c) { a.kills += c.kills; a.assists += c.assists; a.damage += c.damageDealt; a.shotsHit += c.shotsHit; a.headshots += c.headshots; }
      if (!p.alive) a.deaths++;
      // KAST: baja, asistencia, sobrevivió o fue tradeado.
      if ((c?.kills ?? 0) > 0 || (c?.assists ?? 0) > 0 || p.alive || tradedDeath[p.name]) a.kast++;
      // Clutch (estado final): su lado quedó a 1 vivo y es él.
      if (p.alive && sideAlive[p.side] === 1) { a.clutchSit++; if (r.winner === p.side) a.clutchWin++; }
    }

    for (const e of r.events) {
      if (e.type === "kill") {
        const d = e.data as { byName?: string; traded?: boolean };
        if (d.byName && d.traded && acc[d.byName]) acc[d.byName].trades++;
      } else if (e.type === "firstblood") {
        const d = e.data as { by?: string; victim?: string };
        const byN = d.by ? idToName[d.by] : undefined;
        const viN = d.victim ? idToName[d.victim] : undefined;
        if (byN && acc[byN]) acc[byN].fb++;
        if (viN && acc[viN]) acc[viN].fd++;
      } else if (e.type === "util") {
        const by = (e.data as { by?: string }).by;
        const n = by ? idToName[by] : undefined;
        if (n && acc[n]) acc[n].util++;
      }
    }
  }

  return Object.values(acc).map((a): LiveStatLine => {
    const rounds = Math.max(1, a.rounds);
    const adr = Math.round(a.damage / rounds);
    const acs = Math.round((a.damage + a.kills * 55 + a.assists * 20) / rounds);
    const kast = Math.round((a.kast / rounds) * 100);
    const hsPct = a.shotsHit > 0 ? Math.round((a.headshots / a.shotsHit) * 100) : 0;
    const entries = a.fb + a.fd;
    const entryPct = entries > 0 ? Math.round((a.fb / entries) * 100) : 0;
    const clutchPct = a.clutchSit > 0 ? Math.round((a.clutchWin / a.clutchSit) * 100) : 0;
    const impact = Math.max(0, Math.min(100, Math.round(
      30 + ((a.kills * 1.0 + a.fb * 0.6 + a.clutchWin * 1.2 + a.trades * 0.5 + a.assists * 0.3 - a.fd * 0.4) / rounds) * 40,
    )));
    return {
      id: a.name, name: a.name, side: a.side,
      kills: a.kills, deaths: a.deaths, assists: a.assists,
      adr, acs, kast, hsPct, trades: a.trades, firstBloods: a.fb, firstDeaths: a.fd,
      entryPct, clutchPct, utilUsed: a.util, impact,
    };
  }).sort((x, y) => y.acs - x.acs);
}

/** Espacio/control del mapa por lado (de la ronda en curso). Per-side (lo que el sim guarda). */
export function spaceControl(snap: RoundState): { atk: number; def: number } {
  if (!snap.map) return { atk: 0, def: 0 };
  return { atk: snap.map.control.ATK, def: snap.map.control.DEF };
}
