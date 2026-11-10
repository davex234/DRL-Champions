/**
 * LIVE EVENTS 1.0 — DOMINIO PURO (Fase 30).
 *
 * Deriva el ESTADO de un evento real (VLR) a partir de lo que ya está persistido: la fila de
 * `events`, sus `matches` y sus `stages`. Aquí no se inventa nada: un partido solo está EN
 * DIRECTO si su `status` lo dice; un ganador solo existe si el backend escribió `winner_team_id`;
 * un mapa sin nombre es «TBD». Sin React, sin red, sin reloj implícito (`now` viene del servidor).
 *
 * También decide, con reglas fijas y documentadas: qué evento es EL PRINCIPAL cuando hay
 * varios, cómo se agrupan (EN CURSO · PRÓXIMAMENTE · FINALIZADOS), cuándo los datos están
 * «viejos» respecto al ritmo real del worker, y qué puede hacer el jugador ahora mismo.
 */
import { ns } from "@/i18n/runtime";

const tr = ns("liveEvents");

/* ───────────────────────────── entradas ───────────────────────────── */

export interface EventLike {
  id: string;
  name: string;
  status: string | null;
  startDate: string | null;
  endDate: string | null;
  region: string | null;
  type: string | null;
  /** `demo` marca datos de demostración. */
  source: string | null;
}

export interface MatchLike {
  id: string;
  status: string;
  startTime: string | null;
  teamA: string | null;
  teamB: string | null;
  teamAId: string | null;
  teamBId: string | null;
  scoreA: number | null;
  scoreB: number | null;
  /** Ganador SEGÚN EL BACKEND. Nunca deducido del marcador. */
  winnerTeamId: string | null;
  round: string | null;
  matchOrder: number | null;
  stageId: string | null;
  bestOf?: number | null;
}

export interface StageLike { id: string; name: string; kind: string | null; orderIdx: number }

/* ───────────────────────────── estado de partido ───────────────────────────── */

const LIVE = new Set(["live", "ongoing"]);
const FINISHED = new Set(["finished", "completed", "final"]);

/** Solo el `status` real del backend dice que un partido está en directo. Nunca la hora. */
export const isLiveMatch = (m: Pick<MatchLike, "status">): boolean => LIVE.has((m.status ?? "").toLowerCase());
export const isFinishedMatch = (m: Pick<MatchLike, "status">): boolean => FINISHED.has((m.status ?? "").toLowerCase());
export const isScheduledMatch = (m: Pick<MatchLike, "status">): boolean => !isLiveMatch(m) && !isFinishedMatch(m);

export type MatchStatusLabel = "PROGRAMADO" | "EN CURSO" | "FINALIZADO";
export function matchStatusLabel(m: Pick<MatchLike, "status">): MatchStatusLabel {
  return isLiveMatch(m) ? "EN CURSO" : isFinishedMatch(m) ? "FINALIZADO" : "PROGRAMADO";
}

/**
 * Quién ganó, como bando. SOLO por `winnerTeamId` (o, si no hay ids, por el nombre legado que
 * pase el llamante). Un partido terminado sin ganador escrito devuelve `null`: se dice «sin
 * resultado confirmado», no se resta el marcador.
 */
export function winnerSideOf(m: Pick<MatchLike, "winnerTeamId" | "teamAId" | "teamBId">, legacyWinnerName?: string | null, names?: { a: string | null; b: string | null }): "a" | "b" | null {
  if (m.winnerTeamId) {
    if (m.teamAId && m.winnerTeamId === m.teamAId) return "a";
    if (m.teamBId && m.winnerTeamId === m.teamBId) return "b";
    return null;
  }
  if (legacyWinnerName && names) {
    const n = legacyWinnerName.trim().toLowerCase();
    if (names.a && names.a.trim().toLowerCase() === n) return "a";
    if (names.b && names.b.trim().toLowerCase() === n) return "b";
  }
  return null;
}

/** Un mapa sin nombre conocido es «TBD». No se inventa. */
export const mapLabel = (name: string | null | undefined): string => (name && name.trim() ? name : "TBD");

