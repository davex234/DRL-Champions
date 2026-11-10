/**
 * COMBAT INTEGRATION × BROADCAST — DATOS de combate por ronda, listos para que una futura UI los
 * muestre (no construye UI). Reúne vida/escudo, daño hecho/recibido/absorbido, headshots, trades,
 * asistencias, ADR, accuracy y primer disparo desde las estadísticas (cstat) y el log de bajas.
 * PURO; solo lectura del RoundState terminado.
 */
import type { RoundState, SimPlayer, Side } from "../sim";
import { accuracy, hsPct, type CombatStats } from "./stats";

export interface CombatBroadcastLine {
  id: string;
  name: string;
  side: Side;
  hp: number;
  shield: number;
  alive: boolean;
  kills: number;
  deaths: number;
  assists: number;
  damageDealt: number;
  damageTaken: number;
  damageAbsorbed: number;
  headshots: number;
  bodyshots: number;
  legshots: number;
  /** % headshots sobre impactos (0..1). */
  hsPct: number;
  /** Precisión: impactos/disparos (0..1). */
  accuracy: number;
  /** ADR de la ronda (= daño hecho en la ronda). */
  adr: number;
  overkill: number;
  timeAliveSec: number;
}

export interface CombatBroadcast {
  round: number;
  lines: CombatBroadcastLine[];
  totals: {
    kills: number; headshots: number; wallbangs: number; trades: number;
    damage: number; firstBloodBy: string | null;
  };
}

const empty: CombatStats = {
  damageDealt: 0, damageTaken: 0, damageAbsorbed: 0, shotsFired: 0, shotsHit: 0,
  headshots: 0, bodyshots: 0, legshots: 0, kills: 0, assists: 0, overkill: 0, ticksAlive: 0,
};

const TPS = 20;

/** Construye los datos de combate de una ronda terminada. */
export function buildCombatBroadcast(round: RoundState, roundNumber = 1): CombatBroadcast {
  const deaths: Record<string, number> = {};
  let trades = 0, wallbangs = 0, headshots = 0, firstBloodBy: string | null = null;
  for (const e of round.events) {
    if (e.type === "firstblood") firstBloodBy = String((e.data as { by?: string }).by ?? "") || null;
    if (e.type !== "kill") continue;
    const d = e.data as { victimName?: string; traded?: boolean; wallbang?: boolean; headshot?: boolean };
    if (d.victimName) deaths[d.victimName] = (deaths[d.victimName] ?? 0) + 1;
    if (d.traded) trades++;
    if (d.wallbang) wallbangs++;
    if (d.headshot) headshots++;
  }

  const lines: CombatBroadcastLine[] = round.players.map((p: SimPlayer) => {
    const c = p.cstat ?? empty;
    return {
      id: p.id, name: p.name, side: p.side, hp: p.hp, shield: p.shield ?? 0, alive: p.alive,
      kills: c.kills, deaths: deaths[p.name] ?? (p.alive ? 0 : 1), assists: c.assists,
      damageDealt: c.damageDealt, damageTaken: c.damageTaken, damageAbsorbed: c.damageAbsorbed,
      headshots: c.headshots, bodyshots: c.bodyshots, legshots: c.legshots,
      hsPct: Math.round(hsPct(c) * 100) / 100, accuracy: Math.round(accuracy(c) * 100) / 100,
      adr: c.damageDealt, overkill: c.overkill, timeAliveSec: Math.round((c.ticksAlive / TPS) * 10) / 10,
    };
  });

  return {
    round: roundNumber,
    lines,
    totals: {
      kills: round.events.filter((e) => e.type === "kill").length,
      headshots, wallbangs, trades,
      damage: lines.reduce((s, l) => s + l.damageDealt, 0),
      firstBloodBy,
    },
  };
}
