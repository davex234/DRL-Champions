/**
 * PLAYER IDENTITY ENGINE — ADN del jugador.
 *
 * Cada jugador profesional se representa con un vector de RASGOS (0..100) puramente
 * declarativo. El ADN es FIJO durante la partida; lo que cambia es el estado mental
 * (ver `mental.ts`). Dos jugadores con los MISMOS atributos de combate (aim, gameSense…)
 * jugarán distinto si su ADN difiere: la identidad pesa más que el OVR.
 *
 * No se hardcodea ningún jugador concreto: cualquier pro presente o futuro se modela
 * eligiendo un perfil de rasgos (ver `profiles.ts`). Este módulo es PURO (sin React,
 * sin RoundState) para no crear ciclos con el motor.
 */

/** Vector de identidad. Todos los rasgos en 0..100 (50 = neutro). */
export interface Identity {
  // — Temperamento de combate —
  /** Busca duelos, toma espacio, asoma de forma proactiva. */
  aggression: number;
  /** Aguanta ángulos y espera el momento; alarga la cadencia de re-peek. */
  patience: number;
  /** Acepta duelos desfavorables o en desventaja numérica. */
  riskAppetite: number;

  // — Fortaleza mental —
  /** Sangre fría: resiste presión y tilt; rinde en momentos calientes. */
  composure: number;
  /** Confianza base y techo de confianza. */
  selfBelief: number;
  /** Velocidad de recuperación de tilt/moral tras un revés. */
  resilience: number;
  /** Baja = rendimiento errático (alta varianza por duelo). */
  consistency: number;
  /** Con confianza alta, ignora el plan/llamadas (juego codicioso). */
  ego: number;

  // — Inteligencia de juego —
  /** Lee la ronda, rota y reposiciona correctamente. */
  tacticalIQ: number;
  /** Cambia de plan según el estado de la ronda (jugar picks, salvar…). */
  adaptability: number;
  /** Se ciñe al rol, evita peeks codiciosos, se mantiene en su sitio. */
  discipline: number;
  /** Off-angles, timings y posiciones poco convencionales. */
  creativity: number;

  // — Huella de estilo —
  /** Quiere ser el primero en entrar al sitio. */
  entryDrive: number;
  /** Se separa para jugar flanco/timings en solitario. */
  lurkTendency: number;
  /** Se mantiene listo para el refrag (trade). */
  tradeInstinct: number;
  /** Se apoya en utilidad para crear espacio (vs. aim puro). */
  utilityLean: number;
  /** Foco y calma extra cuando es el último vivo. */
  clutchFactor: number;

  // — Capa social —
  /** Peso en el shot-calling (acelera/afina el timing del IGL). */
  leadershipDrive: number;
  /** Mejora la lectura y el refrag de los compañeros (info). */
  communication: number;
}

export type TraitKey = keyof Identity;

/** Familias para el informe/depuración. */
export const TRAIT_FAMILIES: Record<string, TraitKey[]> = {
  "Temperamento": ["aggression", "patience", "riskAppetite"],
  "Mente": ["composure", "selfBelief", "resilience", "consistency", "ego"],
  "Inteligencia": ["tacticalIQ", "adaptability", "discipline", "creativity"],
  "Estilo": ["entryDrive", "lurkTendency", "tradeInstinct", "utilityLean", "clutchFactor"],
  "Social": ["leadershipDrive", "communication"],
};

export const TRAIT_KEYS: TraitKey[] = Object.values(TRAIT_FAMILIES).flat();

export const clampTrait = (n: number): number => Math.max(0, Math.min(100, n));

/** Identidad neutra (todo a 50): un "agente genérico" sin personalidad. */
export function neutralIdentity(): Identity {
  const id = {} as Identity;
  for (const k of TRAIT_KEYS) id[k] = 50;
  return id;
}

/** Construye una identidad a partir de una neutra + overrides (con clamp). */
export function makeIdentity(partial: Partial<Identity>): Identity {
  const id = neutralIdentity();
  for (const k of TRAIT_KEYS) {
    if (partial[k] != null) id[k] = clampTrait(partial[k]!);
  }
  return id;
}

/** Normaliza un rasgo a [-1, 1] centrado en 50 (útil para los modificadores). */
export const unit = (t: number): number => (clampTrait(t) - 50) / 50;