const PLACEHOLDER = new Set(["", "tbd", "tba", "tbc", "?", "—", "por decidir", "por determinar"]);
export const isPlaceholderTeam = (name: string | null | undefined): boolean => PLACEHOLDER.has((name ?? "").trim().toLowerCase());

/* ───────────────────────────── estado de evento ───────────────────────────── */

export type EventLifecycle = "UPCOMING" | "ACTIVE" | "COMPLETED";

export const LIFECYCLE_LABEL: Record<EventLifecycle, string> = { UPCOMING: "Próximamente", ACTIVE: "En curso", COMPLETED: "Finalizado" };

export interface EventState {
  lifecycle: EventLifecycle;
  liveMatches: MatchLike[];
  /** El siguiente partido programado (por hora; sin hora, por orden). `null` si no hay. */
  nextMatch: MatchLike | null;
  nextMatches: MatchLike[];
  recentResults: MatchLike[];
  completedMatches: number;
  totalMatches: number;
  /** 0..100 sobre partidos publicados; 0 si no hay partidos. */
  progressPct: number;
  /** La fase del partido en directo o del siguiente; si no, la última con partidos. */
  currentStage: { id: string; name: string } | null;
  firstMatchAt: string | null;
  lastMatchAt: string | null;
  /** Participantes reales: ids de equipo vistos en los partidos (sin placeholders). */
  participantIds: string[];
}

const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

const byStart = (a: MatchLike, b: MatchLike): number =>
  ((ms(a.startTime) ?? Number.MAX_SAFE_INTEGER) - (ms(b.startTime) ?? Number.MAX_SAFE_INTEGER)) || ((a.matchOrder ?? 0) - (b.matchOrder ?? 0));

/** Ventana en la que un partido «programado» sin actualizar sigue contando como siguiente. */
export const NEXT_MATCH_GRACE_MS = 3 * 3600_000;

const eventStatusLifecycle = (status: string | null): EventLifecycle | null => {
  const s = (status ?? "").toLowerCase();
  if (FINISHED.has(s) || s === "ended" || s === "archived") return "COMPLETED";
  if (LIVE.has(s) || s === "active") return "ACTIVE";
  if (s === "upcoming" || s === "scheduled") return "UPCOMING";
  return null;
};

/**
 * Ciclo de vida DERIVADO. Los partidos mandan sobre la fila del evento (son el hecho más fino):
 *   · algún partido en directo                                   → ACTIVE
 *   · todos terminados y (evento cerrado o fecha fin pasada)     → COMPLETED
 *   · algún partido terminado o alguno ya debería haber empezado → ACTIVE
 *   · si no hay partidos: el `status`/fechas del evento          → lo que digan
 *   · en cualquier otro caso                                     → UPCOMING
 */
export function deriveEventState(input: { event: EventLike; matches: MatchLike[]; stages?: StageLike[]; now: number }): EventState {
  const { event, now } = input;
  const matches = [...input.matches].sort(byStart);
  const live = matches.filter(isLiveMatch);
  const finished = matches.filter(isFinishedMatch);
  const scheduled = matches.filter(isScheduledMatch);
  const declared = eventStatusLifecycle(event.status);
  const start = ms(event.startDate);
  const end = ms(event.endDate);

  let lifecycle: EventLifecycle;
  if (live.length > 0) lifecycle = "ACTIVE";
  else if (matches.length > 0 && finished.length === matches.length) {
    lifecycle = declared === "COMPLETED" || (end !== null && end <= now) || end === null ? "COMPLETED" : "ACTIVE";
  } else if (finished.length > 0) lifecycle = "ACTIVE";
  else if (scheduled.some((m) => { const t = ms(m.startTime); return t !== null && t <= now; })) lifecycle = "ACTIVE";
  else if (matches.length === 0) {
    if (declared) lifecycle = declared;
    else if (end !== null && end <= now) lifecycle = "COMPLETED";
    else if (start !== null && start <= now) lifecycle = "ACTIVE";
    else lifecycle = "UPCOMING";
  } else lifecycle = declared === "ACTIVE" || (start !== null && start <= now) ? "ACTIVE" : "UPCOMING";

  const upcomingSoon = scheduled.filter((m) => { const t = ms(m.startTime); return t === null || t >= now - NEXT_MATCH_GRACE_MS; });
  const nextMatches = upcomingSoon.slice(0, 3);
  const nextMatch = nextMatches[0] ?? null;
  const recentResults = [...finished].sort((a, b) => byStart(b, a)).slice(0, 5);

  const stageById = new Map((input.stages ?? []).map((s) => [s.id, s]));
  const stageOf = (m: MatchLike | null | undefined) => (m?.stageId && stageById.get(m.stageId)) || null;
  let currentStage = stageOf(live[0]) ?? stageOf(nextMatch) ?? null;
  if (!currentStage && finished.length > 0) currentStage = stageOf(recentResults[0]);

  const participantIds = [...new Set(matches.flatMap((m) => [m.teamAId, m.teamBId]).filter((id): id is string => !!id && !/(^|-)(tbd|tba|tbc|sin-nombre)$/i.test(id)))];
  const times = matches.map((m) => ms(m.startTime)).filter((t): t is number => t !== null);

  return {
    lifecycle,
    liveMatches: live,
    nextMatch, nextMatches, recentResults,
    completedMatches: finished.length,
    totalMatches: matches.length,
    progressPct: matches.length === 0 ? 0 : Math.round((finished.length / matches.length) * 100),
    currentStage: currentStage ? { id: currentStage.id, name: currentStage.name } : null,
    firstMatchAt: times.length ? new Date(Math.min(...times)).toISOString() : null,
    lastMatchAt: times.length ? new Date(Math.max(...times)).toISOString() : null,
    participantIds,
  };
}

