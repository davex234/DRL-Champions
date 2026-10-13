/**
 * COMPOSICIONES POR MAPA — quién juega en este mapa, y en qué versión de la comp.
 *
 * ────────────────────────── QUÉ ES, Y QUÉ NO ES ──────────────────────────
 *
 * Una composición es la lista de CINCO agentes con la que el equipo juega un mapa concreto. Nada
 * más. No decide posiciones, no decide jugadas y no impone meta: un entrenador puede montar cinco
 * duelistas si quiere y el sistema no se lo discute (el encargo lo pide expresamente). Lo único que
 * se valida es lo que sería un error de DATOS, no de criterio:
 *
 *   · el mapa existe en el catálogo real;
 *   · los agentes existen en el catálogo del entrenador (`roster.ts`: el roster REAL del juego;
 *     los ids del modelo anterior se conservan como legado, no se ofrecen);
 *   · no se repite un agente dentro de la misma composición;
 *   · cinco huecos como mucho, y cinco para estar completa.
 *
 * Una composición INCOMPLETA es válida y se guarda: un entrenador empieza con dos agentes claros y
 * decide el resto más tarde. Lo que no se puede es llevarla a una partida sin cerrarla, y eso lo
 * dice `isComplete`, no un error.
 *
 * ────────────────────────── PURO ──────────────────────────
 *
 * Sin React, sin red, sin reloj y sin azar. El servidor lo usa para validar y el cliente para
 * enseñar el estado; una sola definición de «qué es legal», en un sitio.
 */
import { TACTICAL_MAPS } from "./maps";
import { getTacticalAgent, getLegacyAgent, isKnownAgentId, isSelectableAgentId, agentDisplayName, TACTICAL_ROLES, type TacticalRole } from "./roster";

export const COMPOSITION_SIZE = 5;
export const MAX_COMPOSITION_NAME = 60;
export const MAX_COMPOSITION_NOTES = 400;
/** Tope por mapa: suficiente para principal, anti-rush y un par de variantes. */
export const MAX_COMPOSITIONS_PER_MAP = 12;

export interface Composition {
  id: string;
  name: string;
  mapId: string;
  /** `agentId` canónicos del catálogo. Nunca nombres escritos a mano. */
  agentIds: string[];
  notes: string;
  /** La que se propone por defecto para este mapa. Como mucho una por mapa. */
  primary: boolean;
  updatedAt: string;
}

export type CompositionIssueCode =
  | "NAME_REQUIRED" | "NAME_TOO_LONG" | "NOTES_TOO_LONG"
  | "UNKNOWN_MAP" | "UNKNOWN_AGENT" | "DUPLICATE_AGENT" | "TOO_MANY_AGENTS"
  | "LEGACY_AGENT" | "INVALID_PAYLOAD";

export interface CompositionIssue { code: CompositionIssueCode; message: string; agentId?: string }

const MAP_IDS = new Set(TACTICAL_MAPS.map((m) => m.id));

/** ¿Está lista para llevarla a una partida? */
export const isComplete = (c: Pick<Composition, "agentIds">): boolean =>
  c.agentIds.filter(Boolean).length === COMPOSITION_SIZE;

/**
 * Qué está MAL. Lista vacía = se puede guardar. Ojo: «incompleta» no está aquí a propósito —no es
 * un error, es un estado—.
 */
export function validateComposition(c: Pick<Composition, "name" | "mapId" | "agentIds" | "notes">): CompositionIssue[] {
  const out: CompositionIssue[] = [];
  const name = (c.name ?? "").trim();

  if (name.length === 0) out.push({ code: "NAME_REQUIRED", message: "La composición necesita un nombre." });
  if (name.length > MAX_COMPOSITION_NAME) {
    out.push({ code: "NAME_TOO_LONG", message: `El nombre no puede pasar de ${MAX_COMPOSITION_NAME} caracteres.` });
  }
  if ((c.notes ?? "").length > MAX_COMPOSITION_NOTES) {
    out.push({ code: "NOTES_TOO_LONG", message: `Las notas no pueden pasar de ${MAX_COMPOSITION_NOTES} caracteres.` });
  }
  if (!MAP_IDS.has(c.mapId)) out.push({ code: "UNKNOWN_MAP", message: `El mapa «${c.mapId}» no existe.` });

  const ids = (c.agentIds ?? []).filter(Boolean);
  if (ids.length > COMPOSITION_SIZE) {
    out.push({ code: "TOO_MANY_AGENTS", message: `Una composición son ${COMPOSITION_SIZE} agentes como mucho.` });
  }
  const vistos = new Set<string>();
  for (const id of ids) {
    if (!isKnownAgentId(id)) {
      out.push({ code: "UNKNOWN_AGENT", message: `El agente «${id}» no existe.`, agentId: id });
      continue;
    }
    if (vistos.has(id)) {
      out.push({ code: "DUPLICATE_AGENT", message: "No se puede repetir un agente en la misma composición.", agentId: id });
    }
    vistos.add(id);
  }
  return out;
}

