/**
 * Análisis post-ronda: convierte el event log + estado final en causas LEGIBLES
 * ("perdiste porque…"). Heurísticas, no marcador. Objetivo: que el coach APRENDA.
 */
import type { RoundState, Side, SimEvent } from "./types";

export type Tone = "good" | "bad" | "info";
export interface Cause {
  text: string;
  tone: Tone;
}
export interface RoundAnalysis {
  won: boolean;
  headline: string;
  causes: Cause[];
}

const tempoBase = (t: string): number => (t === "fast" ? 45 : t === "slow" ? 130 : 85);
const find = (s: RoundState, id: unknown) => s.players.find((p) => p.id === id);
const evs = (s: RoundState, type: SimEvent["type"]) => s.events.filter((e) => e.type === type);

export function analyze(s: RoundState): RoundAnalysis {
  const coach = s.coachSide;
  const won = s.winner === coach;
  const kills = evs(s, "kill");
  const coachKills = kills.filter((e) => e.data.bySide === coach).length;
  const enemyKills = kills.filter((e) => e.data.bySide !== coach).length;
  const fb = evs(s, "firstblood")[0];
  const exec = evs(s, "execute")[0];
  const plant = evs(s, "plant")[0];
  const util = evs(s, "util").find((e) => e.data.kind === "flash");

  const causes: Cause[] = [];

  // 1. First blood (apertura).
  if (fb) {
    if (fb.data.side === coach) {
      causes.push({ text: "Tu equipo se llevó el first blood y abrió la ronda con ventaja.", tone: "good" });
    } else {
      const victim = find(s, fb.data.victim);
      const killEv = kills.find((e) => e.tick === fb.tick && e.data.victim === fb.data.victim);
      const aims = killEv ? ` (Aim ${killEv.data.aimVic} vs ${killEv.data.aimBy})` : "";
      const who = victim?.role === "entry" ? "Tu entry" : `Tu ${victim?.name ?? "jugador"}`;
      causes.push({ text: `${who} perdió el primer duelo${aims}: empezaste en desventaja numérica.`, tone: "bad" });
    }
  }

  // 2. Timing del execute (si entrenas al ATAQUE).
  if (coach === "ATK") {
    if (exec) {
      const expected = tempoBase(s.plans.ATK.tempo);
      const late = !exec.data.forced && exec.tick > expected + 30;
      if (late) {
        causes.push({ text: "El execute fue lento: tu IGL tardó en comprometer (liderazgo bajo).", tone: "bad" });
      } else if (exec.data.forced) {
        causes.push({ text: "Forzaste el execute en el momento justo con tu Voz.", tone: "good" });
      } else {
        causes.push({ text: "El equipo ejecutó con buen timing.", tone: "good" });
      }
    } else {
      causes.push({ text: "Nunca llegaste a ejecutar: te quedaste en la fase de setup.", tone: "bad" });
    }
  }

  // 3. Superioridad numérica antes del plant.
  const beforePlant = plant ? kills.filter((e) => e.tick < plant.tick) : kills;
  const bpCoach = beforePlant.filter((e) => e.data.bySide === coach).length;
  const bpEnemy = beforePlant.filter((e) => e.data.bySide !== coach).length;
  if (bpEnemy - bpCoach >= 2) {
    causes.push({ text: "El rival consiguió superioridad numérica antes del plant.", tone: "bad" });
  } else if (bpCoach - bpEnemy >= 2) {
    causes.push({ text: "Conseguiste ventaja numérica pronto y controlaste la ronda.", tone: "good" });
  }

  // 4. Duelos en conjunto.
  if (coachKills - enemyKills >= 2) {
    causes.push({ text: `Ganaste los duelos clave (${coachKills}-${enemyKills} en bajas).`, tone: "good" });
  } else if (enemyKills - coachKills >= 2) {
    causes.push({ text: `El rival te ganó los duelos (${enemyKills}-${coachKills} en bajas).`, tone: "bad" });
  }

  // 5. Utilidad de entrada (ataque).
  if (coach === "ATK") {
    if (!util) causes.push({ text: "No aprovechaste la utilidad de entrada para abrir el sitio.", tone: "bad" });
    else if (won) causes.push({ text: "La utilidad de entrada cegó la defensa y abrió el sitio.", tone: "good" });
  }

  // 6. Retake / postplant.
  if (coach === "DEF") {
    if (s.endReason === "defuse") causes.push({ text: "Coordinaste el retake y desactivaste a tiempo.", tone: "good" });
    else if (s.spike.planted && !won) {
      const di = s.players.find((p) => p.side === "DEF" && p.role === "igl");
      const slow = (di?.attrs.leadership ?? 50) < 55 && !s.coachFlags.forceRetake;
      causes.push({
        text: slow ? "El retake llegó tarde: tu IGL reaccionó lento (liderazgo bajo)."
                   : "No pudiste con el postplant del rival.",
        tone: "bad",
      });
    } else if (s.endReason === "timeout") {
      causes.push({ text: "Aguantaste los ángulos y no dejaste plantar.", tone: "good" });
    }
  } else {
    if (s.endReason === "detonation") causes.push({ text: "Plantaste y defendiste el postplant hasta la detonación.", tone: "good" });
    else if (s.endReason === "defuse") causes.push({ text: "Te desactivaron el spike en el postplant.", tone: "bad" });
    else if (s.endReason === "timeout") causes.push({ text: "No entraste al sitio a tiempo: se agotó la ronda.", tone: "bad" });
  }

  // Orden: primero las del tono contrario al resultado (lo más instructivo), luego el resto.
  const ordered = [
    ...causes.filter((c) => (won ? c.tone === "bad" : c.tone === "good")),
    ...causes.filter((c) => (won ? c.tone !== "bad" : c.tone !== "good")),
  ];
  const dedup = ordered.filter((c, i) => ordered.findIndex((x) => x.text === c.text) === i).slice(0, 5);
  if (dedup.length < 2) {
    dedup.push({ text: won ? "Ejecutaste tu plan mejor que el rival." : "El rival ejecutó mejor su plan.", tone: won ? "good" : "bad" });
  }

  return {
    won,
    headline: won ? "RONDA GANADA" : "RONDA PERDIDA",
    causes: dedup,
  };
}
