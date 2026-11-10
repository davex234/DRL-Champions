import { ns, td } from "@/i18n/runtime";

const t = ns("pickems");

/**
 * PREGUNTAS DE PICK'EM A PARTIR DE PARTIDOS REALES (Fase 10).
 *
 * ────────────────────────── EL ESLABÓN QUE FALTABA ──────────────────────────
 *
 * La auditoría de la Fase 10 encontró la cadena del ciclo de juego rota **por el medio**:
 *
 *   · La sincronización competitiva (`lib/esports/sync`) trae torneos, partidos,
 *     resultados y estadísticas de VLR. Funciona y es idempotente.
 *   · El corrector de Pick'ems (`app_score_pickem_event`) reparte puntos y recompensas.
 *     Funciona, es idempotente y está probado.
 *   · Entre los dos: **nada**. Las preguntas de Pick'em solo las creaba
 *     `scripts/seed-demo.ts`, y `scorePickemEvent` solo lo llamaban tres scripts de
 *     prueba. En producción, un torneo real entraba, se jugaba, terminaba… y ninguna
 *     predicción se abría ni se corregía jamás.
 *
 * Este módulo es la mitad PURA de ese eslabón: convierte partidos en preguntas y
 * resultados en respuestas correctas. No habla con la base de datos y no concede nada;
 * de eso se encarga `server/services/pickemLifecycle`.
 *
 * ────────────────────────── DECISIONES ──────────────────────────
 *
 * **1. Las opciones son «a» y «b», no los nombres de los equipos.** Un nombre de equipo
 * cambia (rebrandings, correcciones del origen) y una respuesta guardada apuntando a
 * «Team Heretics» quedaría huérfana. La clave es el LADO del partido, que no cambia; la
 * etiqueta es el nombre, y se refresca sin invalidar nada.
 *
 * **2. Una pregunta cierra cuando empieza SU partido**, no cuando cierra el torneo. Ya lo
 * permitía el esquema (`pickem_questions.locks_at` es por pregunta) y no se estaba usando:
 * es lo que permite predecir la final cuando ya se han jugado los cuartos.
 *
 * **3. Los puntos dependen de la ronda.** Acertar una final vale más que acertar un
 * partido de fase de grupos. Es una tabla de patrones, no una cadena de `if`: una ronda
 * que no reconozcamos cae en el valor por defecto en vez de romper nada.
 *
 * **4. Solo se generan preguntas de partidos que aún no han empezado.** Abrir una
 * predicción sobre un partido ya jugado sería regalar puntos a quien mire el resultado.
 */

/** Un partido tal y como lo guarda `public.matches`. Solo lo que hace falta aquí. */
export interface MatchInput {
  id: string;
  team_a: string | null;
  team_b: string | null;
  start_time: string | null;
  status: string;
  winner_team: string | null;
  round: string | null;
  match_order: number | null;
  /** Marcador final. Solo lo usan las preguntas de RESULTADO EXACTO (Fase 13). */
  score_a?: number | null;
  score_b?: number | null;
}

/**
 * Los cuatro tipos que admite `pickem_questions.kind` (CHECK de la 0023). Los dos de
 * partido se generan aquí; `champion` y `advance` viven en `./tournament` (Fase 24.2)
 * porque no cuelgan de un partido sino del torneo entero.
 */
export type QuestionKind = "match_winner" | "match_score" | "champion" | "advance";

/** Una pregunta lista para escribirse en `pickem_questions`. */
export interface QuestionSpec {
  kind: QuestionKind;
  matchId: string;
  prompt: string;
  options: { key: string; label: string }[];
  points: number;
  locksAt: string;
  orderIdx: number;
}

/**
 * Puntos por ronda. Se compara en minúsculas y por INCLUSIÓN, para que aguante las
 * variaciones del origen («Grand Final», «grand-final», «Final»).
 *
 * El orden importa: se devuelve la PRIMERA coincidencia, así que los patrones más
 * específicos van antes. «semifinal» contiene «final», y por eso va primero.
 */
