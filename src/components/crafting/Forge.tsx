"use client";

/**
 * F74 · NEXUS FORGE — piezas visuales del crafteo y las misiones. SOLO presentación: todo lo que se pinta lo decidió el
 * servidor (inventario, entregables, progreso, la carta que sale). Arte REAL: sobres (`PackArt`) y cartas (`CardImage`);
 * lo demás es interfaz (CSS, SVG propio). Con movimiento reducido: sin bucles, cambios de estado por fundido.
 */
import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { getPack } from "@/data/packs";
import type { PackCardClass } from "@/domain/packs/packClass";
import { GameGlyph } from "@/components/ui/game/GameGlyph";
import { cn } from "@/lib/format";
import { CardImage, PackArt, classLabel, packName } from "./CraftingUi";
import s from "./forge.module.css";

/** Color de interfaz por clase de carta (brillo del hueco y de la carta misteriosa). No es contenido: solo luz. */
export const CLASS_GLOW: Record<PackCardClass, string> = {
  base: "#c87f4a", plata: "#cfd6de", oro: "#ffce4f", masters: "#a970ff", champions: "#ff4d6d", prime: "#19e3ff", icon: "#fff1b8",
};
export const glowOf = (cls: string) => CLASS_GLOW[cls as PackCardClass] ?? "#ff2e63";
export const packGlow = (packId: string) => getPack(packId)?.accent ?? "#ff2e63";
type Glow = React.CSSProperties & { "--forge-glow"?: string };
export const glowStyle = (color: string): Glow => ({ "--forge-glow": color });

