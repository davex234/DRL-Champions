"use client";

/**
 * F82 · ARNÉS QA DE LA SALA DE TROFEOS (`/design-system/fase82?scene=…`). 404 en producción (middleware), salvo
 * `NEXUS_QA_HARNESS=1`. Monta las pantallas REALES (`SetDetailScreen`, `CompletionMoment`,
 * `PlayerIdentityView` + editor) con fixtures construidas por el dominio sobre el catálogo real. Sin servidor ni BD.
 *
 *   La sala (colecciones por equipo e insignias regionales) tiene su arnés en `/design-system/colecciones-equipos`.
 *
 *   scene = detail-progress | detail-claimable | detail-completed | detail-edition | moment
 *         | profile-own | profile-public | profile-empty | editor-badges
 */
import { useEffect, useState } from "react";
import { SetDetailScreen } from "@/components/trophies/SetDetailScreen";
import { CompletionMoment } from "@/components/trophies/CompletionMoment";
import { PlayerIdentityView } from "@/components/player/PlayerIdentityView";
import { ShowcaseEditor } from "@/components/player/ShowcaseEditor";
import { profile, view } from "./fixtures";

const SCENES = ["detail-progress", "detail-claimable", "detail-completed", "detail-edition", "moment", "profile-own", "profile-public", "profile-empty", "editor-badges"] as const;
type Scene = (typeof SCENES)[number];

export default function Fase82Harness() {
  const [scene, setScene] = useState<Scene | null>(null);
  const [moment, setMoment] = useState(true);
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("scene") as Scene;
    setScene(SCENES.includes(s) ? s : "detail-progress");
  }, []);
  if (!scene) return null;
  return (
    <main data-harness="fase82" data-scene={scene} className="min-h-screen">
      {scene === "detail-progress" && <SetDetailScreen set={view("g2")} />}
      {scene === "detail-claimable" && <SetDetailScreen set={view("team-heretics")} onClaim={() => setMoment(true)} />}
      {scene === "detail-completed" && <SetDetailScreen set={view("karmine-corp")} />}
      {scene === "detail-edition" && <SetDetailScreen set={view("champions-s")} />}
      {scene === "moment" && (
        <>
          <SetDetailScreen set={view("team-heretics")} />
          <CompletionMoment data={moment ? { title: view("team-heretics").title, kind: "TEAM", badge: view("team-heretics").badge, already: false } : null} onClose={() => setMoment(false)} onEquip={() => setMoment(false)} />
        </>
      )}
      {scene === "profile-own" && <div className="px-4 py-6"><PlayerIdentityView snap={profile("own")} /></div>}
      {scene === "profile-public" && <div className="px-4 py-6"><PlayerIdentityView snap={profile("public")} /></div>}
      {scene === "profile-empty" && <div className="px-4 py-6"><PlayerIdentityView snap={profile("own-empty")} /></div>}
      {scene === "editor-badges" && (() => {
        const s = profile("own");
        return <ShowcaseEditor open tab="badges" onTab={() => {}} onClose={() => {}} owned={[]} initialUids={[]} claimed={[]} initialFeatured={[]} avatar={s.player.avatar} busy={false} error={null}
          onSaveShowcase={() => {}} onSaveFeatured={() => {}} onSaveAvatar={() => {}} badges={s.self!.ownedBadges} initialBadges={s.self!.featuredBadgeIds} onSaveBadges={() => {}} />;
      })()}
    </main>
  );
}
