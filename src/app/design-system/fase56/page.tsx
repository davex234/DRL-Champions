"use client";

/**
 * ARNÉS QA · FASE 56 — `/design-system/fase56?scene=<escena>` (solo capturas y revisión).
 *
 * Renderiza el perfil REAL (`PlayerIdentityView`) y las superficies que enlazan a él (clasificación e historial de
 * `/competitivo`) con datos **QA SYNTHETIC** (`./fixtures`, cartas reales del catálogo). Sin sesión, sin red, sin
 * tocar cuentas reales.
 */
import { useEffect, useState } from "react";
import { MotionConfig } from "framer-motion";
import { Badge } from "@/components/ui/Badge";
import { NxButton } from "@/components/ui/NxButton";
import { EmptyState } from "@/components/ui/States";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { PlayerIdentityView } from "@/components/player/PlayerIdentityView";
import { RankedLadder } from "@/components/competitive/ranked/RankedLadder";
import { RecentMatchCards } from "@/components/competitive/ranked/RecentMatchCards";
import { HUB, HISTORY, ladderPage } from "../fase55/fixtures";
import { OWN, OTHER, RANKED_PLAYER, PLACEMENT_PLAYER, NO_RANKED, RECENT_ACHIEVEMENTS, LONG_NAME, EMPTY, ANON, EMAIL_NAME } from "./fixtures";

const SCENES = [
  "own", "other", "ranked", "placement", "no-ranked", "featured-cards", "achievements", "history", "leaderboard", "nonexistent", "long-name", "empty", "anon", "email-name",
] as const;

export default function Fase56QaPage() {
  return <HydrationGate><Harness /></HydrationGate>;
}

function Harness() {
  const [scene, setScene] = useState("");
  useEffect(() => { setScene(new URLSearchParams(window.location.search).get("scene") ?? ""); }, []);
  const noop = () => {};
  const view = (s: typeof OWN) => <PlayerIdentityView snap={s} onEdit={noop} />;

  const body = () => {
    switch (scene) {
      case "own": case "featured-cards": return view(OWN);
      case "other": return view(OTHER);
      case "ranked": return view(RANKED_PLAYER);
      case "placement": return view(PLACEMENT_PLAYER);
      case "no-ranked": return view(NO_RANKED);
      case "achievements": return view(RECENT_ACHIEVEMENTS);
      case "history": return <div className="max-w-2xl"><p className="nx-label mb-2">/competitivo · últimas partidas → perfil del rival</p><RecentMatchCards matches={HISTORY.slice(0, 5)} /></div>;
      case "leaderboard": return <div className="max-w-3xl"><p className="nx-label mb-2">/competitivo · clasificación → /jugador/[id]</p><RankedLadder top={HUB.leaderboardTop} rankedTotal={500} selfPosition={124} loadPage={async (o) => ladderPage(o)} /></div>;
      case "nonexistent": return <EmptyState icon="👤" title="Jugador no encontrado" hint="Puede que el enlace sea incorrecto o que el perfil ya no esté disponible." action={{ href: "/social?tab=buscar", label: "Buscar jugadores" }} />;
      case "long-name": return view(LONG_NAME);
      case "empty": return view(EMPTY);
      case "anon": return view(ANON);
      case "email-name": return view(EMAIL_NAME);
      default: return <div className="flex flex-wrap gap-2">{SCENES.map((s) => <NxButton key={s} variant="secondary" size="sm" href={`/design-system/fase56?scene=${s}`}>{s}</NxButton>)}</div>;
    }
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="mx-auto w-full max-w-6xl px-4 py-5" data-qa-scene={scene || "index"}>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Badge tone="warn" solid>QA SYNTHETIC</Badge>
          <span className="font-display text-[13px] font-bold uppercase text-white">Arnés Fase 56 · {scene || "índice"}</span>
          <span className="text-caption text-ink-faint">jugadores y datos inventados · cartas reales del catálogo · sin servidor</span>
        </div>
        {body()}
      </div>
    </MotionConfig>
  );
}
