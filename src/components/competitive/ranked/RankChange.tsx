"use client";

/**
 * F84 · CAMBIO DE RANGO tras una partida ranked. Todo llega HECHO del servidor (`?outcome=1` → `rank`, derivado del
 * asiento de la liquidación): rating viejo → delta → nuevo, rango antes/después, colocación. Aquí solo se cuenta.
 *
 *   ASCENSO              emblema viejo → el rating sube y cruza la frontera → destello → emblema nuevo (≈ 3 s).
 *   RANGO OBTENIDO       las N partidas de colocación se completan → se revela el rango (el mejor momento del ranked).
 *   DESCENSO             sobrio: dicho con claridad, sin pantalla punitiva ni fiesta.
 *   MISMA DIVISIÓN       «+18» y la barra dentro de la división (sin prometer probabilidades).
 *   COLOCACIÓN X / N     segmentos y delta; el rango se enseña al cerrarla.
 *
 * Movimiento reducido: la MISMA información, sin animación. Varias pestañas / F5: el dato es idéntico (sale del asiento);
 * la animación se consume una vez por navegador (`localStorage`), y si ya se vio se pinta el estado final.
 */
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/format";
import { rankChip, type DerivedRank } from "@/domain/ranked/config";
import { rankMovementLabel, type RankMovement } from "@/domain/ranked/standing";
import { CompetitiveEmblem } from "./CompetitiveEmblem";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";

const tr = ns("competitive");

const KEY = (matchId: string) => `drl:rank-ceremony:${matchId}`;

/**
 * ¿Hay que animar? Una vez por partida y navegador; nunca con movimiento reducido. Se decide en el PRIMER render (en el
 * navegador; en servidor/tests no hay `window` → estado final) para no pintar el rango un fotograma antes de revelarlo.
 */
function seen(matchId: string): boolean {
  try { return window.localStorage.getItem(KEY(matchId)) === "1"; } catch { return false; }
}

/**
 * RESULTADO ÚNICO · el «ya visto» de la ceremonia para quien decide si ENSEÑARLA (centro Competitivo), con la misma clave
 * pero por CUENTA: `drl:rank-ceremony:<usuario>:<partida>`. Dos cuentas que se enfrentaron comparten partida; así la que
 * la ve antes en un navegador no se la oculta a la otra. La marca de la ANIMACIÓN (por partida, arriba) no cambia.
 * Sin cuenta: se da por vista (no se enseña nada que no se pueda atribuir a nadie).
 */
const SHOWN_KEY = (userId: string, matchId: string) => `drl:rank-ceremony:${userId}:${matchId}`;
export function rankCeremonySeen(userId: string | null | undefined, matchId: string): boolean {
  if (!userId) return true;
  try { return typeof window !== "undefined" && window.localStorage.getItem(SHOWN_KEY(userId, matchId)) === "1"; } catch { return false; }
}
export function markRankCeremonySeen(userId: string | null | undefined, matchId: string): void {
  if (!userId) return;
  try { window.localStorage.setItem(SHOWN_KEY(userId, matchId), "1"); } catch { /* sin almacenamiento: se volverá a enseñar */ }
}
function useCeremonyOnce(matchId: string | null, reduced: boolean): boolean {
  const [animate] = useState(() => typeof window !== "undefined" && !!matchId && !reduced && !seen(matchId));
  useEffect(() => {
    if (!animate || !matchId) return;
    try { window.localStorage.setItem(KEY(matchId), "1"); } catch { /* sin almacenamiento: se anima igual */ }
  }, [animate, matchId]);
  return animate;
}

/** Contador del rating viejo → nuevo (rAF); estático si no se anima. */
function useCount(from: number, to: number, run: boolean, delayMs: number, durMs: number): number {
  const [v, setV] = useState(run ? from : to);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    if (!run) { setV(to); return; }
    setV(from);
    const t0 = performance.now() + delayMs;
    const tick = (t: number) => {
      const k = Math.max(0, Math.min(1, (t - t0) / durMs));
      const e = 1 - Math.pow(1 - k, 3);
      setV(Math.round(from + (to - from) * e));
      if (k < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current !== null) cancelAnimationFrame(raf.current); };
  }, [from, to, run, delayMs, durMs]);
  return v;
}

const TONE = { up: "#19e3ff", down: "#ff5c85", gold: "#ffd35c" };

