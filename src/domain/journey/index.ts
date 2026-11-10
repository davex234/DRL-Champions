/**
 * PLAYER JOURNEY 3.0 — PRIMERA SESIÓN (Fase 40) · DOMINIO PURO.
 *
 * «¿Dónde está este jugador en su primera experiencia?» se DERIVA de hechos persistidos que ya existen: cartas poseídas,
 * sobres abiertos (`user_game.packs_opened`), sobres sin abrir (`user_packs`), equipos guardados y legales
 * (`duel_decks` + validador canónico) y partidas terminadas (`duel_matches`, sin Draft). No hay estado de onboarding
 * guardado, ni banderas del cliente, ni `created_at`, ni `obtained_at`: una cuenta de hace tres meses que nunca jugó
 * sigue en su primera sesión, y una cuenta con partidas está COMPLETA aunque se creara ayer.
 *
 *   1 ABRE        hecho si ha abierto algún sobre o ya tiene cartas
 *   2 COLECCIONA  hecho si su colección YA PUEDE formar un equipo legal (o ya tiene uno)
 *   3 CONSTRUYE   hecho si tiene un equipo GUARDADO y legal
 *   4 JUEGA       hecho si ha terminado una partida (ganar, perder o empatar: vale igual)
 *
 * COMPLETA = ha terminado al menos una partida. Contrato explícito para cuentas antiguas: partidas sin equipo
 * (datos legacy) → COMPLETA; equipo sin partida → JUEGA; cartas sin sobres → no se pide abrir.
 *
 * Este módulo NO decide la prioridad de la home: produce la siguiente acción del recorrido y el Daily Loop la mete en
 * su motor único (`dailyCandidates` → `orderToday`), donde una partida a medias siempre gana.
 *
 * Sin React, sin red, sin reloj, sin azar.
 */
import type { RoleId } from "@/domain/cards/types";
import { DUEL_COMPOSITION, DUEL_ROLES } from "@/domain/cardgame/types";
import { ns, td } from "@/i18n/runtime";

const t = ns("journey");

/* ───────────────────────────── rutas reales ───────────────────────────── */

export const JOURNEY_ROUTES = {
  packRoute: (packId: string) => `/abrir/${encodeURIComponent(packId)}`,
  /** Fase 41 · el Sobre Inicial es gratis SOLO mientras la cuenta no puede formar plantilla (`domain/economy/starter`). */
  freePack: "/packs/inicial",
  /** La colección filtrada a lo POSEÍDO (`?tener=owned`, parámetro existente): «estas son tus cartas». */
  collection: "/coleccion?tener=owned",
  newDeck: "/duelos/mazos?nuevo=1",
  editDeck: (deckId: string) => `/duelos/mazos?deck=${encodeURIComponent(deckId)}`,
  /** Partida rápida PvE con el bot canónico FÁCIL preseleccionado (se puede cambiar en la pre-partida). */
  firstMatch: "/duelos/jugar?dificultad=EASY&primera=1",
  play: "/jugar",
} as const;

/** Id del sobre gratuito del catálogo. */
export const FREE_PACK_ID = "inicial";
/** Orden de preferencia del primer sobre: el de bienvenida primero. */
export const FIRST_PACK_PREFERENCE: readonly string[] = ["inicial", "estandar"];

/* ───────────────────────────── preparación del equipo ───────────────────────────── */

/** Lo mínimo de una carta para saber si la colección puede formar un equipo (catálogo del servidor). */
export interface ReadinessCard { playerId: string; role: RoleId; dataVersion: string; combat: boolean }

export interface RoleShortage { role: RoleId; have: number; need: number }

export interface DeckReadiness {
  /** ¿Existe AHORA un equipo legal con cartas poseídas? (2 jugadores distintos por rol, una sola versión de datos). */
  ready: boolean;
  /** Versión de datos con más cobertura (la que se usa para contar lo que falta). */
  dataVersion: string | null;
  /** Jugadores distintos por rol en esa versión (tope en lo necesario). */
  roles: RoleShortage[];
  /** Solo los roles incompletos. */
  shortages: RoleShortage[];
}

/**
 * La misma condición que satisface `autocomplete` del constructor (`domain/deckBuilder/builder.ts`): para alguna
 * versión de datos, cada rol puede cubrirse con `DUEL_COMPOSITION[rol]` jugadores con estadísticas de combate, y un
 * jugador ocupa UN solo hueco en todo el equipo. El verificador lo contrasta con el `autocomplete` real.
 *
 * F63 · EXACTO. Antes se contaban jugadores distintos POR ROL, por separado. Con el catálogo diseñado un jugador puede
 * tener cartas de dos roles (el rol de la CARTA manda) y contaba en los dos, así que salía «listo» un equipo imposible
 * (0,02 % de las cuentas nuevas simuladas: la guía decía «crea tu equipo», el constructor no podía y el Sobre Inicial
 * gratis se negaba porque «ya puedes»). Ahora es un emparejamiento jugador → hueco de rol (camino aumentante, 10 huecos):
 * `have` es lo que cubre la MEJOR asignación, así que lo que se enseña y el veredicto dicen siempre lo mismo.
 */