/** Escenario: luz ambiental + retícula + partículas (a sangre, detrás del contenido). */
export function ForgeStage({ children, className, testId }: { children: React.ReactNode; className?: string; testId?: string }) {
  return (
    <div className={cn(s.stage, className)} data-testid={testId}>
      <div aria-hidden className={s.particles}>
        {Array.from({ length: 14 }, (_, i) => <i key={i} style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i * 0.9) % 11}s` }} />)}
      </div>
      {children}
    </div>
  );
}

/** Cabecera mínima: miga + título grande. */
export function ForgeTitle({ eyebrow, title, children }: { eyebrow?: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <header className="space-y-3">
      {eyebrow}
      <h1 className="font-display text-[40px] font-extrabold uppercase leading-[0.9] tracking-[0.03em] text-white sm:text-[58px]">
        {title}
      </h1>
      {children}
    </header>
  );
}

/** Panel HUD (chaflán, superficie metálica, esquinas de acento). */
export function Panel({ children, className, tone, as: Tag = "div", ...rest }: { children: React.ReactNode; className?: string; tone?: "ready" | "done" | "muted"; as?: "div" | "li" | "section" | "article" } & React.HTMLAttributes<HTMLElement> & Record<`data-${string}`, string | undefined>) {
  return <Tag className={cn(s.panel, s.corners, tone === "ready" && s.ready, tone === "done" && s.done, tone === "muted" && s.muted, className)} {...rest}>{children}</Tag>;
}

/** Haz de energía entre la entrada y la salida. */
export function Beam({ on, vertical, color, className }: { on: boolean; vertical?: boolean; color?: string; className?: string }) {
  return <span aria-hidden className={cn(s.beam, vertical && s.beamV, on && s.beamOn, className)} style={color ? glowStyle(color) : undefined} />;
}

/** Núcleo hexagonal de la forja (se enciende cuando la receta está lista). */
export function ForgeCore({ on, color, size = 84, children }: { on: boolean; color?: string; size?: number; children?: React.ReactNode }) {
  return (
    <span aria-hidden className={cn(s.core, on && s.coreOn)} style={{ ...(color ? glowStyle(color) : {}), width: size, height: size }}>
      <svg viewBox="0 0 100 100">
        <polygon points="50,3 93,27 93,73 50,97 7,73 7,27" fill="rgba(10,11,19,0.9)" stroke="currentColor" strokeWidth="2" />
        <g className={s.spin}>
          <polygon points="50,16 80,33 80,67 50,84 20,67 20,33" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="6 5" opacity="0.8" />
        </g>
        <path d="M34 50h32M56 40l10 10-10 10" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {children}
    </span>
  );
}

/** Sobres de entrada en abanico (arte real), anclados abajo: nunca pisan la etiqueta. Como mucho 4; la cantidad va aparte. */
export function PackFan({ packId, count, width = 92, dim = false }: { packId: string; count: number; width?: number; dim?: boolean }) {
  const n = Math.max(1, Math.min(4, count));
  const spread = n === 1 ? [0] : n === 2 ? [-10, 10] : n === 3 ? [-16, 0, 16] : [-21, -7, 7, 21];
  const h = Math.round(width * 1.46);
  return (
    <span className="relative block" style={{ width: width * 1.7, height: h + Math.round(width * 0.18) }} aria-hidden>
      {spread.map((deg, i) => (
        <span key={i} className="absolute bottom-0 left-1/2" style={{ transform: `translateX(calc(-50% + ${deg * width * 0.022}px)) rotate(${deg}deg)`, transformOrigin: "50% 100%", zIndex: i }}>
          <PackArt packId={packId} width={width} dim={dim} />
        </span>
      ))}
    </span>
  );
}

/** «Tienes / Necesitas» como marcador: «7 / 4» grande y debajo qué es cada cifra (no solo color: texto y ✓). */
export function HaveNeed({ have, need, compact }: { have: number; need: number; compact?: boolean }) {
  const ok = have >= need;
  return (
    <div className="flex flex-col items-center" aria-label={`Tienes ${have} de ${need}`} data-testid="pack-recipe-counts">
      <p className={cn("nx-readout flex items-baseline gap-2 leading-none tabular-nums", compact ? "text-[30px]" : "text-[40px]")}>
        <span className={ok ? "text-[#3ee08f]" : "text-white"}>{have}</span>
        <span aria-hidden className="text-white/30">/</span>
        <span className="text-white/70">{need}</span>
        {ok && <span aria-hidden className="ml-1 text-[18px] text-[#3ee08f]">✓</span>}
      </p>
      <p className="mt-1 flex gap-5 text-[10px] font-bold uppercase tracking-[0.2em] text-white/50"><span>Tienes</span><span>Necesitas</span></p>
    </div>
  );
}

/** Barra de progreso segmentada + cifra grande. `role=progressbar` con valores (nunca solo color). */
export function ForgeBar({ value, max, label, big }: { value: number; max: number; label: string; big?: boolean }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className={cn(s.bar, pct >= 100 && s.barDone, "flex-1", big && "!h-[14px]")} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <b className={cn("nx-readout shrink-0 tabular-nums text-white", big ? "text-[22px]" : "text-[17px]")}>{value} / {max}</b>
    </div>
  );
}

/** Recompensa con su arte: sobre → sobre real; créditos/XP → glifo + cifra. */
export function RewardArt({ reward, claimed, size = "md" }: { reward: { credits?: number; xp?: number; packId?: string; packCount?: number }; claimed?: boolean; size?: "md" | "lg" }) {
  const big = size === "lg";
  const items: React.ReactNode[] = [];
  if (reward.packId && reward.packCount) items.push(
    <span key="p" className="flex items-center gap-2"><PackArt packId={reward.packId} width={big ? 58 : 44} dim={claimed} /><b className="font-display text-[15px] uppercase tracking-[0.06em]">+{reward.packCount} {packName(reward.packId)}</b></span>);
  if (reward.credits) items.push(
    <span key="c" className="flex items-center gap-1.5"><GameGlyph name="coin" className={cn(big ? "h-7 w-7" : "h-6 w-6", "text-drl-gold")} /><b className="nx-readout text-[20px] tabular-nums">+{reward.credits.toLocaleString("es-ES")}</b><span className="sr-only">créditos</span></span>);
  if (reward.xp) items.push(
    <span key="x" className="flex items-center gap-1.5"><GameGlyph name="xp" className={cn(big ? "h-7 w-7" : "h-6 w-6", "text-drl-cyan")} /><b className="nx-readout text-[20px] tabular-nums">+{reward.xp}</b><span className="text-[12px] font-bold text-white/60">XP</span></span>);
  if (!items.length) return null;
  return <span className={cn("flex flex-wrap items-center gap-x-4 gap-y-2", claimed ? "text-white/45" : "text-drl-gold")} data-testid="mission-reward">{items}</span>;
}

/** Hueco de carta (vacío o con la copia elegida). */
export function Slot({ cardId, color, onRemove, index }: { cardId?: string; color: string; onRemove?: () => void; index: number }) {
  return (
    <span className={cn(s.slot, cardId && s.slotFilled, "block w-full")} style={glowStyle(color)} data-slot={index} data-filled={cardId ? "1" : "0"}>
      {cardId ? (
        <>
          <CardImage cardId={cardId} width={120} className="!w-full" />
          <span aria-hidden className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-drl-cyan text-[11px] font-bold text-black">✓</span>
          {onRemove && <button type="button" onClick={onRemove} aria-label="Quitar esta copia" className="nx-focus absolute inset-0 rounded-[6px]" />}
        </>
      ) : <span aria-hidden className="absolute inset-0 grid place-items-center font-display text-[18px] text-white/15">+</span>}
    </span>
  );
}

/** Carta de salida ALEATORIA de una clase: nunca una carta concreta antes de que el servidor la decida. */
export function MysteryCard({ cls, width = 170, label = true }: { cls: string; width?: number; label?: boolean }) {
  return (
    <span className="flex flex-col items-center gap-2" data-testid="mystery-card" data-class={cls}>
      <span className={s.mystery} style={{ ...glowStyle(glowOf(cls)), width }} role="img" aria-label={`Carta ${classLabel(cls)} aleatoria`}>
        <span aria-hidden className="absolute inset-0 grid place-items-center">
          <svg viewBox="0 0 100 100" className="w-[62%] opacity-60">
            <polygon points="50,4 92,28 92,72 50,96 8,72 8,28" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ color: glowOf(cls) }} />
          </svg>
          <span className="absolute font-display text-[64px] font-extrabold leading-none" style={{ color: glowOf(cls), textShadow: `0 0 24px ${glowOf(cls)}` }}>?</span>
        </span>
        <span aria-hidden className="absolute inset-x-0 bottom-[8%] text-center font-display text-[13px] font-bold uppercase tracking-[0.22em] text-white/85">{classLabel(cls)}</span>
      </span>
      {label && <span className="font-display text-[13px] font-bold uppercase tracking-[0.16em]" style={{ color: glowOf(cls) }}>Carta {classLabel(cls)} aleatoria</span>}
    </span>
  );
}

/** Sello de estado (icono + texto: nunca solo color). */
const STAMP = {
  ACTIVE: { t: "En curso", i: "●", c: "border-drl-cyan/60 text-drl-cyan bg-drl-cyan/10" },
  COMPLETED: { t: "Reclamable", i: "★", c: "border-drl-gold/70 text-drl-gold bg-drl-gold/10" },
  DONE: { t: "Completada", i: "✓", c: "border-[#3ee08f]/60 text-[#3ee08f] bg-[#3ee08f]/10" },
  CLAIMED: { t: "Reclamada", i: "✓", c: "border-white/20 text-white/60 bg-white/5" },
  LOCKED: { t: "Bloqueada", i: "🔒", c: "border-white/15 text-white/45 bg-black/30" },
} as const;
export type StampKind = keyof typeof STAMP;
export function Stamp({ kind, className }: { kind: StampKind; className?: string }) {
  const k = STAMP[kind];
  return <span className={cn("inline-flex shrink-0 items-center gap-1.5 border px-2.5 py-1 font-display text-[11px] font-bold uppercase tracking-[0.16em]", k.c, className)} data-stamp={kind}><span aria-hidden>{k.i}</span>{k.t}</span>;
}

export const haloClass = (live: boolean) => cn(s.halo, live && s.haloLive);
export const ctaReadyClass = s.ctaReady;
export const pickClass = (picked: boolean) => cn(s.pick, picked && s.picked);
export const branchClass = s.branch;
export const branchArtClass = s.branchArt;
export const lane = { root: s.lane, in: s.laneIn, core: s.laneCore, out: s.laneOut, counts: s.laneCounts, cta: s.laneCta };

/* ═══════════════════ SECUENCIAS (representan un resultado YA confirmado por el servidor) ═══════════════════ */

/**
 * Forja de sobres: las entradas convergen al centro → destello → aparece el sobre resultante y escala → «CRAFT
 * COMPLETADO». ~1,8 s. Movimiento reducido: el resultado aparece por fundido, sin desplazamientos.
 */
export function PackForgeSequence({ inputPackId, inputQty, outputPackId }: { inputPackId: string; inputQty: number; outputPackId: string }) {
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<"merge" | "flash" | "done">(reduced ? "done" : "merge");
  useEffect(() => {
    if (reduced) return;
    const a = setTimeout(() => setPhase("flash"), 700);
    const b = setTimeout(() => setPhase("done"), 1050);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [reduced]);
  const color = packGlow(outputPackId);
  const n = Math.min(4, inputQty);
  return (
    <div role="status" data-testid="craft-result" className="relative flex flex-col items-center gap-4 py-2 text-center" style={glowStyle(color)}>
      <div className="relative grid h-[230px] w-full place-items-center">
        <AnimatePresence>
          {phase === "merge" && Array.from({ length: n }, (_, i) => {
            const x = (i - (n - 1) / 2) * 70;
            return (
              <motion.span key={i} className="absolute" initial={{ x, opacity: 1, scale: 1 }} animate={{ x: 0, opacity: 0.2, scale: 0.6 }} exit={{ opacity: 0 }} transition={{ duration: 0.7, ease: "easeIn" }}>
                <PackArt packId={inputPackId} width={78} />
              </motion.span>
            );
          })}
        </AnimatePresence>
        {phase === "flash" && <motion.span className={s.flash} initial={{ opacity: 0, scale: 0.3 }} animate={{ opacity: [0, 1, 0.85], scale: 1.1 }} transition={{ duration: 0.35 }} aria-hidden />}
        {phase === "done" && (
          <motion.span className={haloClass(true)} initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.7 }} animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1 }} transition={{ duration: reduced ? 0.2 : 0.45, ease: [0.2, 1.4, 0.4, 1] }}>
            <PackArt packId={outputPackId} width={150} />
          </motion.span>
        )}
      </div>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: phase === "done" ? 1 : 0 }} transition={{ duration: 0.3 }}>
        <p className="font-display text-[26px] font-extrabold uppercase tracking-[0.14em] text-[#3ee08f]">Craft completado</p>
        <p className="font-display text-[17px] font-bold uppercase tracking-[0.12em] text-white">+1 {packName(outputPackId)}</p>
        <p className="mt-1 text-[12px] text-white/50">Guardado en tus sobres sin abrir</p>
      </motion.div>
    </div>
  );
}

/**
 * Revelación de carta: carta misteriosa (la clase) → giro → la carta REAL que devolvió el servidor → «CARTA
 * CONSEGUIDA». Movimiento reducido: fundido de una a otra.
 */
export function CardRevealSequence({ cls, cardId, caption, sub }: { cls: string; cardId: string; caption: string; sub?: string }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced);
  useEffect(() => { if (reduced) return; const t = setTimeout(() => setShown(true), 850); return () => clearTimeout(t); }, [reduced]);
  const color = glowOf(cls);
  return (
    <div role="status" data-testid="craft-result" className="flex flex-col items-center gap-4 py-2 text-center" style={glowStyle(color)}>
      <div className="relative grid h-[300px] w-[214px] place-items-center [perspective:1000px]">
        <AnimatePresence mode="wait">
          {!shown ? (
            <motion.span key="back" initial={{ rotateY: 0, opacity: 1 }} exit={reduced ? { opacity: 0 } : { rotateY: 90, opacity: 1 }} transition={{ duration: 0.35, ease: "easeIn" }}>
              <MysteryCard cls={cls} width={190} label={false} />
            </motion.span>
          ) : (
            <motion.span key="front" className={haloClass(true)} initial={reduced ? { opacity: 0 } : { rotateY: -90, scale: 0.95 }} animate={reduced ? { opacity: 1 } : { rotateY: 0, scale: 1 }} transition={{ duration: reduced ? 0.2 : 0.4, ease: "easeOut" }}>
              <CardImage cardId={cardId} width={200} />
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: shown ? 1 : 0 }} transition={{ duration: 0.3 }}>
        <p className="font-display text-[26px] font-extrabold uppercase tracking-[0.14em] text-[#3ee08f]">Carta conseguida</p>
        <p className="font-display text-[16px] font-bold uppercase tracking-[0.12em] text-white">{caption}</p>
        {sub && <p className="mt-1 text-[12px] text-white/55">{sub}</p>}
      </motion.div>
    </div>
  );
}