export function RankChange({ movement, matchId, positions = null, position = null, rankedTotal = null, className }: {
  movement: RankMovement;
  matchId: string | null;
  /** Puestos ganados/perdidos en el Top (dos fotos del servidor), si se midieron. */
  positions?: number | null;
  position?: number | null;
  rankedTotal?: number | null;
  className?: string;
}) {
  useLocale();
  const reduced = !!useReducedMotion();
  const animate = useCeremonyOnce(matchId, reduced);
  const m = movement;
  if (m.kind === "UNSEASONED") return null;

  const sign = m.delta > 0 ? `+${m.delta}` : `${m.delta}`;
  const posLine = positions === null || position === null ? null
    : positions > 0 ? (positions === 1 ? tr("Subes {n} puesto en el Top (#{position})", { n: positions, position }) : tr("Subes {n} puestos en el Top (#{position})", { n: positions, position }))
      : positions < 0 ? (positions === -1 ? tr("Bajas {n} puesto en el Top (#{position})", { n: -positions, position }) : tr("Bajas {n} puestos en el Top (#{position})", { n: -positions, position })) : tr("Mantienes el #{position} del Top", { position });

  const common = { "data-testid": "rank-change", "data-kind": m.kind, "data-animated": animate ? "true" : "false" };
  const capNote = m.pairCapped && <p className="mt-2 text-center text-[11.5px] text-white/55" data-field="pair-cap">{tr("Partida contada sin cambio de rating: ya habéis jugado varias partidas puntuadas entre vosotros en las últimas horas.")}</p>;

  if (m.kind === "PLACEMENT_PROGRESS" && m.placement) {
    return (
      <section aria-label={rankMovementLabel(m)} className={cn("nx-clip mt-3 border border-drl-cyan/40 px-4 py-4 text-center", className)} style={{ background: "radial-gradient(90% 120% at 50% 0%, rgba(25,227,255,0.14), rgba(0,0,0,0.3) 70%)" }} {...common}>
        <p className="nx-label !text-drl-cyan">{tr("Colocación")}</p>
        <p className="mt-1 font-display text-[28px] font-bold uppercase leading-none text-white" data-field="placement">{m.placement.played} / {m.placement.total}</p>
        <Segments played={m.placement.played} total={m.placement.total} animateLast={animate} />
        <p className="mt-2 text-[13px] text-white/70">{tr("Rating")} {m.oldRating} → <b className="text-white">{m.newRating}</b> <span className={m.delta >= 0 ? "text-drl-cyan" : "text-drl-glow"}>({td(sign)})</span>. {m.placement.total - m.placement.played === 1 ? tr("Una partida más y se revela tu rango.") : tr("Te faltan {v} para revelar tu rango.", { v: m.placement.total - m.placement.played })}</p>
        {capNote}
      </section>
    );
  }

  if (m.kind === "PLACEMENT_COMPLETE" && m.after) {
    return <Reveal m={m} after={m.after} animate={animate} posLine={posLine} common={common} className={className} capNote={capNote} />;
  }

  if (m.kind === "PROMOTION" && m.before && m.after) {
    return <Promotion m={m} before={m.before} after={m.after} animate={animate} posLine={posLine} common={common} className={className} capNote={capNote} />;
  }

  if (m.kind === "DEMOTION" && m.before && m.after) {
    return (
      <section aria-label={rankMovementLabel(m)} className={cn("nx-clip mt-3 border border-white/15 bg-white/[0.03] px-4 py-4", className)} {...common}>
        <p className="text-center font-display text-[22px] font-bold uppercase tracking-wide" style={{ color: TONE.down }} data-field="ceremony-word"><span aria-hidden className="mr-1.5">▼</span>{tr("Descenso")}</p>
        <div className="mt-3 flex items-center justify-center gap-4">
          <RankSide rank={m.before} label={tr("Antes")} dim />
          <span aria-hidden className="text-[20px] text-white/35">→</span>
          <RankSide rank={m.after} label={tr("Ahora")} />
        </div>
        <p className="mt-2 text-center text-[13px] text-white/70">{fill(tr("Rating {antes} → {ahora} ({cambio}). Te faltan {n} para volver a {rango}.", { antes: m.oldRating, ...slots("ahora"), cambio: td(sign), n: m.after.pointsToNext, rango: td(m.after.nextLabel) }), { ahora: <b className="text-white">{m.newRating}</b> })}</p>
        {posLine && <p className="mt-1 text-center text-[11.5px] text-white/45" data-field="positions">{td(posLine)}</p>}
        {capNote}
      </section>
    );
  }

  // MISMA DIVISIÓN
  const after = m.after!;
  return (
    <section aria-label={rankMovementLabel(m)} className={cn("nx-clip mt-3 border px-4 py-4", className)} style={{ borderColor: `${after.color}55`, background: `radial-gradient(90% 120% at 50% 0%, ${after.color}1c, rgba(0,0,0,0.3) 70%)` }} {...common}>
      <div className="flex items-center gap-4">
        <CompetitiveEmblem rank={rankChip(after)} state="RANKED" size="md" animate={animate} />
        <div className="min-w-0 flex-1">
          <p className="font-display text-[22px] font-bold uppercase leading-none text-white" data-field="rank-label">{td(after.label)}</p>
          <p className="mt-1 nx-readout text-[26px] leading-none" style={{ color: m.delta >= 0 ? TONE.up : TONE.down }} data-field="delta">{td(sign)}</p>
          {after.progress !== null && m.before?.progress != null && (
            <DivisionBar from={m.before.progress} to={after.progress} color={after.color} animate={animate} label={`${after.label} → ${after.nextLabel}`} />
          )}
          <p className="mt-1 text-[12px] text-white/60">{after.pointsToNext !== null ? tr("{pointsToNext} para {nextLabel}", { pointsToNext: after.pointsToNext, nextLabel: td(after.nextLabel) }) : tr("Cumbre: defiende tu puesto en el Top")}</p>
        </div>
      </div>
      {posLine && <p className="mt-2 text-[11.5px] text-white/45" data-field="positions">{td(posLine)}</p>}
      {capNote}
    </section>
  );
}

