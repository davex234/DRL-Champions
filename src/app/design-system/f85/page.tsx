"use client";

/**
 * ARNÉS QA · F85 SOCIAL 2.0 — `/design-system/f85?scene=<escena>` (solo capturas y revisión).
 *
 * Piezas REALES (`SocialHub`, `SocialActionsPanel`, `CompareView`, `IncomingChallengeCard`) con datos QA SYNTHETIC
 * (`./fixtures` + los de la Fase 29). Sin sesión, sin red: los manejadores son no-op. Las escenas de la partida privada
 * y la revancha desde el resultado siguen en `/design-system/fase29`.
 */
import { useEffect, useState } from "react";
import { MotionConfig } from "framer-motion";
import { Badge } from "@/components/ui/Badge";
import { NxButton } from "@/components/ui/NxButton";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { SocialHub } from "@/components/social/SocialHub";
import { SocialActionsPanel } from "@/components/social/SocialActions";
import { CompareView } from "@/components/social/CompareView";
import { IncomingChallengeCard } from "@/components/social/SocialLive";
import type { SocialHandlers, SearchState, SocialTab } from "@/components/social/types";
import { FULL, EMPTY, SEARCH_HITS, PLAYER_FRIEND, PLAYER_STRANGER, PLAYER_SENT, QA_NOW } from "../fase29/fixtures";
import { ONE, TWENTY, MANY, MANY_MORE, LONG, PLAYER_BLOCKED, PLAYER_LONG, COMPARE, COMPARE_SPARSE, INCOMING_CARD, REMATCH_CARD, LONG_CARD } from "./fixtures";

const SCENES = [
  "hub", "friends-0", "friends-1", "friends-20", "friends-200", "friends-200-more", "long-names", "requests", "search", "search-more",
  "search-empty", "recent", "challenges", "profile-friend", "profile-friend-menu", "profile-stranger", "profile-sent", "profile-blocked",
  "profile-long", "compare", "compare-sparse", "incoming", "incoming-rematch", "incoming-long", "incoming-busy",
] as const;

const noop = () => {};
const HANDLERS: SocialHandlers = {
  onFriendRequest: noop, onAcceptFriend: noop, onDeclineFriend: noop, onUnfriend: noop, onCancelRequest: noop, onBlock: noop, onUnblock: noop,
  onChallenge: noop, onAcceptChallenge: noop, onDeclineChallenge: noop, onCancelChallenge: noop, onOpenMatch: noop,
};
const IDLE: SearchState = { query: "", results: null, searching: false, error: null, onQuery: noop };
const FOUND: SearchState = { query: "ka", results: SEARCH_HITS, searching: false, error: null, onQuery: noop };
const MORE: SearchState = { ...FOUND, hasMore: true, onMore: noop };
const NONE: SearchState = { query: "zzz", results: [], searching: false, error: null, onQuery: noop };

export default function F85QaPage() {
  return <HydrationGate><Harness /></HydrationGate>;
}

function Harness() {
  const [scene, setScene] = useState("");
  useEffect(() => { setScene(new URLSearchParams(window.location.search).get("scene") ?? ""); }, []);
  // El menú contextual del perfil se captura abierto.
  useEffect(() => {
    if (scene !== "profile-friend-menu") return;
    const id = window.setTimeout(() => (document.querySelector('[data-action="more"]') as HTMLButtonElement | null)?.click(), 400);
    return () => window.clearTimeout(id);
  }, [scene]);

  const hub = (snap: typeof FULL, tab: SocialTab, search: SearchState = IDLE, extra: Partial<Parameters<typeof SocialHub>[0]> = {}) => (
    <SocialHub snap={snap} now={QA_NOW} tab={tab} onTab={noop} handlers={HANDLERS} search={search} {...extra} />
  );
  const card = (c: typeof INCOMING_CARD, busy = false) => (
    <div className="mx-auto flex max-w-md flex-col items-center"><IncomingChallengeCard challenge={c} now={QA_NOW} busy={busy} reduced={false} onAccept={noop} onDecline={noop} onClose={noop} /></div>
  );

  const body = () => {
    switch (scene) {
      case "hub": return hub(FULL, "amigos");
      case "friends-0": return hub(EMPTY, "amigos");
      case "friends-1": return hub(ONE, "amigos");
      case "friends-20": return hub(TWENTY, "amigos");
      case "friends-200": return hub(MANY, "amigos", IDLE, { onMoreFriends: noop });
      case "friends-200-more": return hub(MANY, "amigos", IDLE, { moreFriends: MANY_MORE, onMoreFriends: noop });
      case "long-names": return hub(LONG, "amigos");
      case "requests": return hub(FULL, "solicitudes");
      case "search": return hub(FULL, "buscar", FOUND);
      case "search-more": return hub(FULL, "buscar", MORE);
      case "search-empty": return hub(FULL, "buscar", NONE);
      case "recent": return hub(FULL, "actividad");
      case "challenges": return hub(FULL, "retos");
      case "profile-friend": case "profile-friend-menu": return <SocialActionsPanel view={PLAYER_FRIEND} onChanged={noop} now={QA_NOW} harness />;
      case "profile-stranger": return <SocialActionsPanel view={PLAYER_STRANGER} onChanged={noop} now={QA_NOW} harness />;
      case "profile-sent": return <SocialActionsPanel view={PLAYER_SENT} onChanged={noop} now={QA_NOW} harness />;
      case "profile-blocked": return <SocialActionsPanel view={PLAYER_BLOCKED} onChanged={noop} now={QA_NOW} harness />;
      case "profile-long": return <SocialActionsPanel view={PLAYER_LONG} onChanged={noop} now={QA_NOW} harness />;
      case "compare": return <CompareView data={COMPARE} />;
      case "compare-sparse": return <CompareView data={COMPARE_SPARSE} />;
      case "incoming": return card(INCOMING_CARD);
      case "incoming-rematch": return card(REMATCH_CARD);
      case "incoming-long": return card(LONG_CARD);
      case "incoming-busy": return card(INCOMING_CARD, true);
      default: return <div className="flex flex-wrap gap-2">{SCENES.map((s) => <NxButton key={s} variant="secondary" size="sm" href={`/design-system/f85?scene=${s}`}>{s}</NxButton>)}</div>;
    }
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="mx-auto w-full max-w-5xl px-4 py-5" data-qa-scene={scene || "index"}>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Badge tone="warn" solid>QA SYNTHETIC</Badge>
          <span className="font-display text-[13px] font-bold uppercase text-white">Arnés F85 · {scene || "índice"}</span>
          <span className="text-caption text-ink-faint">jugadores, amistades, retos y presencias inventados · sin servidor</span>
        </div>
        {body()}
      </div>
    </MotionConfig>
  );
}
