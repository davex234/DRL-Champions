/**
 * ARNÉS QA · FASE 40 — PLAYER JOURNEY · ESCENAS QA SYNTHETIC.
 *
 * Lo SINTÉTICO son los hechos de cuenta (cartas poseídas, sobres, equipos, partidas). Lo real: el catálogo, el dominio del
 * recorrido (`buildPlayerJourney`), la prioridad única del vestíbulo (`buildDailyLoop`) y las pantallas reales que se
 * montan en `page.tsx` (vestíbulo, colección, constructor, pre-partida, resultado). Ninguna escena es un jugador real.
 */
import { CARDS, getPlayer } from "@/data/catalog";
import { DUEL_ROLES } from "@/domain/cardgame/types";
import type { RoleId } from "@/domain/cards/types";
import type { DailyLoopFacts, LiveEventFact } from "@/domain/dailyLoop";
import { deckReadiness, type JourneyFacts } from "@/domain/journey";
import type { CollectionPersonalFacts } from "@/domain/collection/room";
import { baseFacts } from "../fase36/fixtures";

export const FASE40_SCENES = [
  "fresh", "welcome", "dismiss", "open-pack", "pack-unavailable",
  "collection", "collection-insufficient", "home-collect", "home-collect-free",
  "deck-ready", "deck-incomplete", "deck-builder-first", "deck-autocomplete", "deck-saved", "active-deck",
  "first-match", "match-active", "match-complete-win", "match-complete-loss", "match-complete-draw", "journey-complete",
  "returning-step2", "returning-step3", "legacy-complete", "active-pvp-override", "active-draft-override",
  "offline", "season-unavailable", "social-unavailable", "events-unavailable", "long-text", "keyboard",
] as const;
export type Fase40Scene = (typeof FASE40_SCENES)[number];

const resolve = (id: string) => {
  const c = CARDS.find((x) => x.id === id);
  const p = c ? getPlayer(c.playerId) : undefined;
  return c && p ? { playerId: c.playerId, role: c.role ?? p.role, dataVersion: c.dataVersion ?? "", combat: !!c.combat } : null;
};

/** Cartas reales: `perRole` jugadores distintos de cada rol (misma versión de datos). */
export function cardsByRole(perRole: Partial<Record<RoleId, number>>): string[] {
  const out: string[] = [];
  const usados = new Set<string>(); // un jugador puede tener cartas de roles distintos: nunca dos veces
  for (const role of DUEL_ROLES) {
    const want = perRole[role] ?? 0;
    const players = new Set<string>();
    for (const c of CARDS) {
      if (players.size >= want) break;
      const p = getPlayer(c.playerId);
      if (!c.combat || !p || (c.role ?? p.role) !== role || (c.dataVersion ?? "") !== "VCT-2026" || usados.has(c.playerId)) continue;
      players.add(c.playerId); usados.add(c.playerId); out.push(c.id);
    }
  }
  return out;
}

export const LEGAL_IDS = cardsByRole({ Duelista: 2, Controlador: 2, Iniciador: 2, Centinela: 2, Flex: 2 });
const STARTER_LIKE = cardsByRole({ Duelista: 5, Controlador: 4, Iniciador: 4, Centinela: 1, Flex: 1 });
const FIVE = cardsByRole({ Duelista: 2, Controlador: 1, Iniciador: 1, Flex: 1 });

const readinessOf = (ids: string[]) => deckReadiness(ids, resolve);

export function journey(o: Partial<JourneyFacts> & { ids?: string[] } = {}): JourneyFacts {
  const ids = o.ids ?? [];
  const { ids: _ignored, ...rest } = o;
  void _ignored;
  return {
    ownedCards: ids.length, packsOpened: 0, matchesCompleted: 0, unopenedPacks: 4, firstPackId: "inicial",
    decks: { total: 0, valid: 0, firstInvalid: null }, readyDeck: null, readiness: readinessOf(ids), ...rest,
  };
}

const NO_DECKS = { total: 0, valid: 0, active: null, firstInvalid: null };
const FRESH_PROGRESS = (o: { owned?: number; opened?: number; duels?: number } = {}) => ({
  ...baseFacts().progression!,
  account: { level: 1, xp: 0, xpIntoLevel: 0, xpForNext: 400, progress: 0 },
  objectives: [], achievements: { total: 24, claimed: 0, claimable: 0, near: null },
  metrics: { ownedCards: o.owned ?? 0, distinctCards: o.owned ?? 0, packsOpened: o.opened ?? 0, duelsPlayed: o.duels ?? 0 },
});

