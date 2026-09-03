/**
 * MODELO DE COMBATE — FUENTE ÚNICA DE VERDAD (Fase 2).
 *
 * Aquí vive TODA la matemática que convierte el rendimiento real de un jugador en la carta que
 * se juega: métricas → Stronghold/Gamesense/Entryfrag → statBoost de variante → OVR. Ningún otro
 * módulo puede recalcular esto: la UI, el generador, los sobres, los stores y los tests consumen
 * `deriveCard()` o las funciones de este fichero.
 *
 *   RawMetrics → combatFromMetrics() → CombatStats → applyStatBoost() → computeCombatOvr() → OVR
 *
 * Las constantes están CONGELADAS (temporada VCT 2026, 353 jugadores con ≥100 rondas). No se
 * recalculan al entrar jugadores nuevos: una carta que el usuario ya posee no puede cambiar sola.
 * Reanclarlas es una decisión editorial explícita que cambia `DATA_VERSION`.
 *
 * PURO y DETERMINISTA: sin reloj, sin azar, sin estado global.
 */
import type { RawMetrics } from "./statsFromMetrics";

/** Identificador de la calibración vigente. Sella cada carta para permitir reanclajes trazables. */
export const DATA_VERSION = "VCT-2026";

/**
 * Rondas mínimas para que un jugador genere carta automáticamente.
 * Por debajo, la dispersión de sus tasas es un 70 % mayor que la real (ruido de muestra pequeña):
 * su perfil sería mayoritariamente azar. Ver Fase 1.2 §6.
 */
export const MIN_ROUNDS = 100;

/** Las 3 estadísticas de combate de una carta (escala 0-99). */
export interface CombatStats {
  /** SH — aguantar la posición: sobrevivir y no caer el primero. */
  stronghold: number;
  /** GS — leer el juego: aportar a la ronda sin necesidad de fraguear. */
  gamesense: number;
  /** EF — abrir la ronda: agresión y primer contacto. */
  entryfrag: number;
}

export type CombatStatKey = keyof CombatStats;

export const COMBAT_STAT_ORDER: CombatStatKey[] = ["stronghold", "gamesense", "entryfrag"];

export const COMBAT_STAT_META: Record<CombatStatKey, { label: string; full: string; color: string }> = {
  stronghold: { label: "SH", full: "Stronghold", color: "#d94a4a" },
  gamesense: { label: "GS", full: "Gamesense", color: "#3f86c4" },
  entryfrag: { label: "EF", full: "Entryfrag", color: "#3fa85f" },
};

/**
 * Emparejamientos legales del combate (PDF): Stronghold↔Entryfrag y Gamesense↔Gamesense.
 * Se declara aquí porque deriva del significado de las estadísticas, no del motor de partida.
 * El resolutor de combate (fase posterior) lo consumirá; NO se implementa combate aquí.
 */
export const COMBAT_MATCHUP: Record<CombatStatKey, CombatStatKey> = {
  stronghold: "entryfrag",
  gamesense: "gamesense",
  entryfrag: "stronghold",
};

// ───────────────────────────── Constantes congeladas · VCT 2026 ─────────────────────────────

/** Media y desviación de referencia de un componente. Congeladas: NO se recalculan. */
export interface ComponentRef { mean: number; std: number }

/** Referencia de cada componente que entra en el modelo (Fase 1.2 §19.1). */
export const COMPONENT_REF = {
  kd: { mean: 0.96984, std: 0.12917 },
  invFd: { mean: -0.09836, std: 0.04118 },
  invDeath: { mean: -0.70236, std: 0.04379 },
  kast: { mean: 70.44106, std: 3.12412 },
  assist: { mean: 0.26935, std: 0.07577 },
  fk: { mean: 0.0967, std: 0.04226 },
  adr: { mean: 127.70163, std: 13.74746 },
  openp: { mean: 0.19506, std: 0.07919 },
  hs: { mean: 27.92354, std: 4.44609 },
} as const satisfies Record<string, ComponentRef>;

/** Reescalado del compuesto de cada eje a la escala de juego (Fase 1.2 §19.2). */
export const AXIS_REF: Record<CombatStatKey, ComponentRef> = {
  stronghold: { mean: 0, std: 0.71802 },
  gamesense: { mean: 0, std: 0.85702 },
  entryfrag: { mean: 0, std: 0.77498 },
};

/** Centro y amplitud de la escala de estadística. */
export const STAT_CENTER = 60;
export const STAT_SPREAD = 17;

/** Pesos del OVR bruto, aplicados al trío ORDENADO de mayor a menor. */
export const OVR_WEIGHTS_SORTED = [0.4, 0.33, 0.27] as const;

/** Anclaje del OVR (percentiles 1 y 99 del bruto sobre la muestra de referencia). */
export const OVR_REF_MIN = 34.93;
export const OVR_REF_MAX = 82.52;

/** Rango de salida del OVR base. 90-99 queda reservado al efecto de las variantes. */
export const OVR_OUT_MIN = 58;
export const OVR_OUT_MAX = 90;

/** Escalera de statBoost de las variantes. Ningún otro valor es válido. */
export const STAT_BOOST_STEPS = [0, 2, 4, 6, 9, 12] as const;
export type StatBoostStep = (typeof STAT_BOOST_STEPS)[number];

export const isStatBoostStep = (n: number): n is StatBoostStep =>
  (STAT_BOOST_STEPS as readonly number[]).includes(n);

// ───────────────────────────── Derivación ─────────────────────────────

