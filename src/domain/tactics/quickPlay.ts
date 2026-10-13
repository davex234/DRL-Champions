/**
 * FASE 51.3 · JUGAR ES INMEDIATO — reglas puras del inicio rápido del Tactical Coach.
 *
 *   JUGAR → composición → JUGAR PARTIDA → (revelación del mapa) → partido.
 *
 * Lo ÚNICO que hace falta para jugar es una composición jugable (5 agentes reales, mapa del catálogo).
 * Plantilla, estrategias, plan de partido y pre-partido son PREPARACIÓN OPCIONAL: ninguno bloquea.
 *
 *   · MAPA: las composiciones del dominio son POR MAPA (`mapId` obligatorio, 0054). El mapa de la
 *     partida se resuelve solo: es el de la composición elegida. Una composición NUEVA creada desde
 *     JUGAR recibe un mapa del catálogo al azar (los 12 canónicos), que se puede cambiar si se quiere.
 *   · EQUIPO: con una plantilla válida se juega con ella (sus cartas y sus stats, como siempre). Sin
 *     plantilla —o incompleta— se juega con el equipo por defecto (`buildDefaultHomeRoster`: jugadores
 *     reales, mismo generador que el rival). Nunca se pide completar la plantilla.
 *   · RIVAL: dificultad por defecto «normal» (el default existente de `MatchSetup`); se cambia en opciones.
 */
import { isComplete, legacyAgentIds, type Composition } from "./composition";
import { isMatchMapId, matchMaps } from "./matchMap";

export type Difficulty = "easy" | "normal" | "hard";
export const DEFAULT_DIFFICULTY: Difficulty = "normal";
export const DIFFICULTIES: readonly Difficulty[] = ["easy", "normal", "hard"];

export const isDifficulty = (v: unknown): v is Difficulty => typeof v === "string" && (DIFFICULTIES as readonly string[]).includes(v);

/** ¿Se puede jugar con esta composición? 5 agentes reales (ninguno del modelo anterior) y mapa del catálogo. */
export function isPlayableComposition(c: Pick<Composition, "agentIds" | "mapId">): boolean {
  return isComplete(c) && legacyAgentIds(c.agentIds).length === 0 && isMatchMapId(c.mapId);
}

/** Las composiciones jugables, primero la principal y después la más reciente. */
export function playableCompositions<T extends Pick<Composition, "agentIds" | "mapId" | "updatedAt"> & { primary?: boolean }>(list: readonly T[]): T[] {
  return list.filter(isPlayableComposition).sort((a, b) => Number(!!b.primary) - Number(!!a.primary) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

/**
 * El enlace que INICIA la partida: mapa de la composición, la composición y la dificultad. `auto=1`
 * = sin pre-partido: revelación del mapa y a jugar. Composición no jugable → null (no se lanza).
 */
export function quickPlayHref(c: Pick<Composition, "id" | "agentIds" | "mapId">, difficulty: Difficulty = DEFAULT_DIFFICULTY): string | null {
  if (!isPlayableComposition(c) || !isDifficulty(difficulty)) return null;
  const q = new URLSearchParams({ map: c.mapId, comp: c.id, auto: "1", dif: difficulty });
  return `/entrenador/partido?${q.toString()}`;
}

/** Mapa para una composición NUEVA creada desde JUGAR: uno de los 12 canónicos, al azar. `r` ∈ [0, 1). */
export function pickMapForNewComposition(r: number): string {
  const maps = matchMaps();
  const i = Math.min(maps.length - 1, Math.max(0, Math.floor(r * maps.length)));
  return maps[i].id;
}

/** Con qué equipo se juega: la plantilla si es válida; si no, el equipo por defecto. Nunca bloquea. */
export function homeSquadSource(teamValid: boolean): "team" | "default" {
  return teamValid ? "team" : "default";
}

/* ═══════════════════ FASE 51.3.1 · JUGAR NO ES UN EDITOR ═══════════════════ */

/**
 * QUÉ SE ENSEÑA EN JUGAR. Tres estados que NO son el mismo y antes se mezclaban: mientras se leen
 * las composiciones no se enseña nada que haya que decidir; si la lectura FALLA se dice y se ofrece
 * reintentar —nunca «crea tu primera», que confunde un error con no tener ninguna—; y solo con la
 * respuesta en la mano se elige entre el selector y el creador rápido.
 */
export type QuickPlayScreen = "loading" | "error" | "create" | "choose";

export function quickPlayScreen(s: { loading: boolean; error: boolean; playable: number }): QuickPlayScreen {
  if (s.error) return "error";
  if (s.loading) return "loading";
  return s.playable > 0 ? "choose" : "create";
}

/**
 * Qué decirle al jugador cuando la lectura falla. Un 401 aquí NO es «no tienes cuenta» (la pantalla
 * ya exige sesión antes de leer): es que el servidor no ha podido verificarla —con Supabase caído,
 * `getSession` falla cerrado y responde 401—. Se dice eso, que es lo que pasa.
 */
export function compositionsErrorText(status: number | null): string {
  if (status === 401 || status === 403) return "No hemos podido verificar tu sesión. Vuelve a intentarlo o entra de nuevo.";
  return "No hemos podido cargar tus composiciones.";
}

/**
 * NOMBRE AUTOMÁTICO: desde JUGAR no se escribe nada. Se renombra luego en COMPOSICIONES, que es la
 * herramienta completa. El sufijo evita dos con el mismo nombre sin preguntar nada.
 */
export function autoCompositionName(existing: readonly string[]): string {
  const base = "Composición rápida";
  const usados = new Set(existing.map((n) => n.trim().toLowerCase()));
  if (!usados.has(base.toLowerCase())) return base;
  for (let i = 2; i < 999; i++) {
    const n = `${base} ${i}`;
    if (!usados.has(n.toLowerCase())) return n;
  }
  return `${base} ${Date.now()}`;
}
