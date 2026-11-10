/**
 * ESTRATEGIAS DE BOT (Fase 6).
 *
 * Dos estrategias, ambas PURAS y DETERMINISTAS: mismo contexto y misma semilla ⇒ misma decisión.
 *
 *   · RandomBot — elige legalmente al azar controlado. Prioridad: correcto antes que listo.
 *   · SmartBot  — heurística por reglas. Sin aprendizaje, sin modelos, sin llamadas externas.
 *
 * NINGUNA de las dos copia `COMBAT_MATCHUP` ni reimplementa la comparación: para valorar candidatos
 * leen `card.combat[stat]`, que es el dato ya congelado en el snapshot, y la resolución oficial
 * sigue siendo `resolveEncounter` del Combat Resolver.
 *
 * Prohibido aquí: `Math.random`, `Date.now`, red, Supabase, catálogo, estado global. Verificado por
 * un test que inspecciona este fichero.
 */
import { COMBAT_MATCHUP, type CombatStatKey } from "@/domain/cards/combat";
import { nextFloat, pick, type RngState } from "./rng";
import type {
  BotDifficulty, BotProfile, Decision, DecisionContext, DuelDeckCard, DuelOpponent,
} from "./types";

const ALL_STATS: CombatStatKey[] = ["stronghold", "gamesense", "entryfrag"];

/** Valor de una estadística en el trío ya congelado. Lectura, no cálculo. */
const valueOf = (card: DuelDeckCard, stat: CombatStatKey): number => card.combat[stat];

/**
 * Ordena de forma total y estable por `uid`. Es lo que garantiza que la decisión no dependa del
 * orden en que llegaron las cartas: sin esto, dos ejecuciones con los mismos datos podrían diferir.
 */
const byUid = (cards: DuelDeckCard[]): DuelDeckCard[] =>
  [...cards].sort((a, b) => a.uid.localeCompare(b.uid));

/** La estadística del defensor NO se elige: la impone la tabla del PDF. */
function forcedDefenderStat(ctx: DecisionContext): CombatStatKey {
  // Si el contexto trae la del atacante, la tabla decide. Si no, se cae a la única legal recibida.
  if (ctx.attackerStat) return COMBAT_MATCHUP[ctx.attackerStat];
  return ctx.legalStats[0] ?? "gamesense";
}

// ───────────────────────────── Bot aleatorio ─────────────────────────────

/**
 * BOT ALEATORIO DETERMINISTA.
 *
 * No intenta ganar: intenta jugar legalmente y de forma reproducible. Es la referencia contra la
 * que se mide cualquier estrategia posterior, y el oponente de dificultad `EASY`.
 */
export function createRandomBot(id: string, difficulty: BotDifficulty = "EASY"): DuelOpponent {
  const choose = <T>(rng: RngState, options: readonly T[], fallback: T): { value: T; rng: RngState } => {
    const r = pick(rng, options);
    return { value: r.value ?? fallback, rng: r.rng };
  };

  return {
    id, kind: "BOT", difficulty, perfectInformation: false,

    chooseAttackerCard(ctx): Decision<string> {
      const cards = byUid(ctx.available);
      const r = choose(ctx.rng, cards, cards[0]);
      return {
        value: r.value.uid, rng: r.rng,
        explanation: `Elección aleatoria entre ${cards.length} cartas disponibles: ${r.value.playerName}.`,
      };
    },

    chooseAttackerStat(ctx): Decision<CombatStatKey> {
      const stats = ctx.legalStats.length ? ctx.legalStats : ALL_STATS;
      const r = choose(ctx.rng, stats, stats[0]);
      return { value: r.value, rng: r.rng, explanation: `Estadística elegida al azar entre ${stats.length}.` };
    },

    chooseDefenderCard(ctx): Decision<string> {
      const cards = byUid(ctx.available);
      const r = choose(ctx.rng, cards, cards[0]);
      return {
        value: r.value.uid, rng: r.rng,
        explanation: `Respuesta aleatoria entre ${cards.length} cartas: ${r.value.playerName}.`,
      };
    },

    chooseDefenderStat(ctx): Decision<CombatStatKey> {
      const forced = forcedDefenderStat(ctx);
      // No consume generador: no hay nada que elegir.
      return { value: forced, rng: ctx.rng, explanation: `La tabla obliga a responder con ${forced}.` };
    },
  };
}

// ───────────────────────────── Bot con heurística ─────────────────────────────

