"use client";

/**
 * HUD DEL TURNO (Fase 33) — lo que el jugador tiene que saber de un vistazo, encima de la mesa, en UNA
 * línea:
 *
 *   ▌TURNO 4 DE 10 · ▲ ATACAS · CARTA BLOQUEADA · ÚLTIMO TURNO · punto de partida      TÚ 4 – 3 RIVAL
 *    eje impuesto por el servidor (solo defendiendo)
 *
 * Y aparte, `TurnTimeline`: la línea de los diez turnos (●○—◆·), cuyos turnos jugados abren su detalle y
 * cuyo futuro no dice nada. Va en la columna lateral en escritorio ancho y debajo de la mano en el resto.
 *
 * POR QUÉ SEPARADAS: la mesa reparte el alto de la pantalla descontando lo que no escala (`arenaVars`).
 * Con la línea de turnos dentro del HUD, este medía ~120 px en escritorio y ~180 en móvil y la mano se
 * iba por debajo del pliegue (medido en la QA de la fase). Una barra de ~40 px no lo rompe.
 *
 * TODO sale de `@/lib/duel/experience` sobre la vista del servidor. No se compara ningún valor, no se
 * cuenta ningún punto y no se infiere quién ataca: `youAreAttacker`, `requiredStat`, `pendingRival`,
 * `scoreYou/scoreRival` y `history` llegan resueltos.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/format";
import { playCue } from "@/lib/sound";
import { STAT_INFO, type DuelMatchView } from "@/lib/duel/types";
import { axisPresentation, buildTimeline, turnHeader, PHASE_LABEL, type CellState, type MatchPhase } from "@/lib/duel/experience";
import { TurnDetailSheet } from "./TurnDetailSheet";
import { RoleIcon } from "./RoleIcon";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";

const t = ns("duel");

const CELL: Record<CellState, { border: string; color: string; bg: string }> = {
  /* FASE 50 · el punto del jugador es cian, como su lado de la arena. */
  WIN: { border: "rgba(47,224,255,0.55)", color: "#2fe0ff", bg: "rgba(47,224,255,0.10)" },
  LOSS: { border: "rgba(255,46,99,0.55)", color: "#ff2e63", bg: "rgba(255,46,99,0.10)" },
  DRAW: { border: "rgba(255,211,92,0.55)", color: "#ffd35c", bg: "rgba(255,211,92,0.08)" },
  CURRENT: { border: "rgba(63,210,255,0.8)", color: "#3fd2ff", bg: "rgba(63,210,255,0.10)" },
  PENDING: { border: "rgba(255,255,255,0.10)", color: "rgba(255,255,255,0.3)", bg: "transparent" },
};

/** Tono del chip de fase: elegir (neutro), bloqueado/esperando (cian), red (oro/rojo). */
const PHASE_TONE: Partial<Record<MatchPhase, string>> = {
  LOCKED: "border-drl-cyan/50 text-drl-cyan",
  WAITING_RIVAL: "border-drl-cyan/50 text-drl-cyan",
  REVEAL: "border-drl-gold/50 text-drl-gold",
  RESYNC: "border-drl-gold/50 text-drl-gold",
  RECOVERING: "border-drl-gold/50 text-drl-gold",
  OFFLINE: "border-drl-red/60 text-drl-red",
  CONFIRM: "border-ok/50 text-ok",
};

