/**
 * AGENT ABILITY ENGINE × NARRATIVE — significado de HABILIDAD (sin frases). Lee las rondas
 * terminadas (casts de utilidad con datos de ability + resultado) y detecta momentos. Complementa
 * la narrativa; NO modifica el Narrative Engine. PURO.
 */
import type { RoundState, Side } from "../sim";

export type AbilityEventType =
  | "perfect_execute" | "perfect_utility" | "fake_utility" | "smart_recon" | "huge_entry"
  | "double_flash" | "site_lockdown" | "perfect_retake" | "ultimate_value" | "utility_diff"
  | "clutch_utility" | "late_utility" | "information_win";

export interface AbilityEvent {
  type: AbilityEventType;
  round: number;
  team: "home" | "away";
  magnitude: number;
  detail?: string;
}

interface Cast { tick: number; by: string; side: Side; ability: string; effect: string; }

const TPS = 20;

export function detectAbilityEvents(rounds: RoundState[]): AbilityEvent[] {
  const out: AbilityEvent[] = [];
  rounds.forEach((round, idx) => {
    const n = idx + 1;
    const homeSide = round.coachSide;
    const teamOf = (side: Side): "home" | "away" => (side === homeSide ? "home" : "away");
    const push = (type: AbilityEventType, side: Side, magnitude: number, detail?: string) =>
      out.push({ type, round: n, team: teamOf(side), magnitude: Math.min(100, Math.max(1, Math.round(magnitude))), detail });

    const casts: Cast[] = round.events.filter((e) => e.type === "util" && (e.data as { ability?: string }).ability)
      .map((e) => ({ tick: e.tick, by: String(e.data.by), side: e.data.side as Side, ability: String((e.data as { ability?: string }).ability), effect: String((e.data as { abilityEffect?: string }).abilityEffect ?? "") }));
    const kills = round.events.filter((e) => e.type === "kill").map((e) => ({ tick: e.tick, by: String(e.data.by), side: e.data.bySide as Side }));
    const fb = round.events.find((e) => e.type === "firstblood");
    const winner = round.winner;
    const bySide = (side: Side) => casts.filter((c) => c.side === side);

    // Utility diff (un equipo gasta MUCHA más utilidad).
    const a = bySide("ATK").length, d = bySide("DEF").length;
    if (Math.abs(a - d) >= 3) push("utility_diff", a > d ? "ATK" : "DEF", 40 + Math.abs(a - d) * 8);

    // Double flash: 2 flashes (blind) del mismo equipo en ventana corta.
    for (const side of ["ATK", "DEF"] as Side[]) {
      const flashes = bySide(side).filter((c) => c.effect === "blind" || c.effect === "entry" || c.effect === "decoy").sort((x, y) => x.tick - y.tick);
      for (let i = 1; i < flashes.length; i++) if (flashes[i].tick - flashes[i - 1].tick <= 20) { push("double_flash", side, 60); break; }
    }

    // Smart recon / information win: un reveal seguido de una baja de su equipo (info → kill).
    for (const c of casts.filter((c) => c.effect === "reveal")) {
      const k = kills.find((k) => k.side === c.side && k.tick >= c.tick && k.tick - c.tick <= 3 * TPS);
      if (k) { push("smart_recon", c.side, 55); if (winner && teamOf(winner) === teamOf(c.side)) push("information_win", c.side, 50); break; }
    }

    // Huge entry: flash/entry seguido de FIRST BLOOD del mismo equipo.
    if (fb) {
      const fbSide = fb.data.side as Side;
      const entryUtil = casts.find((c) => c.side === fbSide && (c.effect === "blind" || c.effect === "entry") && Math.abs(c.tick - fb.tick) <= 2 * TPS);
      if (entryUtil) push("huge_entry", fbSide, 70);
    }

    // Perfect execute: ATK ganó tras EXECUTE con ≥2 utils antes del primer duelo.
    if (winner === "ATK" && round.executeTick != null) {
      const preExec = bySide("ATK").filter((c) => c.tick <= round.executeTick! + TPS).length;
      if (preExec >= 2) push("perfect_execute", "ATK", 65, `${preExec} utils en el execute`);
    }

    // Site lockdown / perfect retake (defensa).
    if (round.spike.planted) {
      if (round.endReason === "defuse" && winner === "DEF") {
        const retakeUtil = bySide("DEF").filter((c) => round.spike.plantedTick != null && c.tick >= round.spike.plantedTick).length;
        if (retakeUtil >= 1) push("perfect_retake", "DEF", 70, `${retakeUtil} utils en el retake`);
      }
    } else if (winner === "DEF") {
      const denies = bySide("DEF").filter((c) => c.effect === "delay" || c.effect === "deny_vision" || c.effect === "suppress").length;
      if (denies >= 2) push("site_lockdown", "DEF", 60);
    }

    // Late utility: cast en post-plant tardío.
    if (round.spike.plantedTick != null) {
      const late = casts.find((c) => c.tick > round.spike.plantedTick! + 25 * TPS);
      if (late) push("late_utility", late.side, 35);
    }

    // Clutch utility: utilidad usada por el último vivo de su equipo que GANÓ.
    if (winner) {
      const aliveW = round.players.filter((p) => p.side === winner && p.alive);
      if (aliveW.length === 1 && casts.some((c) => c.by === aliveW[0].id)) push("clutch_utility", winner, 75);
    }

    // Perfect / ultimate utility: equipo que gastó casi todo y ganó.
    if (winner) {
      const charges = round.map?.charges[winner] ?? 0;
      const spent = round.map?.spent[winner] ?? bySide(winner).length;
      if (charges > 0 && spent / charges >= 0.8) push("perfect_utility", winner, 55);
      const maxVal = Math.max(0, ...round.events.filter((e) => e.type === "util" && e.data.side === winner).map((e) => Number((e.data as { value?: number }).value ?? 0)));
      if (maxVal >= 0.85) push("ultimate_value", winner, 60);
    }
  });
  return out;
}
