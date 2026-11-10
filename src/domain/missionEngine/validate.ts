/**
 * F73 · VALIDACIÓN DE CONFIGURACIÓN (admin) — misiones y proyectos. PURO.
 *
 * No se publica nada inválido: condición desconocida o sin sus parámetros, objetivo fuera de rango, carta/jugador/
 * sobre inexistente, recompensa inexistente o desmesurada, dependencia a una misión que no existe o CIRCULAR, proyecto
 * sin carta real o sin misiones.
 */
import { CONDITION_TYPES, ID_RE, MATCH_MODES, type MissionDef, type ProjectDef } from "./types";
import { DUEL_ROLES } from "@/domain/cardgame/types";

/** Topes de recompensa de una misión F73 (una vez por usuario; ver economía). */
export const MISSION_REWARD_CAP = { credits: 5000, xp: 2000, packCount: 3 };
export const MISSION_TARGET_MAX = 500;

export interface Lookup {
  cardExists: (id: string) => boolean;
  playerExists: (id: string) => boolean;
  packExists: (id: string) => boolean;
  teamExists: (key: string) => boolean;
}
export interface Problem { code: string; message: string }

const NEEDS: Partial<Record<string, "cardId" | "playerId" | "team" | "country" | "role">> = {
  USE_CARD: "cardId", USE_PLAYER: "playerId", DECK_CONTAINS_PLAYER: "playerId", WIN_WITH_PLAYER: "playerId",
  USE_TEAM: "team", USE_COUNTRY: "country", USE_ROLE: "role",
};
const COUNT_TYPES = new Set(["DECK_MIN_TEAM", "DECK_MIN_COUNTRY", "DECK_MIN_ROLE", "WIN_WITH_TEAM_COUNT", "WIN_WITH_COUNTRY_COUNT", "WIN_WITH_ROLE_COUNT"]);

export function validateMission(m: MissionDef, all: readonly MissionDef[], look: Lookup, projects: readonly ProjectDef[]): Problem[] {
  const out: Problem[] = [];
  const bad = (code: string, message: string) => out.push({ code, message });
  if (!ID_RE.test(m.id)) bad("BAD_ID", "Id inválido");
  if (!m.name || m.name.trim().length < 3 || m.name.length > 80) bad("BAD_NAME", "Nombre de 3 a 80 caracteres");
  if ((m.description ?? "").length > 240) bad("BAD_DESCRIPTION", "Descripción de hasta 240 caracteres");
  const c = m.condition;
  if (!c || !CONDITION_TYPES.includes(c.type)) { bad("NO_CONDITION", "Condición inválida o ausente"); return out; }
  if (!Number.isInteger(m.target) || m.target < 1 || m.target > MISSION_TARGET_MAX) bad("BAD_TARGET", `Objetivo de 1 a ${MISSION_TARGET_MAX}`);
  const need = NEEDS[c.type];
  if (need && !c[need]) bad("MISSING_PARAM", `La condición ${c.type} necesita «${need}»`);
  if (c.cardId && !look.cardExists(c.cardId)) bad("UNKNOWN_CARD", "La carta no existe en el catálogo");
  if (c.playerId && !look.playerExists(c.playerId)) bad("UNKNOWN_PLAYER", "El jugador no existe en el catálogo");
  if (c.team && !look.teamExists(c.team)) bad("UNKNOWN_TEAM", "El equipo no existe");
  if (c.country && !/^[A-Z]{2}$/.test(c.country)) bad("BAD_COUNTRY", "País ISO-2 en mayúsculas");
  if (c.role && !DUEL_ROLES.includes(c.role)) bad("BAD_ROLE", "Rol inválido");
  if (c.packId && !look.packExists(c.packId)) bad("UNKNOWN_PACK", "El sobre no existe");
  if (COUNT_TYPES.has(c.type) && (!Number.isInteger(c.min) || (c.min as number) < 2 || (c.min as number) > 10)) bad("BAD_MIN", "«min» de 2 a 10");
  if (c.modes && (!Array.isArray(c.modes) || c.modes.some((x) => !MATCH_MODES.includes(x)))) bad("BAD_MODES", "Modos inválidos");
  if (c.type === "WIN_STREAK" && m.target < 2) bad("BAD_TARGET", "Una racha empieza en 2");
  // Recompensa: existente y acotada (una vez por usuario).
  const r = m.reward ?? {};
  for (const k of ["credits", "xp", "packCount"] as const) {
    const v = r[k];
    if (v !== undefined && (!Number.isInteger(v) || v < 0 || v > MISSION_REWARD_CAP[k])) bad("BAD_REWARD", `«${k}» de 0 a ${MISSION_REWARD_CAP[k]}`);
  }
  if (r.packId && !look.packExists(r.packId)) bad("UNKNOWN_REWARD", "El sobre de recompensa no existe");
  if ((r.packCount ?? 0) > 0 && !r.packId) bad("UNKNOWN_REWARD", "Falta el sobre de la recompensa");
  if (m.projectId && !projects.some((p) => p.id === m.projectId)) bad("UNKNOWN_PROJECT", "El proyecto no existe");
  // Dependencias: existen y no hay ciclos.
  const ids = new Set(all.map((x) => x.id));
  for (const d of m.dependsOn) if (d === m.id || !ids.has(d)) bad("BAD_DEPENDENCY", `Dependencia inválida: ${d}`);
  if (hasCycle([...all.filter((x) => x.id !== m.id), m])) bad("CIRCULAR_DEPENDENCY", "Dependencia circular");
  if (m.availableFrom !== null && m.availableTo !== null && m.availableTo <= m.availableFrom) bad("BAD_WINDOW", "La fecha de fin debe ser posterior al inicio");
  return out;
}

export function hasCycle(all: readonly Pick<MissionDef, "id" | "dependsOn">[]): boolean {
  const deps = new Map(all.map((m) => [m.id, m.dependsOn]));
  const state = new Map<string, 1 | 2>();
  const visit = (id: string): boolean => {
    const s = state.get(id);
    if (s === 1) return true;
    if (s === 2) return false;
    state.set(id, 1);
    for (const d of deps.get(id) ?? []) if (deps.has(d) && visit(d)) return true;
    state.set(id, 2);
    return false;
  };
  return all.some((m) => visit(m.id));
}

export function validateProject(p: ProjectDef, missions: readonly MissionDef[], look: Lookup, opts: { forActivation?: boolean } = {}): Problem[] {
  const out: Problem[] = [];
  const bad = (code: string, message: string) => out.push({ code, message });
  if (!ID_RE.test(p.id)) bad("BAD_ID", "Id inválido");
  if (!p.name || p.name.trim().length < 3 || p.name.length > 80) bad("BAD_NAME", "Nombre de 3 a 80 caracteres");
  if (!p.targetCardId || !look.cardExists(p.targetCardId)) bad("UNKNOWN_CARD", "La carta objetivo no existe en el catálogo");
  if (opts.forActivation && !missions.some((m) => m.projectId === p.id && m.status === "ACTIVE")) bad("NO_MISSIONS", "Un proyecto activo necesita al menos una misión activa");
  if (p.availableFrom !== null && p.availableTo !== null && p.availableTo <= p.availableFrom) bad("BAD_WINDOW", "La fecha de fin debe ser posterior al inicio");
  return out;
}
