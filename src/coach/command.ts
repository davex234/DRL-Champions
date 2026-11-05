/**
 * COACH COMMAND LAYER — el vocabulario de ÓRDENES EN VIVO del entrenador.
 *
 * El entrenador deja de "mirar": en cualquier momento de la ronda ordena RITMO,
 * OBJETIVO, POSICIÓN, UTILIDAD, EJECUCIÓN o interviene en lo MENTAL. Cada orden NO
 * es un script: se COMPILA a las palancas que los motores existentes ya leen —
 * `RoundState.coachFlags` (Director táctico + Abilities), `RoundState.plans`
 * (Director clásico) y `SimPlayer.mental` (Brain). Reutiliza el presupuesto de
 * "Voz" y el evento `coachCall` (que la narrativa ya entiende). PURO.
 *
 *   Comando → coachFlags / plans / mental → Director · Brain · Abilities
 */
import type { RoundState, SimPlayer, Side } from "@/sim";
import { TPS } from "@/sim";
import type { Lane } from "@/tactics";

export type CoachCommandCategory = "ritmo" | "objetivo" | "posicion" | "utilidad" | "ejecucion" | "mental";
export type CommandTone = "go" | "calm" | "danger" | "info";

export type CoachCommandId =
  // ritmo
  | "tempo_up" | "tempo_down"
  // agresividad / paciencia
  | "aggression" | "patience"
  // objetivo / prioridad de zona
  | "focus_main" | "focus_tree" | "focus_mid"
  // posición
  | "stack" | "spread" | "rotate" | "trade"
  // utilidad
  | "save_utility" | "use_utility"
  // ejecución
  | "force_execute" | "cancel_fake" | "play_picks" | "regroup" | "save" | "retake" | "plant_default"
  // intervención mental
  | "motivate" | "calm";

export interface CoachCommandMeta {
  id: CoachCommandId;
  label: string;
  desc: string;
  category: CoachCommandCategory;
  tone: CommandTone;
  /** Coste de Voz (todas 1 hoy; preparado para órdenes "caras"). */
  voz: number;
}

const LANE_OF: Record<"focus_main" | "focus_tree" | "focus_mid", Lane> = {
  focus_main: "main", focus_tree: "tree", focus_mid: "mid",
};

export const COACH_COMMANDS: Record<CoachCommandId, CoachCommandMeta> = {
  tempo_up:      { id: "tempo_up",      label: "Acelerar",        desc: "Subimos el ritmo: presión y tempo rápido.", category: "ritmo", tone: "go", voz: 1 },
  tempo_down:    { id: "tempo_down",    label: "Frenar",          desc: "Bajamos el ritmo: control y paciencia.", category: "ritmo", tone: "calm", voz: 1 },
  aggression:    { id: "aggression",    label: "Más agresivos",   desc: "Buscad los duelos, ganad espacio.", category: "ritmo", tone: "go", voz: 1 },
  patience:      { id: "patience",      label: "Paciencia",       desc: "Sin regalar duelos: jugamos lento.", category: "ritmo", tone: "calm", voz: 1 },
  focus_main:    { id: "focus_main",    label: "Foco A / Main",   desc: "Prioridad al carril de A Main.", category: "objetivo", tone: "info", voz: 1 },
  focus_tree:    { id: "focus_tree",    label: "Foco B / Tree",   desc: "Prioridad al carril de B / Tree.", category: "objetivo", tone: "info", voz: 1 },
  focus_mid:     { id: "focus_mid",     label: "Foco Mid",        desc: "Prioridad al control de Mid.", category: "objetivo", tone: "info", voz: 1 },
  stack:         { id: "stack",         label: "Stack",           desc: "Apilamos el carril prioritario.", category: "posicion", tone: "info", voz: 1 },
  spread:        { id: "spread",        label: "Repartir",        desc: "Defensa repartida, cubrir todo.", category: "posicion", tone: "info", voz: 1 },
  rotate:        { id: "rotate",        label: "Rotar ya",        desc: "Rotamos al carril de contacto.", category: "posicion", tone: "go", voz: 1 },
  trade:         { id: "trade",         label: "Tradear",         desc: "Nadie muere solo: jugad pegados.", category: "posicion", tone: "info", voz: 1 },
  save_utility:  { id: "save_utility",  label: "Guardar util.",   desc: "No gastéis utilidad todavía.", category: "utilidad", tone: "calm", voz: 1 },
  use_utility:   { id: "use_utility",   label: "Usar util.",      desc: "Gastad utilidad: abrid espacio.", category: "utilidad", tone: "go", voz: 1 },
  force_execute: { id: "force_execute", label: "Execute YA",      desc: "Comprometemos la ejecución ya.", category: "ejecucion", tone: "go", voz: 1 },
  cancel_fake:   { id: "cancel_fake",   label: "Cancelar fake",   desc: "Olvidad la finta: vamos al carril real.", category: "ejecucion", tone: "go", voz: 1 },
  play_picks:    { id: "play_picks",    label: "Jugar picks",     desc: "Buscamos pick, sin comprometer.", category: "ejecucion", tone: "calm", voz: 1 },
  regroup:       { id: "regroup",       label: "Reagrupar",       desc: "Reset: nos reagrupamos.", category: "ejecucion", tone: "calm", voz: 1 },
  save:          { id: "save",          label: "Salvar",          desc: "Salvamos el armamento.", category: "ejecucion", tone: "danger", voz: 1 },
  retake:        { id: "retake",        label: "Retake YA",       desc: "Comprometemos el retake.", category: "ejecucion", tone: "go", voz: 1 },
  plant_default: { id: "plant_default", label: "Plantar default", desc: "Plante por defecto.", category: "ejecucion", tone: "info", voz: 1 },
  motivate:      { id: "motivate",      label: "Motivar",         desc: "Subimos la moral y la confianza.", category: "mental", tone: "go", voz: 1 },
  calm:          { id: "calm",          label: "Calmar",          desc: "Bajamos la presión y el tilt.", category: "mental", tone: "calm", voz: 1 },
};

