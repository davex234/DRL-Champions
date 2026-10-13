"use client";

/**
 * NEXUS DUEL ARENA — el tablero del duelo.
 *
 * Su trabajo sigue siendo exactamente el mismo de siempre:
 *   1. enseñar el estado que devolvió el servidor,
 *   2. recoger DOS decisiones —qué carta y, si atacas, qué estadística—,
 *   3. enviarlas y volver a enseñar el estado nuevo.
 *
 * Aquí no se compara ni un número, no se cuenta ni un punto y no se decide ni un ganador.
 * Ni siquiera se sabe qué estadística debe responder el defensor: la manda el servidor en
 * `requiredStat`, calculada con la tabla del dominio. **Nada de eso cambia en este
 * rediseño: es un cambio de PRESENTACIÓN.**
 *
 * ───────────────────────── QUÉ SE RECOMPONE Y POR QUÉ ─────────────────────────
 *
 * La arena anterior eran cuatro paneles apilados —marcador, franja del rival, una caja de
 * choque medio vacía y una rejilla de cartas—, todos con el mismo borde y el mismo fondo.
 * Las cartas no estaban SOBRE nada: estaban dentro de cajas. Y sobre todo, **lo jugado
 * desaparecía**: tus cartas se plegaban en un `<details>Cartas gastadas</details>` y las
 * del rival no se enseñaban en ningún sitio, así que el tablero del turno 7 se veía igual
 * que el del turno 1.
 *
 * Ahora hay UNA MESA con tres zonas:
 *
 *     ┌──────────────────────────────────────────┐
 *     │  RIVAL   · mano boca abajo               │
 *     │          · sus cartas jugadas, boca arriba│
 *     ├──────────── ZONA DE DUELO ───────────────┤
 *     │        [carta rival]  RÓTULO  [tu carta] │
 *     ├──────────────────────────────────────────┤
 *     │  TÚ      · tus cartas jugadas             │
 *     │          · tu mano, en abanico            │
 *     └──────────────────────────────────────────┘
 *
 * Lo jugado SE QUEDA en la mesa y cuenta la partida. La estadística declarada deja de ser
 * un texto de once píxeles y pasa a ser el rótulo del centro. Y la mano se sostiene: las
 * cartas se solapan, se levantan al pasar por encima y la elegida sube del todo.
 *
 * ───────────────────────── LO QUE NO SE TOCA ─────────────────────────
 *
 * La selección, la confirmación y **los textos exactos de los botones**. El recorrido
 * automatizado (`duel:e2e`) juega la partida entera buscando «Elige una carta», «Elige una
 * estadística», «Declarar y atacar», «Responder», los botones de estadística que empiezan
 * por SH/GS/EF sin `aria-label`, y las cartas por su `aria-label` acabado en «OVR n». Una
 * arena más bonita que rompe la verificación no vale nada.
 */
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/format";
import { DuelCard, DuelCardBack } from "./DuelCard";
import { TurnTrack } from "./Scoreboard";
import { TurnHistory } from "./TurnHistory";
import { ArenaSurface, TableEdge, ZoneBand, ZoneRail, ClashBand, Slot, HandTray, arenaVars } from "./arena/ArenaSurface";
import { PlayedRow } from "./arena/PlayedRow";
import { PlayerHand, RivalHand } from "./arena/HandFan";
import { ArenaEnvironment } from "./arena/ArenaEnvironment";
import { ClashBanner } from "./arena/ClashBanner";
import { DIFFICULTY_INFO, STAT_INFO, type CombatStatKey, type DuelMatchView } from "@/lib/duel/types";
import { hintPresentation } from "@/lib/duel/hintDisplay";
import { EASE } from "@/design/motion";
import { primeAudio, playCue, playSound } from "@/lib/sound";
import { lockCopy } from "@/lib/duel/gameplayUx";
import { trackDuel } from "@/lib/duel/telemetry";
import { trackExperience } from "@/lib/duel/experienceTelemetry";
import { buzz } from "@/lib/haptics";
import { MatchHud, TurnTimeline } from "./experience/MatchHud";
import { arenaSignals, derivePhase, turnImpact, type LifecycleLike, type SyncStatusLike } from "@/lib/duel/experience";
import { ARENA_ACCENT, type ArenaMode } from "@/lib/duel/arenas";
import { climaxLevel, roleBanner, type RoleBanner } from "@/lib/duel/matchFlow";
import { RoleIcon } from "./experience/RoleIcon";
import { StatSelector } from "./arena/StatSelector";
import { RivalStats } from "./arena/RivalStats";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("duel");

/* FASE 50 · los tonos de bando salen de la configuración de la arena: cian tú, rojo el rival. */
const TONO_TU = ARENA_ACCENT.player;
const TONO_RIVAL = ARENA_ACCENT.opponent;

