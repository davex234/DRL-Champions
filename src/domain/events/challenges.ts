/**
 * DESAFÍOS DE EVENTO (Fase 12) — dominio PURO, por DATOS.
 *
 * ────────────────────────── QUÉ ES UN DESAFÍO ──────────────────────────
 *
 * Un objetivo medible acotado a la ventana de un evento. La diferencia con una misión del
 * pase no es el premio: es el ALCANCE. Una misión mide toda tu vida de jugador («abre 100
 * sobres»); un desafío mide solo lo que hiciste **mientras el torneo estaba en marcha**.
 *
 * ────────────────────────── POR QUÉ NO HAY TABLA DE DESAFÍOS ──────────────────────────
 *
 * Porque no hace falta ninguna. Un desafío tiene tres partes y las tres ya tienen sitio:
 *
 *   · La DEFINICIÓN es contenido, y el contenido vive en el código como el resto del
 *     catálogo (`data/packs`, `data/season`, `domain/pickems/rewards`). Añadir un desafío
 *     es añadir una entrada aquí.
 *   · El PROGRESO no se guarda: se cuenta al vuelo sobre las tablas donde ya está el hecho
 *     (`pickem_scores`, `duel_matches`, `economy_ops`). Es la misma decisión que tomó
 *     `metricsFor` en la Fase 9E, y por el mismo motivo: un contador duplicado es un
 *     contador que acabará discrepando.
 *   · Lo RECLAMADO va a `user_achievements` con el id `event:<evento>:<desafío>`. Esa tabla
 *     guarda exactamente eso —qué reclamó quién y cuándo—, ya tiene RLS de solo lectura y
 *     ya está cerrada al cliente. Y de paso resuelve el requisito de que los logros de
 *     evento «queden registrados y conserven historial»: lo hacen gratis.
 *
 * ────────────────────────── NADA DE `if evento === "…"` ──────────────────────────
 *
 * Los conjuntos se eligen por una CONDICIÓN sobre los campos del evento, no por su id. Un
 * torneo nuevo que la sincronización traiga mañana recibe sus desafíos sin tocar código,
 * que es la regla que la Fase 10 fijó para el ciclo y que aquí se hereda.
 *
 * ────────────────────────── CUÁNTO PAGA, Y POR QUÉ ESO ──────────────────────────
 *
 * El conjunto entero reparte 4.000 créditos, 530 XP, 60 fichas y un sobre Estándar. Con
 * tres eventos por temporada son 12.000 créditos, un **+9,6 %** sobre los 124.900 no
 * repetibles que `economy.md` §4 tiene medidos. No es una cifra elegida por intuición: es
 * la que mantiene el evento por debajo de la décima parte del grifo de temporada, para que
 * añadir contenido vivo no sea añadir inflación.
 *
 * Y hay una regla explícita para no pagar dos veces: **los desafíos no repiten el premio
 * del Pick'em.** El escalón del Pick'em (`domain/pickems/rewards`) paga por acertar; el
 * desafío paga por PARTICIPAR y es deliberadamente pequeño al lado. Las dos rutas pasan por
 * `services/rewards.award()` con claves distintas, así que se pueden auditar por separado.
 */
import type { Reward } from "./types";

/**
 * Lo que un desafío sabe medir. Cada métrica está acotada a la ventana del evento y sale
 * de una tabla donde el hecho ya existe: no se inventa ningún contador nuevo.
 */
export type EventMetric =
  /** Predicciones enviadas en el Pick'em de este evento. */
  | "event_picks_made"
  /** Predicciones acertadas, una vez corregido. */
  | "event_picks_correct"
  /** Puntos del Pick'em de este evento. */
  | "event_pickem_points"
  /** Duelos terminados mientras el evento estaba en marcha. */
  | "event_duels_played"
  /** Duelos ganados mientras el evento estaba en marcha. */
  | "event_duels_won"
  /** Sobres abiertos mientras el evento estaba en marcha. */
  | "event_packs_opened";

export interface EventChallengeDef {
  id: string;
  label: string;
  /** Qué hay que hacer, en una frase. Se enseña tal cual. */
  description: string;
  metric: EventMetric;
  goal: number;
  reward: Reward;
}

/** Lo que hace falta saber de un evento para elegirle un conjunto de desafíos. */
export interface EventShape {
  id: string;
  type: string | null;
  region: string | null;
}

export interface ChallengeSet {
  id: string;
  label: string;
  /** La condición. Sobre CAMPOS del evento, nunca sobre su id. */
  matches: (ev: EventShape) => boolean;
  challenges: EventChallengeDef[];
}

