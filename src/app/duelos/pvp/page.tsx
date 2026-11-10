"use client";

/**
 * `/duelos/pvp` — LA ARENA PvP (Bloque 7.5).
 *
 * Esta ruta era, hasta este bloque, una superficie de depuración del 7.3: montaba `usePvpSync`
 * sobre un `?match=<uuid>` y enseñaba números. Ahora es la pantalla de producto, y lo que hacía
 * antes sigue existiendo dentro —resumir una partida por su id— porque es exactamente el camino
 * de reconexión.
 *
 * ─────────────────────── LA MÁQUINA DE ESTADOS ES DEL SERVIDOR ───────────────────────
 *
 *   sin partida  →  usePvpQueue   (cola: elegir mazo, buscar, cancelar)
 *   con partida  →  usePvpSync    (partida: sincronizar, jugar, abandonar)
 *
 * Las dos NUNCA sondean a la vez: la cola se para sola en cuanto devuelve `MATCHED`, y solo
 * entonces se monta el poller de partida. Esa es la regla que impide el sondeo duplicado.
 *
 * La fase que se pinta se DERIVA del estado del servidor, no de una variable de pantalla:
 *
 *   ¿hay `matchId`?         → lo dice la cola (`entry.state === "MATCHED"`) o la URL.
 *   ¿la partida ha acabado? → lo dice `snapshot.lifecycle`, nunca la cuenta atrás local.
 *   ¿he ganado?             → lo dice `result.winner` comparado con `yourSide`, que da el servidor.
 *
 * ─────────────────────── RECONEXIÓN ───────────────────────
 *
 * No hay estado de partida en `localStorage`, ni falta. Al entrar se pregunta a la cola por el
 * estado del usuario; si su última entrada está `MATCHED`, ahí está el `matchId` y la pantalla
 * entra directa a la arena. Recargar, cerrar la pestaña o volver mañana dan lo mismo: la verdad
 * está en el servidor y se pide. El `?match=` de la URL sirve como atajo y como enlace directo.
 */
import { playerHref } from "@/lib/player/href";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabase } from "@/lib/supabase/client";
import { fetchDuelDecks } from "@/lib/duel/client";
import { usePvpSync } from "@/lib/duel/usePvpSync";
import { usePvpQueue } from "@/lib/duel/usePvpQueue";
import { autoSearchDecision } from "@/lib/duel/autoSearch";
import { isTerminal } from "@/domain/cardgame/pvp/lifecycle";
import type { PvpLifecycle } from "@/domain/cardgame/pvp/types";
import { buildMatchView } from "@/lib/duel/matchView";
import { trackDuel } from "@/lib/duel/telemetry";
import { useLadderPositionDelta, fetchCompetitiveMatchup, type CompetitiveMatchup } from "@/lib/competitive/client";
import { trackCompetitive } from "@/lib/competitive/telemetry";
import { CardRegistry } from "@/collection/registry";
import type { CombatStatKey, DuelDeckDTO } from "@/lib/duel/types";
import type { RatingEvent } from "@/domain/cardgame/rating";
import type { RankMovement } from "@/domain/ranked/standing";
import { PvpLobby } from "@/components/duel/pvp/PvpLobby";
import { PvpArena } from "@/components/duel/pvp/PvpArena";
import { PvpOutcome, type PvpVerdict } from "@/components/duel/pvp/PvpOutcome";
import { ArenaEnvironment } from "@/components/duel/arena/ArenaEnvironment";
import { positionDeltaFrom, savePositionDelta } from "@/lib/competitive/positionDelta";
import { RankedSearch } from "@/components/duel/pvp/RankedSearch";
import { useAuth } from "@/lib/supabase/auth";
import { RankedMatchFound } from "@/components/duel/pvp/RankedMatchFound";
import { Loading, ErrorState, NeedsAccount } from "@/components/ui/States";
import { fetchPrivateMatchInfo, createChallenge, announceSocialChange, type PrivateMatchInfo } from "@/lib/social/client";
import { awaitCupOutcome } from "@/lib/cups/outcome";
import { trackSocial } from "@/lib/social/telemetry";
import { ChallengeSheet } from "@/components/social/ChallengeSheet";
import { MatchEnding } from "@/components/duel/experience/MatchEnding";
import { NxButton } from "@/components/ui/NxButton";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("duelos");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const registry = new CardRegistry();