export function MatchBoard({
  view, onPlay, busy, error, onDismissError, waitingRival = false, revealing = false, sync = null,
  arena = "quick", hudInTopBar = false,
}: {
  /**
   * FASE 45 → 50 · el modo de la partida decide QUÉ arena se monta (`lib/duel/arenas`). Hoy todos
   * comparten NEXUS Champions. La partida no lo usa para nada más.
   */
  arena?: ArenaMode;
  /**
   * FASE 50 · la barra de la partida (la de la página) ya enseña el turno, la pista de los diez y la
   * fase. Con esto el tablero no lo repite a partir de `sm`; en móvil, y en la arena PvP, se queda.
   */
  hudInTopBar?: boolean;
  /** FASE 33 · la pantalla está enseñando la revelación de un turno ya resuelto (presentación). */
  revealing?: boolean;
  /** FASE 33 · PvP: el estado del poller (servidor). Manda sobre todo lo local en la fase visual. */
  sync?: { status: SyncStatusLike; isYourTurn: boolean; lifecycle: LifecycleLike } | null;
  view: DuelMatchView;
  onPlay: (cardUid: string, stat?: CombatStatKey) => void;
  busy: boolean;
  error: string | null;
  onDismissError: () => void;
  /**
   * PvP: no es tu turno. Es un estado NORMAL, no un error: la mesa se cierra y lo dice
   * («Esperando al rival…»). Lo decide el servidor (`isYourTurn`); aquí solo se pinta.
   */
  waitingRival?: boolean;
}) {
  useLocale();
  const [card, setCard] = useState<string | null>(null);
  const [stat, setStat] = useState<CombatStatKey | null>(null);
  /*
   * F72.8 · una decisión nueva empieza sin nada marcado. Si el tiempo se agotó con una carta marcada y el servidor jugó
   * otra, la marca no puede sobrevivir a la decisión siguiente.
   */
  const decision = `${view.matchId}:${view.turn}:${view.phase}:${view.youAreAttacker ? "A" : "D"}`;
  useEffect(() => { setCard(null); setStat(null); }, [decision]);

  /*
   * Cómo se llama el rival. En PvE es la dificultad del bot; en PvP no hay dificultad que
   * enseñar y `rivalLabel` trae un texto neutro. Se resuelve UNA vez y aquí, para que el tablero
   * no tenga dos formas de nombrar a la misma persona.
   */
  const rivalName = view.rivalLabel ?? DIFFICULTY_INFO[view.difficulty].label;

  const attacking = view.youAreAttacker;
  const chosen = useMemo(() => view.yourHand.find((c) => c.uid === card) ?? null, [view.yourHand, card]);

  // Fase 44.1 · cada turno nuevo suena (discreto): la mesa avisa de que vuelve a ser tu momento.
  useEffect(() => { if (view.turn > 1) playSound("match.turn"); }, [view.turn]);

  /*
   * FASE 45 · EL IMPACTO DEL TURNO. Cuando el servidor devuelve un turno nuevo, la arena responde: un destello del
   * color del que ganó y su sonido. Se LEE `outcome` del último turno del historial —no se compara nada aquí— y se
   * dispara una sola vez por turno (la clave es el número de turnos resueltos).
   */
  const signals = arenaSignals(view);
  const resolved = view.history.length;
  const [hit, setHit] = useState<"win" | "loss" | "tie" | null>(null);
  useEffect(() => {
    if (resolved === 0) return;
    const impact = turnImpact(view.history[resolved - 1].outcome);
    setHit(impact.result);
    playSound(impact.sound);
    const id = window.setTimeout(() => setHit(null), 900);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved]);

  // Si la mano cambia (turno nuevo), la selección deja de ser válida.
  const stale = card !== null && !view.yourHand.some((c) => c.uid === card);
  if (stale) { setCard(null); setStat(null); }

  const ready = attacking ? Boolean(chosen && stat) : Boolean(chosen);

  /*
   * EL CERROJO DE LA JUGADA (Fase 26). Un solo sitio decide qué dice el botón y si la mesa
   * responde: jugada en vuelo (`busy`) o turno del rival (`waitingRival`). Mientras está
   * cerrado no se puede confirmar dos veces ni cambiar de carta: el servidor lo rechazaría
   * igualmente, pero no se manda a sabiendas.
   */
  const lock = lockCopy({ busy, waitingRival, attacking, hasCard: Boolean(chosen), hasStat: Boolean(stat) });

  /*
   * FASE 33 · LA FASE VISUAL DEL TURNO (`derivePhase`): primero la verdad del servidor (terminada, sin
   * conexión, resincronizando, turno del rival), después lo que la pantalla enseña (revelación, jugada en
   * vuelo) y al final lo que el jugador elige. No bloquea nada ni se guarda: se recalcula en cada render.
   */
  const phase = derivePhase({
    view,
    selectedUid: card,
    selectedStat: stat,
    submitting: busy && !waitingRival && !revealing,
    revealing,
    sync: sync ?? (waitingRival ? { status: "SYNCED", isYourTurn: false, lifecycle: "IN_TURN" } : null),
  });

  function confirm() {
    if (!chosen || busy || lock.locked) return;
    /*
     * El sonido de COLOCAR. `playCue` está sintetizado (Web Audio, sin assets ni
     * dependencias) y ya lo usan Carrera, Entrenador, Broadcast y Packs; Duelos era la única
     * pantalla del producto en silencio absoluto, y es lo que más la hacía parecer una demo.
     * Va aquí, junto al gesto, y NO toca el flujo: `onPlay` se llama exactamente igual.
     */
    playCue("whoosh");
    trackDuel("card_locked");
    trackExperience("turn_lock");
    buzz("lock");
    onPlay(chosen.uid, attacking ? stat ?? undefined : undefined);
    setCard(null);
    setStat(null);
  }

  /** Elegir carta: prepara el audio (política de autoplay) y responde con un clic corto. */
  function pickCard(uid: string): void {
    if (lock.locked) return;
    primeAudio();
    playCue("ui");
    trackDuel("card_selected");
    trackExperience("turn_card_select");
    buzz("select");
    setCard(uid);
    setStat(null);
  }

  const required = view.requiredStat;
  const hasHistory = view.history.length > 0;

  /*
   * LOS DOS EJES DEL TURNO. No son el mismo: el que ataca declara la suya y el que defiende
   * responde con la que le impone la tabla del dominio, que llega ya calculada en
   * `requiredStat`. Aquí solo se elige qué campo mirar; ninguno se calcula.
   */
  const miEje: CombatStatKey | null = attacking ? stat : required;
  const ejeRival: CombatStatKey | null = view.pendingRival?.stat ?? null;

  const valorTuyo = chosen && miEje ? chosen.combat[miEje] : null;
  // DUEL GAMEPLAY UX 2.0 · el valor de la carta rival comprometida es SECRETO hasta que respondas (no llega).
  const valorRival: number | null = null;

  return (
    /*
      LA MESA NO SE MUEVE A MEDIA PARTIDA.

      El historial aparecía en cuanto había un turno jugado y, al aparecer, se llevaba 300 px
      de la fila: la mesa saltaba 158 px hacia la izquierda entre el primer turno y el
      segundo y se quedaba pegada al historial con un gutter de 15 px. Una mesa que cambia
      de sitio sola no se lee como un objeto.

      Ahora la columna del historial está SIEMPRE reservada, y solo a partir de `xl`, que es
      donde sobra ancho para ella sin comerle tablero a la mesa. Por debajo el historial baja
      debajo del tablero, como hasta ahora. La mesa ocupa el mismo sitio en el turno 1 y en
      el 10.
    */
    /*
     * FASE 45 · La mesa deja de ser un rectángulo sobre la página: `data-attacker` y `data-final` encienden el
     * escenario (suelo, luz del bando que ataca, rim del último turno) desde la CSS, sin tocar ni una regla.
     */
    /*
     * FASE 45 · EL RECINTO ENVUELVE LA MESA.
     *
     * Hasta aquí la raíz era una rejilla de dos columnas: la mesa y un panel lateral fijo con
     * la parrilla de diez turnos y el historial. Eso —un tablero a la izquierda y dos cuadros
     * de datos a la derecha— es la silueta de un cuadro de mandos, no la de una partida. El
     * panel se va (el historial pasa a cajón, la parrilla ya vive en el canto de la mesa) y
     * en su sitio queda el LUGAR: `ArenaEnvironment` a sangre, por debajo de todo.
     *
     * `relative` es lo que ancla el recinto: sin él, el fondo se colgaría del primer padre
     * posicionado, que es la página entera.
     */
    <div
      className="relative"
      data-phase={phase}
      data-attacker={signals.attacker}
      data-final={signals.finalTurn ? "true" : "false"}
      data-hit={hit ?? "none"}
      /* F61 · el tramo (NORMAL / LATE / FINAL) sube un grado la luz del escenario desde la CSS. Presentación pura. */
      data-climax={climaxLevel(Math.min(view.turn, view.totalTurns), view.totalTurns)}
    >
      <ArenaEnvironment
        attacker={signals.attacker}
        finalTurn={signals.finalTurn}
        hit={hit ?? "none"}
        variant={arena}
      />

      {/*
        F71 · LA COLUMNA DE DECISIÓN. A partir de `lg` los controles (instrucción, estadística y
        confirmar) dejan de ser una fila entre la mesa y la mano y pasan a una COLUMNA a la derecha
        de la arena, siempre reservada (la mesa no salta al elegir). La mesa se mide descontándola:
        `--pos-cap` sale del ancho del contenedor (`cqw`) menos la columna. Por debajo de `lg` todo
        sigue en su sitio y los controles son una hoja inferior en el flujo (no tapan nada).
        (Hay una segunda `</div>` al final: este envoltorio es el contenedor de `cqw`.)
      */}
      <div className="relative z-10 lg:[container-type:inline-size]">
      <div
        className="flex min-w-0 flex-col items-center gap-[clamp(5px,0.9vh,10px)] lg:grid lg:grid-cols-[var(--ctl-w)_minmax(0,1fr)_var(--ctl-w)] lg:items-start lg:mx-[calc(var(--ctl-ext)*-1)] lg:gap-x-[var(--ctl-gap)] lg:[--pos-cap:var(--pos-cap-lg)]"
        style={{
          ...arenaVars(view.totalTurns),
          "--ctl-w": "clamp(176px, 17vw, 300px)", /* F71.2 · DOS laterales simétricos (rival | mesa | tú): cada uno algo menor que el de F71.1 */
          "--ctl-gap": "clamp(10px, 1.2vw, 20px)",
          /*
           * En pantallas anchas la página se queda en 1320 px y sobra margen fuera: la columna se sale
           * hacia ese margen (`--ctl-ext`, nunca más de lo que hay) para no encoger la mesa.
           */
          "--ctl-ext": "min(calc(var(--ctl-w) + var(--ctl-gap)), max(0px, calc((100vw - 100cqw) / 2 - 20px)))",
          "--pos-cap-lg": `calc((100cqw + var(--ctl-ext) * 2 - var(--ctl-w) * 2 - var(--ctl-gap) * 2 - var(--pos-pad) * 2 - var(--pos-gap) * ${view.totalTurns - 1} - 10px) / ${view.totalTurns})`,
        } as React.CSSProperties}
      >
        {/*
          FASE 33 · EL HUD DEL TURNO. «TURNO N DE 10 · ATACAS/DEFIENDES», el eje (elegido o impuesto por
          el servidor), último turno, punto de partida, marcador vivo y la línea de los diez turnos con
          su detalle. Presentación sobre la vista: aquí no se decide nada.
        */}
        <MatchHud view={view} rivalName={rivalName} waitingRival={waitingRival} phase={phase} compact={hudInTopBar} className="lg:col-start-2" />

        {/* ═══════════ EL ESCENARIO Y LA MESA ═══════════ */}
        <div className="nx-arena-stage w-full lg:col-start-2">
        <ArenaSurface>
          {/*
            FASE 50 · Con la barra de la partida encima (PvE) esta tira se retira: la barra ya dice
            el turno, el marcador y la pista de los diez, y en móvil la cinta del turno y la línea
            tocable de los diez turnos (debajo de la mano) cubren el resto. En la arena PvP sigue.
          */}
          {/*
            EL HUD, GRABADO EN EL CANTO DE LA MESA.

            Era un bloque suelto de 68 px flotando encima del tablero: competía con la mesa
            y costaba justo la altura que le faltaba a la mano para caber en el pliegue.
            Mismos datos —turno, pista de turnos, quién ataca— serigrafiados en el borde
            superior de la propia mesa. El marcador vive en los flancos del enfrentamiento,
            que es donde significa algo; en pantallas estrechas baja al centro de esta tira.
          */}
          <TableEdge
            className={hudInTopBar ? "hidden" : undefined}
            left={
              <>
                <span className="nx-label shrink-0">{t("Turno")}</span>
                {/*
                  EL TURNO CAMBIA, NO SE SUSTITUYE. Antes el número saltaba de 5 a 6 sin más:
                  la única señal de que la partida había avanzado era un glifo distinto. Con
                  `key` en el número, framer-motion lo reemplaza —el viejo sube y se va, el
                  nuevo entra desde abajo— y el cambio de turno se NOTA. Son 180 ms y un solo
                  nodo; el denominador no se anima porque no cambia nunca.
                */}
                <b className="nx-readout shrink-0 text-[15px] leading-none">
                  <span className="relative inline-grid overflow-hidden align-bottom">
                    <AnimatePresence mode="popLayout" initial={false}>
                      <motion.span
                        key={Math.min(view.turn, view.totalTurns)}
                        initial={{ y: 10, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: -10, opacity: 0 }}
                        transition={{ duration: 0.18, ease: EASE.out }}
                        className="tabular-nums"
                      >
                        {Math.min(view.turn, view.totalTurns)}
                      </motion.span>
                    </AnimatePresence>
                  </span>
                  <span className="text-white/30"> / {view.totalTurns}</span>
                </b>
                <TurnTrack view={view} className="ml-1 hidden min-w-0 flex-1 sm:flex" />
              </>
            }
            center={
              /* El marcador solo aquí cuando no hay flancos donde ponerlo. */
              <span className="flex items-center gap-1.5 lg:hidden">
                <b className="nx-readout text-lg" style={{ color: TONO_TU }}>{view.scoreYou}</b>
                <span className="text-[10px] text-white/25">–</span>
                <b className="nx-readout text-lg text-drl">{view.scoreRival}</b>
              </span>
            }
            right={
              view.status === "IN_PROGRESS" ? (
                <span
                  className={cn(
                    "shrink-0 font-display text-[10px] font-bold uppercase tracking-[0.16em]",
                    view.youAreAttacker ? "text-[#2fe0ff]" : "text-drl",
                  )}
                >
                  {view.youAreAttacker ? t("Atacas tú") : t("Ataca el rival")}
                </span>
              ) : null
            }
          />

          {/* ─────────── BANDA DEL RIVAL ─────────── */}
          <ZoneBand side="rival">
            {/*
              FASE 50 · LA CABECERA DEL RIVAL EN UNA SOLA FILA: quién es a la izquierda, su mano boca
              abajo colgando en el centro (como al otro lado de un escenario) y la fuerza del mazo a
              la derecha. Antes eran dos filas apiladas; así la plataforma gana altura para lo jugado.
            */}
            <div className="mb-1 grid grid-cols-[1fr_auto_1fr] items-start gap-2">
              <span className="flex min-w-0 items-center gap-1.5 pt-0.5">
                <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-drl shadow-[0_0_10px_#ff2e63]" />
                <span className="truncate font-display text-[12px] font-bold uppercase tracking-[0.14em] text-white">{rivalName}</span>
                <span className="nx-label hidden !text-drl/80 sm:inline">
                  · {view.rivalRemaining} {view.rivalRemaining === 1 ? t("carta") : t("cartas")}
                </span>
              </span>
              <RivalHand count={view.rivalRemaining} hints={view.rivalHints} roles={view.rivalRoles ?? []} />
              {/*
                Debajo de `lg` no hay flancos donde poner la identidad, así que la fuerza del
                mazo rival viaja aquí: en móvil esta línea es lo que contesta «¿contra quién juego?».
              */}
              <span className="nx-label justify-self-end whitespace-nowrap pt-0.5 text-right">
                Σ <b className="nx-readout text-[12px] text-white/70">{view.rivalSumOvr}</b>
              </span>
            </div>

            <PlayedRow
              cards={view.rivalUsed}
              turns={view.history}
              side="B"
              tone={TONO_RIVAL}
              slots={view.totalTurns}
              className="mt-0.5"
            />
          </ZoneBand>

          <ZoneRail tone={TONO_RIVAL} label={t("Zona de duelo")} className="mt-[clamp(4px,0.8vh,10px)]" />

          {/* ─────────── ZONA DE ENFRENTAMIENTO ─────────── */}
          <ClashBand>
            {/*
              EL CORAZÓN DE LA MESA.

              Cinco columnas: el marcador de cada bando en los flancos y, en medio, las dos
              posiciones vivas con la PLACA CENTRAL entre ellas. Antes los flancos quedaban
              a 275 y 1.155 px —los extremos de una mesa que sobraba por todos lados— y el
              centro era un rótulo suelto. Ahora la mesa mide lo que mide el juego, así que
              las cinco columnas caen juntas y el enfrentamiento se lee como UN grupo.

              Debajo de `lg` no hay ancho para flancos: el marcador ya está en el canto.
            */}
            {/* F71.2 · estrecho: rival ARRIBA (su SH/GS/EF, o «?» si su carta está oculta), cartas en medio, tú abajo. */}
            <RivalStats variant="strip" card={null} stat={view.pendingRival?.stat ?? null} className="mb-1.5 lg:hidden" />
            <div className="relative mx-auto flex items-center justify-center gap-[clamp(6px,1.4vw,22px)]">
              <Marcador
                lado="rival"
                valor={view.scoreRival}
                nombre={rivalName}
                etiqueta={view.rivalLabel}
                fuerza={view.rivalSumOvr}
                className="hidden lg:flex"
              />

              {/* Carta del rival: la de arriba, porque es su lado de la mesa. */}
              <Hueco tone={TONO_RIVAL} label={t("Carta rival")} filled={Boolean(view.pendingRival)}>
                {view.pendingRival ? (
                  /*
                   * DUEL GAMEPLAY UX 2.0 · EL RIVAL YA COMPROMETIÓ SU CARTA, BOCA ABAJO. Cae a la mesa como antes, pero es
                   * su REVERSO: al navegador no le ha llegado nada de la carta (ni uid, ni jugador, ni cifras). Se revela
                   * cuando tu respuesta ya está comprometida, en la revelación del turno.
                   * AJUSTE · el reverso lleva la pista pública y el rol de esa carta: los MISMOS que tiene en la fila
                   * superior (el servidor los calcula con la misma función). Nada más de la carta.
                   */
                  <motion.div
                    key={`comprometida-${view.turn}`}
                    data-testid="rival-committed"
                    data-hidden="true"
                    initial={{ opacity: 0, y: -70, scale: 1.28, rotateX: 28 }}
                    animate={{ opacity: 1, y: 0, scale: 1, rotateX: 0 }}
                    transition={{ duration: 0.46, ease: EASE.out }}
                    className="absolute inset-0"
                    style={{ transformPerspective: 900 }}
                    role="img"
                    aria-label={committedLabel(view.pendingRival)}
                  >
                    <DuelCardBack size="lg" className="!w-full" layout="committed" hint={td(view.pendingRival.hint)} role={view.pendingRival.role} />
                  </motion.div>
                ) : (
                  /*
                   * A la espera de que el rival declare. Es un REVERSO, no un hueco vacío: el
                   * rival tiene cartas y va a jugar una, y eso hay que verlo.
                   *
                   * FASE 8 · Antes RESPIRABA en bucle infinito. Un bucle que no termina nunca
                   * mantiene el compositor despierto toda la partida y, sobre todo, compite
                   * con lo único que debería moverse en esta zona: la carta al caer. Ahora
                   * entra una vez, con la aparición, y se queda quieto.
                   */
                  <motion.div
                    className="absolute inset-0"
                    initial={{ opacity: 0.4 }}
                    animate={{ opacity: 0.9 }}
                    transition={{ duration: 0.45, ease: EASE.out }}
                  >
                    <DuelCardBack size="md" className="!w-full opacity-70" />
                  </motion.div>
                )}
              </Hueco>

              {/* LA PLACA CENTRAL: el eje declarado, las dos cifras y el sello VS. */}
              <PlacaCentral
                role={roleBanner(view, waitingRival)}
                ready={ready}
                youStat={miEje}
                youValue={valorTuyo}
                rivalStat={ejeRival}
                rivalValue={valorRival}
                hint={attacking ? t("Elige carta y estadística") : t("Elige con qué carta respondes")}
              />

              {/* Tu carta: la de abajo. */}
              <Hueco tone={TONO_TU} label={t("Tu carta")} filled={Boolean(chosen)} active={!chosen}>
                {chosen && (
                  <motion.div
                    key={chosen.uid}
                    /*
                     * Sale de la mano y se posa: sube desde abajo, llega algo grande y se
                     * asienta. Es «he puesto esta carta sobre la mesa», no «ha aparecido».
                     */
                    initial={{ opacity: 0, y: 90, scale: 1.24, rotateX: -26 }}
                    animate={{ opacity: 1, y: 0, scale: 1, rotateX: 0 }}
                    transition={{ duration: 0.44, ease: EASE.out }}
                    className="absolute inset-0"
                    style={{ transformPerspective: 900 }}
                  >
                    <DuelCard card={chosen} size="lg" highlightStat={attacking ? stat : required} glow={`${TONO_TU}cc`} className="!w-full" hideCombat />
                  </motion.div>
                )}
              </Hueco>

              <Marcador
                lado="tu"
                valor={view.scoreYou}
                nombre={view.yourDeckName}
                fuerza={view.yourSumOvr}
                className="hidden lg:flex"
              />
            </div>

            {/*
              En estrecho no cabe una columna de 240 px entre las dos cartas, así que la
              comparación de ejes baja aquí, debajo de la zona pero DENTRO de ella: sigue
              siendo el dato del enfrentamiento y sigue viviendo en el centro de la mesa.
            */}
            {/*
              En estrecho la comparación de ejes baja aquí, debajo de la zona pero DENTRO de
              ella. SIN `hint`: en móvil ese texto repetía palabra por palabra la instrucción
              que ya da la línea de los controles, treinta píxeles más abajo. Decir dos veces
              lo mismo no es más claro, y aquí costaba alto de pantalla en el sitio donde más
              falta hace. Cuando hay ejes declarados, la placa sí tiene algo que decir.
            */}
            <ClashBanner
              className="mt-1.5 md:hidden"
              youStat={miEje}
              youValue={valorTuyo}
              rivalStat={ejeRival}
              rivalValue={valorRival}
            />
          </ClashBand>

          <ZoneRail tone={TONO_TU} label={t("Tu equipo")} className="mb-[clamp(4px,0.8vh,10px)]" />

          {/* ─────────── BANDA DEL JUGADOR ─────────── */}
          <ZoneBand side="jugador">
            <PlayedRow
              cards={view.yourUsed}
              turns={view.history}
              side="A"
              tone={TONO_TU}
              slots={view.totalTurns}
            />
          </ZoneBand>
        </ArenaSurface>
        </div>

        {/* ═══════════ CONTROLES ═══════════ */}
        {/*
          Fuera de la mesa a propósito: las decisiones se toman con las manos, no sobre el
          tablero. Aquí viven la obligación de eje al defender, los tres botones de
          estadística al atacar y el botón de confirmar.

          EN UNA SOLA FILA a partir de `sm`. Apilados costaban 145 px de alto —instrucción,
          aviso, tres botones y confirmar, uno debajo de otro— entre la mesa y la mano, y
          eran los que empujaban la mano por debajo del pliegue en cinco de los seis anchos.
          Puestos en fila el mismo contenido cabe en ~70, la mano vuelve a caber en pantalla
          y los controles dejan de parecer un segundo panel que compite con el tablero.

          Ni un texto, ni un `aria-pressed`, ni un manejador cambian: es reparto.
        */}
        {/*
          F71.2 · EL LATERAL DEL RIVAL (izquierda, rojo), simétrico al tuyo (derecha, cian). DUEL GAMEPLAY UX 2.0 · la
          carta comprometida del rival es secreta hasta que respondes: aquí solo su ESTADÍSTICA declarada y «?».
        */}
        <section
          data-testid="rival-panel"
          aria-label={t("Carta del rival")}
          className="hidden lg:col-start-1 lg:row-span-3 lg:row-start-1 lg:flex lg:min-h-0 lg:flex-col lg:gap-3 lg:self-stretch lg:overflow-hidden lg:border lg:border-[#ff2e63]/25 lg:px-4 lg:py-4 lg:[contain:size]"
          style={{ background: "rgba(18,4,10,0.86)" }}
        >
          <p className="flex items-center gap-2 font-display text-[15px] font-bold tracking-[0.04em] text-white/80">
            <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: TONO_RIVAL, boxShadow: `0 0 8px ${TONO_RIVAL}` }} />
            {rivalName ?? t("Rival")}
          </p>
          <RivalStats card={null} stat={view.pendingRival?.stat ?? null} className="lg:flex-1" />
        </section>

        <section
          data-arena="controles"
          data-testid="stat-panel"
          data-choosing={chosen && (attacking || required) && !waitingRival ? "true" : "false"}
          aria-label={t("Tu jugada")}
          className={cn(
            "nx-a50-controls nx-stat-panel mx-auto flex w-full flex-col gap-2 px-3 py-[clamp(6px,1vh,10px)] sm:px-6",
            /* Hoja inferior (debajo de `lg`): canto superior marcado, en el flujo; no tapa la carta ni la mesa. */
            "rounded-t-2xl border-t border-[#2fe0ff]/25 lg:rounded-none lg:border-t-0",
            /* Columna derecha (`lg`): panel propio, centrado respecto a la mesa, siempre reservado. */
            /* F71.1 · de arriba abajo (`self-stretch`): la columna entera es la decisión, no una tarjeta flotante. `contain:size`:
               el panel NO empuja la rejilla (su alto lo marca la mesa: del HUD al pie de la mano), solo la llena. Tres filas
               (HUD, mesa, mano): la cuarta es la línea de turnos, oculta en escritorio, y alargaba el panel bajo la mano. */
            "lg:col-start-3 lg:row-span-3 lg:row-start-1 lg:gap-3 lg:self-stretch lg:min-h-0 lg:overflow-hidden lg:[contain:size] lg:border lg:border-white/10 lg:px-4 lg:py-4 lg:![background:rgba(5,8,18,0.86)] lg:!max-w-none",
          )}
          style={{ maxWidth: "var(--arena-w, 100%)" }}
        >
          {/*
            LA INSTRUCCIÓN DEL TURNO. Siempre presente y con el mismo vocabulario de
            siempre: «Elige tu carta» · «Declara la estadística» · «Responde con una carta».

            SIN `uppercase`. `innerText` devuelve el texto RENDERIZADO, así que una mayúscula
            de CSS cambia lo que leen las verificaciones: con `uppercase` esta línea salía
            «RESPONDE CON UNA CARTA» y `duel:playtest` contaba 60 turnos sin instrucción. El
            énfasis lo pone el peso, no la caja.
          */}
          {/* F71.1 · en la columna la instrucción es una cabecera (`lg:flex-none`): el alto es para los tres tercios. */}
          <div className="flex min-w-0 flex-1 flex-col justify-center lg:flex-none">
            <p className="flex items-center gap-2 font-display text-[13px] font-bold tracking-[0.04em] text-white/80 lg:text-[15px]">
              <span
                aria-hidden
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: ready ? TONO_TU : TONO_RIVAL, boxShadow: `0 0 8px ${ready ? TONO_TU : TONO_RIVAL}` }}
              />
              {waitingRival
                ? t("Esperando al rival…")
                : !attacking
                  ? t("Responde con una carta")
                  : !chosen
                    ? t("Elige tu carta")
                    : t("Declara la estadística")}
            </p>

            {/* El cerrojo se dice, no solo se nota: qué está pasando mientras la mesa no responde. */}
            {lock.locked && lock.status && (
              <p className="mt-0.5 truncate pl-3.5 text-[11px] text-drl-cyan/90" data-lock="on" aria-live="polite">
                {td(lock.status)}
              </p>
            )}

            {/* F71.2 · «Obligado a responder con …» ya no se repite aquí: lo dice la etiqueta OBLIGADA del lateral. */}

            {error && (
              <p role="alert" className="mt-1 flex items-start gap-2 pl-3.5 text-[11px] text-drl-glow">
                <span className="min-w-0 flex-1">{td(error)}</span>
                <button type="button" onClick={onDismissError} aria-label={t("Cerrar aviso")} className="shrink-0 opacity-60 hover:opacity-100">✕</button>
              </p>
            )}
          </div>

          {/*
            F71 · LA DECISIÓN, EN GRANDE. Atacando, los tres ejes en bloques con la cifra de la carta
            elegida; defendiendo, el eje obligado (el que manda el servidor), bloqueado. Debajo de `lg`
            van en fila (tres bloques) y el botón de confirmar ocupa el ancho; en `lg`, apilados en la
            columna con el botón debajo, en el mismo panel.
          */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch lg:min-h-0 lg:flex-1 lg:flex-col lg:gap-3">
            {!waitingRival && (
              <StatSelector
                card={chosen}
                attacking={attacking}
                stat={stat}
                required={required}
                locked={lock.locked}
                onSelect={(k) => { if (lock.locked) return; playCue("ui"); setStat(k); }}
                className="sm:flex-1"
              />
            )}

            <button
              type="button"
              onClick={confirm}
              disabled={!ready || busy || lock.locked}
              aria-busy={busy}
              data-lock={lock.locked ? "on" : "off"}
              data-testid="stat-confirm"
              /* FASE 50 · un botón de juego: cian (el color del jugador), con chaflanes. Mismo texto, mismo cerrojo. */
              className="nx-a50-cta relative w-full shrink-0 px-5 py-[clamp(10px,1.6vh,14px)] font-display text-sm font-extrabold uppercase tracking-[0.16em] transition disabled:cursor-not-allowed sm:w-auto sm:min-w-[200px] sm:self-center lg:w-full lg:py-4 lg:text-base"
            >
              {/* El texto del botón es la máquina de estados del turno (ver `lockCopy`). */}
              {td(lock.button)}
            </button>
          </div>
        </section>

        {/* ═══════════ TU MANO ═══════════ */}
        {/*
          En una BANDEJA, fuera de la mesa: lo que sostienes no está sobre el tapete. Antes
          la mano era un bloque suelto de 161 px que pesaba tanto como el tablero; con su
          propio plano, más oscuro y con raíl, se lee como el soporte del jugador y deja de
          competir con el tablero.
        */}
        <HandTray
          className="px-0 pb-1 lg:col-start-2"
          style={{ maxWidth: "var(--arena-w, 100%)" }}
          left={
            <span className="nx-label !text-[#2fe0ff]/85">
              {t("Tu mano ·")} {view.yourHand.length} {view.yourHand.length === 1 ? t("carta") : t("cartas")}
            </span>
          }
          right={
            <span className="nx-label hidden truncate sm:inline">
              {td(view.yourDeckName)} · Σ{" "}
              <b className="nx-readout text-[12px] text-white/70">{view.yourSumOvr}</b>
            </span>
          }
        >
          <PlayerHand
            cards={view.yourHand}
            selectedUid={card}
            disabled={lock.locked}
            onPick={pickCard}
            /*
             * Defendiendo, la estadística ya está decidida por la tabla: lo único que el
             * jugador elige es CON QUÉ CARTA responder, así que se resalta ese eje en TODAS
             * las cartas y la comparación es de un vistazo. Atacando aún no hay eje, así que
             * solo se marca en la elegida.
             */
            highlightStat={(c) => (attacking ? (card === c.uid ? stat : null) : required)}
          />
        </HandTray>

        {/* FASE 33 · LA LÍNEA DE TURNOS, debajo de la mano (en `xl` vive en la columna lateral). */}
        {/* FASE 50 · con la barra de la partida (que ya pinta la pista de los diez), la línea tocable solo queda en móvil. */}
        <TurnTimeline view={view} rivalName={rivalName} className={cn(hudInTopBar ? "sm:hidden" : "xl:hidden", "lg:col-start-2")} />
      </div>
      </div>

      {/* ── Historial ── */}
      {/*
        La columna existe SIEMPRE a partir de `xl` para que la mesa no se mueva entre el turno
        1 y el 2. Y como existe siempre, en el turno 1 tiene que decir algo: una columna
        reservada y en blanco son 300 px de hueco muerto, que es justo lo que este rediseño
        viene a quitar.

        Por debajo de `xl` el historial NO tiene columna propia: es una fila más debajo del
        tablero, así que sin turnos jugados se esconde entero. Dejarlo puesto añadía 100 px
        de «aquí no hay nada» empujando la página en móvil y en 1024.
      */}
      {/*
        EL HISTORIAL, EN UN CAJÓN.

        Era una columna fija de 300 px con la parrilla de los diez turnos y la lista de lo
        ocurrido. Siempre abierta, siempre ocupando, y casi siempre vacía —en el turno 1 la
        mitad de la columna era un recuadro de puntos que decía «aquí se apunta cada turno»—.
        Consultar lo que ya pasó es una acción PUNTUAL; tenerlo desplegado a todas horas es
        lo que hacía que la arena tuviese forma de cuadro de mandos.

        Ahora es un cajón: cerrado no cuesta ni un píxel de tablero, abierto tapa la arena
        mientras se consulta y se cierra con Escape. La información es la misma —`TurnHistory`
        y `TurnTimeline` no se tocan—; lo que cambia es que ya no compite con la partida.
      */}
      <MatchHistoryDrawer view={view} rivalName={rivalName} hasHistory={hasHistory} />
    </div>
  );
}

