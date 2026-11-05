/**
 * FASE 63 · ONBOARDING 5.0 — LA PRIMERA SESIÓN DEL JUGADOR · DOMINIO PURO.
 *
 * ══════════════════════════ DE DÓNDE SALE EL ESTADO ══════════════════════════
 *
 * El recorrido NO se guarda: se DERIVA de hechos reales que ya persiste el juego (el mismo `JourneyFacts` de la Fase 40:
 * sobres abiertos, cartas poseídas, equipos guardados y legales, partidas terminadas). Si el jugador ya abrió un sobre,
 * nunca se le pide abrirlo otra vez; si ya tiene equipo, nunca se le pide montarlo. El servidor manda.
 *
 * Solo hay TRES cosas que no se pueden deducir de los hechos del juego, y son acuses del jugador, no progreso:
 *
 *   startedAt   pulsó EMPEZAR en la bienvenida        → la home deja de enseñar la bienvenida y pasa a sus recursos
 *   skippedAt   eligió «Saltar tutorial»               → la guía se apaga (sin conceder nada)
 *   finishedAt  pulsó SEGUIR JUGANDO tras su progreso  → la guía termina
 *
 * Viven en `auth.users.app_metadata.nx_onboarding` (lo escribe SOLO el servidor con service_role; el cliente no puede).
 * Ninguno concede nada: el starter lo concede el alta (`handle_new_user`, una vez por cuenta) y las recompensas las
 * partidas, los sobres y los reclamos de siempre. Por eso marcar «completado» a mano no da nada a nadie.
 *
 * ══════════════════════════ LOS SEIS PASOS ══════════════════════════
 *
 *   1 welcome     Bienvenida y recursos      hecho: pulsó EMPEZAR, o ya hizo algo en el juego
 *   2 open        Tu primer sobre            hecho: ha abierto un sobre (o ya tiene cartas)
 *   3 collection  Tu colección               hecho: sus cartas YA forman un equipo legal (o ya tiene uno)
 *   4 deck        Tu primer equipo           hecho: tiene un equipo guardado y legal
 *   5 match       Tu primera partida         hecho: ha terminado una partida (ganar, perder o empatar: vale igual)
 *   6 progress    Tu progreso                hecho: pulsó SEGUIR JUGANDO, o ya ha jugado dos partidas
 *
 * ══════════════════════════ QUIÉN VE LA GUÍA ══════════════════════════
 *
 *   COMPLETED   terminó (finishedAt) · la saltó (skippedAt) · jugó SIN haber empezado la guía (cuentas anteriores a la
 *               Fase 63 con partidas, o quien encontró el camino solo) · o ya lleva dos partidas (nunca una cárcel)
 *   NOT_STARTED nada hecho en el juego y no pulsó EMPEZAR → bienvenida
 *   IN_PROGRESS el resto → «Continúa tu inicio · Paso X/6»
 *
 * No se usa `created_at`: una cuenta de hace meses que nunca hizo nada es, de hecho, un jugador nuevo, y una cuenta de
 * ayer con partidas no lo es.
 *
 * Sin React, sin red, sin reloj propio (la hora entra como argumento), sin azar.
 */
import { JOURNEY_ROUTES, type JourneyFacts, type RoleShortage } from "@/domain/journey";
import { ns, td } from "@/i18n/runtime";

const tr = ns("onboarding");

export const ONBOARDING_VERSION = 1 as const;

/** Clave dentro de `app_metadata` (namespaced para no pisar `provider`/`providers` de GoTrue). */
export const ONBOARDING_METADATA_KEY = "nx_onboarding" as const;

/* ───────────────────────────── acuses ───────────────────────────── */

export interface OnboardingFlags {
  startedAt: number | null;
  skippedAt: number | null;
  finishedAt: number | null;
}

export const NO_FLAGS: OnboardingFlags = Object.freeze({ startedAt: null, skippedAt: null, finishedAt: null });

