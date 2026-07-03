/**
 * MOMENTOS ESPECIALES — el entrenador REACCIONA a los puntos de inflexión.
 *
 * Detecta match point, ecos (nuestro/rival), clutch, ACE, giros de momentum, rachas y
 * cambio de lado, y los convierte en DECISIONES (conceptos/órdenes sugeridos). Reutiliza
 * `matchPointTeams` (Match), la economía (Economy) y los eventos de ronda (Sim). PURO.
 */
import type { MatchState } from "@/match";
import { matchPointTeams } from "@/match";
import type { RoundState, Side } from "@/sim";
import type { CoachConcept, CoachCommandId } from "@/coach";

export interface SpecialOption { kind: "concept" | "command"; id: CoachConcept | CoachCommandId; label: string }
export interface SpecialMoment {
  id: string;
  title: string;
  message: string;
  tone: "go" | "danger" | "info" | "calm";
  /** Decisiones que este momento HABILITA (alimentan prep/órdenes). */
  options: SpecialOption[];
}

const winStreak = (match: MatchState): number => {
  let n = 0;
  for (let i = match.history.length - 1; i >= 0; i--) { if (match.history[i].winner === "home") n++; else break; }
  return n;
};

/** Detecta los momentos especiales activos (preparación / fin de ronda). */
export function detectSpecialMoments(match: MatchState, round?: RoundState | null): SpecialMoment[] {
  const out: SpecialMoment[] = [];
  const mp = matchPointTeams(match.score, match.config.win);

  if (mp.includes("home")) out.push({
    id: "match_point", title: "MATCH POINT", tone: "go",
    message: "Una ronda para cerrar el partido. Sin precipitarse.",
    options: [{ kind: "command", id: "motivate", label: "Motivar" }, { kind: "concept", id: "default", label: "Default sólido" }, { kind: "concept", id: "play_picks", label: "Jugar seguro" }],
  });
  if (mp.includes("away")) out.push({
    id: "match_point_against", title: "MATCH POINT RIVAL", tone: "danger",
    message: "Una ronda o se acaba. Hay que arriesgar con cabeza.",
    options: [{ kind: "command", id: "calm", label: "Calmar" }, { kind: "concept", id: "force", label: "Forzar" }, { kind: "concept", id: "fake", label: "Sorprender con fake" }],
  });

  // Economía (eco rival / eco nuestra).
  const eco = match.economy;
  if (eco) {
    const theirs = eco.away.lastDecision;
    const ours = eco.home.lastDecision;
    if (theirs && (theirs.tier === "eco" || theirs.tier === "save")) out.push({
      id: "enemy_eco", title: "ECO RIVAL", tone: "go",
      message: "El rival va de eco: no regales una ronda de armamento.",
      options: [{ kind: "concept", id: "default", label: "Default seguro" }, { kind: "command", id: "patience", label: "Sin regalar duelos" }],
    });
    if (ours && (ours.tier === "eco" || ours.tier === "save")) out.push({
      id: "our_eco", title: "VAMOS DE ECO", tone: "info",
      message: "Ronda de ahorro: agrupados, buscad un pick o salvad.",
      options: [{ kind: "concept", id: "save", label: "Salvar / eco rush" }, { kind: "command", id: "trade", label: "Jugar pegados" }],
    });
  }

  // Momentum y rachas.
  if (match.momentum >= 60) out.push({
    id: "momentum_us", title: "MOMENTUM A FAVOR", tone: "go",
    message: "La inercia es nuestra: aprieta sin relajarte.",
    options: [{ kind: "command", id: "motivate", label: "Mantener la presión" }, { kind: "concept", id: "default", label: "Cerrar limpio" }],
  });
  else if (match.momentum <= -60) out.push({
    id: "momentum_them", title: "MOMENTUM EN CONTRA", tone: "danger",
    message: "Toca cortar la hemorragia: resetea y cambia algo.",
    options: [{ kind: "command", id: "calm", label: "Calmar" }, { kind: "concept", id: "play_picks", label: "Cambiar el ritmo" }],
  });
  const ls = match.economy?.home.lossStreak ?? 0;
  if (ls >= 3) out.push({
    id: "loss_streak", title: `RACHA NEGATIVA (${ls})`, tone: "danger",
    message: "Varias rondas seguidas perdidas: replantea el enfoque.",
    options: [{ kind: "command", id: "calm", label: "Calmar al equipo" }, { kind: "concept", id: "save", label: "Reconstruir economía" }],
  });
  const ws = winStreak(match);
  if (ws >= 3) out.push({
    id: "win_streak", title: `RACHA POSITIVA (${ws})`, tone: "go",
    message: "El equipo está enchufado: capitaliza la confianza.",
    options: [{ kind: "command", id: "motivate", label: "Subir la moral" }],
  });

  // Cambio de lado (al preparar la primera ronda de la 2ª mitad).
  if (match.roundNumber === match.config.switchAfter + 1) out.push({
    id: "side_switch", title: "CAMBIO DE LADO", tone: "info",
    message: "Nueva mitad: replantea estrategia, compra y lectura del rival.",
    options: [{ kind: "concept", id: "default", label: "Reset al default" }],
  });

  // ACE en la última ronda jugada (celebración + confianza).
  const last = round ?? match.rounds[match.rounds.length - 1];
  if (last) {
    const us: Side = last.coachSide;
    const byName: Record<string, number> = {};
    for (const e of last.events) if (e.type === "kill" && (e.data as { bySide?: Side }).bySide === us) {
      const n = String((e.data as { byName?: string }).byName ?? ""); if (n) byName[n] = (byName[n] ?? 0) + 1;
    }
    const acer = Object.entries(byName).find(([, k]) => k >= 5);
    if (acer) out.push({
      id: "ace", title: "¡ACE!", tone: "go",
      message: `${acer[0]} firmó un ACE. Subidón de moral para el equipo.`,
      options: [{ kind: "command", id: "motivate", label: "Aprovechar la euforia" }],
    });
  }

  return out;
}
