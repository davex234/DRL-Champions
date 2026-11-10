"use client";

/**
 * ARNÉS QA · FASE 31 — `/design-system/fase31?scene=<escena>` (solo capturas y revisión).
 *
 * Renderiza las piezas REALES del perfil (`PlayerIdentityView`, `ShowcaseEditor`, `ProfilePreviewCard`)
 * y las integraciones (acciones sociales de la Fase 29, escalera de la Fase 28, búsqueda) con fotos
 * **QA SYNTHETIC** construidas por la misma función del servidor (`./fixtures`). Sin sesión, sin red.
 */
import { useEffect, useState } from "react";
import { MotionConfig } from "framer-motion";
import { Badge } from "@/components/ui/Badge";
import { NxButton } from "@/components/ui/NxButton";
import { ErrorState, EmptyState, NeedsAccount } from "@/components/ui/States";
import { Toast } from "@/components/ui/Toast";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { PlayerIdentityView } from "@/components/player/PlayerIdentityView";
import { ShowcaseEditor, type EditorTab } from "@/components/player/ShowcaseEditor";
import { ProfilePreviewCardView } from "@/components/player/ProfilePreviewCard";
import { SocialActionsPanel } from "@/components/social/SocialActions";
import { PlayerSearch } from "@/components/social/PlayerSearch";
import { Leaderboard } from "@/components/competitive/Leaderboard";
import type { SocialHandlers } from "@/components/social/types";
import { PLAYER_FRIEND, PLAYER_STRANGER, PLAYER_SENT, SEARCH_HITS } from "../fase29/fixtures";
import { RANKED as LADDER } from "../fase28/fixtures";
import {
  OWN_FULL, PUBLIC_FULL, PUBLIC_ANON, NEW_PLAYER, NO_CARDS_PUBLIC, EMPTY_SHOWCASE_SELF, EMPTY_SHOWCASE_PUBLIC, SHOWCASE_ONE, LOW_SERIAL,
  UNAVAILABLE, NO_ACHIEVEMENTS, ACHIEVEMENTS_NOT_FEATURED, UNRANKED, NO_PICKEMS, OWNED, CLAIMED, LEAD_CARD_ID, QA_NOW,
} from "./fixtures";

const SCENES = [
  "own-full", "public-full", "new-player", "no-cards", "empty-showcase", "empty-showcase-public", "showcase-one", "showcase-full", "low-serial",
  "duplicates", "editor", "instance-picker", "save-showcase", "achievements", "achievement-editor", "no-achievements", "ranked", "unranked",
  "recent-form", "match-history", "h2h", "friend", "unknown", "pending", "blocked", "social-unavailable", "pickems", "no-pickems",
  "collection-summary", "account-preview", "leaderboard", "search", "share", "backend-error", "not-found", "unavailable-slot", "avatar-editor", "no-session",
] as const;

const noop = () => {};
const HANDLERS: SocialHandlers = {
  onFriendRequest: noop, onAcceptFriend: noop, onDeclineFriend: noop, onUnfriend: noop, onCancelRequest: noop, onBlock: noop, onUnblock: noop,
  onChallenge: noop, onAcceptChallenge: noop, onDeclineChallenge: noop, onCancelChallenge: noop, onOpenMatch: noop,
};

export default function Fase31QaPage() {
  return <HydrationGate><Harness /></HydrationGate>;
}