/* ───────────────────────────── varios eventos ───────────────────────────── */

export interface RankedEvent { event: EventLike; state: EventState }

/**
 * EL EVENTO PRINCIPAL, con varios simultáneos: en curso con partido en directo → en curso
 * (el que empezó antes) → el próximo que antes empieza → el terminado más reciente.
 */
export function rankEvents<T extends RankedEvent>(list: T[], now: number): T[] {
  const rank = (x: T): number => (x.state.lifecycle === "ACTIVE" ? (x.state.liveMatches.length > 0 ? 0 : 1) : x.state.lifecycle === "UPCOMING" ? 2 : 3);
  const key = (x: T): number => {
    const start = ms(x.event.startDate) ?? ms(x.state.firstMatchAt) ?? Number.MAX_SAFE_INTEGER;
    const end = ms(x.event.endDate) ?? ms(x.state.lastMatchAt) ?? 0;
    switch (rank(x)) {
      case 0: case 1: return start; // el que lleva más tiempo en marcha
      case 2: return start; // el más cercano
      default: return -end; // el más reciente
    }
  };
  return [...list].sort((a, b) => rank(a) - rank(b) || key(a) - key(b) || a.event.id.localeCompare(b.event.id))
    .filter((x) => x.state.lifecycle !== "UPCOMING" || (ms(x.event.startDate) ?? now) >= now - 30 * 86_400_000 || x.state.totalMatches > 0);
}

export function groupEvents<T extends RankedEvent>(list: T[], now: number): { active: T[]; upcoming: T[]; completed: T[] } {
  const ranked = rankEvents(list, now);
  return {
    active: ranked.filter((x) => x.state.lifecycle === "ACTIVE"),
    upcoming: ranked.filter((x) => x.state.lifecycle === "UPCOMING"),
    completed: ranked.filter((x) => x.state.lifecycle === "COMPLETED"),
  };
}

/* ───────────────────────────── frescura de los datos ───────────────────────────── */

export type SyncFreshness = "FRESH" | "STALE" | "FAILING" | "UNKNOWN";

/**
 * Umbrales de «viejo» por ciclo de vida, derivados del ritmo REAL del worker (cron cada 2 min;
 * política: live 2 min, active 10 min, upcoming_soon 30 min, future 6 h, recently_finished 60 min).
 * Se toma ~3× el intervalo de la política para no confundir «no ha cambiado nada» con «roto».
 */
export const STALE_AFTER_MS: Record<EventLifecycle, number> = {
  ACTIVE: 30 * 60_000,
  UPCOMING: 18 * 3600_000,
  COMPLETED: Number.POSITIVE_INFINITY,
};

/** Con esta cifra de fallos seguidos el worker está fallando, no «tranquilo». */
export const FAILING_AFTER = 3;