export function deckReadiness(cardIds: readonly string[], resolve: (cardId: string) => ReadinessCard | null): DeckReadiness {
  const byVersion = new Map<string, Map<string, Set<RoleId>>>();
  for (const id of new Set(cardIds)) {
    const c = resolve(id);
    if (!c || !c.combat || !(DUEL_ROLES as readonly string[]).includes(c.role)) continue;
    const players = byVersion.get(c.dataVersion) ?? new Map<string, Set<RoleId>>();
    byVersion.set(c.dataVersion, players);
    const roles = players.get(c.playerId) ?? new Set<RoleId>();
    players.set(c.playerId, roles);
    roles.add(c.role);
  }
  const covered = [...byVersion.entries()].map(([version, players]) => ({ version, have: assignRoles(players) }));
  const total = (h: Record<RoleId, number>) => DUEL_ROLES.reduce((s, r) => s + h[r], 0);
  const best = covered.sort((a, b) => total(b.have) - total(a.have) || (a.version < b.version ? -1 : a.version > b.version ? 1 : 0))[0] ?? null;
  const roles: RoleShortage[] = DUEL_ROLES.map((role) => ({ role, need: DUEL_COMPOSITION[role], have: best?.have[role] ?? 0 }));
  const shortages = roles.filter((r) => r.have < r.need);
  return { ready: best !== null && shortages.length === 0, dataVersion: best?.version ?? null, roles, shortages };
}

/** Máxima asignación jugador → hueco (2 por rol), cada jugador en UN hueco. Determinista (orden de ids). */
function assignRoles(players: Map<string, Set<RoleId>>): Record<RoleId, number> {
  const slots: RoleId[] = DUEL_ROLES.flatMap((r) => Array.from({ length: DUEL_COMPOSITION[r] }, () => r));
  const owner: (string | null)[] = slots.map(() => null);
  const ids = [...players.keys()].sort();
  const tryPlace = (pid: string, seen: Set<number>): boolean => {
    const roles = players.get(pid)!;
    for (let s = 0; s < slots.length; s++) {
      if (!roles.has(slots[s]) || seen.has(s)) continue;
      seen.add(s);
      if (owner[s] === null || tryPlace(owner[s]!, seen)) { owner[s] = pid; return true; }
    }
    return false;
  };
  for (const pid of ids) { if (owner.every((o) => o !== null)) break; tryPlace(pid, new Set()); }
  const have = Object.fromEntries(DUEL_ROLES.map((r) => [r, 0])) as Record<RoleId, number>;
  slots.forEach((r, s) => { if (owner[s] !== null) have[r]++; });
  return have;
}

/** Primer sobre del recorrido: determinista entre los que el jugador POSEE (nunca se crea uno). */
export function firstPackOf(owned: readonly { packId: string; qty: number }[]): string | null {
  const ids = owned.filter((p) => p.qty > 0).map((p) => p.packId);
  for (const pref of FIRST_PACK_PREFERENCE) if (ids.includes(pref)) return pref;
  return [...ids].sort()[0] ?? null;
}

/* ───────────────────────────── hechos y recorrido ───────────────────────────── */

export interface JourneyFacts {
  ownedCards: number;
  packsOpened: number;
  /** Partidas terminadas (PvE, campaña, PvP; nunca Draft). */
  matchesCompleted: number;
  unopenedPacks: number;
  /** Sobre que se propone abrir primero, o `null` si no posee ninguno. */
  firstPackId: string | null;
  decks: { total: number; valid: number; firstInvalid: { id: string; name: string; size: number } | null };
  /** Equipo legal guardado que se enseña en «Plantilla lista» (activo si lo hay). */
  readyDeck: { id: string; name: string; cardIds: string[]; active: boolean } | null;
  readiness: DeckReadiness;
}

export type JourneyStepId = "open" | "collect" | "build" | "play";
export const JOURNEY_STEPS: readonly JourneyStepId[] = ["open", "collect", "build", "play"];

