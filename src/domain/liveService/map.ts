/**
 * FASE 42 · MAPA CANÓNICO DEL LIVE SERVICE — todo lo que cambia con el tiempo.
 *
 * Datos, no lógica: para cada sistema, su alcance, cuándo empieza/termina/se renueva, dónde vive la verdad, quién tiene
 * la autoridad, si es por jugador o global, y si es accionable / reclamable / caducable / recurrente / económico. Lo
 * leen el contrato (`docs/product/live-service-contract.md`), el verificador y `live-service-map.json`.
 */
export type Authority = "SERVER" | "SERVER_DATA" | "WORKER_DATA";

export interface LiveSystem {
  system: string;
  scope: "PLAYER" | "GLOBAL";
  startsAt: string;
  endsAt: string;
  resetAt: string;
  sourceOfTruth: string;
  authority: Authority;
  actionable: boolean;
  claimable: boolean;
  expiring: boolean;
  recurring: boolean;
  economic: boolean;
  /** Lectura del vestíbulo (sin escrituras) y mutación que lo materializa/cambia. */
  read: string;
  mutation: string;
}

export const LIVE_SERVICE_MAP: readonly LiveSystem[] = [
  { system: "daily missions", scope: "PLAYER", startsAt: "00:00 UTC del día", endsAt: "00:00 UTC del día siguiente", resetAt: "cada día 00:00 UTC (periodWindow daily)", sourceOfTruth: "user_pass.state.missions (materializada) · resolvePassWindows (vigente)", authority: "SERVER", actionable: true, claimable: true, expiring: true, recurring: true, economic: true, read: "peekProgression → resolvePassWindows (puro)", mutation: "claimMission / refreshMissions / POST state → ensurePass" },
  { system: "weekly missions", scope: "PLAYER", startsAt: "lunes 00:00 UTC", endsAt: "lunes siguiente 00:00 UTC", resetAt: "cada lunes 00:00 UTC (periodWindow weekly)", sourceOfTruth: "user_pass.state.missions · resolvePassWindows", authority: "SERVER", actionable: true, claimable: true, expiring: true, recurring: true, economic: true, read: "peekProgression", mutation: "claimMission → ensurePass" },
  { system: "Season", scope: "GLOBAL", startsAt: "calendario de temporada · startsAt", endsAt: "calendario de temporada · endsAt", resetAt: "sin reset (una temporada)", sourceOfTruth: "src/data/seasonCalendar.ts", authority: "SERVER_DATA", actionable: false, claimable: false, expiring: true, recurring: false, economic: false, read: "getSeasonCalendar(now)", mutation: "ninguna (contenido)" },
  { system: "Battle Pass", scope: "PLAYER", startsAt: "inicio de temporada", endsAt: "fin de temporada", resetAt: "sin reset", sourceOfTruth: "user_pass.state (xp, claimed*) + data/season", authority: "SERVER", actionable: true, claimable: true, expiring: true, recurring: false, economic: true, read: "peekProgression (carril competitivo resuelto por puntos)", mutation: "claimPassLevel → ensurePass" },
  { system: "live events", scope: "GLOBAL", startsAt: "events.start_date / primer partido", endsAt: "events.end_date / último partido", resetAt: "sin reset", sourceOfTruth: "events, matches, stages (worker VLR)", authority: "WORKER_DATA", actionable: true, claimable: false, expiring: true, recurring: false, economic: false, read: "getEventsOverview (lifecycle UPCOMING/ACTIVE/COMPLETED derivado)", mutation: "worker (no se toca)" },
  { system: "Pick'ems", scope: "PLAYER", startsAt: "pickem_questions creadas", endsAt: "pickem_questions.locks_at", resetAt: "sin reset", sourceOfTruth: "pickem_events/questions/submissions/answers", authority: "SERVER", actionable: true, claimable: false, expiring: true, recurring: false, economic: true, read: "getEventsOverview (pending + nextLockAt; nunca respuestas)", mutation: "POST /api/pickems; puntuación por worker → scorePickemEvent (delta por escalón)" },
  { system: "event challenges", scope: "PLAYER", startsAt: "evento ACTIVE", endsAt: "fin del evento", resetAt: "sin reset", sourceOfTruth: "domain/events/challenges + métricas del evento", authority: "SERVER", actionable: true, claimable: true, expiring: true, recurring: false, economic: true, read: "getEventHub", mutation: "claim de desafío (events.ts)" },
  { system: "campaign", scope: "PLAYER", startsAt: "siempre", endsAt: "nunca", resetAt: "sin reset", sourceOfTruth: "campaign_progress / campaign_attempts", authority: "SERVER", actionable: true, claimable: false, expiring: false, recurring: false, economic: true, read: "readCampaignSummary", mutation: "POST /api/game/campaign (start/settle)" },
  { system: "Draft active run", scope: "PLAYER", startsAt: "draft_runs.created_at", endsAt: "COMPLETED / FAILED / ABANDONED", resetAt: "sin reset", sourceOfTruth: "draft_runs (DRAFTING / READY / IN_MATCH)", authority: "SERVER", actionable: true, claimable: false, expiring: false, recurring: false, economic: false, read: "readActiveMatches (una lectura de draft_runs)", mutation: "POST /api/game/draft-gauntlet" },
  { system: "PvP active match", scope: "PLAYER", startsAt: "duel_matches.created_at", endsAt: "cierre (resultado / abandono / tiempo)", resetAt: "turno 90 s", sourceOfTruth: "duel_matches (PVP) + ratings", authority: "SERVER", actionable: true, claimable: false, expiring: true, recurring: false, economic: false, read: "readActiveMatches", mutation: "POST /api/game/duel/pvp" },
  { system: "private challenge", scope: "PLAYER", startsAt: "duel_challenges.created_at", endsAt: "duel_challenges.expires_at", resetAt: "sin reset", sourceOfTruth: "duel_challenges / duel_matches (PVP_PRIVATE)", authority: "SERVER", actionable: true, claimable: false, expiring: true, recurring: false, economic: false, read: "readIncomingChallenges(now)", mutation: "POST /api/game/social" },
  { system: "PvE daily cap", scope: "PLAYER", startsAt: "00:00 UTC", endsAt: "00:00 UTC siguiente", resetAt: "cada día 00:00 UTC", sourceOfTruth: "economy_ops duelcap:<uid>:<día>:<k> (cupos atómicos)", authority: "SERVER", actionable: false, claimable: false, expiring: true, recurring: true, economic: true, read: "no se enseña como urgencia", mutation: "awardMatchOutcome → takeDuelPaySlot" },
  { system: "packs", scope: "PLAYER", startsAt: "siempre", endsAt: "nunca (los sobres no caducan)", resetAt: "sin reset", sourceOfTruth: "user_packs", authority: "SERVER", actionable: true, claimable: false, expiring: false, recurring: false, economic: true, read: "user_packs qty > 0", mutation: "POST /api/game/packs" },
  { system: "achievements", scope: "PLAYER", startsAt: "siempre", endsAt: "nunca", resetAt: "sin reset", sourceOfTruth: "user_achievements + métricas", authority: "SERVER", actionable: true, claimable: true, expiring: false, recurring: false, economic: true, read: "peekProgression.achievements", mutation: "claimAchievement" },
  { system: "returning context", scope: "PLAYER", startsAt: "última actividad real", endsAt: "—", resetAt: "—", sourceOfTruth: "credit_transactions / economy_ops / duel_matches / profiles.last_seen_at (marcas del servidor)", authority: "SERVER", actionable: false, claimable: false, expiring: false, recurring: false, economic: false, read: "readActivity (4 lecturas limit)", mutation: "ninguna (visitar no es actividad)" },
];
