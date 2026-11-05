"use client";

/**
 * EL TEATRO TÁCTICO — la jugada a pantalla completa, delante del equipo.
 *
 * ────────────────────────── PARA QUÉ ES ──────────────────────────
 *
 * Es el modo GAME DAY: NEXUS en una TV, sin nada que distraiga. Arriba, lo que hay que saber en un
 * vistazo —mapa, lado y nombre de la jugada—. En medio, el mapa lo más grande posible. Abajo, los
 * pasos. Flotando, la composición. Y nada más: ni barra de navegación, ni panel lateral, ni pie.
 *
 * ────────────────────────── PANTALLA COMPLETA DE VERDAD ──────────────────────────
 *
 * Usa la Fullscreen API del navegador, no un `div` estirado: el caso de uso es una televisión y con
 * CSS seguirían viéndose la barra del navegador y la de tareas. Cuando la API no está disponible —o
 * la rechaza— se cae al modo FOCUS (`position: fixed` sobre todo), que no es igual pero nunca deja
 * al entrenador sin pizarra. Escape sale de los dos.
 *
 * ────────────────────────── LA REPRODUCCIÓN NO TOCA DATOS ──────────────────────────
 *
 * Avanzar de paso mueve las fichas de donde estaban a donde van. Ese movimiento es PRESENTACIÓN: lo
 * calcula `playbackFrame` (dominio puro) y devuelve una foto; el plan guardado no se modifica ni
 * una vez. Por eso se puede reproducir una jugada sin miedo a estropearla.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { agentById, agentColor, agentRoleLabel } from "./AgentEmblem";
import { AgentPortrait } from "@/components/agents/AgentArt";
import { fitCamera, type Camera } from "./MapCanvas";
import { StrategyBoard, type BoardActions } from "./StrategyBoard";
import { getTacticalMap } from "@/domain/tactics/maps";
import type { Strat } from "@/domain/tactics/strat";
import {
  playbackReducer, playbackFrame, INITIAL_PLAYBACK, STEP_TRANSITION_MS, AUTOPLAY_MS,
  type PlaybackEvent,
} from "@/lib/tactics/playback";
import { enterFullscreen, exitFullscreen, currentFullscreenElement, type FullscreenMode } from "@/lib/tactics/fullscreen";
import { cn } from "@/lib/format";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const tr = ns("tactics");

const SIDE_LABEL = { attack: "Ataque", defense: "Defensa" } as const;
const SIDE_COLOR = { attack: "#ff2e63", defense: "#19e3ff" } as const;

export function TacticalTheater({
  strat, agentIds = [], open, onClose,
}: {
  strat: Strat;
  /** La composición con la que se presenta. Se enseña flotando al lado. */
  agentIds?: string[];
  open: boolean;
  onClose: () => void;
}) {
  useLocale();
  const root = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<FullscreenMode>("off");
  const total = strat.steps.length;

  const mapaTeatro = getTacticalMap(strat.mapId);

  /*
   * La cámara del teatro es suya: encuadre COMPLETO al abrir. Se calcula con `fitCamera`, la misma
   * función que usa el editor —inventarse `{cx:.5, cy:.5, scale:1}` dejaba el mapa descuadrado y
   * medio fuera de pantalla, porque el encuadre depende de la proporción real del asset—. Se deja
   * mover (rueda y arrastre siguen activos): un entrenador querrá acercarse a un site mientras
   * explica, pero sin tocar la cámara del editor.
   */
  const [camera, setCamera] = useState<Camera>(() => (mapaTeatro ? fitCamera(mapaTeatro) : { cx: 0.5, cy: 0.5, scale: 1 }));

  /* Al abrir el teatro se vuelve a encuadrar: la presentación siempre empieza viendo el mapa entero. */
  useEffect(() => {
    if (open && mapaTeatro) setCamera(fitCamera(mapaTeatro));
  }, [open, mapaTeatro]);

  /*
   * En presentación NO se edita. `StrategyBoard` pide `actions` siempre, así que se le pasan
   * funciones vacías: con `readOnly` no las llama, y si un día las llamara, no pasaría nada.
   * Es más seguro que un `null` con aserción.
   */
  const acciones = useMemo<BoardActions>(() => ({
    onMove: () => {}, onSelect: () => {}, onPlacePlayer: () => {},
    onPlaceUtility: () => {}, onPlaceText: () => {}, onDraw: () => {},
  }), []);

  const reduce = useCallback(
    (s: typeof INITIAL_PLAYBACK, e: PlaybackEvent) => playbackReducer(s, e, total),
    [total],
  );
  const [play, dispatch] = useReducer(reduce, INITIAL_PLAYBACK);

  /*
   * FASE 51 · VOLVER A PANTALLA COMPLETA. Al salir con Escape el teatro sigue abierto en modo focus;
   * desde aquí se vuelve a pedir con un gesto del usuario (que es cuando el navegador lo concede), o
   * se sale de ella sin cerrar la presentación.
   */
  const alternarPantalla = useCallback(() => {
    if (mode === "native") { void exitFullscreen(); setMode("focus"); return; }
    void enterFullscreen(root.current).then(setMode);
  }, [mode]);

  /* ── Entrar y salir de pantalla completa ─────────────────────────────────── */
  useEffect(() => {
    if (!open) return;
    let vivo = true;
    void enterFullscreen(root.current).then((m) => { if (vivo) setMode(m); });
    return () => { vivo = false; void exitFullscreen(); };
  }, [open]);

  /*
   * Si el usuario sale con Escape o con el botón del navegador, la API no avisa por otra vía que
   * este evento. Sin esto la pantalla se quedaría creyendo que sigue a pantalla completa.
   */
  useEffect(() => {
    if (!open) return;
    const onChange = () => { if (!currentFullscreenElement()) setMode((m) => (m === "native" ? "focus" : m)); };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [open]);

  /* ── La transición entre pasos ───────────────────────────────────────────── */
  useEffect(() => {
    if (play.progress >= 1) return;
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / STEP_TRANSITION_MS);
      dispatch({ type: "progress", value: p });
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play.index]);

  /* ── Avance automático ───────────────────────────────────────────────────── */
  useEffect(() => {
    if (!play.playing || play.progress < 1) return;
    const id = window.setTimeout(() => dispatch({ type: "next" }), AUTOPLAY_MS);
    return () => window.clearTimeout(id);
  }, [play.playing, play.progress, play.index]);

  /* ── Teclado de presentación ─────────────────────────────────────────────── */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") { e.preventDefault(); dispatch({ type: "next" }); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); dispatch({ type: "prev" }); }
      else if (e.key === " ") { e.preventDefault(); dispatch({ type: "toggle" }); }
      else if (e.key === "Escape" && !currentFullscreenElement()) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const mapa = mapaTeatro;
  const frame = useMemo(() => playbackFrame(strat, play), [strat, play]);

  if (!open || typeof document === "undefined") return null;

  const cuerpo = (
    <div
      ref={root}
      data-testid="tactical-theater"
      data-mode={mode}
      /*
       * FASE 51 · SIEMPRE fijo y SIEMPRE por portal. Antes, al conseguir la pantalla completa nativa,
       * el teatro dejaba de ir por portal y React MONTABA OTRO elemento en su sitio: el navegador
       * veía desaparecer el elemento a pantalla completa y salía de ella al instante —la pantalla
       * completa «de verdad» duraba un fotograma—. Ahora el elemento es el mismo en los dos modos.
       */
      className="nx-coach-theater fixed inset-0 z-[80] flex h-screen w-screen flex-col"
    >
      {/* ═══ ARRIBA · lo que hay que saber en un vistazo ═══ */}
      <header className="nx-coach-theater-hud flex shrink-0 items-center justify-between gap-4 px-[clamp(14px,2vw,34px)] py-[clamp(10px,1.6vh,20px)]">
        <div className="flex min-w-0 items-center gap-4">
          <span className="hidden font-display text-[12px] font-extrabold uppercase leading-none tracking-[0.3em] text-[#2fe0ff] sm:block">
            {tr("Tactical")}<span className="block text-[9px] tracking-[0.42em] text-white/45">{tr("Coach")}</span>
          </span>
          <span className="hidden h-6 w-px bg-[rgba(47,224,255,0.25)] sm:block" />
          <b className="font-display text-[clamp(15px,2.4vh,26px)] font-extrabold uppercase tracking-[0.08em] text-white">
            {mapa?.name ?? strat.mapId}
          </b>
          <span
            data-testid="theater-side"
            className="nx-clip-sm shrink-0 px-2.5 py-1 font-display text-[clamp(10px,1.4vh,14px)] font-bold uppercase tracking-[0.24em]"
            style={{
              color: SIDE_COLOR[strat.side],
              background: `${SIDE_COLOR[strat.side]}1f`,
              boxShadow: `inset 0 0 0 1px ${SIDE_COLOR[strat.side]}66`,
            }}
          >
            {/* El lado NO se distingue sólo por color: lleva su palabra y su flecha. */}
            {strat.side === "attack" ? "▲ " : "▼ "}{td(SIDE_LABEL[strat.side])}
          </span>
        </div>

        <div className="flex min-w-0 items-center gap-4">
          <b className="truncate font-display text-[clamp(13px,2vh,22px)] font-bold uppercase tracking-[0.06em] text-white/85">
            {strat.name}
          </b>
          <button
            type="button"
            onClick={alternarPantalla}
            data-testid="theater-fullscreen"
            aria-pressed={mode === "native"}
            title={mode === "native" ? tr("Salir de pantalla completa") : tr("Pantalla completa")}
            className="nx-clip-sm nx-label hidden min-h-[40px] shrink-0 items-center px-3.5 text-[#2fe0ff] shadow-[inset_0_0_0_1px_rgba(47,224,255,0.4)] transition duration-fast hover:bg-[rgba(47,224,255,0.1)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70 sm:flex"
          >
            {mode === "native" ? tr("Ventana") : tr("⛶ Pantalla completa")}
          </button>
          <button
            type="button"
            onClick={onClose}
            data-testid="theater-close"
            className="nx-clip-sm nx-label flex min-h-[40px] shrink-0 items-center px-3.5 text-white/70 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)] transition duration-fast hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70"
          >
            {tr("Salir")}
          </button>
        </div>
      </header>

      {/*
        ═══ CENTRO · el mapa manda ═══

        ────────────────────────── EL FALLO QUE ESTO ARREGLA (F47.1) ──────────────────────────

        Aquí había un `MapCanvas` envolviendo a `StrategyBoard`… que ya monta su propio
        `MapCanvas`. Es decir: un `<div>` dentro de un `<svg>`. El navegador lo acepta sin
        quejarse —queda como elemento desconocido en el espacio de nombres SVG— pero **no lo
        dispone**: medido en la pizarra real, el lienzo interior daba `0 × 0`. Resultado: en
        PRESENTAR se veía el PNG del mapa y NADA más. Ni las cinco fichas, ni las utilidades,
        ni las flechas, ni las zonas, ni las notas. La pantalla que existe para explicar la
        jugada era la única que no la enseñaba.

        `StrategyBoard` ya trae cámara, capas y accesibilidad: se le pasa el alto y punto.

        ────────────────────────── Y POR QUÉ LA CAJA LLEVA PROPORCIÓN ──────────────────────────

        Los doce assets son casi cuadrados (0,89 a 1,13) y el hueco del teatro es apaisado. Con
        `meet`, el mapa se metía en 731 px de los 1.400 disponibles: el 48 % de la pantalla era
        barra negra a los lados. Dándole al lienzo la PROPORCIÓN DEL ENCUADRE, el mapa ocupa
        todo el alto y lo que sobra a los lados deja de ser un vacío para convertirse en los
        dos paneles de apoyo. **La cámara no cambia** —mismo `viewBox`, mismo `fitCamera`—, así
        que las coordenadas normalizadas siguen significando el mismo punto.
      */}
      <div className="grid min-h-0 flex-1 gap-[clamp(8px,1.4vw,22px)] px-[clamp(8px,1.4vw,26px)] xl:grid-cols-[minmax(150px,280px)_minmax(0,auto)_minmax(150px,280px)]">
        {/* ── Izquierda · quién juega ── */}
        <aside className="hidden min-w-0 flex-col justify-center gap-1.5 xl:flex" data-testid="theater-composition">
          {agentIds.length > 0 && (
            <>
              <span className="nx-label mb-1 !text-[9px] text-white/30">{tr("En el mapa")}</span>
              {agentIds.map((id) => {
                const a = agentById(id);
                const c = agentColor(a);
                return (
                  <span
                    key={id}
                    className="flex items-center gap-2.5 bg-[rgba(8,15,30,0.7)] px-2.5 py-2"
                    style={{ boxShadow: `inset 3px 0 0 ${c}, inset 0 0 0 1px rgba(47,224,255,0.12)` }}
                  >
                    {/* Ficha del agente real (o del modelo anterior) + nombre + rol. El mapa sigue mandando. */}
                    <AgentPortrait agentId={id} size={36} decorative />
                    <span className="min-w-0 leading-tight">
                      <b className="block truncate font-display text-[12px] font-bold uppercase tracking-[0.12em] text-white">
                        {a?.name ?? id}
                      </b>
                      <span className="block font-display text-[8px] font-bold uppercase tracking-[0.2em]" style={{ color: c }}>
                        {agentRoleLabel(a)}
                      </span>
                    </span>
                  </span>
                );
              })}
            </>
          )}
        </aside>

        {/* ── Centro · el mapa, con la proporción de su encuadre ── */}
        <div className="grid min-h-0 min-w-0 place-items-center">
          {mapa && frame.step && (
            <div
              /*
                `min-w-0` NO es decorativo. La caja es un elemento de rejilla, y un elemento de
                rejilla tiene `min-width: auto`, que vale su tamaño MÍNIMO DE CONTENIDO — y para
                una caja con proporción y alto definido eso es «alto × proporción». Ese mínimo le
                gana a `max-width`, así que a 390 px el mapa del teatro salía 591 px de ancho: se
                comía la pantalla por los dos lados. Medido en el barrido responsive: 112 % del
                viewport. Con `min-w-0` el máximo vuelve a mandar y el mapa se ajusta al ancho.
              */
              className="nx-coach-board relative h-full min-w-0 max-w-full"
              style={{ aspectRatio: `${mapa.frame.width} / ${mapa.frame.height}` }}
            >
              {(["tl", "tr", "bl", "br"] as const).map((c) => <span key={c} aria-hidden className="nx-coach-corner z-10" data-c={c} />)}
              <StrategyBoard
                map={mapa}
                state={{ ...frame.step.state, players: frame.players }}
                camera={camera}
                onCamera={setCamera}
                tool={{ kind: "select" }}
                selectedId={null}
                actions={acciones}
                readOnly
                className="h-full w-full"
              />
            </div>
          )}
        </div>

        {/* ── Derecha · qué pasa en este paso ── */}
        <aside className="hidden min-w-0 flex-col justify-center gap-2 xl:flex">
          {frame.step && (
            <>
              <span className="nx-readout text-[clamp(26px,5vh,54px)] font-bold leading-none text-[#2fe0ff]" style={{ textShadow: "0 0 18px rgba(47,224,255,0.55)" }}>
                {String(play.index + 1).padStart(2, "0")}
                <span className="text-white/25">/{String(total).padStart(2, "0")}</span>
              </span>
              <b className="font-display text-[clamp(13px,1.9vh,19px)] font-extrabold uppercase leading-tight tracking-[0.08em] text-white">
                {td(frame.step.label) || tr("Paso")}
              </b>
              {frame.step.notes && (
                <p className="text-[clamp(11px,1.4vh,14px)] leading-relaxed text-white/45">{td(frame.step.notes)}</p>
              )}
            </>
          )}
        </aside>
      </div>

      {/* ═══ ABAJO · los pasos ═══ */}
      <footer className="nx-coach-theater-bar shrink-0 px-[clamp(14px,2vw,34px)] py-[clamp(10px,1.8vh,22px)]">
        {/*
          Debajo de `lg` no hay columnas laterales: el paso y la composición se dicen aquí, que
          es donde el entrenador ya está mirando para pasar de jugada.
        */}
        {frame.step && (
          <div className="mb-3 flex items-baseline gap-3 xl:hidden">
            <b className="font-display text-[clamp(13px,2vh,22px)] font-extrabold uppercase tracking-[0.1em] text-white">
              {play.index + 1} / {total} · {td(frame.step.label) || tr("Paso")}
            </b>
            {frame.step.notes && <span className="truncate text-[13px] text-white/50">{td(frame.step.notes)}</span>}
          </div>
        )}
        {agentIds.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-1.5 xl:hidden">
            {agentIds.map((id) => {
              const a = agentById(id);
              return (
                <span key={id} className="flex items-center gap-1.5 rounded-md bg-white/[0.05] px-2 py-1">
                  <AgentPortrait agentId={id} size={22} decorative />
                  <b className="font-display text-[9px] font-bold uppercase tracking-[0.14em] text-white/80">{a?.name ?? id}</b>
                </span>
              );
            })}
          </div>
        )}

        <div className="flex items-center gap-2 sm:gap-3">
          <Mando onClick={() => dispatch({ type: "prev" })} disabled={play.index === 0} testid="theater-prev" label={tr("Paso anterior")}>←</Mando>
          {/*
            REPRODUCIR es el control grande: es el único que se pulsa con el equipo delante y a
            un par de metros del portátil. Los otros dos acompañan.
          */}
          <button
            type="button" onClick={() => dispatch({ type: "toggle" })}
            data-testid="theater-play" aria-label={play.playing ? tr("Pausar") : tr("Reproducir")}
            className={cn(
              "nx-clip-sm grid h-11 w-14 shrink-0 place-items-center text-[15px] font-bold transition duration-fast",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70",
              play.playing
                ? "bg-[#2fe0ff] text-[#021420] shadow-[0_0_20px_-4px_rgba(47,224,255,0.9)]"
                : "bg-[rgba(47,224,255,0.14)] text-white shadow-[inset_0_0_0_1px_rgba(47,224,255,0.6)] hover:bg-[rgba(47,224,255,0.24)]",
            )}
          >{play.playing ? "❚❚" : "▶"}</button>
          <Mando onClick={() => dispatch({ type: "next" })} disabled={play.index >= total - 1} testid="theater-next" label={tr("Paso siguiente")}>→</Mando>

          {/*
            LA LÍNEA DE TIEMPO. Cada paso es un tramo con su número y su nombre: mirándola se
            sabe en qué punto de la jugada está uno sin contar barras. El tramo en curso se
            RELLENA con el progreso real de la transición, así que la reproducción se ve
            avanzar en vez de saltar.
          */}
          <ol className="flex min-w-0 flex-1 items-end gap-1 sm:gap-1.5" data-testid="theater-timeline">
            {strat.steps.map((s, i) => (
              <li key={s.id} className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => dispatch({ type: "goto", index: i })}
                  aria-label={tr("Paso {v}{v2}", { v: i + 1, v2: s.label ? `: ${s.label}` : "" })}
                  aria-current={i === play.index ? "step" : undefined}
                  className="group block w-full py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70"
                >
                  <span
                    className={cn(
                      "nx-label block truncate !text-[9px] transition-colors duration-normal",
                      i === play.index ? "!text-white" : "!text-white/30 group-hover:!text-white/55",
                    )}
                  >
                    {i + 1}{s.label ? ` · ${s.label}` : ""}
                  </span>
                  <span
                    className={cn(
                      "mt-1 block h-[3px] w-full overflow-hidden rounded-full transition-colors duration-normal",
                      i < play.index ? "bg-[rgba(47,224,255,0.55)]" : "bg-white/12 group-hover:bg-white/25",
                    )}
                  >
                    {i === play.index && (
                      <span
                        className="block h-full rounded-full bg-[#2fe0ff] shadow-[0_0_8px_rgba(47,224,255,0.9)] motion-reduce:!w-full"
                        style={{ width: `${Math.max(8, play.progress * 100)}%` }}
                      />
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ol>

          <span className="nx-label hidden shrink-0 !text-[9px] text-white/25 xl:block">{tr("← → pasos · espacio reproduce")}</span>
        </div>
      </footer>
    </div>
  );

  // Siempre por portal al `body`: ningún `overflow` de un ancestro puede recortarlo, y el elemento
  // a pantalla completa no cambia al cambiar de modo (ver el comentario de la raíz).
  return createPortal(cuerpo, document.body);
}

/**
 * Un mando de paso. Mismo objetivo tactil que el resto del producto (44 px) y estado
 * deshabilitado que se VE: en el primer paso, «anterior» no puede parecer pulsable.
 */
function Mando({
  onClick, disabled, testid, label, children,
}: {
  onClick: () => void;
  disabled?: boolean;
  testid: string;
  label: string;
  children: React.ReactNode;
}) {
  useLocale();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testid}
      aria-label={td(label)}
      title={td(label)}
      className={
        "nx-clip-sm grid h-11 w-11 shrink-0 place-items-center text-[15px] text-white/75 transition duration-fast " +
        "shadow-[inset_0_0_0_1px_rgba(47,224,255,0.3)] hover:bg-[rgba(47,224,255,0.1)] hover:text-white " +
        "disabled:opacity-25 disabled:hover:bg-transparent " +
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70"
      }
    >
      {children}
    </button>
  );
}