export const STEP_COPY: Record<JourneyStepId, { verb: string; line: string }> = {
  open: { verb: "Abre", line: "Tu colección empieza aquí." },
  collect: { verb: "Colecciona", line: "Cada carta representa un jugador real." },
  build: { verb: "Construye", line: "Forma un equipo legal de diez cartas." },
  play: { verb: "Juega", line: "Pon tu equipo a prueba." },
};

export interface JourneyStep { id: JourneyStepId; index: number; verb: string; line: string; done: boolean; current: boolean }

export interface JourneyNextAction {
  step: JourneyStepId;
  eyebrow: string;
  title: string;
  detail: string;
  cta: string;
  href: string;
  /** Un segundo camino real (p. ej. «Ver mi colección»), o `null`. */
  secondary: { label: string; href: string } | null;
}

export interface PlayerJourney {
  status: "ACTIVE" | "COMPLETE";
  steps: JourneyStep[];
  currentStep: JourneyStepId | null;
  completedSteps: JourneyStepId[];
  progress: { value: number; max: number; label: string };
  isComplete: boolean;
  /** Nada hecho todavía: la home enseña la bienvenida (termina sola al abrir el primer sobre). */
  welcome: boolean;
  /** Explorar por libre siempre es posible: el recorrido nunca bloquea nada. */
  canSkip: boolean;
  /** Acaba de terminar su PRIMERA partida: la home enseña «Primera sesión completada» y los destinos. */
  justCompleted: boolean;
  nextAction: JourneyNextAction | null;
  context: {
    unopenedPacks: number;
    firstPackId: string | null;
    shortages: RoleShortage[];
    roles: RoleShortage[];
    readyDeck: JourneyFacts["readyDeck"];
  };
}

export const shortageLabel = (s: readonly RoleShortage[]) => s.map((x) => `${x.need - x.have} ${x.role}`).join(" · ");

export function buildPlayerJourney(f: JourneyFacts): PlayerJourney {
  const complete = f.matchesCompleted > 0;
  const done: Record<JourneyStepId, boolean> = {
    open: f.packsOpened > 0 || f.ownedCards > 0 || f.decks.valid > 0 || complete,
    collect: f.readiness.ready || f.decks.valid > 0 || complete,
    build: f.decks.valid > 0 || complete,
    play: complete,
  };
  const current = complete ? null : JOURNEY_STEPS.find((s) => !done[s]) ?? null;
  const steps: JourneyStep[] = JOURNEY_STEPS.map((id, index) => ({
    id, index: index + 1, verb: STEP_COPY[id].verb, line: STEP_COPY[id].line, done: done[id], current: id === current,
  }));
  const completedSteps = JOURNEY_STEPS.filter((s) => done[s]);
  return {
    status: complete ? "COMPLETE" : "ACTIVE",
    steps,
    currentStep: current,
    completedSteps,
    progress: { value: completedSteps.length, max: JOURNEY_STEPS.length, label: `${completedSteps.length}/${JOURNEY_STEPS.length}` },
    isComplete: complete,
    welcome: !complete && !done.open,
    canSkip: true,
    justCompleted: f.matchesCompleted === 1,
    nextAction: current ? nextActionFor(current, f) : null,
    context: {
      unopenedPacks: f.unopenedPacks, firstPackId: f.firstPackId,
      shortages: f.readiness.shortages, roles: f.readiness.roles, readyDeck: f.readyDeck,
    },
  };
}

