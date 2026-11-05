"use client";

/**
 * ARNÉS QA · FASE 27 — `/design-system/fase27?scene=<escena>` (solo capturas y revisión).
 *
 * Renderiza las piezas REALES del Meta Hub (`MetaHub`, `LevelHero`, `PostMatchProgress`,
 * `LoopStrip`…) con `MetaSnapshot`s **QA SYNTHETIC** (`./fixtures`): contenido real de la temporada,
 * el pool y los logros; cifras inventadas y etiquetadas. Sin sesión, sin servidor, sin escrituras.
 */
import { useEffect, useState } from "react";
import { MotionConfig } from "framer-motion";
import { Badge } from "@/components/ui/Badge";
import { NxButton } from "@/components/ui/NxButton";
import { ErrorState } from "@/components/ui/States";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { LevelHero } from "@/components/progression/LevelHero";
import { MetaHub, Competitive } from "@/components/progression/MetaHub";
import { TodayPanel } from "@/components/progression/TodayPanel";
import { ObjectiveList, ObjectiveCard } from "@/components/progression/ObjectiveList";
import { AchievementGrid, AchievementCard } from "@/components/progression/AchievementGrid";
import { FreeTrack } from "@/components/progression/FreeTrack";
import { SeasonPanel } from "@/components/progression/SeasonPanel";
import { RewardHistory } from "@/components/progression/RewardHistory";
import { PostMatchProgress } from "@/components/progression/PostMatchProgress";
import { ProgressAlerts } from "@/components/progression/ProgressAlerts";
import { FtueSteps } from "@/components/progression/FtueSteps";
import { LoopStrip } from "@/components/lobby/LoopStrip";
import { NextUp } from "@/components/loop/NextUp";
import { diffSnapshots } from "@/lib/progression/meta";
import { todayActions, continueCta, achievementCategory } from "@/domain/progression/meta";
import { snapshotFrom, NEW_PLAYER, PROGRESSED, NEAR_LEVEL_UP, JUST_LEVELED, NO_REWARDS, RETURNING, QA_NOW } from "./fixtures";

const SCENES = [
  "hub-new", "hub-progress", "level-hero", "near-levelup", "levelup", "today", "objectives", "objective-partial", "objective-complete",
  "reward", "achievements", "achievement-detail", "free-track", "season", "post-match", "pack-objective", "collection-objective",
  "pickem-cta", "competitive", "home-loop", "returning", "no-rewards", "backend-unavailable", "concurrent",
] as const;

export default function Fase27QaPage() {
  return (
    <HydrationGate>
      <Harness />
    </HydrationGate>
  );
}

