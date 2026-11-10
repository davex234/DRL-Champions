"use client";

/**
 * REGISTRAR UN PARTIDO TERMINADO — del `MatchState` al historial.
 *
 * ────────────────────────── QUÉ SE MANDA ──────────────────────────
 *
 * El RESUMEN, no el partido. `MatchState` lleva dentro las rondas completas, sus eventos, la
 * narrativa, la economía y la memoria táctica; mandar eso serían megas por partido para pintar
 * una fila que dice «ganaste 13-9 en Ascent». Aquí se extrae exactamente lo que el historial
 * enseña y nada más.
 *
 * ────────────────────────── EL MAPA, DICHO CON HONESTIDAD ──────────────────────────
 *
 * El simulador del Entrenador tiene UN mapa: `src/sim/map/ascentA.ts`, «Ascent, solo zona A».
 * Así que el partido se registra como Ascent · sitio A, que es donde de verdad se jugó. No se
 * inventa variedad guardando un mapa al azar, y no se omite el sitio para que parezca el mapa
 * entero. El día que el motor soporte más mapas, estas dos constantes saldrán de la
 * configuración del partido y el historial antiguo seguirá diciendo la verdad.
 */
import type { MatchState } from "@/match";
import { isMatchMapId } from "@/domain/tactics/matchMap";
import { getSupabase } from "@/lib/supabase/client";
import { ns } from "@/i18n/runtime";

const t = ns("match");

/**
 * Lo que el simulador cubre HOY. Son constantes y no una lectura de la configuración porque
 * la configuración no lo dice: el motor importa `ascentA` directamente.
 */
export const SIM_MAP_ID = "ascent";
export const SIM_MAP_SITE = "A";

export interface CoachMatchSummary {
  seed: number;
  teamName: string;
  rivalName: string;
  difficulty: string;
  mapId: string;
  mapSite: string;
  startSide: "ATK" | "DEF";
  scoreHome: number;
  scoreAway: number;
  rounds: number;
  durationSeconds: number | null;
  mvp: string | null;
}

/**
 * Extrae el resumen. PURO: no manda nada, no toca red y no depende de React.
 *
 * Separado del envío a propósito, para poder comprobar en una prueba que un `MatchState` se
 * traduce bien sin montar un servidor ni una sesión.
 */
export function resumirPartido(
  match: MatchState, difficulty: string,
): CoachMatchSummary {
  const nombres = match.config.teamNames ?? { home: t("Mi equipo"), away: "Rival" };
  return {
    seed: match.config.seed,
    teamName: nombres.home,
    rivalName: nombres.away,
    difficulty,
    /*
     * FASE 51.1 · el mapa canónico ELEGIDO para el partido (validado contra el catálogo). Un partido
     * lanzado sin él —configuración antigua— sigue registrándose como Ascent, que es lo que era.
     */
    mapId: isMatchMapId(match.config.mapId) ? match.config.mapId : SIM_MAP_ID,
    mapSite: SIM_MAP_SITE,
    /*
     * El lado INICIAL, no el actual. `currentHomeSide` cambia a mitad de partido, así que
     * leerlo al final habría guardado el segundo lado como si fuera el sorteado.
     */
    startSide: match.config.homeSetup.side === "DEF" ? "DEF" : "ATK",
    scoreHome: match.score.home,
    scoreAway: match.score.away,
    /*
     * Las rondas LIQUIDADAS, no el contador de ronda. `history` recibe una entrada por ronda
     * terminada, así que su longitud es por construcción la suma del marcador — que es
     * exactamente lo que el servidor exige.
     */
    rounds: match.history.length,
    durationSeconds: Number.isFinite(match.totalSeconds) ? Math.round(match.totalSeconds) : null,
    // El MVP solo cuenta si es del equipo dirigido: destacar al del rival en tu propio
    // historial es raro, y dejarlo sin equipo sería peor todavía.
    mvp: match.mvp && match.mvp.team === "home" ? match.mvp.name : null,
  };
}

/**
 * Qué pasó con el registro. Cuatro estados y no un booleano, porque la pantalla final dice
 * cosas distintas en cada uno: «consta», «ya constaba», «sin cuenta no se guarda» y «ha
 * fallado, reintentar». Colapsar los dos últimos en un `false` escondería al jugador que su
 * partido no se ha guardado por un fallo que se puede reintentar.
 */
export type EstadoRegistro = "guardado" | "ya-estaba" | "sin-sesion" | "error";

/**
 * Manda el resumen. No lanza nunca: que un registro no llegue no puede tumbar la ceremonia
 * final de un partido que el jugador acaba de terminar.
 *
 * No necesita saber si ya lo había mandado. La ruta es idempotente por la semilla del partido,
 * así que reintentar tras un error es siempre seguro.
 */
export async function registrarPartidoJugado(
  match: MatchState, difficulty: string,
): Promise<EstadoRegistro> {
  const sb = getSupabase();
  if (!sb) return "sin-sesion";
  try {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return "sin-sesion";

    const r = await fetch("/api/game/coach-matches", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ match: resumirPartido(match, difficulty) }),
      cache: "no-store",
    });
    if (r.status === 401) return "sin-sesion";
    if (!r.ok) return "error";
    const j = (await r.json()) as { duplicate?: boolean };
    return j.duplicate ? "ya-estaba" : "guardado";
  } catch {
    return "error";
  }
}

export interface CoachRecord {
  jugados: number;
  ganados: number;
  perdidos: number;
  diferencialRondas: number;
  racha: number;
}

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

/**
 * Una lectura del historial. Tres salidas y no `null`, por la misma razón que el registro:
 * «no tienes cuenta» y «ha fallado la red» no pueden pintarse igual. Antes los dos acababan en
 * «inicia sesión», que a un jugador CON sesión le decía algo falso.
 */
export type ConsultaHistorial =
  | { estado: "sin-sesion" }
  | { estado: "error" }
  | { estado: "ok"; matches: CoachMatchRow[]; record: CoachRecord; total: number };

/**
 * Una página del historial y el balance de TODOS los partidos (no solo los de la página).
 * `total` es el número de partidos del usuario, para saber si quedan más por cargar.
 */
export async function fetchPartidosJugados(
  limite = 30, desde = 0,
): Promise<ConsultaHistorial> {
  const sb = getSupabase();
  if (!sb) return { estado: "sin-sesion" };
  try {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return { estado: "sin-sesion" };
    const r = await fetch(`/api/game/coach-matches?limit=${limite}&offset=${desde}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
    });
    if (r.status === 401) return { estado: "sin-sesion" };
    if (!r.ok) return { estado: "error" };
    const j = (await r.json()) as { matches: CoachMatchRow[]; record: CoachRecord; total: number };
    return { estado: "ok", matches: j.matches, record: j.record, total: j.total };
  } catch {
    return { estado: "error" };
  }
}
