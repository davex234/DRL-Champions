/**
 * RECOMPENSA DE UN DUELO (Fase 10).
 *
 * ────────────────────────── QUÉ PROBLEMA RESUELVE ──────────────────────────
 *
 * Hasta la Fase 10, terminar un duelo no daba NADA. Ni créditos, ni XP, ni puntos. El
 * servicio de duelos (`server/services/duels.ts`) escribía el resultado y ahí acababa
 * todo. Y `profiles.points` —la columna de la que sale el rango, la escalera de ocho
 * escalones y la clasificación entera— solo la movía el corrector de Pick'ems.
 *
 * Es decir: **el modo propio del juego no tocaba la progresión competitiva.** El rango de
 * NEXUS era un ranking de pronosticadores, y la propia pantalla lo decía. Un jugador podía
 * ganar cincuenta duelos seguidos y seguir SIN CLASIFICAR.
 *
 * Este módulo es la tabla que convierte el resultado de una partida en una recompensa.
 *
 * ────────────────────────── LAS CUATRO DECISIONES ──────────────────────────
 *
 * **1. Es una TABLA, no una fórmula.** Nueve celdas (tres resultados × tres dificultades)
 * que se leen de un vistazo y se ajustan sin tocar código. Una fórmula con coeficientes
 * habría hecho imposible responder «¿cuánto da ganar en difícil?» sin ejecutarla.
 *
 * **2. Perder NO resta puntos.** Es la decisión que más se puede discutir y por eso se
 * escribe el motivo: `profiles.points` es una moneda COMPARTIDA —también la reparte el
 * corrector de Pick'ems— y restar ahí significaría que perder un duelo contra un bot borra
 * puntos ganados acertando predicciones. Eso es un cambio de balance competitivo, y el
 * encargo de la Fase 10 prohíbe expresamente improvisar cambios de reglas. Perder da
 * créditos y XP (has jugado), pero el RANGO solo sube ganando.
 *
 * Si algún día se quiere una escalera con descenso, se cambia `LOSS_SUBTRACTS` y la tabla;
 * `app_grant_reward` ya acepta puntos negativos y protege el suelo en cero.
 *
 * **3. La dificultad importa de verdad.** Ganar en difícil da casi el triple de puntos que
 * en fácil. Si las tres dificultades pagaran parecido, elegir «fácil» sería siempre la
 * jugada correcta y el selector de dificultad sería decorado.
 *
 * **4. Los números son pequeños a propósito.** Subir de Bronce a Plata cuesta 150 puntos:
 * unas once victorias en normal. Llegar a Oro (400), unas treinta. Es un goteo, no un
 * atajo — y sigue siendo mucho más lento que acertar un Pick'em completo, que es la vía
 * que exige acertar sobre partidos reales.
 *
 * ────────────────────────── LO QUE NO HACE ──────────────────────────
 *
 * Este módulo es PURO: no lee la base de datos, no concede nada y no sabe quién juega.
 * Devuelve un `Reward` —el mismo tipo que ya usan Pick'ems, pase y eventos— y quien lo
 * entrega es `app_grant_reward`, la única ruta. Aquí no hay una segunda economía.
 *
 * Tampoco decide quién gana: eso lo dice el Combat Resolver y llega ya resuelto.
 */
import type { Reward } from "@/domain/events/types";

/** Cómo acabó la partida para el jugador. Es lo que ya dice el resultado del duelo. */
export type DuelOutcome = "win" | "draw" | "loss";

/** Las tres dificultades del bot. Coincide con `BotDifficulty` de `lib/duel/types`. */
export type DuelDifficulty = "EASY" | "NORMAL" | "HARD";

/**
 * ¿Una derrota resta puntos competitivos?
 *
 * Hoy NO, y el motivo está arriba. Se deja como constante y no como número suelto dentro
 * de la tabla para que el día que se decida cambiarlo sea una decisión visible en el diff
 * y no un signo menos que alguien coló.
 */
export const LOSS_SUBTRACTS = false;

interface DuelPayout {
  /** Puntos competitivos: los que mueven el rango. */
  points: number;
  credits: number;
  /** XP de cuenta (el nivel del perfil), no XP del pase. */
  xp: number;
}

/**
 * LA TABLA. Tres resultados × tres dificultades.
 *
 * Se lee así: ganar en HARD da 22 puntos, 350 créditos y 180 XP.
 */
const PAYOUT: Record<DuelOutcome, Record<DuelDifficulty, DuelPayout>> = {
  win: {
    EASY:   { points: 8,  credits: 120, xp: 60 },
    NORMAL: { points: 14, credits: 220, xp: 110 },
    HARD:   { points: 22, credits: 350, xp: 180 },
  },
  draw: {
    EASY:   { points: 3, credits: 60,  xp: 30 },
    NORMAL: { points: 5, credits: 100, xp: 50 },
    HARD:   { points: 8, credits: 160, xp: 80 },
  },
  // Perder paga por haber jugado, pero no mueve el rango (ver decisión 2).
  loss: {
    EASY:   { points: 0, credits: 25, xp: 15 },
    NORMAL: { points: 0, credits: 40, xp: 25 },
    HARD:   { points: 0, credits: 60, xp: 40 },
  },
};