const toMs = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.floor(v);
  if (typeof v === "string" && v.length <= 40) {
    const t = Date.parse(v);
    return Number.isFinite(t) && t > 0 ? t : null;
  }
  return null;
};

/** Lee los acuses de `app_metadata` con tolerancia: cualquier cosa rara cuenta como «no hecho». */
export function parseOnboardingFlags(appMetadata: unknown): OnboardingFlags {
  if (!appMetadata || typeof appMetadata !== "object") return { ...NO_FLAGS };
  const raw = (appMetadata as Record<string, unknown>)[ONBOARDING_METADATA_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...NO_FLAGS };
  const o = raw as Record<string, unknown>;
  return { startedAt: toMs(o.startedAt), skippedAt: toMs(o.skippedAt), finishedAt: toMs(o.finishedAt) };
}

/** Lo que se escribe en `app_metadata` (fechas ISO, versión del contrato). */
export function onboardingMetadata(f: OnboardingFlags): Record<typeof ONBOARDING_METADATA_KEY, Record<string, unknown>> {
  const iso = (n: number | null) => (n === null ? null : new Date(n).toISOString());
  return { [ONBOARDING_METADATA_KEY]: { v: ONBOARDING_VERSION, startedAt: iso(f.startedAt), skippedAt: iso(f.skippedAt), finishedAt: iso(f.finishedAt) } };
}

/* ───────────────────────────── pasos ───────────────────────────── */

export type OnboardingStepId = "welcome" | "open" | "collection" | "deck" | "match" | "progress";
export const ONBOARDING_STEPS: readonly OnboardingStepId[] = ["welcome", "open", "collection", "deck", "match", "progress"];
export const ONBOARDING_TOTAL = ONBOARDING_STEPS.length;

/**
 * Cada paso: objetivo, condición REAL de completado (documentada, la evalúa `stepDone`), CTA y ruta de reanudación.
 * Terminología del producto: carta, sobre, colección, equipo, partida, XP de cuenta, XP de temporada, objetivo.
 */
export const STEP_DEFS: Record<OnboardingStepId, { title: string; objective: string; doneWhen: string; resume: string }> = {
  welcome: { title: "Bienvenida", objective: "Saber qué es NEXUS y qué tienes para empezar.", doneWhen: "Pulsar EMPEZAR o haber hecho algo en el juego.", resume: "/" },
  open: { title: "Tu primer sobre", objective: "Abrir un sobre que ya es tuyo.", doneWhen: "Un sobre abierto o cartas en la colección.", resume: "/abrir/<primer sobre>" },
  collection: { title: "Tu colección", objective: "Reunir dos jugadores distintos de cada rol.", doneWhen: "Tus cartas ya forman un equipo legal.", resume: "/coleccion?tener=owned" },
  deck: { title: "Tu primer equipo", objective: "Tener un equipo de 10 cartas guardado.", doneWhen: "Un equipo guardado y legal.", resume: "/" },
  match: { title: "Tu primera partida", objective: "Jugar una partida contra un bot.", doneWhen: "Una partida terminada (ganar, perder o empatar).", resume: "/duelos/jugar?dificultad=EASY&primera=1" },
  progress: { title: "Tu progreso", objective: "Ver qué ha avanzado con tu partida.", doneWhen: "Pulsar SEGUIR JUGANDO o jugar una segunda partida.", resume: "/cuenta?seccion=progresion" },
};

/** Rutas reales del recorrido (todas existen antes de la Fase 63). */
export const ONBOARDING_ROUTES = {
  home: "/",
  packRoute: JOURNEY_ROUTES.packRoute,
  freePack: JOURNEY_ROUTES.freePack,
  collection: JOURNEY_ROUTES.collection,
  manualDeck: JOURNEY_ROUTES.newDeck,
  firstMatch: JOURNEY_ROUTES.firstMatch,
  progress: "/cuenta?seccion=progresion",
  play: "/jugar",
  guide: "/como-jugar",
} as const;