/**
 * BOT CON HEURÍSTICA POR REGLAS.
 *
 * Sin aprendizaje automático, sin modelos y sin llamadas externas: solo aritmética sobre el trío
 * que ya está en el snapshot.
 *
 * ATACANDO
 *   · Con información pública — declara su valor más alto. Un número alto es difícil de superar, y
 *     no necesita ver al rival para saberlo. Es lo que hacen los TRES niveles de la escalera desde
 *     la Fase 7, porque ninguno recibe información oculta (OPD-04).
 *   · Con `perfectInformation` — maximiza el margen contra la MEJOR respuesta que el rival podría
 *     dar, mirando las cartas que le quedan. Ningún perfil de dificultad lo activa: se conserva
 *     para poder medir cuánto aportaría y para no romper los tests de la Fase 6.
 *
 * DEFENDIENDO (igual en todos los casos, porque no requiere ver nada oculto)
 *   · Si puede ganar, gana con el MENOR margen posible: guarda sus cartas fuertes para después.
 *   · Si no puede ganar, sacrifica la carta con el valor MÁS BAJO en ese eje: pierde el turno
 *     gastando lo que menos le sirve.
 *
 * Esa lógica de sacrificio no inventa ninguna regla: se deduce de que cada carta se gasta una vez.
 */
export function createSmartBot(
  id: string,
  difficulty: BotDifficulty = "NORMAL",
  /** Por defecto, la visibilidad histórica de la Fase 6: solo HARD ve el mazo rival (OPD-04). */
  perfectInformation: boolean = difficulty === "HARD",
): DuelOpponent {
  const seesOpponent = perfectInformation;

  /** Mejor respuesta que el rival podría dar a esta declaración, si el bot puede verlo. */
  const bestCounter = (ctx: DecisionContext, stat: CombatStatKey): number | null => {
    if (!seesOpponent || ctx.visibleOpponentCards.length === 0) return null;
    const counter = COMBAT_MATCHUP[stat];
    return Math.max(...ctx.visibleOpponentCards.map((c) => valueOf(c, counter)));
  };

  return {
    id, kind: "BOT", difficulty, perfectInformation,

    chooseAttackerCard(ctx): Decision<string> {
      // La carta y la estadística se deciden juntas; aquí se fija la carta de la mejor pareja.
      const best = bestAttack(ctx, bestCounter);
      return {
        value: best.card.uid, rng: ctx.rng,
        explanation: `${best.card.playerName} con ${best.stat} ${best.value}${
          best.margin != null ? ` (margen ${best.margin >= 0 ? "+" : ""}${best.margin} sobre la mejor respuesta)` : ""
        }.`,
      };
    },

    chooseAttackerStat(ctx): Decision<CombatStatKey> {
      // Se recalcula sobre la carta ya fijada: el contexto solo trae esa carta como disponible.
      const best = bestAttack(ctx, bestCounter);
      return {
        value: best.stat, rng: ctx.rng,
        explanation: `Declara ${best.stat} ${best.value}, su mejor eje con esta carta.`,
      };
    },

    chooseDefenderCard(ctx): Decision<string> {
      const stat = forcedDefenderStat(ctx);
      const cards = byUid(ctx.available);
      const target = ctx.attackerValue;

      if (target == null) {
        // Sin saber contra qué compite, responde con su valor más alto en ese eje.
        const top = cards.reduce((a, b) => (valueOf(b, stat) > valueOf(a, stat) ? b : a));
        return { value: top.uid, rng: ctx.rng, explanation: `Responde con su ${stat} más alto (${valueOf(top, stat)}).` };
      }

      const winners = cards.filter((c) => valueOf(c, stat) > target);
      if (winners.length > 0) {
        // Gana con el margen más ajustado: guarda las cartas fuertes para turnos posteriores.
        const cheapest = winners.reduce((a, b) => (valueOf(b, stat) < valueOf(a, stat) ? b : a));
        return {
          value: cheapest.uid, rng: ctx.rng,
          explanation: `Gana con el margen justo: ${cheapest.playerName} ${stat} ${valueOf(cheapest, stat)} > ${target}.`,
        };
      }

      // No puede ganar: sacrifica lo que menos vale en ese eje.
      const sacrifice = cards.reduce((a, b) => (valueOf(b, stat) < valueOf(a, stat) ? b : a));
      return {
        value: sacrifice.uid, rng: ctx.rng,
        explanation: `No puede superar ${target}; sacrifica a ${sacrifice.playerName} (${stat} ${valueOf(sacrifice, stat)}).`,
      };
    },

    chooseDefenderStat(ctx): Decision<CombatStatKey> {
      const forced = forcedDefenderStat(ctx);
      return { value: forced, rng: ctx.rng, explanation: `La tabla obliga a responder con ${forced}.` };
    },
  };
}

/** Mejor pareja (carta, estadística) para atacar. Determinista: desempata por uid y por orden fijo. */
function bestAttack(
  ctx: DecisionContext,
  bestCounter: (ctx: DecisionContext, stat: CombatStatKey) => number | null,
): { card: DuelDeckCard; stat: CombatStatKey; value: number; margin: number | null } {
  const cards = byUid(ctx.available);
  const stats = ctx.legalStats.length ? ctx.legalStats : ALL_STATS;

  let best: { card: DuelDeckCard; stat: CombatStatKey; value: number; margin: number | null } | null = null;
  for (const card of cards) {
    for (const stat of stats) {
      const value = valueOf(card, stat);
      const counter = bestCounter(ctx, stat);
      const margin = counter == null ? null : value - counter;
      const score = margin ?? value;
      if (
        best === null ||
        score > (best.margin ?? best.value) ||
        // Desempate estable: mismo score ⇒ decide el valor, y después el uid.
        (score === (best.margin ?? best.value) &&
          (value > best.value || (value === best.value && card.uid.localeCompare(best.card.uid) < 0)))
      ) {
        best = { card, stat, value, margin };
      }
    }
  }
  return best!;
}

