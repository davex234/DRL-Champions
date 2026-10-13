/**
 * PARTIDOS DIRIGIDOS — registrar uno terminado y leer el historial.
 *
 * ────────────────────────── LA PUERTA ──────────────────────────
 *
 * Todo lo que llega del navegador se comprueba aquí antes de tocar la base de datos, campo a
 * campo. No porque se espere un cliente malicioso —el simulador del Entrenador corre en el
 * navegador y quien quiera mentir sobre su propio historial personal puede hacerlo— sino
 * porque una fila con un marcador de 900 o un nombre de rival de diez mil caracteres es basura
 * que luego hay que pintar, y la base de datos no debería tener que defenderse sola.
 *
 * El `user_id` NO se acepta del cuerpo en ningún caso: sale del token. Es la diferencia entre
 * un historial y un tablón público donde cualquiera escribe a nombre de otro.
 *
 * ────────────────────────── LA IDEMPOTENCIA ──────────────────────────
 *
 * `seed` es la semilla maestra del partido: se genera una vez al empezar y hace la simulación
 * reproducible, así que identifica ESE partido. `(user_id, seed)` es único en la tabla, y aquí
 * el conflicto NO es un error: es la respuesta correcta a «esto ya estaba guardado».
 *
 * Recargar la pantalla final vuelve a intentar el registro y no pasa nada. Es lo que se quiere:
 * el cliente no tiene que acordarse de si ya guardó, porque el dato que lo identifica ya
 * existía antes de guardarlo.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMatchMapId } from "@/domain/tactics/matchMap";
import { DEFAULT_WIN } from "@/match/config";

/** Lo que el cliente puede contar de un partido terminado. Nada más entra. */
export interface CoachMatchInput {
  seed: number;
  teamName: string;
  rivalName: string;
  difficulty: string;
  mapId: string;
  mapSite?: string | null;
  startSide: string;
  scoreHome: number;
  scoreAway: number;
  rounds: number;
  durationSeconds?: number | null;
  mvp?: string | null;
}

/** Lo que sale hacia la pantalla. Mismos datos, en el idioma del cliente. */
export interface CoachMatchRow {
  id: string;
  seed: number;
  teamName: string;
  rivalName: string;
  difficulty: string;
  mapId: string;
  mapSite: string | null;
  startSide: "ATK" | "DEF";
  scoreHome: number;
  scoreAway: number;
  won: boolean;
  rounds: number;
  durationSeconds: number | null;
  mvp: string | null;
  finishedAt: string;
}

const DIFICULTADES = ["easy", "normal", "hard"] as const;
const LADOS = ["ATK", "DEF"] as const;

/** Texto acotado. Recorta en vez de rechazar: un nombre largo no invalida un partido. */
const texto = (v: unknown, max: number): string =>
  (typeof v === "string" ? v : "").trim().slice(0, max);

/**
 * Entero dentro de un rango, o `null`.
 *
 * EXIGE que ya sea entero: no trunca. Truncar parecía inofensivo hasta que se aplicó a la
 * semilla, que es la clave de idempotencia del partido — con `Math.trunc`, un `1.5` y un `1.9`
 * habrían acabado siendo el MISMO partido. Y en el marcador, redondear 13,7 a 13 es inventarse
 * un resultado en silencio. Un número que no es entero no es un dato de este historial.
 */
const entero = (v: unknown, min: number, max: number): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null;

export type Validacion =
  | { ok: true; value: CoachMatchInput }
  | { ok: false; error: string };

/**
 * ¿Es esto un partido terminado que se pueda guardar?
 *
 * Se rechaza —no se corrige— lo que define el partido: la semilla, el marcador, el lado y el
 * mapa. Corregir un marcador imposible sería inventar un resultado. Lo que sí se acota es el
 * texto de apoyo, que no cambia lo que pasó.
 */