function nextActionFor(step: JourneyStepId, f: JourneyFacts): JourneyNextAction {
  // Fase 63 · el MISMO contador que la guía (`domain/onboarding`: bienvenida + estos cuatro + progreso = 6 pasos).
  const eyebrow = t("Tu inicio · {v}/6 · {verb}", { v: JOURNEY_STEPS.indexOf(step) + 2, verb: td(STEP_COPY[step].verb) });
  const openHref = f.firstPackId ? JOURNEY_ROUTES.packRoute(f.firstPackId) : JOURNEY_ROUTES.freePack;
  switch (step) {
    case "open":
      return f.firstPackId
        ? { step, eyebrow, title: t("Abre tu primer sobre"), detail: f.unopenedPacks === 1 ? t("Tienes {n} sobre esperando. Cada carta es un jugador real con sus estadísticas.", { n: f.unopenedPacks }) : t("Tienes {n} sobres esperando. Cada carta es un jugador real con sus estadísticas.", { n: f.unopenedPacks }), cta: t("Abrir mi primer sobre"), href: openHref, secondary: null }
        : { step, eyebrow, title: t("Consigue tu primer sobre"), detail: t("El Sobre Inicial es gratis. Ábrelo y empieza tu colección."), cta: t("Conseguir Sobre Inicial gratis"), href: JOURNEY_ROUTES.freePack, secondary: null };
    case "collect": {
      const missing = shortageLabel(f.readiness.shortages);
      return f.unopenedPacks > 0
        ? { step, eyebrow, title: t("Sigue abriendo sobres"), detail: f.unopenedPacks === 1 ? t("Para tu equipo te faltan jugadores distintos: {missing}. Te queda {n} sobre.", { missing: td(missing), n: f.unopenedPacks }) : t("Para tu equipo te faltan jugadores distintos: {missing}. Te quedan {n} sobres.", { missing: td(missing), n: f.unopenedPacks }), cta: f.unopenedPacks === 1 ? t("Abrir mi último sobre") : t("Abrir el siguiente sobre"), href: openHref, secondary: { label: t("Ver mi colección"), href: JOURNEY_ROUTES.collection } }
        : { step, eyebrow, title: t("Completa tu equipo"), detail: t("Consigue las cartas que te faltan para completar tu equipo. Te faltan jugadores distintos: {missing}. Mientras no puedas formarla, el Sobre Inicial es gratis y sus primeras cartas son de esos roles.", { missing: td(missing) }), cta: t("Conseguir Sobre Inicial gratis"), href: JOURNEY_ROUTES.freePack, secondary: { label: t("Ver mi colección"), href: JOURNEY_ROUTES.collection } };
    }
    case "build":
      return f.decks.firstInvalid
        ? { step, eyebrow, title: t("Termina tu primer equipo"), detail: t("«{name}» tiene {size}/10 cartas. Dos por rol, sin repetir jugador. Guárdalo cuando esté completo.", { name: f.decks.firstInvalid.name, size: f.decks.firstInvalid.size }), cta: t("Ir al constructor"), href: JOURNEY_ROUTES.editDeck(f.decks.firstInvalid.id), secondary: { label: t("Ver mi colección"), href: JOURNEY_ROUTES.collection } }
        : { step, eyebrow, title: t("Construye tu primer equipo"), detail: t("Ya tienes cartas para un equipo legal: diez cartas, dos por rol. Complétala tú o con «Completar equipo»."), cta: t("Ir al constructor"), href: JOURNEY_ROUTES.newDeck, secondary: { label: t("Ver mi colección"), href: JOURNEY_ROUTES.collection } };
    case "play":
      return { step, eyebrow, title: f.readyDeck ? t("Equipo listo") : t("Juega tu primer combate"), detail: t("Diez turnos contra el bot Fácil. Ganes o pierdas, habrás jugado el núcleo de NEXUS."), cta: t("Jugar mi primer combate"), href: JOURNEY_ROUTES.firstMatch, secondary: null };
  }
}

/* ───────────────────────────── después: destinos reales ───────────────────────────── */

export interface DiscoveryDestination { id: string; title: string; line: string; href: string }

/** Destinos que EXISTEN hoy (rutas probadas en el contrato). Sin eventos inventados: el directo va aparte. */
export const DISCOVERY: readonly DiscoveryDestination[] = [
  { id: "campaign", title: "Road to Champions", line: "Avanza por una campaña de combates contra equipos reales.", href: "/jugar/road-to-champions" },
  { id: "draft", title: "Draft Gauntlet", line: "Construye un equipo temporal carta a carta.", href: "/jugar/draft-gauntlet" },
  { id: "competitive", title: "Competitivo", line: "Juega contra personas y construye tu rating.", href: "/duelos/competitivo" },
  { id: "collection", title: "Colección", line: "Completa jugadores, variantes y sets.", href: "/coleccion" },
  { id: "season", title: "Temporada", line: "Consulta objetivos, pase y progreso.", href: "/temporada" },
];

/* ───────────────────────────── primer combate: reglas exactas del motor ───────────────────────────── */

/**
 * Texto del primer combate. Refleja `duel-combat-2` (`combat/resolver.ts`): turno empatado = nadie puntúa; al final,
 * turnos → suma de OVR (+1 punto) → total de estadística declarada (sin punto) → empate.
 */
export const FIRST_MATCH_RULES: readonly { title: string; text: string }[] = [
  { title: "Diez turnos", text: "Cada turno juegas una carta de tu equipo. Una carta usada no vuelve." },
  { title: "Ataca y defiende", text: "Quien ataca elige la estadística; quien defiende responde con la que impone la tabla del juego. El ataque alterna." },
  { title: "Gana el valor mayor", text: "El valor más alto se lleva el punto del turno. Si empatan, nadie puntúa." },
  { title: "El final", text: "Gana quien más turnos se lleva. Si empatan: suma de OVR de los equipos (da un punto); si sigue igual, total de estadística declarada (sin punto); si no, empate." },
];