function RankSide({ rank, label, dim = false }: { rank: DerivedRank; label: string; dim?: boolean }) {
  useLocale();
  return (
    <span className={cn("flex flex-col items-center gap-1", dim && "opacity-60")}>
      <span className="nx-label !text-[10px]">{td(label)}</span>
      <CompetitiveEmblem rank={rankChip(rank)} state="RANKED" size="sm" animate={false} />
      <span className="font-display text-[13px] font-bold uppercase" style={{ color: rank.color }}>{td(rank.label)}</span>
    </span>
  );
}

function Segments({ played, total, animateLast }: { played: number; total: number; animateLast: boolean }) {
  return (
    <ol className="mx-auto mt-2 grid max-w-[260px] gap-1.5" style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }} aria-hidden>
      {Array.from({ length: total }, (_, i) => {
        const lit = i < played, last = i === played - 1;
        return (
          <li key={i} className="nx-clip-sm h-2.5 overflow-hidden bg-white/10">
            {lit && <motion.span className="block h-full bg-drl-cyan" initial={animateLast && last ? { width: "0%" } : false} animate={{ width: "100%" }} transition={{ duration: 0.6, delay: 0.3 }} />}
          </li>
        );
      })}
    </ol>
  );
}

function DivisionBar({ from, to, color, animate, label }: { from: number; to: number; color: string; animate: boolean; label: string }) {
  useLocale();
  return (
    <div className="nx-clip-sm relative mt-2 h-2 overflow-hidden bg-white/10" role="img" aria-label={tr("Progreso en la división: {Math} %. {label}", { Math: Math.round(to * 100), label: td(label) })}>
      <motion.div className="absolute inset-y-0 left-0" style={{ background: color }} initial={animate ? { width: `${from * 100}%` } : false} animate={{ width: `${Math.max(3, to * 100)}%` }} transition={{ duration: 0.9, delay: 0.4, ease: [0.16, 1, 0.3, 1] }} />
    </div>
  );
}

interface CeremonyProps { m: RankMovement; animate: boolean; posLine: string | null; common: Record<string, string>; className?: string; capNote: React.ReactNode }

/** ASCENSO: viejo → contador cruza la frontera → destello → nuevo. ≈ 3 s; con movimiento reducido, el final quieto. */
function Promotion({ m, before, after, animate, posLine, common, className, capNote }: CeremonyProps & { before: DerivedRank; after: DerivedRank }) {
  useLocale();
  const [phase, setPhase] = useState<"old" | "new">(animate ? "old" : "new");
  useEffect(() => {
    if (!animate) { setPhase("new"); return; }
    setPhase("old");
    const t = setTimeout(() => setPhase("new"), 1700);
    return () => clearTimeout(t);
  }, [animate]);
  const shown = useCount(m.oldRating, m.newRating, animate, 350, 1200);
  const big = m.tierChange;
  const tone = after.color;
  return (
    <section aria-label={rankMovementLabel(m)} className={cn("nx-clip relative mt-3 overflow-hidden border px-4 py-5 text-center", className)}
      style={{ borderColor: `${tone}77`, background: `radial-gradient(90% 120% at 50% 0%, ${tone}33, rgba(0,0,0,0.35) 70%)` }} {...common} data-tier-change={big ? "true" : "false"}>
      {animate && phase === "new" && [0, 1].map((i) => (
        <motion.span key={i} aria-hidden className="pointer-events-none absolute left-1/2 top-[42%] h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
          style={{ borderColor: tone }} initial={{ scale: 0.3, opacity: 0.9 }} animate={{ scale: big ? 3.2 : 2.4, opacity: 0 }} transition={{ delay: i * 0.25, duration: 1.2, ease: "easeOut" }} />
      ))}
      <p className="font-display text-[clamp(26px,7vw,42px)] font-bold uppercase leading-none tracking-wide" style={{ color: tone, textShadow: `0 0 26px ${tone}99` }} data-field="ceremony-word">
        <span aria-hidden className="mr-2">▲</span>{tr("Ascenso")}
      </p>
      <div className="relative mx-auto mt-3 grid h-[176px] place-items-center">
        <AnimatePresence mode="wait" initial={false}>
          {phase === "old" ? (
            <motion.div key="old" initial={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6, filter: "brightness(2.4)" }} transition={{ duration: 0.3 }}>
              <CompetitiveEmblem rank={rankChip(before)} state="RANKED" size="lg" animate={false} />
            </motion.div>
          ) : (
            <motion.div key="new" initial={animate ? { opacity: 0, scale: 1.5 } : false} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}>
              <CompetitiveEmblem rank={rankChip(after)} state="RANKED" size="lg" animate={false} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <p className="font-display text-[24px] font-bold uppercase leading-none text-white" data-field="rank-label">{phase === "new" ? td(after.label) : td(before.label)}</p>
      <p className="mt-1 text-[13px] text-white/60" data-field="rank-from">{tr("desde {rango}", { rango: td(before.label) })}</p>
      <p className="mt-2 nx-readout text-[30px] leading-none text-white tabular-nums" data-field="rating">{shown} <span className="text-[18px]" style={{ color: tone }}>({m.delta > 0 ? `+${m.delta}` : m.delta})</span></p>
      {posLine && <p className="mt-1.5 text-[11.5px] text-white/50" data-field="positions">{td(posLine)}</p>}
      {capNote}
    </section>
  );
}

