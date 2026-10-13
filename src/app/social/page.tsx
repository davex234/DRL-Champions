"use client";

/**
 * `/social` — HUB SOCIAL (Fase 29). Amigos · Solicitudes · Buscar jugadores · Retos · Rivales.
 *
 * Todo sale de UNA lectura (`GET /api/game/social`) y cada acción es un POST con ids que el
 * servidor decide en una RPC atómica; después se vuelve a leer. Aquí no se calcula ninguna
 * relación, ninguna presencia ni ningún estado de reto. El latido de presencia (`useSocialHeartbeat`)
 * solo toca el `last_seen_at` propio. `?tab=` abre una pestaña (la navegación y la home enlazan aquí).
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import {
  fetchSocial, searchSocial, sendFriendRequest, acceptFriend, declineFriend, removeFriend, blockUser, unblockUser,
  createChallenge, acceptChallenge, declineChallenge, cancelChallengeReq, SocialError, fetchFriendsPage, useSocialPulse, announceSocialChange,
  type SocialSnapshot, type SearchHit, type ChallengeView, type FriendView,
} from "@/lib/social/client";
import { trackSocial } from "@/lib/social/telemetry";
import { fetchDuelDecks } from "@/lib/duel/client";
import type { DuelDeckDTO } from "@/lib/duel/types";
import type { SocialPlayer } from "@/server/services/social";
import { useToast } from "@/lib/useToast";
import { Toast } from "@/components/ui/Toast";
import { Loading, ErrorState, NeedsAccount } from "@/components/ui/States";
import { SocialHub } from "@/components/social/SocialHub";
import { ChallengeSheet } from "@/components/social/ChallengeSheet";
import { ConfirmSheet } from "@/components/social/ConfirmSheet";
import { isSocialTab, type SocialHandlers, type SocialTab } from "@/components/social/types";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const tr = ns("social");

type Sheet =
  | { kind: "challenge"; target: SocialPlayer; previousMatchId: string | null }
  | { kind: "accept"; challenge: ChallengeView }
  | { kind: "unfriend"; target: SocialPlayer }
  | { kind: "block"; target: SocialPlayer }
  | null;

function Social() {
  useLocale();
  const router = useRouter();
  const params = useSearchParams();
  const { user, loading } = useAuth();
  const online = isSupabaseConfigured();
  const { toast, notify } = useToast(2600);

  /*
   * F85 · la foto social va ATADA A LA CUENTA que la pidió (patrón F81.2/F89): al cambiar de cuenta no se pinta ni un
   * fotograma de los amigos, solicitudes, retos o presencia de la anterior; una respuesta tardía de otra cuenta se descarta.
   */
  const uid = user?.id ?? null;
  const uidRef = useRef<string | null>(uid);
  uidRef.current = uid;
  const [owned, setOwned] = useState<{ owner: string; snap: SocialSnapshot } | null>(null);
  const snap = owned && owned.owner === uid ? owned.snap : null;
  const [moreFriends, setMoreFriends] = useState<FriendView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<SocialTab>(() => { const t = params.get("tab"); return isSocialTab(t) ? t : "amigos"; });
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [decks, setDecks] = useState<DuelDeckDTO[] | null>(null);
  const [activeDeckId, setActiveDeckId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    const owner = uidRef.current;
    if (!owner) return;
    setError(null);
    try { const s = await fetchSocial(); if (s && uidRef.current === owner) { setOwned({ owner, snap: s }); setMoreFriends([]); setNow(Date.now()); } }
    catch (e) { if (uidRef.current === owner) setError(e instanceof Error ? e.message : tr("No se pudo leer lo social")); }
  }, []);
  useEffect(() => { setSheet(null); setResults(null); setQuery(""); if (online && uid) void load(); }, [online, uid, load]);
  useEffect(() => { trackSocial("social_view"); }, []);
  // F85 · convergencia: si el pulso del servidor (≤ 20 s, o al instante tras una acción en otra pestaña) trae otra huella,
  // se relee la foto. Una solicitud aceptada en la pestaña 1 aparece en la 2; un bloqueo quita el «Retar».
  const pulse = useSocialPulse(online && !!user);
  const lastVersion = useRef<string | null>(null);
  useEffect(() => {
    if (!pulse || !snap) return;
    if (lastVersion.current === null) { lastVersion.current = snap.version; }
    if (pulse.version !== lastVersion.current && pulse.version !== snap.version) { lastVersion.current = pulse.version; void load(); }
  }, [pulse, snap, load]);
  useEffect(() => { if (snap) lastVersion.current = snap.version; }, [snap]);

  // Reloj de pantalla para «caduca en…»: cada 30 s. Solo presentación.
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(id); }, []);

  // ── Búsqueda (debounce en el componente; aquí solo se pide y se guarda) ──
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchMore, setSearchMore] = useState<{ offset: number; hasMore: boolean }>({ offset: 0, hasMore: false });
  const seq = useRef(0);
  const onQuery = useCallback(async (q: string, offset = 0) => {
    setQuery(q);
    setSearchError(null);
    if (q.length < 2) { setResults(null); setSearching(false); setSearchMore({ offset: 0, hasMore: false }); return; }
    const my = ++seq.current;
    setSearching(true);
    try {
      const r = await searchSocial(q, offset);
      if (my !== seq.current) return; // llegó tarde: una consulta más nueva manda
      setResults((prev) => (offset > 0 && prev ? [...prev, ...(r?.players ?? [])] : r?.players ?? []));
      setSearchMore({ offset: (r?.offset ?? 0) + (r?.limit ?? 10), hasMore: !!r?.hasMore });
      trackSocial("player_search");
    } catch (e) {
      if (my !== seq.current) return;
      setResults(null);
      setSearchError(e instanceof Error ? e.message : tr("No se pudo buscar"));
    } finally { if (my === seq.current) setSearching(false); }
  }, []);

  // ── Acciones: POST por id → recarga. El toast dice lo que respondió el servidor. ──
  const run = useCallback(async (fn: () => Promise<unknown>, okMsg: string) => {
    if (busy) return false;
    setBusy(true);
    try { await fn(); notify(okMsg, true); announceSocialChange(); await load(); if (query.length >= 2) void onQuery(query); return true; }
    catch (e) { notify(e instanceof Error ? e.message : tr("No se pudo completar"), false); return false; }
    finally { setBusy(false); }
  }, [busy, load, notify, query, onQuery]);

  const ensureDecks = useCallback(async () => {
    if (decks) return;
    try { const d = await fetchDuelDecks(); setDecks(d.decks); setActiveDeckId(d.activeDeckId); }
    catch (e) { setSheetError(e instanceof Error ? e.message : tr("No se pudieron leer tus equipos")); }
  }, [decks]);

  const openMatch = useCallback((matchId: string) => { router.push(`/duelos/pvp?match=${matchId}`); }, [router]);

  const handlers: SocialHandlers = useMemo(() => ({
    onFriendRequest: (p) => { void run(async () => { await sendFriendRequest(p.userId); trackSocial("friend_request"); }, `Solicitud enviada a ${p.username}`); },
    onAcceptFriend: (p) => { void run(async () => { await acceptFriend(p.userId); trackSocial("friend_accept"); }, tr("Ahora sois amigos: {username}", { username: p.username })); },
    onDeclineFriend: (p) => { void run(() => declineFriend(p.userId), tr("Solicitud rechazada")); },
    onCancelRequest: (p) => { void run(() => removeFriend(p.userId), tr("Solicitud retirada")); },
    onUnfriend: (p) => setSheet({ kind: "unfriend", target: p }),
    onBlock: (p) => setSheet({ kind: "block", target: p }),
    onUnblock: (p) => { void run(() => unblockUser(p.userId), `${p.username} desbloqueado`); },
    onChallenge: (p, previousMatchId = null) => { setSheetError(null); setSheet({ kind: "challenge", target: p, previousMatchId }); void ensureDecks(); },
    onAcceptChallenge: (c) => { setSheetError(null); setSheet({ kind: "accept", challenge: c }); void ensureDecks(); },
    onDeclineChallenge: (c) => { void run(() => declineChallenge(c.id), tr("Reto rechazado")); },
    onCancelChallenge: (c) => { void run(() => cancelChallengeReq(c.id), tr("Reto cancelado")); },
    onOpenMatch: openMatch,
  }), [run, ensureDecks, openMatch]);

  const confirmSheet = useCallback(async (deckId: string) => {
    if (!sheet || busy) return;
    setBusy(true); setSheetError(null);
    try {
      if (sheet.kind === "challenge") {
        const r = await createChallenge(sheet.target.userId, deckId, sheet.previousMatchId);
        trackSocial("challenge_sent");
        notify(r.code === "ALREADY_PENDING" ? tr("Ya tenías un reto pendiente con esa persona") : tr("Reto enviado a {username}: esperando respuesta…", { username: sheet.target.username }), true);
        setSheet(null); setTab("retos"); announceSocialChange(); await load();
      } else if (sheet.kind === "accept") {
        const r = await acceptChallenge(sheet.challenge.id, deckId);
        trackSocial("challenge_accept");
        setSheet(null);
        announceSocialChange();
        if (r.matchId) openMatch(r.matchId); else await load();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : tr("No se pudo completar");
      setSheetError(msg);
      if (e instanceof SocialError && ["EXPIRED", "NOT_PENDING", "BUSY", "IN_QUEUE", "UNAVAILABLE", "INCOMING_PENDING", "CHALLENGE_LIMIT"].includes(e.code ?? "")) {
        setSheet(null); notify(msg, false); await load();
        if (e.code === "INCOMING_PENDING") setTab("retos");
      }
    } finally { setBusy(false); }
  }, [sheet, busy, notify, load, openMatch]);

  const confirmDanger = useCallback(async () => {
    if (!sheet || (sheet.kind !== "unfriend" && sheet.kind !== "block")) return;
    const t = sheet.target;
    const ok = sheet.kind === "unfriend"
      ? await run(() => removeFriend(t.userId), tr("{username} ya no es tu amigo", { username: t.username }))
      : await run(() => blockUser(t.userId), tr("{username} bloqueado", { username: t.username }));
    if (ok) setSheet(null);
  }, [sheet, run]);

  const changeTab = useCallback((t: SocialTab) => {
    setTab(t);
    router.replace(t === "amigos" ? "/social" : `/social?tab=${t}`, { scroll: false });
  }, [router]);

  // F85 · enlace directo desde el aviso global: `/social?tab=retos&aceptar=<reto>` abre la hoja de aceptar (una vez).
  // Se marca como hecho SOLO cuando la foto ya trae el reto: si el aviso llega con el hub abierto, la foto en pantalla es
  // anterior al reto y la relectura (por el pulso) llega después; marcarlo antes dejaba la hoja sin abrir para siempre.
  const deepAccept = params.get("aceptar");
  const deepDone = useRef<string | null>(null);
  useEffect(() => {
    if (!snap || !deepAccept || deepDone.current === deepAccept) return;
    const c = snap.challenges.find((x) => x.id === deepAccept && x.actions.accept);
    if (!c) { if (deepDone.current !== `load:${deepAccept}`) { deepDone.current = `load:${deepAccept}`; void load(); } return; }
    deepDone.current = deepAccept;
    setTab("retos");
    handlers.onAcceptChallenge(c);
  }, [snap, deepAccept, handlers, load]);

  const onMoreFriends = useCallback(async () => {
    if (!snap) return;
    try { const page = await fetchFriendsPage(snap.friends.length + moreFriends.length); if (page) setMoreFriends((m) => [...m, ...page.friends]); }
    catch (e) { notify(e instanceof Error ? e.message : tr("No se pudieron leer más amigos"), false); }
  }, [snap, moreFriends.length, notify]);

  if (loading) return <Loading label={tr("Leyendo tu lista de amigos…")} />;
  if (!online || !user) return <NeedsAccount what={tr("lo social (amigos y duelos amistosos)")} />;
  if (error && !snap) return <ErrorState message={td(error)} onRetry={load} />;
  if (!snap) return <Loading label={tr("Leyendo tu lista de amigos…")} />;

  return (
    <>
      <SocialHub
        snap={snap}
        now={now}
        tab={tab}
        onTab={changeTab}
        handlers={handlers}
        search={{ query, results, searching, error: searchError, onQuery: (q: string) => void onQuery(q), hasMore: searchMore.hasMore, onMore: () => void onQuery(query, searchMore.offset) }}
        moreFriends={moreFriends}
        onMoreFriends={() => void onMoreFriends()}
      />
      <ChallengeSheet
        open={sheet?.kind === "challenge" || sheet?.kind === "accept"}
        mode={sheet?.kind === "accept" ? "accept" : "send"}
        target={sheet?.kind === "challenge" ? sheet.target : sheet?.kind === "accept" ? sheet.challenge.challenger : null}
        rematch={sheet?.kind === "challenge" ? sheet.previousMatchId !== null : sheet?.kind === "accept" ? sheet.challenge.previousMatchId !== null : false}
        decks={decks}
        activeDeckId={activeDeckId}
        busy={busy}
        error={td(sheetError)}
        onConfirm={confirmSheet}
        onClose={() => { if (!busy) setSheet(null); }}
      />
      <ConfirmSheet
        open={sheet?.kind === "unfriend"}
        title={tr("¿Eliminar amigo?")}
        body={sheet?.kind === "unfriend" ? tr("{username} dejará de ser tu amigo y no podréis retaros hasta volver a serlo. Vuestro historial de partidas se conserva.", { username: sheet.target.username }) : ""}
        confirmLabel={tr("Eliminar amigo")}
        busy={busy}
        onConfirm={confirmDanger}
        onClose={() => { if (!busy) setSheet(null); }}
      />
      <ConfirmSheet
        open={sheet?.kind === "block"}
        title={tr("¿Bloquear jugador?")}
        body={sheet?.kind === "block" ? tr("{username} no podrá enviarte solicitudes ni retos, y dejaréis de ser amigos. Sus retos pendientes se cancelan. Puedes desbloquearle desde Solicitudes.", { username: sheet.target.username }) : ""}
        confirmLabel={tr("Bloquear")}
        busy={busy}
        onConfirm={confirmDanger}
        onClose={() => { if (!busy) setSheet(null); }}
      />
      <Toast toast={toast} />
    </>
  );
}

export default function SocialPage() {
  useLocale();
  return (
    <Suspense fallback={<Loading label={tr("Cargando…")} />}>
      <Social />
    </Suspense>
  );
}
