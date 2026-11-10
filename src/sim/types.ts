/**
 * Tipos PUROS de la simulación de ronda (Vertical Slice "El Entrenador").
 * Sin React, sin dependencias. El motor opera como reductor sobre `RoundState`.
 */
import type { Vec2 } from "./geometry";
import type { Attributes, Role, SimPlayerMeta, SimLoadout } from "./attributes";
import type { ZoneId } from "./map/ascentA";
import type { Identity } from "./identity/traits";
import type { MentalState } from "./identity/mental";
import type { TacticalRuntime, Lane } from "../tactics/types";
import type { AgentInstance } from "../agents/types";
import type { CompositionProfile } from "../agents/composition";
import type { MapState } from "../utility/types";
import type { BrainState, CommMessage } from "../brain/types";

export type Side = "ATK" | "DEF";
export type Phase = "SETUP" | "EXECUTE" | "POSTPLANT" | "ENDED";

/** Objetivo momentáneo de un jugador (lo decide la IA). */
export type Intent =
  | "move" | "hold" | "push" | "rotate" | "fight" | "trade" | "plant" | "defuse" | "fallback";

export type Tempo = "slow" | "mid" | "fast";
export type Aggression = "passive" | "balanced" | "aggressive";

/** Plan de un equipo (el del lado entrenado lo fija el coach; el otro, por defecto). */
export interface TeamPlan {
  /** Ataque: default|rush-main|split|fake-commit · Defensa: balanced|stack-a|aggro-info|retake. */
  approach: string;
  tempo: Tempo;
  aggression: Aggression;
}

/** Lo que el entrenador configura antes de la ronda. */
export interface CoachSetup {
  side: Side;
  approach: string;
  tempo: Tempo;
  aggression: Aggression;
}

export interface SimPlayer {
  id: string;
  name: string;
  side: Side;
  role: Role;
  attrs: Attributes;
  /** Identidad de carta (foto/equipo/rareza) para la retransmisión. Opcional. */
  meta?: SimPlayerMeta;
  /** Equipamiento de la ronda (lo entrega la Buy Phase). La simulación solo lo porta. */
  loadout?: SimLoadout;
  /** ADN de personalidad (FIJO durante la partida). */
  identity: Identity;
  /** Agente que juega (Agent Engine). Cambia su forma de jugar, no su aim. Opcional. */
  agent?: AgentInstance;
  /** Cerebro del jugador (Brain Engine): memoria/creencias/decisión. Opcional. */
  brain?: BrainState;
  /** Estado mental DINÁMICO (confianza, tilt, moral, momentum, fatiga, presión). */
  mental: MentalState;
  pos: Vec2;
  facing: number; // radianes
  alive: boolean;
  hp: number;
  /** Escudo restante (Combat 3.0). Absorbe daño antes que la vida. Opcional (clásico = 0). */
  shield?: number;
  /** Estadísticas de combate de la ronda (Combat 3.0). Opcional. */
  cstat?: import("../combat2/stats").CombatStats;
  /** Daño recibido por atacante en la ronda (para asistencias). Opcional. */
  dmgFrom?: Record<string, number>;
  /** Enfrentamiento actual: id rival, tick de inicio y "forma" del duelo (varianza por inconsistencia). */
  engage?: { id: string; since: number; luck?: number };
  /** Estado de HABILIDADES (cooldowns) — Agent Ability Engine. Opcional. */
  abil?: import("../abilities/types").AbilityState;
  /** Zona destino actual (id de waypoint/zona del mapa). */
  targetZone: ZoneId;
  holdPos: Vec2;
  intent: Intent;
  targetEnemyId: string | null;
  /** Última posición conocida de enemigos (id → {pos, tick}). */
  lastSeen: Record<string, { pos: Vec2; tick: number }>;
  /** Tick hasta el que está cegado (flash). */
  flashedUntil: number;
  movedThisTick: boolean;
  /** Progreso de plantar/desactivar (0..1). */
  actionProgress: number;
  reactBuffer: number; // acumulador de reacción para abrir fuego (gameSense)
}

export interface SpikeState {
  planted: boolean;
  carrierId: string | null;
  pos: Vec2 | null;
  plantedTick: number | null;
  plantProgress: number; // 0..1
  defuseBy: string | null;
  defuseProgress: number; // 0..1
}

export type SimEventType =
  | "kill" | "firstblood" | "plant" | "defuse" | "phase"
  | "execute" | "rotate" | "util" | "coachCall" | "end" | "mental";

export interface SimEvent {
  tick: number;
  type: SimEventType;
  data: Record<string, unknown>;
}

export interface RoundState {
  seed: number;
  tick: number;
  phase: Phase;
  players: SimPlayer[];
  spike: SpikeState;
  events: SimEvent[];
  coachSide: Side;
  plans: { ATK: TeamPlan; DEF: TeamPlan };
  voz: { left: number; total: number };
  winner: Side | null;
  endReason: string | null;
  /** Tick en el que el ataque comprometió el execute (para el análisis). */
  executeTick: number | null;
  /** Marca interna: ¿el coach forzó execute? */
  forcedExecute: boolean;
  /** La defensa ya lanzó su utilidad de retake (una vez). */
  retakeFlashed: boolean;
  /**
   * Estado del Tactical Intelligence Engine (opt-in). Si está presente, el director
   * delega las decisiones de equipo en él. Datos planos (clonables por structuredClone).
   */
  tactical?: TacticalRuntime;
  /** Composición de cada lado (Agent Engine) — capacidades/ratings/estilo del equipo. */
  composition?: { ATK: CompositionProfile; DEF: CompositionProfile };
  /** Mapa VIVO (Utility Engine): estado por zona + utilidad activa. Se actualiza cada tick. */
  map?: MapState;
  /** Cola de comunicación entre compañeros (Brain Engine). La info viaja con retraso. */
  comms?: CommMessage[];
  /** ¿Está activo el Brain Engine? (false = comportamiento clásico, para A/B). */
  brainEnabled?: boolean;
  /**
   * Efectos de las órdenes del entrenador (Coach Command Layer). TODO lo que el
   * entrenador decide en vivo se compila aquí; los motores existentes (Director
   * táctico, Brain, Abilities) los LEEN. No hay scripts: son palancas declarativas.
   */
  coachFlags: {
    /** El lado entrenado retrocede (fallback) hasta este tick. */
    fallbackUntil: number;
    /** La defensa entrenada compromete el retake ya. */
    forceRetake: boolean;
    /** Tick en que se forzó el retake (para análisis). */
    retakeTick: number | null;
    /** Sesgo de tempo del entrenador (-1 lento … +1 rápido). */
    tempoBias: number;
    /** Sesgo de agresividad (-1 paciente/pasivo … +1 agresivo). */
    aggressionBias: number;
    /** Carril/objetivo prioritario forzado por el entrenador. */
    laneFocus: Lane | null;
    /** Apilar (stack) el carril prioritario en defensa. */
    stack: boolean;
    /** Rotar al contacto YA (defensa). */
    forceRotation: boolean;
    /** Guardar utilidad: los agentes no la gastan (lo lee Abilities). */
    saveUtility: boolean;
    /** Gastar utilidad ya: abrir espacio (lo lee Abilities). */
    pushUtility: boolean;
    /** IGL designado por el entrenador (sustituye al nominal en el timing/comms). */
    iglOverrideId: string | null;
  };
}

/** Orden del entrenador (mid-ronda). Consume "Voz". */
export type CoachCallId =
  | "execute" | "regroup" | "rotate-tree" | "play-picks" | "rush" | "plant-default" | "save";

export interface CoachCall {
  id: CoachCallId;
}
