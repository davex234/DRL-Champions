/**
 * COMBAT INTEGRATION × NARRATIVE — significado de combate (sin frases). Lee las rondas terminadas
 * y detecta momentos a partir de los metadatos REALES de cada baja (Combat 3.0: headshot, oneShot,
 * wallbang, trade, overkill, hp final…). Complementa la narrativa; NO modifica el Narrative Engine.
 */
import type { RoundState, Side } from "../sim";

export type CombatEventType =
  | "equipment_kill" | "heroic_duel"
  | "wallbang" | "one_tap" | "spray_transfer" | "entry_kill" | "trade" | "revenge_kill"
  | "collateral" | "low_hp_clutch" | "survived_1hp" | "perfect_crossfire" | "double_swing"
  | "timing_kill" | "exit_frag" | "hero_save";

export interface CombatEvent {
  type: CombatEventType;
  round: number;
  team: "home" | "away";
  magnitude: number;
  name?: string;
}

const GAP = 22;       // diferencia de firepower que marca superioridad/inferioridad
const SPRAY_WINDOW = 24; // ticks (~1.2 s) para encadenar bajas
const TPS = 20;

interface KillData {
  by?: string; byName?: string; bySide?: Side; victim?: string; victimName?: string;
  fpBy?: number | null; fpVic?: number | null; held?: boolean; traded?: boolean;
  headshot?: boolean; oneShot?: boolean; wallbang?: boolean; overkill?: number; damage?: number; weapon?: string | null;
}

/** Detecta eventos de combate sobre las rondas terminadas (en orden). */
export function detectCombatEvents(rounds: RoundState[], homeNames: Set<string>): CombatEvent[] {
  const events: CombatEvent[] = [];
  rounds.forEach((round, idx) => {
    const n = idx + 1;
    const teamOf = (name?: string): "home" | "away" => (homeNames.has(name ?? "") ? "home" : "away");
    const push = (type: CombatEventType, team: "home" | "away", magnitude: number, name?: string) =>
      events.push({ type, round: n, team, magnitude: Math.min(100, Math.max(1, Math.round(magnitude))), name });

    const kills = round.events.filter((e) => e.type === "kill").map((e) => ({ tick: e.tick, d: e.data as KillData }));
    const byKiller: Record<string, number[]> = {}; // ticks de cada asesino

    kills.forEach((k, i) => {
      const d = k.d;
      const team = teamOf(d.byName);
      const gap = (d.fpBy ?? 0) - (d.fpVic ?? 0);
      if (d.fpBy != null && d.fpVic != null) {
        if (gap > GAP) push("equipment_kill", team, gap, d.byName);
        else if (gap < -GAP) push("heroic_duel", team, -gap, d.byName);
      }
      if (d.headshot && d.oneShot) push("one_tap", team, 80, d.byName);
      if (d.wallbang) push("wallbang", team, 70, d.byName);
      if (d.traded) push("trade", team, 50, d.byName);
      if (i === 0 && d.bySide === "ATK") push("entry_kill", team, 60, d.byName);

      // Bajas encadenadas del mismo asesino (spray transfer / doble swing / collateral).
      (byKiller[d.byName ?? ""] ??= []).push(k.tick);
      const prev = byKiller[d.byName ?? ""];
      if (prev.length >= 2) {
        const gapTicks = k.tick - prev[prev.length - 2];
        if (gapTicks === 0) push("collateral", team, 75, d.byName);
        else if (gapTicks <= SPRAY_WINDOW) {
          push(d.held ? "spray_transfer" : "double_swing", team, 65, d.byName);
        }
      }

      // Revenge: la víctima había matado antes (fuera de la ventana de trade).
      const vEarlier = kills.find((x, j) => j < i && x.d.by === d.victim);
      if (vEarlier && k.tick - vEarlier.tick > SPRAY_WINDOW * 2 && !d.traded) push("revenge_kill", team, 55, d.byName);

      // Timing kill: baja justo al comprometer el execute.
      if (round.executeTick != null && Math.abs(k.tick - round.executeTick) <= 6) push("timing_kill", team, 50, d.byName);

      // Exit frag: baja en postplant tras detonar (ronda ya decidida).
      if (round.endReason === "detonation" && round.spike.plantedTick != null && k.tick > round.spike.plantedTick + 30 * TPS) {
        push("exit_frag", team, 40, d.byName);
      }
    });

    // Crossfire perfecto: dos bajas de un mismo equipo casi simultáneas sobre rivales distintos.
    for (let i = 1; i < kills.length; i++) {
      const a = kills[i - 1], b = kills[i];
      if (teamOf(a.d.byName) === teamOf(b.d.byName) && a.d.byName !== b.d.byName
        && a.d.victim !== b.d.victim && Math.abs(b.tick - a.tick) <= 3) {
        push("perfect_crossfire", teamOf(b.d.byName), 60, b.d.byName);
        break;
      }
    }

    // Estado final de los jugadores: clutch a baja vida, supervivencia a 1 HP, hero save.
    const winnerSide = round.winner;
    for (const p of round.players) {
      if (p.alive && p.hp <= 1) push("survived_1hp", teamOf(p.name), 90, p.name);
      else if (p.alive && p.side === winnerSide && p.hp <= 30 && (p.cstat?.kills ?? 0) >= 1) {
        const mates = round.players.filter((q) => q.side === p.side && q.alive).length;
        if (mates === 1) push("low_hp_clutch", teamOf(p.name), 85, p.name);
      }
      // Hero save: sobrevive con arma cara en una ronda PERDIDA (salva el equipamiento).
      if (p.alive && p.side !== winnerSide && (p.loadout?.firepower ?? 0) >= 70) push("hero_save", teamOf(p.name), 35, p.name);
    }
  });
  return events;
}