/**
 * PRIMER SOBRE DE LA GUÍA: el Bronce (`estandar`) y después los Iniciales. Decidido por simulación (motor real, catálogo
 * y pools reales, 20.000 cuentas, `qa/fase63-onboarding/starter-contract.json`): abriendo el Bronce primero, los tres
 * Iniciales llegan con la asistencia de rol de F41 mejor informada y el 99,97 % forma equipo SOLO con los 4 sobres de
 * bienvenida (Iniciales primero: 94,0 %). Es el ORDEN que propone la guía; el jugador puede abrir el que quiera.
 */
export const GUIDE_FIRST_PACK = "estandar";

/** Sobre que la guía propone abrir: el Bronce si aún no ha abierto nada y lo tiene; si no, el del recorrido (F40). */
export function guidePackOf(j: JourneyFacts, starter: StarterSnapshot | null): string | null {
  if (j.packsOpened === 0 && starter?.packs.some((p) => p.packId === GUIDE_FIRST_PACK && p.qty > 0)) return GUIDE_FIRST_PACK;
  return j.firstPackId;
}

/** Nombre del equipo que se crea con «Crear mi primer equipo». Cabe en `DECK_NAME_RE`. */
export const FIRST_TEAM_NAME = "Mi primer equipo";

/* ───────────────────────────── hechos y vista ───────────────────────────── */

export interface StarterSnapshot {
  /**
   * Saldo REAL (`profiles.credits`), solo en `GET /api/game/onboarding` (lectura personal). La foto del vestíbulo NO lo
   * lleva (contrato de privacidad de F36): allí la portada usa el saldo del estado del juego, el mismo del HUD.
   */
  credits?: number | null;
  /** Sobres sin abrir REALES (`user_packs`, qty > 0). */
  packs: { packId: string; qty: number }[];
}

export interface OnboardingFacts {
  journey: JourneyFacts;
  flags: OnboardingFlags;
  starter: StarterSnapshot | null;
}

export type OnboardingStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
export type CompletionReason = "FINISHED" | "SKIPPED" | "SELF_GUIDED" | "PLAYING";

export interface OnboardingStep {
  id: OnboardingStepId;
  index: number;
  title: string;
  objective: string;
  done: boolean;
  current: boolean;
}

/** Acción del servidor que dispara el CTA (si no, es un enlace). */
export type OnboardingCommand = "start" | "skip" | "resume" | "finish" | "first-team";
export const ONBOARDING_COMMANDS: readonly OnboardingCommand[] = ["start", "skip", "resume", "finish", "first-team"];

export interface OnboardingNext {
  step: OnboardingStepId;
  title: string;
  detail: string;
  cta: string;
  /** Destino del CTA. Con `command`, el destino tras ejecutarlo. */
  href: string;
  command: OnboardingCommand | null;
  secondary: { label: string; href: string } | null;
}

export interface OnboardingView {
  version: typeof ONBOARDING_VERSION;
  status: OnboardingStatus;
  reason: CompletionReason | null;
  /** ¿Se enseña la guía? (en curso o por empezar). Tras completarla: nunca. */
  active: boolean;
  steps: OnboardingStep[];
  current: OnboardingStepId | null;
  /** «Paso X/6» (X = el paso actual; completado = 6/6). */
  progress: { value: number; max: number; label: string };
  next: OnboardingNext | null;
  starter: StarterSnapshot | null;
  context: {
    firstPackId: string | null;
    unopenedPacks: number;
    ownedCards: number;
    packsOpened: number;
    matchesCompleted: number;
    readiness: { ready: boolean; roles: RoleShortage[]; shortages: RoleShortage[] };
    readyDeck: JourneyFacts["readyDeck"];
    hasInvalidDeck: boolean;
  };
  /** Puede saltarse ahora (solo con la guía activa). */
  canSkip: boolean;
  /** La saltó y aún puede retomarla (no la habría completado por otra vía). */
  canResume: boolean;
}

const activityOf = (j: JourneyFacts) => j.packsOpened > 0 || j.ownedCards > 0 || j.decks.total > 0 || j.matchesCompleted > 0;

