"use client";

/**
 * CUERPO DEL META HUB (Fase 27). Recibe UN `MetaSnapshot` (del servidor, o QA SYNTHETIC en el
 * arnés) y compone: primera sesión, HOY, objetivos, recorrido gratuito, temporada + competitivo,
 * logros, recompensas recientes. Solo lectura: enlaza a «Logros y pase» para reclamar.
 */
import { useMemo } from "react";
import Link from "next/link";
import { rankProgress } from "@/domain/progression/rank";
import { todayActions } from "@/domain/progression/meta";
import type { MetaSnapshot } from "@/server/services/meta";
import { trackMeta } from "@/lib/progression/telemetry";
import { TodayPanel } from "./TodayPanel";
import { ObjectiveList } from "./ObjectiveList";
import { FreeTrack } from "./FreeTrack";
import { SeasonPanel } from "./SeasonPanel";
import { AchievementGrid } from "./AchievementGrid";
import { RewardHistory } from "./RewardHistory";
import { FtueSteps } from "./FtueSteps";
import { RankBadge } from "./RankBadge";
import { Plate } from "@/components/ui/Surface";
import { Readout } from "@/components/ui/Readout";
import { SectionTitle } from "@/components/ui/SectionTitle";

export function MetaHub({ snap }: { snap: MetaSnapshot }) {
  const actions = useMemo(() => todayActions({ steps: snap.loop.steps, objectives: snap.objectives, max: 4 }), [snap]);
  const now = snap.serverNow;
  const active = snap.objectives.filter((o) => !o.claimed).length;

  return (
    <div className="space-y-8" data-meta-hub={snap.ftue.isNew ? "new" : "progress"}>
      {snap.ftue.isNew && <FtueSteps ftue={snap.ftue} />}

      <TodayPanel actions={actions} onAction={() => trackMeta("continue_action")} />

      <section id="objetivos" aria-label="Objetivos">
        <SectionTitle action={<span className="nx-label">{active} activos</span>}>Objetivos</SectionTitle>
        <ObjectiveList objectives={snap.objectives} now={now} />
      </section>

      <section aria-label="Recorrido gratuito">
        <SectionTitle>Recorrido gratuito</SectionTitle>
        <FreeTrack levels={snap.pass.tracks.free} currentLevel={snap.pass.level} maxLevel={snap.pass.season.maxLevel} />
      </section>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <SeasonPanel
          season={snap.season}
          competitiveUnlocked={snap.pass.competitiveUnlocked}
          points={snap.account.points}
          competitiveMinPoints={snap.pass.competitiveMinPoints}
          serverNow={snap.serverNow}
        />
        <Competitive snap={snap} />
      </div>

      <section aria-label="Logros">
        <SectionTitle>Logros</SectionTitle>
        <AchievementGrid achievements={snap.pass.achievements} />
      </section>

      <section aria-label="Recompensas recientes">
        <SectionTitle>Lo último que has ganado</SectionTitle>
        <RewardHistory rewards={snap.rewards} />
      </section>
    </div>
  );
}

/** Competitivo: rango por puntos (tiers reales), rating PvP si hay ficha, duelos jugados/ganados. */
export function Competitive({ snap }: { snap: MetaSnapshot }) {
  const rank = rankProgress(snap.account.points);
  return (
    <Plate className="flex flex-col gap-3 p-5" data-competitive={rank.tier.id}>
      <span className="nx-label">Competitivo</span>
      <RankBadge points={snap.account.points} action={{ href: "/ranking", label: "Clasificación" }} />
      <div className="grid grid-cols-3 gap-3">
        <Readout size="sm" label="Duelos" value={snap.duels.played} />
        <Readout size="sm" label="Victorias" value={snap.duels.won} tone="var(--nx-ok)" />
        <Readout size="sm" label="Rating PvP" value={snap.rating ? snap.rating.rating : "—"} tone={snap.rating ? "var(--nx-cyan)" : undefined} />
      </div>
      {snap.rating?.provisional && (
        <p className="text-caption text-ink-faint">Rating provisional: {snap.rating.gamesPlayed} {snap.rating.gamesPlayed === 1 ? "partida" : "partidas"} PvP.</p>
      )}
      {/* Fase 28 · la tarjeta es la puerta al Competitive Hub; la escalera entera vive allí. */}
      <Link href="/competitivo" className="nx-focus nx-clip-sm mt-1 inline-flex min-h-[44px] items-center justify-center border border-drl-cyan/50 px-4 font-display text-[11px] font-bold uppercase tracking-[0.12em] text-drl-cyan transition hover:bg-drl-cyan/10" data-ladder={snap.ladder?.position ?? "unranked"}>
        {snap.ladder?.position ? `Estás #${snap.ladder.position} en ranked` : "Ver el competitivo"} →
      </Link>
    </Plate>
  );
}