export function validarPartido(raw: unknown): Validacion {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Cuerpo vacío" };
  const r = raw as Record<string, unknown>;

  const seed = entero(r.seed, 0, 4294967295);
  if (seed === null) return { ok: false, error: "Semilla no válida" };

  const scoreHome = entero(r.scoreHome, 0, 99);
  const scoreAway = entero(r.scoreAway, 0, 99);
  if (scoreHome === null || scoreAway === null) return { ok: false, error: "Marcador no válido" };

  const rounds = entero(r.rounds, 0, 99);
  if (rounds === null) return { ok: false, error: "Número de rondas no válido" };
  /*
   * Las rondas SON el marcador sumado. En el motor cada ronda termina con un ganador
   * (`settleRound` suma exactamente un punto), así que un 13-9 son 22 rondas: ni 5, que no
   * caben, ni 30, que serían ocho rondas sin dueño inventadas. Es la coherencia interna que se
   * puede comprobar sin volver a simular, y atrapa un cuerpo escrito a mano sin esfuerzo.
   */
  if (rounds !== scoreHome + scoreAway) {
    return { ok: false, error: "El marcador no cuadra con las rondas jugadas" };
  }
  /*
   * Un partido TERMINADO tiene ganador. Con las reglas del motor (a 13, diferencia 1, tope de
   * 25 rondas) el empate no puede darse; si llegara uno, guardarlo con `won = false` convertiría
   * unas tablas en una derrota que no ocurrió.
   */
  if (scoreHome === scoreAway) {
    return { ok: false, error: "Un partido terminado no acaba en empate" };
  }
  /*
   * FULL GAME AUDIT (2026-10-07) · un marcador FINAL que el motor puede producir: el ganador acaba EXACTAMENTE en
   * `firstTo` (13) y el perdedor por debajo (a 13 con diferencia 1, sin prórroga: 13-0 … 13-12, como mucho 25 rondas).
   * Antes bastaba con 0..99 y sin empate: un 2-1 o un 99-0 escritos a mano contaban como partidos jugados en la trayectoria.
   */
  if (Math.max(scoreHome, scoreAway) !== DEFAULT_WIN.firstTo || Math.min(scoreHome, scoreAway) > DEFAULT_WIN.firstTo - DEFAULT_WIN.winBy) {
    return { ok: false, error: "Ese marcador no puede ser el final de un partido" };
  }

  const startSide = texto(r.startSide, 8).toUpperCase();
  if (!(LADOS as readonly string[]).includes(startSide)) {
    return { ok: false, error: "Lado inicial no válido" };
  }

  const difficulty = texto(r.difficulty, 10).toLowerCase();
  if (!(DIFICULTADES as readonly string[]).includes(difficulty)) {
    return { ok: false, error: "Dificultad no válida" };
  }

  const mapId = texto(r.mapId, 40);
  if (!mapId) return { ok: false, error: "Falta el mapa" };
  // FASE 51.1 · solo mapas del catálogo canónico del Tactical Coach: ni genéricos ni inventados.
  if (!isMatchMapId(mapId)) return { ok: false, error: "Mapa no válido" };

  const teamName = texto(r.teamName, 60) || "Mi equipo";
  const rivalName = texto(r.rivalName, 60) || "Rival";

  return {
    ok: true,
    value: {
      seed, teamName, rivalName, difficulty, mapId,
      mapSite: texto(r.mapSite, 8) || null,
      startSide, scoreHome, scoreAway, rounds,
      durationSeconds: entero(r.durationSeconds, 0, 86400),
      mvp: texto(r.mvp, 60) || null,
    },
  };
}

const aFila = (r: Record<string, unknown>): CoachMatchRow => ({
  id: String(r.id),
  seed: Number(r.seed),
  teamName: String(r.team_name ?? ""),
  rivalName: String(r.rival_name ?? ""),
  difficulty: String(r.difficulty ?? "normal"),
  mapId: String(r.map_id ?? ""),
  mapSite: (r.map_site as string) ?? null,
  startSide: (r.start_side === "DEF" ? "DEF" : "ATK"),
  scoreHome: Number(r.score_home ?? 0),
  scoreAway: Number(r.score_away ?? 0),
  won: Boolean(r.won),
  rounds: Number(r.rounds ?? 0),
  durationSeconds: r.duration_s == null ? null : Number(r.duration_s),
  mvp: (r.mvp as string) ?? null,
  finishedAt: String(r.finished_at ?? ""),
});

/**
 * Registra un partido terminado. Devuelve si fue nuevo o si ya estaba.
 *
 * `duplicado: true` NO es un fallo. Es el caso normal de recargar la pantalla final, y el
 * llamante no tiene que distinguirlo para nada salvo para no volver a celebrarlo.
 */
export async function registrarPartido(
  sb: SupabaseClient, userId: string, input: CoachMatchInput,
): Promise<{ ok: true; row: CoachMatchRow; duplicado: boolean } | { ok: false; error: string }> {
  const fila = {
    user_id: userId,
    seed: input.seed,
    team_name: input.teamName,
    rival_name: input.rivalName,
    difficulty: input.difficulty,
    map_id: input.mapId,
    map_site: input.mapSite,
    start_side: input.startSide,
    score_home: input.scoreHome,
    score_away: input.scoreAway,
    // Derivado del marcador, no aceptado del cliente: un `won` que contradiga el resultado
    // convertiría el historial en dos verdades distintas sobre el mismo partido.
    won: input.scoreHome > input.scoreAway,
    rounds: input.rounds,
    duration_s: input.durationSeconds,
    mvp: input.mvp,
  };

  const { data, error } = await sb.from("coach_matches").insert(fila).select("*").maybeSingle();
  if (!error && data) return { ok: true, row: aFila(data as Record<string, unknown>), duplicado: false };

  /*
   * 23505 = violación de unicidad, es decir, este partido YA estaba guardado. Se devuelve el
   * que hay: el llamante pidió «que este partido conste», y consta.
   */
  if (error?.code === "23505") {
    const { data: previo } = await sb.from("coach_matches").select("*")
      .eq("user_id", userId).eq("seed", input.seed).maybeSingle();
    if (previo) return { ok: true, row: aFila(previo as Record<string, unknown>), duplicado: true };
  }
  return { ok: false, error: error?.message ?? "No se pudo guardar el partido" };
}