/**
 * EL CAJÓN DEL HISTORIAL — Fase 45.
 *
 * Presentación pura: recibe la vista ya proyectada y no decide nada. El disparador vive
 * anclado al filo de la arena y dice cuántos turnos hay dentro, para que abrirlo sea una
 * decisión informada y no una exploración.
 */
function MatchHistoryDrawer({
  view, rivalName, hasHistory,
}: {
  view: DuelMatchView;
  rivalName: string;
  hasHistory: boolean;
}) {
  useLocale();
  const [open, setOpen] = useState(false);

  /* Escape cierra. Un cajón del que no se sale con Escape es un cajón roto. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {/*
        FASE 50 · En escritorio el disparador se ancla a la esquina inferior izquierda del estadio
        —donde un juego pone su registro—, fuera del recorrido de la mano. En móvil sigue debajo.
      */}
      {/* F71.2 · la esquina izquierda es ahora el lateral del rival: el disparador pasa al pie izquierdo de la MESA (`nx-history-anchor`). */}
      <div className="nx-history-anchor relative z-10 mt-2 flex justify-center lg:absolute lg:bottom-2 lg:left-0 lg:mt-0">
        <button
          type="button"
          data-testid="match-history-toggle"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
          className={cn(
            "nx-label nx-clip-sm border border-[#2fe0ff]/25 bg-black/55 px-3 py-2 text-white/65",
            "transition-colors duration-normal hover:border-[#2fe0ff]/60 hover:text-white",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70",
          )}
        >
          {t("Historial")}
          {hasHistory && (
            <b className="nx-readout ml-1.5 text-[11px] text-white/80">{view.history.length}</b>
          )}
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-50 flex justify-end"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: EASE.out }}
          >
            <button
              type="button"
              aria-label={t("Cerrar historial")}
              className="absolute inset-0 bg-black/70"
              onClick={() => setOpen(false)}
            />
            <motion.aside
              role="dialog"
              aria-modal="true"
              aria-label={t("Historial de la partida")}
              data-testid="match-history-drawer"
              initial={{ x: 40 }}
              animate={{ x: 0 }}
              exit={{ x: 40 }}
              transition={{ duration: 0.22, ease: EASE.out }}
              /* Se desplaza: el historial de una partida larga no cabe, y F44.1 dejó claro
                 que lo que desborda tiene que poder moverse. */
              className="relative h-full w-[min(92vw,340px)] overflow-y-auto border-l border-white/10 bg-[#080b14] p-4"
            >
              <div className="mb-3 flex items-center justify-between">
                <h2 className="nx-label">{t("Historial")}</h2>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="nx-label rounded-md px-2 py-1 text-white/45 hover:text-white/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70"
                >
                  {t("Cerrar")}
                </button>
              </div>

              {view.status === "IN_PROGRESS" && (
                <div className="mb-4">
                  <h3 className="nx-label mb-2 text-white/40">{t("Turnos")}</h3>
                  <TurnTimeline view={view} rivalName={rivalName} layout="block" />
                </div>
              )}

              {hasHistory ? (
                <TurnHistory turns={[...view.history].reverse()} />
              ) : (
                <p className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-center text-[11px] leading-relaxed text-white/30">
                  {t("Aquí se apunta cada turno en cuanto se resuelve.")}
                </p>
              )}
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/**
 * MARCADOR DE FLANCO — QUIÉN es este bando y cómo va.
 *
 * Es el mismo número que ya enseña la cabecera; aquí ocupa el ancho que sobraba a los lados
 * del enfrentamiento y lo hace junto a la carta de su bando, que es donde significa algo.
 *
 * ─────────────────────── FASE 8 · AHORA DICE CONTRA QUIÉN JUEGAS ───────────────────────
 *
 * Antes ponía «BOT» y «TÚ», y con eso la mesa no contestaba ni «¿contra quién juego?» ni
 * «¿este soy yo?». Debajo del marcador va ahora la FUERZA DEL MAZO de cada bando —la suma
 * de OVR—, y en tu lado el nombre del mazo con el que has entrado.
 *
 * Las dos cifras llegan calculadas del servidor (`yourSumOvr` / `rivalSumOvr`, que hasta hoy
 * viajaban en la vista y no las enseñaba nadie). No revelan ni una carta del rival: dicen lo
 * fuerte que es su mazo, que es exactamente lo que un jugador necesita para saber a qué se
 * enfrenta. Aquí no se calcula nada.
 */
