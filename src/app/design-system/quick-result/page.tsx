"use client";

/**
 * ARNÉS QA · RESULTADO DE PARTIDA RÁPIDA — `/design-system/quick-result?scene=win|loss|draw|campaign|win-rewards|loss-rewards|rewards-types|zero`.
 *
 * La pieza REAL (`QuickMatchResult`) sobre el estadio real (`ArenaEnvironment`, arena rápida) con las partidas QA SYNTHETIC
 * de la Fase 45 (motor puro, sin red). `campaign` = la misma partida con contexto CAMPAIGN: debe salir el resultado
 * COMPLETO (`ResultScreen`), que es lo que demuestra el aislamiento. Sin sesión: los botones no navegan a ningún sitio real.
 *
 * DUEL GAMEPLAY UX 2.0 · escenas de «Recompensas obtenidas» con RECIBOS FIXTURE (no son premios del juego; en
 * producción el recibo lo pone el servidor desde el libro mayor): `win-rewards`/`loss-rewards` con las cifras de la tabla
 * real en NORMAL, `rewards-types` con sobre ×2 + carta + insignia (todos los tipos que sabe pintar), `zero` = recibo vacío
 * (partida topada): no hay sección.
 */
import { useEffect, useState } from "react";
import { MotionConfig } from "framer-motion";
import { ArenaEnvironment } from "@/components/duel/arena/ArenaEnvironment";
import { QuickMatchResult } from "@/components/duel/QuickMatchResult";
import { ResultScreen } from "@/components/duel/ResultScreen";
import { isQuickMatchResult } from "@/lib/duel/quickResult";
import { fase45Fixtures } from "../fase45/fixtures";
import { PACKS } from "@/data/packs";
import { packArtwork } from "@/data/packArtwork";
import { CARDS } from "@/data/catalog";
import { DAILY_DUEL_AWARD_CAP, duelPoints, duelReward } from "@/domain/progression/duelRewards";
import type { DuelMatchView, MatchRewardReceipt } from "@/lib/duel/types";

const SCENES = ["win", "loss", "draw", "campaign", "win-rewards", "loss-rewards", "rewards-types", "zero", "capped"] as const;
type Scene = (typeof SCENES)[number];
const noop = () => {};

export default function QuickResultQaPage() {
  const [scene, setScene] = useState<Scene | null>(null);
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("scene");
    setScene((SCENES as readonly string[]).includes(s ?? "") ? (s as Scene) : "win");
  }, []);
  if (!scene) return null;
  const fx = fase45Fixtures();
  const base: DuelMatchView = scene === "loss" || scene === "loss-rewards" ? fx.loss : scene === "draw" ? fx.draw : fx.win;
  const receipt = fixtureReceipt(scene, base.matchId);
  const view: DuelMatchView = {
    ...base,
    context: scene === "campaign" ? "CAMPAIGN" : "QUICK",
    result: base.result && receipt !== undefined ? { ...base.result, rewards: receipt } : base.result,
  };
  const arena = scene === "campaign" ? "campaign" : "quick";
  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen" data-qa-scene={scene}>
        <ArenaEnvironment variant={arena} />
        <div className="mx-auto w-full max-w-[1320px] px-3 sm:px-6">
          {isQuickMatchResult(view, arena)
            ? <QuickMatchResult view={view} onContinue={noop} />
            : <ResultScreen view={view} xp={4_200} onPlayAgain={noop} onDecks={noop} onReplay={noop} deckId="qa" />}
        </div>
      </div>
    </MotionConfig>
  );
}

/** Recibos FIXTURE de las escenas de recompensas (`undefined` = la escena no toca el recibo). */
function fixtureReceipt(scene: Scene, matchId: string): MatchRewardReceipt | undefined {
  const match = (o: "win" | "loss") => ({ source: "MATCH" as const, reward: { credits: duelReward(o, "NORMAL").credits ?? 0, xp: duelReward(o, "NORMAL").xp ?? 0 }, points: Math.max(0, duelPoints(o, "NORMAL")) });
  switch (scene) {
    case "win-rewards": return { matchId, capped: false, grants: [match("win")], daily: { slot: 7, cap: DAILY_DUEL_AWARD_CAP } };
    case "loss-rewards": return { matchId, capped: false, grants: [match("loss")] };
    case "rewards-types": {
      const pack = PACKS.find((p) => packArtwork(p.id));
      const card = CARDS.find((c) => c.image);
      return { matchId, capped: false, grants: [match("win"), { source: "CAMPAIGN_FIRST_CLEAR", reward: { packId: pack?.id, packCount: 2, cardId: card?.id, cosmetics: ["insignia:torneo"] }, points: 0 }] };
    }
    case "zero": return { matchId, capped: true, grants: [] };
    // CORE GAME LOOP · partida 21: topada, sin concesiones, y el resultado lo dice.
    case "capped": return { matchId, capped: true, grants: [], daily: { slot: null, cap: DAILY_DUEL_AWARD_CAP } };
    default: return undefined;
  }
}