/** Condición REAL de cada paso. Única fuente: la usan la vista, el servidor y los tests. */
export function stepDone(id: OnboardingStepId, j: JourneyFacts, f: OnboardingFlags): boolean {
  const played = j.matchesCompleted > 0;
  switch (id) {
    case "welcome": return f.startedAt !== null || activityOf(j);
    case "open": return j.packsOpened > 0 || j.ownedCards > 0 || j.decks.valid > 0 || played;
    case "collection": return j.readiness.ready || j.decks.valid > 0 || played;
    case "deck": return j.decks.valid > 0 || played;
    case "match": return played;
    case "progress": return f.finishedAt !== null || j.matchesCompleted >= 2;
  }
}

/** Estado sin tener en cuenta el salto (sirve para saber si «Retomar la guía» tiene sentido). */
function baseStatus(j: JourneyFacts, f: OnboardingFlags): { status: OnboardingStatus; reason: CompletionReason | null } {
  if (f.finishedAt !== null) return { status: "COMPLETED", reason: "FINISHED" };
  if (j.matchesCompleted > 0 && f.startedAt === null) return { status: "COMPLETED", reason: "SELF_GUIDED" };
  if (j.matchesCompleted >= 2) return { status: "COMPLETED", reason: "PLAYING" };
  if (f.startedAt === null && !activityOf(j)) return { status: "NOT_STARTED", reason: null };
  return { status: "IN_PROGRESS", reason: null };
}

export function onboardingStatus(j: JourneyFacts, f: OnboardingFlags): { status: OnboardingStatus; reason: CompletionReason | null } {
  const base = baseStatus(j, f);
  if (base.status !== "COMPLETED" && f.skippedAt !== null) return { status: "COMPLETED", reason: "SKIPPED" };
  return base;
}

export const missingRolesLabel = (s: readonly RoleShortage[]) => s.map((x) => `${x.need - x.have} ${x.role}`).join(" · ");

function nextFor(step: OnboardingStepId, j: JourneyFacts, starter: StarterSnapshot | null): OnboardingNext {
  const pack = guidePackOf(j, starter);
  const openHref = pack ? ONBOARDING_ROUTES.packRoute(pack) : ONBOARDING_ROUTES.freePack;
  switch (step) {
    case "welcome":
      return { step, title: tr("Bienvenida a NEXUS"), detail: tr("Colecciona cartas de jugadores reales, forma tu equipo y juega."), cta: tr("Empezar"), href: ONBOARDING_ROUTES.home, command: "start", secondary: null };
    case "open":
      return pack
        ? { step, title: tr("Abre tu primer sobre"), detail: tr("Los sobres añaden cartas a tu colección."), cta: tr("Abrir mi primer sobre"), href: openHref, command: null, secondary: null }
        : { step, title: tr("Consigue tu primer sobre"), detail: tr("El Sobre Inicial es gratis mientras no puedas formar tu equipo."), cta: tr("Conseguir Sobre Inicial"), href: ONBOARDING_ROUTES.freePack, command: null, secondary: null };
    case "collection": {
      const missing = missingRolesLabel(j.readiness.shortages);
      return j.unopenedPacks > 0
        ? { step, title: tr("Completa tu colección"), detail: j.unopenedPacks === 1 ? tr("Tu equipo necesita 2 jugadores distintos de cada rol. Te faltan: {missing}. Te queda {n} sobre.", { missing: td(missing), n: j.unopenedPacks }) : tr("Tu equipo necesita 2 jugadores distintos de cada rol. Te faltan: {missing}. Te quedan {n} sobres.", { missing: td(missing), n: j.unopenedPacks }), cta: j.unopenedPacks === 1 ? tr("Abrir mi último sobre") : tr("Abrir el siguiente sobre"), href: openHref, command: null, secondary: { label: tr("Ver mi colección"), href: ONBOARDING_ROUTES.collection } }
        : { step, title: tr("Completa tu colección"), detail: tr("Te faltan jugadores distintos: {missing}. Mientras no puedas formar tu equipo, el Sobre Inicial es gratis y sus primeras cartas son de esos roles.", { missing: td(missing) }), cta: tr("Conseguir Sobre Inicial"), href: ONBOARDING_ROUTES.freePack, command: null, secondary: { label: tr("Ver mi colección"), href: ONBOARDING_ROUTES.collection } };
    }
    case "deck":
      return { step, title: tr("Crea tu primer equipo"), detail: tr("Tu equipo tiene 10 cartas: 2 de cada rol y sin repetir jugador. Lo montamos con tus mejores cartas; después puedes cambiarlo."), cta: tr("Crear mi primer equipo"), href: ONBOARDING_ROUTES.home, command: "first-team", secondary: { label: tr("Montarlo yo"), href: ONBOARDING_ROUTES.manualDeck } };
    case "match":
      return { step, title: tr("Tu equipo está listo"), detail: tr("Diez turnos contra un bot. Ganes o pierdas, cuenta igual."), cta: tr("Jugar mi primera partida"), href: ONBOARDING_ROUTES.firstMatch, command: null, secondary: null };
    case "progress":
      return { step, title: tr("Mira tu progreso"), detail: tr("Tus partidas suman XP de cuenta y avanzan tus objetivos."), cta: tr("Ver mi progreso"), href: ONBOARDING_ROUTES.progress, command: null, secondary: null };
  }
}