const clamp100 = (n: number) => Math.max(0, Math.min(100, n));
const clampSigned = (n: number) => Math.max(-100, Math.min(100, n));

/** IGL efectivo: el designado por el coach, o el de rol, o el primero vivo. */
function effectiveIgl(s: RoundState, side: Side): SimPlayer | undefined {
  const over = s.coachFlags.iglOverrideId
    ? s.players.find((p) => p.id === s.coachFlags.iglOverrideId && p.side === side && p.alive)
    : undefined;
  return over
    ?? s.players.find((p) => p.side === side && p.role === "igl" && p.alive)
    ?? s.players.find((p) => p.side === side && p.alive);
}

/** Jugadores vivos del lado entrenado. */
const coachedAlive = (s: RoundState): SimPlayer[] =>
  s.players.filter((p) => p.side === s.coachSide && p.alive);

/**
 * Aplica una orden del entrenador. Devuelve un NUEVO RoundState (inmutable). Consume
 * Voz salvo que sea una intervención mental concedida en pausa (la UI puede ajustar
 * `voz` antes de llamar, igual que el timeout). No mata, no mueve a mano: solo escribe
 * palancas que los motores leen.
 */
export function applyCommand(prev: RoundState, id: CoachCommandId): RoundState {
  if (prev.phase === "ENDED") return prev;
  const meta = COACH_COMMANDS[id];
  if (prev.voz.left < meta.voz) return prev;

  const s: RoundState = structuredClone(prev);
  const side = s.coachSide;
  const igl = effectiveIgl(s, side);
  const effective = (igl?.attrs.leadership ?? 50) >= 50;
  const cf = s.coachFlags;
  const plan = s.plans[side];

  switch (id) {
    case "tempo_up":
      cf.tempoBias = 1; s.plans[side] = { ...plan, tempo: "fast" };
      if (side === "ATK" && s.phase !== "SETUP") s.forcedExecute = true;
      break;
    case "tempo_down":
      cf.tempoBias = -1; s.plans[side] = { ...plan, tempo: "slow" };
      if (side === "ATK" && s.phase === "SETUP") cf.fallbackUntil = Math.max(cf.fallbackUntil, s.tick + 2 * TPS);
      break;
    case "aggression":
      cf.aggressionBias = 1; s.plans[side] = { ...plan, aggression: "aggressive" };
      break;
    case "patience":
      cf.aggressionBias = -1; s.plans[side] = { ...plan, aggression: "passive" };
      break;
    case "focus_main": case "focus_tree": case "focus_mid":
      cf.laneFocus = LANE_OF[id];
      break;
    case "stack":
      cf.stack = true;
      break;
    case "spread":
      cf.stack = false; s.plans[side] = { ...plan, approach: side === "DEF" ? "balanced" : plan.approach };
      break;
    case "rotate":
      cf.forceRotation = true;
      break;
    case "trade":
      // "Nadie muere solo": empuja a jugar pegados (sesgo) y un plus de moral de equipo.
      cf.aggressionBias = Math.max(cf.aggressionBias, 0);
      for (const p of coachedAlive(s)) p.mental.morale = clamp100(p.mental.morale + 4);
      break;
    case "save_utility":
      cf.saveUtility = true; cf.pushUtility = false;
      break;
    case "use_utility":
      cf.pushUtility = true; cf.saveUtility = false;
      break;
    case "force_execute":
      if (side === "ATK") s.forcedExecute = true;
      else { cf.forceRetake = true; if (cf.retakeTick == null) cf.retakeTick = s.tick; }
      break;
    case "cancel_fake":
      // Olvida la finta: foco en el carril real y compromete.
      if (side === "ATK") { s.forcedExecute = true; s.plans.ATK = { ...s.plans.ATK, approach: "default" }; }
      break;
    case "play_picks":
      cf.aggressionBias = -1; s.plans[side] = { ...plan, aggression: "passive" };
      break;
    case "regroup":
      cf.fallbackUntil = s.tick + 3 * TPS;
      break;
    case "save":
      cf.fallbackUntil = s.tick + 9999;
      break;
    case "retake":
      if (side === "DEF") { cf.forceRetake = true; if (cf.retakeTick == null) cf.retakeTick = s.tick; }
      break;
    case "plant_default":
      break; // el motor ya prioriza el plante por defecto
    case "motivate":
      for (const p of coachedAlive(s)) {
        p.mental.confidence = clamp100(p.mental.confidence + 12);
        p.mental.morale = clamp100(p.mental.morale + 10);
        p.mental.momentum = clampSigned(p.mental.momentum + 8);
        p.mental.tilt = clamp100(p.mental.tilt - 8);
      }
      break;
    case "calm":
      for (const p of coachedAlive(s)) {
        p.mental.tilt = clamp100(p.mental.tilt - 16);
        p.mental.pressure = clamp100(p.mental.pressure - 16);
        p.mental.confidence = clamp100(p.mental.confidence + 4);
      }
      break;
  }

  s.voz.left -= meta.voz;
  s.events.push({ tick: s.tick, type: "coachCall", data: { id, effective, kind: "command", category: meta.category } });
  return s;
}

