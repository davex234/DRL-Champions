"use client";

/**
 * ARNÉS QA · PERFIL = IDENTIDAD — `/design-system/profile-identity?scene=<escena>` (404 en producción salvo NEXUS_QA_HARNESS=1).
 *
 * Las vistas REALES (`ProfileOwnerView` / `PublicProfileView` → `ProfileIdentityCard`) con fixtures QA SYNTHETIC de F56/F89 y
 * el panel social REAL de F85 (`SocialActionsPanel` en modo arnés). Sin servidor: los botones no hacen nada.
 *   own (clasificado, con equipo) · own-empty (sin rango ni equipo) · own-placement · public-friend · public-stranger ·
 *   public-empty · long (nombre largo)
 */
import { useEffect, useState } from "react";
import { ProfileOwnerView, PublicProfileView } from "@/components/player/ProfileViews";
import { SocialActionsPanel } from "@/components/social/SocialActions";
import { OWN_FULL, PUBLIC_FULL, EMPTY_OWN, EMPTY_PUBLIC, LONG_TEXT } from "../fase89/fixtures";
import { PLACEMENT_PLAYER, RANKED_PLAYER } from "../fase56/fixtures";
import { PLAYER_FRIEND, PLAYER_STRANGER, QA_NOW } from "../fase29/fixtures";

const SCENES = ["own", "own-empty", "own-placement", "public-friend", "public-stranger", "public-empty", "long"] as const;
type Scene = (typeof SCENES)[number];
const noop = () => {};

export default function ProfileIdentityQaPage() {
  const [scene, setScene] = useState<Scene | null>(null);
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("scene");
    setScene((SCENES as readonly string[]).includes(s ?? "") ? (s as Scene) : "own");
  }, []);
  if (!scene) return null;
  // 0068 · cada escena con su TAG público (QA SYNTHETIC, formato canónico).
  const tagged = (snap: typeof OWN_FULL, tag: string): typeof OWN_FULL => ({ ...snap, player: { ...snap.player, tag } });
  const own = (snap: typeof OWN_FULL, tag = "7K4M92X") => <ProfileOwnerView snap={{ ...tagged(snap, tag), view: "SELF" }} onEdit={noop} onSignOut={noop} />;
  const pub = (snap: typeof OWN_FULL, social: React.ReactNode, tag = "K7M2QXA") => <PublicProfileView snap={{ ...tagged(snap, tag), view: "PUBLIC" }} social={social} />;
  const friend = <SocialActionsPanel view={PLAYER_FRIEND} onChanged={noop} now={QA_NOW} harness showH2H={false} />;
  const stranger = <SocialActionsPanel view={PLAYER_STRANGER} onChanged={noop} now={QA_NOW} harness showH2H={false} />;
  return (
    <div className="px-4 py-8" data-qa-scene={scene}>
      {scene === "own" && own({ ...OWN_FULL, competitive: RANKED_PLAYER.competitive, ranked: RANKED_PLAYER.ranked })}
      {scene === "own-empty" && own(EMPTY_OWN)}
      {scene === "own-placement" && own({ ...OWN_FULL, competitive: PLACEMENT_PLAYER.competitive, ranked: PLACEMENT_PLAYER.ranked })}
      {scene === "public-friend" && pub({ ...PUBLIC_FULL, competitive: RANKED_PLAYER.competitive, ranked: RANKED_PLAYER.ranked }, friend)}
      {scene === "public-stranger" && pub(PUBLIC_FULL, stranger)}
      {scene === "public-empty" && pub(EMPTY_PUBLIC, stranger)}
      {scene === "long" && own(LONG_TEXT)}
    </div>
  );
}
