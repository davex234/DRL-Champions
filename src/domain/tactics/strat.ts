/**
 * ESTRATEGIAS — el modelo de una jugada dibujada (Fase 9I).
 *
 * Una «strat» es un PLAN: un mapa, un bando, cinco jugadores colocados, unas flechas de
 * movimiento y una secuencia de pasos con su momento. Nada más. No simula la ronda, no
 * calcula probabilidades y no toca el motor de partido: es la pizarra del entrenador
 * llevada a datos, y lo que se guarda es exactamente lo que se dibujó.
 *
 * Sistema PROPIO. No se reutiliza el formato, el vocabulario ni los assets de ninguna
 * herramienta existente: solo la idea, que es tan vieja como la pizarra.
 *
 * TODO ES PURO Y SERIALIZABLE: sin React, sin red, sin `Date.now`. Un `Strat` va y viene
 * de la base de datos como JSON sin conversiones intermedias.
 */
import { DUEL_ROLES } from "@/domain/cardgame";
import type { RoleId } from "@/domain/cards/types";
import { getTacticalMap, type Side } from "./maps";

/** Qué representa un marcador sobre el mapa. */
export type MarkerKind =
  /** Un jugador del equipo, con su rol. */
  | "player"
  /** Una utilidad: humo, destello, muro… Se nombra, no se tipifica: cada equipo usa las suyas. */
  | "utility"
  /** Una nota clavada en un punto. */
  | "note";

export interface StratMarker {
  id: string;
  kind: MarkerKind;
  /** Posición en la rejilla 0..100 del mapa. */
  x: number;
  y: number;
  /** Rol, solo para `player`. Es el mismo vocabulario de roles que las cartas. */
  role?: RoleId;
  /** Etiqueta corta. En `utility` y `note` es lo único que la identifica. */
  label: string;
  /**
   * Destino del movimiento, si lo hay. Dibuja una flecha desde la posición hasta aquí.
   * Un marcador sin `to` es una posición estática.
   */
  to?: { x: number; y: number };
  /** Paso de la secuencia en el que ocurre. `0` = desde el principio. */
  step: number;
}

export interface StratStep {
  id: string;
  /** Segundo de la ronda en el que empieza. Sirve para ordenar y para explicar el timing. */
  at: number;
  label: string;
  notes: string;
}

export interface Strat {
  id: string;
  name: string;
  mapId: string;
  side: Side;
  markers: StratMarker[];
  steps: StratStep[];
  notes: string;
  /** Versión del formato, para poder migrar sin perder estrategias guardadas. */
  version: number;
}

export const STRAT_VERSION = 1;

/** Tope de marcadores. No es una regla de juego: evita que una estrategia sea ilegible. */
export const MAX_MARKERS = 40;
export const MAX_STEPS = 12;
/** Cinco jugadores: uno por rol, igual que la composición de un mazo de duelo. */
export const TEAM_SIZE = 5;

export const MARKER_LABEL: Record<MarkerKind, string> = {
  player: "Jugador",
  utility: "Utilidad",
  note: "Nota",
};

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n * 10) / 10));

/**
 * Estrategia vacía sobre un mapa. Coloca los cinco roles en la base del bando, en fila:
 * una pizarra que empieza con las fichas fuera del tablero obliga a colocarlas antes de
 * poder pensar, y lo que se quiere es empezar a mover.
 */
export function emptyStrat(id: string, mapId: string, side: Side, name = "Nueva estrategia"): Strat {
  const map = getTacticalMap(mapId);
  const spawn = map?.zones.find((z) => z.kind === "spawn" && z.id.startsWith(side === "attack" ? "atk" : "def"));
  const baseY = spawn ? (spawn.polygon.reduce((s, p) => s + p[1], 0) / spawn.polygon.length) : side === "attack" ? 94 : 6;

  return {
    id,
    name,
    mapId,
    side,
    version: STRAT_VERSION,
    notes: "",
    steps: [{ id: "s0", at: 0, label: "Apertura", notes: "" }],
    markers: DUEL_ROLES.map((role, i) => ({
      id: `p${i}`,
      kind: "player" as const,
      role,
      label: role,
      // Repartidos a lo ancho de la base, con margen en los bordes.
      x: clamp(38 + i * 6),
      y: clamp(baseY),
      step: 0,
    })),
  };
}