function Marcador({
  lado, valor, nombre, fuerza, className, etiqueta,
}: {
  lado: "rival" | "tu";
  valor: number;
  /** Con quién juega este bando: la dificultad del bot o el nombre de tu mazo. */
  nombre: string;
  /**
   * Quién es este bando, en una palabra. En PvE el rival es «Bot»; en PvP es otra persona y
   * llamarla «Bot» es sencillamente falso — lo enseñó la QA en navegador de la arena.
   */
  etiqueta?: string;
  /** Suma de OVR del mazo, tal y como la manda el servidor. */
  fuerza: number;
  className?: string;
}) {
  useLocale();
  const rival = lado === "rival";
  const color = rival ? TONO_RIVAL : TONO_TU;
  return (
    <div
      className={cn("min-w-0 flex-col items-center", className)}
      /* FASE 50 · el hexágono del marcador toma el tono del bando por `--side` (tripleta RGB de la arena). */
      style={{ "--side": rival ? "var(--a50-opp)" : "var(--a50-ply)" } as React.CSSProperties}
    >
      <span
        className="mb-1 font-display text-[10px] font-bold uppercase tracking-[0.3em]"
        style={{ color: `${color}cc` }}
      >
        {rival ? td(etiqueta) ?? t("Bot") : t("Tú")}
      </span>
      {/*
        FASE 45 · EL MARCADOR SE MUEVE SOLO CUANDO CAMBIA. El número entra desde abajo al sumar un punto (la `key` es
        el propio valor) y el resto del tiempo está completamente quieto: nada de latido continuo.
        FASE 50 · dentro de un hexágono con el filo del bando, como el marcador de un evento.
      */}
      <b
        className="nx-a50-score nx-readout text-[clamp(34px,5.4vh,62px)] tabular-nums"
        style={{ color, textShadow: `0 0 26px ${color}aa` }}
      >
        <span className="relative inline-grid overflow-hidden align-bottom">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={valor}
              initial={{ y: 22, opacity: 0, scale: 1.25 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: -22, opacity: 0 }}
              transition={{ duration: 0.26, ease: EASE.out }}
              className="tabular-nums"
            >
              {valor}
            </motion.span>
          </AnimatePresence>
        </span>
      </b>
      <span className="mt-1.5 max-w-[130px] truncate text-center font-display text-[10px] font-bold uppercase tracking-[0.14em] text-white/55">
        {td(nombre)}
      </span>
      <span className="nx-label mt-0.5" title={t("Suma de OVR del equipo")}>
        Σ <b className="nx-readout text-[12px] text-white/70">{fuerza}</b>
      </span>
    </div>
  );
}