const clampStat = (n: number) => Math.max(0, Math.min(99, Math.round(n)));
const clampOvr = (n: number) => Math.max(1, Math.min(99, Math.round(n)));

/** Estandariza un valor contra su referencia congelada. */
const z = (value: number, ref: ComponentRef): number => (value - ref.mean) / ref.std;

/** Motivo por el que un jugador no puede generar carta automáticamente. */
export type IneligibleReason = "NO_METRICS" | "INSUFFICIENT_ROUNDS" | "MISSING_COMPONENT";

export interface CombatDerivation {
  ok: boolean;
  combat?: CombatStats;
  /** Motivo explícito del rechazo. Nunca se generan estadísticas por defecto. */
  reason?: IneligibleReason;
  /** Rondas consideradas (para trazabilidad del rechazo). */
  rounds?: number;
}

/**
 * Deriva el trío de combate a partir de las métricas reales.
 *
 * REGLA: todos los RECUENTOS entran divididos por `rounds`. Sin ese denominador, un jugador que
 * llega a la final parece mejor que uno eliminado en grupos solo por haber jugado más.
 *
 * Devuelve un rechazo explícito (nunca valores por defecto) si faltan métricas o si el jugador
 * no alcanza `MIN_ROUNDS`.
 */
export function deriveCombat(m: RawMetrics | undefined): CombatDerivation {
  if (!m) return { ok: false, reason: "NO_METRICS" };

  const rounds = m.rounds ?? 0;
  if (rounds <= 0) return { ok: false, reason: "NO_METRICS" };
  if (rounds < MIN_ROUNDS) return { ok: false, reason: "INSUFFICIENT_ROUNDS", rounds };

  // Componentes obligatorios: si falta uno, no se inventa un valor neutro.
  const { kd, kast, assists, fk, fd, adr, hsPct, deaths } = m;
  if (
    kd == null || kast == null || assists == null || fk == null ||
    fd == null || adr == null || hsPct == null || deaths == null
  ) {
    return { ok: false, reason: "MISSING_COMPONENT", rounds };
  }

  const zKd = z(kd, COMPONENT_REF.kd);
  const zInvFd = z(-(fd / rounds), COMPONENT_REF.invFd);
  const zInvDeath = z(-(deaths / rounds), COMPONENT_REF.invDeath);
  const zKast = z(kast, COMPONENT_REF.kast);
  const zAssist = z(assists / rounds, COMPONENT_REF.assist);
  const zFk = z(fk / rounds, COMPONENT_REF.fk);
  const zAdr = z(adr, COMPONENT_REF.adr);
  const zOpen = z((fk + fd) / rounds, COMPONENT_REF.openp);
  const zHs = z(hsPct, COMPONENT_REF.hs);

  const composite: Record<CombatStatKey, number> = {
    stronghold: 0.5 * zKd + 0.36 * zInvFd + 0.14 * zInvDeath,
    gamesense: 0.55 * zKast + 0.45 * zAssist,
    entryfrag: 0.4 * zFk + 0.25 * zAdr + 0.2 * zOpen + 0.15 * zHs,
  };

  const toScale = (key: CombatStatKey): number =>
    clampStat(STAT_CENTER + z(composite[key], AXIS_REF[key]) * STAT_SPREAD);

  return {
    ok: true,
    rounds,
    combat: {
      stronghold: toScale("stronghold"),
      gamesense: toScale("gamesense"),
      entryfrag: toScale("entryfrag"),
    },
  };
}

/**
 * Aplica el bonus de variante al trío, ANTES de calcular el OVR.
 *
 * El exceso NO se redistribuye cuando una estadística llega a 99: un especialista extremo obtiene
 * menos valor de una variante alta que un jugador completo. Es el efecto de techo documentado
 * como L-03 en la Fase 1.2 y ACEPTADO como decisión de producto.
 */
export function applyCombatBoost(c: CombatStats, boost: number): CombatStats {
  if (boost === 0) return { ...c };
  return {
    stronghold: clampStat(c.stronghold + boost),
    gamesense: clampStat(c.gamesense + boost),
    entryfrag: clampStat(c.entryfrag + boost),
  };
}

/** Bruto del OVR: media ponderada del trío ORDENADO de mayor a menor. */
export function combatOvrRaw(c: CombatStats): number {
  const sorted = [c.stronghold, c.gamesense, c.entryfrag].sort((a, b) => b - a);
  return (
    OVR_WEIGHTS_SORTED[0] * sorted[0] +
    OVR_WEIGHTS_SORTED[1] * sorted[1] +
    OVR_WEIGHTS_SORTED[2] * sorted[2]
  );
}

/** OVR (1-99) de un trío ya boosteado. Reescalado afín contra el anclaje congelado. */
export function computeCombatOvr(c: CombatStats): number {
  const raw = combatOvrRaw(c);
  const t = (raw - OVR_REF_MIN) / (OVR_REF_MAX - OVR_REF_MIN);
  return clampOvr(OVR_OUT_MIN + t * (OVR_OUT_MAX - OVR_OUT_MIN));
}

/**
 * COMPOSICIÓN ÚNICA: trío base + bonus de variante → trío final + OVR.
 * Todo el juego pasa por aquí; nadie compone estos dos pasos por su cuenta.
 */
export function deriveCard(base: CombatStats, statBoost: number): { combat: CombatStats; ovr: number } {
  const combat = applyCombatBoost(base, statBoost);
  return { combat, ovr: computeCombatOvr(combat) };
}