function Arena() {
  useLocale();
  const router = useRouter();
  const params = useSearchParams();
  const urlMatch = params.get("match");
  /** FASE 55 · `?buscar=<deckId>` viene de JUGAR COMPETITIVO: la arena entra en cola al llegar con ese mazo. */
  const buscar = params.get("buscar");

  const [cuenta, setCuenta] = useState<"checking" | "yes" | "no">("checking");
  const [decks, setDecks] = useState<DuelDeckDTO[]>([]);
  const [deckId, setDeckId] = useState<string | null>(null);
  /** FASE 32 · equipo activo: si es legal, es el que se propone para buscar rival. La cola vuelve a validar. */
  const [activeDeckId, setActiveDeckId] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [fallo, setFallo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ event: RatingEvent | null; rating: number | null; rank?: RankMovement | null }>({
    event: null, rating: null,
  });

  // `matchId` fijado a mano (por URL), que manda sobre el de la cola.
  const [fijado, setFijado] = useState<string | null>(UUID.test(urlMatch ?? "") ? urlMatch : null);
  /*
   * Partida que el jugador YA HA VISTO Y CERRADO.
   *
   * Hace falta porque la entrada de cola se queda en `MATCHED` apuntando a la partida terminada
   * —es su historia, y el servidor hace bien en conservarla—, así que sin esto «Buscar otro
   * rival» volvía a entrar en el mismo resultado una y otra vez: la pantalla no tenía forma de
   * decir «esa ya la he visto». Lo encontró la QA en navegador.
   *
   * Es memoria de PANTALLA, no de partida: no decide nada del juego y se pierde al recargar —y
   * debe perderse, porque al recargar sí quieres volver a ver en qué acabó.
   */
  const [visto, setVisto] = useState<string | null>(null);

  // ── Cuenta y mazos ──
  useEffect(() => {
    let vivo = true;
    void (async () => {
      const sb = getSupabase();
      if (!sb) { if (vivo) { setCuenta("no"); setCargando(false); } return; }
      const { data } = await sb.auth.getSession();
      if (!vivo) return;
      if (!data.session) { setCuenta("no"); setCargando(false); return; }
      setCuenta("yes");
      try {
        const d = await fetchDuelDecks();
        if (!vivo) return;
        setDecks(d.decks);
        setActiveDeckId(d.activeDeckId);
        setDeckId((cur) => cur ?? d.decks.find((x) => x.valid && x.id === d.activeDeckId)?.id ?? d.decks.find((x) => x.valid)?.id ?? null);
      } catch (e) {
        if (vivo) setFallo(e instanceof Error ? e.message : t("No se pudieron cargar tus equipos"));
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => { vivo = false; };
  }, []);

  /*
   * La cola solo sondea mientras NO hay partida. En cuanto `matchId` existe, `enabled` pasa a
   * falso, su bucle se desmonta y solo queda el de la partida.
   */
  const cola = usePvpQueue(cuenta === "yes" && fijado === null);
  /* RESULTADO ÚNICO · la cuenta de la sesión: el cambio de puesto se guarda SOLO para ella (sesión del navegador). */
  const { user: yo } = useAuth();
  const deLaCola = cola.matchId !== null && cola.matchId !== visto ? cola.matchId : null;
  const matchId = fijado ?? deLaCola;

  const { state, syncNow, play, abandon } = usePvpSync(matchId);
  const snap = state.snapshot;
  const lifecycle = snap?.lifecycle ?? null;
  // F76 · terminal = la definición canónica del dominio (la misma que aplica el servidor a la cola), no una copia local.
  const terminal = lifecycle !== null && isTerminal(lifecycle as PvpLifecycle);

  /*
   * FASE 61 · EL FINAL SE VE SI SE VIVIÓ. `enVivo` = la última partida que esta pantalla vio EN JUEGO. Si esa misma
   * partida pasa a terminada, se reproduce encima del resultado la secuencia de final (último turno → desempate →
   * golpe final, `MatchEnding`), una vez. Quien llega por URL o recarga sobre una partida ya terminada no la ve:
   * va directo al resultado. Memoria de pantalla, no de partida: no decide nada.
   */
  const [enVivo, setEnVivo] = useState<string | null>(null);
  const [finalVisto, setFinalVisto] = useState<string | null>(null);
  useEffect(() => { if (matchId && snap && !terminal) setEnVivo(matchId); }, [matchId, snap, terminal]);

  /*
   * F76 · F5 EN EL RESULTADO. La cola ya no presenta una partida terminada como «tu partida» (ese era el bug: días
   * después, /duelos/pvp seguía abriendo aquel resultado y nadie salía de él). Para que recargar JUSTO en el resultado lo
   * siga enseñando, la partida que llegó por la cola y acaba de terminar se fija en la URL (`?match=`, el mismo camino
   * que un enlace del historial). «Buscar otro rival» limpia la URL (`otra`). Tras un `await`, sin relojes (contrato 7.5).
   */
  useEffect(() => {
    if (!terminal || !matchId || fijado !== null || matchId !== deLaCola || urlMatch === matchId) return;
    void (async () => {
      await Promise.resolve();
      window.history.replaceState(window.history.state, "", `/duelos/pvp?match=${matchId}`);
    })();
  }, [terminal, matchId, fijado, deLaCola, urlMatch]);

  /*
   * FASE 29 · DUELO PRIVADO. El modo lo dice el snapshot del servidor (`mode`), nunca la URL.
   * Misma arena, mismo sondeo, misma reconexión; lo que cambia: no se pide el movimiento de
   * rating (no existe), no se fotografía la escalera, y al final se ofrecen las salidas sociales.
   * La identidad del rival y el cara a cara vienen de `GET /api/game/social?match=` (solo a sus
   * dos jugadores) UNA vez al entrar y otra al terminar, para enseñar el cara a cara actualizado.
   */
  const privada = snap?.mode === "PVP_PRIVATE";
  const [priv, setPriv] = useState<PrivateMatchInfo | null>(null);
  const privLeida = useRef<string | null>(null);
  useEffect(() => {
    if (!privada || !matchId) return;
    const clave = `${matchId}:${terminal ? "end" : "live"}`;
    if (privLeida.current === clave) return;
    privLeida.current = clave;
    let vivo = true;
    fetchPrivateMatchInfo(matchId).then((info) => { if (vivo && info) setPriv(info); }).catch(() => { /* la arena sigue; el rótulo se queda sin nombre */ });
    return () => { vivo = false; };
  }, [privada, matchId, terminal]);
  /* F86 · si este duelo es un CRUCE DE TORNEO (lo dice el servidor en `?match=`), el final no ofrece revancha: vuelve al cuadro. */
  const cupDeEsta = privada ? priv?.cup ?? null : null;
  /* F86.1 · terminado pero aún sin resultado del cuadro (liquidación en curso): la librería relee unas pocas veces. */
  const cupWaited = useRef<string | null>(null);
  useEffect(() => {
    if (!privada || !terminal || !matchId || !cupDeEsta || cupDeEsta.outcome !== null || cupWaited.current === matchId) return;
    cupWaited.current = matchId;
    let vivo = true;
    void awaitCupOutcome(matchId).then((info) => { if (vivo && info) setPriv(info); });
    return () => { vivo = false; };
  }, [privada, terminal, matchId, cupDeEsta]);
  const privCerrada = useRef<string | null>(null);
  useEffect(() => {
    // F86 · un cruce de torneo no es un duelo social: no cuenta en la telemetría de duelos privados.
    if (!privada || !priv || priv.cup || !terminal || !matchId || privCerrada.current === matchId) return;
    privCerrada.current = matchId;
    trackSocial("private_match_complete");
  }, [privada, priv, terminal, matchId]);

  /*
   * FASE 55 · RIVAL ENCONTRADO (ranked). Identidad PÚBLICA de los dos lados (`?matchup=`, solo a sus jugadores)
   * UNA vez por partida. Un duelo privado responde 404 (NOT_PVP) y se ignora: su rival llega por Social.
   */
  const [matchup, setMatchup] = useState<CompetitiveMatchup | null>(null);
  useEffect(() => {
    if (!matchId || privada || matchup?.matchId === matchId) return;
    let vivo = true;
    fetchCompetitiveMatchup(matchId).then((m) => { if (vivo && m) setMatchup(m); }).catch(() => { /* la arena sigue con «Rival» */ });
    return () => { vivo = false; };
  }, [matchId, privada, matchup?.matchId]);
  /** Partida recién emparejada cuya transición ya se enseñó (memoria de pantalla, no de partida). */
  const [presentada, setPresentada] = useState<string | null>(null);

  // Revancha = reto NUEVO con `previousMatchId`; el rival tiene que aceptarlo. Se elige mazo aquí.
  const [revancha, setRevancha] = useState(false);
  const [revanchaError, setRevanchaError] = useState<string | null>(null);
  const [revanchaEnviada, setRevanchaEnviada] = useState(false);
  const pedirRevancha = useCallback((deckIdElegido: string) => {
    if (!priv || !matchId || busy) return;
    setBusy(true); setRevanchaError(null);
    void createChallenge(priv.rival.userId, deckIdElegido, matchId)
      .then(() => { trackSocial("challenge_sent"); setRevancha(false); setRevanchaEnviada(true); announceSocialChange(); })
      .catch((e: unknown) => setRevanchaError(e instanceof Error ? e.message : t("No se pudo pedir la revancha")))
      .finally(() => setBusy(false));
  }, [priv, matchId, busy]);

  /*
   * Al terminar se pide UNA vez el movimiento de rating, con `outcome=1`. Si la liquidación aún
   * no ha corrido (son dos transacciones: deuda D-RAT-3), se reintenta en el siguiente sondeo en
   * vez de inventarse un número.
   */
  const pedido = useRef<string | null>(null);
  useEffect(() => {
    if (!terminal || !matchId) return;
    if (privada) return; // Fase 29: un duelo privado no tiene asiento de rating que pedir.
    if (pedido.current === matchId && outcome.event !== null) return;
    let vivo = true;
    void (async () => {
      try {
        const sb = getSupabase();
        const token = (await sb?.auth.getSession())?.data.session?.access_token;
        if (!token) return;
        const res = await fetch(`/api/game/duel/pvp?matchId=${matchId}&outcome=1`, {
          headers: { authorization: `Bearer ${token}` }, cache: "no-store",
        });
        if (!res.ok || !vivo) return;
        const body = await res.json();
        pedido.current = matchId;
        setOutcome({ event: body.outcome ?? null, rating: body.rating ?? null, rank: body.rank ?? null });
      } catch { /* el siguiente sondeo lo reintenta */ }
    })();
    return () => { vivo = false; };
  }, [terminal, matchId, state.stateVersion, outcome.event, privada]);

  /*
   * TELEMETRÍA (Fase 26): un momento por partida, nunca por sondeo. `reconnect` si la partida ya
   * tenía turnos al llegar (recarga, vuelta) o vino por URL; `match_start` si nace aquí. Y
   * `match_completed` cuando el servidor la nombra terminal.
   */
  const anunciada = useRef<string | null>(null);
  useEffect(() => {
    if (!matchId || !snap || anunciada.current === matchId) return;
    anunciada.current = matchId;
    trackDuel(snap.match.turns.length > 0 || fijado !== null ? "reconnect" : "match_start");
  }, [matchId, snap, fijado]);
  const cerrada = useRef<string | null>(null);
  useEffect(() => {
    if (!terminal || !matchId || cerrada.current === matchId) return;
    cerrada.current = matchId;
    trackDuel("match_completed");
  }, [terminal, matchId]);

  /*
   * FASE 28 · LA ESCALERA EN EL POST-PARTIDA. Foto de la posición al ENTRAR en la partida (antes
   * de que se liquide) y otra cuando llega el asiento de rating (`outcome.event`): el cambio de
   * puestos solo se enseña con las dos fotos; la posición actual, siempre que exista.
   */
  const ladder = useLadderPositionDelta();
  const { begin: beginLadder, end: endLadder, reset: resetLadder } = ladder;
  const fotografiada = useRef<string | null>(null);
  useEffect(() => {
    if (!matchId || !snap || terminal || fotografiada.current === matchId) return;
    if (snap.mode === "PVP_PRIVATE") return; // Fase 29: la escalera no se mueve en un duelo privado.
    fotografiada.current = matchId;
    void beginLadder();
  }, [matchId, snap, terminal, beginLadder]);
  const liquidada = useRef<string | null>(null);
  useEffect(() => {
    if (!terminal || !matchId || !outcome.event || liquidada.current === matchId) return;
    liquidada.current = matchId;
    // RESULTADO ÚNICO · el cambio de puestos ya no se pinta aquí: se deja en la SESIÓN, asociado a la partida, y lo
    // enseña el centro Competitivo una vez. Sin las dos fotos no se guarda nada.
    const id = matchId, cuenta = yo?.id ?? null;
    void endLadder().then((d) => savePositionDelta(cuenta, id, positionDeltaFrom(d)));
  }, [terminal, matchId, outcome.event, endLadder, yo?.id]);

  // ── Acciones ──
  /*
   * F66 · cerrojo SÍNCRONO de acción. `busy` es estado de React: dos eventos del mismo tick (doble clic, Enter+clic)
   * leen el mismo `busy=false` antes del re-render. El ref se cierra en el acto. El servidor ya rechaza la segunda
   * (versión), pero así ni siquiera sale la petición.
   */
  const actionLock = useRef(false);
  const onPlay = useCallback((cardUid: string, stat?: CombatStatKey) => {
    if (busy || actionLock.current) return;
    actionLock.current = true;
    setBusy(true); setErrorAccion(null);
    /*
     * `actionId` NUEVO por cada gesto del jugador. Es la clave de idempotencia del bloque 7.2: si
     * la respuesta se pierde por red, reenviar ESA misma acción no la aplica dos veces. Se genera
     * una por clic —no una por reintento automático— porque dos clics son dos decisiones.
     *
     * `expectedVersion` es la versión que el jugador está viendo. Si el estado avanzó por debajo,
     * el servidor rechaza con `STALE_VERSION` y aquí se sincroniza en vez de pisar nada.
     */
    void play({ actionId: crypto.randomUUID(), expectedVersion: state.stateVersion, cardUid, stat })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : t("No se pudo jugar");
        /*
         * `STALE_VERSION` significa que el estado avanzó por debajo. No es un error del jugador
         * y no se reintenta sola: se sincroniza y se le dice qué pasó, que es lo honesto.
         */
        setErrorAccion(/stale|cambió/i.test(msg) ? t("La partida avanzó mientras decidías. Vuelve a intentarlo.") : msg);
        syncNow();
      })
      .finally(() => { actionLock.current = false; setBusy(false); });
  }, [busy, play, syncNow, state.stateVersion]);

  const onAbandon = useCallback(() => {
    if (busy || actionLock.current) return;
    actionLock.current = true;
    setBusy(true); setErrorAccion(null);
    // No se navega ni se asume nada: se espera a que el servidor confirme el cierre.
    void abandon()
      .catch((e: unknown) => setErrorAccion(e instanceof Error ? e.message : t("No se pudo abandonar")))
      .finally(() => { actionLock.current = false; setBusy(false); });
  }, [busy, abandon]);

  const onSearch = useCallback(() => {
    if (!deckId) return;
    setBusy(true);
    trackCompetitive("queue_start");
    void cola.enqueue(deckId).finally(() => setBusy(false));
  }, [cola, deckId]);

  /*
   * FASE 55 · ENTRADA DIRECTA EN COLA desde `/competitivo`. Espera a la primera foto de la cola (para no encolar a
   * quien ya está buscando o jugando) y a los mazos; si el mazo pedido es legal, encola UNA vez y limpia la URL
   * (recargar no vuelve a encolar: la cola ya dice `QUEUED`). El servidor revalida el mazo igualmente.
   */
  const autoBuscada = useRef(false);
  useEffect(() => {
    if (autoBuscada.current || !buscar || !UUID.test(buscar) || fijado !== null || cuenta !== "yes" || cargando) return;
    if (cola.view === null && cola.phase !== "error") return;
    autoBuscada.current = true;
    const pedido = decks.find((d) => d.id === buscar) ?? null;
    if (pedido) setDeckId(pedido.id);
    const matchedId = cola.phase === "matched" ? cola.matchId : null;
    void (async () => {
      /*
       * F66 · la orden `?buscar=` se consume UNA vez. `router.replace` dentro de este efecto no llegaba a limpiar la URL
       * (medido: seguía ahí 12 s después), así que CADA recarga —también en la pantalla de resultado— volvía a encolar al
       * jugador. Se limpia con `history.replaceState` (el App Router lo sincroniza con `useSearchParams`) FUERA del commit
       * en curso —tras un `await`, sin temporizadores: la página no tiene relojes (contrato 7.5)—. Comprobado en navegador.
       */
      await Promise.resolve();
      window.history.replaceState(window.history.state, "", "/duelos/pvp");
      /*
       * F66 · antes de dar una entrada MATCHED por «partida anterior», se pregunta al servidor si esa partida SIGUE.
       * Si sigue (F5 justo al emparejar), se retoma; solo si terminó se marca vista y se busca otra.
       */
      let lifecycle: string | null = null;
      if (matchedId) {
        try {
          const token = (await getSupabase()?.auth.getSession())?.data.session?.access_token;
          const res = token ? await fetch(`/api/game/duel/pvp?matchId=${matchedId}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" }) : null;
          lifecycle = res?.ok ? ((await res.json())?.snapshot?.lifecycle ?? null) : null;
        } catch { lifecycle = null; }
      }
      const action = autoSearchDecision({ phase: cola.phase, deckValid: !!pedido?.valid, matchedLifecycle: lifecycle });
      if ((action === "requeue" || action === "enqueue") && pedido) {
        if (action === "requeue" && matchedId) setVisto(matchedId);
        setBusy(true);
        trackCompetitive("queue_start");
        void cola.enqueue(pedido.id).finally(() => setBusy(false));
      }
    })();
  }, [buscar, fijado, cuenta, cargando, cola, decks]);

  const onCancel = useCallback(() => {
    setBusy(true);
    trackCompetitive("queue_cancel");
    void cola.cancel().finally(() => setBusy(false));
  }, [cola]);

  /** Volver a buscar: se suelta la partida terminada y la cola vuelve a la antesala. */
  const otra = useCallback(() => {
    if (matchId) setVisto(matchId);
    setFijado(null);
    setOutcome({ event: null, rating: null });
    pedido.current = null;
    resetLadder(); // Fase 28: la foto de la escalera era de la partida anterior.
    if (urlMatch) router.replace("/duelos/pvp");
    cola.refresh();
  }, [cola, router, urlMatch, matchId, resetLadder]);

  /**
   * FASE 55 · «Buscar otro rival» en ranked vuelve a la cola DIRECTAMENTE con el mismo mazo (el de la entrada de
   * cola, que el servidor validó). Sin mazo conocido, cae a la antesala para elegir.
   */
  const otraRanked = useCallback(() => {
    const mazo = cola.view?.entry?.deckId ?? deckId;
    otra();
    setMatchup(null);
    if (!mazo || !decks.some((d) => d.id === mazo && d.valid)) return;
    setDeckId(mazo);
    setBusy(true);
    trackCompetitive("queue_start");
    void cola.enqueue(mazo).finally(() => setBusy(false));
  }, [cola, deckId, decks, otra]);

  // ── Veredicto: lo dice el servidor ──
  const view = useMemo(() => {
    if (!snap) return null;
    return buildMatchView(snap.match, { side: snap.yourSide, registry, difficulty: "NORMAL", rivalLabel: t("Rival") });
  }, [snap]);

  const verdict: PvpVerdict | null = useMemo(() => {
    if (!snap || !terminal) return null;
    // Cierre de SESIÓN (abandono o tiempo): pierde quien lo provocó, y eso lo sabe el servidor
    // por `closedBy`… que no viaja al cliente. Lo que sí viaja es el resultado del motor.
    const r = view?.result;
    if (r) return r.isDraw ? "DRAW" : r.winner === "YOU" ? "WIN" : "LOSS";
    /*
     * Fase 29 · duelo privado cerrado por abandono o tiempo: no habrá asiento de rating, pero el
     * snapshot trae quién lo cerró como BANDO (`closedBySide`, nunca un id). Pierde quien cerró.
     */
    if (snap.mode === "PVP_PRIVATE" && snap.closedBySide) return snap.closedBySide === snap.yourSide ? "LOSS" : "WIN";
    /*
     * Sin `result` del motor (abandono o vencimiento a mitad de partida) el veredicto no se puede
     * deducir del estado de juego. Se pide al servidor a través del movimiento de rating, que es
     * la autoridad de quién ganó: `outcome.result` ya dice WIN/LOSS/DRAW.
     */
    if (outcome.event) return outcome.event.result;
    return null;
  }, [snap, terminal, view, outcome.event]);

  // ── Render ──
  if (cuenta === "checking" || cargando) return <Loading label={t("Preparando el duelo…")} />;
  if (cuenta === "no") return <NeedsAccount what={t("los duelos PvP")} />;
  /* F61 · la ruta es inmersiva (sin armazón): los estados sin salida propia llevan la suya. */
  if (fallo) return <><ExitLink href="/competitivo" label={t("Volver a Competitivo")} /><ErrorState message={td(fallo)} onRetry={() => location.reload()} /></>;

  if (terminal && verdict) {
    return (
      <>
        {matchId && enVivo === matchId && finalVisto !== matchId && view?.result && (
          <MatchEnding view={view} onDone={() => setFinalVisto(matchId)} />
        )}
        {/* RESULTADO ÚNICO · el mismo estadio de fondo que el resultado de los duelos contra la IA. */}
        <ArenaEnvironment variant="ranked" />
        <PvpOutcome
          verdict={verdict}
          lifecycle={lifecycle!}
          view={view}
          outcome={outcome.event}
          onAgain={privada ? otra : otraRanked}
          onBack={() => router.push(cupDeEsta ? `/copas/${cupDeEsta.slug}` : privada ? "/duelos" : "/competitivo")}
          cupMatch={cupDeEsta ? { name: cupDeEsta.name, roundName: cupDeEsta.roundName, href: `/copas/${cupDeEsta.slug}`, outcome: cupDeEsta.outcome, nextRoundName: cupDeEsta.nextRoundName } : null}
          privateDuel={privada && !cupDeEsta ? {
            rival: priv?.rival ?? null,
            h2h: priv?.h2h ?? null,
            busy: busy || revanchaEnviada,
            onRematch: () => { setRevanchaError(null); setRevancha(true); },
            onSocial: () => router.push("/social"),
            onProfile: () => { if (priv) router.push(playerHref(priv.rival.userId)); },
            onOtherChallenge: () => router.push("/social?tab=amigos"),
          } : null}
        />
        {privada && !cupDeEsta && revanchaEnviada && (
          <p role="status" className="mx-auto mt-3 w-full max-w-2xl px-4 text-center text-caption text-drl-cyan" data-testid="rematch-sent">
            {t("Revancha pedida: tu rival recibe el aviso. Si la acepta, entraréis los dos en la partida.")}
          </p>
        )}
        {privada && !cupDeEsta && (
          <ChallengeSheet
            open={revancha}
            mode="send"
            rematch
            target={priv?.rival ?? null}
            decks={decks}
            busy={busy}
            error={td(revanchaError)}
            onConfirm={pedirRevancha}
            onClose={() => { if (!busy) setRevancha(false); }}
          />
        )}
      </>
    );
  }

  /*
   * FASE 55 · RIVAL ENCONTRADO: solo para una partida que ACABA de salir de la cola (no por URL, no reconexión con
   * turnos jugados, no privada). Breve; la arena ya se sincroniza por debajo.
   */
  const recienEmparejada = deLaCola !== null && fijado === null && presentada !== deLaCola && !terminal
    && (!snap || (snap.match.turns.length === 0 && snap.mode !== "PVP_PRIVATE"));
  if (recienEmparejada) {
    const mazo = decks.find((d) => d.id === cola.view?.entry?.deckId) ?? null;
    return <RankedMatchFound matchup={matchup?.matchId === deLaCola ? matchup : null} deckName={mazo?.name ?? null} onDone={() => setPresentada(deLaCola)} />;
  }

  if (matchId && snap) {
    return (
      <div className="mx-auto w-full max-w-6xl px-2 py-3 sm:px-4">
        <PvpArena
          state={state}
          busy={busy}
          error={td(errorAccion)}
          onPlay={onPlay}
          onAbandon={onAbandon}
          onDismissError={() => setErrorAccion(null)}
          mode={snap.mode ?? "PVP"}
          rival={privada ? priv?.rival ?? null : matchup && matchup.matchId === matchId ? matchup.rival : null}
          skipIntro={!privada && presentada === matchId}
        />
      </div>
    );
  }

  /* Fase 28 · «Rival encontrado» cuando la partida acaba de nacer en la cola; «Recuperando» al volver por URL. */
  if (matchId && !snap) {
    return fijado
      ? <Loading label={t("Recuperando la partida…")} />
      : <Loading label={t("Rival encontrado · preparando la arena…")} />;
  }

  // FASE 55 · buscando: la pantalla de cola ranked (verdad del emparejador: humanos, ventana por rating, caducidad).
  if (cola.phase === "queued") {
    const mazo = decks.find((d) => d.id === cola.view?.entry?.deckId) ?? decks.find((d) => d.id === deckId) ?? null;
    return (
      <RankedSearch
        waitingSeconds={cola.waitingSeconds}
        position={cola.view?.position ?? null}
        rating={cola.view?.rating ?? null}
        deckName={mazo?.name ?? null}
        busy={busy}
        onCancel={onCancel}
      />
    );
  }

  return (
    <>
      <ExitLink href="/competitivo" label={t("Volver a Competitivo")} />
      <PvpLobby
        decks={decks}
        deckId={deckId}
        onDeck={setDeckId}
        onSearch={onSearch}
        onCancel={onCancel}
        onDecks={() => router.push("/duelos/mazos")}
        activeDeckId={activeDeckId}
        searching={false /* Fase 55: buscando se pinta con <RankedSearch> (arriba) */}
        waitingSeconds={cola.waitingSeconds}
        position={cola.view?.position ?? null}
        rating={cola.view?.rating ?? null}
        busy={busy || cola.phase === "loading"}
      />
      {cola.error && (
        <div className="mx-auto mt-3 w-full max-w-2xl px-4">
          <ErrorState message={td(cola.error)} onRetry={cola.refresh} />
        </div>
      )}
    </>
  );
}

/** F61 · salida de las pantallas de la ruta inmersiva que no traen una (antesala, error). */
function ExitLink({ href, label }: { href: string; label: string }) {
  useLocale();
  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-4">
      <NxButton variant="ghost" size="md" href={href} data-testid="pvp-exit">← {td(label)}</NxButton>
    </div>
  );
}

export default function PvpPage() {
  useLocale();
  return (
    <Suspense fallback={<Loading label={t("Cargando…")} />}>
      <ArenaPorPartida />
    </Suspense>
  );
}

/**
 * F85 · una partida NUEVA por URL monta una arena NUEVA. Aceptar una revancha desde la pantalla de resultado navega a
 * `/duelos/pvp?match=<nueva>` sin salir de la ruta: el App Router conserva el componente y `fijado` (que se lee al
 * montar) seguía apuntando a la partida terminada. Solo cambia la llave con OTRO id de partida; quitar `?match=` de la
 * URL («buscar otro rival», `?buscar=`) no remonta nada (la memoria de pantalla `visto` se conserva).
 */
function ArenaPorPartida() {
  const m = useSearchParams().get("match");
  const nueva = m && UUID.test(m) ? m : null;
  const [llave, setLlave] = useState<string | null>(nueva);
  if (nueva && nueva !== llave) setLlave(nueva);
  return <Arena key={llave ?? "sala"} />;
}
