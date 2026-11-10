/**
 * ARNÉS QA · FASE 36 — FOTOS QA SYNTHETIC del Daily Loop.
 *
 * Todo lo de aquí es INVENTADO para revisar estados difíciles (partida a medias, reto, fallo parcial…). Lo
 * único real es el dominio que decide (`buildDailyLoop`, el mismo del servidor), el calendario de temporada y
 * las cartas de la vitrina (catálogo). Ninguna escena afirma ser un dato de un jugador.
 */
import { CARDS, TOTAL_CARDS } from "@/data/catalog";
import { SEASON_CALENDAR } from "@/data/seasonCalendar";
import type { DailyLoopFacts, LiveEventFact, SeasonFact } from "@/domain/dailyLoop";
import type { MetaObjective } from "@/domain/progression/meta";
import type { ShowcaseCard } from "@/components/lobby/LobbyShowcase";

const H = 3600_000;
const D = 24 * H;
const S1_START = Date.parse(SEASON_CALENDAR[0].startsAt);
const S1_END = Date.parse(SEASON_CALENDAR[0].endsAt);

export const QA_NOW = S1_START + 13 * D + 11 * H;

const season = (presentation: SeasonFact["presentation"] = "ACTIVE"): SeasonFact => ({
  id: SEASON_CALENDAR[0].id, name: SEASON_CALENDAR[0].name, status: presentation === "UPCOMING" ? "UPCOMING" : presentation === "ENDED" ? "ENDED" : "ACTIVE",
  presentation, startsAtMs: S1_START, endsAtMs: S1_END,
});

const obj = (o: Partial<MetaObjective> & { id: string; label: string }): MetaObjective => ({
  kind: "daily", current: 0, goal: 5, complete: false, claimed: false, rewardCredits: 150, xp: 250, metric: "duels_played",
  packId: null, packCount: 0, assignedAt: QA_NOW - 6 * H, expiresAt: QA_NOW + 13 * H, ...o,
});

const ev = (e: Partial<LiveEventFact> & { id: string; name: string }): LiveEventFact => ({
  lifecycle: "ACTIVE", isDemo: false, startDate: "2026-09-15", endDate: "2026-09-28", liveCount: 0, liveMatch: null, nextMatch: null, pickem: null, ...e,
});

const OBJECTIVES: MetaObjective[] = [
  obj({ id: "d-duelos-3", label: "Juega 3 duelos", current: 1, goal: 3 }),
  obj({ id: "d-sobres-2", label: "Abre 2 sobres", current: 0, goal: 2, metric: "packs_opened" }),
  obj({ id: "w-victorias-5", label: "Gana 5 duelos esta semana", kind: "weekly", current: 2, goal: 5, metric: "duels_won", expiresAt: QA_NOW + 4 * D }),
  obj({ id: "w-picks-10", label: "Haz 10 predicciones", kind: "weekly", current: 3, goal: 10, metric: "picks_made", expiresAt: QA_NOW + 4 * D }),
];

const EVENT_ACTIVE = ev({ id: "qa-masters", name: "QA · Masters del circuito", nextMatch: { teamA: "Fnatic", teamB: "G2 Esports", startTime: new Date(QA_NOW + 5 * H).toISOString() }, pickem: { open: 4, pending: 0 } });
const EVENT_UPCOMING = ev({ id: "qa-champions", name: "QA · Champions", lifecycle: "UPCOMING", startDate: "2026-10-02", endDate: "2026-10-18", nextMatch: null });

export function baseFacts(o: Partial<DailyLoopFacts> = {}): DailyLoopFacts {
  return {
    now: QA_NOW, signedIn: true, catalogSize: TOTAL_CARDS,
    matches: [],
    social: { incoming: 0, from: null },
    progression: {
      account: { level: 9, xp: 5_120, xpIntoLevel: 340, xpForNext: 900, progress: 340 / 900 },
      pass: { level: 6, maxLevel: 50, xp: 6_450, xpIntoLevel: 450, xpForNext: 1_000, progress: 0.45, nextReward: { level: 7, track: "free", label: "Sobre estándar" } },
      claimableLevels: 0,
      objectives: OBJECTIVES,
      achievements: { total: 24, claimed: 5, claimable: 0, near: { id: "coleccionista", name: "Coleccionista", current: 38, goal: 50 } },
      rotationPending: false,
      metrics: { ownedCards: 64, distinctCards: 51, packsOpened: 9, duelsPlayed: 14 },
    },
    pickems: { pending: 0, open: 4, eventId: EVENT_ACTIVE.id, eventName: null },
    packs: { unopened: 0 },
    decks: { total: 2, valid: 1, active: { id: "qa-deck", name: "QA · Equipo principal", valid: true, size: 10, sumOvr: 812 }, firstInvalid: null },
    campaign: { completed: 4, total: 15, complete: false, next: { nodeId: "c1-n5", name: "Guardián del clasificatorio", team: "Team Heretics", chapterOrder: 1 } },
    competitive: { rating: 1_048, gamesPlayed: 4, wins: 3, losses: 1, draws: 0, provisional: true, position: null, rankedTotal: 57, recent: ["WIN", "WIN", "LOSS", "WIN"] },
    live: [EVENT_ACTIVE, EVENT_UPCOMING],
    season: { current: season(), next: null },
    ...o,
  };
}

