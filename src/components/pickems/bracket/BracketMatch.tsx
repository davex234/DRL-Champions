"use client";

/**
 * UNA CAJA DEL CUADRO (Fase 24.3) — el partido, y la predicción encima.
 *
 *     ╭────────────────────────────────╮
 *     │ SEMIFINAL · cierra en 01:42:18 │   ← ronda + estado / hora / cuenta atrás
 *     ├────────────────────────────────┤
 *     │ [LOGO] TEAM HERETICS       2   │   ← fila = <button> si se puede elegir
 *     │ [LOGO] FNATIC              1   │
 *     ├────────────────────────────────┤
 *     │ ✓ Tu pick: Heretics · Acertada · +25 │
 *     ╰────────────────────────────────╯
 *
 * NO decide nada: el marcador, el ganador (`winner`, del backend), el estado, la pregunta,
 * los puntos y el resultado vienen ya resueltos en `BracketMatch` (domain/pickems/bracket).
 * Elegir un equipo llama al MISMO `pick` que el tablero: `/api/pickems` → `app_submit_pick`.
 *
 * Un partido «Por definir» (sin los dos equipos) no se puede elegir: no hay pregunta con
 * participantes reales, y no se inventan.
 */
import { TeamLogo } from "@/components/cards/layers/TeamLogo";
import { Badge, StatusDot } from "@/components/ui/Badge";
import { cn } from "@/lib/format";
import { Countdown } from "../Countdown";
import type { PickFeedback } from "@/lib/usePickem";
import { canPickMatch, isDefined, type BracketMatch as Match } from "@/domain/pickems/bracket";
import { ns, td, tdIn, getIntlLocale } from "@/i18n/runtime";
import { roundText } from "@/lib/bracket/roundText";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";

const t = ns("pickems");

const fmtWhen = (iso: string | null): string => {
  if (!iso) return t("Sin fecha");
  const d = new Date(iso);
  return `${d.toLocaleTimeString(getIntlLocale(), { hour: "2-digit", minute: "2-digit" })} · ${d.toLocaleDateString(getIntlLocale(), { day: "numeric", month: "short" })}`;
};

const PICK_LABEL: Record<string, string> = {
  pendiente: "Elige un ganador",
  elegida: "Tu pick",
  bloqueada: "Bloqueada",
  "sin-prediccion": "Sin predicción",
  acertada: "Acertada",
  fallada: "Fallada",
  "sin-participar": "Sin predicción",
};

