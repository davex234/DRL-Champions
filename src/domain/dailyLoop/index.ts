/**
 * DAILY GAME LOOP 2.0 — DOMINIO PURO (Fase 36).
 *
 * Responde a la pregunta del vestíbulo —«¿qué hago AHORA?»— a partir de HECHOS que ya sirven otros
 * sistemas (partida activa, retos, pase/objetivos/logros, Pick'ems, sobres, colección, equipos, Road to
 * Champions, rating, Live Events, calendario de temporada). No es un sistema nuevo:
 *
 *   hechos (servidor) ──► `dailyCandidates` ──► `orderToday` (LA prioridad de la home, `domain/progression/meta`)
 *                                                   └─► primaryAction + secondaryActions
 *
 * Reglas que sostienen la fase (probadas en `dailyLoop.test.ts`):
 *   · Una partida a medias SIEMPRE gana (rango 0), también el combate de un Draft Gauntlet.
 *   · Fase 40 · PLAYER JOURNEY: mientras la primera sesión no está completa, su siguiente paso (`domain/journey`,
 *     derivado de hechos) va justo detrás (`ftue`, rango 0.5) y sustituye a las sugerencias de sobres, equipo y modos.
 *   · Un subsistema que no se pudo leer (`null`) no propone nada: nunca se recomienda lo que está caído.
 *   · Nada de cifras sin denominador, «en directo» sin partido en directo, recompensas no reclamables,
 *     rangos/divisiones inventados, rachas, bonus de entrada ni monedas nuevas.
 *   · Desempate: dentro del mismo rango manda el ORDEN DE ENTRADA de este fichero (documentado en
 *     `docs/product/daily-loop-priority.md`).
 *
 * Sin React, sin red, sin `Date.now()`: el reloj (`now`) llega del servidor.
 */
import {
  orderToday, nearObjective, liveObjective, objectivePct,
  type MetaObjective, type TodayAction,
} from "@/domain/progression/meta";
import { buildPlayerJourney, type JourneyFacts, type JourneyStepId, type PlayerJourney } from "@/domain/journey";
import { DRAFT_MATCH_HREF, DRAFT_ROUTE, GAUNTLET_STAGES } from "@/domain/draft/rules";
import { getPack } from "@/data/packs";
import {
  allDone, expiringItems, ledgerRecent, objectiveCards, recentProgress, remainingText, resetWindows, returningContext, rewardText, urgencyOf,
  type ExpiringItem, type ObjectiveCard, type RecentFact, type ResetWindows, type ReturningContext, type Urgency,
} from "@/domain/liveService";
import { PLACEMENT_GAMES } from "@/domain/cardgame/rating/types";
import type { SeasonPresentation } from "@/domain/season/calendar";
import { ns, td } from "@/i18n/runtime";

const t = ns("dailyLoop");

/* ───────────────────────────── rutas (todas existen: lo prueba el contrato) ───────────────────────────── */

export const DAILY_ROUTES = {
  account: "/cuenta",
  play: "/jugar",
  quick: "/duelos/jugar",
  pvp: "/duelos/pvp",
  competitive: "/duelos/competitivo",
  campaign: "/jugar/road-to-champions",
  challenges: "/social?tab=retos",
  claims: "/logros",
  objectives: "/misiones", // IA 2026-10-07 · Temporada → Objetivos
  pickems: "/pickems",
  inventory: "/inventario",
  store: "/tienda",
  packs: "/packs",
  decks: "/duelos/mazos",
  newDeck: "/duelos/mazos?nuevo=1",
  season: "/temporada",
  events: "/torneos",
  collection: "/coleccion",
  profile: "/jugador/me",
} as const;

export const campaignNodeRoute = (nodeId: string) => `${DAILY_ROUTES.campaign}?node=${encodeURIComponent(nodeId)}`;
/** Retomar la partida de un nodo (misma ruta que «Retomar» del mapa, `campaignPlayHref`). */
export const campaignPlayRoute = (nodeId: string) => `${DAILY_ROUTES.quick}?campaign=${encodeURIComponent(nodeId)}`;
export const pvpMatchRoute = (matchId: string) => `${DAILY_ROUTES.pvp}?match=${encodeURIComponent(matchId)}`;
export const deckEditRoute = (deckId: string) => `${DAILY_ROUTES.decks}?deck=${encodeURIComponent(deckId)}`;
export const eventRoute = (eventId: string) => `${DAILY_ROUTES.events}/${encodeURIComponent(eventId)}`;

/* ───────────────────────────── hechos ───────────────────────────── */

export const DAILY_SUBSYSTEMS = [
  "match", "social", "progression", "pickems", "packs", "decks", "campaign", "competitive", "live", "season",
] as const;
export type DailySubsystem = (typeof DAILY_SUBSYSTEMS)[number];

export type ActiveMatchMode = "RANKED" | "PRIVATE" | "CAMPAIGN" | "PVE" | "DRAFT";
export type Difficulty = "EASY" | "NORMAL" | "HARD";

export interface ActiveMatchFact {
  id: string;
  mode: ActiveMatchMode;
  /** Solo PvE. */
  difficulty: Difficulty | null;
  /** Nombre PÚBLICO del rival humano (PvP) o `null`. Nunca cartas, mano ni estado de la partida. */
  opponent: string | null;
  /** Road to Champions: el nodo del intento abierto. */
  node: { id: string; name: string } | null;
}

export interface DeckFact { id: string; name: string; valid: boolean; size: number; sumOvr: number }

export interface LiveEventFact {
  id: string;
  name: string;
  lifecycle: "UPCOMING" | "ACTIVE" | "COMPLETED";
  isDemo: boolean;
  startDate: string | null;
  endDate: string | null;
  liveCount: number;
  liveMatch: { teamA: string | null; teamB: string | null; scoreA: number | null; scoreB: number | null } | null;
  nextMatch: { teamA: string | null; teamB: string | null; startTime: string | null } | null;
  /** Solo con sesión. `null` si el evento no tiene Pick'em. */
  pickem: { open: number; pending: number } | null;
}

export interface SeasonFact {
  id: string;
  name: string;
  status: "UPCOMING" | "ACTIVE" | "ENDED";
  presentation: SeasonPresentation;
  startsAtMs: number;
  endsAtMs: number;
}

