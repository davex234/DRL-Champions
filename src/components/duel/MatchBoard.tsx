"use client";

/**
 * PANTALLA PRINCIPAL DEL DUELO (Fase 8, recompuesta en 9.6).
 *
 * Su único trabajo sigue siendo el mismo:
 *   1. enseñar el estado que devolvió el servidor,
 *   2. recoger DOS decisiones —qué carta y, si atacas, qué estadística—,
 *   3. enviarlas y volver a enseñar el estado nuevo.
 *
 * Aquí no se compara ni un número, no se cuenta ni un punto y no se decide ni un ganador.
 * Ni siquiera se sabe qué estadística debe responder el defensor: la manda el servidor en
 * `requiredStat`, calculada con la tabla del dominio. **Nada de eso cambia en 9.6.**
 *
 * ───────────────────────── QUÉ SE RECOMPONE Y POR QUÉ ─────────────────────────
 *
 * En la captura `06-arena-turno1` la arena son **cuatro paneles grises apilados**, todos
 * con el mismo borde y el mismo fondo: marcador, rival, mesa y mano. La mesa —que es el
 * sitio donde ocurre el juego— es el mismo rectángulo que el resto, con una carta pequeña
 * a un lado y mucho vacío. No hay un «dentro»; hay una lista de secciones.
 *
 * Tres cambios, y ninguno toca una regla:
 *
 * **1. La mesa deja de ser un panel y pasa a ser un ESCENARIO.** Suelo en perspectiva, luz
 *    cenital sobre el punto de choque y las dos cartas grandes enfrentadas con el medallón
 *    del VS en medio. La profundidad no es decorado: es lo que dice dónde está el foco.
 *
 * **2. El rival es el LADO CONTRARIO, no la sección de arriba.** Su banda va teñida, con
 *    la luz entrando desde arriba y las cartas más pequeñas. Un tablero se lee por
 *    bandos; la versión anterior se leía por apartados.
 *
 * **3. Un solo marcador.** Había dos —la barra de la arena y el panel `Scoreboard`— con
 *    los mismos números. Ahora el marcador vive en la propia cabecera del escenario, con
 *    las cifras a tamaño de marcador y la pista de turnos debajo.
 *
 * La mano, el orden en móvil, la selección, la confirmación y las etiquetas de los botones
 * se conservan **literalmente**: el recorrido automatizado (`duel:e2e`) juega la partida
 * entera buscando esos textos y esos `aria-label`, y una arena más bonita que rompe la
 * verificación no vale nada.
 */
import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/format";
import { DuelCard, DuelCardBack } from "./DuelCard";
import { TurnTrack } from "./Scoreboard";
import { TurnHistory } from "./TurnHistory";
import { DIFFICULTY_INFO, STAT_INFO, type CombatStatKey, type DuelMatchView } from "@/lib/duel/types";
import { EASE } from "@/design/motion";

const STATS: CombatStatKey[] = ["stronghold", "gamesense", "entryfrag"];