/**
 * Hueco de la mesa donde se posa una carta del enfrentamiento.
 *
 * Es la MISMA placa hundida que las posiciones de las bandas, solo que vez y media más
 * grande: eso es lo que la hace parte del tablero y no un recuadro punteado suelto en
 * medio. Y su tamaño no cambia al llenarse, porque si el hueco creciera al elegir carta el
 * tablero daría un salto justo en el momento en el que hay que estar mirándolo.
 */
function Hueco({
  children, label, filled, tone, active,
}: {
  children?: React.ReactNode;
  label: string;
  filled: boolean;
  tone: string;
  active?: boolean;
}) {
  return (
    <Slot
      tone={tone}
      filled={filled}
      active={active}
      label={filled ? undefined : td(label)}
      /*
       * FASE 8 · EN MÓVIL, LA CARTA EN JUEGO MANDA MÁS.
       *
       * A 390 px la carta del enfrentamiento medía 75 px y una carta de la mano 71: las dos
       * cosas pesaban lo mismo, así que la mesa no decía dónde estaba pasando el turno. Con
       * ×1,9 la carta en juego mide 95 y la jerarquía se ve sin leer nada.
       *
       * Los 28 px que cuesta salen del margen que devolvió la fila de posiciones: se gastan
       * justo en las prioridades 2 y 4 de móvil —carta del rival y carta tuya—, que es donde
       * tienen que estar.
       */
      /*
       * FASE 45 · LA CARTA EN JUEGO ES LA PROTAGONISTA, Y SE NOTA EN EL TAMAÑO.
       *
       * En escritorio medía ×1,5 —unos 120 px— contra los ~80 de una carta ya jugada. Mismo
       * orden de magnitud: el ojo no tenía forma de saber, sin leer, dónde está ocurriendo el
       * turno. Ahora es ×2,05 (~165 px) y las filas de lo jugado bajan a ×0,82, así que entre
       * la carta que pelea y la que ya peleó hay un factor 2,5. La jerarquía se ve de un
       * vistazo, que es justo lo que se le pide a una arena.
       *
       * El alto que cuesta sale de las dos filas de posiciones, no del pliegue: la mano sigue
       * cabiendo (se verifica en `match-responsive:verify`).
       */
      /*
       * FASE 50 · ×2,3 en escritorio: la carta del duelo es, con diferencia, la más grande de la
       * pantalla —la de la mano mide ~1,4 posiciones y la ya jugada 0,6—. DUEL ★★★★★ · MANO ★★★ ·
       * HISTORIAL ★.
       */
      className="aspect-[5/7] w-[calc(var(--pos)*1.9)] sm:w-[calc(var(--pos)*2.3)]"
    >
      {children}
    </Slot>
  );
}