export function syncFreshness(input: { lastSuccessAt: string | null; lastAttemptAt: string | null; consecutiveFailures: number; lifecycle: EventLifecycle; hasLive: boolean; now: number }): SyncFreshness {
  const success = ms(input.lastSuccessAt);
  if (input.consecutiveFailures >= FAILING_AFTER) return "FAILING";
  if (success === null) return "UNKNOWN";
  const limit = input.hasLive ? 15 * 60_000 : STALE_AFTER_MS[input.lifecycle];
  return input.now - success > limit ? "STALE" : "FRESH";
}

/** Lo ÚNICO que se dice al jugador. Nada de leases, workers ni errores crudos. */
export const FRESHNESS_NOTICE: Record<SyncFreshness, string | null> = {
  FRESH: null,
  UNKNOWN: null,
  STALE: "Los datos del evento pueden tardar en actualizarse.",
  FAILING: "Los datos del evento pueden tardar en actualizarse.",
};

/* ───────────────────────────── colección del evento ───────────────────────────── */

export interface CollectionProgress { total: number; owned: number; pct: number }

/** Denominador = cartas REALES elegibles del evento (ids únicos); numerador = las que se poseen. */
export function collectionProgress(cardIds: string[], ownedCardIds: Iterable<string>): CollectionProgress {
  const unique = [...new Set(cardIds)];
  const owned = new Set(ownedCardIds);
  const have = unique.filter((id) => owned.has(id)).length;
  return { total: unique.length, owned: have, pct: unique.length === 0 ? 0 : Math.round((have / unique.length) * 100) };
}

/* ───────────────────────────── qué puedo hacer ahora ───────────────────────────── */

export type EventActionKind = "pickem" | "objective" | "live" | "next" | "collection" | "pack" | "play";

export interface EventAction {
  kind: EventActionKind;
  label: string;
  detail: string;
  href: string;
  urgent?: boolean;
  count?: number;
}

export interface ActionsInput {
  eventId: string;
  pickem: { pending: number; nextLockAt: string | null } | null;
  objectives: { claimable: number; pending: number };
  liveMatches: MatchLike[];
  nextMatch: MatchLike | null;
  collection: CollectionProgress | null;
  packs: { id: string; name: string }[];
  now: number;
  max?: number;
}

/** Ventana en la que un cierre de predicción se considera «pronto». */
export const CLOSING_SOON_MS = 6 * 3600_000;

/**
 * Prioridad PURA del brief: Pick'em que cierra pronto > objetivo pendiente/reclamable > partido en
 * directo > próximo partido > colección relacionada > sobre ACTIVE relacionado > jugar.
 * Solo acciones reales: cada una nace de un dato que existe.
 */
export function eventActions(input: ActionsInput): EventAction[] {
  const out: EventAction[] = [];
  const hub = `/torneos/${input.eventId}`;
  const p = input.pickem;
  if (p && p.pending > 0) {
    const lock = ms(p.nextLockAt);
    const soon = lock !== null && lock - input.now <= CLOSING_SOON_MS;
    out.push({ kind: "pickem", label: "Haz tus predicciones", detail: `${p.pending} ${p.pending === 1 ? "predicción pendiente" : "predicciones pendientes"}${soon ? " · cierra pronto" : ""}`, href: `${hub}#pickems`, urgent: soon, count: p.pending });
  }
  if (input.objectives.claimable > 0) out.push({ kind: "objective", label: "Reclama tu recompensa", detail: input.objectives.claimable === 1 ? tr("{n} objetivo completado sin reclamar", { n: input.objectives.claimable }) : tr("{n} objetivos completados sin reclamar", { n: input.objectives.claimable }), href: `${hub}#objetivos`, urgent: true, count: input.objectives.claimable });
  else if (input.objectives.pending > 0) out.push({ kind: "objective", label: "Avanza un objetivo", detail: input.objectives.pending === 1 ? tr("{n} objetivo del evento en marcha", { n: input.objectives.pending }) : tr("{n} objetivos del evento en marcha", { n: input.objectives.pending }), href: `${hub}#objetivos`, count: input.objectives.pending });
  const live = input.liveMatches[0];
  if (live) out.push({ kind: "live", label: "Sigue el partido en directo", detail: `${live.teamA ?? "Por decidir"} vs ${live.teamB ?? "Por decidir"}`, href: `${hub}/partido/${live.id}`, urgent: true, count: input.liveMatches.length });
  else if (input.nextMatch) out.push({ kind: "next", label: "Próximo partido", detail: `${input.nextMatch.teamA ?? "Por decidir"} vs ${input.nextMatch.teamB ?? "Por decidir"}`, href: `${hub}/partido/${input.nextMatch.id}` });
  const c = input.collection;
  if (c && c.total > 0 && c.owned < c.total) out.push({ kind: "collection", label: "Completa la colección del evento", detail: `${c.owned} / ${c.total} cartas del evento`, href: `${hub}#cartas`, count: c.total - c.owned });
  const pack = input.packs[0];
  if (pack) out.push({ kind: "pack", label: "Ver sobre del equipo", detail: pack.name, href: `/packs/${pack.id}` });
  out.push({ kind: "play", label: "Juega NEXUS", detail: "Un duelo con tu equipo", href: "/duelos" });
  return out.slice(0, input.max ?? 5);
}