const P = (patch: Partial<NonNullable<DailyLoopFacts["progression"]>>, o: Partial<DailyLoopFacts> = {}) =>
  baseFacts({ ...o, progression: { ...baseFacts().progression!, ...patch } });

export const SHOWCASE: ShowcaseCard[] = [...CARDS].sort((a, b) => b.ovr - a.ovr).filter((c, i, all) => all.findIndex((x) => x.playerId === c.playerId) === i).slice(0, 3)
  .map((def, i) => ({ uid: `qa-showcase-${i}`, def }));

export interface QaScene {
  note: string;
  facts?: DailyLoopFacts;
  skeleton?: boolean;
  network?: "online" | "offline" | "error";
  stale?: boolean;
  showcase?: boolean;
}

const FRESH = { ownedCards: 0, distinctCards: 0, packsOpened: 0, duelsPlayed: 0 };
const NO_DECKS = { total: 0, valid: 0, active: null, firstInvalid: null };
const anon = (o: Partial<DailyLoopFacts> = {}): DailyLoopFacts => ({
  ...baseFacts(), signedIn: false, matches: null, social: null, progression: null, pickems: null, packs: null, decks: null, campaign: null, competitive: null, ...o,
});

export const SCENES: Record<string, QaScene> = {
  normal: { note: "jugador activo · acción principal: continuar Road to Champions", facts: baseFacts(), showcase: true },
  fresh: { note: "cuenta nueva: sin cartas, 4 sobres, sin equipo", facts: P({ metrics: FRESH, objectives: [], achievements: { total: 24, claimed: 0, claimable: 0, near: null }, account: { level: 1, xp: 0, xpIntoLevel: 0, xpForNext: 400, progress: 0 } }, { packs: { unopened: 4 }, decks: NO_DECKS, campaign: { completed: 0, total: 15, complete: false, next: { nodeId: "c1-n1", name: "Primer contacto", team: "NAVI", chapterOrder: 1 } }, competitive: { rating: null, gamesPlayed: 0, wins: 0, losses: 0, draws: 0, provisional: true, position: null, rankedTotal: 57, recent: [] } }) },
  "no-deck": { note: "con cartas y sin equipo", facts: baseFacts({ decks: NO_DECKS }), showcase: true },
  "invalid-deck": { note: "equipo a medias (7/10)", facts: baseFacts({ decks: { total: 1, valid: 0, active: null, firstInvalid: { id: "qa-bad", name: "QA · Equipo a medias", valid: false, size: 7, sumOvr: 540 } } }) },
  "match-pve": { note: "partida rápida a medias", facts: baseFacts({ matches: [{ id: "qa-m", mode: "PVE", difficulty: "HARD", opponent: null, node: null }], packs: { unopened: 3 } }) },
  "match-ranked": { note: "ranked a medias (rival público)", facts: baseFacts({ matches: [{ id: "qa-p", mode: "RANKED", difficulty: null, opponent: "QA_Kira", node: null }], social: { incoming: 1, from: "QA_Ana" } }) },
  "match-private": { note: "duelo privado a medias", facts: baseFacts({ matches: [{ id: "qa-pp", mode: "PRIVATE", difficulty: null, opponent: "QA_Ana", node: null }] }) },
  "match-campaign": { note: "nodo de campaña a medias", facts: baseFacts({ matches: [{ id: "qa-mc", mode: "CAMPAIGN", difficulty: "NORMAL", opponent: null, node: { id: "c1-n5", name: "El jefe del capítulo" } }] }) },
  challenge: { note: "reto privado recibido", facts: baseFacts({ social: { incoming: 2, from: "QA_Ana" } }) },
  claim: { note: "niveles del pase y un objetivo por reclamar", facts: P({ claimableLevels: 2, objectives: [obj({ id: "d-duelos-3", label: "Juega 3 duelos", current: 3, goal: 3, complete: true }), ...OBJECTIVES.slice(1)] }) },
  "claim-achievement": { note: "logro por reclamar", facts: P({ achievements: { total: 24, claimed: 5, claimable: 1, near: null } }) },
  pickem: { note: "predicciones pendientes", facts: baseFacts({ pickems: { pending: 3, open: 4, eventId: EVENT_ACTIVE.id, eventName: "QA · Masters" }, live: [{ ...EVENT_ACTIVE, pickem: { open: 4, pending: 3 } }, EVENT_UPCOMING] }) },
  "near-objective": { note: "objetivo diario casi completado (4/5)", facts: P({ objectives: [obj({ id: "d-victorias", label: "Gana 5 duelos hoy", current: 4, goal: 5, metric: "duels_won" }), ...OBJECTIVES] }) },
  packs: { note: "sobres sin abrir", facts: baseFacts({ packs: { unopened: 3 } }), showcase: true },
  "no-packs": { note: "sin sobres (bloque colección)", facts: baseFacts(), showcase: true },
  "campaign-start": { note: "campaña sin empezar", facts: baseFacts({ campaign: { completed: 0, total: 15, complete: false, next: { nodeId: "c1-n1", name: "Primer contacto", team: "NAVI", chapterOrder: 1 } } }) },
  "campaign-complete": { note: "campaña completada → manda competitivo", facts: baseFacts({ campaign: { completed: 15, total: 15, complete: true, next: null } }) },
  "ranked-provisional": { note: "ranked provisional 4/10", facts: baseFacts({ campaign: { completed: 15, total: 15, complete: true, next: null } }) },
  "ranked-established": { note: "ranked clasificado", facts: baseFacts({ campaign: { completed: 15, total: 15, complete: true, next: null }, competitive: { rating: 1_287, gamesPlayed: 31, wins: 19, losses: 11, draws: 1, provisional: false, position: 12, rankedTotal: 57, recent: ["WIN", "LOSS", "WIN", "DRAW", "WIN"] } }) },
  "live-event": { note: "partido EN DIRECTO real (fixture)", facts: baseFacts({ live: [{ ...EVENT_ACTIVE, liveCount: 1, liveMatch: { teamA: "Fnatic", teamB: "G2 Esports", scoreA: 1, scoreB: 1 } }, EVENT_UPCOMING] }) },
  "next-event": { note: "solo un evento programado", facts: baseFacts({ live: [EVENT_UPCOMING] }) },
  "no-live": { note: "sin eventos", facts: baseFacts({ live: [] }) },
  "season-ending": { note: "temporada en sus últimos días", facts: baseFacts({ now: S1_END - 3 * D, season: { current: season("ENDING_SOON"), next: null } }) },
  "season-ended": { note: "temporada terminada, sin siguiente (no se inventa)", facts: P({ pass: null }, { now: S1_END + 2 * D, season: { current: null, next: null } }) },
  offline: { note: "sin conexión con última foto", facts: baseFacts({ packs: { unopened: 2 } }), network: "offline", stale: true },
  "error-stale": { note: "servidor sin respuesta, última foto", facts: baseFacts(), network: "error", stale: true },
  loading: { note: "cargando (esqueleto sin cifras)", skeleton: true },
  partial: { note: "fallo parcial: competitivo, circuito y Pick'ems caídos", facts: baseFacts({ competitive: null, live: null, pickems: null }) },
  "all-down": { note: "todo caído con sesión: vestíbulo degradado honesto", facts: { ...baseFacts(), matches: null, social: null, progression: null, pickems: null, packs: null, decks: null, campaign: null, competitive: null, live: null, season: null }, network: "error", stale: true },
  anonymous: { note: "sin sesión", facts: anon() },
  "anonymous-live": { note: "sin sesión con partido en directo", facts: anon({ live: [{ ...EVENT_ACTIVE, liveCount: 1, liveMatch: { teamA: "Fnatic", teamB: "G2 Esports", scoreA: 0, scoreB: 1 } }] }) },
  "reduced-motion": { note: "prefers-reduced-motion", facts: baseFacts(), showcase: true },
  "long-labels": {
    note: "textos largos",
    facts: baseFacts({
      social: { incoming: 1, from: "QA_NombreDeJugadorMuyLargo_2026" },
      campaign: { completed: 9, total: 15, complete: false, next: { nodeId: "c2-n5", name: "La final imposible del segundo capítulo", team: "Karmine Corp Blue Academy", chapterOrder: 2 } },
      live: [ev({ id: "qa-long", name: "QA · Valorant Champions Tour Americas Stage 2 Playoffs Grand Final", liveCount: 1, liveMatch: { teamA: "Leviatán Esports Academy", teamB: "KRÜ Esports Blaze", scoreA: 2, scoreB: 1 } })],
      progression: { ...baseFacts().progression!, objectives: [obj({ id: "long", label: "Gana tres duelos consecutivos con un equipo de la región de las Américas", current: 1, goal: 3 }), ...OBJECTIVES] },
    }),
  },
  local: { note: "modo local sin Supabase", facts: { ...anon(), live: [], season: null } },
};