/**
 * Una página del historial, del más reciente al más antiguo.
 *
 * `id` desempata el orden: dos partidos con el mismo `finished_at` saldrían en orden
 * arbitrario y, al pedir la página siguiente, uno podría repetirse y otro no aparecer nunca.
 *
 * LANZA si la base de datos falla. Devolver `[]` convertiría un error en «todavía no has
 * jugado», que es mentirle al jugador sobre su propio historial.
 */
export async function historial(
  sb: SupabaseClient, userId: string, limite = 30, desde = 0,
): Promise<CoachMatchRow[]> {
  const lim = Math.max(1, Math.min(100, Math.trunc(limite) || 30));
  const off = Math.max(0, Math.min(100_000, Math.trunc(desde) || 0));
  const { data, error } = await sb.from("coach_matches").select("*")
    .eq("user_id", userId)
    .order("finished_at", { ascending: false })
    .order("id", { ascending: false })
    .range(off, off + lim - 1);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(aFila);
}

/**
 * FASE 51 · UN PARTIDO CONCRETO, siempre de su dueño.
 *
 * El plan táctico buscaba su partida en las últimas sesenta del historial: una partida más antigua
 * «no existía», y una inexistente pintaba un plan vacío con el mapa en blanco. Esto la lee por id
 * Y por `user_id`: una ajena y una inexistente dan exactamente lo mismo, `null`, así que nadie
 * puede sondear ids de otros jugadores. LANZA si la base de datos falla (un fallo no es «no existe»).
 */
export async function partidoPorId(
  sb: SupabaseClient, userId: string, id: string,
): Promise<CoachMatchRow | null> {
  const { data, error } = await sb.from("coach_matches").select("*")
    .eq("user_id", userId).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? aFila(data as Record<string, unknown>) : null;
}

/** Lo único que el balance necesita saber de un partido. */
export type FilaBalance = Pick<CoachMatchRow, "won" | "scoreHome" | "scoreAway">;

/** El `max_rows` de PostgREST (`supabase/config.toml`): más no llega en una sola lectura. */
const PAGINA_BALANCE = 1000;

/**
 * El balance de TODOS los partidos del usuario, no de la página que se está pintando.
 *
 * Antes `trayectoria` se calculaba sobre las filas de `historial`, que llegan limitadas: con
 * veinte por página, «Dirigidos» no podía pasar de veinte aunque hubiera cien. Un total que se
 * queda en el tamaño de la página no es un total. Aquí se leen solo las tres columnas que el
 * balance usa, a páginas de `max_rows`, hasta agotarlas.
 */
export async function balance(sb: SupabaseClient, userId: string): Promise<Trayectoria> {
  const filas: FilaBalance[] = [];
  for (let desde = 0; ; desde += PAGINA_BALANCE) {
    const { data, error } = await sb.from("coach_matches").select("won, score_home, score_away")
      .eq("user_id", userId)
      .order("finished_at", { ascending: false })
      .order("id", { ascending: false })
      .range(desde, desde + PAGINA_BALANCE - 1);
    if (error) throw new Error(error.message);
    const lote = (data ?? []) as { won: boolean; score_home: number; score_away: number }[];
    for (const r of lote) {
      filas.push({ won: Boolean(r.won), scoreHome: Number(r.score_home), scoreAway: Number(r.score_away) });
    }
    if (lote.length < PAGINA_BALANCE) break;
  }
  return trayectoria(filas);
}

/**
 * LA TRAYECTORIA — el balance del entrenador, DERIVADO de los partidos.
 *
 * No es un contador aparte. No hay una columna `victorias` que alguien tenga que acordarse de
 * incrementar, ni un `useState` con la racha: todo sale de las mismas filas que se acaban de
 * leer. Un contador paralelo es una segunda verdad esperando a desincronizarse con la primera.
 */
export interface Trayectoria {
  jugados: number;
  ganados: number;
  perdidos: number;
  /** Rondas ganadas menos perdidas. Dice CÓMO se gana, no solo cuánto. */
  diferencialRondas: number;
  /** Racha actual: positiva si son victorias, negativa si son derrotas, 0 sin partidos. */
  racha: number;
}

export function trayectoria(rows: FilaBalance[]): Trayectoria {
  const ganados = rows.filter((r) => r.won).length;
  let racha = 0;
  // `rows` viene del más reciente al más antiguo, que es el orden en el que se cuenta una racha.
  for (const r of rows) {
    if (racha === 0) racha = r.won ? 1 : -1;
    else if (r.won && racha > 0) racha++;
    else if (!r.won && racha < 0) racha--;
    else break;
  }
  return {
    jugados: rows.length,
    ganados,
    perdidos: rows.length - ganados,
    diferencialRondas: rows.reduce((n, r) => n + (r.scoreHome - r.scoreAway), 0),
    racha,
  };
}