export function MatchHud({
  view, rivalName, phase, className, compact = false,
}: {
  view: DuelMatchView;
  rivalName: string;
  /** Compatibilidad: la espera del rival ya la dice el chip de fase (`WAITING_RIVAL`). */
  waitingRival?: boolean;
  /** FASE 33 · fase visual derivada por el tablero (`derivePhase`). */
  phase?: MatchPhase;
  /**
   * FASE 50 · la barra de la partida ya enseña el turno y el marcador: aquí quedan para los lectores
   * de pantalla (a partir de `sm`) y la cinta se queda con lo que solo ella sabe —rol, fase, eje—.
   */
  compact?: boolean;
  className?: string;
}) {
  useLocale();
  const header = useMemo(() => turnHeader(view), [view]);
  const axis = useMemo(() => axisPresentation(view), [view]);

  // Punto de partida: un cue corto, una vez por turno. Presentación; no cambia nada.
  const lastPoint = useRef<string | null>(null);
  useEffect(() => {
    const key = header.matchPoint ? `${header.turn}:${header.matchPoint}` : null;
    if (key && key !== lastPoint.current) playCue("match_point");
    lastPoint.current = key;
  }, [header.turn, header.matchPoint]);

  if (view.status !== "IN_PROGRESS") return null;
  /* FASE 50 · atacas en el color del jugador (cian), defiendes en el del rival (rojo). */
  const roleTone = header.role === "ATTACK" ? "#2fe0ff" : "#ff2e63";

  return (
    <section
      data-hud="turno"
      data-role={header.role ?? "none"}
      data-final={header.finalTurn}
      aria-label={t("Estado del turno")}
      className={cn(
        /*
         * FASE 50 · UNA CINTA DE LUZ, NO UNA CAJA. Centrada sobre el escenario, con los extremos
         * fundidos al estadio: se lee como la rotulación de un evento y no como una barra de estado.
         */
        "relative mx-auto flex w-full flex-wrap items-center justify-center gap-x-2.5 gap-y-1 py-1.5 pl-4 pr-3 sm:pr-4",
        /*
         * Con la barra de la partida encima, la cinta entera pasa a ser solo para lectores de pantalla a
         * partir de `sm`: turno, rol y fase ya se ven arriba, el eje en la zona de duelo y la instrucción
         * en los controles. En móvil (sin barra de turno) sigue visible.
         */
        compact && "sm:sr-only",
        className,
      )}
      style={{
        maxWidth: "var(--arena-w, 100%)",
        background: header.finalTurn
          ? "linear-gradient(90deg, transparent, rgba(255,211,92,0.14) 20%, rgba(255,211,92,0.14) 80%, transparent)"
          : "linear-gradient(90deg, transparent, rgba(5,8,18,0.72) 18%, rgba(5,8,18,0.72) 82%, transparent)",
        boxShadow: `inset 0 -1px 0 ${roleTone}33`,
      }}
    >
      {/* El filo del rol: ataque cian, defensa roja. Además de la palabra, nunca en su lugar. */}
      <span aria-hidden className="absolute inset-x-[22%] bottom-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${roleTone}, transparent)`, boxShadow: `0 0 12px ${roleTone}` }} />

      <h2 className="font-display text-[clamp(14px,1.9vw,18px)] font-bold tracking-[0.08em] text-white" data-testid="turn-label">
        {td(header.label)}
      </h2>
      {header.roleLabel && (
        <span
          data-testid="turn-role"
          className={cn(
            "inline-flex items-center gap-1 rounded-[3px] px-2 py-0.5 font-display text-[12px] font-bold tracking-[0.16em]",
            header.role === "ATTACK" ? "bg-[#2fe0ff]/15 text-[#2fe0ff]" : "bg-drl/15 text-drl-glow",
          )}
        >
          {/* F61 · espada / escudo en vez de ▲ / ▼: se entiende sin leer y sin distinguir colores. */}
          <RoleIcon kind={header.role === "ATTACK" ? "ATTACK" : "DEFENSE"} className="h-3.5 w-3.5" />
          {td(header.roleLabel)}
        </span>
      )}
      {phase && (
        <span
          data-testid="phase-chip"
          data-phase={phase}
          className={cn("rounded-[3px] border px-2 py-0.5 font-display text-[10px] font-bold tracking-[0.16em]", PHASE_TONE[phase] ?? "border-white/15 text-white/60")}
        >
          {td(PHASE_LABEL[phase])}
        </span>
      )}
      {header.finalLabel && (
        <span className="rounded-[3px] border border-drl-gold/55 bg-drl-gold/10 px-2 py-0.5 font-display text-[11px] font-bold tracking-[0.16em] text-drl-gold" data-testid="final-turn">
          {td(header.finalLabel)}
        </span>
      )}

      {/* En móvil el marcador ya está en el canto de la mesa: aquí queda solo para lectores de pantalla. */}
      <div
        className={compact ? "sr-only" : "sr-only sm:not-sr-only sm:ml-auto sm:flex sm:items-center sm:gap-2"}
        role="status"
        aria-live="polite"
        aria-label={t("Marcador: tú {scoreYou}, {rivalName} {scoreRival}", { scoreYou: view.scoreYou, rivalName, scoreRival: view.scoreRival })}
      >
        <span className="nx-label !text-[#2fe0ff]/80">{t("Tú")}</span>
        <motion.b key={`y${view.scoreYou}`} initial={{ scale: 1.4, opacity: 0.6 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.3 }} className="nx-readout text-[20px] leading-none text-[#2fe0ff]">
          {view.scoreYou}
        </motion.b>
        <span className="text-white/25">–</span>
        <motion.b key={`r${view.scoreRival}`} initial={{ scale: 1.4, opacity: 0.6 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.3 }} className="nx-readout text-[20px] leading-none text-drl">
          {view.scoreRival}
        </motion.b>
        <span className="nx-label max-w-[110px] truncate !text-drl/80">{rivalName}</span>
      </div>

      {header.matchPointLabel && (
        <p role="note" className="basis-full font-display text-[11px] font-bold tracking-[0.06em] text-drl-cyan" data-testid="match-point" data-point={header.matchPoint ?? ""}>
          ◆ {td(header.matchPointLabel)}
        </p>
      )}
      {/* Defendiendo, el eje lo IMPONE el servidor y se dice. Atacando se elige abajo, en los controles. */}
      {axis.mode !== "CHOOSE" && axis.text && (
        <p className="basis-full font-display text-[11px] font-bold tracking-[0.1em] text-white/70" data-axis={axis.mode}>
          {axis.mode === "IMPOSED" && axis.rivalStat && axis.yourStat ? (
            fill(t("EL RIVAL ATACA CON {ataque} · RESPONDES CON {respuesta}", slots("ataque", "respuesta")), {
              ataque: <b style={{ color: STAT_INFO[axis.rivalStat].color }}>{td(STAT_INFO[axis.rivalStat].label).toUpperCase()}</b>,
              respuesta: <b style={{ color: STAT_INFO[axis.yourStat].color }}>{td(STAT_INFO[axis.yourStat].label).toUpperCase()}</b>,
            })
          ) : td(axis.text)}
        </p>
      )}
    </section>
  );
}