const POINTS_BY_ROUND: { pattern: string; points: number }[] = [
  { pattern: "grand final", points: 30 },
  { pattern: "gran final", points: 30 },
  { pattern: "semifinal", points: 20 },
  { pattern: "semi", points: 20 },
  { pattern: "cuartos", points: 15 },
  { pattern: "quarterfinal", points: 15 },
  { pattern: "playoff", points: 15 },
  { pattern: "final", points: 25 },
  { pattern: "upper", points: 15 },
  { pattern: "lower", points: 15 },
  { pattern: "group", points: 10 },
  { pattern: "grupo", points: 10 },
];

/** Puntos de un partido cuya ronda no reconocemos —o que no la declara—. */
export const DEFAULT_QUESTION_POINTS = 10;

export function pointsForRound(round: string | null | undefined): number {
  if (!round) return DEFAULT_QUESTION_POINTS;
  const r = round.toLowerCase();
  for (const { pattern, points } of POINTS_BY_ROUND) {
    if (r.includes(pattern)) return points;
  }
  return DEFAULT_QUESTION_POINTS;
}

/** Estados en los que un partido ya no admite predicción. */
const CLOSED_STATUSES = new Set(["live", "finished", "completed", "cancelled"]);

/**
 * ¿Se puede abrir una predicción sobre este partido?
 *
 * Hacen falta las dos cosas: dos equipos con nombre (un partido con el rival por
 * determinar no se puede predecir) y una hora de inicio (sin ella no hay cierre, y una
 * pregunta sin cierre es una pregunta que se puede responder sabiendo el resultado).
 */
/**
 * Fase 24.6 · un hueco sin equipo (TBD/TBA/TBC) NO es un equipo. El conector VLR los deja pasar
 * como nombre porque aparecen en las tarjetas de partido, y con el sync automático abriendo
 * preguntas sin nadie delante, «¿Quién gana TBD vs TBD?» habría nacido sola. Aquí se corta.
 */
export function isPlaceholderTeamName(name: string | null | undefined): boolean {
  const n = (name ?? "").trim().toLowerCase();
  return n === "" || n === "tbd" || n === "tba" || n === "tbc" || n === "?" || n === "—";
}

export function isPredictable(m: MatchInput, now = Date.now()): boolean {
  if (!m.team_a || !m.team_b) return false;
  if (isPlaceholderTeamName(m.team_a) || isPlaceholderTeamName(m.team_b)) return false;
  if (!m.start_time) return false;
  if (CLOSED_STATUSES.has(m.status?.toLowerCase() ?? "")) return false;
  return new Date(m.start_time).getTime() > now;
}

/**
 * Preguntas para los partidos que todavía se pueden predecir.
 *
 * Se ordenan por hora de inicio: es el orden en el que se van a jugar y, por tanto, el
 * orden en el que se van cerrando. Una lista ordenada por otra cosa obliga al jugador a
 * buscar cuál cierra antes.
 */
export function buildMatchQuestions(matches: MatchInput[], now = Date.now()): QuestionSpec[] {
  return matches
    .filter((m) => isPredictable(m, now))
    .sort((a, b) => new Date(a.start_time!).getTime() - new Date(b.start_time!).getTime())
    .map((m, i) => ({
      kind: "match_winner" as const,
      matchId: m.id,
      prompt: t("¿Quién gana {team_a} vs {team_b}?", { team_a: td(m.team_a), team_b: td(m.team_b) }),
      options: [
        { key: "a", label: m.team_a! },
        { key: "b", label: m.team_b! },
      ],
      points: pointsForRound(m.round),
      locksAt: m.start_time!,
      orderIdx: m.match_order ?? i,
    }));
}

// ───────────────────────── Resultado exacto (Fase 13) ─────────────────────────