/** RANGO OBTENIDO al cerrar la colocación: segmentos completos → revelación del emblema. */
function Reveal({ m, after, animate, posLine, common, className, capNote }: CeremonyProps & { after: DerivedRank }) {
  useLocale();
  const [shownRank, setShownRank] = useState(!animate);
  useEffect(() => {
    if (!animate) { setShownRank(true); return; }
    setShownRank(false);
    const t = setTimeout(() => setShownRank(true), 1400);
    return () => clearTimeout(t);
  }, [animate]);
  const tone = after.color;
  const total = m.placement?.total ?? 5;
  return (
    <section aria-label={rankMovementLabel(m)} className={cn("nx-clip relative mt-3 overflow-hidden border px-4 py-6 text-center", className)}
      style={{ borderColor: `${tone}88`, background: `radial-gradient(100% 120% at 50% 10%, ${tone}38, rgba(0,0,0,0.4) 72%)` }} {...common}>
      <p className="nx-label !text-drl-gold">{tr("Colocación completada ·")} {total} / {total}</p>
      <Segments played={total} total={total} animateLast={animate} />
      <p className="mt-3 font-display text-[clamp(24px,6vw,36px)] font-bold uppercase leading-none tracking-[0.08em] text-white" data-field="ceremony-word">{tr("Rango obtenido")}</p>
      <div className="relative mx-auto mt-3 grid h-[196px] place-items-center">
        {shownRank ? (
          <motion.div initial={animate ? { opacity: 0, scale: 0.4, rotate: -8 } : false} animate={{ opacity: 1, scale: 1, rotate: 0 }} transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}>
            <CompetitiveEmblem rank={rankChip(after)} state="RANKED" size="lg" animate={false} />
          </motion.div>
        ) : (
          <motion.span aria-hidden className="h-28 w-28 rounded-full border-2 border-white/40" initial={{ scale: 0.6, opacity: 0.4 }} animate={{ scale: [0.6, 1.1, 0.9], opacity: [0.4, 1, 0.8] }} transition={{ duration: 1.3 }} />
        )}
        {animate && shownRank && (
          <motion.span aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 h-44 w-44 -translate-x-1/2 -translate-y-1/2 rounded-full border-2" style={{ borderColor: tone }}
            initial={{ scale: 0.3, opacity: 1 }} animate={{ scale: 3, opacity: 0 }} transition={{ duration: 1.3, ease: "easeOut" }} />
        )}
      </div>
      <p className="font-display text-[30px] font-bold uppercase leading-none" style={{ color: tone, textShadow: `0 0 24px ${tone}88` }} data-field="rank-label">{shownRank ? td(after.label) : "…"}</p>
      <p className="mt-2 nx-readout text-[20px] text-white" data-field="rating">{tr("Rating")} {m.newRating} <span className="text-[14px] text-white/55">{tr("({cambio} en esta partida)", { cambio: m.delta > 0 ? `+${m.delta}` : m.delta })}</span></p>
      {posLine && <p className="mt-1 text-[11.5px] text-white/50" data-field="positions">{td(posLine)}</p>}
      {capNote}
    </section>
  );
}
