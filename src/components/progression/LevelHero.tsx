"use client";

/**
 * HERO DE NIVEL (Fase 27). El nivel de CUENTA con su barra: siempre `levelFromXp` sobre la XP
 * que devolvió el servidor. No hay recompensa por nivel de cuenta en el sistema, así que no se
 * enseña ninguna «próxima recompensa»: la que existe de verdad es la del pase, y esa vive en su
 * carril. `lastLevelUp` solo se pinta cuando la sesión lo ha visto de verdad (dos lecturas).
 */
import { Meter } from "@/components/ui/Meter";
import { Plate } from "@/components/ui/Surface";
import { Badge } from "@/components/ui/Badge";
import { formatCredits } from "@/lib/format";
import type { MetaLevel } from "@/domain/progression/meta";

export function LevelHero({ level, lastLevelUp = null, className }: { level: MetaLevel; lastLevelUp?: number | null; className?: string }) {
  const pct = Math.round(level.progress * 100);
  return (
    <Plate className={`relative overflow-hidden p-5 sm:p-6 ${className ?? ""}`} data-level={level.level}>
      <span aria-hidden className="nx-bloom pointer-events-none" style={{ left: -30, top: -30, width: 180, height: 180, background: "#19e3ff", opacity: 0.25 }} />
      <div className="relative flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-8">
        <div
          className="relative grid h-28 w-28 shrink-0 place-items-center rounded-full"
          style={{ background: "radial-gradient(circle at 50% 35%, rgba(25,227,255,0.22), transparent 70%)", boxShadow: "inset 0 0 0 2px rgba(25,227,255,0.45), 0 0 40px -10px rgba(25,227,255,0.6)" }}
          role="img"
          aria-label={`Nivel ${level.level}`}
        >
          <span className="absolute top-4 font-display text-label uppercase tracking-wide2 text-ink-faint">Nivel</span>
          <span className="nx-readout mt-3 text-[46px] leading-none text-white">{level.level}</span>
        </div>

        <div className="w-full min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
            <span className="font-display text-label uppercase tracking-wide2 text-ink-faint">XP de cuenta</span>
            <span className="nx-readout text-caption text-ink-secondary" data-xp={level.xp}>
              {formatCredits(level.xpIntoLevel)} / {formatCredits(level.xpForNext)} XP
            </span>
          </div>
          <Meter value={pct} tone="info" height={12} striped label={`Progreso al nivel ${level.level + 1}: ${pct}%`} />
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            <p className="text-caption text-ink-muted">
              <b className="nx-readout text-white">+{formatCredits(level.toNext)} XP</b> para el nivel {level.level + 1}
              <span className="ml-2 text-ink-faint">· {formatCredits(level.nextTotal)} XP totales</span>
            </p>
            {lastLevelUp !== null && (
              <Badge tone="info" dot>Has subido al nivel {lastLevelUp}</Badge>
            )}
          </div>
        </div>
      </div>
    </Plate>
  );
}
