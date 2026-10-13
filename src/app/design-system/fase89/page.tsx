"use client";

/**
 * F89 · ARNÉS QA DEL PERFIL 2.0 (`/design-system/fase89?scene=…`). 404 en producción (middleware), salvo
 * `NEXUS_QA_HARNESS=1`. Monta las vistas REALES (`ProfileOwnerView` / `PublicProfileView` + editor) con fixtures
 * construidas por el dominio sobre el catálogo real. Sin servidor ni BD.
 *
 *   scene = own | public | anon | no-badges | no-team-logo | empty-own | empty-public | long | xss | editor-team | editor-badges
 */
import { useEffect, useMemo, useState } from "react";
import { ProfileOwnerView, PublicProfileView } from "@/components/player/ProfileViews";
import { ShowcaseEditor } from "@/components/player/ShowcaseEditor";
import { favoriteTeamOptions } from "@/domain/profile/favoriteTeam";
import { CARDS, getPlayer } from "@/data/catalog";
import { OWNED } from "../fase31/fixtures";
import { OWN_FULL, PUBLIC_FULL, PUBLIC_ANON, NO_BADGES_PUBLIC, NO_TEAM_LOGO, EMPTY_OWN, EMPTY_PUBLIC, LONG_TEXT, XSS_NAME } from "./fixtures";

const SCENES = ["own", "public", "anon", "no-badges", "no-team-logo", "empty-own", "empty-public", "long", "xss", "editor-team", "editor-badges"] as const;
type Scene = (typeof SCENES)[number];
const SNAP = { own: OWN_FULL, public: PUBLIC_FULL, anon: PUBLIC_ANON, "no-badges": NO_BADGES_PUBLIC, "no-team-logo": NO_TEAM_LOGO, "empty-own": EMPTY_OWN, "empty-public": EMPTY_PUBLIC, long: LONG_TEXT, xss: XSS_NAME, "editor-team": OWN_FULL, "editor-badges": OWN_FULL } as const;
const noop = () => {};

export default function Fase89Harness() {
  const [scene, setScene] = useState<Scene | null>(null);
  const teams = useMemo(() => favoriteTeamOptions(CARDS, getPlayer), []);
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("scene") as Scene;
    setScene(SCENES.includes(s) ? s : "own");
  }, []);
  if (!scene) return null;
  const snap = SNAP[scene];
  return (
    <main data-harness="fase89" data-scene={scene} className="min-h-screen px-4 py-6 sm:px-6 lg:py-10">
      {snap.view === "SELF"
        ? <ProfileOwnerView snap={snap} onEdit={noop} onSignOut={noop} />
        : <PublicProfileView snap={snap} />}
      {(scene === "editor-team" || scene === "editor-badges") && snap.self && (
        <ShowcaseEditor open tab={scene === "editor-team" ? "team" : "badges"} onTab={noop} onClose={noop} owned={OWNED}
          initialUids={snap.self.showcaseUids} claimed={snap.self.claimedAchievements} initialFeatured={snap.self.featuredIds} avatar={snap.player.avatar}
          busy={false} error={null} onSaveShowcase={noop} onSaveFeatured={noop} onSaveAvatar={noop}
          badges={snap.self.ownedBadges} initialBadges={snap.self.featuredBadgeIds} onSaveBadges={noop}
          teamOptions={teams} initialTeam={snap.favoriteTeam?.id ?? null} onSaveTeam={noop} />
      )}
    </main>
  );
}
