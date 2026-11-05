/**
 * F59 · ARTE DE AGENTE — la ÚNICA puerta para saber qué imagen tiene un agente real de Valorant.
 *
 * ────────────────────────── LA CADENA ──────────────────────────
 *
 *   `personajes/{cara,entero}` (originales, no se tocan)
 *        ↓ `npm run agent-art:import` (scripts/agent-art-import.ts, idempotente)
 *   `public/agents/<id>/{face,full}.webp` + `agentArtManifest.ts` (GENERADO)
 *        ↓ `agentArtwork(id)` / `getAgentArtwork(id, kind)` (este fichero)
 *   `<AgentPortrait>` / `<AgentFullBody>` (src/components/agents)
 *        ↓
 *   todas las pantallas.
 *
 * Ninguna pantalla compone `/agents/jett/face.webp` a mano ni pregunta al servidor si existe:
 * lo que hay lo dice el manifiesto, así que un agente sin arte hace CERO peticiones.
 *
 * ────────────────────────── IDENTIDAD ──────────────────────────
 *
 * La clave es el `id` canónico del roster (`roster.ts`: `kayo`, `gekko`…), nunca el nombre
 * visible. Para los datos que sólo traen un NOMBRE (ficheros de `personajes/`, estadísticas de
 * esports: «KAY/O») hay UNA normalización explícita —minúsculas, sin tildes, sin nada que no sea
 * letra o cifra— y una tabla de alias escrita a mano. Sin parecidos ni distancias: o casa
 * exactamente, o no es ese agente.
 *
 * Jugador ≠ agente: esto no sabe nada de cartas ni de jugadores profesionales.
 *
 * Puro: sin React, sin red, sin `fs`. Lo usan el importador, los tests y el cliente.
 */
import { TACTICAL_AGENTS, getTacticalAgent } from "./roster";
import { AGENT_ART_MANIFEST, type AgentArtAsset } from "./agentArtManifest";

export type { AgentArtAsset } from "./agentArtManifest";
export type AgentArtKind = "face" | "full";
export const AGENT_ART_KINDS: readonly AgentArtKind[] = ["face", "full"];

/** `personajes/cara` → cara (retrato), `personajes/entero` → cuerpo entero. */
export const AGENT_ART_SOURCE_DIRS: Record<AgentArtKind, string> = { face: "cara", full: "entero" };

/** «KAY/O», «Kay O», «kayo» → `kayo`. Sin tildes, sin símbolos, sin espacios. */
export function normalizeAgentKey(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Alias escritos a mano: grafías que aparecen de verdad y NO salen de normalizar el id o el nombre.
 * Cada entrada es una afirmación («este texto es este agente»), por eso no se deducen.
 */
export const AGENT_NAME_ALIASES: Readonly<Record<string, string>> = {
  geko: "gekko", // personajes/entero/geko.avif
};

const BY_KEY: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const a of TACTICAL_AGENTS) {
    m.set(normalizeAgentKey(a.id), a.id);
    m.set(normalizeAgentKey(a.name), a.id);
  }
  for (const [alias, id] of Object.entries(AGENT_NAME_ALIASES)) m.set(normalizeAgentKey(alias), id);
  return m;
})();

/** Id canónico a partir de un nombre o grafía, o `null`. Coincidencia EXACTA tras normalizar. */
export function agentIdFromName(name: string | null | undefined): string | null {
  if (!name) return null;
  return BY_KEY.get(normalizeAgentKey(name)) ?? null;
}

/*
 * Ajustes de encuadre por agente. Vacío mientras ninguno lo necesite: la estrategia común
 * (cara centrada, cuerpo anclado arriba) vale para todos. Si uno se corta, se añade AQUÍ,
 * no en el CSS de una pantalla.
 */
export interface AgentArtTuning { objectPosition?: string; scale?: number }
export const AGENT_ART_TUNING: Readonly<Record<string, Partial<Record<AgentArtKind, AgentArtTuning>>>> = {};

export interface AgentArtwork {
  agentId: string;
  name: string;
  face: AgentArtAsset | null;
  full: AgentArtAsset | null;
}