export function buildOnboarding(facts: OnboardingFacts): OnboardingView {
  const { journey: j, flags: f } = facts;
  const { status, reason } = onboardingStatus(j, f);
  const active = status !== "COMPLETED";
  const done = Object.fromEntries(ONBOARDING_STEPS.map((s) => [s, stepDone(s, j, f)])) as Record<OnboardingStepId, boolean>;
  const current = active ? ONBOARDING_STEPS.find((s) => !done[s]) ?? null : null;
  const index = current ? ONBOARDING_STEPS.indexOf(current) + 1 : ONBOARDING_TOTAL;
  const base = baseStatus(j, f);
  return {
    version: ONBOARDING_VERSION,
    status,
    reason,
    active,
    steps: ONBOARDING_STEPS.map((id, i) => ({
      id, index: i + 1, title: STEP_DEFS[id].title, objective: STEP_DEFS[id].objective,
      done: active ? done[id] : true, current: id === current,
    })),
    current,
    progress: { value: index, max: ONBOARDING_TOTAL, label: `${index}/${ONBOARDING_TOTAL}` },
    next: current ? nextFor(current, j, facts.starter) : null,
    starter: facts.starter,
    context: {
      firstPackId: guidePackOf(j, facts.starter),
      unopenedPacks: j.unopenedPacks,
      ownedCards: j.ownedCards,
      packsOpened: j.packsOpened,
      matchesCompleted: j.matchesCompleted,
      readiness: { ready: j.readiness.ready, roles: j.readiness.roles, shortages: j.readiness.shortages },
      readyDeck: j.readyDeck,
      hasInvalidDeck: j.decks.firstInvalid !== null,
    },
    canSkip: active,
    canResume: reason === "SKIPPED" && base.status !== "COMPLETED",
  };
}

/* ───────────────────────────── órdenes del jugador ───────────────────────────── */

export type FlagDecision =
  | { ok: true; changed: boolean; flags: OnboardingFlags }
  | { ok: false; status: 400 | 409; code: "BAD_COMMAND" | "NOT_YET" | "NOT_SKIPPED"; error: string };

/**
 * Decide qué hace una orden de ACUSE con los hechos del servidor. Idempotente: repetirla no cambia nada (`changed:false`).
 * `first-team` no pasa por aquí: toca equipos, no acuses (lo hace el servicio con el validador canónico).
 *
 *   start   marca la bienvenida vista (solo la primera vez; con la guía completada no escribe)
 *   skip    apaga la guía (solo si está activa); NO concede nada
 *   resume  deshace el salto, solo si la guía no está completada por otra vía
 *   finish  cierra la guía; exige una partida TERMINADA en la base de datos (no se puede fingir desde el cliente)
 */
