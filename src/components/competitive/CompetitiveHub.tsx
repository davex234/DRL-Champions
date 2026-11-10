"use client";

/**
 * CUERPO DEL COMPETITIVE HUB (Fase 28). Recibe UN `CompetitiveSnapshot` (del servidor o QA
 * SYNTHETIC en el arnés). Orden pensado para móvil: hero (rating, posición, récord, forma) → CTA
 * → alrededor de mí → últimas partidas → evolución → recompensas → tus cartas → top completo.
 */
import Link from "next/link";
import type { CompetitiveSnapshot } from "@/server/services/competitive";
import { trackCompetitive } from "@/lib/competitive/telemetry";
import { CompetitiveHero } from "./CompetitiveHero";
import { Leaderboard } from "./Leaderboard";
import { MatchHistoryList } from "./MatchHistoryList";
import { RatingChart } from "./RatingChart";
import { CompetitiveRewards } from "./CompetitiveRewards";
import { CardPerformanceCard } from "./CardPerformanceCard";
import { SectionTitle } from "@/components/ui/SectionTitle";

export function CompetitiveHub({ snap }: { snap: CompetitiveSnapshot }) {
  const last = snap.ratingSeries.length > 0 ? snap.ratingSeries[snap.ratingSeries.length - 1] : null;
  const recent = snap.recentMatches.slice(0, 5);
  const inTop = snap.leaderboardTop.some((e) => e.isSelf);
  return (
    <div className="mx-auto w-full max-w-5xl space-y-7" data-scene="competitive-hub">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="font-display text-label uppercase tracking-wide2 text-drl">Competitivo</span>
          <h1 className="mt-1 font-display text-[clamp(40px,6vw,68px)] font-bold uppercase leading-[0.9] tracking-wide text-white">Ranked</h1>
          <p className="mt-1 max-w-lg text-sm text-ink-muted">Rating real, escalera real. Cada partida liquidada mueve tu rating y tu posición.</p>
        </div>
        <Link href="/duelos" className="nx-action">‹ Duelos</Link>
      </header>

      <CompetitiveHero self={snap.self} stats={snap.stats} last={last} />

      <Leaderboard
        title="Alrededor de ti"
        caption={snap.self.position !== null ? `#${Math.max(1, snap.self.position - 3)} – #${Math.min(snap.self.rankedTotal, snap.self.position + 3)}` : undefined}
        entries={snap.aroundMe}
        emptyText={snap.self.position === null
          ? "Juega tu primera partida ranked para aparecer en la escalera."
          : inTop ? "Estás en el top: tu fila está en la escalera de abajo." : "Sin vecinos que enseñar todavía."}
      />

      <section aria-label="Últimas partidas">
        <SectionTitle action={<Link href="/duelos/competitivo/historial" className="nx-action" onClick={() => trackCompetitive("history_view")}>Historial completo →</Link>}>Últimas partidas</SectionTitle>
        <MatchHistoryList matches={recent} />
      </section>

      <section aria-label="Evolución">
        <SectionTitle>Evolución del rating</SectionTitle>
        <RatingChart points={snap.ratingSeries} />
      </section>

      <section aria-label="Recompensas competitivas">
        <SectionTitle>Recompensas competitivas</SectionTitle>
        <CompetitiveRewards rewards={snap.rewards} />
      </section>

      <CardPerformanceCard cards={snap.cards} />

      <Leaderboard
        title={`Top ${snap.leaderboardTop.length}`}
        caption={`${snap.self.rankedTotal} ${snap.self.rankedTotal === 1 ? "jugador clasificado" : "jugadores clasificados"} · rating desc.; a igual rating, quien lo alcanzó antes`}
        entries={snap.leaderboardTop}
      />
    </div>
  );
}
