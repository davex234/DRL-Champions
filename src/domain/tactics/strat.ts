/**
 * ESTRATEGIAS — el modelo de una jugada dibujada. **Formato 2.**
 *
 * Una «strat» es un PLAN: un mapa, un bando y una SECUENCIA DE PASOS. Nada más. No simula
 * la ronda, no calcula probabilidades y no toca el motor de partido: es la pizarra del
 * entrenador llevada a datos, y lo que se guarda es exactamente lo que se dibujó.
 *
 * ────────────────────────── QUÉ CAMBIA EN EL FORMATO 2 ──────────────────────────
 *
 * En el formato 1 una estrategia era una lista plana de marcadores, cada uno con UNA
 * posición y el índice del paso en el que aparecía. Servía para «esta ficha entra en el
 * segundo 20», pero no para lo que un entrenador hace de verdad: **mover a los cinco entre
 * un paso y el siguiente**. Con una sola posición por ficha, el paso 3 no podía enseñar a
 * nadie en un sitio distinto al del paso 1.
 *
 * En el formato 2 **cada paso guarda su estado táctico completo**:
 *
 *     estrategia
 *       ├── paso 1 → jugadores · utilidades · dibujos · anotaciones
 *       ├── paso 2 → jugadores · utilidades · dibujos · anotaciones
 *       └── paso 3 → jugadores · utilidades · dibujos · anotaciones
 *
 * Cambiar de paso RESTAURA ese estado, sin recalcular ni interpolar nada. Es más JSON, y a
 * cambio lo que se ve al abrir el paso 3 es exactamente lo que se guardó en el paso 3.
 *
 * **Cada paso es independiente.** Al añadir uno se copia el anterior EN PROFUNDIDAD, y por
 * eso mover una ficha en el paso 2 no la mueve en el 1. Compartir el array habría sido más
 * barato y habría convertido la secuencia en una mentira.
 *
 * TODO ES PURO Y SERIALIZABLE: sin React, sin red, sin `Date.now` dentro de las funciones
 * de dominio salvo para generar identificadores. Un `Strat` va y viene de la base de datos
 * como JSON sin conversiones intermedias.
 */
import { DUEL_ROLES } from "@/domain/cardgame";
import type { RoleId } from "@/domain/cards/types";
/*
 * El catálogo del entrenador (`roster.ts`): agentes y habilidades REALES, más los ids del modelo
 * anterior como legado. Se consulta aquí —en el saneador— para que la validación ocurra en la
 * puerta: lo que se guarda existe, y lo que ya estaba guardado no se pierde al volver a guardar.
 */
import { isKnownAgentId, isKnownAbilityId } from "./roster";
import { getTacticalMap, type Side } from "./maps";
import { ns } from "@/i18n/runtime";

const tr = ns("tactics");

export const STRAT_VERSION = 2;

/* ─────────────────────────────── Vocabulario ─────────────────────────────── */

/**
 * Utilidades. Es el vocabulario del género —humo, destello, incendiaria…— tipado para que
 * cada una tenga su glifo y su color, en vez de una etiqueta de texto libre que cada
 * entrenador escribía a su manera.
 *
 * Aquí NO hay física: nada de radios reales, duraciones ni trayectorias. Esto representa
 * una intención sobre un mapa, no simula una habilidad.
 */
export type UtilityKind =
  | "smoke" | "flash" | "molly" | "stun" | "wall" | "recon" | "spike" | "waypoint" | "marker";

export const UTILITY_KINDS: readonly UtilityKind[] = [
  "smoke", "flash", "molly", "stun", "wall", "recon", "spike", "waypoint", "marker",
];

export const UTILITY_LABEL: Record<UtilityKind, string> = {
  smoke: "Humo",
  flash: "Destello",
  molly: "Incendiaria",
  stun: "Aturdidor",
  wall: "Muro",
  recon: "Información",
  spike: "Spike",
  waypoint: "Punto de ruta",
  marker: "Marcador",
};

export const UTILITY_COLOR: Record<UtilityKind, string> = {
  smoke: "#9aa7bd",
  flash: "#ffe487",
  molly: "#ff7a3d",
  stun: "#7dd8ff",
  wall: "#a78bfa",
  recon: "#3fc07a",
  spike: "#ff2e63",
  waypoint: "#19e3ff",
  marker: "#ffd35c",
};

