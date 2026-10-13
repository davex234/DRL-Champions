"use client";

/**
 * `/duelos/jugar` — LA ARENA (Fases 8, 9G y 26).
 *
 * Una sola pantalla con cinco momentos: PRE-PARTIDA (mazo y rival) → INTRO (el «VS») → los diez
 * turnos → RESULTADO → post-partida (revancha, cambiar, ver, salir). El estado de la partida NO
 * vive aquí: vive en el servidor, y esta pantalla guarda únicamente la última proyección recibida.
 *
 * FASE 9G — A PANTALLA COMPLETA. Esta ruta es INMERSIVA (`src/design/nav.ts`): el armazón se
 * aparta y la partida ocupa el viewport entero. A cambio, la arena trae su propio cromo —marcador,
 * dificultad, ayuda, sonido, pantalla completa y una salida siempre visible—.
 *
 * FASE 26 — CORE GAMEPLAY 2.0. Sin tocar motor, balance ni reglas:
 *   · pre-partida que enseña TODOS los mazos y explica por qué uno no puede jugar (roles que faltan);
 *   · intro saltable (respeta reduced-motion);
 *   · cerrojo de jugada explícito (una jugada en vuelo bloquea mano, ejes y botón);
 *   · reconexión: una partida en curso se retoma desde el servidor al entrar, y se dice;
 *   · final con carta destacada, desempate explicado, historial en miniatura, nivel (XP del servidor);
 *   · revancha directa (mismo mazo, mismo rival) o volver a la pre-partida;
 *   · ayuda («?») y silencio en el cromo; telemetría de los siete momentos (`lib/duel/telemetry`).
 *
 * FLUJO DE UN TURNO
 *   1. El jugador elige carta (y estadística, si ataca).
 *   2. Se envía a `/api/game/duel`.
 *   3. El servidor valida con el orquestador, deja responder al bot, cierra el turno con el Combat
 *      Resolver y devuelve el estado nuevo.
 *   4. Aquí solo se pinta ese estado y, si el turno se resolvió, se enseña la revelación.
 *
 * No hay sondeo ni temporizadores de red: cada petición nace de una acción del jugador.
 *
 * FASE 61 · GAMEPLAY 5.0 — la misma partida, con ritmo de juego (`lib/duel/matchFlow`, presentación pura):
 *   · entrada en tres tiempos (rival → VS → equipo), solo en una partida recién creada: recargar no la repite;
 *   · desempate EN ESCENA entre el último turno y el golpe final, solo si el marcador no decidió y solo si la
 *     partida terminó delante del jugador (una recarga va directa al resultado: la concesión ya ocurrió una vez);
 *   · «Salir» ya no borra la partida de un clic: diálogo con la consecuencia REAL (guardar o abandonar);
 *   · el botón Atrás abre ese mismo diálogo en vez de sacar de la arena sin avisar;
 *   · cerrar la revelación es idempotente (Intro + clic no llaman dos veces al final);
 *   · F5 SOBRE EL RESULTADO vuelve al resultado (`?resultado=<id>` + lectura del propietario), no a la pre-partida:
 *     la partida terminada ya no es «activa». Es una LECTURA: la recompensa ya se abonó una vez y no se repite.
 */
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, MotionConfig } from "framer-motion";
import { useAuth } from "@/lib/supabase/auth";
import { useDuelRulesIntro } from "@/lib/duel/rulesIntro";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { Loading, ErrorState, NeedsAccount } from "@/components/ui/States";
import { playerMessage } from "@/components/ui/game/GameStates";
import { FullscreenToggle } from "@/components/duel/FullscreenToggle";
import { SoundToggle } from "@/components/duel/SoundToggle";
import { HelpSheet } from "@/components/duel/HelpSheet";
import { Recessed } from "@/components/ui/Surface";
import { NxButton } from "@/components/ui/NxButton";
import { MatchBoard } from "@/components/duel/MatchBoard";
import { DuelMoment } from "@/components/duel/DuelMoment";
import { MatchIntro } from "@/components/duel/MatchIntro";
import { PreMatch } from "@/components/duel/PreMatch";
import { ResultScreen } from "@/components/duel/ResultScreen";
import { QuickMatchResult } from "@/components/duel/QuickMatchResult";
import { isQuickMatchResult } from "@/lib/duel/quickResult";
// F83 · +XP de temporada y retos tras la partida (lo lee del servidor; sin temporada activa no pinta nada).
import { SeasonPostMatch } from "@/components/seasonTrack/SeasonMoments";
import { MatchComplete } from "@/components/duel/MatchComplete";
import { MatchTopBar } from "@/components/duel/arena/MatchTopBar";
import { ArenaEnvironment } from "@/components/duel/arena/ArenaEnvironment";
import type { ArenaMode } from "@/lib/duel/arenas";
import { TiebreakReveal } from "@/components/duel/experience/TiebreakReveal";
import { LeaveMatchDialog } from "@/components/duel/experience/LeaveMatchDialog";
import { endSequence, leaveConsequence } from "@/lib/duel/matchFlow";
import { useLeaveGuard } from "@/lib/duel/useLeaveGuard";
import {
  fetchDuelDecks, fetchActiveDuel, fetchDuelState, startDuel, playDuelTurn, abandonDuel, DuelError,
} from "@/lib/duel/client";
import { fetchGameState } from "@/lib/game/client";
import { trackDuel } from "@/lib/duel/telemetry";
import { useProgressionDelta } from "@/lib/progression/meta";
import { PostMatchProgress } from "@/components/progression/PostMatchProgress";
import { pickStartableDeck } from "@/lib/duel/gameplayUx";
import { CampaignPreMatch } from "@/components/campaign/CampaignPreMatch";
import { CampaignResultBanner } from "@/components/campaign/CampaignResultBanner";
import { fetchCampaign, startCampaignNode, syncCampaign, type CampaignSnapshot } from "@/lib/campaign/client";
import { findNodeView } from "@/domain/campaign/snapshot";
import { NODE_ID_PATTERN, campaignNodeHref, chapterOf, nextNodeAfter, resultCopy } from "@/lib/campaign/presentation";
import { trackCampaign } from "@/lib/campaign/telemetry";
import { fetchDraft, type DraftSnapshot } from "@/lib/draft/client";
import { draftResultCopy } from "@/lib/draft/presentation";
import { DraftResultBanner } from "@/components/draft/DraftResultBanner";
import { DRAFT_ROUTE } from "@/domain/draft/rules";
import { initialDifficulty, isFirstMatchContext, showFirstSessionComplete } from "@/lib/journey/arena";
import { discoveryItems } from "@/lib/journey/presentation";
import { fetchDailyLoop, type DailyLoopSnapshot } from "@/lib/dailyLoop/client";
import { FirstMatchCoach } from "@/components/journey/FirstMatchCoach";
import { JourneyDiscovery } from "@/components/journey/JourneyDiscovery";
import { NextUpAfter } from "@/components/liveService/NextUpAfter";
import { FirstMatchHint, OnboardingAfterMatch } from "@/components/onboarding/FirstMatchHelp";
import { invalidateOnboarding, useOnboarding } from "@/lib/onboarding/client";
import {
  DIFFICULTY_INFO, type BotDifficulty, type CombatStatKey, type DuelDeckDTO,
  type DuelMatchView, type DuelResultView, type DuelTurnView,
} from "@/lib/duel/types";

