"use client";

/**
 * THE DUEL MOMENT — la revelación del enfrentamiento.
 *
 * Es el momento importante de la partida: las dos cartas boca arriba, sus valores y quién
 * gana. NO decide nada: recibe el turno YA RESUELTO por el Combat Resolver y lo enseña.
 *
 * ────────────────────────── QUÉ FALLABA ──────────────────────────
 *
 * Tres cosas, y las tres se veían en una sola captura:
 *
 *   1. **El ganador brillaba en ROJO, siempre.** El resplandor estaba escrito a fuego como
 *      `rgba(255,46,99,…)`, que en el lenguaje del tablero es el color del RIVAL. Ganar un
 *      turno iluminaba tu carta con el color del enemigo. Ahora cada bando gana con SU color.
 *   2. **Las dos cartas eran simétricas y sin bando.** Una a la izquierda, otra a la derecha,
 *      idénticas salvo dos etiquetas de nueve píxeles («Tú» / «Bot»). El tablero enseña rival
 *      ARRIBA y jugador ABAJO; la revelación tiraba ese mapa por la borda y había que leer
 *      para saber cuál era la tuya.
 *   3. **Todo aparecía a la vez.** Cartas, estadísticas, veredicto y marcador entraban casi
 *      juntos, así que no había enfrentamiento: había una ficha con el resultado ya escrito.
 *
 * ────────────────────────── CÓMO SE RESUELVE ──────────────────────────
 *
 * Se coloca en VERTICAL y con el mismo mapa que la mesa —rival arriba, tú abajo— para que las
 * cartas caigan desde donde estaban, y se reparte en CUATRO tiempos:
 *
 *     0 ms    las dos cartas entran desde su lado          ENFRENTAMIENTO
 *   260 ms    aparecen el eje y las dos cifras             REVELACIÓN
 *   520 ms    el perdedor se apaga, el ganador se afirma   COMPARACIÓN
 *   760 ms    el veredicto y el marcador                   RESULTADO
 *
 * **No cambia ni un milisegundo la duración lógica del turno.** `autoCloseMs` sigue siendo el
 * mismo y el estado ya está aplicado cuando esto se monta: la secuencia ocupa 1 s de los 2,6 s
 * que la ficha ya estaba en pantalla. Se puede cerrar en cualquier momento sin romper nada.
 *
 * Con `prefers-reduced-motion` los cuatro tiempos se colapsan a un fundido: la preferencia
 * pide no ver movimiento, no ver el mismo movimiento más despacio. **Ningún dato desaparece.**
 */
import { useEffect } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/format";
import { DuelCard, DuelCardBack } from "./DuelCard";
import { playCue, playSound } from "@/lib/sound";
import { EASE } from "@/design/motion";
import { STAT_INFO, type DuelDeckCardDTO, type DuelTurnView } from "@/lib/duel/types";
import { roundVerdict } from "@/lib/duel/gameplayUx";
import { explainTurn } from "@/lib/duel/experience";
import { trackExperience } from "@/lib/duel/experienceTelemetry";
import { buzz } from "@/lib/haptics";
import { ARENA_ACCENT } from "@/lib/duel/arenas";
import { CLIMAX_LABEL, climaxLevel, momentBeats, momentHoldMs, statReveal } from "@/lib/duel/matchFlow";
import { RoleIcon } from "./experience/RoleIcon";

/**
 * Los tonos de bando del tablero. Los mismos, y por el mismo motivo. FASE 50: salen de la
 * configuración de la arena —cian tú, rojo el rival, ámbar el empate—.
 */
const TONO = { tu: ARENA_ACCENT.player, rival: ARENA_ACCENT.opponent, empate: ARENA_ACCENT.draw } as const;