/* ───────────────────────────── actividad derivada ───────────────────────────── */

export type EventActivityKind = "MATCH_FINISHED" | "MATCH_LIVE" | "MATCH_NEXT" | "PICK_RESOLVED" | "STAGE";

export interface EventActivityItem { id: string; kind: EventActivityKind; at: string | null; title: string; detail: string }

/** Hechos, no titulares: partidos terminados/en directo/siguiente, predicciones corregidas. */
export function eventActivity(input: {
  matches: MatchLike[];
  resolvedPicks?: { matchId: string; correct: boolean | null; at: string | null }[];
  max?: number;
}): EventActivityItem[] {
  const items: EventActivityItem[] = [];
  const byId = new Map(input.matches.map((m) => [m.id, m]));
  for (const m of input.matches) {
    const vs = `${m.teamA ?? "Por decidir"} vs ${m.teamB ?? "Por decidir"}`;
    if (isLiveMatch(m)) items.push({ id: `live:${m.id}`, kind: "MATCH_LIVE", at: m.startTime, title: "En directo", detail: vs });
    else if (isFinishedMatch(m)) {
      const w = winnerSideOf(m);
      const score = m.scoreA !== null && m.scoreB !== null ? ` · ${m.scoreA}–${m.scoreB}` : "";
      items.push({ id: `fin:${m.id}`, kind: "MATCH_FINISHED", at: m.startTime, title: w ? `Ganó ${w === "a" ? m.teamA : m.teamB}` : "Partido terminado", detail: `${vs}${score}` });
    }
  }
  for (const p of input.resolvedPicks ?? []) {
    const m = byId.get(p.matchId);
    if (!m || p.correct === null) continue;
    items.push({ id: `pick:${p.matchId}`, kind: "PICK_RESOLVED", at: p.at ?? m.startTime, title: p.correct ? "Predicción acertada" : "Predicción fallada", detail: `${m.teamA ?? "Por decidir"} vs ${m.teamB ?? "Por decidir"}` });
  }
  return items.sort((a, b) => (ms(b.at) ?? 0) - (ms(a.at) ?? 0)).slice(0, input.max ?? 8);
}

/* ───────────────────────────── récord por equipo ───────────────────────────── */

export interface TeamRecord { wins: number; losses: number; played: number }

/** W–L de cada equipo SOLO con partidos terminados que tienen ganador escrito. */
export function teamRecords(matches: MatchLike[]): Map<string, TeamRecord> {
  const out = new Map<string, TeamRecord>();
  const get = (id: string) => out.get(id) ?? (out.set(id, { wins: 0, losses: 0, played: 0 }), out.get(id)!);
  for (const m of matches) {
    if (!isFinishedMatch(m) || !m.teamAId || !m.teamBId) continue;
    const w = winnerSideOf(m);
    if (!w) continue;
    const a = get(m.teamAId), b = get(m.teamBId);
    a.played++; b.played++;
    if (w === "a") { a.wins++; b.losses++; } else { b.wins++; a.losses++; }
  }
  return out;
}