/** Mueve un marcador. Devuelve una estrategia nueva: nada se muta en el sitio. */
export function moveMarker(strat: Strat, markerId: string, x: number, y: number): Strat {
  return {
    ...strat,
    markers: strat.markers.map((m) => (m.id === markerId ? { ...m, x: clamp(x), y: clamp(y) } : m)),
  };
}

/** Fija (o quita, con `null`) el destino de movimiento de un marcador. */
export function setMarkerTarget(
  strat: Strat, markerId: string, to: { x: number; y: number } | null,
): Strat {
  return {
    ...strat,
    markers: strat.markers.map((m) =>
      m.id === markerId
        ? { ...m, to: to ? { x: clamp(to.x), y: clamp(to.y) } : undefined }
        : m,
    ),
  };
}

export function addMarker(strat: Strat, marker: Omit<StratMarker, "id">): Strat {
  if (strat.markers.length >= MAX_MARKERS) return strat;
  const id = `m${Date.now().toString(36)}${strat.markers.length}`;
  return {
    ...strat,
    markers: [...strat.markers, { ...marker, id, x: clamp(marker.x), y: clamp(marker.y) }],
  };
}

/** Quita un marcador. Los de jugador NO se pueden quitar: el equipo siempre son cinco. */
export function removeMarker(strat: Strat, markerId: string): Strat {
  const target = strat.markers.find((m) => m.id === markerId);
  if (!target || target.kind === "player") return strat;
  return { ...strat, markers: strat.markers.filter((m) => m.id !== markerId) };
}

export function addStep(strat: Strat, label: string, at: number): Strat {
  if (strat.steps.length >= MAX_STEPS) return strat;
  const id = `s${strat.steps.length}${Date.now().toString(36)}`;
  return {
    ...strat,
    steps: [...strat.steps, { id, at: Math.max(0, Math.round(at)), label, notes: "" }]
      .sort((a, b) => a.at - b.at),
  };
}

/** Quita un paso y recoloca en el anterior los marcadores que colgaban de él. */
export function removeStep(strat: Strat, stepId: string): Strat {
  const index = strat.steps.findIndex((s) => s.id === stepId);
  if (index <= 0) return strat; // el primer paso (la apertura) no se borra
  return {
    ...strat,
    steps: strat.steps.filter((s) => s.id !== stepId),
    markers: strat.markers.map((m) => (m.step >= index ? { ...m, step: Math.max(0, m.step - 1) } : m)),
  };
}

export interface StratIssue {
  code: "MAP_UNKNOWN" | "TEAM_SIZE" | "ROLE_DUPLICATE" | "OUT_OF_BOUNDS" | "NO_STEPS" | "TOO_MANY";
  message: string;
}

/**
 * Comprueba que una estrategia es coherente ANTES de guardarla.
 *
 * No juzga si es buena —eso no lo puede saber nadie desde aquí—, solo si está bien
 * formada: mapa que existe, cinco jugadores sin repetir rol, todo dentro del tablero y al
 * menos un paso. La misma función la ejecutan el editor y el servidor, así que un cliente
 * modificado no puede guardar una estrategia rota.
 */