/** Formas de dibujo. `free` es el trazo a mano alzada. */
export type DrawKind = "line" | "arrow" | "circle" | "rect" | "zone" | "free";

export const DRAW_KINDS: readonly DrawKind[] = ["arrow", "line", "circle", "rect", "zone", "free"];

export const DRAW_LABEL: Record<DrawKind, string> = {
  line: "Línea",
  arrow: "Flecha",
  circle: "Círculo",
  rect: "Rectángulo",
  zone: "Zona",
  free: "Trazo",
};

/** Paleta CERRADA. Un color libre desde el cliente es un campo de texto sin validar. */
export const DRAW_COLORS = ["#ff2e63", "#19e3ff", "#ffd35c", "#3fc07a", "#a78bfa", "#ffffff"] as const;
export type DrawColor = (typeof DRAW_COLORS)[number];

/** Color por rol sobre la pizarra: cinco tonos separables de un vistazo. */
export const ROLE_COLOR: Record<string, string> = {
  Duelista: "#ff2e63",
  Controlador: "#19e3ff",
  Iniciador: "#ffd35c",
  Centinela: "#3fc07a",
  Flex: "#a78bfa",
};

/* ─────────────────────────────── Los objetos ─────────────────────────────── */

/** Punto en la rejilla normalizada 0..100 del mapa. */
export interface Point {
  x: number;
  y: number;
}

export interface PlayerToken {
  id: string;
  /** Mismo vocabulario de roles que las cartas. Identifica al jugador de un vistazo. */
  role: RoleId;
  label: string;
  x: number;
  y: number;
  /** Destino del movimiento. Dibuja una flecha; sin él, la posición es estática. */
  to?: Point;
  /**
   * Agente asignado a esta ficha. `id` del catálogo del entrenador (`roster.ts`): un agente
   * real —`omen`, `sova`…— o, en jugadas antiguas, un id del modelo anterior que se conserva.
   *
   * **Opcional a propósito.** Una jugada dibujada antes de que existiera esta columna sigue
   * siendo válida y se abre sin perder nada: una ficha sin agente es una ficha con rol, que
   * es como funcionaba la pizarra entera hasta ahora.
   */
  agentId?: string;
}

export interface UtilityToken {
  id: string;
  kind: UtilityKind;
  label: string;
  x: number;
  y: number;
  /** Desde dónde se lanza, si importa. */
  to?: Point;
  /**
   * Habilidad concreta que representa esta marca. `id` del catálogo del entrenador
   * (`roster.ts`): `omen_e`, `sova_q`… (o un id antiguo conservado).
   *
   * `kind` sigue mandando en el DIBUJO —color y glifo salen de él— y esto añade de qué
   * habilidad se trata. Separarlos permite que una marca genérica de humo siga existiendo
   * sin obligar a elegir agente para poder dibujar.
   */
  abilityId?: string;
  /** Ficha de jugador que la lanza, si se ha atado a alguien. */
  ownerId?: string;
}

export interface Drawing {
  id: string;
  kind: DrawKind;
  color: DrawColor;
  /**
   * `line`/`arrow`: dos puntos. `rect`: dos esquinas opuestas. `circle`: centro y un punto
   * del borde. `zone`/`free`: los que hagan falta.
   */
  points: Point[];
}

export interface Annotation {
  id: string;
  x: number;
  y: number;
  text: string;
}

/** El estado táctico COMPLETO de un paso. */
export interface StepState {
  players: PlayerToken[];
  utilities: UtilityToken[];
  drawings: Drawing[];
  annotations: Annotation[];
}

export interface StratStep {
  id: string;
  /** Segundo de la ronda en el que empieza. Ordena y explica el timing. */
  at: number;
  label: string;
  notes: string;
  state: StepState;
}

export interface Strat {
  id: string;
  name: string;
  mapId: string;
  side: Side;
  /** Para qué sirve la jugada, en palabras del entrenador. */
  description: string;
  /** Etiquetas cortas para encontrarla: «default», «rápida», «anti-eco»… */
  tags: string[];
  steps: StratStep[];
  notes: string;
  /** Versión del formato, para poder migrar sin perder estrategias guardadas. */
  version: number;
}

