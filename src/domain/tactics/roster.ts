/**
 * TACTICAL COACH · CATÁLOGO DE AGENTES — el roster REAL con el que se hacen las composiciones.
 *
 * ────────────────────────── POR QUÉ HAY UN CATÁLOGO PROPIO DEL ENTRENADOR ──────────────────────────
 *
 * El entrenador prepara partidas del juego real, así que sus composiciones son de agentes REALES
 * (`valorantRoster.ts`, generado desde una fuente verificada). El catálogo de `src/agents` —Veil,
 * Haze, Probe…— NO se toca: lo usa el motor de simulación y el juego de cartas, y cambiarlo sería
 * cambiar gameplay. Son dos modelos distintos y aquí se tratan como tales.
 *
 * ────────────────────────── EL LEGADO: CONSERVAR SIN TRADUCIR ──────────────────────────
 *
 * Antes de este cambio las composiciones y las jugadas guardaban ids ficticios. Esos ids pasan a
 * LEGADO: el saneador los CONSERVA (no se borra nada al abrir y guardar), la interfaz los enseña
 * como «modelo anterior» y no se pueden elegir para nada nuevo. **No hay mapeo ficticio → real**:
 * Veil no «es» ningún agente real, y fingir una equivalencia sería inventar datos.
 *
 * Puro: sin React, sin red. Lo usan el servidor (validar) y el cliente (pintar).
 */
import { AGENTS } from "@/agents/catalog";
import { ABILITIES } from "@/abilities/catalog";
import { VALORANT_ROSTER } from "./valorantRoster";

/** Los cuatro roles reales. El juego real no tiene «flex»: eso era del modelo propio. */
export type TacticalRole = "controller" | "initiator" | "duelist" | "sentinel";
export const TACTICAL_ROLES: readonly TacticalRole[] = ["duelist", "initiator", "controller", "sentinel"];

/** Tecla por defecto de cada ranura (Grenade/Ability1/Ability2/Ultimate en la fuente). */
export type AbilitySlot = "C" | "Q" | "E" | "X";

/** Fila tal como la escribe el generador. */
export interface ValorantRosterRow {
  id: string;
  name: string;
  code: string;
  role: TacticalRole;
  uuid: string;
  abilities: { slot: AbilitySlot; name: string }[];
}

export interface TacticalAbility {
  /** `<agente>_<tecla>`: `omen_e`, `sova_x`. Estable y legible. */
  id: string;
  agentId: string;
  name: string;
  slot: AbilitySlot;
  ultimate: boolean;
}

export interface TacticalAgent {
  id: string;
  name: string;
  /** Tres letras para la ficha del mapa. */
  code: string;
  role: TacticalRole;
  abilities: TacticalAbility[];
}

/** Un id del modelo anterior: se reconoce para no perderlo, nunca se ofrece. */
export interface LegacyAgent {
  id: string;
  name: string;
  legacy: true;
}

function toTacticalAgent(r: ValorantRosterRow): TacticalAgent {
  return {
    id: r.id,
    name: r.name,
    code: r.code,
    role: r.role,
    abilities: r.abilities.map((a) => ({
      id: `${r.id}_${a.slot.toLowerCase()}`,
      agentId: r.id,
      name: a.name,
      slot: a.slot,
      ultimate: a.slot === "X",
    })),
  };
}

/*
 * F60 · REGISTRO VIVO. La FUENTE es `public.agents` (se gestiona desde /admin/agents). `VALORANT_ROSTER` es la
 * INSTANTÁNEA generada de esa tabla (`npm run agents:snapshot`): sirve de base para el primer pintado, las pruebas y
 * los scripts sin red. Al llegar el catálogo real (`applyRuntimeRoster`, desde `/api/content/agents` en el cliente o
 * el cargador del servidor) estas estructuras se actualizan EN SITIO: mismas referencias para todos los consumidores,
 * así un agente publicado desde el panel aparece sin recompilar y uno retirado deja de ofrecerse.
 */
/** Agentes ELEGIBLES (publicados). Misma referencia siempre: se actualiza en sitio. */
export const TACTICAL_AGENTS: TacticalAgent[] = VALORANT_ROSTER.map(toTacticalAgent);

const REAL = new Map(TACTICAL_AGENTS.map((a) => [a.id, a]));
/** Retirados: se reconocen y se pintan en lo guardado, pero no se ofrecen para nada nuevo. */
const RETIRED_REAL = new Map<string, TacticalAgent>();
const REAL_ABILITIES = new Map(TACTICAL_AGENTS.flatMap((a) => a.abilities.map((ab) => [ab.id, ab] as const)));

/*
 * El legado se LEE del catálogo antiguo en vez de copiarse: si ese catálogo cambia, este
 * reconocimiento sigue sabiendo exactamente qué ids existieron.
 */
const LEGACY = new Map<string, LegacyAgent>(
  AGENTS.filter((a) => !REAL.has(a.id)).map((a) => [a.id, { id: a.id, name: a.name, legacy: true as const }]),
);
const LEGACY_ABILITY_NAME = new Map(ABILITIES.filter((a) => !REAL_ABILITIES.has(a.id)).map((a) => [a.id, a.name]));
const LEGACY_ABILITY_IDS = new Set(LEGACY_ABILITY_NAME.keys());