function Harness() {
  const [scene, setScene] = useState("");
  useEffect(() => { setScene(new URLSearchParams(window.location.search).get("scene") ?? ""); }, []);

  const newPlayer = snapshotFrom(NEW_PLAYER);
  const progress = snapshotFrom(PROGRESSED);
  const near = snapshotFrom(NEAR_LEVEL_UP);
  const leveled = snapshotFrom(JUST_LEVELED);
  const none = snapshotFrom(NO_REWARDS);
  const returning = snapshotFrom(RETURNING);

  // Post-partida: «antes» = a un paso del nivel; «después» = subió, ganó el duelo y avanzó objetivos.
  const afterMatch = snapshotFrom({
    ...JUST_LEVELED,
    duelsPlayed: PROGRESSED.duelsPlayed + 1, duelsWon: PROGRESSED.duelsWon + 1,
    objectives: PROGRESSED.objectives.map((o) =>
      o.id === "d-duelo-win" ? { ...o, current: 1, complete: true }
        : o.id === "w-duelos-5" ? { ...o, current: 4 }
          : o.id === "w-victorias" ? { ...o, current: 2 }
            : o.id === "p-puntos-400" ? { ...o, current: 228 } : o),
  });
  const matchDelta = diffSnapshots(near, afterMatch);
  // Post-apertura: un sobre abierto avanza «Abre un sobre» y completa «Abridor en serie» (QA: 100 sobres).
  const afterPack = snapshotFrom({
    ...PROGRESSED, packsOpened: 100,
    objectives: PROGRESSED.objectives.map((o) => (o.id === "d-abrir-1" ? { ...o, current: 1, complete: true } : o.id === "p-coleccion-50" ? { ...o, current: 41 } : o)),
    achievements: PROGRESSED.achievements.map((a) => (a.id === "sobres-100" ? { ...a, current: 100, complete: true } : a)),
  });
  const packDelta = diffSnapshots(progress, afterPack);

  const body = () => {
    switch (scene) {
      case "hub-new": return <><LevelHero level={newPlayer.level} className="mb-6" /><MetaHub snap={newPlayer} /></>;
      case "hub-progress": return <><LevelHero level={progress.level} className="mb-6" /><MetaHub snap={progress} /></>;
      case "level-hero": return <LevelHero level={progress.level} />;
      case "near-levelup": return <LevelHero level={near.level} />;
      case "levelup": return <><LevelHero level={leveled.level} lastLevelUp={6} className="mb-6" /><PostMatchProgress delta={matchDelta} /><ProgressAlerts events={matchDelta.events} ttlMs={600_000} /></>;
      case "today": return <TodayPanel actions={todayActions({ steps: progress.loop.steps, objectives: progress.objectives })} />;
      case "objectives": return <ObjectiveList objectives={progress.objectives} now={QA_NOW} />;
      case "objective-partial": return <div className="grid gap-2.5 sm:grid-cols-3">{progress.objectives.filter((o) => !o.complete && o.current > 0).slice(0, 3).map((o) => <ObjectiveCard key={o.id} objective={o} now={QA_NOW} />)}</div>;
      case "objective-complete": return <div className="grid gap-2.5 sm:grid-cols-3">{progress.objectives.filter((o) => o.complete).slice(0, 3).map((o) => <ObjectiveCard key={o.id} objective={o} now={QA_NOW} />)}</div>;
      case "reward": return <RewardHistory rewards={progress.rewards} />;
      case "achievements": return <AchievementGrid achievements={progress.pass.achievements} />;
      case "achievement-detail": return <div className="grid gap-2.5 sm:grid-cols-2">{["completa-emea", "sobres-100", "primer-mvp", "coleccionista"].map((id) => { const a = progress.pass.achievements.find((x) => x.id === id)!; return <AchievementCard key={id} a={a} />; })}</div>;
      case "free-track": return <FreeTrack levels={progress.pass.tracks.free} currentLevel={progress.pass.level} maxLevel={progress.pass.season.maxLevel} />;
      case "season": return <SeasonPanel season={progress.season} competitiveUnlocked={false} points={progress.account.points} competitiveMinPoints={progress.pass.competitiveMinPoints} serverNow={QA_NOW} />;
      case "post-match": return <PostMatchProgress delta={{ ...matchDelta, levelsGained: [] }} />;
      case "pack-objective": return <PostMatchProgress delta={packDelta} />;
      case "collection-objective": return <div className="grid gap-2.5 sm:grid-cols-3">{progress.objectives.filter((o) => o.metric === "distinct_cards").map((o) => <ObjectiveCard key={o.id} objective={o} now={QA_NOW} />)}{progress.pass.achievements.filter((a) => achievementCategory(a.id) === "COLECCION" && !a.claimed).slice(0, 2).map((a) => <AchievementCard key={a.id} a={a} />)}</div>;
      case "pickem-cta": return <TodayPanel actions={todayActions({ steps: progress.loop.steps.filter((s) => s.kind !== "claim"), objectives: [] })} />;
      case "competitive": return <div className="max-w-md"><Competitive snap={progress} /></div>;
      case "home-loop": {
        const actions = todayActions({ steps: progress.loop.steps, objectives: progress.objectives });
        return (
          <div className="space-y-6">
            <LoopStrip unopened={{ estandar: 2 }} owned={[]} deck={{ name: "QA SYNTHETIC · Mi equipo", size: 10, valid: true }} meta={{
              level: progress.level, activeObjectives: progress.loop.progression?.activeObjectives ?? 0,
              claimable: progress.loop.progression?.claimable ?? 0, pendingPicks: 3, continueTo: continueCta(actions),
            }} />
            <NextUp steps={progress.loop.steps} />
          </div>
        );
      }
      case "returning": return <><TodayPanel actions={todayActions({ steps: returning.loop.steps, objectives: returning.objectives })} /><div className="mt-6"><ObjectiveList objectives={returning.objectives} now={QA_NOW} max={3} /></div></>;
      case "no-rewards": return <><TodayPanel actions={todayActions({ steps: none.loop.steps, objectives: none.objectives })} /><div className="mt-6"><RewardHistory rewards={none.rewards} /></div><div className="mt-6"><ObjectiveList objectives={[]} now={QA_NOW} /></div></>;
      case "backend-unavailable": return <><LevelHero level={progress.level} className="mb-6" /><ErrorState message="No se pudo leer tu progresión" onRetry={() => {}} /></>;
      case "concurrent": return (
        <div className="max-w-xl space-y-3 text-caption text-ink-secondary">
          <p>Dos peticiones que completan el mismo objetivo: una recompensa. Lo garantizan la clave de idempotencia del libro mayor (`mission:temporada:id:tanda:baseline`) y la clave primaria de `user_achievements`. Se afirma por test (contrato sobre el servicio), no por captura.</p>
          <FtueSteps ftue={newPlayer.ftue} />
        </div>
      );
      default: return (
        <div className="flex flex-wrap gap-2">
          {SCENES.map((s) => <NxButton key={s} variant="secondary" size="sm" href={`/design-system/fase27?scene=${s}`}>{s}</NxButton>)}
        </div>
      );
    }
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="mx-auto w-full max-w-5xl px-4 py-5" data-qa-scene={scene || "index"}>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Badge tone="warn" solid>QA SYNTHETIC</Badge>
          <span className="font-display text-[13px] font-bold uppercase text-white">Arnés Fase 27 · {scene || "índice"}</span>
          <span className="text-caption text-ink-faint">temporada, pool y logros reales · cifras inventadas · sin servidor</span>
        </div>
        {body()}
      </div>
    </MotionConfig>
  );
}
