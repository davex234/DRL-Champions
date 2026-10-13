"use client";

/**
 * `/entrenador/partido` — un PARTIDO como una producción profesional de esports.
 *
 * (Fase 9H) Esta pantalla ERA `/entrenador`. Se ha movido un nivel para que la raíz sea el
 * centro de mando —equipos, mapas, pizarra y partido— en vez de saltar directamente al
 * simulador. Su contenido no cambia: es la misma producción de las fases anteriores.
 *
 * Cuatro modos: PREPARACIÓN (sala táctica), RONDA (broadcast a pantalla casi completa
 * con HUD VCT + deck de control minimizado), INTERRUPCIÓN (micro/timeout devuelven el
 * foco al entrenador) y FINAL (ceremonia). Solo CONECTA y PRESENTA los motores
 * existentes vía `useCoachMatch`. No toca ninguna lógica de juego.
 */
import Link from "next/link";
import { useCoachMatch } from "@/components/sim/useCoachMatch";
import { MatchSetup } from "@/components/sim/MatchSetup";
import { MatchCeremony, CeremonyActions, type RegistroFinal } from "@/components/coach/MatchCeremony";
import { CoachTacticalPanel } from "@/components/coach/CoachTacticalPanel";
import { BuyPhasePanel } from "@/components/coach/BuyPhasePanel";
import { MicroDecisionPrompt, RoundEndBriefing } from "@/components/coach/CoachOverlays";
import { CoachCommandDeck } from "@/components/coach/CoachCommandDeck";
import { LivePlayerStrip } from "@/components/coach/LivePlayerStrip";
import { LiveReadsTicker } from "@/components/coach/LiveReadsTicker";
import { TimeoutDossierPanel } from "@/components/coach/TimeoutDossierPanel";
import { RoundBriefingPanel } from "@/components/coach/RoundBriefingPanel";
import { SpecialMomentBanner } from "@/components/coach/SpecialMomentBanner";
import { liveCoachReads } from "@/lib/match/coachLive";
import { detectSpecialMoments } from "@/lib/match/special";
import { BrainDebugPanel } from "@/components/sim/BrainDebugPanel";
import { Suspense, useState, useEffect, useRef, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useCareerStore } from "@/store/useCareerStore";
import { BroadcastOverlay } from "@/components/broadcast/BroadcastOverlay";
import { buildBroadcastState, buildMatchIntro, buildLivePresentation, buildPostMatch, postMatchCasters } from "@/broadcast";
import { MatchIntro } from "@/components/broadcast/MatchIntro";
import { CasterFeed } from "@/components/broadcast/CasterFeed";
import { LiveStatsPanel } from "@/components/broadcast/LiveStatsPanel";
import { ObserverTag } from "@/components/broadcast/ObserverTag";
import { PostMatchShow } from "@/components/broadcast/PostMatchShow";
import { buildRenderFrame } from "@/visualizer";
import { MapMatchBoard } from "@/components/coach/MapMatchBoard";
import { isMatchMapId, requireMatchMap } from "@/domain/tactics/matchMap";
import { MapThumb } from "@/components/tactics/MapThumb";
import { AgentLineup } from "@/components/agents/AgentArt";
import { TeamCardStrip } from "@/components/coach/roster/TeamRosterEditor";
import { fetchCompositions } from "@/lib/tactics/client";
import type { Composition } from "@/domain/tactics/composition";
import { cardViews } from "@/lib/match/cardView";
import type { Side } from "@/sim";
import { matchBroadcastContext, makeMatchConfig } from "@/match";
import { economyBroadcastContext } from "@/economy";
import { coachBroadcastContext } from "@/coach";
import { prepBroadcastContext } from "@/preparation";
import { loadoutBroadcastContext } from "@/buy";
import { useGameStore } from "@/store/useGameStore";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { useTeamStore, resolveCardRef } from "@/store/useTeamStore";
import { validateTeam } from "@/domain/teams/types";
import { buildHomeRoster, buildRivalRoster, buildDefaultHomeRoster, type RivalDifficulty } from "@/lib/match/roster";
import { isDifficulty, DEFAULT_DIFFICULTY } from "@/domain/tactics/quickPlay";
import { drawSide } from "@/lib/match/sideDraw";
import { registrarPartidoJugado } from "@/lib/match/history";
import type { ManualCoachInput, CoachDecision } from "@/coach";
import type { BuyTier } from "@/economy";
import { ImmersiveStage } from "@/components/layout/ImmersiveStage";
import { MatchHUD, PrimaryAction } from "@/components/coach/MatchHUD";
import { RoundOutcome } from "@/components/coach/RoundOutcome";
import { primeAudio, playCue } from "@/lib/sound";
import { cn } from "@/lib/format";
import { CoachHeader } from "@/components/coach/tc/CoachFrame";
import { CoachIcon } from "@/components/coach/tc/CoachIcons";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const tr = ns("entrenador");