/**
 * Traduce el resultado que devuelve el motor —ganador y empate— al eje de esta tabla.
 *
 * Se acepta la forma exacta de `DuelMatchView.result` para que la llamada no tenga que
 * interpretar nada: interpretar el resultado en dos sitios distintos es la forma de que
 * acaben discrepando.
 */
export function outcomeOf(result: { winner: "YOU" | "RIVAL" | null; isDraw: boolean }): DuelOutcome {
  if (result.isDraw || result.winner === null) return "draw";
  return result.winner === "YOU" ? "win" : "loss";
}

/**
 * Recompensa de una partida terminada.
 *
 * Determinista: mismo resultado y misma dificultad, misma recompensa siempre. Eso es lo
 * que permite ENSEÑARLA en la pantalla de resultado sin guardarla en ninguna tabla —se
 * recalcula— y a la vez concederla una sola vez, porque quien la concede lo hace bajo una
 * clave de idempotencia por partida.
 */
export function duelReward(outcome: DuelOutcome, difficulty: DuelDifficulty): Reward {
  const p = PAYOUT[outcome]?.[difficulty] ?? PAYOUT.loss.EASY;
  return {
    credits: p.credits,
    xp: p.xp,
    // `Reward` no tiene campo de puntos competitivos —no es un recurso de inventario— y
    // por eso viajan aparte, en `duelPoints`. Meterlos aquí obligaría a que todo lo que
    // consume un `Reward` (pase, eventos, colecciones) supiera de puntos de rango.
  };
}

/** Puntos competitivos de una partida. Van aparte del `Reward` por lo dicho arriba. */
export function duelPoints(outcome: DuelOutcome, difficulty: DuelDifficulty): number {
  const p = PAYOUT[outcome]?.[difficulty] ?? PAYOUT.loss.EASY;
  return LOSS_SUBTRACTS && outcome === "loss" ? -p.points : p.points;
}

/**
 * Todo junto, que es como lo consumen el servicio (para conceder) y la pantalla de
 * resultado (para enseñar). Una sola función evita que las dos calculen por su cuenta.
 */
export interface DuelAward {
  outcome: DuelOutcome;
  difficulty: DuelDifficulty;
  reward: Reward;
  points: number;
}

export function duelAward(
  result: { winner: "YOU" | "RIVAL" | null; isDraw: boolean },
  difficulty: DuelDifficulty,
): DuelAward {
  const outcome = outcomeOf(result);
  return {
    outcome,
    difficulty,
    reward: duelReward(outcome, difficulty),
    points: duelPoints(outcome, difficulty),
  };
}

/** La tabla completa, para que la interfaz pueda explicar qué se gana antes de jugar. */
export function duelPayoutTable(): Record<DuelOutcome, Record<DuelDifficulty, DuelPayout>> {
  return PAYOUT;
}

// ───────────────────────────── El tope diario ─────────────────────────────

/**
 * PARTIDAS QUE PAGAN AL DÍA.
 *
 * ¿Por qué existe? Porque conectar el duelo a la economía abre una vía de inflación que
 * antes no existía: un duelo contra un bot se puede repetir sin límite y ahora paga. Sin
 * tope, alguien que juegue cien partidas en una tarde se lleva ~22.000 créditos —dos
 * sobres Icon— y sube de rango a base de repetir, no de jugar mejor.
 *
 * Veinte partidas al día es holgado para cualquiera que esté jugando de verdad (son unas
 * dos horas) y corta la granja en seco. No prohíbe jugar más: **jugar sigue funcionando
 * igual**, lo que se agota es el pago. Un duelo por encima del tope se juega, se guarda,
 * cuenta para las misiones y aparece en el historial; simplemente no paga otra vez.
 *
 * Se cuenta por partidas PAGADAS en el día, no por partidas jugadas: así abandonar no
 * consume tope y un fallo de red que impida el pago no le quita a nadie su cupo.
 */
export const DAILY_DUEL_AWARD_CAP = 20;

/**
 * Aplica el tope a una recompensa.
 *
 * Devuelve la recompensa vacía cuando el cupo está agotado, y la marca. Vaciarla en vez
 * de no llamar al pago es deliberado: el asiento se escribe igual, así que la partida
 * queda registrada como «ya liquidada» y un reintento no puede colarse cuando el cupo se
 * renueve al día siguiente.
 */
export function capDuelAward(a: DuelAward, paidToday: number): DuelAward & { capped: boolean } {
  if (paidToday < DAILY_DUEL_AWARD_CAP) return { ...a, capped: false };
  return { ...a, reward: {}, points: 0, capped: true };
}