/*
 * F60 · ARTE SUBIDO DESDE EL PANEL. Cara y cuerpo que un administrador sube en /admin/agents viven en Storage y
 * llegan con el catálogo real (`applyRuntimeAgentArt`). Tienen PRIORIDAD sobre el manifiesto estático de F59: así se
 * puede reemplazar el arte de cualquiera de los 29 y dar arte a un agente nuevo sin tocar `public/` ni recompilar.
 */
const RUNTIME_ART = new Map<string, { face: AgentArtAsset | null; full: AgentArtAsset | null }>();

/** Sustituye el arte vivo (llamado junto a `applyRuntimeRoster`). Entradas sin cara ni cuerpo se ignoran. */
export function applyRuntimeAgentArt(entries: readonly { agentId: string; face: AgentArtAsset | null; full: AgentArtAsset | null }[]): void {
  RUNTIME_ART.clear();
  for (const e of entries) if (e.face || e.full) RUNTIME_ART.set(e.agentId, { face: e.face, full: e.full });
}

/** Arte de un agente real. Legado (Veil…), desconocidos o vacíos → `null`. */
export function agentArtwork(agentId: string | null | undefined): AgentArtwork | null {
  const agent = getTacticalAgent(agentId);
  if (!agent) return null;
  const m = AGENT_ART_MANIFEST[agent.id];
  const live = RUNTIME_ART.get(agent.id);
  return { agentId: agent.id, name: agent.name, face: live?.face ?? m?.face ?? null, full: live?.full ?? m?.full ?? null };
}

/** Una pieza concreta, o `null` si no existe (el componente pinta su respaldo). */
export function getAgentArtwork(agentId: string | null | undefined, kind: AgentArtKind): AgentArtAsset | null {
  return agentArtwork(agentId)?.[kind] ?? null;
}

export const agentArtTuning = (agentId: string, kind: AgentArtKind): AgentArtTuning =>
  AGENT_ART_TUNING[agentId]?.[kind] ?? {};

// ────────────────────────── PLAN DE IMPORTACIÓN (puro; lo ejecuta el script) ──────────────────────────

export interface SourceFile { kind: AgentArtKind; file: string }
export interface AgentArtPlan {
  /** kind → agentId → fichero de origen (nombre dentro de su carpeta). */
  assigned: Record<AgentArtKind, Record<string, string>>;
  /** Ficheros que no son de ningún agente del juego. */
  unknown: SourceFile[];
  /** Dos o más ficheros para el mismo agente y la misma pieza: el importador se niega. */
  collisions: { kind: AgentArtKind; agentId: string; files: string[] }[];
  /** Ficheros cuyo nombre no es el id canónico (mayúsculas, alias…): se asignan, pero se informan. */
  renamed: { kind: AgentArtKind; file: string; agentId: string; via: "case" | "alias" | "name" }[];
  missing: Record<AgentArtKind, string[]>;
}

const IMAGE_EXT = /\.(png|webp|jpe?g|avif)$/i;

export function planAgentArt(files: SourceFile[]): AgentArtPlan {
  const hits: Record<AgentArtKind, Map<string, string[]>> = { face: new Map(), full: new Map() };
  const plan: AgentArtPlan = { assigned: { face: {}, full: {} }, unknown: [], collisions: [], renamed: [], missing: { face: [], full: [] } };
  for (const f of [...files].sort((a, b) => (a.kind + a.file).localeCompare(b.kind + b.file))) {
    const stem = f.file.replace(IMAGE_EXT, "");
    const id = IMAGE_EXT.test(f.file) ? agentIdFromName(stem) : null;
    if (!id) { plan.unknown.push(f); continue; }
    hits[f.kind].set(id, [...(hits[f.kind].get(id) ?? []), f.file]);
    if (stem !== id) {
      const via = stem.toLowerCase() === id ? "case" : AGENT_NAME_ALIASES[normalizeAgentKey(stem)] ? "alias" : "name";
      plan.renamed.push({ kind: f.kind, file: f.file, agentId: id, via });
    }
  }
  for (const kind of AGENT_ART_KINDS) {
    for (const [agentId, fs] of [...hits[kind]].sort(([a], [b]) => a.localeCompare(b))) {
      if (fs.length > 1) plan.collisions.push({ kind, agentId, files: fs });
      else plan.assigned[kind][agentId] = fs[0];
    }
    plan.missing[kind] = TACTICAL_AGENTS.map((a) => a.id).filter((id) => !hits[kind].has(id)).sort();
  }
  return plan;
}