// ───────────────────────────── Escalera de dificultad (Fase 7 · OPD-42) ─────────────────────────────

/**
 * Perfil de cada nivel. Es LA definición de la dificultad: una única palanca, la fracción de
 * decisiones tomadas con heurística. Ningún nivel ve más, puntúa más ni juega con otras reglas.
 *
 * `NORMAL_HEURISTIC_RATE` está medido, no elegido a ojo: ver el informe de Fase 7 §11.
 */
export const NORMAL_HEURISTIC_RATE = 0.5;

/**
 * HARD no es 1: un bot 100 % heurístico es DETERMINISTA y, con mazos idénticos, juega siempre
 * exactamente la misma partida (medido: 2 partidas distintas en 200). Dejarle un 15 % de azar
 * conserva la variedad —196 partidas distintas en 200— sin quitarle la primera posición de la
 * escalera. Es también lo que impide que HARD sea un bot perfecto (Fase 7 §12).
 */
export const HARD_HEURISTIC_RATE = 0.85;

export const DIFFICULTY_PROFILE: Record<BotDifficulty, BotProfile> = {
  EASY: { heuristicRate: 0, perfectInformation: false },
  NORMAL: { heuristicRate: NORMAL_HEURISTIC_RATE, perfectInformation: false },
  // OPD-04 cerrada con evidencia: NINGÚN nivel ve las cartas no jugadas del rival. La información
  // oculta sí aporta (+11 puntos contra un jugador casual), pero NO hace falta para construir la
  // escalera —la tasa de heurística sola cubre de 15 % a 99 % de tasa de victoria— y un bot que ve
  // lo que el jugador no puede ver es indefendible ante ese jugador.
  HARD: { heuristicRate: HARD_HEURISTIC_RATE, perfectInformation: false },
};

/**
 * BOT DE DIFICULTAD.
 *
 * Mezcla las dos estrategias existentes en la proporción que dicta el perfil, tirando del MISMO
 * generador determinista y serializable. No hay una tercera estrategia: no se duplica ni una línea
 * de heurística.
 *
 *   heuristicRate = 0 → exactamente el bot aleatorio (misma secuencia, mismo consumo de RNG)
 *   heuristicRate = 1 → exactamente el bot con heurística
 *   0 < rate < 1      → una tirada por decisión decide qué estrategia responde
 *
 * La tirada de mezcla se hace SOLO en los niveles intermedios, para que EASY y HARD conserven byte
 * a byte el comportamiento —y las repeticiones— de las estrategias puras.
 */
export function createDuelBot(
  id: string,
  difficulty: BotDifficulty,
  override: Partial<BotProfile> = {},
): DuelOpponent {
  const profile: BotProfile = { ...DIFFICULTY_PROFILE[difficulty], ...override };
  const rate = Math.max(0, Math.min(1, profile.heuristicRate));
  const random = createRandomBot(id, difficulty);
  const smart = createSmartBot(id, difficulty, profile.perfectInformation);

  if (rate <= 0) return { ...random, perfectInformation: profile.perfectInformation };
  if (rate >= 1) return smart;

  /** Tira el generador y dice qué estrategia responde a esta decisión. */
  const route = (rng: RngState): { heuristic: boolean; rng: RngState } => {
    const r = nextFloat(rng);
    return { heuristic: r.value < rate, rng: r.rng };
  };

  /** Aplica la estrategia elegida y deja el generador donde toca. */
  const mixed = <T>(
    ctx: DecisionContext,
    take: (bot: DuelOpponent, c: DecisionContext) => Decision<T>,
  ): Decision<T> => {
    const r = route(ctx.rng);
    const inner = { ...ctx, rng: r.rng };
    const d = take(r.heuristic ? smart : random, inner);
    return {
      value: d.value,
      rng: d.rng,
      explanation: `${r.heuristic ? "Heurística" : "Azar"} (${Math.round(rate * 100)} %): ${d.explanation}`,
    };
  };

  return {
    id, kind: "BOT", difficulty, perfectInformation: profile.perfectInformation,
    chooseAttackerCard: (ctx) => mixed(ctx, (b, c) => b.chooseAttackerCard(c)),
    chooseAttackerStat: (ctx) => mixed(ctx, (b, c) => b.chooseAttackerStat(c)),
    chooseDefenderCard: (ctx) => mixed(ctx, (b, c) => b.chooseDefenderCard(c)),
    // La estadística del defensor NO se elige: la impone la tabla. No hay nada que mezclar.
    chooseDefenderStat: (ctx) => random.chooseDefenderStat(ctx),
  };
}
