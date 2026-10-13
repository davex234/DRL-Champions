"use client";

/**
 * F86 · PIEZAS DE TORNEO (presentación pura): estado, cuenta atrás, participante, cruce y momento de campeón.
 * Nada se calcula aquí: el estado de cada cruce, el ganador, el marcador y «tú» los dice el servidor.
 * Accesibilidad: el estado SIEMPRE va en texto (nunca solo color), cada cruce es un artículo con nombre completo,
 * la cuenta atrás es un `<time>` con su fecha y se anuncia sin interrumpir.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/format";
import { PHASE_LABEL, MATCH_LABEL, type MatchDisplayState } from "@/domain/cups/lifecycle";
import type { CupPhase } from "@/domain/cups/types";
import type { CupMatchView, CupPlayer } from "@/server/services/cups";
import { formatTag } from "@/domain/account/tag";

const GOLD = "#ffce4f";
const CYAN = "#19e3ff";
const RED = "#ff2e63";

/* ───────────── estado del torneo ───────────── */

const PHASE_TONE: Record<CupPhase, string> = {
  DRAFT: "rgba(255,255,255,0.5)", SCHEDULED: "rgba(255,255,255,0.75)", REGISTRATION_OPEN: CYAN, REGISTRATION_CLOSED: "rgba(255,255,255,0.75)",
  IN_PROGRESS: RED, COMPLETED: GOLD, CANCELLED: "rgba(255,255,255,0.45)",
};
const PHASE_GLYPH: Record<CupPhase, string> = { DRAFT: "✎", SCHEDULED: "◷", REGISTRATION_OPEN: "●", REGISTRATION_CLOSED: "■", IN_PROGRESS: "▶", COMPLETED: "♛", CANCELLED: "✕" };

export function CupPhaseChip({ phase, className }: { phase: CupPhase; className?: string }) {
  const c = PHASE_TONE[phase];
  return (
    <span data-testid="cup-phase" data-phase={phase}
      className={cn("inline-flex items-center gap-1.5 whitespace-nowrap px-2 py-0.5 font-display text-[11px] font-bold uppercase tracking-[0.14em]", className)}
      style={{ color: c, boxShadow: `inset 0 0 0 1px ${c}66`, background: `${c === GOLD || c === CYAN || c === RED ? c : "#ffffff"}12` }}>
      <span aria-hidden>{PHASE_GLYPH[phase]}</span>{PHASE_LABEL[phase]}
    </span>
  );
}

/* ───────────── cuenta atrás (visual; la elegibilidad la decide el servidor) ───────────── */

