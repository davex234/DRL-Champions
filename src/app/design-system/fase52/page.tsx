"use client";

/**
 * ARNÉS QA · FASE 52 — `/design-system/fase52?scene=<escena>` (solo capturas y revisión; fuera de la navegación).
 *
 * Monta el SEASON COMMAND CENTER real (`SeasonHub`) sobre las fixtures de la Fase 34 (`hubAt`): calendario
 * canónico REAL, carriles y misiones REALES (`data/season.ts`), cifras de jugador QA SYNTHETIC y sin
 * servidor. Nada se envía ni se escribe. La app real solo enseña los datos de la cuenta.
 */
import { useEffect, useMemo, useState } from "react";
import { MotionConfig } from "framer-motion";
import { Badge } from "@/components/ui/Badge";
import { NxButton } from "@/components/ui/NxButton";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { SeasonHub } from "@/components/season/SeasonHub";
import { RewardVisual, rewardLabel } from "@/components/season/SeasonRewards";
import { hubAt, NOW_ACTIVE, START, END } from "../fase34/fixtures";
import type { SeasonHubSnapshot } from "@/server/services/season";
import type { ServerClock } from "@/domain/season/time";

const D = 86_400_000;
const noop = () => {};

/** QA: el carril competitivo ABIERTO (el jugador de la fixture aún no llega a Oro). */
function competitivoAbierto(s: SeasonHubSnapshot): SeasonHubSnapshot {
  const p = s.personal; if (!p?.pass) return s;
  const comp = p.pass.tracks.competitive.map((l) => ({ ...l, claimable: !l.claimed && l.level <= p.pass!.level }));
  return { ...s, personal: { ...p, pass: { ...p.pass, competitiveUnlocked: true, points: p.pass.competitiveMinPoints, tracks: { ...p.pass.tracks, competitive: comp }, claimable: { ...p.pass.claimable, competitive: comp.filter((l) => l.claimable).length } } } };
}

const SCENES = ["full", "competitive-open", "new-player", "anonymous", "ending-soon", "ended", "upcoming", "reward-card", "no-season", "backend-error"] as const;

export default function Fase52Harness() {
  const [scene, setScene] = useState("");
  const [ok, setOk] = useState(false);
  useEffect(() => { setScene(new URLSearchParams(window.location.search).get("scene") ?? "full"); setOk(true); }, []);

  const body = useMemo(() => {
    const clock = (now: number): ServerClock => ({ serverNow: now, receivedAt: now });
    const hub = (now: number, snap: SeasonHubSnapshot) => <SeasonHub snap={snap} clock={clock(now)} onRefresh={noop} clientNow={now} />;
    switch (scene) {
      case "full": return hub(NOW_ACTIVE, hubAt(NOW_ACTIVE, { personal: { competitive: "provisional", pickems: "pending" } }));
      case "competitive-open": return hub(NOW_ACTIVE, competitivoAbierto(hubAt(NOW_ACTIVE, { personal: { competitive: "established", pickems: "scored" } })));
      case "new-player": return hub(NOW_ACTIVE, hubAt(NOW_ACTIVE, { personal: { profile: "new", competitive: "none", pickems: "none", actions: "normal" } }));
      case "anonymous": return hub(NOW_ACTIVE, hubAt(NOW_ACTIVE, { personal: null }));
      case "ending-soon": { const n = END - 5 * D - 7 * 3600_000; return hub(n, hubAt(n, { personal: { competitive: "established", pickems: "scored" } })); }
      case "ended": { const n = END + 2 * D; return hub(n, hubAt(n, { personal: { competitive: "established", pickems: "scored" } })); }
      case "upcoming": { const n = START - 3 * D; return hub(n, hubAt(n, { personal: { profile: "new", competitive: "none", pickems: "none" } })); }
      case "reward-card": {
        // QA: el pase ACTUAL no da cartas; se muestra el componente con una carta real del catálogo para comprobar CardArt.
        const rewards = [{ cardId: "mada__moments" }, { packId: "premium", packCount: 2, credits: 1500 }, { packId: "estandar", packCount: 1, credits: 600 }, { credits: 5000 }];
        return (
          <div className="flex flex-wrap gap-6" data-testid="reward-kinds">
            {rewards.map((r, i) => (
              <div key={i} className="flex w-[200px] flex-col items-center gap-2 border border-white/10 bg-white/[0.03] p-4">
                <RewardVisual reward={r} size={150} />
                <b className="text-center font-display text-[13px] uppercase text-white">{rewardLabel(r)}</b>
              </div>
            ))}
          </div>
        );
      }
      case "no-season": return <EmptyState icon="🗓️" title="Sin temporada configurada" hint="Todavía no hay ninguna temporada en el calendario de NEXUS." action={{ href: "/", label: "Volver al inicio" }} />;
      case "backend-error": return <ErrorState message="No se pudo leer la temporada" onRetry={noop} />;
      default: return <div className="flex flex-wrap gap-2">{SCENES.map((s) => <NxButton key={s} variant="secondary" size="sm" href={`/design-system/fase52?scene=${s}`}>{s}</NxButton>)}</div>;
    }
  }, [scene]);

  if (!ok) return null;
  return (
    <MotionConfig reducedMotion="user">
      <div className="mx-auto w-full max-w-[1320px] px-3 py-4 sm:px-6" data-qa-scene={scene}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Badge tone="warn" solid>QA SYNTHETIC</Badge>
          <span className="font-display text-[13px] font-bold uppercase text-white">Arnés Fase 52 · {scene}</span>
          <span className="text-caption text-ink-faint">calendario, carriles y misiones reales · cifras del jugador inventadas · sin servidor</span>
        </div>
        {body}
      </div>
    </MotionConfig>
  );
}