export function validateStrat(strat: Strat): { ok: boolean; issues: StratIssue[] } {
  const issues: StratIssue[] = [];

  if (!getTacticalMap(strat.mapId)) {
    issues.push({ code: "MAP_UNKNOWN", message: `El mapa «${strat.mapId}» no existe` });
  }

  const players = strat.markers.filter((m) => m.kind === "player");
  if (players.length !== TEAM_SIZE) {
    issues.push({ code: "TEAM_SIZE", message: `Un equipo son ${TEAM_SIZE} jugadores, y hay ${players.length}` });
  }

  const roles = players.map((p) => p.role).filter(Boolean);
  if (new Set(roles).size !== roles.length) {
    issues.push({ code: "ROLE_DUPLICATE", message: "Hay dos jugadores con el mismo rol" });
  }

  const outside = strat.markers.filter(
    (m) => m.x < 0 || m.x > 100 || m.y < 0 || m.y > 100
      || (m.to && (m.to.x < 0 || m.to.x > 100 || m.to.y < 0 || m.to.y > 100)),
  );
  if (outside.length > 0) {
    issues.push({ code: "OUT_OF_BOUNDS", message: `${outside.length} marcador(es) fuera del mapa` });
  }

  if (strat.steps.length === 0) {
    issues.push({ code: "NO_STEPS", message: "Una estrategia necesita al menos un paso" });
  }

  if (strat.markers.length > MAX_MARKERS || strat.steps.length > MAX_STEPS) {
    issues.push({ code: "TOO_MANY", message: "La estrategia tiene demasiados elementos para leerse" });
  }

  return { ok: issues.length === 0, issues };
}

/**
 * Sanea cualquier cosa que llegue de fuera y la convierte en un `Strat` bien formado.
 *
 * Es la puerta de entrada del servidor: lo que manda el cliente no se guarda tal cual, se
 * reconstruye campo a campo. Un `x` de `"999"` o un marcador sin `kind` no llega a la
 * base de datos.
 */
export function sanitizeStrat(raw: unknown, fallbackId: string): Strat | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<Strat>;

  const mapId = typeof r.mapId === "string" ? r.mapId : "";
  if (!getTacticalMap(mapId)) return null;

  const side: Side = r.side === "defense" ? "defense" : "attack";
  const num = (v: unknown, fallback = 0) =>
    typeof v === "number" && Number.isFinite(v) ? clamp(v) : fallback;

  const steps: StratStep[] = (Array.isArray(r.steps) ? r.steps : [])
    .filter((s): s is StratStep => !!s && typeof s === "object")
    .slice(0, MAX_STEPS)
    .map((s, i) => ({
      id: typeof s.id === "string" ? s.id.slice(0, 40) : `s${i}`,
      at: typeof s.at === "number" && Number.isFinite(s.at) ? Math.max(0, Math.min(180, Math.round(s.at))) : 0,
      label: typeof s.label === "string" ? s.label.slice(0, 60) : `Paso ${i + 1}`,
      notes: typeof s.notes === "string" ? s.notes.slice(0, 400) : "",
    }));

  const markers: StratMarker[] = (Array.isArray(r.markers) ? r.markers : [])
    .filter((m): m is StratMarker => !!m && typeof m === "object")
    .slice(0, MAX_MARKERS)
    .map((m, i) => {
      const kind: MarkerKind =
        m.kind === "player" || m.kind === "utility" || m.kind === "note" ? m.kind : "note";
      const role = kind === "player" && DUEL_ROLES.includes(m.role as RoleId) ? (m.role as RoleId) : undefined;
      return {
        id: typeof m.id === "string" ? m.id.slice(0, 40) : `m${i}`,
        kind,
        role,
        label: typeof m.label === "string" ? m.label.slice(0, 40) : MARKER_LABEL[kind],
        x: num(m.x),
        y: num(m.y),
        to: m.to && typeof m.to === "object" ? { x: num(m.to.x), y: num(m.to.y) } : undefined,
        step: typeof m.step === "number" && Number.isFinite(m.step)
          ? Math.max(0, Math.min(steps.length > 0 ? steps.length - 1 : 0, Math.floor(m.step)))
          : 0,
      };
    });

  return {
    id: typeof r.id === "string" && r.id.length > 0 ? r.id.slice(0, 64) : fallbackId,
    name: typeof r.name === "string" && r.name.trim().length > 0 ? r.name.trim().slice(0, 60) : "Estrategia",
    mapId,
    side,
    markers,
    steps: steps.length > 0 ? steps : [{ id: "s0", at: 0, label: "Apertura", notes: "" }],
    notes: typeof r.notes === "string" ? r.notes.slice(0, 1000) : "",
    version: STRAT_VERSION,
  };
}
