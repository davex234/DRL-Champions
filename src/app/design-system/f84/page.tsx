"use client";

/**
 * ARNÉS QA · F84 — `/design-system/f84?scene=<escena>[&reduced=1][&animate=1]` (solo capturas y revisión).
 *
 * Renderiza las piezas REALES del Ranked 2.0 (`RankedCenter` con su héroe, clasificación, «tu zona» y leyenda;
 * `PvpOutcome` + `RankChange`; emblemas; perfil) con datos **QA SYNTHETIC** (`./fixtures`). Sin sesión, sin red, sin
 * tocar la cuenta real ni producción. `animate=1` reproduce la ceremonia (si no, se pinta el estado final);
 * `reduced=1` fuerza movimiento reducido (misma información, sin animación).
 */
import { useEffect, useMemo, useState } from "react";
import { MotionConfig } from "framer-motion";
import { rankedGate } from "@/domain/pvpLadder/ranked";
import { rankLadder, rankChip, deriveRank } from "@/domain/ranked/config";
import type { RankMovement } from "@/domain/ranked/standing";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { NxButton } from "@/components/ui/NxButton";
import { RankedCenter } from "@/components/competitive/ranked/RankedCenter";
import { RankedLadder } from "@/components/competitive/ranked/RankedLadder";
import { RankLegend } from "@/components/competitive/ranked/RankLegend";
import { CompetitiveEmblem, RankInline } from "@/components/competitive/ranked/CompetitiveEmblem";
import { PvpOutcome } from "@/components/duel/pvp/PvpOutcome";
import { PlayerIdentityView } from "@/components/player/PlayerIdentityView";
import { DECK_OK, DECK_OK_2 } from "../fase55/fixtures";
import { OWN, PLACEMENT_PLAYER, RANKED_PLAYER } from "../fase56/fixtures";
import {
  HUB_UNRANKED, HUB_PLACEMENT_4, HUB_LOW, HUB_MID, HUB_HIGH, HUB_CUMBRE, HUB_STALE, HUB_EMPTY_LADDER, HUB_LONG_NAME, HUB_AROUND,
  RESULT_PLACEMENT_1, RESULT_PLACEMENT_4, RESULT_REVEAL, RESULT_PROMOTION_DIV, RESULT_PROMOTION_TIER, RESULT_PROMOTION_CUMBRE, RESULT_DEMOTION, RESULT_SAME, RESULT_SAME_LOSS, RESULT_PAIR_CAP, EVENT,
} from "./fixtures";

const SCENES = [
  "hub-unranked", "hub-placement-4", "hub-low", "hub-mid", "hub-high", "hub-cumbre", "hub-stale", "hub-empty", "hub-long-name", "hub-around",
  "result-placement-1", "result-placement-4", "result-reveal", "result-promotion", "result-promotion-tier", "result-promotion-cumbre", "result-demotion", "result-same", "result-same-loss", "result-pair-cap",
  "ladder-top", "ladder-around", "emblems", "legend", "profile-own", "profile-ranked", "profile-placement",
] as const;

export default function F84QaPage() {
  return <HydrationGate><Harness /></HydrationGate>;
}