export function decideFlags(command: OnboardingCommand, j: JourneyFacts, f: OnboardingFlags, now: number): FlagDecision {
  const same = { ok: true as const, changed: false, flags: f };
  const { status } = onboardingStatus(j, f);
  switch (command) {
    case "start":
      if (f.startedAt !== null || status === "COMPLETED") return same;
      return { ok: true, changed: true, flags: { ...f, startedAt: now } };
    case "skip":
      if (status === "COMPLETED") return same;
      return { ok: true, changed: true, flags: { ...f, skippedAt: now } };
    case "resume": {
      if (f.skippedAt === null) return same;
      if (baseStatus(j, f).status === "COMPLETED") return { ok: false, status: 409, code: "NOT_SKIPPED", error: tr("Tu inicio ya está completado.") };
      return { ok: true, changed: true, flags: { ...f, skippedAt: null, startedAt: f.startedAt ?? now } };
    }
    case "finish":
      if (f.finishedAt !== null) return same;
      if (j.matchesCompleted < 1) return { ok: false, status: 409, code: "NOT_YET", error: tr("Juega tu primera partida antes de terminar el inicio.") };
      return { ok: true, changed: true, flags: { ...f, finishedAt: now, startedAt: f.startedAt ?? now } };
    case "first-team":
      return { ok: false, status: 400, code: "BAD_COMMAND", error: tr("Orden no válida") };
  }
}

/** Cuerpo estricto de `POST /api/game/onboarding`: `{ action }` y nada más. */
export function parseOnboardingRequest(body: unknown): { ok: true; command: OnboardingCommand } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: tr("Cuerpo no válido") };
  const keys = Object.keys(body as object);
  if (keys.length !== 1 || keys[0] !== "action") return { ok: false, error: tr("Cuerpo no válido") };
  const a = (body as { action: unknown }).action;
  if (typeof a !== "string" || !(ONBOARDING_COMMANDS as readonly string[]).includes(a)) return { ok: false, error: tr("Orden no válida") };
  return { ok: true, command: a as OnboardingCommand };
}

/* ───────────────────────────── primera partida: ayuda contextual ───────────────────────────── */

/**
 * Ayuda de la PRIMERA partida, solo la primera vez que el jugador ataca y la primera vez que defiende. Refleja las reglas
 * del motor (`duel-combat-2`): el atacante elige carta y estadística; el defensor responde con la que impone la tabla
 * (Stronghold ↔ Entryfrag, Gamesense ↔ Gamesense); gana el turno el valor más alto; empate = nadie puntúa. No revela
 * nada oculto: habla de reglas, no de la carta del rival.
 */
export type MatchHintId = "attack" | "defend";

export const MATCH_HINTS: Record<MatchHintId, { title: string; lines: readonly string[] }> = {
  attack: {
    title: "Atacas",
    lines: [
      "Elige una carta y una de sus tres estadísticas de combate: SH, GS o EF.",
      "Comparamos esa estadística con la del rival. El valor más alto gana el turno.",
    ],
  },
  defend: {
    title: "Defiendes",
    lines: [
      "El rival ya eligió estadística. Tú respondes con la que marca la tabla: SH contra EF, GS contra GS.",
      "Elige la carta que mejor la defienda. Si empatáis, nadie puntúa.",
    ],
  },
};

/** ¿Qué ayuda toca en este turno? Solo en la primera partida, una vez por papel. */
export function matchHintFor(
  view: { status: string; youAreAttacker: boolean },
  seen: ReadonlySet<MatchHintId>,
): MatchHintId | null {
  if (view.status !== "IN_PROGRESS") return null;
  const id: MatchHintId = view.youAreAttacker ? "attack" : "defend";
  return seen.has(id) ? null : id;
}