const SPEEDS = [1, 2, 4, 8];
/*
 * FASE 51.1 · El campo ya no lo pinta el backend SVG del visualizador (rejilla + muros + rótulos del
 * modelo de simulación: un mapa inventado). Lo pinta `MapMatchBoard` sobre el asset canónico.
 */
/**
 * El plan que se confirma cuando el entrenador no ha tocado ningún dial.
 *
 * Es la recomendación del motor tal cual, con el mismo foco de utilidad con el que nace el
 * panel (`entry`). No inventa nada: replica el estado inicial que ya se ve en pantalla, para
 * que pulsar el pie sin haber tocado nada haga exactamente lo que el panel enseña.
 */
const planPorDefecto = (prep: { recommendation: CoachDecision }): ManualCoachInput => ({
  concept: prep.recommendation.concept,
  tempo: prep.recommendation.tempo,
  aggression: prep.recommendation.aggression,
  riskLevel: prep.recommendation.riskLevel,
  primaryObjective: prep.recommendation.primaryObjective,
  mapPriority: prep.recommendation.mapPriority,
  utility: "entry",
});

const RIVAL_NAME: Record<RivalDifficulty, string> = { easy: "Rival (Fácil)", normal: "Rival (Normal)", hard: "Rival (Difícil)" };

/** `useSearchParams` necesita su frontera de Suspense o `next build` aborta el prerender. */
export default function EntrenadorPage() {
  return (
    <Suspense fallback={null}>
      {/* F81.2 · la plantilla sale de la colección del store: solo cuando es la de esta cuenta (o la demo de un visitante). */}
      <HydrationGate><DirigirPartido /></HydrationGate>
    </Suspense>
  );
}

/** Nombre del equipo por defecto (sin plantilla válida). FASE 51.3. */
const DEFAULT_TEAM_NAME = "Equipo NEXUS";
/** Duración de la revelación del mapa. FASE 51.3. */
const MAP_REVEAL_MS = { normal: 1600, reduced: 500 } as const;

