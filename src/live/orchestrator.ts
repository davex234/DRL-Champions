/**
 * LIVE ECOSYSTEM — ORQUESTADOR (el cerebro / pipeline CANÓNICO del ciclo live).
 * ⚠️ LEGACY parcial (Card Generator F4, 2026-07-09): la DECISIÓN editorial de cartas canónica
 * es `src/card-generator` (generateCards sobre AnalyzerResult); este ciclo la precede.
 *
 * Un único flujo, sin bypass, que COMPONE los motores ya existentes (no duplica lógica):
 *   Provider → Normalizer → Identity → Tournament → Stats → Rating → Card Decision →
 *   Card Generator → Collections/Market → News → Events → Challenges → Analytics.
 * Robusto: si una fuente falla, hace failover, registra y continúa; si todas fallan,
 * el sistema queda estable. Determinista (reloj inyectable). Reutilizable por un cron.
 */
import { normalizeTournament } from "@/engine/sources/normalize";
import { generateCards } from "@/engine/cardGenerator";
import type { GeneratedCard } from "@/engine/types";
import { ratingFromCardStats, rarityFor, abilityLabels, decideCard, buildCardNews, type NewsItem, type CardAction, type RarityTier, type Stage } from "@/intel";
import type { LiveDataProvider } from "./provider";
import { viaProviders, discoverAcross } from "./provider";
import {
  type Timeline, seasonOf, ensureTournament, ensureTeam, ensurePlayer, historyFor, recordCard, hasCard, playerKey,
} from "./timeline";
import { decideMarket, type MarketPolicy } from "./market";
import { generateChallenges, type Challenge } from "./challenges";
import {
  type EcoEvent, tournamentFinished, championEvent, mvpEvent, debutEvent, transferEvent, historicAce,
} from "./events";
import { createAnalytics, finalizeAnalytics, type Analytics } from "./analytics";
import { ns } from "@/i18n/runtime";

const tr = ns("live");

export interface LiveCard {
  playerId: string; nick: string; family: string; kind: string;
  rating: number; tier: RarityTier; tierLabel: string; abilities: string[];
  action: CardAction; season: number; tournamentId: string;
}

export interface LiveCycleResult {
  analytics: Analytics;
  cards: LiveCard[];
  news: NewsItem[];
  events: EcoEvent[];
  challenges: Challenge[];
  market: Record<string, MarketPolicy>;
  logs: string[];
  timeline: Timeline;
}

const stageFor = (kind: string): Stage => (kind === "mvp" || kind === "winner" || kind === "icon" ? "final" : kind === "prime" ? "playoffs" : "groups");

