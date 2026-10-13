/**
 * ARNÉS QA · FASE 42 — LIVE SERVICE · ESCENAS QA SYNTHETIC.
 *
 * Lo SINTÉTICO son los hechos de cuenta (objetivos, partidas, Pick'em, evento, temporada, última actividad). Lo real:
 * `buildDailyLoop` (prioridad, urgencia, vuelta, caducidades), `DailyLobby` y `NextUpAfter` (las mismas piezas que
 * la home y los resultados). El reloj de cada escena es el `serverNow` de la foto; las escenas de reloj desviado
 * simulan el del navegador y pintan con la estimación anclada al servidor.
 */
import type { MetaObjective } from "@/domain/progression/meta";
import type { ActiveMatchFact, DailyLoopFacts, LiveEventFact } from "@/domain/dailyLoop";
import type { AfterContext } from "@/lib/liveService/presentation";
import { CARD_MANIFEST } from "@/data/cardCatalog";

const H = 3_600_000; const D = 24 * H;
/** Miércoles 7 oct 2026, 15:30 UTC (reset diario en 8 h 30 min, semanal el lunes). */
export const NOW = Date.UTC(2026, 9, 7, 15, 30);
const dayStart = (now: number) => Math.floor(now / D) * D;
const weekStart = (now: number) => { const d = dayStart(now); const dow = (new Date(d).getUTCDay() + 6) % 7; return d - dow * D; };

export const FASE42_SCENES = [
  "normal-today", "active-pvp", "active-private", "active-draft-combat", "active-draft-drafting",
  "daily-claimable", "weekly-almost", "daily-complete", "weekly-complete", "all-complete",
  "pickem-soon", "pickem-none", "event-live", "event-upcoming", "event-none",
  "season-normal", "season-ending",
  "return-1d", "return-3d", "return-7d", "return-14d", "return-30d",
  "no-packs", "pack-owned", "campaign-progress", "ranked-progress",
  "subsystem-unavailable", "offline", "reset-imminent", "post-reset", "clock-ahead", "clock-behind", "keyboard", "long-text",
  "after-match", "after-pack", "after-campaign", "after-draft", "after-ranked", "after-private",
] as const;
export type Fase42Scene = (typeof FASE42_SCENES)[number];

export interface HomeScene { kind: "home"; note: string; facts: DailyLoopFacts; network?: "online" | "offline" | "error"; skewMs?: number; focus?: boolean }
export interface AfterScene { kind: "after"; note: string; facts: DailyLoopFacts; context: AfterContext; title: string }
export type Scene = HomeScene | AfterScene;

const mk = (now: number, o: Partial<MetaObjective> & { id: string }): MetaObjective => {
  const kind = o.kind ?? "daily";
  const start = kind === "daily" ? dayStart(now) : weekStart(now);
  return {
    label: o.id, kind, current: 0, goal: 1, complete: false, claimed: false, rewardCredits: 250, xp: 200, metric: "duels_played", packId: null, packCount: 0,
    assignedAt: start, expiresAt: start + (kind === "daily" ? D : 7 * D), ...o,
  };
};
/** Tanda real del pool de la Temporada 1 (etiquetas y recompensas de sus definiciones). */
const batch = (now: number, st: { d?: [number, boolean?][]; w?: [number, boolean?][] } = {}): MetaObjective[] => {
  const ds = [
    { id: "d-duelo-1", label: "Juega un duelo", metric: "duels_played", goal: 1, rewardCredits: 250, xp: 200 },
    { id: "d-abrir-1", label: "Abre un sobre", metric: "packs_opened", goal: 1, rewardCredits: 200, xp: 150 },
    { id: "d-victoria-2", label: "Gana 2 duelos", metric: "duels_won", goal: 2, rewardCredits: 400, xp: 300 },
  ];
  const ws = [
    { id: "w-duelos-5", label: "Juega 5 duelos", metric: "duels_played", goal: 5, rewardCredits: 1200, xp: 800 },
    { id: "w-coleccion-10", label: "Consigue 10 cartas nuevas", metric: "distinct_cards", goal: 10, rewardCredits: 900, xp: 600 },
  ];
  const d = st.d ?? [[0], [0], [1]]; const w = st.w ?? [[2], [4]];
  return [
    ...ds.map((x, i) => { const [c, claimed] = d[i] ?? [0]; return mk(now, { ...x, kind: "daily", current: c, complete: c >= x.goal, claimed: !!claimed }); }),
    ...ws.map((x, i) => { const [c, claimed] = w[i] ?? [0]; return mk(now, { ...x, kind: "weekly", current: c, complete: c >= x.goal, claimed: !!claimed }); }),
  ];
};
const match = (mode: ActiveMatchFact["mode"], o: Partial<ActiveMatchFact> = {}): ActiveMatchFact => ({ id: `m-${mode}`, mode, difficulty: mode === "PVE" || mode === "CAMPAIGN" ? "NORMAL" : null, opponent: mode === "RANKED" ? "QA_Rival" : mode === "PRIVATE" ? "QA_Amigo" : null, node: null, ...o });
const event = (o: Partial<LiveEventFact>): LiveEventFact => ({ id: "ev-qa", name: "VCT Masters QA", lifecycle: "ACTIVE", isDemo: false, startDate: null, endDate: null, liveCount: 0, liveMatch: null, nextMatch: null, pickem: null, ...o });