export interface PassFact {
  level: number;
  maxLevel: number;
  /** XP del PASE (no la de cuenta). */
  xp: number;
  xpIntoLevel: number;
  xpForNext: number;
  /** 0..1 */
  progress: number;
  nextReward: { level: number; track: "free" | "competitive"; label: string } | null;
}

/** Recompensa del pase en palabras, SOLO con lo que su definición fija. */
export function rewardLabel(r: { credits?: number; xp?: number; packId?: string; packCount?: number; cardId?: string; materials?: object; cosmetics?: readonly string[] } & Record<string, unknown>, packName: (id: string) => string): string {
  const parts: string[] = [];
  if (r.packId) parts.push(`${(r.packCount ?? 1) > 1 ? `${r.packCount} × ` : ""}${packName(r.packId)}`);
  if (r.credits && r.credits > 0) parts.push(t("{n} créditos", { n: r.credits }));
  if (r.cardId) parts.push(t("una carta"));
  if (r.xp && r.xp > 0) parts.push(t("{xp} XP de cuenta", { xp: r.xp }));
  if (r.materials && Object.keys(r.materials).length > 0) parts.push(t("materiales"));
  if (Array.isArray(r.cosmetics) && r.cosmetics.length > 0) parts.push(r.cosmetics.length === 1 ? t("un cosmético") : t("{n} cosméticos", { n: r.cosmetics.length }));
  return parts.join(" + ") || t("Recompensa del pase");
}

export interface DailyLoopFacts {
  now: number;
  signedIn: boolean;
  /** `null` = no se pudo leer. `[]` = ninguna partida abierta. */
  matches: ActiveMatchFact[] | null;
  social: { incoming: number; from: string | null } | null;
  progression: {
    /** Nivel de CUENTA (`profiles.xp`). */
    account: { level: number; xp: number; xpIntoLevel: number; xpForNext: number; progress: number };
    /** `null` si el pase vivo no es el de la temporada del calendario. */
    pass: PassFact | null;
    /** Niveles del pase reclamables AHORA en Logros (cualquier carril), con o sin temporada en calendario. */
    claimableLevels: number;
    objectives: MetaObjective[];
    achievements: { total: number; claimed: number; claimable: number; near: { id: string; name: string; current: number; goal: number } | null };
    /** Hay tandas de una ventana anterior: se renuevan al abrir Objetivos (esta lectura no las rota). */
    rotationPending: boolean;
    metrics: { ownedCards: number; distinctCards: number; packsOpened: number; duelsPlayed: number };
  } | null;
  /** `nextLockAt` (Fase 42): cierre real más próximo de una predicción pendiente del usuario, o `null`. */
  pickems: { pending: number; open: number; eventId: string | null; eventName: string | null; nextLockAt?: number | null } | null;
  packs: { unopened: number } | null;
  decks: { total: number; valid: number; active: DeckFact | null; firstInvalid: DeckFact | null } | null;
  /**
   * Fase 40 · hechos de la primera sesión (`domain/journey`). `null` si alguno de sus núcleos (progresión, sobres,
   * equipos) no se pudo leer: entonces no se guía nada (nunca se adivina el paso).
   */
  journey?: JourneyFacts | null;
  campaign: { completed: number; total: number; complete: boolean; next: { nodeId: string; name: string; team: string; chapterOrder: number } | null } | null;
  /** Ficha ranked PERSISTIDA (`duel_pvp_ratings`). `rating: null` = nunca ha jugado (no se crea la ficha al leer). */
  competitive: { rating: number | null; gamesPlayed: number; wins: number; losses: number; draws: number; provisional: boolean; position: number | null; rankedTotal: number; recent: ("WIN" | "LOSS" | "DRAW")[] } | null;
  live: LiveEventFact[] | null;
  season: { current: SeasonFact | null; next: SeasonFact | null } | null;
  catalogSize: number;
  /**
   * Fase 42 · run de Draft Gauntlet ACTIVA fuera de combate (DRAFTING / READY). `null` = no hay; `undefined` = no se
   * leyó. El combate en curso ya llega como partida (`matches`, modo DRAFT).
   */
  draftRun?: { id: string; status: "DRAFTING" | "READY"; stage: number } | null;
  /**
   * Fase 42 · actividad REAL reciente (asientos del libro mayor, aperturas, partidas y presencia, con marcas del
   * servidor): última actividad y hasta 5 hechos. `null` = no se pudo leer.
   */
  activity?: { lastActivityAt: number | null; recent: RecentFact[] } | null;
}

/* ───────────────────────────── acciones ───────────────────────────── */

export type DailyActionId =
  | "resume-ranked" | "resume-private" | "resume-campaign" | "resume-pve" | "resume-draft" | "resume-draft-run"
  | "challenge" | "journey-open" | "journey-collect" | "journey-build" | "journey-play"
  | "claim" | "predict" | "objective" | "open"
  | "get-cards" | "create-team" | "edit-team"
  | "campaign" | "ranked" | "quick" | "play-hub"
  | "live" | "sign-in" | "fallback";