/**
 * Lo que tarda la revelación en abrirse tras colocar la carta: el hueco en el que se ve la
 * carta caer en su posición (ver `play`). Presentación pura, el turno ya está resuelto.
 * Medido: la colocación dura 440 ms; con 340 se ve el desplazamiento y la desaceleración.
 */
const REVEAL_DELAY_MS = 340;

export default function JugarPage() {
  const { user, loading } = useAuth();
  if (loading) return <Loading label="Preparando duelo…" />;
  if (!isSupabaseConfigured() || !user) return <NeedsAccount what="jugar duelos" />;
  return (
    <Suspense fallback={<Loading label="Preparando duelo…" />}>
      <Play />
    </Suspense>
  );
}

type Stage = "loading" | "prematch" | "intro" | "match" | "result";

function Play() {
  const router = useRouter();
  const params = useSearchParams();

  const [stage, setStage] = useState<Stage>("loading");
  const [decks, setDecks] = useState<DuelDeckDTO[]>([]);
  const [deckId, setDeckId] = useState<string | null>(params.get("deck"));
  /** FASE 32 · equipo activo (servidor). Solo decide qué equipo se propone primero; jugar sigue validando. */
  const [activeDeckId, setActiveDeckId] = useState<string | null>(null);
  /* Fase 40 · `?dificultad=EASY` (primera sesión) solo PRESELECCIONA; se puede cambiar y el servidor valida. */
  const [difficulty, setDifficulty] = useState<BotDifficulty>(() => initialDifficulty(params.get("dificultad")));
  const firstMatch = isFirstMatchContext(params.get("primera"));
  /*
   * F63 · ¿es la PRIMERA partida de la guía? El enlace de la guía lleva `?primera=1`; si se llega por otro camino (JUGAR,
   * partida retomada), lo dice la guía del servidor (paso actual = partida). Solo decide si se enseña la ayuda del turno.
   */
  const { user: me } = useAuth();
  const onboarding = useOnboarding(me?.id ?? null);
  /** Reglas compactas de la preparación: solo la primera vez que esta cuenta entra (preferencia de presentación). */
  const rulesIntro = useDuelRulesIntro(me?.id ?? null);
  const guidedMatch = firstMatch || onboarding.view?.current === "match";
  /** Fase 40 · la partida se retomó al entrar (p. ej. el primer combate continuado desde el vestíbulo, sin `?primera`). */
  const resumedAtBoot = useRef(false);
  /** Fase 40 · foto del vestíbulo tras el resultado del primer combate: «Primera sesión completada» solo si el servidor lo dice. */
  const [loopAfter, setLoopAfter] = useState<DailyLoopSnapshot | null>(null);
  const [view, setView] = useState<DuelMatchView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState<DuelTurnView | null>(null);
  const [help, setHelp] = useState(false);
  /** La partida se retomó desde el servidor al entrar: se dice una vez. */
  const [recovered, setRecovered] = useState(false);
  /** XP total de la cuenta tras la partida (servidor). `null` hasta pedirla. */
  const [xp, setXp] = useState<number | null>(null);
  /*
   * ASENTANDO. El hueco entre «la carta ya está en el tablero» y «se abre la revelación».
   * Cerrojo de presentación: no se juega mientras se enseña un turno.
   */
  const [settling, setSettling] = useState(false);

  /*
   * FASE 35 · ROAD TO CHAMPIONS. `?campaign=<nodo>` convierte la pre-partida en la del nodo: rival y dificultad
   * los fija el servidor. La partida, el tablero y el resultado son los de siempre; solo cambia el contexto.
   */
  const campaignParam = params.get("campaign");
  const campaignNodeId = campaignParam && NODE_ID_PATTERN.test(campaignParam) ? campaignParam : null;
  const [campaign, setCampaign] = useState<CampaignSnapshot | null>(null);
  const [campaignFailed, setCampaignFailed] = useState(false);
  /** Nodo de la partida EN PANTALLA (lanzada desde un nodo o retomada con su intento abierto). */
  const [campaignMatchNode, setCampaignMatchNode] = useState<string | null>(null);
  /** El nodo ya estaba completado antes de esta partida: distingue primera victoria de rejugar. */
  const [campaignWasCompleted, setCampaignWasCompleted] = useState(false);
  /** Nombre del rival real para el tablero (presentación: el servidor no lo guarda en la partida). */
  const campaignRival = useRef<string | null>(null);
  const decorate = useCallback((v: DuelMatchView): DuelMatchView => (campaignRival.current ? { ...v, rivalLabel: campaignRival.current } : v), []);
  const trackedSettle = useRef<string | null>(null);

  /*
   * FASE 39 · DRAFT GAUNTLET. `?draft=1` = la arena en contexto de draft: la partida es la del combate activo de la
   * run (servidor). No se elige equipo ni rival, no hay revancha ni abandono desde aquí («Salir» vuelve al gauntlet
   * y la partida sigue guardada) y el resultado lo cuenta la run ya liquidada.
   */
  const draftMode = params.get("draft") === "1";
  /** FASE 61 · partida terminada que la pantalla estaba enseñando (recarga sobre el resultado). */
  const resultParam = params.get("resultado");
  /* Se lee UNA vez (al montar): quitarlo luego de la URL no debe volver a disparar el arranque. */
  const resultAtBoot = useRef(resultParam && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(resultParam) ? resultParam : null);
  const [draftSnap, setDraftSnap] = useState<DraftSnapshot | null>(null);

  /** Evita el doble envío: una jugada en vuelo bloquea la siguiente. */
  const inFlight = useRef(false);
  /** Reloj de la revelación (ver `play`). Se limpia al desmontar: nunca queda colgado. */
  const revealTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(revealTimer.current), []);

  const boot = useCallback(async () => {
    setFatal(null);
    try {
      if (draftMode) {
        // Fase 39 · el combate se recupera desde la run (la lectura ya reconcilia un combate terminado).
        const snap = await fetchDraft();
        setDraftSnap(snap);
        const matchId = snap.run?.status === "IN_MATCH" ? snap.run.currentMatchId : null;
        if (!matchId) { router.replace(DRAFT_ROUTE); return; }
        const r = await fetchDuelState(matchId);
        const fresh = r.view.status === "IN_PROGRESS" && r.view.history.length === 0;
        setView(r.view);
        setRecovered(r.view.status === "IN_PROGRESS" && !fresh);
        setStage(r.view.status !== "IN_PROGRESS" ? "result" : fresh ? "intro" : "match");
        if (!fresh) trackDuel("reconnect");
        return;
      }
      // Una partida en curso manda sobre la pre-partida: se retoma donde quedó (RECONEXIÓN).
      // Fase 35 · la foto del nodo se pide EN PARALELO (arranca antes) y no bloquea si falla.
      const campaignRead = campaignNodeId ? fetchCampaign().catch(() => null) : Promise.resolve(null);
      const [active, d] = await Promise.all([fetchActiveDuel(), fetchDuelDecks()]);
      const camp = await campaignRead;
      setDecks(d.decks);
      setCampaign(camp);
      setCampaignFailed(Boolean(campaignNodeId) && !camp);
      if (active.view) {
        // Fase 35 · si la partida en curso es la de un nodo, se recupera su contexto (lectura del servidor).
        const snap = camp ?? await fetchCampaign().catch(() => null);
        const open = snap?.activeAttempt;
        if (snap && open && open.matchId === active.view.matchId) {
          const n = findNodeView(snap, open.nodeId);
          setCampaign(snap);
          setCampaignMatchNode(open.nodeId);
          setCampaignWasCompleted(n?.status === "COMPLETED");
          campaignRival.current = n?.opponent.name ?? null;
        }
        setView(decorate(active.view));
        setRecovered(active.view.status === "IN_PROGRESS");
        resumedAtBoot.current = active.view.status === "IN_PROGRESS";
        setStage(active.view.status === "IN_PROGRESS" ? "match" : "result");
        trackDuel("reconnect");
        return;
      }
      setActiveDeckId(d.activeDeckId);
      setDeckId((cur) => cur ?? pickStartableDeck(d.decks, d.activeDeckId)?.id ?? d.decks[0]?.id ?? null);
      /*
       * FASE 61 · RECARGA SOBRE EL RESULTADO. Sin partida en curso pero con `?resultado=<id>`, se relee esa partida (solo
       * la del propietario: `getMatch` filtra por usuario) y, si está terminada, se enseña su resultado DIRECTAMENTE: sin
       * golpe final ni desempate (ya se vieron) y sin pagar nada (el abono ocurrió una vez, con clave `duel:<id>`).
       */
      const resultMatchId = resultAtBoot.current;
      resultAtBoot.current = null;
      if (resultMatchId && !campaignNodeId) {
        const done = await fetchDuelState(resultMatchId).then((r) => r.view).catch(() => null);
        if (done && done.status !== "IN_PROGRESS") {
          setView(decorate(done));
          setStage("result");
          fetchGameState().then((s) => setXp(typeof s?.xp === "number" ? s.xp : null)).catch(() => setXp(null));
          // F63 · recargar sobre el resultado de la primera partida conserva «Ver mi progreso» (lectura pura).
          if (firstMatch) fetchDailyLoop().then((r) => setLoopAfter(r.data)).catch(() => undefined);
          return;
        }
      }
      setStage("prematch");
    } catch (e) {
      setFatal(e instanceof Error ? e.message : "No se pudo preparar el duelo");
      setStage("prematch");
    }
  }, [campaignNodeId, decorate, draftMode, router, firstMatch]);

  /** Fase 35 · tras la partida, el servidor reconcilia y devuelve el mapa (el banner lee el intento liquidado). */
  const refreshCampaign = useCallback(async () => {
    try { setCampaign(await syncCampaign()); } catch { /* el banner ofrece «Actualizar progreso» */ }
  }, []);

  useEffect(() => { void boot(); }, [boot]);

  /** Pide la XP total al servidor al terminar (para el nivel). Si falla, no se enseña nivel. */
  const loadXp = useCallback(() => {
    fetchGameState().then((s) => setXp(typeof s?.xp === "number" ? s.xp : null)).catch(() => setXp(null));
  }, []);

  /*
   * FASE 27 · EL DUELO ALIMENTA EL META. Lectura del servidor antes de empezar y otra al terminar:
   * la diferencia (XP, nivel, objetivos que avanzaron o se completaron) se enseña en el resultado.
   * Nada se calcula aquí como autoridad: son dos verdades del servidor y su distancia.
   */
  const progression = useProgressionDelta();
  const { begin: beginProgression, end: endProgression, reset: resetProgression } = progression;

  /*
   * FASE 45 · el golpe de «partida terminada» va ANTES del resultado: se enciende aquí y lo apaga `MatchComplete`
   * (solo o al saltarlo). La carga del resultado no espera a la animación: el XP y el meta se piden ya.
   */
  const [complete, setComplete] = useState(false);
  /* FASE 61 · el desempate en escena va ANTES del golpe final, y solo si el marcador no decidió (`endSequence`). */
  const [tiebreak, setTiebreak] = useState(false);
  const tiebreakDone = useCallback(() => setTiebreak(false), []);

  /** Al entrar en resultado: XP del servidor, deltas del meta y telemetría. `result` = el que acaba de llegar. */
  const finish = useCallback((result?: DuelResultView | null) => {
    setStage("result");
    setTiebreak(endSequence(result ?? null, true).includes("TIEBREAK"));
    setComplete(true);
    trackDuel("match_completed");
    // Fase 39 · el draft no da XP ni mueve el meta: solo se relee la run liquidada.
    if (draftMode) { fetchDraft().then(setDraftSnap).catch(() => undefined); return; }
    loadXp();
    void endProgression();
    if (campaignMatchNode) void refreshCampaign();
    // Una lectura PURA del vestíbulo, solo si pudo ser la primera partida (CTA del recorrido o partida retomada):
    // «Primera sesión completada» se enseña únicamente si el servidor lo dice (`journey.justCompleted`).
    if (firstMatch || resumedAtBoot.current) fetchDailyLoop().then((r) => setLoopAfter(r.data)).catch(() => undefined);
    // F63 · la partida terminada mueve la guía (paso 5 → 6): las demás pantallas releen al volver.
    invalidateOnboarding();
  }, [loadXp, endProgression, campaignMatchNode, refreshCampaign, draftMode, firstMatch]);

  const begin = useCallback(async (id: string | null, lv: BotDifficulty) => {
    if (!id || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      // Fase 27 · lectura «antes» del meta (solo lectura; si falla, no habrá deltas y ya está).
      await beginProgression();
      // Fase 35 · un nodo (el del enlace o el de la partida que se rejuega) se lanza por la campaña.
      const nodeId = campaignNodeId ?? campaignMatchNode;
      const node = nodeId && campaign ? findNodeView(campaign, nodeId) : null;
      const r = nodeId ? await startCampaignNode(nodeId, id) : await startDuel(id, lv);
      campaignRival.current = nodeId ? (node?.opponent.name ?? r.view.rivalLabel ?? null) : null;
      if (nodeId) {
        setCampaignMatchNode(nodeId);
        setCampaignWasCompleted(node?.status === "COMPLETED");
        trackCampaign("campaign_match_start");
        if (node?.status === "COMPLETED") trackCampaign("campaign_replay");
      }
      setView(decorate(r.view));
      setRecovered(false);
      setXp(null);
      trackDuel("match_start");
      setStage("intro");
    } catch (e) {
      setError(playerMessage(e instanceof Error ? e.message : "No se pudo empezar el duelo")); // F86.2 · nunca texto técnico
      setStage("prematch");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [beginProgression, campaignNodeId, campaignMatchNode, campaign, decorate]);

  /* Fase 35 · telemetría del nodo liquidado, una vez por partida. */
  useEffect(() => {
    if (!campaign || !view || !campaignMatchNode) return;
    const s = campaign.lastAttempt;
    if (!s || s.matchId !== view.matchId || trackedSettle.current === view.matchId) return;
    trackedSettle.current = view.matchId;
    if (s.firstClear) {
      trackCampaign("campaign_node_complete");
      if (chapterOf(campaign, s.nodeId)?.complete) trackCampaign("campaign_chapter_complete");
    }
  }, [campaign, view, campaignMatchNode]);

  /*
   * Adopta un estado del servidor que ya resolvió una decisión (la tuya o la automática): LA CARTA SE VE CAER ANTES DEL
   * ENFRENTAMIENTO. `setView` deja la carta en su posición y, 340 ms después, `setReveal` abre la revelación.
   */
  const adoptView = useCallback((next: DuelMatchView, before: number) => {
    setView(decorate(next));
    const last = next.lastTurn;
    if (last && next.history.length > before) {
      trackDuel("round_resolved");
      setSettling(true);
      revealTimer.current = window.setTimeout(() => { setReveal(last); setSettling(false); }, REVEAL_DELAY_MS);
    }
    if (next.status !== "IN_PROGRESS" && !last) finish(next.result);
  }, [decorate, finish]);

  // DUEL GAMEPLAY UX 2.0 · contra un bot NO hay reloj de decisión (ni contador, ni sondeo al vencer, ni jugada
  // automática): el servidor no pone plazo en ninguna partida PvE. El reloj F72.8 sigue solo en PvP (`PvpArena`).

  async function play(cardUid: string, stat?: CombatStatKey) {
    if (!view || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const before = view.history.length;
    try {
      const r = await playDuelTurn(view.matchId, cardUid, stat, view.stateVersion);
      adoptView(r.view, before);
    } catch (e) {
      /*
       * F66 · el servidor manda. Un 409 (otra pestaña o un doble envío ya movió la partida) trae el estado REAL: se
       * adopta tal cual. Un fallo de red NO significa que la jugada no se aplicara (pudo procesarse y perderse la
       * respuesta): se vuelve a leer la partida antes de decir nada, y lo que haya en el servidor es lo que se ve.
       */
      const payload = e instanceof DuelError ? e.payload : null;
      const serverView = payload && typeof payload === "object" && "view" in payload ? (payload.view as DuelMatchView | null) : null;
      if (e instanceof DuelError && e.status === 409 && serverView && e.code === "TURN_EXPIRED") {
        // F72.8 · llegó tarde: el servidor ya jugó por ti. Se adopta como cualquier jugada; lo explica el aviso.
        adoptView(serverView, before);
      } else if (e instanceof DuelError && e.status === 409 && serverView) {
        setView(decorate(serverView));
        setError("Partida sincronizada: se muestra el estado del servidor.");
      } else if (!(e instanceof DuelError)) {
        setError("Sincronizando partida…");
        try {
          const r = await fetchDuelState(view.matchId);
          setView(decorate(r.view));
          setError(r.view.history.length > before ? "Partida sincronizada: la jugada ya estaba registrada." : "Sin conexión: la jugada no llegó. Vuelve a intentarlo.");
        } catch { setError("Sin conexión. Reintenta cuando vuelva la red: la partida sigue guardada."); }
      } else {
        setError(playerMessage(e.message || "No se pudo jugar el turno")); // F86.2
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  /**
   * Al cerrar la revelación se decide si la partida sigue o ha terminado.
   * FASE 61 · IDEMPOTENTE: Intro sobre «Continuar» dispara el clic Y el atajo de teclado; sin este cerrojo el final
   * se pedía dos veces (dos lecturas de XP/meta). La clave es partida + número de turno revelado.
   */
  const closedReveal = useRef<string | null>(null);
  const closeReveal = useCallback(() => {
    const key = reveal && view ? `${view.matchId}:${reveal.number}` : null;
    if (!key || closedReveal.current === key) return;
    closedReveal.current = key;
    setReveal(null);
    setSettling(false);
    if (view && view.status !== "IN_PROGRESS") finish(view.result);
  }, [reveal, view, finish]);

  const introDone = useCallback(() => setStage((s) => (s === "intro" ? "match" : s)), []);

  /*
   * FASE 61 · el resultado en pantalla deja su id en la URL (sin navegar: `replaceState` conserva el estado del router)
   * para que una recarga vuelva a él; al salir del resultado (revancha, cambiar, abandonar) se quita.
   */
  const shownResult = stage === "result" && view && !draftMode ? view.matchId : null;
  useEffect(() => {
    if (typeof window === "undefined" || stage === "loading") return;
    const u = new URL(window.location.href);
    const cur = u.searchParams.get("resultado");
    if (shownResult ? cur === shownResult : cur === null) return;
    if (shownResult) u.searchParams.set("resultado", shownResult); else u.searchParams.delete("resultado");
    window.history.replaceState(window.history.state, "", u.toString());
  }, [shownResult, stage]);

  /*
   * FASE 61 · SALIR SE CONFIRMA. «Salir» (y el botón Atrás) abren el diálogo con la consecuencia real:
   *   · «Salir y guardar»: la partida sigue en el servidor y JUGAR ofrece «Continuar partida» (`getActiveMatch`);
   *   · «Abandonar»: `abandonDuel` la borra — no cuenta, no paga, sin penalización (`abandonMatch`);
   *   · draft: vuelve al gauntlet con el combate guardado (como hasta ahora).
   */
  const [leaving, setLeaving] = useState(false);
  const [leaveBusy, setLeaveBusy] = useState(false);
  const openLeave = useCallback(() => setLeaving(true), []);
  const stayInMatch = useCallback(() => { if (!leaveBusy) setLeaving(false); }, [leaveBusy]);
  useLeaveGuard((stage === "match" || stage === "intro") && Boolean(view) && view?.status === "IN_PROGRESS", openLeave);

  function keepAndLeave() {
    setLeaving(false);
    router.push(draftMode ? DRAFT_ROUTE : "/");
  }

  async function quit() {
    if (!view || leaveBusy) return;
    // Fase 39 · en el draft «Salir» vuelve al gauntlet: la partida sigue guardada; abandonar es cosa de la run.
    if (draftMode) { router.push(DRAFT_ROUTE); return; }
    setLeaveBusy(true);
    try { await abandonDuel(view.matchId); } catch { /* si ya no existe, da igual */ }
    setLeaveBusy(false);
    setLeaving(false);
    reset();
    setStage("prematch");
    await boot();
  }

  function reset() {
    window.clearTimeout(revealTimer.current);
    setView(null);
    setReveal(null);
    setSettling(false);
    setError(null);
    setRecovered(false);
  }

  /**
   * REVANCHA: mismo mazo, mismo rival, sin pasar por la pre-partida. El servidor crea otra partida.
   *
   * ───────────────── FASE 45 · POR QUÉ ESTO NO ES YA UN `reset()` Y UN `begin()` ─────────────────
   *
   * Encontrado JUGANDO, no leyendo: al pulsar «Revancha» la pantalla se quedaba EN NEGRO. Son dos fallos que
   * se manifestaban con el mismo síntoma y que se arreglan aquí:
   *
   *   1. `reset()` pone `view = null`, pero NO toca `stage`, que sigue valiendo `"result"`. Entre esa línea y la
   *      respuesta del servidor —dos viajes: `beginProgression()` y `startDuel()`— la pantalla de resultado se
   *      pintaba con una partida que ya no existía. Nada que enseñar: negro. Ahora el resultado ANTERIOR se queda
   *      en pantalla mientras se crea la partida nueva, y sólo se sustituye cuando `begin()` trae la vista buena.
   *      Se limpian igualmente la revelación, el error y la liquidación, que sí deben irse.
   *
   *   2. `begin()` empieza con `if (!id || inFlight.current) return;`. Si `deckId` era `null` la revancha no hacía
   *      NADA —ni empezaba, ni avisaba, ni volvía atrás— y el negro del punto 1 se quedaba para siempre. Ahora sin
   *      mazo se vuelve a la preparación y se recargan los mazos, que es de donde sale el mazo que falta.
   *
   * No cambia ni una regla del combate: es qué se pinta mientras el servidor contesta.
   */
  function rematch() {
    trackDuel("rematch");
    resetProgression();

    if (!deckId) {
      reset();
      setStage("prematch");
      void boot();
      return;
    }

    window.clearTimeout(revealTimer.current);
    setReveal(null);
    setSettling(false);
    setError(null);
    setRecovered(false);
    void begin(deckId, difficulty);
  }

  /** Cambiar de rival o de mazo: vuelve a la pre-partida con los mazos frescos. */
  function change() {
    // Fase 35 · en campaña el rival no se cambia aquí: se vuelve al mapa, con el nodo abierto.
    const nodeId = campaignNodeId ?? campaignMatchNode;
    if (nodeId) { router.push(campaignNodeHref(nodeId)); return; }
    reset();
    setStage("prematch");
    void boot();
  }

  if (stage === "loading") {
    return (
      <Arena>
        <Loading label="Preparando duelo…" />
      </Arena>
    );
  }
  if (fatal && !view) {
    return (
      <Arena>
        <ErrorState message={fatal} onRetry={boot} />
      </Arena>
    );
  }

  const rivalName = view ? (view.rivalLabel ?? DIFFICULTY_INFO[view.difficulty].label) : "";
  /* FASE 50 · el modo decide qué arena se monta (hoy todas son NEXUS Champions) y cómo se rotula la barra. */
  const arenaMode: ArenaMode = draftMode ? "draft" : campaignMatchNode || campaignNodeId ? "campaign" : "quick";

  /* Fase 35 · pre-partida y resultado del nodo. */
  const prematchNode = campaignNodeId && campaign ? findNodeView(campaign, campaignNodeId) : null;
  const campaignResult = (() => {
    if (!campaignMatchNode || !view || stage !== "result" || !campaign) return null;
    const node = findNodeView(campaign, campaignMatchNode);
    if (!node) return null;
    const settled = campaign.lastAttempt && campaign.lastAttempt.matchId === view.matchId ? campaign.lastAttempt : null;
    const chapter = chapterOf(campaign, node.id);
    const copy = resultCopy({
      outcome: settled?.result ?? null,
      firstClear: !!settled?.firstClear,
      wasCompleted: campaignWasCompleted,
      chapterClosed: settled?.firstClear && chapter?.complete ? chapter : null,
      campaignComplete: campaign.summary.complete,
      credits: settled?.firstClear ? node.firstClearCredits : 0,
      nodeName: node.name,
    });
    return <CampaignResultBanner copy={copy} node={node} next={settled?.result === "WIN" ? nextNodeAfter(campaign, node.id) : null} onRetrySync={() => void refreshCampaign()} />;
  })();

  /* Fase 39 · resultado del combate del draft, leído de la run liquidada por el servidor. */
  const draftResult = (() => {
    if (!draftMode || !view || stage !== "result") return null;
    const copy = draftResultCopy(draftSnap?.run ?? draftSnap?.lastRun ?? null, view.matchId);
    return (
      <DraftResultBanner
        copy={copy}
        onBack={() => router.push(DRAFT_ROUTE)}
        onRefresh={() => void fetchDraft().then(setDraftSnap).catch(() => undefined)}
      />
    );
  })();

  return (
    <Arena
      bar={
        (stage === "match" || stage === "intro") && view ? (
          <ArenaBar
            view={view}
            mode={arenaMode}
            rivalName={rivalName}
            onQuit={openLeave}
            onHelp={() => setHelp(true)}
          />
        ) : null
      }
    >
      <HelpSheet open={help} onClose={() => setHelp(false)} mode="PVE" />
      <LeaveMatchDialog
        open={leaving}
        consequence={leaveConsequence(arenaMode)}
        busy={leaveBusy}
        onStay={stayInMatch}
        onKeep={keepAndLeave}
        onAbandon={draftMode ? undefined : () => void quit()}
      />

      <AnimatePresence>
        {stage === "intro" && view && (
          <MatchIntro key="intro" view={view} rivalName={rivalName} onDone={introDone} mode={arenaMode} />
        )}
        {reveal && view && (
          <DuelMoment
            key={reveal.number}
            turn={reveal}
            yourCard={findCard(view, reveal.you.uid)}
            rivalCard={findCard(view, reveal.rival.uid)}
            totalTurns={view.totalTurns}
            onClose={closeReveal}
          />
        )}
        {/* FASE 45 · la partida termina con un golpe: VICTORIA/DERROTA/EMPATE y el marcador, antes del resultado. */}
        {complete && view?.result && (
          /* FASE 61 · si el marcador no decidió, primero el desempate en escena; después el golpe final. */
          tiebreak
            ? <TiebreakReveal key="tiebreak" result={view.result} onDone={tiebreakDone} />
            : <MatchComplete key="match-complete" result={view.result} onDone={() => setComplete(false)} />
        )}
      </AnimatePresence>

      {stage === "prematch" && campaignNodeId && (
        prematchNode ? (
          <CampaignPreMatch
            snapshot={campaign!}
            node={prematchNode}
            decks={decks}
            deckId={deckId}
            onDeck={setDeckId}
            onStart={() => void begin(deckId, difficulty)}
            busy={busy}
            error={error}
            onHelp={() => setHelp(true)}
            activeDeckId={activeDeckId}
          />
        ) : campaignFailed || campaign ? (
          <ErrorState message={campaign ? "Ese nodo no existe en Road to Champions." : "No se pudo leer Road to Champions."} onRetry={boot} />
        ) : (
          <Loading label="Leyendo Road to Champions…" />
        )
      )}

      {stage === "prematch" && draftMode && <Loading label="Volviendo al gauntlet…" />}

      {stage === "prematch" && !campaignNodeId && !draftMode && (
        <PreMatch
          decks={decks}
          deckId={deckId}
          onDeck={setDeckId}
          difficulty={difficulty}
          onDifficulty={setDifficulty}
          onStart={() => void begin(deckId, difficulty)}
          busy={busy}
          error={error}
          onHelp={() => setHelp(true)}
          activeDeckId={activeDeckId}
          intro={firstMatch ? <FirstMatchCoach onHelp={() => setHelp(true)} /> : null}
          showRules={rulesIntro.intro === "show"}
          onRulesShown={rulesIntro.markSeen}
        />
      )}

      {(stage === "match" || stage === "intro") && view && (
        <>
          {recovered && (
            <Recessed className="mb-3 flex items-center justify-between gap-3 border-l-2 border-l-drl-cyan px-3 py-2" role="status">
              <p className="text-caption text-ink-secondary">
                Partida recuperada desde el servidor: turno {Math.min(view.turn, view.totalTurns)} de {view.totalTurns}, marcador {view.scoreYou}–{view.scoreRival}.
              </p>
              <NxButton variant="ghost" size="sm" onClick={() => setRecovered(false)} aria-label="Cerrar aviso">✕</NxButton>
            </Recessed>
          )}
          {/* F63 · primera partida: la regla del papel (atacas / defiendes) la primera vez, ENCIMA del tablero, nunca sobre las cartas. */}
          {guidedMatch && !draftMode && stage === "match" && <FirstMatchHint view={view} />}
          <MatchBoard
            view={view}
            onPlay={play}
            busy={busy || settling || reveal !== null || stage === "intro"}
            revealing={reveal !== null || settling}
            error={error}
            onDismissError={() => setError(null)}
            arena={arenaMode}
            hudInTopBar
          />
        </>
      )}

      {/* FASE 50 · el resultado se enseña DENTRO del estadio, no sobre una página: el mismo recinto de la partida, ya en calma. */}
      {stage === "result" && view && <ArenaEnvironment variant={arenaMode} />}

      {/*
        PARTIDA RÁPIDA · resultado mínimo (veredicto, marcador, motivo, SEGUIR JUGANDO / VOLVER AL MENÚ PRINCIPAL). Solo si el
        servidor dice QUICK y la arena es la rápida; campaña, draft o un contexto desconocido siguen con el resultado completo.
        SEGUIR JUGANDO = `rematch()`: la misma creación canónica de partida rápida (mismo equipo y dificultad, cerrojo `inFlight`).
      */}
      {stage === "result" && view && isQuickMatchResult(view, arenaMode) && (
        <QuickMatchResult key={view.matchId} view={view} onContinue={rematch} />
      )}

      {stage === "result" && view && !isQuickMatchResult(view, arenaMode) && (
        <ResultScreen
          view={view}
          xp={xp}
          onPlayAgain={draftMode ? () => router.push(DRAFT_ROUTE) : rematch}
          playAgainLabel={draftMode ? "Volver al gauntlet" : undefined}
          mode={draftMode ? "DRAFT_GAUNTLET" : "PVE"}
          deckId={draftMode ? null : view.yourDeckId ?? null}
          // Fase 35 · en campaña el rival lo fija el nodo: la salida es «Volver al mapa», en el propio resultado.
          onChange={campaignMatchNode || draftMode ? undefined : change}
          onDecks={() => router.push("/duelos/mazos")}
          onReplay={() => router.push(`/duelos/replay/${view.matchId}`)}
          progress={draftMode || !progression.delta ? null : <PostMatchProgress delta={progression.delta} className="mt-3" />}
          extra={draftMode ? <><SeasonPostMatch matchId={view.matchId} className="mt-3" />{draftResult}<NextUpAfter context="draft" className="mt-3" /></> : <><SeasonPostMatch matchId={view.matchId} className="mt-3" />{campaignResult}{loopAfter?.onboarding?.active ? <OnboardingAfterMatch view={loopAfter.onboarding} /> : loopAfter && showFirstSessionComplete(loopAfter.journey) && <JourneyDiscovery items={discoveryItems(loopAfter)} className="mt-3" />}{!loopAfter?.onboarding?.active && <NextUpAfter context={campaignMatchNode ? "campaign" : "match"} className="mt-3" />}</>}
        />
      )}
    </Arena>
  );
}

/**
 * El marco de la arena. Ocupa el viewport entero y respeta las zonas seguras del móvil.
 *
 * FASE 8 · TODA LA ARENA RESPETA `prefers-reduced-motion`: `MotionConfig reducedMotion="user"`
 * aplica la preferencia a todo lo que hay debajo. Es reducir MOVIMIENTO, no información.
 */
function Arena({ children, bar }: { children: React.ReactNode; bar?: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
    <div
      className="flex min-h-screen flex-col"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {bar}
      {/* Más ancho que el resto del producto (1320): sin barra lateral, la arena puede usar el ancho. */}
      <div className="mx-auto w-full max-w-[1320px] flex-1 px-3 sm:px-6 py-[clamp(4px,1vh,16px)]">{children}</div>
    </div>
    </MotionConfig>
  );
}

/**
 * Cromo de la partida: modo, rival y dificultad, turno con la pista de los diez, fase, marcador,
 * ayuda, sonido, pantalla completa y cómo salir.
 *
 * FASE 50 · es el HUD de la NEXUS ARENA (`MatchTopBar`). Los controles siguen montándose AQUÍ, con
 * los mismos textos, tamaños y manejadores: la barra solo les da sitio. El marcador está aquí ADEMÁS
 * de en el tablero: al hacer scroll en móvil el del tablero se va.
 */
function ArenaBar({
  view, mode, rivalName, onQuit, onHelp, timer,
}: {
  view: DuelMatchView;
  /** F72.8 · el contador de la decisión en curso. */
  timer?: React.ReactNode;
  mode: ArenaMode;
  rivalName: string;
  onQuit: () => void;
  onHelp: () => void;
}) {
  return (
    <MatchTopBar
      view={view}
      mode={mode}
      rivalName={rivalName}
      difficultyLabel={DIFFICULTY_INFO[view.difficulty].label}
      timer={timer}
      controls={
        <>
          <button
            type="button"
            onClick={onHelp}
            aria-label="Cómo se juega"
            className="nx-focus grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/15 bg-black/40 font-display text-[15px] font-bold text-white/75 transition hover:bg-black/70 hover:text-white"
          >
            ?
          </button>
          <SoundToggle className="hidden sm:grid" />
          {/* Fase 22.2 (§20): pantalla completa real del navegador. Se oculta solo si la API no está. */}
          <FullscreenToggle />
          {/* `md`: a 390 la salida es el ÚNICO control de la arena que debe medir 44 px; es la única salida. */}
          <NxButton variant="ghost" size="md" className="shrink-0" onClick={onQuit}>
            Salir
          </NxButton>
        </>
      }
    />
  );
}

/**
 * Busca una carta en lo que la vista conoce. El rival solo aparece cuando ya jugó. DUEL GAMEPLAY UX 2.0 · la carta que
 * el rival comprometió y aún no se ha revelado NO está en la vista: solo se puede encontrar cuando ya es historia.
 */
function findCard(view: DuelMatchView, uid: string) {
  const all = [...view.yourHand, ...view.yourUsed, ...view.rivalUsed];
  return all.find((c) => c.uid === uid)!;
}