/** Cambia el IGL designado (intervención de liderazgo). No consume Voz por sí sola. */
export function setIgl(prev: RoundState, playerId: string): RoundState {
  if (prev.phase === "ENDED") return prev;
  const s: RoundState = structuredClone(prev);
  const ok = s.players.some((p) => p.id === playerId && p.side === s.coachSide);
  if (!ok) return prev;
  s.coachFlags.iglOverrideId = playerId;
  s.events.push({ tick: s.tick, type: "coachCall", data: { id: "change_igl", effective: true, kind: "command", category: "mental" } });
  return s;
}

/**
 * Comandos PERTINENTES ahora mismo (contexto). Garantiza que el entrenador SIEMPRE
 * tenga decisiones relevantes — nunca "mirar sin hacer nada". El orden importa: lo
 * más útil primero.
 */
export function availableCommands(s: RoundState): CoachCommandId[] {
  if (s.phase === "ENDED" || s.voz.left <= 0) return [];
  const atk = s.coachSide === "ATK";
  const planted = s.spike.planted;
  const out: CoachCommandId[] = [];

  if (planted) {
    if (atk) out.push("regroup", "play_picks", "save");
    else out.push("retake", "play_picks", "save");
  } else if (atk) {
    if (s.phase === "SETUP") out.push("focus_main", "focus_tree", "focus_mid", "tempo_up", "tempo_down", "use_utility", "save_utility");
    else out.push("force_execute", "cancel_fake", "aggression", "patience", "trade");
  } else {
    out.push("stack", "spread", "rotate", "focus_main", "focus_tree", "focus_mid", "aggression", "patience");
  }

  // Intervención mental SIEMPRE disponible (el entrenador puede hablarle al equipo).
  out.push("motivate", "calm");
  // Deduplica conservando el orden.
  return [...new Set(out)];
}