/** Hechos de cuenta en su primera sesión (sin partidas, sin campaña, sin ranked). */
export function firstSession(j: JourneyFacts, o: Partial<DailyLoopFacts> = {}): DailyLoopFacts {
  return baseFacts({
    progression: FRESH_PROGRESS({ owned: j.ownedCards, opened: j.packsOpened, duels: j.matchesCompleted }),
    packs: { unopened: j.unopenedPacks },
    decks: j.decks.valid > 0 ? { total: j.decks.total, valid: j.decks.valid, active: { id: "qa40-deck", name: "Equipo 1", valid: true, size: 10, sumOvr: 742 }, firstInvalid: null }
      : j.decks.firstInvalid ? { total: 1, valid: 0, active: null, firstInvalid: { id: j.decks.firstInvalid.id, name: j.decks.firstInvalid.name, valid: false, size: j.decks.firstInvalid.size, sumOvr: 500 } } : NO_DECKS,
    campaign: { completed: 0, total: 15, complete: false, next: { nodeId: "c1-n1", name: "Primer contacto", team: "NAVI", chapterOrder: 1 } },
    competitive: { rating: null, gamesPlayed: 0, wins: 0, losses: 0, draws: 0, provisional: true, position: null, rankedTotal: 57, recent: [] },
    pickems: { pending: 0, open: 0, eventId: null, eventName: null },
    journey: j,
    ...o,
  });
}

export const READY_DECK = { id: "qa40-deck", name: "Equipo 1", cardIds: LEGAL_IDS, active: true };
const LIVE_NOW: LiveEventFact = { id: "qa40-live", name: "QA SYNTHETIC · Masters", lifecycle: "ACTIVE", isDemo: true, startDate: null, endDate: null, liveCount: 1, liveMatch: { teamA: "FNC", teamB: "G2", scoreA: 1, scoreB: 0 }, nextMatch: null, pickem: null };

export interface HomeScene { kind: "home"; note: string; facts: DailyLoopFacts; dismissed?: boolean; network?: "online" | "offline" | "error" }
export interface CollectionScene { kind: "collection"; note: string; facts: CollectionPersonalFacts; packs: number }
export interface BuilderScene { kind: "builder"; note: string; partial: boolean; autocomplete?: boolean }
export interface HubScene { kind: "team-hub"; note: string }
export interface PrematchScene { kind: "prematch"; note: string }
export interface ResultScene { kind: "result"; note: string; outcome: "win" | "loss" | "draw" }
export type Scene = HomeScene | CollectionScene | BuilderScene | HubScene | PrematchScene | ResultScene;

let seq = 0;
const inst = (ids: string[]): CollectionPersonalFacts => ({
  instances: ids.map((cardId) => ({ uid: `00000040-0000-4000-8000-${String(++seq).padStart(12, "0")}`, cardId, serial: null, mintedVersion: 1 })),
  favorites: [], showcaseUids: [], decks: [],
});

const home = (note: string, facts: DailyLoopFacts, o: Partial<HomeScene> = {}): HomeScene => ({ kind: "home", note, facts, ...o });
const FRESH_J = journey();
const J_PLAY = journey({ ids: LEGAL_IDS, packsOpened: 4, unopenedPacks: 0, firstPackId: null, decks: { total: 1, valid: 1, firstInvalid: null }, readyDeck: READY_DECK });
const J_DONE = journey({ ids: LEGAL_IDS, packsOpened: 4, unopenedPacks: 0, firstPackId: null, decks: { total: 1, valid: 1, firstInvalid: null }, readyDeck: READY_DECK, matchesCompleted: 1 });

