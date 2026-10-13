/**
 * PREGUNTAS DE TORNEO: CAMPEÓN Y CLASIFICACIÓN (Fase 24.2).
 *
 * ────────────────────────── QUÉ AÑADE ──────────────────────────
 *
 * Hasta ahora todas las preguntas que nacían solas colgaban de UN partido (`match_winner`,
 * `match_score`). El esquema admitía `champion` y `advance` desde la 0012, pero solo el
 * seed de demo las creaba, con una lista de equipos escrita a mano.
 *
 * Este módulo es la mitad PURA de esas dos preguntas: convierte los partidos reales de un
 * torneo en una pregunta de campeón, y un resultado real en su respuesta correcta. No
 * habla con la base de datos; de eso se encarga `server/services/pickemLifecycle`.
 *
 * ────────────────────────── DECISIONES ──────────────────────────
 *
 * **1. Las opciones son los participantes REALES.** Salen de los equipos que aparecen en
 * los partidos del torneo —los dos lados de cada enfrentamiento con nombre—. No hay lista
 * de equipos escrita en el código, ni se inventa un participante que no juegue.
 *
 * **2. La clave de cada opción es el equipo, no su posición.** Un `slug` estable del nombre
 * («team-heretics»): una respuesta guardada sigue siendo válida aunque cambie la etiqueta,
 * y si el torneo incorpora un equipo nuevo antes del cierre, se AÑADE la opción sin tocar
 * las que ya tienen respuestas detrás.
 *
 * **3. La pregunta de campeón solo nace ANTES de que empiece el torneo.** Su cierre es el
 * primer partido. Crearla con el torneo en marcha regalaría puntos a quien mire el cuadro,
 * y crearla sin fecha de inicio sería una pregunta sin cierre. Si no se cumplen las dos
 * cosas, no se crea; nunca se crea a medias.
 *
 * **4. Se corrige contra la GRAN FINAL, y solo contra ella.** El campeón es quien gana el
 * partido cuya ronda dice «grand final» (o «final» a secas). Ni el último partido por
 * fecha ni el que más puntos vale: eso sería inferir el cuadro, y el brief lo prohíbe. Si
 * el torneo termina sin un partido así, la pregunta queda sin corregir y se documenta.
 *
 * **5. ADVANCE no se genera sola.** Para preguntar «¿quién avanza?» hay que saber cuántos
 * pasan de cada grupo y quién ha pasado. `standings.status` (`qualified`/`eliminated`)
 * existe en el esquema desde la 0003, pero el importador real no lo rellena (solo el
 * origen mock). Aquí queda el corrector —si un día una pregunta `advance` existe y hay
 * clasificados, se corrige— pero NO se inventa la pregunta.
 */
import { isPlaceholderTeamName, type MatchInput } from "./questions";

export interface TournamentQuestionSpec {
  kind: "champion" | "advance";
  prompt: string;
  options: { key: string; label: string }[];
  points: number;
  locksAt: string;
  orderIdx: number;
}

/** Puntos de la pregunta de campeón. Es configuración del servidor: el cliente lee `q.points`. */
export const CHAMPION_POINTS = 50;

/** Menos participantes que esto no es un torneo, es una final: ya la cubre `match_winner`. */
export const MIN_CHAMPION_PARTICIPANTS = 4;

/** Va antes que todas las de partido: es la predicción destacada del torneo. */
export const CHAMPION_ORDER_IDX = -1;

/** Estados de partido que significan que el torneo YA ha empezado. */
const STARTED_STATUSES = new Set(["live", "finished", "completed", "cancelled"]);

/**
 * Clave estable de un equipo a partir de su nombre. Sin tildes, en minúsculas, con guiones.
 * «Leviatán» → «leviatan»; «Team Heretics » → «team-heretics».
 */
export function teamOptionKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Los equipos que participan en el torneo, según sus partidos. Ordenados por nombre para
 * que dos pasadas den el mismo resultado y la rejilla no baile.
 */
export function eventParticipants(matches: MatchInput[]): { key: string; label: string }[] {
  const byKey = new Map<string, string>();
  for (const m of matches) {
    for (const name of [m.team_a, m.team_b]) {
      // Fase 24.6 · un hueco sin equipo (TBD) no puede ser campeón.
      if (isPlaceholderTeamName(name)) continue;
      const label = (name ?? "").trim();
      if (!label) continue;
      const key = teamOptionKey(label);
      if (key && !byKey.has(key)) byKey.set(key, label);
    }
  }
  return [...byKey.entries()]
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "es"));
}