function DirigirPartido() {
  useLocale();
  /*
   * FASE 51.1 · EL MAPA LLEGA ELEGIDO desde JUGAR (`?map=`). Solo se acepta un id del catálogo
   * canónico: uno desconocido NO cae en un mapa genérico, se dice y se ofrece elegir otro.
   */
  const params = useSearchParams();
  const mapParam = params.get("map");
  const compParam = params.get("comp");
  const mapaElegido = isMatchMapId(mapParam) ? requireMatchMap(mapParam) : null;
  /*
   * FASE 51.3 · JUGAR ES INMEDIATO. `?auto=1` llega del botón JUGAR PARTIDA: sin pre-partido ni
   * intro — se revela el mapa (breve) y el partido arranca solo. `?dif=` = dificultad del rival
   * (una desconocida cae en el default, «normal»). Sin `auto` se ve el pre-partido de siempre.
   */
  const auto = params.get("auto") === "1";
  const difParam = params.get("dif");
  const difInicial: RivalDifficulty = isDifficulty(difParam) ? difParam : DEFAULT_DIFFICULTY;
  const loop = useCoachMatch();
  const { phase, snap, view, match } = loop;
  const [brainDebug, setBrainDebug] = useState(false);
  const [brainSel, setBrainSel] = useState<string | null>(null);
  const [showIntro, setShowIntro] = useState(false);
  /*
   * ─────────────── EL PLAN Y LA COMPRA VIVEN AQUÍ, NO EN SUS PANELES ───────────────
   *
   * La orden de avanzar está anclada al pie del escenario para que nunca haya que bajar a
   * buscarla. Pero una orden que confirmara «lo recomendado» mientras el panel enseña otra
   * cosa sería peor que el problema que arregla: el entrenador ajustaría el plan y el partido
   * jugaría otro. Así que los paneles publican su selección hacia arriba y el pie confirma
   * exactamente lo que se está viendo.
   */
  const [prepInput, setPrepInput] = useState<ManualCoachInput | null>(null);
  const [buyTier, setBuyTier] = useState<BuyTier | null>(null);
  /** El cajón de dirección durante la ronda. Cerrado por defecto: el mapa manda. */
  const [panel, setPanel] = useState(false);

  const ownedCards = useGameStore((s) => s.ownedCards);
  const teams = useTeamStore((s) => s.teams);
  const activeTeamId = useTeamStore((s) => s.activeTeamId);
  const markUsed = useTeamStore((s) => s.markUsed);

  const active = teams.find((t) => t.id === activeTeamId) ?? null;
  const ready = active != null && validateTeam(active, resolveCardRef).length === 0;

  /**
   * La dificultad con la que se lanzó ESTE partido.
   *
   * Se recuerda porque el historial la guarda y `MatchState` no la lleva: el motor recibe el
   * rival ya construido, no el nivel con el que se construyó. Deducirla del nombre del rival
   * sería adivinar a partir de un texto de presentación.
   */
  const [difficulty, setDifficulty] = useState<RivalDifficulty>("normal");
  /** Qué ha pasado con el registro del partido terminado. Lo enseña el pie del final. */
  const [registro, setRegistro] = useState<RegistroFinal>("enviando");

  /*
   * AL TERMINAR EL PARTIDO, dos cosas, y una sola vez.
   *
   *   1. El desarrollo de los jugadores (Player Development), como hasta ahora.
   *   2. El REGISTRO del partido en el historial — lo que faltaba.
   *
   * `processedRef` guarda el `match` ya procesado, así que un re-render no repite nada. Y aun
   * si lo repitiera —o si el jugador recarga la pantalla final— el registro es idempotente por
   * la semilla del partido: el servidor devuelve el que ya había en vez de crear otro.
   */
  const processedRef = useRef<unknown>(null);
  useEffect(() => {
    if (phase === "ended" && match && processedRef.current !== match) {
      processedRef.current = match;
      useCareerStore.getState().processMatch(match);
      // No se espera: la ceremonia se pinta ya. El resultado del registro llega después y
      // lo dice el pie —«consta», «ya constaba», «sin sesión» o «ha fallado, reintentar»—.
      setRegistro("enviando");
      void registrarPartidoJugado(match, difficulty).then((r) => {
        if (processedRef.current === match) setRegistro(r);
      });
    }
  }, [phase, match, difficulty]);

  /** Reintentar es seguro: la ruta es idempotente por la semilla del partido. */
  const reintentarRegistro = () => {
    if (!match) return;
    setRegistro("enviando");
    void registrarPartidoJugado(match, difficulty).then((r) => {
      if (processedRef.current === match) setRegistro(r);
    });
  };

  /*
   * FASE 51.3 · la plantilla NO es requisito: con una válida se juega con sus cartas (y sus stats);
   * sin ella —o incompleta— con el equipo por defecto (jugadores reales, mismo generador que el rival).
   * Solo el mapa es obligatorio, y llega validado por la URL.
   */
  const [homeFromTeam, setHomeFromTeam] = useState(false);
  const play = (side: Side, difficulty: RivalDifficulty, conIntro = true) => {
    if (!mapaElegido) return;
    primeAudio();
    setDifficulty(difficulty);
    const seed = ((Date.now() & 0x7fffffff) ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
    const conEquipo = ready && active != null;
    const { roster: home, playerIds } = conEquipo ? buildHomeRoster(active.starters, ownedCards) : buildDefaultHomeRoster((seed ^ 0x5bd1e995) >>> 0);
    const away = buildRivalRoster((seed ^ 0x9e3779b9) >>> 0, playerIds, difficulty);
    // PLAYER DEVELOPMENT: inyecta la progresión persistida (deltas + química) en los
    // rosters. El sim consume los valores evolucionados sin cambios.
    const career = useCareerStore.getState();
    const config = makeMatchConfig({
      seed, rosters: { home: career.developRoster(home), away: career.developRoster(away) },
      homeSetup: { side, approach: "default", tempo: "mid", aggression: "balanced" },
      teamNames: { home: conEquipo ? active.name : DEFAULT_TEAM_NAME, away: RIVAL_NAME[difficulty] },
      mapId: mapaElegido.id,
      coach: { mode: "ai" },
      useEconomyTactics: true,
    });
    if (conEquipo) markUsed(active.id);
    setHomeFromTeam(conEquipo);
    setShowIntro(conIntro);   // INTRO de "gran final" antes del primer saque (no en el inicio rápido)
    loop.start(config);
  };

  /* Inicio rápido: una sola vez por visita (abandonar vuelve al pre-partido, no relanza). */
  const autoRef = useRef(false);
  const lanzarAuto = () => {
    if (autoRef.current || !mapaElegido) return;
    autoRef.current = true;
    play(drawSide(), difInicial, false);
  };

  /* El mapa DEL PARTIDO en curso (validado al lanzarlo); si no, el elegido para lanzarlo. */
  const mapaPartido = isMatchMapId(match?.config.mapId) ? requireMatchMap(match?.config.mapId) : mapaElegido;
  const nombreMapa = mapaPartido?.name ?? "";

  /* Titulares del equipo activo: nombre → imagen de SU carta (para las fichas vivas). */
  const cartasPorNombre = useMemo(() => {
    const m: Record<string, string> = {};
    if (!active || !homeFromTeam) return m;
    const set = new Set(active.starters);
    for (const c of cardViews(ownedCards)) if (set.has(c.uid)) m[c.nick.toLowerCase()] = c.art;
    return m;
  }, [active, ownedCards, homeFromTeam]);

  // Retransmisión: datos REALES del partido.
  const bsBase = snap && view && match ? buildBroadcastState({
    state: snap, decision: view.decision, viewport: view.vp,
    match: matchBroadcastContext(match),
    economy: match.economy ? economyBroadcastContext(match.economy, match.currentHomeSide) : undefined,
    prep: match.currentDecision ? coachBroadcastContext(match.currentDecision)
      : match.currentPlan ? prepBroadcastContext(match.currentPlan) : undefined,
    loadout: match.currentLoadouts ? loadoutBroadcastContext(match.currentLoadouts, match.currentHomeSide) : undefined,
  }) : null;
  // El broadcast nombra el mapa del modelo («Ascent»); se presenta con el mapa canónico del partido.
  const bs = bsBase && nombreMapa ? { ...bsBase, match: { ...bsBase.match, map: nombreMapa } } : bsBase;
  const frame = snap && view ? buildRenderFrame({ state: snap, viewport: view.vp, broadcast: bs }) : null;

  const homeSide = match?.currentHomeSide ?? "ATK";
  const tn = match?.config.teamNames ?? { home: tr("Local"), away: tr("Rival") };
  const names = {
    atk: homeSide === "ATK" ? tn.home : tn.away,
    def: homeSide === "ATK" ? tn.away : tn.home,
  };
  const creditsByName: Record<string, number> = {};
  if (match?.economy) Object.assign(creditsByName, match.economy.home.players, match.economy.away.players);

  // MATCH PRESENTATION ENGINE: presentación viva (casters/stats/observer) + intro + post.
  const live = bs && snap && match ? buildLivePresentation(snap, bs, match, names) : null;
  const introBase = match ? buildMatchIntro(match) : null;
  const intro = introBase && nombreMapa ? { ...introBase, map: nombreMapa } : introBase;

  const showField = (phase === "playing" || phase === "roundEnd") && frame;

  /*
   * ─────────────────────── LA FRANJA DE ESTADO, UNA SOLA VEZ ───────────────────────
   *
   * El HUD es el mismo en los cuatro estados del partido: cambia el rótulo, no la pieza. Que
   * el marcador y la ronda estén SIEMPRE en el mismo sitio es lo que hace que la sala
   * táctica, la compra, la ronda y el fin de ronda se lean como un partido y no como cuatro
   * pantallas distintas.
   */
  const hud = (state: string, aside?: React.ReactNode) => (
    <MatchHUD
      round={match?.roundNumber ?? 1}
      /*
       * En el fin de ronda manda el marcador de `roundEnd`, que ya lleva la ronda aplicada.
       * `match.score` todavía no la ha sumado, así que usarlo aquí pintaba 0–0 en la franja
       * mientras el titular decía 0–1: dos marcadores contradiciéndose en la misma pantalla.
       */
      score={loop.roundEnd?.score ?? match?.score ?? { home: 0, away: 0 }}
      teams={tn}
      side={homeSide}
      map={nombreMapa || (bs?.match.map ?? "")}
      state={state}
      aside={aside}
    />
  );

  /** Abandonar. Va en la franja, discreto: es una salida, no una acción del partido. */
  const salir = (
    <button
      type="button"
      onClick={loop.reset}
      className="nx-focus min-h-[44px] px-2 font-display text-[10px] uppercase tracking-[0.18em] text-ink-faint transition hover:text-white"
    >
      {tr("Abandonar")}
    </button>
  );

  return (
    <section className="animate-rise">
      {/*
        ═══ MENÚ ═══
        Fuera del escenario inmersivo a propósito: todavía no hay partido. Aquí se elige
        rival y se sortea el lado, y eso es una antesala, no una ronda.
      */}
      {phase === "menu" && (
        <div className="space-y-4">
          {/* FASE 51 · la consola del entrenador: misma sala, mismo simulador (no se toca).
              FASE 51.3 · durante la revelación del mapa no se pinta: esa pantalla es el mapa y nada más. */}
          {!(auto && !autoRef.current) && <CoachHeader
            className="!mb-0"
            kicker={tr("Coach Match Console")}
            title={<>{tr("Dirigir")} <span className="text-[#2fe0ff]">{tr("partido")}</span></>}
            line={tr("Tu composición, su mapa y un rival: preparas, compras y das las órdenes ronda a ronda.")}
            actions={<Link href="/entrenador/jugar" className="nx-coach-btn" data-variant="ghost">{tr("← Cambiar composición")}</Link>}
          />}
          {!mapParam ? (
            <SinMapa />
          ) : !mapaElegido ? (
            <MapaInvalido />
          ) : auto && !autoRef.current ? (
            <MapReveal mapa={mapaElegido} onDone={lanzarAuto} />
          ) : (
            <PrePartido starters={ready && active ? active.starters : null} teamName={ready && active ? active.name : DEFAULT_TEAM_NAME} mapa={mapaElegido} compId={compParam} onPlay={play} />
          )}
        </div>
      )}

      {/*
        ═══ SALA TÁCTICA ═══
        La acción principal —confirmar el plan y entrar en la compra— vivía en la línea 230
        de un panel de 382: para empezar la ronda había que recorrer el plan entero hacia
        abajo. Ahora el panel ocupa el centro y la orden está anclada al pie, donde no se
        puede perder de vista por mucho que se desplace el contenido.
      */}
      {phase === "preparation" && loop.prep && (
        <ImmersiveStage
          label={tr("Sala táctica")}
          header={hud(tr("Sala táctica"), salir)}
          footer={
            <PrimaryAction
              label={tr("Comenzar fase de compra")}
              hint={tr("Confirma el plan de la ronda y pasa a repartir el dinero.")}
              onClick={() => { playCue("ui"); loop.confirmPreparation(prepInput ?? planPorDefecto(loop.prep!)); }}
            />
          }
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4">
            <CoachTacticalPanel prep={loop.prep} onChange={setPrepInput} />
          </div>
        </ImmersiveStage>
      )}

      {/* ═══ COMPRA ═══ */}
      {phase === "buy" && loop.buy && (
        <ImmersiveStage
          label={tr("Fase de compra")}
          header={hud(tr("Fase de compra"), salir)}
          footer={
            <PrimaryAction
              label={tr("Jugar la ronda")}
              hint={tr("Cierra el armamento y saca a los cinco al mapa.")}
              onClick={() => { playCue("whoosh"); loop.confirmBuy(buyTier ?? loop.buy!.recommendedTier ?? "full"); }}
            />
          }
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4">
            <BuyPhasePanel buy={loop.buy} onChange={setBuyTier} />
          </div>
        </ImmersiveStage>
      )}

      {/*
        ═══ RONDA EN VIVO ═══
        El mapa manda: ocupa todo lo que queda entre la franja y la barra de mandos. Los
        paneles que antes colgaban debajo —comentaristas, deck de dirección, lecturas,
        estadísticas y tira de jugadores— siguen estando enteros, pero como CAJÓN lateral
        que se abre cuando se quieren. Ninguno se ha eliminado; han dejado de empujar el
        mapa fuera de la pantalla.
      */}
      {phase === "playing" && (
        <ImmersiveStage
          label={tr("Ronda en vivo")}
          header={hud(tr("En vivo"), (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setPanel((v) => !v)}
                aria-pressed={panel}
                className={cn(
                  "nx-focus nx-clip-sm min-h-[44px] px-3 font-display text-[10px] font-bold uppercase tracking-[0.16em] transition",
                  panel ? "bg-drl/20 text-drl-glow" : "border border-white/12 text-white/60 hover:bg-white/8",
                )}
              >
                {tr("Dirección")}
              </button>
              {salir}
            </div>
          ))}
          footer={<LiveControls loop={loop} brainDebug={brainDebug} onBrain={() => setBrainDebug((b) => !b)} />}
        >
          <div className="relative min-h-0 flex-1">
            {/* EL MAPA. Sin marco, sin márgenes, sin nada encima que no sea del partido. */}
            <div className="absolute inset-0">
              {showField && mapaPartido && <MapMatchBoard frame={frame!} mapId={mapaPartido.id} snap={snap} />}
              {bs && <BroadcastOverlay bs={bs} snap={snap} creditsByName={creditsByName} names={names} momentum={match?.momentum ?? 0} cardArtByName={cartasPorNombre} />}
              <div className="pointer-events-none absolute inset-0" style={{ boxShadow: "inset 0 0 160px rgba(0,0,0,0.7)" }} />
            </div>

            {/* En móvil el marcador ocupa el ancho de arriba: la etiqueta del observado baja sobre el dock (no se oculta). */}
            {live && <div className="absolute left-3 top-3 z-10 max-sm:bottom-[104px] max-sm:top-auto"><ObserverTag live={live} /></div>}

            {match && snap && (
              /*
                FASE 51.2 · el aviso de momento va DEBAJO del marcador del broadcast (que ocupa el
                centro superior), nunca encima: en estrecho se tapaban. Mismo contenido, otra altura.
              */
              <div data-testid="moment-banner" className="pointer-events-none absolute inset-x-0 top-[104px] z-20 flex justify-center px-3 sm:top-[100px]">
                <div className="pointer-events-auto w-full max-w-md">
                  <SpecialMomentBanner moments={detectSpecialMoments(match, snap)} onCommand={(c) => { playCue("ui"); loop.command(c); }} />
                </div>
              </div>
            )}

            {loop.micro && <MicroDecisionPrompt prompt={loop.micro} onRespond={(c) => { playCue("ui"); loop.respondMicro(c); }} />}
            {loop.timeoutPanel && <TimeoutDossierPanel dossier={loop.timeoutPanel} onRespond={(c) => { playCue("ui"); loop.respondTimeout(c); }} />}
            {brainDebug && snap && <BrainDebugPanel snap={snap} selectedId={brainSel} onSelect={setBrainSel} onClose={() => setBrainDebug(false)} />}

            {/* CAJÓN DE DIRECCIÓN. Todo lo que antes colgaba debajo, sin quitar nada. */}
            {panel && (
              <aside
                aria-label={tr("Panel de dirección")}
                className="absolute inset-y-0 right-0 z-30 w-full max-w-[340px] space-y-3 overflow-y-auto border-l border-white/10 bg-[#070a10]/95 p-3 backdrop-blur-sm"
              >
                {snap && <CoachCommandDeck snap={snap} onCommand={(c) => { playCue("ui"); loop.command(c); }} />}
                {match && snap && <LiveReadsTicker reads={liveCoachReads(match, snap)} vozLeft={snap.voz.left} onCommand={(c) => { playCue("ui"); loop.command(c); }} />}
                {live && <CasterFeed lines={live.casters} />}
                {live && <LiveStatsPanel stats={live.stats} />}
                {snap && <LivePlayerStrip snap={snap} cards={cartasPorNombre} />}
              </aside>
            )}
          </div>
        </ImmersiveStage>
      )}

      {/*
        ═══ FIN DE RONDA ═══
        Lo primero que se ve es el resultado; lo segundo, qué toca hacer. El porqué —las
        causas y el briefing— va debajo, para quien quiera estudiarlo. Antes el orden era el
        inverso y había que atravesar dos paneles para encontrar «siguiente ronda».
      */}
      {phase === "roundEnd" && loop.roundEnd && (
        <ImmersiveStage
          label={tr("Fin de ronda")}
          header={hud(loop.roundEnd.won ? tr("Ronda ganada") : tr("Ronda perdida"), salir)}
          footer={
            <PrimaryAction
              label={loop.roundEnd.isLast ? tr("Ver resultado del partido") : tr("Siguiente ronda")}
              hint={loop.roundEnd.isLast
                ? tr("El partido está decidido.")
                : tr("Vuelves a la sala táctica para preparar la siguiente.")}
              onClick={() => { playCue("ui"); loop.continueAfterRound(); }}
            />
          }
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4">
            <RoundOutcome view={loop.roundEnd} />
            {!loop.roundEnd.isLast && (
              <div className="mx-auto mt-4 max-w-xl">
                <RoundBriefingPanel briefing={loop.roundEnd.briefing} />
              </div>
            )}
          </div>
        </ImmersiveStage>
      )}

      {/* ═══ FINAL ═══ */}
      {phase === "ended" && match && (
        <div className="space-y-5">
          <MatchCeremony match={match} summary={td(loop.summary)} />
          <PostMatchShow post={buildPostMatch(match)} casters={postMatchCasters(match)} />
          {/*
            Las acciones van DESPUÉS de todo el final y ancladas al pie: se ven al llegar, sin
            desplazarse, y siguen ahí mientras se lee la retransmisión de cierre.
          */}
          <CeremonyActions
            registro={registro}
            onRetry={reintentarRegistro}
            /*
              La revancha SORTEA otra vez. Repetir el lado de la partida anterior habría
              devuelto por la puerta de atrás la elección que se acaba de quitar: bastaría
              con perder para volver a jugar del lado que a uno le conviene.
              Y es contra el MISMO rival: antes se forzaba «normal», así que una revancha tras
              perder en difícil era, sin decirlo, un partido más fácil.
            */
            onAgain={() => { setShowIntro(true); play(drawSide(), difficulty); }}
          />
        </div>
      )}

      {/* INTRO DE PARTIDO (overlay cinemático antes del primer saque) */}
      {showIntro && intro && phase !== "menu" && phase !== "ended" && (
        <MatchIntro intro={intro} onStart={() => { playCue("whoosh"); setShowIntro(false); }} />
      )}
    </section>
  );
}