/**
 * FASE 51 · LA PUERTA DEL SERVIDOR. Valida el cuerpo TAL CUAL LLEGA, antes de limpiarlo.
 *
 * El fallo que cierra: la API limpiaba primero (`sanitizeComposition` descarta en silencio lo
 * desconocido y lo repetido) y validaba después, así que un agente inventado desaparecía sin error
 * y los diez agentes del modelo anterior —`isKnownAgentId` los reconoce para poder LEER jugadas
 * antiguas— se guardaban como composición activa. La lista acababa diciendo «5 / 5» sin un solo
 * agente real.
 *
 * Aquí solo pasa lo que el roster ACTIVO del entrenador ofrece (`isSelectableAgentId`: los 29 reales):
 *   · entrada que no es texto, o `agentIds` que no es lista → INVALID_PAYLOAD;
 *   · id que no existe                                      → UNKNOWN_AGENT;
 *   · id del modelo anterior (legado, no seleccionable)     → LEGACY_AGENT;
 *   · repetido                                              → DUPLICATE_AGENT (regla ya existente);
 *   · más de cinco                                          → TOO_MANY_AGENTS (regla ya existente).
 * Incompleta (menos de cinco) sigue sin ser un error: es un estado.
 */
export function validateCompositionPayload(raw: unknown): CompositionIssue[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return [{ code: "INVALID_PAYLOAD", message: "Composición no válida." }];
  }
  const r = raw as Record<string, unknown>;
  const out: CompositionIssue[] = [];
  for (const campo of ["name", "mapId", "notes"] as const) {
    if (r[campo] !== undefined && typeof r[campo] !== "string") {
      out.push({ code: "INVALID_PAYLOAD", message: "Composición no válida." });
      return out;
    }
  }
  if (r.agentIds !== undefined && !Array.isArray(r.agentIds)) {
    return [{ code: "INVALID_PAYLOAD", message: "La lista de agentes no es válida." }];
  }
  const ids = (r.agentIds as unknown[] | undefined) ?? [];
  if (ids.length > COMPOSITION_SIZE) {
    out.push({ code: "TOO_MANY_AGENTS", message: `Una composición son ${COMPOSITION_SIZE} agentes como mucho.` });
  }
  const vistos = new Set<string>();
  for (const id of ids) {
    if (typeof id !== "string") {
      out.push({ code: "INVALID_PAYLOAD", message: "La lista de agentes no es válida." });
      continue;
    }
    if (!isKnownAgentId(id)) {
      out.push({ code: "UNKNOWN_AGENT", message: `El agente «${id}» no existe.`, agentId: id });
      continue;
    }
    if (!isSelectableAgentId(id)) {
      out.push({ code: "LEGACY_AGENT", message: `«${agentDisplayName(id)}» es del modelo anterior: cámbialo por un agente del roster actual.`, agentId: id });
      continue;
    }
    if (vistos.has(id)) {
      out.push({ code: "DUPLICATE_AGENT", message: "No se puede repetir un agente en la misma composición.", agentId: id });
    }
    vistos.add(id);
  }
  return out;
}

/** Deja la composición en su forma canónica: sin huecos, sin repetidos y recortada. */
export function sanitizeComposition(raw: Partial<Composition>): Omit<Composition, "id" | "updatedAt"> {
  const vistos = new Set<string>();
  const agentIds: string[] = [];
  for (const id of Array.isArray(raw.agentIds) ? raw.agentIds : []) {
    // Reales y legado: lo guardado no se pierde al volver a guardar (ver `roster.ts`).
    if (typeof id !== "string" || !isKnownAgentId(id) || vistos.has(id)) continue;
    vistos.add(id);
    agentIds.push(id);
    if (agentIds.length >= COMPOSITION_SIZE) break;
  }
  return {
    name: (raw.name ?? "").trim().slice(0, MAX_COMPOSITION_NAME),
    mapId: typeof raw.mapId === "string" && MAP_IDS.has(raw.mapId) ? raw.mapId : "",
    agentIds,
    notes: (raw.notes ?? "").slice(0, MAX_COMPOSITION_NOTES),
    primary: raw.primary === true,
  };
}

/**
 * Reparto por ROL real. Lo enseña la interfaz; NO bloquea nada. Los agentes del modelo anterior
 * no tienen rol real: se cuentan aparte en `legacy`, sin asignarles ninguno.
 */
export function classBreakdown(agentIds: string[]): Record<TacticalRole | "legacy", number> {
  const out = Object.fromEntries([...TACTICAL_ROLES, "legacy"].map((k) => [k, 0])) as Record<TacticalRole | "legacy", number>;
  for (const id of agentIds) {
    const real = getTacticalAgent(id);
    if (real) out[real.role] += 1;
    else if (getLegacyAgent(id)) out.legacy += 1;
  }
  return out;
}

/** Ids del modelo anterior presentes en una composición: la interfaz avisa y deja quitarlos. */
export const legacyAgentIds = (agentIds: readonly string[]): string[] => agentIds.filter((id) => !!getLegacyAgent(id));

/**
 * QUÉ SE ROMPE AL CAMBIAR LA COMPOSICIÓN DE UNA JUGADA.
 *
 * Esto existe por el punto más delicado del encargo: si un entrenador cambia Veil por Haze, las
 * utilidades y las fichas que estaban asignadas a Veil **no** pueden convertirse solas en Haze. Eso
 * sería corrupción semántica: el humo de un agente no es el humo de otro y la jugada dejaría de
 * significar lo que significaba, sin que nadie se entere.
 *
 * Así que no se convierte nada: se DETECTA y se avisa. Devuelve qué agentes usaba la jugada y ya no
 * están en la composición nueva, para que la interfaz pueda decirlo antes de guardar.
 */
export function compositionImpact(
  usedAgentIds: readonly string[], nextAgentIds: readonly string[],
): { removed: string[]; safe: boolean } {
  const siguen = new Set(nextAgentIds);
  const removed = [...new Set(usedAgentIds.filter((id) => id && !siguen.has(id)))];
  return { removed, safe: removed.length === 0 };
}