/**
 * LÍNEA DE LOS DIEZ TURNOS. Una casilla por turno canónico: los jugados con su resultado real (glifo y
 * palabra, no solo color) y botón para abrir su detalle; el actual marcado; el futuro sin ningún dato.
 */
export function TurnTimeline({
  view, rivalName, layout = "row", className,
}: {
  view: DuelMatchView;
  rivalName: string;
  /** `row`: 10 columnas (debajo de la mano). `block`: 5×2 (columna lateral). */
  layout?: "row" | "block";
  className?: string;
}) {
  useLocale();
  const cells = useMemo(() => buildTimeline(view), [view]);
  const [open, setOpen] = useState<number | null>(null);
  if (view.status !== "IN_PROGRESS") return null;

  return (
    <div className={cn("mx-auto w-full", className)} style={{ maxWidth: layout === "row" ? "var(--arena-w, 100%)" : undefined }} data-timeline={layout}>
      <ol className={cn("grid gap-1", layout === "block" ? "grid-cols-5" : "grid-cols-10")} aria-label={t("Línea de turnos")}>
        {cells.map((c) => {
          const s = CELL[c.state];
          const playable = c.state === "WIN" || c.state === "LOSS" || c.state === "DRAW";
          return (
            <li key={c.number} className="min-w-0">
              <button
                type="button"
                disabled={!playable}
                onClick={() => setOpen(c.number)}
                aria-label={playable ? t("{label}. Ver detalle", { label: td(c.label) }) : td(c.label)}
                data-cell={c.state}
                className="nx-focus flex min-h-[44px] w-full flex-col items-center justify-center rounded-[3px] border transition enabled:hover:brightness-125 disabled:cursor-default"
                style={{ borderColor: s.border, background: s.bg }}
              >
                <span className="text-[9px] leading-none text-white/45">{c.number}</span>
                <span aria-hidden className="mt-0.5 text-[13px] leading-none" style={{ color: s.color }}>{c.glyph}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <p className="mt-1 text-center text-[10px] text-white/35">{t("● ganado · ○ perdido · — empate · ◆ en juego · toca un turno jugado para ver su detalle")}</p>
      <TurnDetailSheet view={view} turnNumber={open} rivalName={rivalName} onClose={() => setOpen(null)} />
    </div>
  );
}