/**
 * LA PLACA CENTRAL — lo que convierte el centro en el corazón del duelo.
 *
 * El centro de la mesa era un rótulo flotando entre dos cartas. Ahora es una PIEZA: un
 * disco técnico con el sello VS grabado, la comparación de ejes debajo y dos brazos que lo
 * atan a las dos posiciones vivas. Sigue siendo el mismo `ClashBanner` de siempre —los
 * mismos ejes, las mismas cifras, la misma regla de «un título solo si los dos pelean en el
 * mismo eje»—, montado sobre un soporte en vez de suelto en el aire.
 *
 * En pantallas estrechas no cabe una columna de 240 px entre las dos cartas, así que ahí
 * queda solo el disco y la comparación baja debajo de la zona.
 */
function PlacaCentral({
  role, ready, youStat, youValue, rivalStat, rivalValue, hint,
}: {
  /** F61 · quién ataca, en grande, con icono y texto (`roleBanner`, desde la vista del servidor). */
  role: RoleBanner;
  ready: boolean;
  youStat: CombatStatKey | null;
  youValue: number | null;
  rivalStat: CombatStatKey | null;
  rivalValue: number | null;
  hint: string;
}) {
  useLocale();
  return (
    <div className="flex w-[clamp(52px,9vw,86px)] shrink-0 flex-col items-center gap-1.5 md:w-[min(30vw,300px)]">
      {/*
        FASE 61 · ATACAS / DEFIENDES, EN GRANDE. Era una etiqueta de 9 px bajo el turno de la barra: había que buscar
        quién atacaba. Ahora es lo primero que se lee en el centro de la mesa, con icono y texto (no solo color). En
        móvil no cabe aquí: lo dice la cinta del turno, con el mismo icono.
      */}
      {role.kind !== "NONE" && (
        <div
          className="nx-f61-role hidden flex-col items-center md:flex"
          data-testid="role-banner"
          data-role={role.kind}
          role="status"
        >
          <span className="flex items-center gap-2 font-display text-[clamp(20px,2.3vw,30px)] font-extrabold uppercase italic leading-none tracking-[0.05em]">
            <RoleIcon kind={role.kind} className="h-[0.9em] w-[0.9em]" />
            {td(role.title)}
          </span>
          <span className="mt-1 font-display text-[10px] font-bold uppercase tracking-[0.18em] text-white/65">{td(role.sub)}</span>
        </div>
      )}
      {/*
        FASE 50 · EL SELLO ES EL PROTAGONISTA DEL CENTRO. Un «VS» itálico enorme —rojo entrando por
        el lado del rival, cian por el tuyo— sobre un anillo de energía que gira muy despacio. Late
        suave y, cuando las dos cartas están puestas, se enciende. Con movimiento reducido se queda
        quieto; lo que dice no cambia.
      */}
      <span aria-hidden className="relative grid shrink-0 place-items-center px-2 py-1">
        <span className="nx-a50-vs-ring" />
        <span className="nx-a50-vs-pulse relative block">
          <span className="nx-a50-vs block font-display" data-ready={ready ? "true" : "false"}>
            {t("VS")}
          </span>
        </span>
      </span>

      {/* La comparación de ejes. Solo donde hay ancho para ella; si no, baja bajo la zona. */}
      <ClashBanner
        className="hidden w-full md:flex"
        youStat={youStat}
        youValue={youValue}
        rivalStat={rivalStat}
        rivalValue={rivalValue}
        hint={td(hint)}
      />
    </div>
  );
}

/** AJUSTE · nombre accesible de la carta comprometida: boca abajo + su pista y su rol públicos (nunca quién es). */
function committedLabel(p: NonNullable<DuelMatchView["pendingRival"]>): string {
  const pista = p.hint ? hintPresentation(p.hint)?.ariaLabel.replace(/^Carta oculta · /, "") : null;
  return [t("Carta del rival, boca abajo hasta que respondas"), pista, p.role ? t("rol {role}", { role: td(p.role) }) : null].filter(Boolean).join("; ");
}