/* ─────────────────────────────── Topes ───────────────────────────────
 * No son reglas de juego: evitan que una estrategia sea ilegible y que un cliente
 * modificado guarde un jsonb de diez megas. El servidor los aplica con `sanitizeStrat`.
 * ──────────────────────────────────────────────────────────────────── */

export const MAX_STEPS = 12;
/** Cinco jugadores: uno por rol, igual que la composición de un mazo de duelo. */
export const TEAM_SIZE = 5;
export const MAX_UTILITIES = 24;
export const MAX_DRAWINGS = 40;
export const MAX_ANNOTATIONS = 20;
/** Vértices de un trazo. Un garabato a mano alzada se simplifica a esto. */
export const MAX_POINTS = 64;
export const MAX_TAGS = 8;
/** Tope duro del JSON completo. Lo comprueba la ruta antes de escribir. */
export const MAX_PLAN_BYTES = 256 * 1024;

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n * 10) / 10));
const clampPoint = (p: Point): Point => ({ x: clamp(p.x), y: clamp(p.y) });

let seq = 0;
const uid = (prefix: string) => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`;

/* ─────────────────────────── Clonado en profundidad ───────────────────────────
 * La pieza que hace honesta la secuencia. Dos pasos NUNCA comparten un objeto: si lo
 * compartieran, mover una ficha en el paso 3 la movería también en el 1 y el editor
 * mentiría sin dar ningún error.
 * ──────────────────────────────────────────────────────────────────────────── */

export function cloneStepState(s: StepState): StepState {
  return {
    players: s.players.map((p) => ({ ...p, to: p.to ? { ...p.to } : undefined })),
    utilities: s.utilities.map((u) => ({ ...u, to: u.to ? { ...u.to } : undefined })),
    drawings: s.drawings.map((d) => ({ ...d, points: d.points.map((pt) => ({ ...pt })) })),
    annotations: s.annotations.map((a) => ({ ...a })),
  };
}

export const emptyStepState = (): StepState => ({
  players: [], utilities: [], drawings: [], annotations: [],
});

/** Copia profunda de una estrategia entera. La usa «duplicar». */
export function cloneStrat(s: Strat): Strat {
  return {
    ...s,
    tags: [...s.tags],
    steps: s.steps.map((st) => ({ ...st, state: cloneStepState(st.state) })),
  };
}

/* ─────────────────────────────── Construcción ─────────────────────────────── */

/**
 * Estrategia vacía sobre un mapa, con los cinco roles ya colocados en el borde del bando.
 *
 * Una pizarra que empieza con las fichas fuera del tablero obliga a colocarlas antes de
 * poder pensar, y lo que se quiere es empezar a mover. Si el mapa define zonas se usa la
 * base; los assets no las traen, así que casi siempre se cae al borde por defecto.
 */
export function emptyStrat(id: string, mapId: string, side: Side, name = tr("Nueva estrategia")): Strat {
  const mapDef = getTacticalMap(mapId);
  const spawn = mapDef?.zones?.find(
    (z) => z.kind === "spawn" && z.id.startsWith(side === "attack" ? "atk" : "def"),
  );
  const baseY = spawn
    ? spawn.polygon.reduce((s, p) => s + p[1], 0) / spawn.polygon.length
    : side === "attack" ? 88 : 12;

  return {
    id,
    name,
    mapId,
    side,
    description: "",
    tags: [],
    version: STRAT_VERSION,
    notes: "",
    steps: [{
      id: "s0",
      at: 0,
      label: tr("Preparación"),
      notes: "",
      state: {
        ...emptyStepState(),
        players: DUEL_ROLES.map((role, i) => ({
          id: `p${i}`,
          role,
          label: role,
          // Repartidos a lo ancho de la base, con margen en los bordes: pegados al borde
          // del lienzo las fichas caen sobre el fondo, fuera del trazado del mapa.
          x: clamp(36 + i * 7),
          y: clamp(baseY),
        })),
      },
    }],
  };
}

/* ─────────────────────────────── Pasos ─────────────────────────────── */

/** Devuelve una estrategia nueva con el paso `index` transformado. Nada se muta. */
export function updateStep(strat: Strat, index: number, fn: (s: StepState) => StepState): Strat {
  if (index < 0 || index >= strat.steps.length) return strat;
  return {
    ...strat,
    steps: strat.steps.map((st, i) => (i === index ? { ...st, state: fn(st.state) } : st)),
  };
}

/**
 * Añade un paso SEMBRÁNDOLO con el estado del anterior.
 *
 * Es lo que convierte la secuencia en algo usable: el paso 2 empieza donde acabó el 1 y el
 * entrenador solo mueve lo que cambia. La copia es profunda, así que los dos pasos son
 * independientes desde el primer instante.
 */
export function addStep(strat: Strat, label?: string, at?: number): Strat {
  if (strat.steps.length >= MAX_STEPS) return strat;
  const previo = strat.steps[strat.steps.length - 1];
  const n = strat.steps.length + 1;
  return {
    ...strat,
    steps: [...strat.steps, {
      id: uid("s"),
      at: Math.max(0, Math.round(at ?? (previo?.at ?? 0) + 15)),
      label: label ?? tr("Paso {n}", { n }),
      notes: "",
      state: previo ? cloneStepState(previo.state) : emptyStepState(),
    }],
  };
}

/** Quita un paso. El primero no se borra: una estrategia sin pasos no es una estrategia. */
export function removeStep(strat: Strat, index: number): Strat {
  if (index <= 0 || index >= strat.steps.length) return strat;
  return { ...strat, steps: strat.steps.filter((_, i) => i !== index) };
}

export function renameStep(strat: Strat, index: number, label: string, notes?: string): Strat {
  if (index < 0 || index >= strat.steps.length) return strat;
  return {
    ...strat,
    steps: strat.steps.map((st, i) =>
      i === index ? { ...st, label: label.slice(0, 60), notes: (notes ?? st.notes).slice(0, 400) } : st),
  };
}

/* ─────────────────────── Objetos dentro de un paso ─────────────────────── */

export function addPlayer(state: StepState, role: RoleId, x: number, y: number): StepState {
  if (state.players.length >= TEAM_SIZE) return state;
  return {
    ...state,
    players: [...state.players, { id: uid("p"), role, label: role, x: clamp(x), y: clamp(y) }],
  };
}

export function addUtility(state: StepState, kind: UtilityKind, x: number, y: number): StepState {
  if (state.utilities.length >= MAX_UTILITIES) return state;
  return {
    ...state,
    utilities: [...state.utilities, {
      id: uid("u"), kind, label: UTILITY_LABEL[kind], x: clamp(x), y: clamp(y),
    }],
  };
}

export function addDrawing(state: StepState, kind: DrawKind, color: DrawColor, points: Point[]): StepState {
  if (state.drawings.length >= MAX_DRAWINGS || points.length < 2) return state;
  return {
    ...state,
    drawings: [...state.drawings, {
      id: uid("d"), kind, color, points: points.slice(0, MAX_POINTS).map(clampPoint),
    }],
  };
}

export function addAnnotation(state: StepState, text: string, x: number, y: number): StepState {
  if (state.annotations.length >= MAX_ANNOTATIONS) return state;
  return {
    ...state,
    annotations: [...state.annotations, {
      id: uid("a"), text: text.slice(0, 120), x: clamp(x), y: clamp(y),
    }],
  };
}

/** Mueve cualquier objeto del paso por su id. El id `${id}::to` mueve la punta de su flecha. */
export function moveObject(state: StepState, id: string, x: number, y: number): StepState {
  const punta = id.endsWith("::to");
  const real = punta ? id.slice(0, -4) : id;
  const p = { x: clamp(x), y: clamp(y) };

  return {
    players: state.players.map((o) =>
      o.id !== real ? o : punta ? { ...o, to: p } : { ...o, ...p }),
    utilities: state.utilities.map((o) =>
      o.id !== real ? o : punta ? { ...o, to: p } : { ...o, ...p }),
    drawings: state.drawings.map((d) => {
      if (!d.id.startsWith(real)) return d;
      // Los vértices de un dibujo se mueven como `${id}::0`, `${id}::1`…
      const m = id.match(/^(.+)::(\d+)$/);
      if (!m || m[1] !== d.id) return d;
      const i = Number(m[2]);
      return { ...d, points: d.points.map((pt, k) => (k === i ? p : pt)) };
    }),
    annotations: state.annotations.map((o) => (o.id === real ? { ...o, ...p } : o)),
  };
}

/** Quita un objeto por su id, sea del tipo que sea. */
export function removeObject(state: StepState, id: string): StepState {
  return {
    players: state.players.filter((o) => o.id !== id),
    utilities: state.utilities.filter((o) => o.id !== id),
    drawings: state.drawings.filter((o) => o.id !== id),
    annotations: state.annotations.filter((o) => o.id !== id),
  };
}

/** Fija (o quita, con `null`) el destino de una ficha. */
export function setTarget(state: StepState, id: string, to: Point | null): StepState {
  const set = <T extends { id: string; to?: Point }>(o: T): T =>
    o.id === id ? { ...o, to: to ? clampPoint(to) : undefined } : o;
  return {
    ...state,
    players: state.players.map(set),
    utilities: state.utilities.map(set),
  };
}

/** Cuántos objetos tácticos tiene un paso. Para los topes y para la interfaz. */
export const countObjects = (s: StepState): number =>
  s.players.length + s.utilities.length + s.drawings.length + s.annotations.length;

/* ─────────────────────────────── Validación ─────────────────────────────── */

export interface StratIssue {
  code: "MAP_UNKNOWN" | "TEAM_SIZE" | "ROLE_DUPLICATE" | "AGENT_DUPLICATE" | "OUT_OF_BOUNDS" | "NO_STEPS" | "TOO_MANY";
  message: string;
}

const dentro = (p: { x: number; y: number }) => p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 100;

/**
 * Comprueba que una estrategia es coherente ANTES de guardarla.
 *
 * No juzga si es buena —eso no lo puede saber nadie desde aquí—, solo si está bien formada.
 * La misma función la ejecutan el editor y el servidor, así que un cliente modificado no
 * puede guardar una estrategia rota.
 */
export function validateStrat(strat: Strat): { ok: boolean; issues: StratIssue[] } {
  const issues: StratIssue[] = [];

  if (!getTacticalMap(strat.mapId)) {
    issues.push({ code: "MAP_UNKNOWN", message: tr("El mapa «{mapId}» no existe", { mapId: strat.mapId }) });
  }

  if (strat.steps.length === 0) {
    issues.push({ code: "NO_STEPS", message: tr("Una estrategia necesita al menos un paso") });
  }
  if (strat.steps.length > MAX_STEPS) {
    issues.push({ code: "TOO_MANY", message: tr("Una estrategia admite {MAX_STEPS} pasos como mucho", { MAX_STEPS }) });
  }

  strat.steps.forEach((st, i) => {
    const n = i + 1;
    if (st.state.players.length > TEAM_SIZE) {
      issues.push({ code: "TEAM_SIZE", message: tr("El paso {n} tiene {length} jugadores y el tope son {TEAM_SIZE}", { n, length: st.state.players.length, TEAM_SIZE }) });
    }
    const roles = st.state.players.map((p) => p.role);
    if (new Set(roles).size !== roles.length) {
      issues.push({ code: "ROLE_DUPLICATE", message: tr("El paso {n} repite un rol", { n }) });
    }
    // FULL GAME AUDIT (2026-10-07) · dos jugadores no pueden llevar el MISMO agente (como en las composiciones).
    const agents = st.state.players.map((p) => p.agentId).filter((a): a is string => typeof a === "string" && a.length > 0);
    if (new Set(agents).size !== agents.length) {
      issues.push({ code: "AGENT_DUPLICATE", message: tr("El paso {n} repite un agente", { n }) });
    }
    if (st.state.utilities.length > MAX_UTILITIES
      || st.state.drawings.length > MAX_DRAWINGS
      || st.state.annotations.length > MAX_ANNOTATIONS) {
      issues.push({ code: "TOO_MANY", message: tr("El paso {n} tiene demasiados elementos para leerse", { n }) });
    }

    const fuera =
      st.state.players.some((p) => !dentro(p) || (p.to && !dentro(p.to)))
      || st.state.utilities.some((u) => !dentro(u) || (u.to && !dentro(u.to)))
      || st.state.annotations.some((a) => !dentro(a))
      || st.state.drawings.some((d) => d.points.some((p) => !dentro(p)));
    if (fuera) {
      issues.push({ code: "OUT_OF_BOUNDS", message: tr("El paso {n} tiene elementos fuera del mapa", { n }) });
    }
  });

  return { ok: issues.length === 0, issues };
}

/* ─────────────────────────────── La frontera ─────────────────────────────── */

const num = (v: unknown, fallback = 0): number =>
  typeof v === "number" && Number.isFinite(v) ? clamp(v) : fallback;

const str = (v: unknown, max: number, fallback = ""): string =>
  typeof v === "string" ? v.slice(0, max) : fallback;

const point = (v: unknown): Point | undefined =>
  v && typeof v === "object" ? { x: num((v as Point).x), y: num((v as Point).y) } : undefined;

function sanitizeState(raw: unknown): StepState {
  const r = (raw ?? {}) as Partial<StepState>;

  const players: PlayerToken[] = (Array.isArray(r.players) ? r.players : [])
    .filter((p): p is PlayerToken => !!p && typeof p === "object")
    .slice(0, TEAM_SIZE)
    .map((p, i) => ({
      id: str(p.id, 40, `p${i}`),
      role: (DUEL_ROLES.includes(p.role as RoleId) ? p.role : DUEL_ROLES[i % DUEL_ROLES.length]) as RoleId,
      label: str(p.label, 40) || String(p.role ?? "Jugador"),
      x: num(p.x), y: num(p.y),
      // `to` se OMITE cuando no hay flecha, en vez de escribirse como `undefined`: así el
      // objeto saneado es idéntico al original y una comparación profunda no miente.
      ...(point(p.to) ? { to: point(p.to)! } : {}),
      /*
       * El agente se comprueba CONTRA EL CATÁLOGO, no se acepta como texto. Un `agentId` que
       * no existe se descarta en silencio: guardar un identificador inventado dejaría fichas
       * apuntando a nada, y la pizarra tendría que decidir qué enseñar en su lugar — que es
       * justo la clase de hueco que se rellena inventando.
       */
      ...(isKnownAgentId(str(p.agentId, 40)) ? { agentId: str(p.agentId, 40) } : {}),
    }));

  const utilities: UtilityToken[] = (Array.isArray(r.utilities) ? r.utilities : [])
    .filter((u): u is UtilityToken => !!u && typeof u === "object")
    .slice(0, MAX_UTILITIES)
    .map((u, i) => {
      const kind: UtilityKind = UTILITY_KINDS.includes(u.kind as UtilityKind)
        ? (u.kind as UtilityKind) : "marker";
      return {
        id: str(u.id, 40, `u${i}`),
        kind,
        label: str(u.label, 40) || UTILITY_LABEL[kind],
        x: num(u.x), y: num(u.y),
        ...(point(u.to) ? { to: point(u.to)! } : {}),
        // Misma regla que con el agente: solo pasa lo que existe en el catálogo de verdad.
        ...(isKnownAbilityId(str(u.abilityId, 40)) ? { abilityId: str(u.abilityId, 40) } : {}),
        ...(str(u.ownerId, 40) ? { ownerId: str(u.ownerId, 40) } : {}),
      };
    });

  const drawings: Drawing[] = (Array.isArray(r.drawings) ? r.drawings : [])
    .filter((d): d is Drawing => !!d && typeof d === "object" && Array.isArray(d.points))
    .slice(0, MAX_DRAWINGS)
    .map((d, i) => ({
      id: str(d.id, 40, `d${i}`),
      kind: (DRAW_KINDS.includes(d.kind as DrawKind) ? d.kind : "line") as DrawKind,
      // Un color fuera de la paleta es un campo de texto sin validar: se descarta.
      color: (DRAW_COLORS as readonly string[]).includes(d.color) ? d.color : DRAW_COLORS[0],
      points: d.points
        .filter((p): p is Point => !!p && typeof p === "object")
        .slice(0, MAX_POINTS)
        .map((p) => ({ x: num(p.x), y: num(p.y) })),
    }))
    .filter((d) => d.points.length >= 2);

  const annotations: Annotation[] = (Array.isArray(r.annotations) ? r.annotations : [])
    .filter((a): a is Annotation => !!a && typeof a === "object")
    .slice(0, MAX_ANNOTATIONS)
    .map((a, i) => ({
      id: str(a.id, 40, `a${i}`),
      text: str(a.text, 120),
      x: num(a.x), y: num(a.y),
    }))
    .filter((a) => a.text.trim().length > 0);

  return { players, utilities, drawings, annotations };
}

/**
 * Migra una estrategia del formato 1.
 *
 * En el formato 1 los marcadores eran una lista plana con un índice de paso: el marcador
 * «aparecía» en su paso y seguía existiendo después. Al reconstruirlo por pasos se aplica
 * esa misma regla —el paso `i` contiene todo lo que había aparecido hasta `i`—, así que
 * una estrategia vieja se abre enseñando lo mismo que enseñaba antes.
 *
 * Hoy no hay ninguna guardada, pero esto no cuesta nada y evita que un formato viejo se
 * pierda en silencio, que es exactamente lo que hace `sanitizeStrat` al devolver `null`.
 */
interface StratV1 {
  markers?: { id?: string; kind?: string; role?: string; label?: string; x?: number; y?: number; to?: Point; step?: number }[];
  steps?: { id?: string; at?: number; label?: string; notes?: string }[];
}

function migrateV1(raw: StratV1): { steps: StratStep[] } {
  const pasos = (Array.isArray(raw.steps) ? raw.steps : []).slice(0, MAX_STEPS);
  const marcadores = Array.isArray(raw.markers) ? raw.markers : [];
  const total = Math.max(1, pasos.length);

  const steps: StratStep[] = [];
  for (let i = 0; i < total; i++) {
    const p = pasos[i];
    const hasta = marcadores.filter((m) => (typeof m.step === "number" ? m.step : 0) <= i);
    steps.push({
      id: str(p?.id, 40, `s${i}`),
      at: typeof p?.at === "number" && Number.isFinite(p.at) ? Math.max(0, Math.min(180, Math.round(p.at))) : 0,
      label: str(p?.label, 60, `Paso ${i + 1}`),
      notes: str(p?.notes, 400),
      state: sanitizeState({
        players: hasta.filter((m) => m.kind === "player"),
        utilities: hasta.filter((m) => m.kind === "utility").map((m) => ({ ...m, kind: "marker" })),
        annotations: hasta.filter((m) => m.kind === "note").map((m) => ({ ...m, text: m.label })),
        drawings: [],
      }),
    });
  }
  return { steps };
}

/**
 * Sanea cualquier cosa que llegue de fuera y la convierte en un `Strat` bien formado.
 *
 * Es la puerta de entrada del servidor: lo que manda el cliente NO se guarda tal cual, se
 * reconstruye campo a campo. Un `x` de `"999"`, un color inventado, un paso de más o un
 * dibujo con mil vértices no llegan a la base de datos.
 */
export function sanitizeStrat(raw: unknown, fallbackId: string): Strat | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<Strat> & StratV1;

  const mapId = typeof r.mapId === "string" ? r.mapId : "";
  if (!getTacticalMap(mapId)) return null;

  const side: Side = r.side === "defense" ? "defense" : "attack";

  // Formato 1: lista plana de marcadores. Se reconstruye por pasos antes de sanear.
  const esV1 = Array.isArray(r.markers) && !(Array.isArray(r.steps) && r.steps.some((s) => s && "state" in s));

  let steps: StratStep[];
  if (esV1) {
    steps = migrateV1(r).steps;
  } else {
    steps = (Array.isArray(r.steps) ? r.steps : [])
      .filter((s): s is StratStep => !!s && typeof s === "object")
      .slice(0, MAX_STEPS)
      .map((s, i) => ({
        id: str(s.id, 40, `s${i}`),
        at: typeof s.at === "number" && Number.isFinite(s.at) ? Math.max(0, Math.min(600, Math.round(s.at))) : 0,
        label: str(s.label, 60, `Paso ${i + 1}`),
        notes: str(s.notes, 400),
        state: sanitizeState(s.state),
      }));
  }

  if (steps.length === 0) {
    steps = [{ id: "s0", at: 0, label: tr("Preparación"), notes: "", state: emptyStepState() }];
  }

  const tags = (Array.isArray(r.tags) ? r.tags : [])
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim().slice(0, 24))
    .filter((t) => t.length > 0)
    .slice(0, MAX_TAGS);

  return {
    id: typeof r.id === "string" && r.id.length > 0 ? r.id.slice(0, 64) : fallbackId,
    name: typeof r.name === "string" && r.name.trim().length > 0 ? r.name.trim().slice(0, 60) : "Estrategia",
    mapId,
    side,
    description: str(r.description, 600),
    tags,
    steps,
    notes: str(r.notes, 1000),
    version: STRAT_VERSION,
  };
}