export function remainingText(ms: number): string {
  if (ms <= 0) return "ahora";
  const m = Math.floor(ms / 60_000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${mm} min`;
  if (m > 0) return `${m} min`;
  return `${Math.ceil(ms / 1000)} s`;
}

/** `offset` = hora del servidor − hora del navegador al leer: la cuenta atrás no depende de un reloj local mal puesto. */
export function Countdown({ to, offset = 0, prefix, className }: { to: string; offset?: number; prefix: string; className?: string }) {
  const target = Date.parse(to);
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    const left = target - (Date.now() + offset);
    const id = window.setInterval(() => setNow(Date.now() + offset), left < 3_600_000 ? 1_000 : 30_000);
    return () => window.clearInterval(id);
  }, [target, offset]);
  const date = new Date(target).toLocaleString("es-ES", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <span className={cn("tabular-nums", className)} data-testid="cup-countdown">
      {prefix} <time dateTime={to} title={date} aria-label={`${prefix} ${remainingText(target - now)} (${date})`}>{remainingText(target - now)}</time>
    </span>
  );
}

export const fmtDate = (iso: string) => new Date(iso).toLocaleString("es-ES", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
export const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });

/* ───────────── participante ───────────── */

export function playerLabel(p: CupPlayer | null): string {
  if (!p) return "por decidir";
  return `${p.username}${p.tag ? ` ${formatTag(p.tag)}` : ""}${p.you ? " (tú)" : ""}`;
}

export function CupPlayerLine({ p, empty, emptyText = "Por decidir", winner, loser, compact = false }: {
  p: CupPlayer | null; empty?: boolean; emptyText?: string; winner?: boolean; loser?: boolean; compact?: boolean;
}) {
  if (!p) {
    return (
      <div className={cn("flex min-w-0 items-center gap-2", compact ? "h-7" : "h-9")} data-field="cup-slot-empty">
        <span aria-hidden className="w-5 shrink-0 text-right text-[11px] text-white/25">–</span>
        <span className="truncate text-[13px] italic text-white/40">{empty ? "Pase directo" : emptyText}</span>
      </div>
    );
  }
  return (
    <div className={cn("flex min-w-0 items-center gap-2", compact ? "h-7" : "h-9", loser && "opacity-55")} data-field="cup-slot" data-you={p.you ? "1" : "0"}>
      <span className="w-5 shrink-0 text-right font-mono text-[11px] text-white/45" title="Cabeza de serie">{p.seed ?? ""}</span>
      <span aria-hidden className="shrink-0 text-[15px] leading-none">{p.avatar}</span>
      <span className="min-w-0 flex-1 truncate">
        <span className={cn("font-display text-[14px] uppercase tracking-wide", winner ? "font-black text-white" : "font-bold text-white/85", p.you && "text-[#19e3ff]")}>{p.username}</span>
        {p.tag && !compact && <span className="ml-1.5 font-mono text-[11px] text-white/45" data-field="cup-tag">{formatTag(p.tag)}</span>}
      </span>
      {winner && <span className="shrink-0 font-display text-[11px] font-black uppercase tracking-wider" style={{ color: GOLD }}>✓ Gana</span>}
    </div>
  );
}

/* ───────────── cruce ───────────── */

const STATE_TONE: Partial<Record<MatchDisplayState, string>> = {
  ACTIVE: RED, READY: CYAN, ACTION_REQUIRED: GOLD, NO_SHOW_PENDING: GOLD, COMPLETED: "rgba(255,255,255,0.55)", BYE: "rgba(255,255,255,0.45)",
};

export function matchAria(m: CupMatchView, roundTitle: string): string {
  const who = `${playerLabel(m.a)} contra ${playerLabel(m.b)}`;
  const res = m.winner ? `, gana ${playerLabel(m.winner === "A" ? m.a : m.b)}${m.score ? ` ${m.score.a} a ${m.score.b}` : ""}` : "";
  return `${roundTitle}, cruce ${m.slot + 1}: ${m.state === "BYE" ? `${playerLabel(m.a ?? m.b)} pasa directo` : who}${res}. ${MATCH_LABEL[m.state]}.`;
}

export function CupMatchCard({ m, roundTitle, className, id }: { m: CupMatchView; roundTitle: string; className?: string; id?: string }) {
  const tone = STATE_TONE[m.state];
  const aWin = m.winner === "A", bWin = m.winner === "B";
  return (
    <article id={id} tabIndex={-1} aria-label={matchAria(m, roundTitle)} data-testid="cup-match" data-round={m.round} data-slot={m.slot} data-state={m.state} data-you={m.you ? "1" : "0"}
      className={cn("nx-clip-sm relative w-full min-w-0 bg-[#0b0e17]/95 px-2.5 py-1.5", className)}
      style={{ boxShadow: m.you ? `inset 0 0 0 1.5px ${CYAN}, 0 0 18px -6px ${CYAN}` : "inset 0 0 0 1px rgba(255,255,255,0.12)" }}>
      <CupPlayerLine p={m.a} empty={m.aEmpty} winner={aWin} loser={bWin} />
      <div aria-hidden className="mx-1 h-px bg-white/[0.07]" />
      <CupPlayerLine p={m.b} empty={m.bEmpty} winner={bWin} loser={aWin} />
      <div className="mt-0.5 flex items-center justify-between gap-2 border-t border-white/[0.06] pt-1">
        <span className="truncate text-[10.5px] font-bold uppercase tracking-[0.12em]" style={{ color: tone ?? "rgba(255,255,255,0.45)" }} data-field="cup-match-state">
          {m.state === "ACTIVE" && <span aria-hidden className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[#ff2e63] align-middle motion-reduce:animate-none" />}
          {MATCH_LABEL[m.state]}
        </span>
        {m.score && <span className="shrink-0 font-mono text-[11px] text-white/70" data-field="cup-score">{m.score.a}–{m.score.b}</span>}
        {!m.score && m.winner && m.resolution && m.resolution !== "PLAYED" && m.resolution !== "BYE" && (
          <span className="shrink-0 text-[10.5px] text-white/50">{m.resolution === "ABANDON" ? "por abandono" : "decisión de la organización"}</span>
        )}
      </div>
    </article>
  );
}

/* ───────────── campeón ───────────── */

export function ChampionMoment({ champion, cupName, completedAt, youWon }: { champion: CupPlayer; cupName: string; completedAt: string | null; youWon: boolean }) {
  const reduce = useReducedMotion();
  return (
    <motion.section aria-labelledby="cup-champion-title" data-testid="cup-champion" data-you={youWon ? "1" : "0"}
      initial={reduce ? false : { opacity: 0, scale: 0.96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
      className="nx-clip relative isolate overflow-hidden px-5 py-6 text-center sm:px-8"
      style={{ border: `1px solid ${GOLD}66`, background: `radial-gradient(90% 120% at 50% 0%, ${GOLD}2e, transparent 60%), linear-gradient(180deg, rgba(255,255,255,0.05), rgba(0,0,0,0.3))` }}>
      {!reduce && youWon && (
        <motion.div aria-hidden className="pointer-events-none absolute inset-0" initial={{ opacity: 0.9 }} animate={{ opacity: 0 }} transition={{ duration: 1.6 }}
          style={{ background: `radial-gradient(60% 60% at 50% 40%, ${GOLD}55, transparent 70%)` }} />
      )}
      <p className="font-display text-[12px] font-black uppercase tracking-[0.3em]" style={{ color: GOLD }}>{youWon ? "¡Eres el campeón!" : "Campeón"}</p>
      <div className="mx-auto mt-3 grid h-20 w-20 place-items-center" aria-hidden
        style={{ clipPath: "polygon(50% 0, 100% 14%, 100% 64%, 50% 100%, 0 64%, 0 14%)", background: `linear-gradient(160deg, ${GOLD}, rgba(255,255,255,0.25) 45%, ${GOLD}aa)` }}>
        <span className="grid h-[72px] w-[72px] place-items-center text-[34px]" style={{ clipPath: "polygon(50% 0, 100% 14%, 100% 64%, 50% 100%, 0 64%, 0 14%)", background: "radial-gradient(70% 60% at 50% 35%, rgba(255,255,255,0.10), rgba(7,8,14,0.96) 70%)", color: GOLD }}>♛</span>
      </div>
      <h2 id="cup-champion-title" className="mt-3 break-words font-display text-[28px] font-black uppercase leading-none text-white sm:text-[34px]">
        <span aria-hidden className="mr-2">{champion.avatar}</span>{champion.username}
      </h2>
      {champion.tag && <p className="mt-1 font-mono text-[13px] text-white/60">{formatTag(champion.tag)}</p>}
      <p className="mt-3 text-[13px] text-white/70">{cupName}{completedAt ? ` · ${fmtDay(completedAt)}` : ""}</p>
      {/* F86.2 · el campeón llega a su trofeo con un toque (antes el texto lo nombraba pero no llevaba a ningún sitio). */}
      {youWon ? (
        <p className="mt-1 text-[12px] text-white/50">Tu trofeo ya está en tu{" "}
          <Link href="/coleccion/trofeos" data-testid="cup-champion-trophies" className="nx-focus font-bold underline underline-offset-2" style={{ color: GOLD }}>Sala de Trofeos</Link>.
        </p>
      ) : <p className="mt-1 text-[12px] text-white/50">El trofeo de campeón es permanente y único.</p>}
    </motion.section>
  );
}
