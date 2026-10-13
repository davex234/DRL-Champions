"use client";

/**
 * FASE 55 · CENTRO COMPETITIVO — `/competitivo`.
 *
 * Una pantalla de juego, no un panel de control: héroe con el puesto y el rating (la escalera real como
 * rango), JUGAR COMPETITIVO dominante con la puerta del mazo delante, temporada actual, últimas partidas con
 * su cambio de rating, clasificación paginada y el carril competitivo del pase (la única recompensa que
 * existe). Recibe UN `CompetitiveSnapshot` (servidor o fixture QA) y la puerta de juego ya resuelta.
 * Aquí no se calcula ni un punto de rating ni un puesto.
 */
import Link from "next/link";
import type { CompetitiveSnapshot, CompetitiveLadderPage } from "@/server/services/competitive";
import type { RankedGate, ReadinessDeck, StandingEntry } from "@/domain/pvpLadder/ranked";
import { trackCompetitive } from "@/lib/competitive/telemetry";
import { RankedHero } from "./RankedHero";
import { RankedPlayPanel } from "./RankedPlayPanel";
import { SeasonStrip } from "./SeasonStrip";
import { RecentMatchCards } from "./RecentMatchCards";
import { RankedLadder } from "./RankedLadder";
import { CompetitiveRewards } from "@/components/competitive/CompetitiveRewards";
import { RatingChart } from "@/components/competitive/RatingChart";
import { RankLegend } from "./RankLegend";
import { ns } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("competitive");

export interface RankedCenterProps {
  snap: CompetitiveSnapshot;
  gate: RankedGate | null;
  legalDecks: ReadinessDeck[];
  onChooseDeck?: (deckId: string) => void;
  resumeHref?: string | null;
  loadingDecks?: boolean;
  deckError?: string | null;
  onRetryDecks?: () => void;
  loadLadderPage?: (offset: number) => Promise<CompetitiveLadderPage | null>;
}

export function RankedCenter({ snap, gate, legalDecks, onChooseDeck, resumeHref, loadingDecks, deckError, onRetryDecks, loadLadderPage }: RankedCenterProps) {
  useLocale();
  const rows: StandingEntry[] = [...snap.leaderboardTop, ...snap.aroundMe].map((e) => ({ position: e.position, rating: e.rating, username: e.username, isSelf: e.isSelf }));
  const recent = snap.recentMatches.slice(0, 5);
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-0 sm:space-y-8" data-scene="ranked-center">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-stretch xl:grid-cols-[minmax(0,1fr)_380px]">
        <RankedHero self={snap.self} stats={snap.stats} rows={rows} competitive={snap.competitive} />
        <RankedPlayPanel gate={gate} legalDecks={legalDecks} onChoose={onChooseDeck} resumeHref={resumeHref} loadingDecks={loadingDecks} deckError={deckError} onRetryDecks={onRetryDecks} />
      </div>

      <SeasonStrip season={snap.season} />

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-label={t("Últimas partidas")} className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 className="font-display text-[20px] font-bold uppercase tracking-wide text-white">{t("Últimas partidas")}</h2>
            {snap.recentMatches.length > 0 && (
              <Link href="/duelos/competitivo/historial" className="nx-action" onClick={() => trackCompetitive("history_view")} data-testid="ranked-history-link">{t("Historial completo →")}</Link>
            )}
          </div>
          <RecentMatchCards matches={recent} />
          {snap.ratingSeries.length > 1 && (
            <div className="pt-2">
              <p className="nx-label mb-1.5">{t("Evolución del rating")}</p>
              <RatingChart points={snap.ratingSeries} />
            </div>
          )}
        </section>
        <RankedLadder top={snap.leaderboardTop} aroundMe={snap.aroundMe} topSize={snap.competitive.season?.top.size ?? 500}
          rules={snap.competitive.season ? { ...snap.competitive.season.top, placementGames: snap.competitive.season.placementGames } : null}
          rankedTotal={snap.self.rankedTotal} selfPosition={snap.self.position} loadPage={loadLadderPage} />
      </div>

      <RankLegend version={snap.competitive.season?.rankConfigVersion ?? null} current={snap.competitive.standing.rank?.step ?? null} />

      <section aria-label={t("Recompensas competitivas")} className="space-y-2">
        <h2 className="font-display text-[20px] font-bold uppercase tracking-wide text-white">{t("Recompensas competitivas")}</h2>
        <CompetitiveRewards rewards={snap.rewards} />
      </section>
    </div>
  );
}