export interface DailyAction extends TodayAction {
  id: DailyActionId;
  /** Contexto corto sobre el título («ROAD TO CHAMPIONS · CAPÍTULO 1»). */
  eyebrow: string;
  /** Lo concreto («Nodo Primer contacto · contra NAVI»). */
  title: string;
  /** El verbo del botón («Continuar Road to Champions»). Igual que `label`. */
  cta: string;
  /** Progreso con denominador REAL, o `null`. */
  progress: { value: number; max: number; label: string } | null;
  source: DailySubsystem | "account" | "fallback" | "draft";
  /** Fase 42 · «¿por qué esto?»: una razón corta y VERDADERA, derivada de los mismos hechos. */
  reason?: string;
  /** Fase 42 · fin real de lo que propone (Pick'em, objetivo, recompensa), si lo tiene. */
  endsAt?: number | null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const DIFFICULTY_LABEL: Record<Difficulty, string> = { EASY: "Fácil", NORMAL: "Normal", HARD: "Difícil" };
/** Frases ENTERAS por tipo de objetivo (el adjetivo no se inserta suelto: su sitio cambia con el idioma). */
const nearEyebrow = (kind: string): string =>
  kind === "daily" ? t("Objetivo diario casi completado")
    : kind === "weekly" ? t("Objetivo semanal casi completado")
      : kind === "seasonal" ? t("Objetivo de temporada casi completado")
        : kind === "progressive" ? t("Objetivo de progreso casi completado")
          : t("Objetivo casi completado");
const kindDetail = (kind: string): string =>
  kind === "daily" ? t("Objetivo diario")
    : kind === "weekly" ? t("Objetivo semanal")
      : kind === "seasonal" ? t("Objetivo de temporada")
        : kind === "progressive" ? t("Objetivo de progreso")
          : t("Objetivo");

/** Dónde se avanza un objetivo, según la métrica REAL que mide. Sin métrica conocida, a Objetivos. */
export function objectiveRoute(metric: string): string {
  if (/^duels?_|^wins?_/.test(metric)) return DAILY_ROUTES.play;
  if (/^pvp_|^ranked_/.test(metric)) return DAILY_ROUTES.competitive;
  if (/^packs?_/.test(metric)) return DAILY_ROUTES.inventory;
  if (/cards|collection/.test(metric)) return DAILY_ROUTES.collection;
  if (/^decks?_/.test(metric)) return DAILY_ROUTES.decks;
  if (/^picks?_|pickem|prediction|^points$/.test(metric)) return DAILY_ROUTES.pickems;
  if (/^region_/.test(metric)) return DAILY_ROUTES.account;
  return DAILY_ROUTES.objectives;
}

/** Objetivos que se pueden reclamar DE VERDAD: completos, sin reclamar y de una tanda viva. */
export const claimableObjectives = (list: readonly MetaObjective[], now: number) =>
  list.filter((o) => o.complete && !o.claimed && liveObjective(o, now));

export type DeckState = "READY" | "INVALID" | "NONE";
export function deckState(d: DailyLoopFacts["decks"]): DeckState | null {
  if (!d) return null;
  if (d.valid > 0) return "READY";
  return d.total === 0 ? "NONE" : "INVALID";
}

/**
 * Fase 44 · la partida que el armazón ofrece retomar («CONTINUAR PARTIDA» global). Es la MISMA acción y el MISMO
 * orden que el vestíbulo: todas las partidas abiertas tienen rango 0 en `orderToday` y el desempate es el orden de
 * entrada (`readActiveMatches`: PvP, luego PvE/campaña, luego draft). No es una segunda prioridad: es la primera.
 */
export function primaryResume(matches: readonly ActiveMatchFact[] | null): DailyAction | null {
  return matches && matches.length > 0 ? resumeAction(matches[0]) : null;
}

function resumeAction(m: ActiveMatchFact): DailyAction {
  const base = { kind: "resume" as const, urgent: true, progress: null, source: "match" as const, cta: t("Continuar partida"), label: t("Continuar partida") };
  switch (m.mode) {
    case "RANKED":
      return { ...base, id: "resume-ranked", eyebrow: t("Competitivo · partida en curso"), title: m.opponent ? t("Contra {opponent}", { opponent: m.opponent }) : t("Tu partida ranked sigue abierta"), detail: t("Una partida contra otra persona está sin terminar."), href: pvpMatchRoute(m.id) };
    case "PRIVATE":
      return { ...base, id: "resume-private", eyebrow: t("Reto privado · partida en curso"), title: m.opponent ? t("Contra {opponent}", { opponent: m.opponent }) : t("Tu duelo privado sigue abierto"), detail: t("Un duelo privado está sin terminar. No cuenta para el rating."), href: pvpMatchRoute(m.id) };
    case "CAMPAIGN":
      return { ...base, id: "resume-campaign", eyebrow: t("Road to Champions · partida en curso"), title: m.node ? t("Nodo «{name}»", { name: m.node.name }) : t("Tu nodo sigue en marcha"), detail: t("Termina la partida para liquidar el nodo."), href: m.node ? campaignPlayRoute(m.node.id) : DAILY_ROUTES.quick };
    case "DRAFT":
      return { ...base, id: "resume-draft", eyebrow: t("Draft Gauntlet · combate en curso"), title: t("Tu combate del gauntlet sigue abierto"), detail: t("Termínalo para avanzar la run."), href: DRAFT_MATCH_HREF };
    default:
      return { ...base, id: "resume-pve", eyebrow: t("Partida rápida · en curso"), title: m.difficulty ? t("Contra el bot · {v}", { v: td(DIFFICULTY_LABEL[m.difficulty]) }) : t("Tu duelo contra el bot sigue abierto"), detail: t("Tienes una partida sin terminar."), href: DAILY_ROUTES.quick };
  }
}

const RESUME_ORDER: Record<ActiveMatchMode, number> = { RANKED: 0, PRIVATE: 1, CAMPAIGN: 2, PVE: 3, DRAFT: 4 };

const JOURNEY_KIND: Record<JourneyStepId, TodayAction["kind"]> = { open: "open", collect: "open", build: "build", play: "play" };

/** Fase 40 · la siguiente acción del recorrido, como un candidato más del motor único. */
export function journeyAction(j: PlayerJourney): DailyAction | null {
  const n = j.nextAction;
  if (!n) return null;
  return {
    id: `journey-${n.step}` as DailyActionId, kind: JOURNEY_KIND[n.step], ftue: true, eyebrow: n.eyebrow, title: n.title, detail: n.detail,
    cta: n.cta, label: n.cta, href: n.href, progress: { value: j.progress.value, max: j.progress.max, label: j.progress.label },
    source: n.step === "build" || n.step === "play" ? "decks" : "packs",
  };
}

/** El recorrido de la primera sesión, o `null` si sus hechos no se pudieron leer. */
export const journeyOf = (f: DailyLoopFacts): PlayerJourney | null => (f.signedIn && f.journey ? buildPlayerJourney(f.journey) : null);

/**
 * Candidatos a acción, en ORDEN DE ENTRADA (= desempate dentro del mismo rango). `orderToday` decide el resto.
 */
export function dailyCandidates(f: DailyLoopFacts): DailyAction[] {
  const out: DailyAction[] = [];
  // Fase 42 · solo un directo REAL se recomienda: un evento de demostración (datos semilla, a veces con un partido
  // «live» ya caducado) se sigue viendo en su bloque con la etiqueta «Demo», pero nunca como acción del vestíbulo.
  const liveNow = (f.live ?? []).find((e) => e.lifecycle === "ACTIVE" && e.liveCount > 0 && !e.isDemo) ?? null;
  const liveAction = (): DailyAction | null => liveNow ? {
    id: "live", kind: "explore", eyebrow: t("En directo"), title: liveNow.name,
    detail: liveNow.liveMatch ? `${liveNow.liveMatch.teamA ?? t("Por determinar")} vs ${liveNow.liveMatch.teamB ?? t("Por determinar")}` : plural(liveNow.liveCount, t("partido en directo"), t("partidos en directo")),
    cta: t("Ver en directo"), label: t("Ver en directo"), href: eventRoute(liveNow.id), progress: null, source: "live",
  } : null;

  if (!f.signedIn) {
    out.push({ id: "sign-in", kind: "play", eyebrow: t("NEXUS · duelos de cartas"), title: t("Entra y empieza tu colección"), detail: t("Los duelos, la campaña y el competitivo se juegan con cuenta."), cta: t("Entrar para jugar"), label: t("Entrar para jugar"), href: DAILY_ROUTES.account, progress: null, source: "account" });
    const l = liveAction(); if (l) out.push(l);
    return out;
  }

  // 1 · Partidas a medias: PvP ranked > privada > nodo de campaña > PvE.
  const matches = [...(f.matches ?? [])].sort((a, b) => RESUME_ORDER[a.mode] - RESUME_ORDER[b.mode]);
  for (const m of matches) out.push(resumeAction(m));
  // 1b · Fase 42 · run de Draft fuera de combate: importante, pero detrás de cualquier partida abierta (rango 0,7).
  if (f.draftRun) {
    const r = f.draftRun;
    out.push({ id: "resume-draft-run", kind: "run", eyebrow: t("Draft Gauntlet · run en curso"), title: r.status === "DRAFTING" ? t("Termina de elegir tu plantilla") : t("Fase {stage} de {GAUNTLET_STAGES}: tu siguiente combate", { stage: r.stage, GAUNTLET_STAGES }), detail: r.status === "DRAFTING" ? t("Tu draft está a medias. Retómalo donde lo dejaste.") : t("Tu plantilla está lista para el siguiente rival."), cta: t("Volver al Draft"), label: t("Volver al Draft"), href: DRAFT_ROUTE, progress: { value: Math.max(0, r.stage - (r.status === "READY" ? 1 : 0)), max: GAUNTLET_STAGES, label: t("{n} / {GAUNTLET_STAGES} fases", { n: Math.max(0, r.stage - (r.status === "READY" ? 1 : 0)), GAUNTLET_STAGES }) }, source: "draft" });
  }
  const activePve = matches.some((m) => m.mode === "PVE" || m.mode === "CAMPAIGN");
  const activePvp = matches.some((m) => m.mode === "RANKED" || m.mode === "PRIVATE");

  // 2 · Retos recibidos.
  if (f.social && f.social.incoming > 0) {
    const n = f.social.incoming;
    out.push({ id: "challenge", kind: "challenge", eyebrow: t("Reto privado"), title: f.social.from ? (n === 1 ? t("Reto de {from}", { from: td(f.social.from) }) : n === 2 ? t("Reto de {from} y {n} reto más", { from: td(f.social.from), n: n - 1 }) : t("Reto de {from} y {n} retos más", { from: td(f.social.from), n: n - 1 })) : plural(n, t("reto esperando respuesta"), t("retos esperando respuesta")), detail: t("Acepta o rechaza antes de que caduque."), cta: t("Responder reto"), label: t("Responder reto"), href: DAILY_ROUTES.challenges, count: n, urgent: true, progress: null, source: "social" });
  }

  const owned = f.progression?.metrics.ownedCards ?? null;
  const unopened = f.packs?.unopened ?? null;
  const journey = journeyOf(f);
  const guiding = journey !== null && !journey.isComplete;

  // 3 · Fase 40 · primera sesión: el siguiente paso real del recorrido (abre → colecciona → construye → juega).
  if (guiding) {
    const j = journeyAction(journey!);
    if (j) out.push(j);
  }

  // 4 · Recompensas reclamables (solo tandas vivas).
  if (f.progression) {
    const p = f.progression;
    const levels = p.claimableLevels;
    const missions = claimableObjectives(p.objectives, f.now).length;
    const achievements = p.achievements.claimable;
    const total = levels + missions + achievements;
    if (total > 0) {
      const claimEnds = claimableObjectives(p.objectives, f.now).map((o) => o.expiresAt).filter((x): x is number => x !== null);
      const claimEndsAt = claimEnds.length ? Math.min(...claimEnds) : null;
      const parts = [
        levels ? plural(levels, t("nivel del pase"), t("niveles del pase")) : null,
        missions ? plural(missions, t("objetivo"), t("objetivos")) : null,
        achievements ? plural(achievements, t("logro"), t("logros")) : null,
      ].filter(Boolean);
      out.push({ id: "claim", kind: "claim", eyebrow: t("Recompensas listas"), title: t("{parts} por reclamar", { parts: parts.join(" · ") }), detail: total === 1 ? t("Ya te lo has ganado: recógelo en Logros.") : t("Ya te las has ganado: recógelas en Logros y pase."), cta: achievements > 0 && levels === 0 && missions === 0 ? t("Reclamar logro") : t("Reclamar"), label: t("Reclamar"), href: DAILY_ROUTES.claims, count: total, progress: null, source: "progression", endsAt: claimEndsAt, urgency: urgencyOf(claimEndsAt, f.now) });
    }
  }

  // 5 · Pick'ems pendientes (caducan al bloquearse).
  if (f.pickems && f.pickems.pending > 0) {
    out.push({ id: "predict", kind: "predict", eyebrow: f.pickems.eventName ? t("Pick'ems · {eventName}", { eventName: td(f.pickems.eventName) }) : t("Pick'ems"), title: plural(f.pickems.pending, t("predicción sin hacer"), t("predicciones sin hacer")), detail: t("Se cierran cuando empieza cada partido."), cta: t("Haz tu predicción"), label: t("Haz tu predicción"), href: DAILY_ROUTES.pickems, count: f.pickems.pending, urgent: true, progress: null, source: "pickems", endsAt: f.pickems.nextLockAt ?? null, urgency: urgencyOf(f.pickems.nextLockAt, f.now) });
  }

  // 6 · Objetivo casi completado (regla pura y viva: `nearObjective`).
  if (f.progression) {
    const near = nearObjective(f.progression.objectives, f.now);
    if (near) {
      out.push({ id: "objective", kind: "objective", eyebrow: nearEyebrow(String(near.kind)), title: near.label, detail: near.goal - near.current === 1 ? t("Te falta {n} para completarlo.", { n: near.goal - near.current }) : t("Te faltan {n} para completarlo.", { n: near.goal - near.current }), cta: t("Completar objetivo"), label: t("Completar objetivo"), href: objectiveRoute(near.metric), urgent: near.expiresAt !== null, progress: { value: near.current, max: near.goal, label: `${near.current} / ${near.goal}` }, source: "progression", endsAt: near.expiresAt, urgency: urgencyOf(near.expiresAt, f.now) });
    }
  }

  // 7 · Sobres sin abrir (en la primera sesión, solo cuando el recorrido ya no está en abrir/coleccionar).
  if (unopened !== null && unopened > 0 && !(guiding && (journey!.currentStep === "open" || journey!.currentStep === "collect"))) {
    out.push({ id: "open", kind: "open", eyebrow: t("Sobres"), title: t("Tienes {unopened}", { unopened: plural(unopened, t("sobre sin abrir"), t("sobres sin abrir")) }), detail: t("Cada uno llena huecos de tu colección."), cta: unopened === 1 ? t("Abrir sobre") : t("Abrir {unopened} sobres", { unopened }), label: t("Abrir sobres"), href: DAILY_ROUTES.inventory, count: unopened, progress: null, source: "packs" });
  }

  // 8 · Equipo: sin uno legal no se juega.
  const ds = deckState(f.decks);
  if (!guiding && (ds === "NONE" || ds === "INVALID")) {
    if (owned !== null && owned < 10) {
      if ((unopened ?? 0) === 0) out.push({ id: "get-cards", kind: "build", eyebrow: t("Tu equipo"), title: t("Necesitas diez cartas para jugar"), detail: owned === 1 ? t("Tienes {n} carta. Consigue un sobre en la tienda.", { n: owned }) : t("Tienes {n} cartas. Consigue un sobre en la tienda.", { n: owned }), cta: t("Conseguir sobres"), label: t("Conseguir sobres"), href: DAILY_ROUTES.store, progress: { value: owned, max: 10, label: t("{n} / 10 cartas", { n: owned }) }, source: "decks" });
    } else if (ds === "NONE") {
      out.push({ id: "create-team", kind: "build", eyebrow: t("Tu equipo"), title: t("Todavía no tienes equipo"), detail: t("Diez cartas, dos por rol. Sin equipo no hay duelos."), cta: t("Crear equipo"), label: t("Crear equipo"), href: DAILY_ROUTES.newDeck, progress: null, source: "decks" });
    } else {
      const d = f.decks!.firstInvalid;
      out.push({ id: "edit-team", kind: "build", eyebrow: t("Tu equipo"), title: d ? t("«{name}» no está listo", { name: d.name }) : t("Tu equipo no está listo"), detail: t("Necesita diez cartas legales, dos por rol."), cta: t("Editar equipo"), label: t("Editar equipo"), href: d ? deckEditRoute(d.id) : DAILY_ROUTES.decks, progress: d ? { value: Math.min(d.size, 10), max: 10, label: `${d.size} / 10 cartas` } : null, source: "decks" });
    }
  }

  // 9 · Jugar: campaña a medias > competitivo > partida rápida. Sin equipo conocido, al hub de modos.
  if (guiding) {
    // Primera sesión: el recorrido ya propone el siguiente paso; los modos se descubren al terminarla.
  } else if (ds === "READY") {
    const c = f.campaign;
    if (c && !c.complete && c.next && !activePve) {
      out.push({ id: "campaign", kind: "play", eyebrow: t("Road to Champions · capítulo {chapterOrder}", { chapterOrder: c.next.chapterOrder }), title: `${c.next.name} · contra ${c.next.team}`, detail: t("{completed} de {total} nodos completados.", { completed: c.completed, total: c.total }), cta: c.completed === 0 ? t("Empezar Road to Champions") : t("Continuar Road to Champions"), label: t("Continuar Road to Champions"), href: campaignNodeRoute(c.next.nodeId), progress: { value: c.completed, max: c.total, label: `${c.completed} / ${c.total}` }, source: "campaign" });
    }
    const r = f.competitive;
    if (r && !activePvp) {
      const title = r.gamesPlayed === 0 ? t("Tu primera partida ranked")
        : r.provisional ? t("Provisional · {gamesPlayed} de {PLACEMENT_GAMES} partidas", { gamesPlayed: r.gamesPlayed, PLACEMENT_GAMES })
          : r.position !== null ? t("#{position} de {rankedTotal} · rating {rating}", { position: r.position, rankedTotal: r.rankedTotal, rating: r.rating }) : t("Rating {rating}", { rating: r.rating });
      out.push({ id: "ranked", kind: "play", eyebrow: t("Competitivo"), title, detail: r.gamesPlayed === 0 ? t("Contra otra persona, por rating.") : r.provisional ? t("Tu rating aún se está calibrando.") : t("Cada partida mueve tu rating."), cta: t("Jugar competitivo"), label: t("Jugar competitivo"), href: DAILY_ROUTES.pvp, progress: r.provisional && r.gamesPlayed > 0 ? { value: r.gamesPlayed, max: PLACEMENT_GAMES, label: `${r.gamesPlayed} / ${PLACEMENT_GAMES}` } : null, source: "competitive" });
    }
    if (!activePve) out.push({ id: "quick", kind: "play", eyebrow: t("Partida rápida"), title: t("Tu equipo contra un bot"), detail: t("Diez turnos. Elige la dificultad."), cta: t("Jugar partida rápida"), label: t("Jugar partida rápida"), href: DAILY_ROUTES.quick, progress: null, source: "decks" });
  } else if (ds === null && !activePve && !activePvp) {
    out.push({ id: "play-hub", kind: "play", eyebrow: t("Modos de juego"), title: t("Elige cómo jugar"), detail: t("Campaña, partida rápida, competitivo y retos."), cta: t("Jugar"), label: t("Jugar"), href: DAILY_ROUTES.play, progress: null, source: "fallback" });
  }

  // 10 · Lo que pasa en el circuito (solo si hay un partido EN DIRECTO de verdad).
  const l = liveAction(); if (l) out.push(l);
  return out;
}

export const FALLBACK_ACTION: DailyAction = {
  id: "fallback", kind: "play", eyebrow: "NEXUS", title: "Elige tu modo", detail: "Campaña, partida rápida, competitivo y retos.",
  cta: "Jugar", label: "Jugar", href: DAILY_ROUTES.play, progress: null, source: "fallback",
};

export const SECONDARY_MAX = 3;

/** EL ORQUESTADOR: una acción principal y hasta tres secundarias, con la prioridad única de la home. */
export function dailyActions(f: DailyLoopFacts): { primary: DailyAction; secondary: DailyAction[] } {
  const ordered = orderToday(dailyCandidates(f), 1 + SECONDARY_MAX).map((a) => ({ ...a, reason: reasonFor(a, f) }));
  return { primary: ordered[0] ?? { ...FALLBACK_ACTION, reason: reasonFor(FALLBACK_ACTION, f) }, secondary: ordered.slice(1) };
}

/** Objetivo diario/semanal VIVO y sin terminar que avanza jugando (para dar la razón de «jugar»). */
function playObjective(f: DailyLoopFacts): MetaObjective | null {
  const list = (f.progression?.objectives ?? []).filter((o) => (o.kind === "daily" || o.kind === "weekly") && !o.complete && !o.claimed && liveObjective(o, f.now) && /^duels_/.test(o.metric));
  list.sort((a, b) => (b.current / b.goal) - (a.current / a.goal) || (a.kind === "daily" ? -1 : 1) || a.id.localeCompare(b.id));
  return list[0] ?? null;
}

/**
 * FASE 42 · «¿POR QUÉ ESTO?». Una frase corta, verdadera y sin presión, derivada de los mismos hechos que eligieron la
 * acción. Nunca «última oportunidad» sin un fin real; nunca cifras sin denominador.
 */
export function reasonFor(a: DailyAction, f: DailyLoopFacts): string {
  const left = remainingText(a.endsAt ?? null, f.now);
  switch (a.id) {
    case "resume-ranked": case "resume-private": return t("Va antes que nada: hay otra persona en esa partida.");
    case "resume-campaign": case "resume-pve": case "resume-draft": return t("Va antes que nada: la dejaste a medias.");
    case "resume-draft-run": return t("Tu run de Draft Gauntlet sigue en curso.");
    case "challenge": return t("Un reto privado te espera y caduca si no respondes.");
    case "journey-open": case "journey-collect": case "journey-build": case "journey-play": return t("Es el siguiente paso de tu primera sesión.");
    case "claim": return left && a.urgency !== "NORMAL" ? t("Un objetivo completado se renueva en {left}: cóbralo antes.", { left: td(left) }) : t("Ya está ganado: un toque y es tuyo.");
    case "predict": return left ? t("Tu predicción pendiente cierra en {left}.", { left: td(left) }) : t("Hay predicciones abiertas que aún no has hecho.");
    case "objective": {
      // Por qué: lo que da al completarlo (recompensa REAL de su definición); el detalle ya dice cuánto falta.
      const o = f.progression?.objectives.find((x) => x.label === a.title && !x.claimed && !x.complete);
      const p = a.progress; const missing = p ? p.max - p.value : null;
      const base = o ? t("Completarlo te da {o}.", { o: rewardText(o, packDisplayName) }) : missing !== null ? (missing === 1 ? t("Te falta {missing} para completar «{title}».", { missing, title: td(a.title) }) : t("Te faltan {missing} para completar «{title}».", { missing, title: td(a.title) })) : t("Estás cerca de completar «{title}».", { title: td(a.title) });
      return left && a.urgency === "VERY_SOON" ? t("{base} Se renueva en {left}.", { base: td(base), left: td(left) }) : base;
    }
    case "open": return t("Tienes sobres sin abrir.");
    case "get-cards": case "create-team": case "edit-team": return t("Sin un equipo legal no se puede jugar.");
    case "campaign": case "ranked": case "quick": {
      const o = playObjective(f);
      if (o) {
        const missing = o.goal - o.current;
        return missing === 1 ? t("Avanza «{label}»: te falta {missing}.", { label: td(o.label), missing }) : t("Avanza «{label}»: te faltan {missing}.", { label: td(o.label), missing });
      }
      if (a.id === "campaign") return t("Tu campaña sigue donde la dejaste.");
      if (a.id === "ranked") {
        const r = f.competitive;
        if (r?.position) return t("Estás en el puesto {position} de {rankedTotal}.", { position: r.position, rankedTotal: r.rankedTotal });
        if (r?.provisional && r.gamesPlayed > 0) { const left = Math.max(0, PLACEMENT_GAMES - r.gamesPlayed); return left === 1 ? t("Te queda {left} para clasificarte.", { left }) : t("Te quedan {left} para clasificarte.", { left }); }
        return t("Tu rating sube o baja con cada partida.");
      }
      return t("Diez turnos contra el bot, cuando quieras.");
    }
    case "live": return t("Hay un partido en directo ahora mismo.");
    case "sign-in": return t("Los duelos se juegan con cuenta.");
    default: return t("Elige cómo quieres jugar.");
  }
}

/* ───────────────────────────── HOY: «¿qué puedo avanzar hoy?» ───────────────────────────── */

export type TodayItemStatus = "CLAIMABLE" | "NEAR" | "IN_PROGRESS" | "PENDING" | "AVAILABLE";

export interface TodayItem {
  id: string;
  kind: "objective" | "pickem" | "campaign" | "ranked" | "packs";
  label: string;
  detail: string;
  href: string;
  status: TodayItemStatus;
  progress: { value: number; max: number; label: string } | null;
  /** Fin de la ventana (servidor), o `null`. */
  expiresAt: number | null;
}

export const TODAY_MIN = 3;
export const TODAY_MAX = 5;

/**
 * 3–5 cosas que se pueden avanzar HOY, de datos reales: objetivos diarios/semanales vivos (reclamables,
 * casi completos y en progreso), Pick'ems pendientes, el siguiente nodo, la calibración ranked y los sobres.
 * Orden determinista. No repite el destino de la acción principal. Si hay menos de tres, se enseñan las que haya.
 */
export function todayItems(f: DailyLoopFacts, primary: DailyAction | null = null): TodayItem[] {
  if (!f.signedIn) return [];
  const items: TodayItem[] = [];
  const objectives = (f.progression?.objectives ?? []).filter((o) => (o.kind === "daily" || o.kind === "weekly") && !o.claimed && o.goal > 0 && liveObjective(o, f.now));
  const near = nearObjective(objectives, f.now);
  const rank = (o: MetaObjective) => (o.complete ? 0 : near && o.id === near.id ? 1 : 2);
  const sorted = [...objectives].sort((a, b) => rank(a) - rank(b) || (a.kind === b.kind ? 0 : a.kind === "daily" ? -1 : 1) || objectivePct(b) - objectivePct(a) || a.id.localeCompare(b.id));
  for (const o of sorted) {
    items.push({
      id: `objective:${o.id}`, kind: "objective", label: o.label,
      detail: o.complete ? t("Completado · recógelo en Logros") : kindDetail(String(o.kind)),
      href: o.complete ? DAILY_ROUTES.claims : objectiveRoute(o.metric),
      status: o.complete ? "CLAIMABLE" : near && o.id === near.id ? "NEAR" : "IN_PROGRESS",
      progress: { value: Math.min(o.current, o.goal), max: o.goal, label: `${Math.min(o.current, o.goal)} / ${o.goal}` },
      expiresAt: o.expiresAt,
    });
  }
  const extra: TodayItem[] = [];
  if (f.pickems && f.pickems.pending > 0) extra.push({ id: "pickem", kind: "pickem", label: f.pickems.eventName ? t("Pick'ems · {eventName}", { eventName: td(f.pickems.eventName) }) : t("Pick'ems"), detail: plural(f.pickems.pending, t("predicción pendiente"), t("predicciones pendientes")), href: DAILY_ROUTES.pickems, status: "PENDING", progress: null, expiresAt: null });
  const c = f.campaign;
  if (c && !c.complete && c.next && deckState(f.decks) === "READY") extra.push({ id: "campaign", kind: "campaign", label: t("Road to Champions · {name}", { name: c.next.name }), detail: t("Contra {team}", { team: c.next.team }), href: campaignNodeRoute(c.next.nodeId), status: "AVAILABLE", progress: { value: c.completed, max: c.total, label: `${c.completed} / ${c.total}` }, expiresAt: null });
  const r = f.competitive;
  if (r && r.gamesPlayed > 0 && r.provisional && deckState(f.decks) === "READY") extra.push({ id: "ranked", kind: "ranked", label: t("Calibración ranked"), detail: PLACEMENT_GAMES - r.gamesPlayed === 1 ? t("Te queda {n} para clasificarte", { n: PLACEMENT_GAMES - r.gamesPlayed }) : t("Te quedan {n} para clasificarte", { n: PLACEMENT_GAMES - r.gamesPlayed }), href: DAILY_ROUTES.pvp, status: "IN_PROGRESS", progress: { value: r.gamesPlayed, max: PLACEMENT_GAMES, label: `${r.gamesPlayed} / ${PLACEMENT_GAMES}` }, expiresAt: null });
  if (f.packs && f.packs.unopened > 0) extra.push({ id: "packs", kind: "packs", label: t("Tienes {unopened}", { unopened: plural(f.packs.unopened, t("sobre sin abrir"), t("sobres sin abrir")) }), detail: t("Ábrelos en el inventario"), href: DAILY_ROUTES.inventory, status: "AVAILABLE", progress: null, expiresAt: null });

  // Objetivos primero hasta dejar sitio a lo demás (como mucho 3 objetivos si hay extras).
  const room = Math.max(TODAY_MAX - extra.length, Math.min(3, items.length));
  const merged = [...items.slice(0, room), ...extra]
    .filter((i) => !primary || i.href !== primary.href)
    .slice(0, TODAY_MAX);
  return merged;
}

/* ───────────────────────────── foto completa ───────────────────────────── */

export interface DailyLoopSnapshot {
  /** Reloj del servidor: el cliente solo cuenta hacia atrás desde aquí. */
  serverNow: number;
  signedIn: boolean;
  primaryAction: DailyAction;
  secondaryActions: DailyAction[];
  today: TodayItem[];
  player: { level: number; xp: number; xpIntoLevel: number; xpForNext: number; progress: number } | null;
  objectives: {
    daily: { done: number; total: number };
    weekly: { done: number; total: number };
    near: MetaObjective | null;
    claimable: number;
    rotationPending: boolean;
  } | null;
  season: {
    current: SeasonFact | null;
    next: SeasonFact | null;
    pass: PassFact | null;
  } | null;
  competitive: DailyLoopFacts["competitive"];
  campaign: DailyLoopFacts["campaign"];
  live: { featured: LiveEventFact | null; upcoming: LiveEventFact | null; pickemPending: number } | null;
  collection: { owned: number; distinct: number; catalog: number } | null;
  packs: { unopened: number } | null;
  achievements: { total: number; claimed: number; claimable: number; near: { id: string; name: string; current: number; goal: number } | null } | null;
  social: { incoming: number; from: string | null } | null;
  deck: { state: DeckState; active: DeckFact | null; firstInvalid: DeckFact | null } | null;
  /**
   * Fase 40 · PLAYER JOURNEY. En curso: pasos, progreso y contexto (roles que faltan, plantilla lista). Completo justo
   * tras la PRIMERA partida (`justCompleted`): la home enseña los destinos. Después, `null` (vestíbulo normal).
   */
  journey: PlayerJourney | null;
  /** Subsistemas que no se pudieron leer: su bloque se degrada y no se recomienda nada suyo. */
  unavailable: DailySubsystem[];
  /** Fase 42 · LIVE SERVICE: lo temporal del vestíbulo (resets, hoy/semana, caducidades, vuelta, progreso reciente). */
  service: LiveServiceView | null;
  /**
   * Fase 63 · ONBOARDING 5.0. La guía de la primera sesión (paso «X/6», siguiente acción, recursos reales). La añade el
   * SERVICIO sobre los mismos hechos del recorrido (`journey`) y los acuses del jugador; `buildDailyLoop` no la decide.
   * Ausente o `null` = sin datos (anónimo, o el recorrido no se pudo leer).
   */
  onboarding?: import("@/domain/onboarding").OnboardingView | null;
}

export interface LiveServiceView {
  resets: ResetWindows;
  today: ObjectiveCard[];
  thisWeek: ObjectiveCard[];
  dailyDone: boolean;
  weeklyDone: boolean;
  expiring: ExpiringItem[];
  season: { endsAt: number; daysLeft: number; endingSoon: boolean } | null;
  returning: ReturningContext | null;
  recent: RecentFact[];
  draftRun: { id: string; status: "DRAFTING" | "READY"; stage: number } | null;
  /** Partidas o runs recuperables (lo que el héroe prioriza siempre). */
  recoverable: number;
}

export const packDisplayName = (id: string) => getPack(id)?.name ?? id;

/** FASE 42 · la vista temporal, pura. `null` sin sesión. */
export function buildLiveService(f: DailyLoopFacts): LiveServiceView | null {
  if (!f.signedIn) return null;
  const objectives = f.progression?.objectives ?? [];
  const today = objectiveCards(objectives, "daily", f.now, packDisplayName);
  const thisWeek = objectiveCards(objectives, "weekly", f.now, packDisplayName);
  const current = f.season?.current ?? null;
  const seasonEndsAt = current && current.status === "ACTIVE" ? current.endsAtMs : null;
  const pickem = f.pickems ? { eventName: f.pickems.eventName, pending: f.pickems.pending, nextLockAt: f.pickems.nextLockAt ?? null } : null;
  const claimable = f.progression ? f.progression.claimableLevels + claimableObjectives(f.progression.objectives, f.now).length + f.progression.achievements.claimable : 0;
  const liveNow = (f.live ?? []).find((e) => e.lifecycle === "ACTIVE" && e.liveCount > 0 && !e.isDemo) ?? null;
  const matches = f.matches ?? [];
  return {
    resets: resetWindows(f.now),
    today, thisWeek,
    dailyDone: allDone(today),
    weeklyDone: allDone(thisWeek),
    expiring: expiringItems({
      now: f.now, pickem, today, thisWeek, seasonEndsAt,
      routes: { pickems: DAILY_ROUTES.pickems, claims: DAILY_ROUTES.claims, objective: objectiveRoute, season: DAILY_ROUTES.season },
    }),
    season: seasonEndsAt !== null ? { endsAt: seasonEndsAt, daysLeft: Math.max(0, Math.ceil((seasonEndsAt - f.now) / 86_400_000)), endingSoon: seasonEndsAt - f.now <= 7 * 86_400_000 } : null,
    returning: f.activity ? returningContext({
      now: f.now, lastActivityAt: f.activity.lastActivityAt, today, thisWeek, activeMatch: matches.length > 0,
      draftRun: f.draftRun ?? null, pickem, liveEventName: liveNow?.name ?? null, claimable, seasonEndsAt,
    }) : null,
    recent: f.activity ? recentProgress(f.activity.recent) : [],
    draftRun: f.draftRun ?? null,
    recoverable: matches.length + (f.draftRun ? 1 : 0),
  };
}

export { ledgerRecent, type Urgency };

export function unavailableOf(f: DailyLoopFacts): DailySubsystem[] {
  if (!f.signedIn) return f.live === null ? ["live"] : [];
  const map: Record<DailySubsystem, unknown> = {
    match: f.matches, social: f.social, progression: f.progression, pickems: f.pickems, packs: f.packs,
    decks: f.decks, campaign: f.campaign, competitive: f.competitive, live: f.live, season: f.season,
  };
  return DAILY_SUBSYSTEMS.filter((s) => map[s] === null);
}

const countKind = (list: readonly MetaObjective[], kind: string, now: number) => {
  const l = list.filter((o) => o.kind === kind && liveObjective(o, now));
  return { done: l.filter((o) => o.complete || o.claimed).length, total: l.length };
};

/** Evento destacado: el que tiene partido en directo; si no, el activo; si no, ninguno. Próximo: el primero UPCOMING. */
export function featuredEvents(list: readonly LiveEventFact[]): { featured: LiveEventFact | null; upcoming: LiveEventFact | null } {
  // Fase 42 · lo real antes que lo de demostración (un demo nunca pasa por delante de un evento real).
  const featured = list.find((e) => e.lifecycle === "ACTIVE" && e.liveCount > 0 && !e.isDemo) ?? list.find((e) => e.lifecycle === "ACTIVE" && !e.isDemo) ?? list.find((e) => e.lifecycle === "ACTIVE") ?? null;
  const upcoming = list.find((e) => e.lifecycle === "UPCOMING") ?? null;
  return { featured, upcoming };
}

export function buildDailyLoop(f: DailyLoopFacts): DailyLoopSnapshot {
  const { primary, secondary } = dailyActions(f);
  const p = f.signedIn ? f.progression : null;
  const ds = f.signedIn ? deckState(f.decks) : null;
  const j = journeyOf(f);
  const journey = j && (!j.isComplete || j.justCompleted) ? j : null;
  const live = f.live ? (() => {
    const { featured, upcoming } = featuredEvents(f.live);
    const pickemPending = f.signedIn ? f.live.reduce((s, e) => s + (e.lifecycle !== "COMPLETED" ? e.pickem?.pending ?? 0 : 0), 0) : 0;
    return { featured, upcoming, pickemPending };
  })() : null;

  return {
    serverNow: f.now,
    signedIn: f.signedIn,
    primaryAction: primary,
    secondaryActions: secondary,
    today: todayItems(f, primary),
    player: p ? p.account : null,
    objectives: p ? {
      daily: countKind(p.objectives, "daily", f.now),
      weekly: countKind(p.objectives, "weekly", f.now),
      near: nearObjective(p.objectives, f.now),
      claimable: claimableObjectives(p.objectives, f.now).length,
      rotationPending: p.rotationPending,
    } : null,
    season: f.season ? { current: f.season.current, next: f.season.next, pass: p?.pass ?? null } : null,
    competitive: f.signedIn ? f.competitive : null,
    campaign: f.signedIn ? f.campaign : null,
    live,
    collection: p ? { owned: p.metrics.ownedCards, distinct: p.metrics.distinctCards, catalog: f.catalogSize } : null,
    packs: f.signedIn ? f.packs : null,
    achievements: p ? p.achievements : null,
    social: f.signedIn ? f.social : null,
    deck: ds ? { state: ds, active: f.decks!.active, firstInvalid: f.decks!.firstInvalid } : null,
    journey,
    unavailable: unavailableOf(f),
    service: buildLiveService(f),
  };
}
