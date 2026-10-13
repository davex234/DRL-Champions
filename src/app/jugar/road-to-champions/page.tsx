"use client";

/**
 * `/jugar/road-to-champions` — EL MAPA (Fase 35).
 *
 * Lee la foto del servidor (y sincroniza con sesión: una partida terminada en otra pestaña se liquida al
 * entrar). `?node=<id>` abre el detalle del nodo, así que un nodo se puede enlazar y el botón «atrás» cierra el
 * panel. Jugar lleva a la arena (`/duelos/jugar?campaign=<id>`), donde el servidor valida y lanza la partida.
 */
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { Loading, ErrorState } from "@/components/ui/States";
import { CampaignHero, CampaignNotice } from "@/components/campaign/CampaignHero";
import { CampaignMap } from "@/components/campaign/CampaignMap";
import { NodeSheet } from "@/components/campaign/NodeSheet";
import { abandonCampaignNode, useCampaign } from "@/lib/campaign/client";
import { fetchDuelDecks } from "@/lib/duel/client";
import { pickStartableDeck } from "@/lib/duel/gameplayUx";
import type { DuelDeckDTO } from "@/lib/duel/types";
import { findNodeView } from "@/domain/campaign/snapshot";
import { CAMPAIGN_ROUTE, NODE_ID_PATTERN, allNodeViews, campaignNodeHref, campaignPlayHref, type DeckLite } from "@/lib/campaign/presentation";
import { trackCampaign } from "@/lib/campaign/telemetry";

export default function RoadToChampionsPage() {
  return (
    <Suspense fallback={<Loading label="Cargando Road to Champions…" />}>
      <RoadToChampions />
    </Suspense>
  );
}

function RoadToChampions() {
  const router = useRouter();
  const params = useSearchParams();
  const configured = isSupabaseConfigured();
  const { user, loading } = useAuth();
  const signedIn = configured && !!user;
  const { load, reload, setSnapshot } = useCampaign({ sync: signedIn });

  const [decks, setDecks] = useState<DuelDeckDTO[] | null>(null);
  const [activeDeckId, setActiveDeckId] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { trackCampaign("campaign_open"); }, []);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine !== false);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => { window.removeEventListener("online", sync); window.removeEventListener("offline", sync); };
  }, []);

  useEffect(() => {
    if (!signedIn) { setDecks(null); return; }
    let alive = true;
    fetchDuelDecks()
      .then((d) => { if (alive) { setDecks(d.decks); setActiveDeckId(d.activeDeckId); } })
      .catch(() => { if (alive) setDecks([]); });
    return () => { alive = false; };
  }, [signedIn]);

  const raw = params.get("node");
  const selectedId = raw && NODE_ID_PATTERN.test(raw) ? raw : null;

  const select = useCallback((id: string) => {
    trackCampaign("campaign_node_open");
    setError(null);
    router.replace(campaignNodeHref(id), { scroll: false });
  }, [router]);
  const close = useCallback(() => router.replace(CAMPAIGN_ROUTE, { scroll: false }), [router]);

  const snapshot = load.state === "loading" ? null : load.snapshot;

  const deck: DeckLite | null = useMemo(() => {
    if (!decks || decks.length === 0) return null;
    const d = pickStartableDeck(decks, activeDeckId) ?? decks.find((x) => x.id === activeDeckId) ?? decks[0];
    return d ? { id: d.id, name: d.name, valid: d.valid, sumOvr: d.sumOvr } : null;
  }, [decks, activeDeckId]);

  async function abandon() {
    setBusy(true);
    setError(null);
    try { setSnapshot(await abandonCampaignNode()); } catch (e) { setError(e instanceof Error ? e.message : "No se pudo abandonar el nodo"); } finally { setBusy(false); }
  }

  if (load.state === "loading" || loading) return <Loading label="Cargando Road to Champions…" />;
  if (!snapshot) {
    return load.state === "offline"
      ? <CampaignNotice kind="offline" onRetry={() => void reload()} />
      : <ErrorState message={load.state === "error" ? load.message : "No se pudo leer Road to Champions"} onRetry={() => void reload()} />;
  }

  const node = selectedId ? findNodeView(snapshot, selectedId) : null;
  const open = snapshot.activeAttempt;
  const openNode = open ? allNodeViews(snapshot).find((n) => n.id === open.nodeId) ?? null : null;

  return (
    <div className="space-y-4" data-testid="road-to-champions">
      <CampaignHero snapshot={snapshot} onContinue={select} signedIn={signedIn} />

      <div className="space-y-2">
        {load.state === "offline" && <CampaignNotice kind="offline" onRetry={() => void reload()} />}
        {load.state === "error" && <CampaignNotice kind="error" message={load.message} onRetry={() => void reload()} />}
        {!snapshot.available && <CampaignNotice kind="unavailable" />}
        {snapshot.available && !signedIn && <CampaignNotice kind="signin" action={{ label: "Iniciar sesión", href: "/cuenta" }} />}
        {snapshot.available && signedIn && openNode && (
          <CampaignNotice kind="active" message={`«${openNode.name}» está en marcha. Termínalo o abandónalo antes de empezar otro nodo.`} action={{ label: "Retomar", href: campaignPlayHref(openNode.id) }} />
        )}
        {snapshot.available && signedIn && snapshot.summary.complete && <CampaignNotice kind="complete" />}
        {signedIn && decks !== null && !decks.some((d) => d.valid) && snapshot.available && (
          <CampaignNotice kind="active" message="Necesitas un equipo válido (diez cartas, dos por rol) para jugar cualquier nodo." action={{ label: decks.length === 0 ? "Crear equipo" : "Editar equipo", href: decks.length === 0 ? "/duelos/mazos?nuevo=1" : `/duelos/mazos?deck=${decks[0].id}` }} />
        )}
      </div>

      <CampaignMap snapshot={snapshot} selectedId={selectedId} onSelect={select} />

      {node && (
        <NodeSheet
          snapshot={snapshot}
          node={node}
          deck={deck}
          decksKnown={decks !== null}
          signedIn={signedIn}
          online={online}
          onClose={close}
          onAbandon={() => void abandon()}
          busy={busy}
          error={error}
        />
      )}
    </div>
  );
}