/** Agente real (publicado o retirado), o `undefined`. Para ELEGIR, `isSelectableAgentId`. */
export const getTacticalAgent = (id: string | undefined | null): TacticalAgent | undefined =>
  (id ? REAL.get(id) ?? RETIRED_REAL.get(id) : undefined);

/** ¿Es un agente real retirado desde el panel? (se conserva en lo guardado, no se ofrece). */
export const isRetiredAgentId = (id: string): boolean => RETIRED_REAL.has(id);

/** Agente del modelo anterior, o `undefined`. Sólo para enseñarlo y conservarlo. */
export const getLegacyAgent = (id: string | undefined | null): LegacyAgent | undefined =>
  (id ? LEGACY.get(id) : undefined);

/** ¿Se puede elegir para una composición o una ficha NUEVA? */
export const isSelectableAgentId = (id: string): boolean => REAL.has(id);

/** ¿Se debe CONSERVAR al sanear? Reales (también retirados) y legado: nada guardado se pierde en silencio. */
export const isKnownAgentId = (id: string): boolean => REAL.has(id) || RETIRED_REAL.has(id) || LEGACY.has(id);

export const getTacticalAbility = (id: string | undefined | null): TacticalAbility | undefined =>
  (id ? REAL_ABILITIES.get(id) : undefined);

/** ¿Se conserva este `abilityId`? Habilidades reales, o ids del catálogo anterior. */
export const isKnownAbilityId = (id: string): boolean => REAL_ABILITIES.has(id) || LEGACY_ABILITY_IDS.has(id);

/** Nombre visible de una habilidad guardada: real (con su tecla), del modelo anterior, o el id. */
export function abilityDisplayName(id: string): string {
  const real = REAL_ABILITIES.get(id);
  if (real) return `${real.name} (${real.slot})`;
  return LEGACY_ABILITY_NAME.get(id) ?? id;
}

export const agentsByRole = (role: TacticalRole): TacticalAgent[] => TACTICAL_AGENTS.filter((a) => a.role === role);

/** Nombre visible para cualquier id guardado: real, legado o desconocido. */
export function agentDisplayName(id: string): string {
  return getTacticalAgent(id)?.name ?? LEGACY.get(id)?.name ?? id;
}

// ────────────────────────── F60 · CATÁLOGO VIVO ──────────────────────────

/** Una fila del catálogo real tal como la sirve `/api/content/agents` (sin borradores). */
export interface RuntimeRosterRow extends ValorantRosterRow {
  lifecycle: "PUBLISHED" | "RETIRED";
}

let rosterVersion = 0;
const rosterListeners = new Set<() => void>();

/**
 * Sustituye EN SITIO el roster por el catálogo real. Una lista vacía o sin ningún publicado se ignora (una red caída
 * no puede dejar el entrenador sin agentes). Devuelve si hubo cambio.
 */
export function applyRuntimeRoster(rows: readonly RuntimeRosterRow[]): boolean {
  const pub = rows.filter((r) => r.lifecycle === "PUBLISHED").map(toTacticalAgent).sort((a, b) => a.id.localeCompare(b.id));
  if (!pub.length) return false;
  const ret = rows.filter((r) => r.lifecycle === "RETIRED").map(toTacticalAgent);
  const firma = (xs: TacticalAgent[]) => JSON.stringify(xs);
  if (firma(pub) === firma(TACTICAL_AGENTS) && firma(ret) === firma([...RETIRED_REAL.values()])) return false;
  TACTICAL_AGENTS.splice(0, TACTICAL_AGENTS.length, ...pub);
  REAL.clear(); for (const a of pub) REAL.set(a.id, a);
  RETIRED_REAL.clear(); for (const a of ret) RETIRED_REAL.set(a.id, a);
  REAL_ABILITIES.clear(); for (const a of [...pub, ...ret]) for (const ab of a.abilities) REAL_ABILITIES.set(ab.id, ab);
  rosterVersion++;
  for (const l of rosterListeners) l();
  return true;
}

/** Para `useSyncExternalStore`: los componentes que pintan agentes se re-renderizan al llegar el catálogo. */
export const subscribeRoster = (cb: () => void): (() => void) => { rosterListeners.add(cb); return () => rosterListeners.delete(cb); };
export const getRosterVersion = (): number => rosterVersion;

/** Ids de los diez agentes propios del modelo anterior: no se pueden reutilizar para un agente real. */
export const isLegacyAgentId = (id: string): boolean => LEGACY.has(id);

/** Búsqueda del Composition Manager: por nombre o por código, sin tildes ni mayúsculas. */
export function searchAgents(q: string, role: TacticalRole | "all" = "all"): TacticalAgent[] {
  const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const t = norm(q);
  return TACTICAL_AGENTS.filter((a) =>
    (role === "all" || a.role === role) && (!t || norm(a.name).includes(t) || norm(a.code).includes(t)));
}
