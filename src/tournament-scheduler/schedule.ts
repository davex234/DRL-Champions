/**
 * SCHEDULE — la política por DEFECTO (todo datos, nada hardcodeado a ningún sitio):
 * intervalos por estado, reglas de prioridad declarativas, reintentos con backoff y el
 * patrón configurable de "gran final". Derivación del descriptor desde el registry del
 * watcher: lectura pura de datos del último snapshot; cero interpretación.
 */
import type { WatchedTournament } from "@/tournament-watcher";
import type { ObservedStatus, SchedulePolicy, TournamentDescriptor, TournamentPhase } from "./types";

const MIN = 60_000;
const HOUR = 60 * MIN;

export const DEFAULT_POLICY: SchedulePolicy = {
  intervals: {
    live: 1 * MIN,
    ongoing: 2 * MIN,
    upcoming: 30 * MIN,
    finished: 24 * HOUR,
    archived: 7 * 24 * HOUR,
  },
  priorities: [
    { when: { live: true }, score: 100, label: "en directo" },
    { when: { status: "ongoing", phase: "playoff" }, score: 90, label: "playoffs" },
    { when: { status: "ongoing", phase: "grand-final" }, score: 85, label: "gran final" },
    { when: { status: "ongoing", phase: "group" }, score: 70, label: "fase de grupos" },
    { when: { status: "ongoing" }, score: 60, label: "en curso" },
    { when: { status: "upcoming" }, score: 40, label: "próximo" },
    { when: { status: "finished" }, score: 20, label: "terminado" },
    { when: { status: "archived" }, score: 5, label: "archivado" },
  ],
  retry: { baseDelayMs: MIN, factor: 2, maxAttempts: 3 },
  grandFinalPattern: "gran(d)? final",
};

/** Descriptor a partir de la entrada VIGILADA del watcher (solo datos del snapshot). */
export function descriptorOf(t: WatchedTournament, policy: SchedulePolicy = DEFAULT_POLICY): TournamentDescriptor {
  const s = t.snapshot;
  const status: ObservedStatus = t.removed ? "archived" : (s.tournament.status as ObservedStatus) ?? "upcoming";
  const live = s.matches.some((m) => m.status === "live");
  const grandFinal = new RegExp(policy.grandFinalPattern, "i");

  // Fase actual = la del partido NO terminado más avanzado (o unknown).
  const open = s.matches.filter((m) => m.status !== "finished");
  const stageKind = new Map((s.stages ?? []).map((x) => [x.id, x.kind]));
  let phase: TournamentPhase = "unknown";
  if (open.some((m) => grandFinal.test(m.round ?? ""))) phase = "grand-final";
  else if (open.some((m) => stageKind.get(m.stageId ?? "") === "playoff")) phase = "playoff";
  else if (open.some((m) => stageKind.get(m.stageId ?? "") === "group")) phase = "group";

  return {
    tournamentId: t.tournamentId,
    name: s.tournament.name,
    status,
    live,
    phase,
    lastObservedAt: t.observedAt ?? null,
    revision: t.revision,
  };
}

/** Intervalo aplicable a un descriptor (los directos mandan sobre su estado). */
export function intervalFor(d: TournamentDescriptor, policy: SchedulePolicy = DEFAULT_POLICY): number {
  if (d.live) return policy.intervals.live;
  return policy.intervals[d.status];
}

/** Próxima observación: última + intervalo (o AHORA si nunca se observó). */
export function nextObservationAt(d: TournamentDescriptor, now: number, policy: SchedulePolicy = DEFAULT_POLICY): number {
  if (d.lastObservedAt === null) return now;
  return d.lastObservedAt + intervalFor(d, policy);
}