function Harness() {
  const [scene, setScene] = useState("");
  useEffect(() => { setScene(new URLSearchParams(window.location.search).get("scene") ?? ""); }, []);
  // Escenas de sección: en móvil se desplaza a la sección (el hero queda arriba, fuera del viewport).
  useEffect(() => {
    const anchor: Record<string, string> = {
      achievements: "[data-testid=featured-achievements]", "no-achievements": "[data-testid=featured-achievements]", ranked: "[data-testid=ranked-panel]", "recent-form": "[data-testid=ranked-panel]",
      "match-history": "[data-testid=ranked-panel]", h2h: "[data-testid=h2h-panel]", pickems: "[data-testid=pickems-identity]", "no-pickems": "[data-testid=pickems-identity]",
      "collection-summary": "[data-testid=collection-summary]", "showcase-full": "[data-testid=showcase]", "low-serial": "[data-testid=showcase]", unranked: "[data-testid=ranked-panel]",
    };
    const sel = anchor[scene];
    if (!sel) return;
    const id = window.setTimeout(() => document.querySelector(sel)?.scrollIntoView({ block: "start" }), 700);
    return () => window.clearTimeout(id);
  }, [scene]);

  const view = (snap: typeof OWN_FULL, social?: React.ReactNode) => <PlayerIdentityView snap={snap} onEdit={noop} social={social} />;
  const editor = (tab: EditorTab, opts: { picker?: string | null; busy?: boolean; initial?: string[] } = {}) => (
    <>
      {view(OWN_FULL)}
      <ShowcaseEditor open tab={tab} onTab={noop} onClose={noop} owned={OWNED} initialUids={opts.initial ?? OWN_FULL.self!.showcaseUids} claimed={CLAIMED}
        initialFeatured={OWN_FULL.self!.featuredIds} avatar={OWN_FULL.player.avatar} busy={!!opts.busy} error={null}
        onSaveShowcase={noop} onSaveFeatured={noop} onSaveAvatar={noop} initialPicker={opts.picker ?? null} />
    </>
  );

  const body = () => {
    switch (scene) {
      case "own-full": return view(OWN_FULL);
      case "public-full": return view(PUBLIC_FULL, <SocialActionsPanel view={PLAYER_FRIEND} onChanged={noop} now={QA_NOW} harness showH2H={false} />);
      case "new-player": return view(NEW_PLAYER);
      case "no-cards": return view(NO_CARDS_PUBLIC, <SocialActionsPanel view={PLAYER_STRANGER} onChanged={noop} now={QA_NOW} harness showH2H={false} />);
      case "empty-showcase": return view(EMPTY_SHOWCASE_SELF);
      case "empty-showcase-public": return view(EMPTY_SHOWCASE_PUBLIC);
      case "showcase-one": return view(SHOWCASE_ONE);
      case "showcase-full": return view(OWN_FULL);
      case "low-serial": return view(LOW_SERIAL);
      case "duplicates": return editor("cards", { initial: [] });
      case "editor": return editor("cards");
      case "instance-picker": return editor("cards", { picker: LEAD_CARD_ID });
      case "save-showcase": return editor("cards", { busy: true });
      case "achievements": return view(OWN_FULL);
      case "achievement-editor": return editor("achievements");
      case "avatar-editor": return editor("avatar");
      case "no-achievements": return view(NO_ACHIEVEMENTS);
      case "ranked": return view(PUBLIC_FULL);
      case "unranked": return view(UNRANKED);
      case "recent-form": return view(OWN_FULL);
      case "match-history": return view(OWN_FULL);
      case "h2h": return view(PUBLIC_FULL);
      case "friend": return view(PUBLIC_FULL, <SocialActionsPanel view={PLAYER_FRIEND} onChanged={noop} now={QA_NOW} harness showH2H={false} />);
      case "unknown": return view(PUBLIC_FULL, <SocialActionsPanel view={PLAYER_STRANGER} onChanged={noop} now={QA_NOW} harness showH2H={false} />);
      case "pending": return view(PUBLIC_FULL, <SocialActionsPanel view={PLAYER_SENT} onChanged={noop} now={QA_NOW} harness showH2H={false} />);
      case "blocked": return (
        <div className="space-y-6">
          <p className="text-caption text-ink-muted">Si ese jugador te ha bloqueado, su perfil responde lo mismo que un perfil inexistente:</p>
          <EmptyState icon="👤" title="Jugador no encontrado" hint="Puede que el enlace sea incorrecto o que el perfil ya no esté disponible." action={{ href: "/social?tab=buscar", label: "Buscar jugadores" }} />
          <p className="text-caption text-ink-muted">Si lo has bloqueado tú, lo ves y puedes desbloquearlo:</p>
          {view(ACHIEVEMENTS_NOT_FEATURED.view === "SELF" ? PUBLIC_FULL : PUBLIC_FULL, <SocialActionsPanel view={{ ...PLAYER_STRANGER, relation: "BLOCKED_BY_ME", actions: { add: false, accept: false, decline: false, cancel: false, unfriend: false, challenge: false, block: false, unblock: true } }} onChanged={noop} now={QA_NOW} harness showH2H={false} />)}
        </div>
      );
      case "social-unavailable": return view(PUBLIC_ANON);
      case "pickems": return view(OWN_FULL);
      case "no-pickems": return view(NO_PICKEMS);
      case "collection-summary": return view(OWN_FULL);
      case "account-preview": return <div className="max-w-3xl space-y-3"><ProfilePreviewCardView snap={OWN_FULL} /><ProfilePreviewCardView snap={NEW_PLAYER} /></div>;
      case "leaderboard": return <div className="max-w-4xl"><Leaderboard title="Alrededor de ti · cada fila abre el perfil de jugador" entries={LADDER.aroundMe} /></div>;
      case "search": return <div className="max-w-3xl"><PlayerSearch state={{ query: "ka", results: SEARCH_HITS, searching: false, error: null, onQuery: noop }} handlers={HANDLERS} /></div>;
      case "share": return <>{view(OWN_FULL)}<Toast toast={{ id: 1, msg: "Enlace del perfil copiado", ok: true }} /></>;
      case "backend-error": return <ErrorState message="No se pudo leer el perfil" onRetry={noop} />;
      case "not-found": return <EmptyState icon="👤" title="Jugador no encontrado" hint="Puede que el enlace sea incorrecto o que el perfil ya no esté disponible." action={{ href: "/social?tab=buscar", label: "Buscar jugadores" }} />;
      case "unavailable-slot": return view(UNAVAILABLE);
      case "no-session": return <NeedsAccount what="Tu perfil de jugador" />;
      default: return <div className="flex flex-wrap gap-2">{SCENES.map((s) => <NxButton key={s} variant="secondary" size="sm" href={`/design-system/fase31?scene=${s}`}>{s}</NxButton>)}</div>;
    }
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="mx-auto w-full max-w-6xl px-4 py-5" data-qa-scene={scene || "index"}>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Badge tone="warn" solid>QA SYNTHETIC</Badge>
          <span className="font-display text-[13px] font-bold uppercase text-white">Arnés Fase 31 · {scene || "índice"}</span>
          <span className="text-caption text-ink-faint">jugadores, ratings, logros y ejemplares inventados · cartas del catálogo real · sin servidor</span>
        </div>
        {body()}
      </div>
    </MotionConfig>
  );
}
