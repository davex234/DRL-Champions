"use client";

/**
 * `/duelos` — LOS MODOS DE DUELO (Fase 8 → F71 → F72 · Duels 2.0).
 *
 * SELECCIONAR MODO → VER SOLO LO NECESARIO → JUGAR, todo aquí. Lecturas al entrar (en paralelo, sin escrituras): la
 * foto del meta (equipo válido, partida en curso), la de Draft Gauntlet (run activa, entrada y premios) y las
 * repeticiones. Al elegir COMPETITIVO se leen, una vez, el competitivo (rango/rating REAL) y los equipos (puerta de
 * juego de F55): su JUGAR entra en la cola ranked sin pasar por `/competitivo`.
 *
 * La ÚNICA escritura posible desde aquí es la entrada de Draft Gauntlet, y solo tras confirmarla: `startDraft()` (el
 * servidor valida saldo, crea la run y cobra una vez) → la sala del draft. Después se resincroniza el HUD.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useAuth } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { Loading } from "@/components/ui/States";
import { DuelModesHub } from "@/components/modes/DuelModesHub";
import { fetchMetaSnapshot, type MetaSnapshot } from "@/lib/progression/meta";
import { DraftError, fetchDraft, startDraft, type DraftSnapshot } from "@/lib/draft/client";
import { fetchDuelReplays, fetchDuelDecks } from "@/lib/duel/client";
import { fetchCompetitive } from "@/lib/competitive/client";
import type { DuelReplayRow } from "@/lib/duel/types";
import { draftModeFacts, gameModes, type DuelModeId, type ModeFacts } from "@/lib/campaign/presentation";
import { initialDuelMode, type RankedInline } from "@/lib/duels/selector";
import { rankedGate, type RankedGate } from "@/domain/pvpLadder/ranked";
import { rankChip } from "@/domain/ranked/config";
import { DRAFT_ROUTE } from "@/domain/draft/rules";
import { syncFromServer } from "@/lib/game/sync";
import { ns } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("duelos");

type Load<T> = { state: "loading" } | { state: "ready"; data: T } | { state: "error" };

export default function DuelosPage() {
  useLocale();
  return (
    <Suspense fallback={<Loading kind="hub" label={t("Cargando duelos…")} />}>
      <Duelos />
    </Suspense>
  );
}

function Duelos() {
  useLocale();
  const configured = isSupabaseConfigured();
  const router = useRouter();
  const params = useSearchParams();
  const requested = params.get("modo");
  const { user, loading } = useAuth();
  const signedIn = configured && !!user;
  const [meta, setMeta] = useState<Load<MetaSnapshot>>({ state: "loading" });
  const [draft, setDraft] = useState<Load<DraftSnapshot>>({ state: "loading" });
  const [replays, setReplays] = useState<DuelReplayRow[]>([]);
  const [online, setOnline] = useState(true);
  const [ranked, setRanked] = useState<RankedInline | null | "loading" | "error">(null);
  const [gate, setGate] = useState<RankedGate | null | "error">(null);
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const rankedAsked = useRef(false);
  const entering = useRef(false);

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
    if (!configured || !user) { setMeta({ state: "error" }); setDraft({ state: "error" }); setReplays([]); return; }
    fetchMetaSnapshot()
      .then((data) => { if (alive) setMeta(data ? { state: "ready", data } : { state: "error" }); })
      .catch(() => { if (alive) setMeta({ state: "error" }); });
    fetchDraft()
      .then((data) => { if (alive) setDraft({ state: "ready", data }); })
      .catch(() => { if (alive) setDraft({ state: "error" }); });
    fetchDuelReplays()
      .then((r) => { if (alive) setReplays(r.matches); })
      .catch(() => { if (alive) setReplays([]); });
    return () => { alive = false; };
  }, [configured, user, loading, online]);

  /*
   * F84 · el rango va ATADO A LA CUENTA: al cambiar de cuenta se olvida el de la anterior y una respuesta tardía de la
   * cuenta vieja se descarta (nunca el rango de A en la tarjeta de B).
   */
  const uid = user?.id ?? null;
  const uidRef = useRef<string | null>(uid);
  uidRef.current = uid;
  useEffect(() => { rankedAsked.current = false; setRanked(null); setGate(null); }, [uid]);

  /** COMPETITIVO: rango REAL (servidor) + puerta de juego (equipos). Una vez, al elegirlo. */
  const loadRanked = useCallback(() => {
    if (rankedAsked.current || !signedIn) return;
    rankedAsked.current = true;
    const owner = uidRef.current;
    setRanked("loading");
    fetchCompetitive()
      .then((snap) => {
        if (uidRef.current !== owner) return;
        if (!snap) { setRanked("error"); return; }
        // F84 · el estado es el de la temporada competitiva (colocación N / rango derivado), no la escalera de F55.
        const c = snap.competitive.standing;
        setRanked({
          state: c.state, position: snap.self.position, rating: c.rating, placementPlayed: c.placement.played, placementTotal: c.placement.total,
          first: snap.self.position === 1, rank: c.rank ? rankChip(c.rank) : null,
        });
      })
      .catch(() => { if (uidRef.current === owner) setRanked("error"); });
    fetchDuelDecks()
      .then((w) => { if (uidRef.current === owner) setGate(rankedGate({ signedIn: true, decks: w.decks, activeDeckId: w.activeDeckId, activeMatchId: null })); })
      .catch(() => { if (uidRef.current === owner) setGate("error"); });
  }, [signedIn]);

  const m = meta.state === "ready" ? meta.data : null;
  const comp = m?.loop.competitive ?? null;
  const facts: ModeFacts = {
    signedIn,
    hasValidDeck: m ? m.decks.valid > 0 : null,
    activePve: !!m?.loop.steps.some((s) => s.id === "resume-duel"),
    activePvp: !!m?.loop.steps.some((s) => s.id === "resume-pvp"),
    rankedProvisional: comp ? comp.provisional : null,
    // La campaña no se enseña aquí: vive en `/jugar`.
    campaign: null,
    draft: draft.state === "loading" ? "loading" : draftModeFacts(draft.state === "ready" ? draft.data : null),
  };
  const cards = gameModes(facts);

  // Si se llega con `?modo=ranked` (o es el modo con partida abierta), su dato se pide ya.
  const first = initialDuelMode(cards.filter((c) => c.id !== "ROAD_TO_CHAMPIONS"), requested);
  useEffect(() => { if (first === "RANKED" && signedIn && meta.state !== "loading") loadRanked(); }, [first, signedIn, meta.state, loadRanked]);

  /** DRAFT GAUNTLET · ENTRAR (ya confirmado en la tarjeta). El servidor valida saldo y cobra UNA vez. */
  const enterDraft = useCallback(async () => {
    if (entering.current) return;
    entering.current = true;
    setDraftBusy(true);
    setDraftNotice(null);
    try {
      let snap = await startDraft();
      // Otra pestaña creó la run a la vez y aún no la había cobrado: volver a entrar la completa (misma clave de run).
      if (snap.run?.entry && !snap.run.entry.paid) snap = await startDraft();
      setDraft({ state: "ready", data: snap });
      await syncFromServer().catch(() => undefined); // F68 · el HUD enseña el saldo cobrado sin recargar
      if (snap.run && snap.run.entry?.paid !== false) router.push(DRAFT_ROUTE);
    } catch (e) {
      if (e instanceof DraftError && e.snapshot) setDraft({ state: "ready", data: e.snapshot });
      setDraftNotice(e instanceof DraftError && e.code === "INSUFFICIENT_CREDITS" ? t("No tienes créditos suficientes para la entrada.") : e instanceof Error ? e.message : t("No se pudo entrar"));
      await syncFromServer().catch(() => undefined);
    } finally {
      entering.current = false;
      setDraftBusy(false);
    }
  }, [router]);

  if (loading || (signedIn && meta.state === "loading")) return <Loading kind="hub" label={t("Cargando duelos…")} />;

  return (
    <DuelModesHub
      cards={cards}
      requested={requested}
      onSelect={(id: DuelModeId) => { if (id === "RANKED") loadRanked(); }}
      ranked={ranked}
      rankedGate={gate}
      draftFacts={facts.draft}
      draftEconomy={draft.state === "ready" ? draft.data.economy : null}
      credits={m ? m.account.credits : null}
      onDraftEnter={signedIn && online ? () => void enterDraft() : undefined}
      draftBusy={draftBusy}
      draftNotice={draftNotice}
      replays={replays}
      offline={!online}
    />
  );
}