/**
 * DESAFÍOS POR PARTIDO: acertar el MARCADOR, no solo el ganador.
 *
 * ────────────────────────── POR QUÉ ESTE Y NO OTRO ──────────────────────────
 *
 * El encargo proponía cinco: ganador, mapa, jugador destacado, diferencia y resultado
 * exacto. Solo **dos** se pueden resolver con los datos que hay:
 *
 *   · GANADOR    ya existía (`match_winner`).
 *   · RESULTADO  `matches.score_a` y `score_b` están rellenos en los partidos terminados
 *                (comprobado: 2 de 2 terminados traen marcador). Este es el que se añade.
 *
 * Los otros tres NO se implementan, y el motivo es que no hay dato con el que corregirlos:
 * `public.matches` no guarda mapa ni MVP, y `player_stats` solo se llena si el importador
 * de estadísticas ha pasado por ese partido. Una pregunta que no se puede corregir es una
 * pregunta que nadie cobra, así que se documenta en vez de fingirse.
 *
 * ────────────────────────── NO ES UN SEGUNDO PICK'EM ──────────────────────────
 *
 * Es un `kind` más de la MISMA tabla, el MISMO ciclo de vida y el MISMO corrector. Cierra
 * cuando empieza el partido, como las demás, y se corrige en la misma pasada.
 */

/** Formatos de marcador que se ofrecen. Al mejor de tres, que es el estándar del circuito. */
const SCORE_LINES: { a: number; b: number }[] = [
  { a: 2, b: 0 }, { a: 2, b: 1 }, { a: 1, b: 2 }, { a: 0, b: 2 },
];

/**
 * Un marcador exacto vale el DOBLE que el ganador de ese mismo partido.
 *
 * No es una cifra elegida al azar: con cuatro opciones frente a dos, acertar a ciegas pasa
 * del 50 % al 25 %. Pagar el doble por la mitad de probabilidad deja el valor esperado de
 * adivinar exactamente igual que antes, así que la pregunta nueva premia SABER y no
 * aumenta lo que se lleva quien va al azar.
 */
export const SCORE_POINTS_MULTIPLIER = 2;

export const scoreOptionKey = (a: number, b: number): string => `${a}-${b}`;

/**
 * Preguntas de resultado exacto. Se generan para los mismos partidos que las de ganador,
 * así que un partido predecible trae dos preguntas: quién gana y cómo.
 */
export function buildScoreQuestions(matches: MatchInput[], now = Date.now()): QuestionSpec[] {
  return matches
    .filter((m) => isPredictable(m, now))
    .sort((a, b) => new Date(a.start_time!).getTime() - new Date(b.start_time!).getTime())
    .map((m, i) => ({
      kind: "match_score" as const,
      matchId: m.id,
      prompt: t("¿Con qué resultado gana {team_a} o {team_b}?", { team_a: td(m.team_a), team_b: td(m.team_b) }),
      options: SCORE_LINES.map((s) => ({
        key: scoreOptionKey(s.a, s.b),
        label: `${m.team_a} ${s.a}-${s.b} ${m.team_b}`,
      })),
      points: pointsForRound(m.round) * SCORE_POINTS_MULTIPLIER,
      locksAt: m.start_time!,
      /*
       * Van DESPUÉS de todas las de ganador. El desplazamiento es grande a propósito: si
       * se intercalaran, la lista alternaría «quién gana / con qué resultado» y el jugador
       * tendría que leer dos veces para saber qué le están preguntando.
       */
      orderIdx: 1000 + (m.match_order ?? i),
    }));
}

/**
 * ¿Qué marcador salió?
 *
 * `null` mientras no haya los DOS marcadores. Un partido con `score_a` y sin `score_b` es
 * un dato a medias del origen, y a medias no se corrige nada.
 */
export function correctScoreOptionFor(m: MatchInput): string | null {
  const a = m.score_a, b = m.score_b;
  if (typeof a !== "number" || typeof b !== "number") return null;
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < 0) return null;
  const key = scoreOptionKey(a, b);
  // Un marcador fuera de las líneas ofrecidas (un 3-1 de una final al mejor de cinco) no
  // puede corregirse contra opciones que no existían: nadie lo eligió, y nadie lo cobra.
  return SCORE_LINES.some((s) => scoreOptionKey(s.a, s.b) === key) ? key : null;
}