export function MatchBoard({
  view, onPlay, busy, error, onDismissError,
}: {
  view: DuelMatchView;
  onPlay: (cardUid: string, stat?: CombatStatKey) => void;
  busy: boolean;
  error: string | null;
  onDismissError: () => void;
}) {
  const [card, setCard] = useState<string | null>(null);
  const [stat, setStat] = useState<CombatStatKey | null>(null);

  const attacking = view.youAreAttacker;
  const chosen = useMemo(() => view.yourHand.find((c) => c.uid === card) ?? null, [view.yourHand, card]);

  // Si la mano cambia (turno nuevo), la selección deja de ser válida.
  const stale = card !== null && !view.yourHand.some((c) => c.uid === card);
  if (stale) { setCard(null); setStat(null); }

  const step: 1 | 2 = attacking ? (chosen ? 2 : 1) : 1;
  const ready = attacking ? Boolean(chosen && stat) : Boolean(chosen);

  function confirm() {
    if (!chosen || busy) return;
    onPlay(chosen.uid, attacking ? stat ?? undefined : undefined);
    setCard(null);
    setStat(null);
  }

  const required = view.requiredStat;
  /** Con cero turnos jugados no hay nada que contar y la columna sobra. */
  const hasHistory = view.history.length > 0;

  return (
    /*
      La columna de historial SOLO aparece cuando hay turnos jugados.
      En el turno 1 ocupaba 300 px —un tercio del ancho útil de la arena— para decir «aún
      no se ha jugado ningún turno». Que la mesa arranque a lo ancho y la columna entre
      cuando hay algo que contar es, además, la progresión natural de la partida.
    */
    <div className={cn("grid gap-4", hasHistory && "lg:grid-cols-[minmax(0,1fr)_300px]")}>
      <div className="flex min-w-0 flex-col">
        {/* ═══════════ MARCADOR ═══════════ */}
        <ArenaScore view={view} className="order-1" />

        {/* ═══════════ LADO DEL RIVAL ═══════════ */}
        <section
          className="order-2 relative mt-3 overflow-hidden rounded-panel border border-drl/20 px-4 py-3"
          style={{
            background:
              "linear-gradient(180deg, rgba(255,46,99,0.13), rgba(255,46,99,0.03) 70%, transparent)",
          }}
          aria-label="Rival"
        >
          {/* La luz del bando contrario entra desde arriba: es «el otro lado de la mesa». */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 -top-16 h-32"
            style={{ background: "radial-gradient(60% 100% at 50% 100%, rgba(255,46,99,0.28), transparent 70%)" }}
          />

          <div className="relative mb-2 flex items-center justify-between">
            <span className="nx-label !text-drl/70">
              Rival · {view.rivalRemaining} {view.rivalRemaining === 1 ? "carta" : "cartas"}
            </span>
            <span className="nx-label">{DIFFICULTY_INFO[view.difficulty].label}</span>
          </div>

          {view.pendingRival ? (
            <motion.div
              key={view.pendingRival.card.uid}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="relative flex items-center gap-4"
            >
              <DuelCard card={view.pendingRival.card} size="sm" highlightStat={view.pendingRival.stat} />
              <div className="min-w-0">
                <span className="nx-label !text-drl-glow">El rival declara</span>
                <b className="mt-0.5 block truncate font-display text-2xl font-bold uppercase leading-none">
                  {view.pendingRival.card.nick}
                </b>
                <div className="mt-2 flex items-baseline gap-2.5">
                  <span
                    className="font-display text-[11px] font-bold uppercase tracking-[0.14em]"
                    style={{ color: STAT_INFO[view.pendingRival.stat].color }}
                  >
                    {STAT_INFO[view.pendingRival.stat].label}
                  </span>
                  <span
                    className="nx-readout text-4xl"
                    style={{ color: STAT_INFO[view.pendingRival.stat].color }}
                  >
                    {view.pendingRival.value}
                  </span>
                </div>
              </div>
            </motion.div>
          ) : (
            <div className="relative flex flex-wrap gap-1.5">
              {Array.from({ length: Math.min(view.rivalRemaining, 10) }, (_, i) => (
                <DuelCardBack key={i} size="xs" />
              ))}
              {view.rivalRemaining === 0 && (
                <span className="text-xs text-white/30">Sin cartas.</span>
              )}
            </div>
          )}
        </section>

        {/* ═══════════ LA MESA ═══════════ */}
        {/*
          Defendiendo, la decisión es «con qué carta respondo»: en móvil la mano sube por
          delante del panel de acción para no tener que desplazarse entre la declaración
          del rival y las cartas. En pantallas grandes cabe todo y el orden se mantiene.
        */}
        <section
          className={cn(
            "nx-stage nx-clip relative mt-3 overflow-hidden px-3 py-4 sm:px-5 sm:py-5 sm:order-3",
            attacking ? "order-3" : "order-4",
          )}
          aria-live="polite"
        >
          {/*
            SUELO. Una retícula en perspectiva que se pierde hacia el fondo. Es la pieza que
            convierte «dos cartas en una caja» en «dos cartas SOBRE una mesa»: sin plano de
            apoyo, un objeto no está en ningún sitio.
          */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[62%] opacity-80"
            style={{
              backgroundImage:
                "linear-gradient(rgba(255,255,255,0.16) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.16) 1px, transparent 1px)",
              backgroundSize: "64px 64px",
              transform: "perspective(260px) rotateX(60deg)",
              transformOrigin: "bottom center",
              maskImage: "linear-gradient(to top, rgba(0,0,0,0.95), transparent 80%)",
              WebkitMaskImage: "linear-gradient(to top, rgba(0,0,0,0.95), transparent 80%)",
            }}
          />
          {/* Luz cenital sobre el punto de choque. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-full"
            style={{ background: "radial-gradient(46% 62% at 50% 22%, rgba(255,255,255,0.09), transparent 70%)" }}
          />

          <div className="relative flex flex-wrap items-center gap-2">
            <StepPill n={1} active={step === 1} done={Boolean(chosen)}>
              {attacking ? "Elige tu carta" : "Responde con una carta"}
            </StepPill>
            {attacking && (
              <StepPill n={2} active={step === 2} done={Boolean(stat)}>
                Declara la estadística
              </StepPill>
            )}
          </div>

          {/*
            EL CHOQUE. Tu carta contra la del rival, con el medallón del VS en medio. Las
            cartas van a tamaño `md` en móvil y `lg` a partir de `sm`: en escritorio la
            arena tiene 1.320 px de ancho y dejarlas pequeñas era desperdiciar el sitio
            donde justamente hay que mirar.
          */}
          {/*
            El choque se CENTRA en una caja acotada. Sin límite de ancho, en un escritorio
            de 1.320 px las columnas `1fr` empujaban las dos cartas hacia los bordes y
            dejaban medio metro de vacío entre ellas: un enfrentamiento se lee por la
            cercanía de las dos piezas, no por su tamaño.
          */}
          <div className="relative mx-auto my-4 grid max-w-[620px] grid-cols-[1fr_auto_1fr] items-center gap-3 sm:gap-6">
            <div className="flex justify-end">
              <Slot label={"Tu\ncarta"} filled={Boolean(chosen)} tone="rgba(63,192,122,0.55)">
                {chosen && (
                  <motion.div
                    key={chosen.uid}
                    initial={{ opacity: 0, y: 24, scale: 0.9 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ duration: 0.28, ease: EASE.out }}
                  >
                    <DuelCard card={chosen} size="md" highlightStat={attacking ? stat : required} />
                  </motion.div>
                )}
              </Slot>
            </div>

            {/*
              MEDALLÓN DEL VS. Antes era el texto «VS» en gris al 25 % y una rayita. El
              punto de choque de un duelo es el centro de la pantalla y tiene que pesar como
              tal; además, aquí es donde se dice «ya puedes confirmar» sin escribirlo.
            */}
            <div className="flex flex-col items-center gap-2">
              <span
                aria-hidden
                className={cn(
                  "grid h-14 w-14 place-items-center rounded-full border-2 transition-all duration-normal sm:h-16 sm:w-16",
                  ready ? "border-drl bg-drl/15" : "border-white/15 bg-white/[0.03]",
                )}
                style={ready ? { boxShadow: "0 0 26px rgba(255,46,99,0.65)" } : undefined}
              >
                <span
                  className={cn(
                    "font-display text-lg font-bold tracking-tight transition-colors duration-normal sm:text-xl",
                    ready ? "text-white" : "text-white/35",
                  )}
                >
                  VS
                </span>
              </span>
              <span
                aria-hidden
                className={cn(
                  "h-10 w-px rounded-full transition-colors duration-normal sm:h-16",
                  ready ? "bg-drl shadow-[0_0_10px_rgba(255,46,99,0.9)]" : "bg-white/12",
                )}
              />
            </div>

            <div className="flex justify-start">
              <Slot label={"Carta\nrival"} filled tone="rgba(255,46,99,0.55)">
                {view.pendingRival ? (
                  <DuelCard card={view.pendingRival.card} size="md" highlightStat={view.pendingRival.stat} />
                ) : (
                  <DuelCardBack size="md" />
                )}
              </Slot>
            </div>
          </div>

          {!attacking && required && (
            <p className="relative mt-2 rounded-lg border-l-2 border-drl-cyan bg-drl-cyan/[0.08] px-3 py-2 text-xs text-white/75">
              Estás obligado a responder con{" "}
              <b style={{ color: STAT_INFO[required].color }}>{STAT_INFO[required].label}</b>. Elige con qué carta.
            </p>
          )}

          {attacking && chosen && (
            <div className="relative mt-3">
              <span className="nx-label mb-1.5 block">¿Con qué peleas?</span>
              <div className="grid gap-1.5 sm:grid-cols-3">
                {STATS.map((k) => {
                  const info = STAT_INFO[k];
                  const on = stat === k;
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setStat(k)}
                      aria-pressed={on}
                      className={cn(
                        "nx-clip-sm flex items-center justify-between gap-2 border px-3 py-2.5 text-left transition duration-fast",
                        on
                          ? "border-current bg-white/[0.1]"
                          : "border-white/10 bg-white/[0.03] hover:bg-white/[0.07]",
                      )}
                      style={on ? { color: info.color, boxShadow: `0 0 18px ${info.color}44` } : undefined}
                    >
                      <span className="min-w-0">
                        <span className="block font-display text-[11px] font-extrabold tracking-[0.12em]" style={{ color: info.color }}>
                          {info.abbr}
                        </span>
                        <span className="block truncate text-[10px] text-white/45">{info.blurb}</span>
                      </span>
                      <b className="nx-readout text-3xl text-white">{chosen.combat[k]}</b>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {error && (
            <p role="alert" className="relative mt-3 flex items-start justify-between gap-2 rounded-lg border border-drl/40 bg-drl/10 px-3 py-2 text-xs text-drl-glow">
              <span>{error}</span>
              <button type="button" onClick={onDismissError} aria-label="Cerrar aviso" className="shrink-0 opacity-60 hover:opacity-100">✕</button>
            </p>
          )}

          <button
            type="button"
            onClick={confirm}
            disabled={!ready || busy}
            className="nx-clip-sm relative mt-4 w-full bg-drl px-4 py-3.5 font-display text-sm font-bold uppercase tracking-[0.16em] shadow-glow transition hover:brightness-110 disabled:cursor-not-allowed disabled:bg-white/[0.07] disabled:text-white/35 disabled:shadow-none"
          >
            {busy
              ? "Resolviendo…"
              : !chosen
                ? "Elige una carta"
                : attacking && !stat
                  ? "Elige una estadística"
                  : attacking
                    ? "Declarar y atacar"
                    : "Responder"}
          </button>
        </section>

        {/* ═══════════ TU MANO ═══════════ */}
        <section
          className={cn("mt-3 sm:order-4", attacking ? "order-4" : "order-3")}
          aria-label="Tu mano"
        >
          <div className="mb-1.5 flex items-center justify-between">
            <span className="nx-label !text-ok/70">
              Tu mano · {view.yourHand.length} {view.yourHand.length === 1 ? "carta" : "cartas"}
            </span>
            <span className="nx-label truncate">{view.yourDeckName}</span>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(78px,1fr))] gap-2 sm:grid-cols-[repeat(auto-fill,minmax(96px,1fr))]">
            {view.yourHand.map((c) => (
              <DuelCard
                key={c.uid}
                card={c}
                size="sm"
                selected={card === c.uid}
                /*
                 * Defendiendo, la estadística ya está decidida por la tabla: lo único que el jugador
                 * elige es CON QUÉ CARTA responder. Se resalta ese eje en TODAS las cartas de la mano
                 * para que la comparación sea de un vistazo y no una búsqueda entre treinta números.
                 * Atacando el eje aún no está elegido, así que solo se marca en la carta seleccionada.
                 */
                highlightStat={attacking ? (card === c.uid ? stat : null) : required}
                onClick={busy ? undefined : () => { setCard(c.uid); setStat(null); }}
                className="w-full"
              />
            ))}
          </div>

          {view.yourUsed.length > 0 && (
            <details className="mt-3 group">
              <summary className="nx-label cursor-pointer list-none transition hover:!text-white/60">
                Cartas gastadas ({view.yourUsed.length}) ▾
              </summary>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {view.yourUsed.map((c) => (
                  <DuelCard key={c.uid} card={c} size="xs" used />
                ))}
              </div>
            </details>
          )}
        </section>
      </div>

      {/* ── Historial ── */}
      {hasHistory && (
      <aside className="min-w-0 lg:sticky lg:top-4 lg:self-start">
        <h2 className="nx-label mb-2">Historial</h2>
        <AnimatePresence initial={false}>
          <TurnHistory turns={[...view.history].reverse()} />
        </AnimatePresence>
      </aside>
      )}
    </div>
  );
}

/**
 * MARCADOR DE LA ARENA.
 *
 * Sustituye al panel `Scoreboard` dentro del tablero. Mismos datos y misma pista de
 * turnos —`TurnTrack` se reutiliza tal cual—, pero presentado como un marcador de
 * competición: las dos cifras a tamaño de marcador, enfrentadas, con el turno en medio.
 * Un marcador de duelo con las cifras a 30 px y una caja alrededor es una tarjeta de
 * estadísticas; a 56 px y sin caja es un marcador.
 */
function ArenaScore({ view, className }: { view: DuelMatchView; className?: string }) {
  const live = view.status === "IN_PROGRESS";
  return (
    <section className={cn("relative", className)} aria-label="Marcador">
      <div className="flex items-end justify-center gap-5 sm:gap-10">
        <div className="flex-1 text-right">
          <span className="nx-label !text-ok/70">Tú</span>
          <p className="nx-readout text-[clamp(40px,9vw,64px)] text-ok" style={{ textShadow: "0 0 30px rgba(63,192,122,0.45)" }}>
            {view.scoreYou}
          </p>
        </div>

        <div className="pb-2 text-center">
          <span className="nx-label block">Turno</span>
          <b className="nx-readout mt-0.5 block text-xl">
            {Math.min(view.turn, view.totalTurns)}
            <span className="text-white/30"> / {view.totalTurns}</span>
          </b>
          {live && (
            <span
              className={cn(
                "mt-1 block font-display text-[10px] font-bold uppercase tracking-[0.14em]",
                view.youAreAttacker ? "text-ok" : "text-drl",
              )}
            >
              {view.youAreAttacker ? "Atacas tú" : "Ataca el rival"}
            </span>
          )}
        </div>

        <div className="flex-1 text-left">
          <span className="nx-label !text-drl/70">Bot</span>
          <p className="nx-readout text-[clamp(40px,9vw,64px)] text-drl" style={{ textShadow: "0 0 30px rgba(255,46,99,0.45)" }}>
            {view.scoreRival}
          </p>
        </div>
      </div>

      <TurnTrack view={view} className="mt-2" />

      {view.ties > 0 && (
        <p className="nx-label mt-1.5 text-center">
          {view.ties} {view.ties === 1 ? "empate" : "empates"}
        </p>
      )}
    </section>
  );
}

/**
 * Un hueco de la mesa. Cuando está vacío se ve el hueco —un marco punteado con su
 * etiqueta— y cuando se llena, la carta. Antes el hueco vacío era un rectángulo punteado
 * suelto y el lleno una carta a otra altura, así que al elegir carta el tablero saltaba.
 */
function Slot({
  children, label, filled, tone,
}: {
  children?: React.ReactNode;
  label: string;
  filled: boolean;
  tone: string;
}) {
  return (
    /*
      El hueco tiene el tamaño de la carta y NO cambia al llenarse: antes el hueco vacío
      era un rectángulo punteado de un tamaño y la carta de otro, así que al elegir carta
      el tablero daba un salto en el momento exacto en el que hay que estar mirando.

      La carta se dibuja en tamaño `md` y se AMPLÍA con `transform` a partir de `sm`. Es la
      forma de aprovechar los 1.320 px de la arena en escritorio sin dibujar dos cartas
      (una por punto de ruptura) ni añadir un tamaño nuevo a `DuelCard`, que lo usan cinco
      pantallas. `transform` no toca el layout: el hueco manda y la carta se ajusta a él.
    */
    <div className="relative grid aspect-[5/7] w-[116px] place-items-center sm:w-[166px]">
      {!filled && (
        <span
          aria-hidden
          className="absolute inset-0 rounded-card border border-dashed"
          style={{ borderColor: tone, background: "rgba(0,0,0,0.25)" }}
        />
      )}
      {filled ? (
        <div className="absolute inset-0 grid place-items-center">
          <div className="origin-center scale-100 sm:scale-[1.43]">{children}</div>
        </div>
      ) : (
        <span className="nx-label whitespace-pre-line text-center leading-tight">{label}</span>
      )}
    </div>
  );
}

function StepPill({
  n, active, done, children,
}: {
  n: number;
  active: boolean;
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition",
        done ? "bg-emerald-400/15 text-emerald-300"
          : active ? "bg-drl/20 text-white"
            : "bg-white/5 text-white/35",
      )}
    >
      <b className="font-display">{done ? "✓" : n}</b>
      {children}
    </span>
  );
}