/** Escenario cinemático: marco de retransmisión con viñeta, letterbox y "EN VIVO". */
function Stage({ children, live, mapName }: { children: React.ReactNode; live?: boolean; mapName?: string }) {
  useLocale();
  return (
    <div className="nx-coach-board relative aspect-video w-full overflow-hidden bg-[#070a0f] shadow-[0_10px_50px_rgba(0,0,0,0.6)]">
      {children}
      {/* viñeta */}
      <div className="pointer-events-none absolute inset-0" style={{ boxShadow: "inset 0 0 140px rgba(0,0,0,0.75)" }} />
      {/* letterbox sutil */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-black/60 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-black/60 to-transparent" />
      {/* EN VIVO */}
      {live && (
        <div className="pointer-events-none absolute right-3 top-2 z-10 flex items-center gap-1.5 rounded bg-black/55 px-2 py-0.5 backdrop-blur-sm">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500 shadow-[0_0_6px_#ff0000]" />
          <span className="font-display text-[9px] font-bold uppercase tracking-[0.25em] text-white/80">{tr("En vivo")}</span>
        </div>
      )}
    </div>
  );
}

/**
 * LA BARRA DE MANDOS de la ronda, anclada al pie del escenario.
 *
 * Es el mismo deck de siempre —pausa, velocidad, tiempo muerto, cerebro— con dos cambios:
 * ya no flota en medio del documento empujando el mapa hacia abajo, y ha soltado los datos
 * que repetía. El marcador y la ronda estaban aquí Y en la franja de arriba; ahora están
 * solo arriba, que es donde el jugador ya los busca.
 */
function LiveControls({ loop, brainDebug, onBrain }: { loop: ReturnType<typeof useCoachMatch>; brainDebug: boolean; onBrain: () => void }) {
  useLocale();
  const { match, snap } = loop;
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2 sm:px-4">
      <button onClick={() => loop.setPaused(!loop.paused)} className="nx-coach-btn" data-variant="ghost" data-size="sm">
        {loop.paused ? tr("▶ Reanudar") : tr("⏸ Pausa")}
      </button>
      <div className="flex gap-1 p-0.5 shadow-[inset_0_0_0_1px_rgba(47,224,255,0.16)]" role="group" aria-label={tr("Velocidad")}>
        {SPEEDS.map((sp) => (
          <button key={sp} onClick={() => loop.setSpeed(sp)} aria-pressed={loop.speed === sp}
            className={cn("min-h-[36px] px-3 font-display text-xs transition", loop.speed === sp ? "bg-[#2fe0ff] text-[#021420]" : "text-white/55 hover:text-white")}>
            {sp}×
          </button>
        ))}
      </div>
      <button onClick={loop.callTimeout} disabled={loop.timeoutsLeft <= 0 || loop.timeoutPanel != null || loop.micro != null}
        className="rounded-lg border border-cyan-400/40 bg-cyan-400/10 px-4 py-2 font-display text-xs uppercase tracking-wide text-cyan-200 transition enabled:hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-30">
        {tr("⏸ Timeout ·")} {loop.timeoutsLeft}
      </button>
      <button onClick={onBrain}
        className={cn("rounded-lg border px-4 py-2 font-display text-xs uppercase tracking-wide transition",
          brainDebug ? "border-drl/50 bg-drl/15 text-drl" : "border-white/15 text-white/60 hover:bg-white/10")}>
        {tr("🧠 Cerebro")}
      </button>
      {snap && (
        <span className="ml-auto rounded-lg border border-white/10 bg-base-900/60 px-3 py-1.5 font-display text-xs text-white/55">
          {tr("Voz")} {snap.voz.left}/{snap.voz.total}
        </span>
      )}
    </div>
  );
}

/* ═══════════════════════ FASE 51.1 · PRE-PARTIDO ═══════════════════════ */

/** Sin mapa en la URL: no es un error, es que no se ha pasado por JUGAR. Se lleva allí. */
function SinMapa() {
  useLocale();
  return (
    <div className="nx-coach-panel mx-auto max-w-xl space-y-4 p-8 text-center" data-testid="match-no-map">
      <p className="nx-coach-kicker">{tr("Antes de jugar")}</p>
      <h2 className="font-display text-xl font-bold uppercase tracking-wide text-white">{tr("Elige tu composición")}</h2>
      <p className="text-sm text-white/60">{tr("El mapa lo pone tu composición: uno de los doce del Tactical Coach.")}</p>
      <Link href="/entrenador/jugar" className="nx-play-cta !min-h-[52px] !text-[16px]">{tr("Jugar")}</Link>
    </div>
  );
}

/** Mapa que no es del catálogo: se dice. No hay mapa genérico de reserva. */
function MapaInvalido() {
  useLocale();
  return (
    <div role="alert" className="nx-coach-panel mx-auto max-w-xl space-y-4 p-8 text-center" data-tone="mag" data-testid="match-invalid-map">
      <p className="nx-coach-kicker !text-[#ff5aa8]">{tr("Mapa no válido")}</p>
      <h2 className="font-display text-xl font-bold uppercase tracking-wide text-white">{tr("Ese mapa no existe en el Tactical Coach")}</h2>
      <p className="text-sm text-white/60">{tr("Solo se juega en los doce mapas del catálogo. Elige una composición.")}</p>
      <Link href="/entrenador/jugar" className="nx-coach-btn">{tr("Elegir composición")}</Link>
    </div>
  );
}

/**
 * LA CONFIRMACIÓN antes del primer saque: tu equipo (cinco CARTAS), el mapa (grande), la
 * composición (cinco AGENTES, si la elegiste) y el rival con su dificultad —el `MatchSetup` de
 * siempre, que sortea el lado y lanza—. Nada que no exista.
 */
function PrePartido({ starters, teamName, mapa, compId, onPlay }: {
  /** `null` = sin plantilla válida: se juega con el equipo por defecto (FASE 51.3, no bloquea). */
  starters: string[] | null; teamName: string; mapa: ReturnType<typeof requireMatchMap>; compId: string | null;
  onPlay: (side: Side, difficulty: RivalDifficulty) => void;
}) {
  useLocale();
  const [comp, setComp] = useState<Composition | null>(null);
  useEffect(() => {
    if (!compId) return;
    let vivo = true;
    fetchCompositions()
      .then((cs) => { if (vivo) setComp(cs.find((c) => c.id === compId && c.mapId === mapa.id) ?? null); })
      .catch(() => { /* sin composición: no se inventa */ });
    return () => { vivo = false; };
  }, [compId, mapa.id]);

  return (
    <div className="space-y-4" data-testid="prematch">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <section className="nx-coach-panel p-4 sm:p-5" aria-label={tr("Tu equipo")} data-testid="prematch-team">
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="nx-coach-kicker">{starters ? tr("Tu equipo · 5 cartas") : tr("Equipo por defecto")}</p>
            <Link href="/entrenador/equipos" className="nx-action">{starters ? tr("Cambiar") : tr("Usar mi plantilla")}</Link>
          </div>
          <b className="mb-3 block font-display text-[18px] font-extrabold uppercase text-white">{teamName}</b>
          {starters ? (
            <TeamCardStrip starters={starters} size={104} className="!gap-3" />
          ) : (
            <p className="text-[13px] text-white/60" data-testid="prematch-default-team">{tr("Cinco jugadores reales, elegidos como el rival. Tu plantilla es opcional: si la armas, juegas con tus cartas.")}</p>
          )}
        </section>
        <section className="nx-coach-panel flex flex-col p-4 sm:p-5" aria-label={tr("Mapa")} data-testid="prematch-map" data-map-id={mapa.id}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="nx-coach-kicker">{tr("Mapa")}</p>
            <Link href="/entrenador/jugar" className="nx-action">{tr("Cambiar")}</Link>
          </div>
          <div className="flex flex-1 items-center gap-4">
            <span className="relative w-[46%] max-w-[260px] shrink-0 bg-[#070a10] p-1 shadow-[inset_0_0_0_1px_rgba(47,224,255,0.3)]">
              <MapThumb map={mapa} full />
            </span>
            <span>
              <b className="block font-display text-[clamp(28px,4vw,44px)] font-extrabold uppercase leading-none text-white">{mapa.name}</b>
              <span className="nx-coach-muted mt-2 block text-[13px]">{tr("Se juega el sitio A.")}</span>
            </span>
          </div>
        </section>
      </div>

      <section className="nx-coach-panel flex flex-wrap items-center gap-3 p-4" aria-label={tr("Composición")} data-testid="prematch-comp">
        <p className="nx-coach-kicker">{tr("Composición · 5 agentes")}</p>
        {comp ? (
          <>
            <b className="font-display text-[14px] uppercase text-white">{comp.name}</b>
            {/* F59 · la alineación de agentes reales (cuerpo entero; caras en móvil). Las cartas van arriba, aparte. */}
            <AgentLineup agentIds={comp.agentIds} className="lg:max-w-[760px]" />
          </>
        ) : (
          <span className="text-[13px] text-white/55">{tr("Sin composición para esta partida (opcional).")}</span>
        )}
      </section>

      {/* RIVAL / DIFICULTAD y JUGAR: el lanzador de siempre. */}
      <MatchSetup onPlay={onPlay} initial={null} />
    </div>
  );
}

/**
 * FASE 51.3 · PARTIDA ENCONTRADA — la revelación del mapa entre JUGAR PARTIDA y el primer saque.
 * Breve y automática (1,6 s; 0,5 s y sin animación con movimiento reducido). Tocarla adelanta.
 */
function MapReveal({ mapa, onDone }: { mapa: ReturnType<typeof requireMatchMap>; onDone: () => void }) {
  useLocale();
  const done = useRef(onDone);
  useEffect(() => { done.current = onDone; });
  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const t = window.setTimeout(() => done.current(), reduce ? MAP_REVEAL_MS.reduced : MAP_REVEAL_MS.normal);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <button
      type="button"
      onClick={() => done.current()}
      className="nx-coach-panel mx-auto flex w-full max-w-3xl flex-col items-center gap-3 p-5 text-center motion-safe:animate-rise sm:p-7"
      data-testid="map-reveal"
      data-map-id={mapa.id}
      aria-live="polite"
    >
      <span className="nx-coach-kicker !text-[#2fe0ff]">{tr("Partida encontrada")}</span>
      <b className="font-display text-[clamp(36px,6vw,64px)] font-extrabold uppercase leading-none text-white">{mapa.name}</b>
      <span className="w-full max-w-[min(440px,42vh)] bg-[#070a10] p-1 shadow-[inset_0_0_0_1px_rgba(47,224,255,0.35)]">
        <MapThumb map={mapa} full />
      </span>
      <span className="nx-label text-white/45">{tr("Empieza el partido…")}</span>
    </button>
  );
}
