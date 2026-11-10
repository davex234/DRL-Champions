"use client";

/**
 * `/competitivo` — CENTRO COMPETITIVO (Fase 55). La entrada canónica al ranked.
 *
 * Tres lecturas, ninguna escritura: `GET /api/game/competitive` (rango/rating/escalera/historial/temporada del
 * servidor), `GET /api/game/duel/decks` (mazos validados en el servidor) y el `play-status` del armazón (¿hay
 * una partida abierta?). La puerta de juego se DERIVA con `rankedGate`; JUGAR lleva a la arena PvP con el mazo,
 * que entra en cola al llegar. `/duelos/competitivo` redirige aquí; historial, detalle y perfiles siguen allí.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { fetchCompetitive, fetchCompetitiveLadder, type CompetitiveSnapshot } from "@/lib/competitive/client";
import { trackCompetitive } from "@/lib/competitive/telemetry";
import { fetchDuelDecks } from "@/lib/duel/client";
import { usePlayStatus } from "@/lib/gameShell/playStatus";
import type { DuelDeckDTO } from "@/lib/duel/types";
import { rankedGate } from "@/domain/pvpLadder/ranked";
import { RankedCenter } from "@/components/competitive/ranked/RankedCenter";
import { Loading, ErrorState, NeedsAccount } from "@/components/ui/States";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("competitivo");

export default function CompetitivoPage() {
  useLocale();
  const { user, loading } = useAuth();
  const online = isSupabaseConfigured();
  /*
   * F84 · la foto va ATADA A LA CUENTA que la pidió (patrón F81.2/F89): al cambiar de cuenta no se pinta ni un fotograma
   * el rango, rating, puesto o historial de la anterior, y una respuesta tardía de la cuenta vieja se descarta.
   */
  const uid = user?.id ?? null;
  const uidRef = useRef<string | null>(uid);
  uidRef.current = uid;
  const [owned, setOwned] = useState<{ owner: string; snap: CompetitiveSnapshot } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ownedDecks, setOwnedDecks] = useState<{ owner: string; list: DuelDeckDTO[]; activeDeckId: string | null } | null>(null);
  const [deckError, setDeckError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const status = usePlayStatus(user?.id ?? null, "/competitivo");
  const snap = owned && owned.owner === uid ? owned.snap : null;
  const decks = ownedDecks && ownedDecks.owner === uid ? ownedDecks : null;

  const load = useCallback(async () => {
    const owner = uidRef.current;
    if (!owner) return;
    setError(null);
    try { const s = await fetchCompetitive(); if (s && uidRef.current === owner) setOwned({ owner, snap: s }); }
    catch (e) { if (uidRef.current === owner) setError(e instanceof Error ? e.message : t("No se pudo leer el competitivo")); }
  }, []);
  const loadDecks = useCallback(async () => {
    const owner = uidRef.current;
    if (!owner) return;
    setDeckError(null);
    try { const w = await fetchDuelDecks(); if (uidRef.current === owner) setOwnedDecks({ owner, list: w.decks, activeDeckId: w.activeDeckId }); }
    catch (e) { if (uidRef.current === owner) setDeckError(e instanceof Error ? e.message : t("No se pudieron leer tus equipos")); }
  }, []);
  useEffect(() => { setChosen(null); setError(null); setDeckError(null); if (online && uid) { void load(); void loadDecks(); } }, [online, uid, load, loadDecks]);
  useEffect(() => { trackCompetitive("competitive_view"); }, []);

  // Solo una partida PvP abierta bloquea la cola (`ACTIVE_MATCH`); otra partida (PvE, campaña) no.
  const resume = status?.resume && status.resume.href.startsWith("/duelos/pvp") ? status.resume : null;
  const gate = useMemo(() => (decks
    ? rankedGate({ signedIn: true, decks: decks.list, activeDeckId: decks.activeDeckId, chosenId: chosen, activeMatchId: resume?.id ?? null })
    : null), [decks, chosen, resume]);
  const legalDecks = useMemo(() => (decks?.list ?? []).filter((d) => d.valid), [decks]);

  if (loading) return <Loading kind="hub" label={t("Leyendo tu puesto…")} />;
  if (!online || !user) return <NeedsAccount what={t("el modo competitivo")} />;
  if (error && !snap) return <ErrorState message={td(error)} onRetry={load} />;
  if (!snap) return <Loading kind="hub" label={t("Leyendo tu puesto…")} />;
  return (
    <RankedCenter
      snap={snap}
      gate={gate}
      legalDecks={legalDecks}
      onChooseDeck={setChosen}
      resumeHref={resume?.href ?? null}
      loadingDecks={decks === null && !deckError}
      deckError={deckError}
      onRetryDecks={loadDecks}
      loadLadderPage={(offset) => fetchCompetitiveLadder(offset)}
    />
  );
}
