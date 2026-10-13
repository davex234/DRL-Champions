"use client";

/**
 * FASE 44 · XP QUE SUBE — la barra anima del valor ANTERIOR REAL al NUEVO REAL (`xpTimeline`), tramo a tramo si se
 * cruzan niveles. Si hubo subida de nivel REAL, SUBIDA DE NIVEL (nivel 3) con el nivel final. Las cifras en texto son
 * siempre las reales finales (nunca un contador intermedio). Movimiento reducido: la barra aparece ya en su valor.
 */
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { xpAnimationMs, xpTimeline } from "@/lib/gameExperience/xp";
import { cn } from "@/lib/format";
import { playSound } from "@/lib/sound";

export function XpProgress({ xp, gained, className, label = "Nivel de cuenta" }: { xp: number; gained: number; className?: string; label?: string }) {
  const reduced = !!useReducedMotion();
  const t = xpTimeline(xp, gained);
  const total = xpAnimationMs(t, reduced);
  const [seg, setSeg] = useState(reduced ? t.segments.length - 1 : 0);
  const [done, setDone] = useState(reduced || t.gained === 0);

  const segCount = t.segments.length;
  useEffect(() => {
    if (reduced || t.gained === 0) { setSeg(segCount - 1); setDone(true); return; }
    const per = total / segCount;
    const timers = Array.from({ length: segCount }, (_, i) => window.setTimeout(() => { setSeg(i); if (i === segCount - 1) window.setTimeout(() => setDone(true), per); }, i * per));
    return () => timers.forEach((x) => window.clearTimeout(x));
  }, [reduced, total, t.gained, segCount]);

  useEffect(() => { if (done && t.levelUp) playSound("level.up"); }, [done, t.levelUp]);

  const cur = t.segments[Math.min(seg, t.segments.length - 1)];
  const shownLevel = done ? t.after.level : cur.level;
  const pct = Math.round(t.after.progress * 100);
  return (
    <section aria-label={label} data-testid="xp-progress" data-level-up={t.levelUp ? "true" : "false"} data-motion-level={t.levelUp ? 3 : 2} className={cn("nx-clip-sm relative overflow-hidden border border-white/10 bg-white/[0.03] px-4 py-3.5", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="nx-label">{label} <b className="nx-readout ml-1 text-[22px] text-white" data-testid="xp-level">{shownLevel}</b></span>
        <span className="nx-label tabular-nums">
          <b className="nx-readout text-[14px] text-white/85">{t.after.xpIntoLevel}</b> / {t.after.xpForNext} XP
          {t.gained > 0 && <span className="ml-2 text-drl-cyan" data-testid="xp-gained">+{t.gained} XP</span>}
        </span>
      </div>
      <div
        className="mt-2 h-2.5 w-full overflow-hidden bg-white/[0.08]"
        role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
        aria-label={`Nivel ${t.after.level}, ${pct}% hacia el siguiente${t.levelUp ? `; has subido ${t.levelsGained === 1 ? "un nivel" : `${t.levelsGained} niveles`}` : ""}`}
      >
        <motion.div
          key={seg}
          className="h-full origin-left bg-gradient-to-r from-drl-cyan to-[#8ff3ff]"
          initial={{ scaleX: reduced ? cur.to : cur.from }}
          animate={{ scaleX: cur.to }}
          transition={{ duration: reduced || t.gained === 0 ? 0 : total / t.segments.length / 1000, ease: [0.16, 1, 0.3, 1] }}
          style={{ transformOrigin: "left" }}
        />
      </div>
      {t.levelUp && done && (
        <motion.p
          role="status"
          data-testid="level-up"
          className="mt-3 flex items-center gap-3 font-display text-[22px] font-bold uppercase leading-none tracking-[0.12em] text-drl-cyan"
          initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 1.25 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={reduced ? { duration: 0.12 } : { duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          style={{ textShadow: "0 0 24px rgba(25,227,255,0.6)" }}
        >
          Subida de nivel
          <span className="nx-readout text-[15px] tracking-normal text-white">Nivel {t.before.level} → {t.after.level}</span>
        </motion.p>
      )}
    </section>
  );
}