/*
 * FASE 61 · LOS TIEMPOS VIVEN EN `lib/duel/matchFlow` (`MOMENT_BEATS`): cartas → ESTADÍSTICA → valores → tensión →
 * comparación → veredicto. Antes eran cuatro (0 · 0,26 · 0,52 · 0,76 s) y la estadística salía A LA VEZ que las
 * cifras: no había revelación del eje, solo una ficha con el resultado escrito. Con movimiento reducido la
 * secuencia ya no se colapsa a 0: se conserva con fundidos (el usuario la ve así en su PC).
 */

export function DuelMoment({
  turn, yourCard, rivalCard, onClose, autoCloseMs, totalTurns = 10,
}: {
  turn: DuelTurnView;
  /** FASE 33 · para marcar el último turno. Dato de la vista (`totalTurns`), no una regla. */
  totalTurns?: number;
  yourCard: DuelDeckCardDTO;
  rivalCard: DuelDeckCardDTO;
  onClose: () => void;
  autoCloseMs?: number;
}) {
  const reduced = useReducedMotion();
  /* FASE 61 · el tramo de la partida (presentación): los dos últimos turnos pesan más; ninguna regla cambia. */
  const climax = climaxLevel(turn.number, totalTurns);
  const T = momentBeats(!!reduced);
  const hold = autoCloseMs ?? momentHoldMs(climax, !!reduced);
  /* El eje del turno tal y como lo guardó el servidor: quién declaró y con qué respondió el otro. */
  const eje = statReveal(turn);

  // Se cierra sola, pero el estado del turno YA está aplicado: si el jugador cierra antes o el
  // temporizador se pierde, la partida sigue siendo correcta.
  useEffect(() => {
    trackExperience("turn_reveal");
    const id = window.setTimeout(onClose, hold);
    return () => window.clearTimeout(id);
  }, [onClose, hold, turn.number]);

  /* El eje se revela con su propio golpe de sonido, antes que las cifras. */
  useEffect(() => {
    const id = window.setTimeout(() => playSound("stat.reveal"), T.stat * 1000);
    return () => window.clearTimeout(id);
  }, [turn.number, T.stat]);

  /* Teclado: Intro, Espacio o Escape pasan al siguiente turno (como la intro y el golpe final). */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " " || e.key === "Escape") { e.preventDefault(); onClose(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const youWin = turn.outcome === "A";
  const rivalWin = turn.outcome === "B";
  const tie = turn.outcome === "TIE";

  /*
   * El cue suena cuando suena el veredicto, no al montar: el sonido forma parte de la
   * comparación, y adelantarlo destriparía el resultado antes de que se vea.
   */
  useEffect(() => {
    const id = window.setTimeout(
      () => { playCue(tie ? "ui" : youWin ? "round_win" : "round_lose"); buzz("point"); trackExperience("turn_result_view"); },
      T.verdict * 1000,
    );
    return () => window.clearTimeout(id);
  }, [turn.number, youWin, tie, T.verdict]);

  /* El veredicto y su lectura, con los NOMBRES REALES de las estadísticas (Fase 26). */
  const v = roundVerdict(turn);
  /* FASE 33 · titular «PUNTO PARA TI / PARA EL RIVAL / EMPATE» y el porqué, derivados del turno del servidor. */
  const exp = explainTurn(turn);
  const verdict = v.title;
  const tono = tie ? TONO.empate : youWin ? TONO.tu : TONO.rival;

  /** Retardo de un tiempo de la secuencia (F61: también con movimiento reducido, más corto y sin desplazamiento). */
  const at = (t: number): number => t;

  return (
    <motion.div
      role="dialog"
      aria-live="polite"
      aria-label={`Turno ${turn.number}: ${verdict}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      /*
       * FASE 50 · LA RESOLUCIÓN OCURRE EN LA ARENA. Era un velo casi opaco con desenfoque: se salía del
       * juego para abrir una ficha. Ahora el velo solo oscurece el centro —donde se lee— y deja ver el
       * estadio por los bordes, sin `backdrop-blur` (caro y, sobre todo, de web).
       */
      className="nx-a50-moment fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4"
      data-f61="moment"
      data-climax={climax}
      data-outcome={turn.outcome}
      onClick={onClose}
    >
      {/*
        El halo del resultado tiñe la sala entera con el color de quien ha ganado. Es lo que
        responde a «¿he ganado?» antes de leer una sola palabra, y es UN nodo con una
        transición, no un efecto en bucle.
      */}
      <motion.span
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: at(T.compare), duration: 0.45 }}
        style={{ background: `radial-gradient(120% 80% at 50% ${youWin ? "100%" : rivalWin ? "0%" : "50%"}, ${tono}2e, transparent 70%)` }}
      />

      {/*
        FASE 50 · LA ONDA DEL CHOQUE. Un anillo del color de quien gana que sale del centro en el
        tiempo de la COMPARACIÓN, una sola vez (620 ms). Solo `transform`/`opacity`; con movimiento
        reducido no existe.
      */}
      {!reduced && (
        <span
          aria-hidden
          className="nx-a50-shock"
          style={{ "--shock": `${tono}`, "--shock-delay": `${T.compare * 1000}ms` } as React.CSSProperties}
        />
      )}

      {/*
        FASE 45 · EL ENFRENTAMIENTO SE COMPONE EN ESPEJO.

        Era una columna de 600 px con dos filas identicas: carta a la izquierda, cifra a la
        derecha, y entre la cifra y el borde un hueco muerto de ~250 px. Dos filas iguales
        apiladas no son un enfrentamiento: son una lista de dos elementos.

        Ahora los dos bandos se MIRAN. El rival entra desde arriba con su carta a la izquierda;
        tu entras desde abajo con la tuya a la derecha (`espejo`), y el eje queda en medio de
        las dos. La cifra de cada uno viaja pegada a su carta, asi que el hueco muerto no se
        reduce: deja de existir, y lo que queda en el centro es el choque.
      */}
      <div className="relative w-full max-w-[min(96vw,1080px)] py-2" onClick={(e) => e.stopPropagation()}>
        {/*
          FASE 61 · QUIÉN ATACA, CON ICONO Y TEXTO (no solo color). Y el tramo: «Recta final» / «Último turno».
        */}
        <div className="mb-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center" data-testid="moment-header">
          <span className="font-display text-[11px] font-bold uppercase tracking-[0.24em] text-white/60">Turno {turn.number} de {totalTurns}</span>
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-display text-[11px] font-bold uppercase tracking-[0.16em]"
            style={{ color: turn.attacker === "A" ? TONO.tu : TONO.rival, boxShadow: `inset 0 0 0 1px ${turn.attacker === "A" ? TONO.tu : TONO.rival}66` }}
            data-role={turn.attacker === "A" ? "ATTACK" : "DEFENSE"}
          >
            <RoleIcon kind={turn.attacker === "A" ? "ATTACK" : "DEFENSE"} className="h-3.5 w-3.5" />
            {turn.attacker === "A" ? "Atacas tú" : "Defiendes"}
          </span>
          {CLIMAX_LABEL[climax] && (
            <span className="font-display text-[11px] font-bold uppercase tracking-[0.2em] text-drl-gold" data-testid="moment-climax">
              {CLIMAX_LABEL[climax]}
            </span>
          )}
        </div>

        {/*
          FASE 50 · EL DUELO, FRENTE A FRENTE. En móvil sigue el mapa de la mesa —rival arriba, tú
          abajo—; a partir de `md` las dos cartas se enfrentan en horizontal, como en la zona de
          duelo del tablero (rival a la izquierda, tú a la derecha) con el VS en medio.
        */}
        <div className="flex flex-col items-stretch md:flex-row md:items-center md:justify-center md:gap-[clamp(12px,2.6vw,40px)]">
          {/* RIVAL — el mismo lado que ocupa en la zona de duelo. */}
          <Bando
            card={rivalCard} side={turn.rival} label="Rival" tono={TONO.rival}
            win={rivalWin} lose={youWin} from={-46} reduced={!!reduced} at={at} beats={T}
            flip
          />

          {/* El eje del enfrentamiento, entre las dos cartas. */}
          <div className="my-2 flex flex-col items-center gap-1.5 md:my-0 md:w-[clamp(150px,18vw,230px)]">
            <motion.div
              className="flex w-full items-center gap-3 md:flex-col md:gap-2"
              initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 1.6 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: at(T.cards), duration: 0.28, ease: EASE.out }}
            >
              <span className="h-px flex-1 md:hidden" style={{ background: `linear-gradient(90deg, transparent, ${tono}66)` }} />
              <span aria-hidden className="relative grid shrink-0 place-items-center px-2">
                <span className="nx-a50-vs-ring" />
                <span className="nx-a50-vs relative block font-display !text-[clamp(30px,6vh,64px)]" data-ready="true">VS</span>
              </span>
              <span className="sr-only">contra</span>
              <span className="h-px flex-1 md:hidden" style={{ background: `linear-gradient(90deg, ${tono}66, transparent)` }} />
            </motion.div>

            {/*
              FASE 61 · LA ESTADÍSTICA SE REVELA ANTES QUE LAS CIFRAS. El eje que DECLARÓ el atacante y el que la
              tabla IMPUSO al defensor, tal y como los guardó el servidor en el turno. Primero se sabe EN QUÉ se
              pelea; después, cuánto vale cada uno.
            */}
            {eje && (
              <motion.div
                className="nx-f61-axis text-center"
                data-testid="moment-axis"
                data-declared={eje.declared}
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8, scale: 1.25 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ delay: at(T.stat), duration: 0.28, ease: EASE.out }}
              >
                <span className="nx-label block !text-[9px]">{eje.attacker === "YOU" ? "Declaras" : "Declara el rival"}</span>
                <b className="block font-display text-[clamp(16px,2.4vw,24px)] font-extrabold uppercase leading-none tracking-[0.06em]" style={{ color: STAT_INFO[eje.declared].color }}>
                  {eje.declaredLabel}
                </b>
                {eje.answered !== eje.declared && (
                  <span className="mt-0.5 block font-display text-[10px] font-bold uppercase tracking-[0.16em] text-white/60">
                    responde con <span style={{ color: STAT_INFO[eje.answered].color }}>{eje.answeredLabel}</span>
                  </span>
                )}
              </motion.div>
            )}
          </div>

          {/* TÚ — igual que en la zona de duelo. */}
          <Bando
            card={yourCard} side={turn.you} label="Tú" tono={TONO.tu}
            win={youWin} lose={rivalWin} from={46} reduced={!!reduced} at={at} beats={T}
            espejo
          />
        </div>

        {/* RESULTADO — el último tiempo. */}
        <motion.div
          initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 1.18 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: at(T.verdict), duration: 0.3, ease: EASE.out }}
          className="mt-4 text-center"
        >
          <p
            className="font-display text-[clamp(26px,4.6vh,48px)] font-extrabold uppercase italic leading-none tracking-wide"
            style={{ color: tono, textShadow: `0 0 34px ${tono}88, 0 3px 0 rgba(0,0,0,0.6)` }}
          >
            {exp.headline}
          </p>
          {/* FASE 33 · la frase explica; la línea de datos debajo, en pequeño (sin decir dos veces lo mismo). */}
          <p className="mx-auto mt-1.5 max-w-[46ch] text-[13px] text-white/85" data-reason={exp.reason}>{exp.text}</p>
          <p className="mt-1 font-display text-[10px] uppercase tracking-[0.16em] text-white/40" data-round={v.kind}>
            {v.detail}
          </p>
          {v.note && exp.reason !== "STAT_DRAW" && <p className="mt-0.5 text-xs text-white/45">{v.note}</p>}
          <p className="nx-readout mt-2 text-[clamp(22px,3.2vh,32px)] tabular-nums" data-testid="moment-score">
            <span style={{ color: TONO.tu, textShadow: `0 0 16px ${TONO.tu}88` }}>{turn.scoreAfterYou}</span>
            <span className="text-white/25"> – </span>
            <span style={{ color: TONO.rival, textShadow: `0 0 16px ${TONO.rival}88` }}>{turn.scoreAfterRival}</span>
          </p>
        </motion.div>

        <button
          type="button"
          onClick={onClose}
          className="nx-clip-sm mx-auto mt-4 block border border-white/20 bg-black/50 px-6 py-2 text-[11px] font-bold uppercase tracking-[0.18em] text-white/75 transition hover:border-white/50 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2fe0ff]"
        >
          Continuar
        </button>
      </div>
    </motion.div>
  );
}

/**
 * UN BANDO DEL ENFRENTAMIENTO — su carta, su eje y su cifra, con SU color.
 *
 * La carta y la cifra van en la misma fila para que la comparación sea de arriba abajo: dos
 * números grandes, uno encima del otro, con el eje declarado al lado de cada uno. El perdedor
 * no se esconde —sigue siendo información— pero se apaga, y el ganador se afirma con el tono
 * de su bando, que es el mismo que tiñe su zona en la mesa.
 */
function Bando({
  card, side, label, tono, win, lose, from, reduced, at, beats, espejo = false, flip = false,
}: {
  card: DuelDeckCardDTO;
  side: DuelTurnView["you"];
  label: string;
  tono: string;
  win: boolean;
  lose: boolean;
  from: number;
  reduced: boolean;
  at: (t: number) => number;
  /** F61 · los tiempos de la secuencia (`MOMENT_BEATS`). */
  beats: { stat: number; values: number; compare: number };
  /** El bando de abajo se compone al reves para que los dos se miren. */
  espejo?: boolean;
  /**
   * DUEL GAMEPLAY UX 2.0 · LA REVELACIÓN. La carta del rival estaba boca abajo hasta que tu respuesta quedó comprometida:
   * aquí GIRA (reverso → cara). La cara está detrás (`backface-visibility: hidden`) hasta girar: ningún destello antes de
   * tiempo. Con movimiento reducido no hay giro 3D: la carta aparece con el fundido de siempre.
   */
  flip?: boolean;
}) {
  const info = STAT_INFO[side.stat];
  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: from, scale: 0.92 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: at(0), duration: 0.34, ease: EASE.out }}
      className={cn(
        /*
         * La placa se ajusta al grupo (`w-fit`). A todo el ancho era un panel de 860 px con las
         * cartas dentro -exactamente la lectura que esta fase viene a quitar-. Ajustada, el
         * tinte del bando envuelve a la carta y a su cifra y nada mas: deja de ser un contenedor
         * y pasa a ser el aura del que pelea.
         */
        "nx-clip-sm relative mx-auto flex w-fit max-w-full items-center gap-[clamp(10px,3vw,34px)] px-[clamp(10px,2vw,22px)] py-2.5",
        /*
         * Hacia el centro. Con el grupo anclado al borde quedaba un cuarto de la fila vacio al
         * otro lado, y las dos cartas acababan en esquinas opuestas: una diagonal, no un choque.
         * Centrado, cada bando lleva su cifra pegada a su carta y los dos grupos caen sobre el
         * mismo eje vertical, con el sello VS justo en medio.
         *
         * FASE 50 · a partir de `md` cada bando es una COLUMNA —carta grande arriba, eje y cifra
         * debajo— y los dos se enfrentan en horizontal a los lados del VS.
         */
        espejo ? "flex-row-reverse justify-center md:flex-col md:gap-3" : "justify-center md:flex-col md:gap-3",
      )}
      style={{
        background: `radial-gradient(80% 70% at 50% 40%, ${tono}1f, transparent 72%)`,
      }}
    >
      {/* El filo del bando: una barra de color bajo su carta, como el raíl de su zona. */}
      <span
        aria-hidden
        className="absolute inset-x-6 bottom-0 h-[2px] rounded-full"
        style={{ background: `linear-gradient(90deg, transparent, ${tono}, transparent)`, boxShadow: `0 0 12px ${tono}` }}
      />

      {/*
        La carta se AFIRMA o se APAGA en el tercer tiempo. Se anima solo `transform`,
        `opacity` y `filter` de sombra — nada que provoque layout.
      */}
      <motion.div
        initial={{ scale: 1, opacity: 1 }}
        animate={{ scale: win && !reduced ? 1.06 : 1, opacity: lose ? 0.5 : 1 }}
        transition={{ delay: at(beats.compare), duration: 0.3, ease: EASE.out }}
        className="relative"
      >
        {/* El aura del ganador va sobre la silueta de la carta (`glow`), no en una caja alrededor. */}
        {/*
          La carta del enfrentamiento es la carta mas grande que ve el jugador en toda la
          partida. Debajo de 140 px competia con las de la mano, que estan a 92: el momento
          en el que dos cartas pelean tiene que pesar mas que la bandeja desde la que salen.
        */}
        {flip && !reduced ? (
          <div className="relative" style={{ perspective: 900 }} data-testid="reveal-flip">
            <motion.div
              initial={{ rotateY: 180 }}
              animate={{ rotateY: 0 }}
              transition={{ delay: at(0) + 0.12, duration: 0.5, ease: EASE.out }}
              className="relative"
              style={{ transformStyle: "preserve-3d" }}
            >
              <div style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden" }}>
                <DuelCard card={card} size="lg" highlightStat={side.stat} glow={win ? `${tono}cc` : null} className="!w-[110px] sm:!w-[150px] md:!w-[clamp(150px,24vh,250px)]" />
              </div>
              <div aria-hidden className="absolute inset-0" style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden", transform: "rotateY(180deg)" }}>
                <DuelCardBack size="lg" className="!w-full" />
              </div>
            </motion.div>
          </div>
        ) : (
          <DuelCard card={card} size="lg" highlightStat={side.stat} glow={win ? `${tono}cc` : null} className="!w-[110px] sm:!w-[150px] md:!w-[clamp(150px,24vh,250px)]" />
        )}
      </motion.div>

      <div className={cn("min-w-0 md:text-center", espejo && "text-right")}>
        <span className="nx-label block" style={{ color: `${tono}bb` }}>{label}</span>
        <motion.span
          className="block font-display text-[10px] font-extrabold uppercase tracking-[0.2em]"
          style={{ color: info.color }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: at(beats.stat), duration: 0.22 }}
        >
          {info.label}
        </motion.span>
        <motion.div
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.8 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ delay: at(beats.values), duration: 0.26, ease: EASE.out }}
        >
          <div className={cn("flex items-center gap-3 md:justify-center", espejo && "flex-row-reverse")}>
            <motion.b
              className="nx-readout block text-[clamp(44px,min(11vw,9vh),88px)] leading-[0.92]"
              data-testid="moment-value"
              animate={{ opacity: lose ? 0.5 : 1 }}
              transition={{ delay: at(beats.compare), duration: 0.3 }}
              style={{ color: win ? tono : "#eef1f8" }}
            >
              {side.value}
            </motion.b>

            {/*
              EL SELLO, PEGADO A SU CIFRA. Estuvo un rato en la esquina de la placa y quedaba
              huérfano a 300 px del número que califica: un sello lejos de lo que sella no
              sella nada. Aquí se lee de un golpe con el valor ganador.
            */}
            {win && (
              <motion.span
                aria-hidden
                initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 1.7, rotate: -14 }}
                animate={{ opacity: 1, scale: 1, rotate: -5 }}
                transition={{ delay: at(beats.compare + 0.08), duration: 0.28, ease: EASE.spring }}
                className="shrink-0 rounded-[3px] px-2 py-0.5 font-display text-[11px] font-bold uppercase tracking-normal"
                style={{ color: tono, boxShadow: `inset 0 0 0 1.5px ${tono}88`, background: "rgba(6,8,14,0.92)" }}
              >
                Gana
              </motion.span>
            )}
          </div>
        </motion.div>
      </div>


    </motion.div>
  );
}