export const SCENES: Record<Fase40Scene, Scene> = {
  fresh: home("cuenta recién creada: 4 sobres, 0 cartas", firstSession(FRESH_J)),
  welcome: home("bienvenida con tres cartas reales del catálogo", firstSession(FRESH_J)),
  dismiss: home("«Explorar por mi cuenta»: la guía baja a una tira; el paso real sigue", firstSession(FRESH_J), { dismissed: true }),
  "open-pack": home("con un sobre abierto y 3 por abrir (paso 2: colecciona)", firstSession(journey({ ids: FIVE, packsOpened: 1, unopenedPacks: 3 }))),
  "pack-unavailable": home("cuenta rara sin sobres ni cartas: Sobre Inicial gratis, sin regalo", firstSession(journey({ unopenedPacks: 0, firstPackId: null }))),
  collection: { kind: "collection", note: "colección que YA forma equipo: coach + construir", facts: inst(LEGAL_IDS), packs: 0 },
  "collection-insufficient": { kind: "collection", note: "20 cartas de sobres de bienvenida sin 2 Centinela/2 Flex", facts: inst(STARTER_LIKE), packs: 0 },
  "home-collect": home("todos los sobres abiertos, faltan roles (paso 2)", firstSession(journey({ ids: STARTER_LIKE, packsOpened: 4, unopenedPacks: 0, firstPackId: null }))),
  "home-collect-free": home("faltan roles y no quedan sobres: Sobre Inicial gratis", firstSession(journey({ ids: STARTER_LIKE, packsOpened: 4, unopenedPacks: 0, firstPackId: null }))),
  "deck-ready": home("colección suficiente, sin equipo (paso 3)", firstSession(journey({ ids: LEGAL_IDS, packsOpened: 5, unopenedPacks: 0, firstPackId: null }))),
  "deck-incomplete": home("equipo guardado a medias (7/10)", firstSession(journey({ ids: LEGAL_IDS, packsOpened: 5, unopenedPacks: 0, firstPackId: null, decks: { total: 1, valid: 0, firstInvalid: { id: "qa40-half", name: "Equipo 1", size: 7 } } }))),
  "deck-builder-first": { kind: "builder", note: "constructor real con el coach del primer equipo", partial: true },
  "deck-autocomplete": { kind: "builder", note: "constructor real tras «Autocompletar equipo» (backtracking canónico)", partial: true, autocomplete: true },
  "deck-saved": home("equipo guardado y legal: PLANTILLA LISTA (paso 4)", firstSession(J_PLAY)),
  "active-deck": { kind: "team-hub", note: "hub de equipos con el primer equipo activo (aviso de activación automática)" },
  "first-match": { kind: "prematch", note: "pre-partida real con Fácil preseleccionado y reglas del motor" },
  "match-active": home("partida PvE a medias: CONTINUAR gana a la guía", firstSession(J_PLAY, { matches: [{ id: "qa40-pve", mode: "PVE", difficulty: "EASY", opponent: null, node: null }] })),
  "match-complete-win": { kind: "result", note: "resultado real del motor: victoria + primera sesión completada", outcome: "win" },
  "match-complete-loss": { kind: "result", note: "resultado real del motor: derrota + primera sesión completada", outcome: "loss" },
  "match-complete-draw": { kind: "result", note: "empate fabricado (forma del servidor) + primera sesión completada", outcome: "draw" },
  "journey-complete": home("vestíbulo tras la primera partida: destinos reales", firstSession(J_DONE, { progression: { ...FRESH_PROGRESS({ owned: 10, opened: 4, duels: 1 }) } })),
  "returning-step2": home("vuelve al día siguiente tras abrir sobres: sin bienvenida", firstSession(journey({ ids: FIVE, packsOpened: 2, unopenedPacks: 2 }))),
  "returning-step3": home("vuelve con colección suficiente y sin equipo", firstSession(journey({ ids: STARTER_LIKE.concat(cardsByRole({ Centinela: 2, Flex: 2 })), packsOpened: 6, unopenedPacks: 0, firstPackId: null }))),
  "legacy-complete": home("cuenta veterana: vestíbulo normal, sin guía", baseFacts({ journey: journey({ ids: LEGAL_IDS, packsOpened: 30, unopenedPacks: 0, decks: { total: 2, valid: 2, firstInvalid: null }, matchesCompleted: 40 }) })),
  "active-pvp-override": home("ranked a medias: CONTINUAR gana; guía en tira", firstSession(FRESH_J, { matches: [{ id: "qa40-pvp", mode: "RANKED", difficulty: null, opponent: "QA_Rival", node: null }] })),
  "active-draft-override": home("combate de Draft Gauntlet a medias: CONTINUAR gana", firstSession(J_PLAY, { matches: [{ id: "qa40-run", mode: "DRAFT", difficulty: null, opponent: null, node: null }] })),
  offline: home("sin conexión: última foto, acciones desactivadas", firstSession(journey({ ids: FIVE, packsOpened: 1, unopenedPacks: 3 })), { network: "offline" }),
  "season-unavailable": home("temporada caída: la guía sigue", firstSession(FRESH_J, { season: null })),
  "social-unavailable": home("social caído: la guía sigue", firstSession(FRESH_J, { social: null })),
  "events-unavailable": home("eventos caídos: la guía sigue", firstSession(FRESH_J, { live: null, pickems: null })),
  "long-text": home("nombres largos y directo real en destinos", firstSession(journey({ ids: LEGAL_IDS, packsOpened: 5, unopenedPacks: 0, firstPackId: null, decks: { total: 1, valid: 0, firstInvalid: { id: "qa40-long", name: "Plantilla con un nombre larguísimo de pru", size: 9 } } }), { live: [LIVE_NOW] })),
  keyboard: home("foco de teclado en el CTA principal", firstSession(FRESH_J)),
};