/**
 * Los desafíos base, presentes en cualquier evento.
 *
 * Cubren las cuatro cosas que un jugador puede hacer durante un torneo —predecir, acertar,
 * jugar y abrir—, que es justo el bucle que la Fase 10 conectó. Si un evento no tiene
 * Pick'em, los dos primeros sencillamente no progresan y se enseñan bloqueados con su
 * motivo, en lugar de desaparecer sin explicación.
 */
const BASE: EventChallengeDef[] = [
  {
    id: "participar",
    label: "Entra al torneo",
    description: "Envía una predicción del evento.",
    metric: "event_picks_made",
    goal: 1,
    reward: { credits: 500, xp: 50},
  },
  {
    id: "pronostico",
    label: "Ojo clínico",
    description: "Acierta 3 predicciones del evento.",
    metric: "event_picks_correct",
    goal: 3,
    reward: { credits: 1000, xp: 100},
  },
  {
    id: "competir",
    label: "En forma",
    description: "Juega 5 duelos mientras dure el evento.",
    metric: "event_duels_played",
    goal: 5,
    reward: { credits: 800, xp: 120 },
  },
  {
    id: "dominar",
    label: "Racha de torneo",
    description: "Gana 3 duelos mientras dure el evento.",
    metric: "event_duels_won",
    goal: 3,
    reward: { credits: 1200, xp: 180, packId: "estandar", packCount: 1 },
  },
  {
    id: "coleccionar",
    label: "Fiebre de sobres",
    description: "Abre 5 sobres mientras dure el evento.",
    metric: "event_packs_opened",
    goal: 5,
    reward: { credits: 500, xp: 80},
  },
];

/**
 * Un desafío EXTRA para los torneos internacionales, que son los largos y los que la gente
 * sigue de verdad. No cambia el premio de los demás: se suma uno.
 */
const INTERNACIONAL: EventChallengeDef = {
  id: "analista",
  label: "Analista del circuito",
  description: "Suma 40 puntos en las predicciones del evento.",
  metric: "event_pickem_points",
  goal: 40,
  reward: { credits: 1500, xp: 200},
};

/**
 * Los conjuntos, de más específico a más general. Gana el PRIMERO que encaja, así que el
 * orden es la prioridad y el último es la red de seguridad: ningún evento se queda sin
 * desafíos por no encajar en ninguna categoría.
 */
export const CHALLENGE_SETS: ChallengeSet[] = [
  {
    id: "internacional",
    label: "Torneo internacional",
    matches: (ev) => {
      const t = (ev.type ?? "").toLowerCase();
      return t === "international" || t === "masters" || t === "champions" || t === "ewc";
    },
    challenges: [...BASE, INTERNACIONAL],
  },
  {
    id: "general",
    label: "Torneo del circuito",
    matches: () => true,
    challenges: BASE,
  },
];

export function challengeSetFor(ev: EventShape): ChallengeSet {
  return CHALLENGE_SETS.find((s) => s.matches(ev)) ?? CHALLENGE_SETS[CHALLENGE_SETS.length - 1];
}

export function challengesFor(ev: EventShape): EventChallengeDef[] {
  return challengeSetFor(ev).challenges;
}

export function challengeById(ev: EventShape, id: string): EventChallengeDef | null {
  return challengesFor(ev).find((c) => c.id === id) ?? null;
}

/**
 * La clave de idempotencia y, a la vez, el id con el que se guarda en `user_achievements`.
 * Que sean la misma cadena no es una casualidad: significa que el rastro de la recompensa y
 * el registro de lo reclamado se pueden cruzar sin traducir nada.
 */
export const challengeRef = (eventId: string, challengeId: string): string =>
  `event:${eventId}:${challengeId}`;

/** Lo que reparte un conjunto entero. Sirve para la vitrina («qué puedo ganar») y para el informe. */
export function totalReward(challenges: EventChallengeDef[]): Reward {
  const out: Reward = { credits: 0, xp: 0 };
  const packs: string[] = [];
  for (const c of challenges) {
    out.credits = (out.credits ?? 0) + (c.reward.credits ?? 0);
    out.xp = (out.xp ?? 0) + (c.reward.xp ?? 0);
    for (let i = 0; i < (c.reward.packCount ?? 0); i++) if (c.reward.packId) packs.push(c.reward.packId);
  }
  if (packs.length > 0) { out.packId = packs[0]; out.packCount = packs.length; }
  return out;
}