export async function runLiveCycle(
  providers: LiveDataProvider[],
  timeline: Timeline,
  opts: { now?: () => number; game?: string } = {},
): Promise<LiveCycleResult> {
  const now = opts.now ?? (() => Date.now());
  const game = opts.game ?? "valorant";
  const a = createAnalytics(now());
  const logs: string[] = [];
  const cards: LiveCard[] = [];
  const news: NewsItem[] = [];
  const eco: EcoEvent[] = [];
  const market: Record<string, MarketPolicy> = {};
  const log = (m: string) => logs.push(`${now()} · ${m}`);

  // 1) DISCOVER en todo el ecosistema (unión + dedup por identidad).
  const disc = await discoverAcross(providers, game, a.attempts, now);
  a.providerUsed = disc.used[0] ?? null;
  log(`discover → ${disc.tournaments.length} torneos (fuentes: ${disc.used.join(", ") || "ninguna"})`);

  for (const raw of disc.tournaments) {
    try {
      const t = normalizeTournament(raw);
      if (t.status !== "finished") { a.tournamentsSkipped++; continue; }

      const season = seasonOf(raw);
      const tc = ensureTournament(timeline, raw, season); // IDENTITY autoridad de torneo
      if (!tc.isNew) { a.tournamentsSkipped++; a.duplicatesAvoided++; log(`skip ${t.name}: torneo ya procesado`); continue; }

      const teams = (await viaProviders(providers, game, "fetchTeams", (p) => p.fetchTeams(raw.id), (v) => v.length === 0, [], a.attempts, now)).value;
      const result = (await viaProviders(providers, game, "fetchResult", (p) => p.fetchResult(raw.id), (v) => v == null, null, a.attempts, now)).value;
      if (!result) { a.errors.push(tr("{name}: sin resultados", { name: t.name })); log(`ERROR ${t.name}: sin resultados (continúa)`); continue; }

      a.tournamentsProcessed++;
      eco.push(tournamentFinished(tc.id, t.name, season, now()));
      const champ = teams.find((x) => x.id === result.winnerTeamId);
      if (champ) eco.push(championEvent(tc.id, t.name, season, champ.name, now()));

      // CARD GENERATOR existente (reuse) → candidatos por familia.
      const candidates: GeneratedCard[] = generateCards(t, teams, result);

      for (const card of candidates) {
        const teamId = ensureTeam(timeline, { name: card.player.team });
        const ply = ensurePlayer(timeline, { id: card.playerId, nick: card.playerNick }, season, teamId); // IDENTITY autoridad
        if (ply.isDebut) { a.newPlayers++; eco.push(debutEvent(tc.id, t.name, season, card.playerNick, now())); }
        if (ply.isTransfer) eco.push(transferEvent(tc.id, t.name, season, card.playerNick, card.player.team, now()));

        // STATS + RATING contextual.
        const rating = ratingFromCardStats(card.player.stats, { type: t.type, stage: stageFor(card.kind) });
        const before = timeline.players[ply.id]?.bestRating ?? null;

        // DECISION de ciclo de vida.
        const won = card.kind === "winner";
        const mvp = card.kind === "mvp" || card.kind === "icon";
        const decision = decideCard({ rating, won, mvp, family: card.accolade, history: historyFor(timeline, ply.id) });
        if (decision.action === "keep") {
          if (hasCard(timeline, ply.id, card.accolade, season)) a.duplicatesAvoided++; else a.cardsKept++;
          continue;
        }

        // ACUÑACIÓN (autoridad anti-duplicado).
        if (recordCard(timeline, ply.id, { season, tournamentId: tc.id, family: card.accolade, rating, createdAt: now() }).isDuplicate) {
          a.duplicatesAvoided++; continue;
        }
        if (before != null && rating !== before) a.ratingChanges++;

        const abilities = abilityLabels(card.player.stats);
        const tier = rarityFor(rating);
        cards.push({ playerId: ply.id, nick: card.playerNick, family: card.accolade, kind: card.kind, rating, tier: tier.tier, tierLabel: tier.label, abilities, action: decision.action, season, tournamentId: tc.id });
        if (decision.action === "special") a.cardsSpecial++; else if (decision.action === "improve") a.cardsImproved++; else a.cardsCreated++;

        market[`${ply.id}:${card.accolade}`] = decideMarket(card.accolade, tier.tier);
        news.push(buildCardNews({ playerNick: card.playerNick, tournamentName: t.name, rating, tierLabel: tier.label, action: decision.action, abilities, family: card.accolade, won, mvp, at: now() }));
        if (card.player.stats.clu >= 88 && mvp) eco.push(historicAce(tc.id, t.name, season, card.playerNick, now()));
      }

      if (result.mvpPlayerId) {
        const m = result.stats.find((s) => s.playerId === result.mvpPlayerId);
        if (m) {
          // La identidad manda también en el texto: usa el nick canónico de la carrera.
          const nick = timeline.players[playerKey({ id: m.playerId, nick: m.nick })]?.nick ?? m.nick;
          eco.push(mvpEvent(tc.id, t.name, season, nick, now()));
        }
      }
      log(`procesado ${t.name} [${season}]: ${cards.length} cartas / ${news.length} noticias acumuladas`);
    } catch (e) {
      a.errors.push(`${raw.name}: ${(e as Error).message}`);
      log(`ERROR en ${raw.name}: ${(e as Error).message} (el sistema continúa)`);
    }
  }

  const challenges = generateChallenges(eco);
  a.news = news.length; a.events = eco.length; a.challenges = challenges.length;
  finalizeAnalytics(a, now());
  return { analytics: a, cards, news, events: eco, challenges, market, logs, timeline };
}