export function facts(o: Partial<DailyLoopFacts> & { now?: number } = {}): DailyLoopFacts {
  const now = o.now ?? NOW;
  return {
    now, signedIn: true, catalogSize: CARD_MANIFEST.length, matches: [], social: { incoming: 0, from: null }, journey: null, draftRun: null,
    progression: {
      account: { level: 12, xp: 7400, xpIntoLevel: 300, xpForNext: 700, progress: 0.43 },
      pass: { level: 8, maxLevel: 30, xp: 8400, xpIntoLevel: 400, xpForNext: 1000, progress: 0.4, nextReward: { level: 9, track: "free", label: "Sobre Estándar" } },
      claimableLevels: 0, objectives: batch(now), achievements: { total: 12, claimed: 4, claimable: 0, near: null }, rotationPending: false,
      metrics: { ownedCards: 140, distinctCards: 118, packsOpened: 22, duelsPlayed: 41 },
    },
    pickems: { pending: 0, open: 0, eventId: null, eventName: null, nextLockAt: null },
    packs: { unopened: 0 },
    decks: { total: 2, valid: 2, active: { id: "d1", name: "Equipo Principal", valid: true, size: 10, sumOvr: 842 }, firstInvalid: null },
    campaign: { completed: 6, total: 15, complete: false, next: { nodeId: "c2-n2", name: "Presión en Berlín", team: "Fnatic", chapterOrder: 2 } },
    competitive: { rating: 1084, gamesPlayed: 14, wins: 8, losses: 5, draws: 1, provisional: false, position: 12, rankedTotal: 58, recent: ["WIN", "LOSS", "WIN"] },
    live: [],
    season: { current: { id: "nexus-s1", name: "Temporada 1", status: "ACTIVE", presentation: "ACTIVE", startsAtMs: NOW - 30 * D, endsAtMs: NOW + 41 * D }, next: null },
    activity: { lastActivityAt: now - 3 * H, recent: [{ id: "r1", label: "Victoria en partida rápida (+120 créditos)", at: now - 3 * H }, { id: "r2", label: "Objetivo cobrado (+250 créditos)", at: now - 5 * H }] },
    ...o,
  };
}

const home = (note: string, f: DailyLoopFacts, extra: Partial<HomeScene> = {}): HomeScene => ({ kind: "home", note, facts: f, ...extra });
const back = (days: number, o: Partial<DailyLoopFacts> = {}) => home(`vuelta tras ${days} d · banner con ≤ 3 hechos verdaderos, sin recompensa ni racha`, facts({ activity: { lastActivityAt: NOW - days * D - 2 * H, recent: [] }, ...o }));
const after = (context: AfterContext, title: string, note: string, o: Partial<DailyLoopFacts> = {}): AfterScene => ({ kind: "after", context, title, note, facts: facts(o) });
const liveEvent = [event({ liveCount: 1, liveMatch: { teamA: "Fnatic", teamB: "Sentinels", scoreA: 1, scoreB: 0 } as LiveEventFact["liveMatch"] })];
const RESET = dayStart(NOW) + D;