/** Primer partido con fecha: es cuando empieza el torneo y cuando cierra la de campeón. */
export function tournamentStartsAt(matches: MatchInput[]): string | null {
  let best: number | null = null;
  for (const m of matches) {
    if (!m.start_time) continue;
    const t = new Date(m.start_time).getTime();
    if (!Number.isFinite(t)) continue;
    if (best === null || t < best) best = t;
  }
  return best === null ? null : new Date(best).toISOString();
}

/** ¿Ha empezado ya? Basta con que un partido esté en juego, terminado o con la hora pasada. */
export function hasTournamentStarted(matches: MatchInput[], now = Date.now()): boolean {
  for (const m of matches) {
    if (STARTED_STATUSES.has(m.status?.toLowerCase() ?? "")) return true;
    if (m.start_time && new Date(m.start_time).getTime() <= now) return true;
  }
  return false;
}

/**
 * La pregunta de campeón, o `null` si los datos no permiten hacerla bien.
 *
 * Las tres condiciones son las del encabezado: participantes suficientes, torneo sin
 * empezar y una fecha de inicio a la que anclar el cierre.
 */
export function buildChampionQuestion(
  matches: MatchInput[], now = Date.now(),
): TournamentQuestionSpec | null {
  const options = eventParticipants(matches);
  if (options.length < MIN_CHAMPION_PARTICIPANTS) return null;
  if (hasTournamentStarted(matches, now)) return null;
  const locksAt = tournamentStartsAt(matches);
  if (!locksAt) return null;
  return {
    kind: "champion",
    prompt: "¿Quién será campeón?",
    options,
    points: CHAMPION_POINTS,
    locksAt,
    orderIdx: CHAMPION_ORDER_IDX,
  };
}

/**
 * Une las opciones nuevas a las existentes SIN quitar ninguna: una opción con respuestas
 * detrás no desaparece aunque el origen deje de listar ese partido. Las etiquetas de las
 * que ya estaban se refrescan (rebranding), las claves nunca cambian.
 */
export function mergeOptions(
  prev: { key: string; label: string }[], next: { key: string; label: string }[],
): { key: string; label: string }[] {
  const out = prev.map((o) => ({ ...o }));
  const index = new Map(out.map((o) => [o.key, o]));
  for (const o of next) {
    const cur = index.get(o.key);
    if (cur) {
      cur.label = o.label;
    } else {
      const copy = { ...o };
      out.push(copy);
      index.set(o.key, copy);
    }
  }
  return out;
}

/**
 * ¿Es esta ronda la gran final?
 *
 * «Grand Final», «Gran Final», «Final» a secas. NO «Semifinal», «Lower Final», «Upper
 * Final» ni «Final de grupo»: contienen la palabra pero no deciden el torneo.
 */
export function isGrandFinal(round: string | null | undefined): boolean {
  if (!round) return false;
  const r = round.toLowerCase().replace(/\s+/g, " ").trim();
  if (r.includes("grand final") || r.includes("gran final")) return true;
  const tail = r.split(/[:·\-–—]/).pop()?.trim() ?? r;
  return tail === "final" || tail === "finals" || tail === "playoffs final";
}

/**
 * El campeón, o `null` mientras no se sepa.
 *
 * Solo se corrige contra un partido de gran final TERMINADO y con ganador que sea uno de
 * sus dos lados. Y solo si el ganador está entre las opciones ofrecidas: si no lo está
 * —un equipo que no aparecía en el cuadro al crear la pregunta— no se inventa un acierto
 * ni se cierra con una clave que nadie pudo elegir. Se deja pendiente, y se documenta.
 */
export function correctChampionOption(
  matches: MatchInput[], options: { key: string }[],
): string | null {
  const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
  for (const m of matches) {
    if (!isGrandFinal(m.round)) continue;
    const status = m.status?.toLowerCase() ?? "";
    if (status !== "finished" && status !== "completed") continue;
    const w = norm(m.winner_team);
    if (!w) continue;
    if (w !== norm(m.team_a) && w !== norm(m.team_b)) continue;
    const key = teamOptionKey(m.winner_team!);
    return options.some((o) => o.key === key) ? key : null;
  }
  return null;
}

/**
 * El clasificado de una pregunta `advance`, o `null`.
 *
 * `qualifiedKeys` son las claves de los equipos que el origen marca como clasificados
 * (`standings.status = 'qualified'`). La pregunta se corrige solo cuando EXACTAMENTE una
 * de sus opciones está clasificada: con dos clasificadas entre las opciones, la pregunta
 * estaba mal planteada y no se corrige sola.
 */
export function correctAdvanceOption(
  options: { key: string }[], qualifiedKeys: Iterable<string>,
): string | null {
  const q = new Set(qualifiedKeys);
  const hits = options.filter((o) => q.has(o.key));
  return hits.length === 1 ? hits[0].key : null;
}