function Harness() {
  const [q, setQ] = useState<{ scene: string; reduced: boolean; animate: boolean }>({ scene: "", reduced: false, animate: false });
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const animate = p.get("animate") === "1";
    // Sin `animate=1`, la ceremonia del asiento QA se da por vista (estado final estable para las capturas).
    try { window.localStorage.setItem("drl:rank-ceremony:qa-f84", "1"); } catch { /* sin almacenamiento */ }
    setQ({ scene: p.get("scene") ?? "", reduced: p.get("reduced") === "1", animate });
  }, []);
  const ready = useMemo(() => rankedGate({ signedIn: true, decks: [DECK_OK, DECK_OK_2], activeDeckId: DECK_OK.id }), []);
  const center = (snap: typeof HUB_MID) => <RankedCenter snap={snap} gate={ready} legalDecks={[DECK_OK, DECK_OK_2]} onChooseDeck={() => {}} loadLadderPage={async () => null} />;
  // Con `animate=1` el id es nuevo en cada carga (la ceremonia se consume una vez por partida y navegador).
  const matchId = q.animate ? `qa-f84-${q.scene}-${Date.now()}` : null;
  const result = (m: RankMovement, positions: number | null = null, position: number | null = null) => (
    <PvpOutcome verdict={m.delta >= 0 ? "WIN" : "LOSS"} lifecycle="FINISHED" view={null} rating={m.newRating} outcome={{ ...EVENT(m), matchId: matchId ?? "qa-f84" }} rank={m}
      ladder={positions !== null ? { before: { position: position !== null ? position + positions : null }, after: { position, rankedTotal: 500 }, positions } : null}
      onAgain={() => {}} onBack={() => {}} backLabel="Volver a Competitivo" rivalName="QA · Kaelis" />
  );
  const resultStatic = result;
  const body = (() => {
    switch (q.scene) {
      case "hub-unranked": return center(HUB_UNRANKED);
      case "hub-placement-4": return center(HUB_PLACEMENT_4);
      case "hub-low": return center(HUB_LOW);
      case "hub-mid": return center(HUB_MID);
      case "hub-high": return center(HUB_HIGH);
      case "hub-cumbre": return center(HUB_CUMBRE);
      case "hub-stale": return center(HUB_STALE);
      case "hub-empty": return center(HUB_EMPTY_LADDER);
      case "hub-long-name": return center(HUB_LONG_NAME);
      case "hub-around": return center(HUB_AROUND);
      case "result-placement-1": return resultStatic(RESULT_PLACEMENT_1);
      case "result-placement-4": return resultStatic(RESULT_PLACEMENT_4);
      case "result-reveal": return resultStatic(RESULT_REVEAL);
      case "result-promotion": return resultStatic(RESULT_PROMOTION_DIV, 4, 208);
      case "result-promotion-tier": return resultStatic(RESULT_PROMOTION_TIER, 6, 31);
      case "result-promotion-cumbre": return resultStatic(RESULT_PROMOTION_CUMBRE, 2, 9);
      case "result-demotion": return resultStatic(RESULT_DEMOTION, -5, 389);
      case "result-same": return resultStatic(RESULT_SAME, 1, 211);
      case "result-same-loss": return resultStatic(RESULT_SAME_LOSS, -2, 213);
      case "result-pair-cap": return resultStatic(RESULT_PAIR_CAP, 0, 140);
      case "ladder-top": return <RankedLadder top={HUB_CUMBRE.leaderboardTop} rankedTotal={500} selfPosition={3} topSize={500} rules={{ minSeasonMatches: 5, activeDays: 14, placementGames: 5 }} />;
      case "ladder-around": return <RankedLadder top={HUB_AROUND.leaderboardTop} aroundMe={HUB_AROUND.aroundMe} rankedTotal={500} selfPosition={124} topSize={500} loadPage={async () => null} rules={{ minSeasonMatches: 5, activeDays: 14, placementGames: 5 }} />;
      case "emblems": return <Emblems />;
      case "legend": return <RankLegend version="rank-v1" current={deriveRank(1001).step} open />;
      case "profile-own": return <PlayerIdentityView snap={OWN} />;
      case "profile-ranked": return <PlayerIdentityView snap={RANKED_PLAYER} />;
      case "profile-placement": return <PlayerIdentityView snap={PLACEMENT_PLAYER} />;
      default: return <div className="flex flex-wrap gap-2">{SCENES.map((s) => <NxButton key={s} variant="secondary" size="sm" href={`/design-system/f84?scene=${s}`}>{s}</NxButton>)}</div>;
    }
  })();

  return (
    <MotionConfig reducedMotion={q.reduced ? "always" : "user"}>
      <div className="mx-auto w-full max-w-6xl px-4 py-5" data-qa-scene={q.scene || "index"} data-qa-reduced={q.reduced ? "1" : "0"}>
        <p className="mb-4 flex flex-wrap items-center gap-2">
          <span className="font-display text-[13px] font-bold uppercase text-white">Arnés F84 · {q.scene || "índice"}</span>
          <span className="text-[11px] text-white/45">QA SYNTHETIC · sin sesión ni red</span>
        </p>
        {body}
      </div>
    </MotionConfig>
  );
}

/** Todos los escalones de rank-v1 + colocación + sin clasificar: la identidad visual completa. */
function Emblems() {
  const steps = rankLadder("rank-v1");
  return (
    <div className="space-y-6" data-testid="emblem-gallery">
      <div className="grid grid-cols-3 gap-4 sm:grid-cols-6 lg:grid-cols-7">
        {steps.map((s) => {
          const chip = rankChip(deriveRank(s.floor === 0 ? 0 : s.floor));
          return (
            <div key={s.label} className="flex flex-col items-center gap-1 text-center">
              <CompetitiveEmblem rank={chip} state="RANKED" size="md" animate={false} />
              <span className="font-display text-[12px] font-bold uppercase" style={{ color: chip.color }}>{s.label}</span>
              <span className="nx-readout text-[11px] text-white/45">{s.floor}{s.ceil !== null ? `–${s.ceil - 1}` : "+"}</span>
            </div>
          );
        })}
        <div className="flex flex-col items-center gap-1 text-center"><CompetitiveEmblem rank={null} state="PLACEMENT" placement={{ played: 3, total: 5 }} size="md" animate={false} /><span className="text-[12px] text-white/70">Colocación 3/5</span></div>
        <div className="flex flex-col items-center gap-1 text-center"><CompetitiveEmblem rank={null} state="UNRANKED" size="md" animate={false} /><span className="text-[12px] text-white/70">Sin clasificar</span></div>
      </div>
      <div className="flex flex-wrap gap-4">
        {steps.filter((_, i) => i % 3 === 2 || i === steps.length - 1).map((s) => <RankInline key={s.label} rank={rankChip(deriveRank(s.floor))} />)}
      </div>
    </div>
  );
}