// ───────────────────── Clasificación confirmada (Fase 24.4) ─────────────────────

/** Lo que una pregunta de clasificación necesita saber del partido: solo estructura CONFIRMADA. */
export interface QualificationMatchInput extends MatchInput {
  winner_qualifies?: string | null;
  winner_qualifies_label?: string | null;
  progression_confidence?: string | null;
}

/**
 * PREGUNTAS «¿QUIÉN SE CLASIFICA?» (kind `advance`), una por partido cuya estructura
 * CONFIRMADA dice que su ganador se clasifica (`winner_qualifies`, migración 0045).
 *
 * La semántica es inequívoca por construcción: el que se clasifica es el ganador REAL del
 * partido, así que las opciones son sus dos equipos (lados «a»/«b», como en `match_winner`),
 * el cierre es el inicio del partido y el corrector es el mismo que el del ganador. No se
 * genera para ningún otro partido, y nunca con estructura INFERRED o desconocida.
 *
 * Idempotente por el índice único (pickem_event_id, match_id, kind) de la 0023.
 */
export function buildQualificationQuestions(matches: QualificationMatchInput[], now = Date.now()): QuestionSpec[] {
  return matches
    .filter((m) => !!m.winner_qualifies && m.progression_confidence === "CONFIRMED")
    .filter((m) => isPredictable(m, now))
    .sort((a, b) => new Date(a.start_time!).getTime() - new Date(b.start_time!).getTime())
    .map((m, i) => ({
      kind: "advance" as const,
      matchId: m.id,
      prompt: t("¿Quién se clasifica? {team_a} vs {team_b}", { team_a: td(m.team_a), team_b: td(m.team_b) }),
      options: [
        { key: "a", label: m.team_a! },
        { key: "b", label: m.team_b! },
      ],
      points: pointsForRound(m.round),
      locksAt: m.start_time!,
      // Después de las de ganador y antes de las de resultado: es la que más se parece a un hito.
      orderIdx: 500 + (m.match_order ?? i),
    }));
}

/**
 * La opción correcta de CUALQUIER pregunta, según su tipo.
 *
 * Existe para que el corrector no tenga que saber de tipos: le pasa el `kind` que leyó de
 * la fila y recibe la respuesta. Añadir un tipo nuevo es añadir un caso aquí, no tocar el
 * ciclo de vida.
 */
export function correctOptionForKind(kind: string, m: MatchInput): string | null {
  // `advance` con partido (24.4): se clasifica el ganador real del partido → mismo corrector.
  return kind === "match_score" ? correctScoreOptionFor(m) : correctOptionFor(m);
}

/**
 * ¿Qué opción acertó?
 *
 * `null` significa «todavía no se sabe», y es distinto de «nadie acertó»: una pregunta sin
 * resultado no puntúa a nadie, y una con resultado puntúa a quien lo eligió. Confundir los
 * dos casos es la forma de corregir un torneo a medias.
 *
 * Se compara por NOMBRE porque es lo que `matches.winner_team` guarda. La comparación
 * ignora mayúsculas y espacios de sobra: los orígenes no son consistentes con eso y un
 * «Team Heretics » con espacio final no puede costarle los puntos a nadie.
 */
export function correctOptionFor(m: MatchInput): string | null {
  if (!m.winner_team) return null;
  const norm = (s: string | null) => (s ?? "").trim().toLowerCase();
  const w = norm(m.winner_team);
  if (!w) return null;
  if (w === norm(m.team_a)) return "a";
  if (w === norm(m.team_b)) return "b";
  // El ganador no coincide con ninguno de los dos lados: es un dato inconsistente del
  // origen. Se devuelve `null` —«todavía no se sabe»— en lugar de inventar un acierto.
  return null;
}

/** ¿Está este partido terminado y con ganador utilizable? */
export function isResolved(m: MatchInput): boolean {
  return correctOptionFor(m) !== null;
}