export const SCENES: Record<Fase42Scene, Scene> = {
  "normal-today": home("día normal · objetivos a medias, semanal cerca, temporada lejos", facts()),
  "active-pvp": home("ranked abierto · manda sobre todo", facts({ matches: [match("RANKED")], progression: { ...facts().progression!, claimableLevels: 2 } })),
  "active-private": home("privada abierta · manda sobre recompensas y Pick'em", facts({ matches: [match("PRIVATE")], pickems: { pending: 2, open: 2, eventId: "ev-qa", eventName: "VCT Masters QA", nextLockAt: NOW + 50 * 60_000 } })),
  "active-draft-combat": home("combate de Draft abierto", facts({ matches: [match("DRAFT")] })),
  "active-draft-drafting": home("Draft eligiendo cartas · por encima de recompensas, por debajo de una partida", facts({ draftRun: { id: "r-qa", status: "DRAFTING", stage: 2 } })),
  "daily-claimable": home("diaria completada · reclamar (en Logros, reclamo canónico)", facts({ progression: { ...facts().progression!, objectives: batch(NOW, { d: [[1], [1], [1]] }) } })),
  "weekly-almost": home("semanal a 1 partida", facts({ progression: { ...facts().progression!, objectives: batch(NOW, { d: [[1, true], [1, true], [2, true]], w: [[4], [3]] }) } })),
  "daily-complete": home("diarias cobradas · el juego sigue", facts({ progression: { ...facts().progression!, objectives: batch(NOW, { d: [[1, true], [1, true], [2, true]] }) } })),
  "weekly-complete": home("semanales cobradas", facts({ progression: { ...facts().progression!, objectives: batch(NOW, { w: [[5, true], [10, true]] }) } })),
  "all-complete": home("todo cobrado · evergreen (campaña, competitivo, partida rápida)", facts({ progression: { ...facts().progression!, objectives: batch(NOW, { d: [[1, true], [1, true], [2, true]], w: [[5, true], [10, true]] }) } })),
  "pickem-soon": home("Pick'em con cierre real en 45 min", facts({ pickems: { pending: 3, open: 3, eventId: "ev-qa", eventName: "VCT Masters QA", nextLockAt: NOW + 45 * 60_000 }, live: [event({ pickem: { open: 3, pending: 3 } })] })),
  "pickem-none": home("sin Pick'em abierto · nada que predecir", facts()),
  "event-live": home("evento con partido en directo real", facts({ live: liveEvent })),
  "event-upcoming": home("evento próximo · nunca «en directo»", facts({ live: [event({ lifecycle: "UPCOMING", nextMatch: { teamA: "Paper Rex", teamB: "LOUD", startTime: new Date(NOW + 26 * H).toISOString() } })] })),
  "event-none": home("sin eventos · bloque vacío honesto", facts({ live: [] })),
  "season-normal": home("temporada con 41 días", facts()),
  "season-ending": home("temporada en su última semana (5 d)", facts({ season: { current: { id: "nexus-s1", name: "Temporada 1", status: "ACTIVE", presentation: "ENDING_SOON", startsAtMs: NOW - 66 * D, endsAtMs: NOW + 5 * D }, next: null } })),
  "return-1d": back(1),
  "return-3d": back(3, { pickems: { pending: 2, open: 2, eventId: "ev-qa", eventName: "VCT Masters QA", nextLockAt: NOW + 9 * H } }),
  "return-7d": back(7, { matches: [match("RANKED")] }),
  "return-14d": back(14, { live: liveEvent }),
  "return-30d": back(30, { progression: { ...facts().progression!, claimableLevels: 3 } }),
  "no-packs": home("sin sobres por abrir", facts({ packs: { unopened: 0 } })),
  "pack-owned": home("2 sobres por abrir", facts({ packs: { unopened: 2 }, progression: { ...facts().progression!, objectives: batch(NOW, { d: [[1, true], [0], [2, true]], w: [[5, true], [10, true]] }) } })),
  "campaign-progress": home("campaña 6/15", facts({ progression: { ...facts().progression!, objectives: [] } })),
  "ranked-progress": home("competitivo 1084 · puesto 12", facts({ progression: { ...facts().progression!, objectives: [] }, campaign: { completed: 15, total: 15, complete: true, next: null } })),
  "subsystem-unavailable": home("Pick'ems, eventos y competitivo caídos · el resto funciona", facts({ pickems: null, live: null, competitive: null })),
  offline: home("sin red · CTA de servidor desactivadas", facts(), { network: "offline" }),
  "reset-imminent": home("faltan 40 min para el reset diario · reclamable con plazo real", facts({ now: RESET - 40 * 60_000, progression: { ...facts({ now: RESET - 40 * 60_000 }).progression!, objectives: batch(RESET - 40 * 60_000, { d: [[1], [0], [1]] }) } })),
  "post-reset": home("5 min tras el reset · tanda nueva a 0", facts({ now: RESET + 5 * 60_000, progression: { ...facts({ now: RESET + 5 * 60_000 }).progression!, objectives: batch(RESET + 5 * 60_000, { d: [[0], [0], [0]] }) } })),
  "clock-ahead": home("reloj del navegador +2 h · la cuenta atrás usa serverNow (misma que normal-today)", facts(), { skewMs: 2 * H }),
  "clock-behind": home("reloj del navegador −2 h · la cuenta atrás usa serverNow", facts(), { skewMs: -2 * H }),
  keyboard: home("foco de teclado en la CTA del héroe", facts(), { focus: true }),
  "long-text": home("textos largos (evento, rival, nodo)", facts({
    matches: [match("PVE", { node: null })],
    live: [event({ name: "VALORANT Champions Tour 2026: Americas League Stage 2 — Playoffs finales", liveCount: 1 })],
    campaign: { completed: 6, total: 15, complete: false, next: { nodeId: "c2-n2", name: "La noche más larga de la historia del circuito", team: "Team Liquid Brazil Academy", chapterOrder: 2 } },
  })),
  "after-match": after("match", "Victoria · partida rápida", "después de una partida: objetivo que avanzó + siguiente acción"),
  "after-pack": after("pack", "Sobre abierto", "después de un sobre: objetivo de sobres/cartas", { packs: { unopened: 1 } }),
  "after-campaign": after("campaign", "Nodo superado", "después de un nodo de campaña"),
  "after-draft": after("draft", "Fase 2 superada", "después de un combate de Draft: 0 economía, solo su fase", { draftRun: { id: "r-qa", status: "READY", stage: 3 } }),
  "after-ranked": after("ranked", "Victoria · ranked (+18)", "después de un ranked"),
  "after-private": after("private", "Privada terminada", "después de una privada", { progression: { ...facts().progression!, objectives: batch(NOW, { d: [[1, true], [1, true], [2, true]], w: [[5, true], [10, true]] }) } }),
};
