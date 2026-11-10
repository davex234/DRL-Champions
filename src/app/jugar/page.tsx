"use client";

/**
 * `/jugar` — PLAY HUB (F35 → F71 · Play Experience 2.0).
 *
 * Tres áreas: Road to Champions, Duelos y Tactical Coach. Dos lecturas del servidor, en paralelo y sin escrituras:
 * la foto de Road to Champions (su estado y progreso) y la del meta (partida en curso y equipo válido). Si una
 * falla, su área lo dice y el resto sigue. Los modos de duelo —y la lectura de Draft Gauntlet— viven en `/duelos`.
 */
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { Loading } from "@/components/ui/States";
import { GameModesHub } from "@/components/modes/GameModesHub";
import { fetchMetaSnapshot, type MetaSnapshot } from "@/lib/progression/meta";
import { fetchCampaign, type CampaignSnapshot } from "@/lib/campaign/client";
import { allNodeViews, gameModes, type ModeFacts } from "@/lib/campaign/presentation";
import { trackCampaign } from "@/lib/campaign/telemetry";
import { ns } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("jugar");

type Load<T> = { state: "loading" } | { state: "ready"; data: T } | { state: "error" };

export default function JugarHubPage() {
  useLocale();
  const configured = isSupabaseConfigured();
  const { user, loading } = useAuth();
  const signedIn = configured && !!user;
  const [meta, setMeta] = useState<Load<MetaSnapshot>>({ state: "loading" });
  const [campaign, setCampaign] = useState<Load<CampaignSnapshot>>({ state: "loading" });
  const [online, setOnline] = useState(true);

  useEffect(() => { trackCampaign("game_modes_view"); }, []);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine !== false);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => { window.removeEventListener("online", sync); window.removeEventListener("offline", sync); };
  }, []);

  useEffect(() => {
    if (loading) return;
    let alive = true;
    if (!configured) { setCampaign({ state: "error" }); setMeta({ state: "error" }); return; }
    fetchCampaign()
      .then((data) => { if (alive) setCampaign({ state: "ready", data }); })
      .catch(() => { if (alive) setCampaign({ state: "error" }); });
    if (user) {
      fetchMetaSnapshot()
        .then((data) => { if (alive) setMeta(data ? { state: "ready", data } : { state: "error" }); })
        .catch(() => { if (alive) setMeta({ state: "error" }); });
    } else {
      setMeta({ state: "error" });
    }
    return () => { alive = false; };
  }, [configured, user, loading, online]);

  if (loading) return <Loading kind="hub" label={t("Preparando modos de juego…")} />;

  const m = meta.state === "ready" ? meta.data : null;
  const c = campaign.state === "ready" ? campaign.data : null;
  const next = c?.summary.nextNodeId ? allNodeViews(c).find((n) => n.id === c.summary.nextNodeId) ?? null : null;

  const facts: ModeFacts = {
    signedIn,
    hasValidDeck: m ? m.decks.valid > 0 : null,
    activePve: !!m?.loop.steps.some((s) => s.id === "resume-duel"),
    activePvp: !!m?.loop.steps.some((s) => s.id === "resume-pvp"),
    rankedProvisional: m?.loop.competitive ? m.loop.competitive.provisional : null,
    campaign: campaign.state === "loading" ? "loading" : c
      ? { available: c.available, completed: c.summary.completed, total: c.summary.total, complete: c.summary.complete, nextName: next?.name ?? null, chapter: next ? t("Capítulo {n}", { n: next.chapterOrder }) : null }
      : null,
    // El hub no lee el draft: su estado se enseña en `/duelos`.
    draft: null,
  };

  return (
    <GameModesHub
      cards={gameModes(facts)}
      rtcProgress={signedIn && c?.available ? { completed: c.summary.completed, total: c.summary.total } : null}
      offline={!online}
    />
  );
}