export function BracketMatchCard({
  m, roundLabel, saving, feedback, readOnly, onPick, onExpire, className, compact, highlight,
}: {
  m: Match;
  roundLabel: string;
  saving?: boolean;
  feedback?: PickFeedback | null;
  readOnly?: boolean;
  onPick?: (m: Match, option: string) => void;
  onExpire?: () => void;
  className?: string;
  /** Móvil: la caja ocupa el ancho; en columna, ancho fijo. */
  compact?: boolean;
  /** 24.5 · acaba de cambiar en este refresco (resultado, participante nuevo): brillo breve. */
  highlight?: boolean;
}) {
  useLocale();
  const defined = isDefined(m);
  const live = m.status === "live";
  const finished = m.status === "finished" || m.status === "completed";
  const pickable = !readOnly && canPickMatch(m) && !saving && !!onPick;
  const state = m.pickState;
  const hit = state === "acertada";
  const miss = state === "fallada";
  const noPick = state === "sin-prediccion" || state === "sin-participar";
  const mySide: "a" | "b" | null =
    m.selectedOption === null ? null : m.selectedOption === m.optionA ? "a" : m.selectedOption === m.optionB ? "b" : null;

  const tone = hit ? "63,192,122" : miss ? "255,46,99" : live ? "25,227,255" : mySide ? "255,211,92" : "255,255,255";

  const rowLabel = (side: "a" | "b") => {
    const me = side === "a" ? m.teamA : m.teamB;
    const rival = side === "a" ? m.teamB : m.teamA;
    return t("Seleccionar {v} como ganador frente a {v2}", { v: me?.name ?? t("por definir"), v2: rival?.name ?? t("por definir") });
  };

  return (
    <article
      data-match-id={m.id}
      data-state={state ?? "none"}
      aria-label={t("{roundLabel}: {v} contra {v2}", { roundLabel: roundText(roundLabel), v: m.teamA?.name ?? t("Por definir"), v2: m.teamB?.name ?? t("Por definir") })}
      className={cn(
        "nx-clip-sm nx-bracket-card relative flex flex-col",
        compact ? "w-full" : "w-[260px] sm:w-[280px]",
        highlight && "nx-live-glow",
        className,
      )}
      data-highlight={highlight ? "true" : undefined}
      style={{
        ["--nx-tint" as string]: tone,
        background: `linear-gradient(180deg, rgb(${tone} / 0.09), rgba(255,255,255,0.02) 55%), rgba(8,10,18,0.92)`,
        boxShadow: `inset 0 0 0 1px rgb(${tone} / ${tone === "255,255,255" ? 0.14 : 0.45}), 0 10px 26px -14px rgba(0,0,0,0.9)${live ? `, 0 0 22px -6px rgb(${tone} / 0.5)` : ""}`,
      }}
    >
      {/* ── Cabecera: ronda · estado ── */}
      <header className="flex items-center justify-between gap-2 px-3 py-1.5">
        <span className="nx-label truncate">{roundText(roundLabel)}</span>
        {live ? (
          <Badge tone="key" dot pulse>{t("En juego")}</Badge>
        ) : finished ? (
          <span className="flex items-center gap-1.5"><StatusDot tone="muted" size={5} /><span className="nx-label">{t("Final")}</span></span>
        ) : m.lockState === "open" && m.locksAt ? (
          <Countdown to={m.locksAt} onExpire={onExpire} prefix={t("Cierra en")} className="nx-label shrink-0" />
        ) : (
          <span className="nx-label shrink-0">{fmtWhen(m.startsAt)}</span>
        )}
      </header>

      <div aria-hidden className="h-px" style={{ background: `linear-gradient(90deg, transparent, rgb(${tone} / 0.35), transparent)` }} />

      {/* ── Los dos bandos ── */}
      <div className="flex flex-col">
        {(["a", "b"] as const).map((side, i) => {
          const team = side === "a" ? m.teamA : m.teamB;
          const score = side === "a" ? m.scoreA : m.scoreB;
          const option = side === "a" ? m.optionA : m.optionB;
          const won = m.winner === side;
          const lost = finished && m.winner !== null && m.winner !== side;
          const selected = mySide === side;
          const correct = m.correctOption !== null && option !== null && m.correctOption === option;
          const inner = (
            <>
              {/* Marca de selección / acierto / fallo: dibujada, no solo color. */}
              <span className="grid w-5 shrink-0 place-items-center" aria-hidden>
                {selected && (hit || miss) ? (
                  <svg viewBox="0 0 12 12" className="h-3.5 w-3.5" fill="none" stroke={hit ? "var(--nx-ok)" : "var(--nx-bad)"} strokeWidth="2" strokeLinecap="round">
                    {hit ? <path d="M2 6.4 4.8 9.2 10 3.4" /> : <><path d="M3 3l6 6" /><path d="M9 3l-6 6" /></>}
                  </svg>
                ) : selected ? (
                  <span className="h-2 w-2 rounded-full" style={{ background: "var(--nx-gold)", boxShadow: "0 0 8px var(--nx-gold)" }} />
                ) : correct && !selected ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-ok/70" />
                ) : null}
              </span>
              {team ? (
                <span className="shrink-0" aria-hidden><TeamLogo team={team.name} size={22} /></span>
              ) : (
                <span aria-hidden className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-md bg-white/5 text-[10px] text-ink-faint">?</span>
              )}
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-left font-display text-[13px] font-bold uppercase tracking-[0.03em]",
                  won ? "text-white" : lost ? "text-ink-faint" : team ? "text-ink-primary" : "italic normal-case text-ink-faint",
                )}
              >
                {team?.name ?? t("Por definir")}
              </span>
              {won && <span aria-hidden className="h-4 w-[3px] shrink-0 bg-ok" />}
              <span
                className={cn(
                  "nx-readout w-6 shrink-0 text-right text-[15px] tabular-nums",
                  won ? "text-white" : lost ? "text-ink-faint" : live ? "text-drl-cyan" : "text-ink-muted",
                )}
                aria-label={score === null ? t("sin marcador") : `${score}`}
              >
                {score === null ? "–" : score}
              </span>
            </>
          );
          const rowCls = cn(
            "flex min-h-[44px] w-full items-center gap-2 px-2.5 py-1.5 transition duration-fast motion-reduce:transition-none",
            i === 0 && "border-b border-white/[0.06]",
            selected && "bg-drl-gold/[0.08]",
            won && "bg-ok/[0.06]",
          );
          return pickable ? (
            <button
              key={side}
              type="button"
              onClick={() => option && onPick?.(m, option)}
              aria-pressed={selected}
              aria-label={rowLabel(side)}
              className={cn(rowCls, "nx-focus hover:bg-white/[0.06]", selected && "nx-pick-pop")}
            >
              {inner}
            </button>
          ) : (
            <div key={side} className={rowCls} aria-current={selected ? "true" : undefined}>
              {inner}
            </div>
          );
        })}
      </div>

      {/* ── Pie: la predicción, con palabras ── */}
      <footer className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-t border-white/[0.06] px-3 py-1.5" role="status" aria-live="polite">
        {feedback ? (
          <span className={cn("nx-label", feedback.kind === "saved" && "!text-ok", feedback.kind === "error" && "!text-bad", feedback.kind === "locked" && "!text-warn")}>
            {td(feedback.message)}
          </span>
        ) : !defined ? (
          <span className="nx-label">{t("Por definir · sin predicción hasta que haya equipos")}</span>
        ) : !m.questionId ? (
          <span className="nx-label">{t("Sin predicción disponible")}</span>
        ) : hit ? (
          <span className="nx-label !text-ok">{t("✓ Tu pick: {equipo} · Acertada · +{n} pts", { equipo: (mySide === "a" ? m.teamA : m.teamB)?.name ?? "", n: m.pointsAward ?? m.points })}</span>
        ) : miss ? (
          <span className="nx-label !text-bad">{t("✕ Tu pick: {equipo} · Fallada · +0 pts", { equipo: (mySide === "a" ? m.teamA : m.teamB)?.name ?? "" })}</span>
        ) : noPick ? (
          <span className="nx-label !text-warn">{m.lockState !== "open" ? t("Sin predicción · Cerrada") : t("Sin predicción")}</span>
        ) : state === "bloqueada" ? (
          <span className="nx-label">{fill(t("Bloqueada · Tu pick: {equipo}", slots("equipo")), { equipo: <b className="text-white">{(mySide === "a" ? m.teamA : m.teamB)?.name}</b> })}</span>
        ) : state === "elegida" ? (
          <span className="nx-label">{fill(
            readOnly
              ? t("Tu pick: {equipo} · +{n} pts", { ...slots("equipo"), n: m.points })
              : t("Tu pick: {equipo} · puedes cambiarlo · +{n} pts", { ...slots("equipo"), n: m.points }),
            { equipo: <b className="text-white">{(mySide === "a" ? m.teamA : m.teamB)?.name}</b> },
          )}</span>
        ) : (
          <span className="nx-label">{tdIn("pickems", PICK_LABEL[state ?? "pendiente"])} · <b className="text-drl-gold">+{m.points} {t("pts")}</b></span>
        )}
        {saving && <span className="nx-label ml-auto">{t("Guardando…")}</span>}
      </footer>
    </article>
  );
}
