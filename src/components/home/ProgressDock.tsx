"use client";

/**
 * FASE 62 · EL PROGRESO EN LA PORTADA, sin convertirla en un panel.
 *
 * Una tira bajo el menú principal que contesta «¿qué hago ahora?» con la MISMA foto del vestíbulo (`GET /api/game/
 * daily-loop`, ya cargada: cero peticiones nuevas): lo que hay por recoger, el objetivo más cercano con su acceso y el
 * nivel de TEMPORADA con su siguiente recompensa. Solo con sesión y solo con datos del servidor; sin datos, no aparece.
 */
import Link from "next/link";
import { Meter } from "@/components/ui/Meter";
import { metricCta } from "@/domain/progression/hub";
import { XP_NAMES } from "@/domain/rewards/display";
import type { DailyLoopSnapshot } from "@/domain/dailyLoop";

export function ProgressDock({ snap }: { snap: DailyLoopSnapshot }) {
  const obj = snap.objectives;
  const pass = snap.season?.pass ?? null;
  if (!snap.signedIn || (!obj && !pass)) return null;
  const near = obj?.near ?? null;
  const cta = near ? metricCta(near.metric) : null;
  return (
    <section aria-label="Tu progreso" data-testid="home-progress" className="nx-f62-panel mt-[clamp(10px,2vh,22px)] w-full max-w-[560px] p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="nx-label !text-[10px] text-white/60">Tu progreso</span>
        <Link href="/cuenta?seccion=progresion" className="nx-action text-[11px]" data-testid="home-progress-link">Ver progreso →</Link>
      </div>

      {obj && obj.claimable > 0 ? (
        <Link href="/cuenta?seccion=progresion" className="mt-2 flex items-center justify-between gap-3 rounded-lg bg-[#ffd35c]/10 px-3 py-2 ring-1 ring-[#ffd35c]/45" data-testid="home-claimable">
          <span className="font-display text-[13px] font-extrabold uppercase tracking-[0.06em] text-drl-gold">
            {obj.claimable} {obj.claimable === 1 ? "recompensa por reclamar" : "recompensas por reclamar"}
          </span>
          <span className="nx-f62-cta is-gold !min-h-[34px] !px-3">Reclamar</span>
        </Link>
      ) : near ? (
        <div className="mt-2 flex items-center gap-3" data-testid="home-near">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] text-white">{near.label} <span className="nx-readout text-white/60">{near.current} / {near.goal}</span></p>
            <Meter className="mt-1" value={(near.current / Math.max(1, near.goal)) * 100} tone="info" height={5} label={`${near.label}: ${near.current} de ${near.goal}`} />
          </div>
          {cta && <Link href={cta.href} className="nx-f62-cta !min-h-[34px] !px-3 shrink-0">{cta.label}</Link>}
        </div>
      ) : null}

      {pass && (
        <div className="mt-2.5 flex items-center gap-3" data-testid="home-season">
          <span className="font-display text-[11px] font-bold uppercase tracking-[0.1em] text-[#ffe08a] shrink-0">Temporada · nivel {pass.level}/{pass.maxLevel}</span>
          <Meter className="flex-1" value={pass.progress * 100} tone="gold" height={5} label={`Temporada nivel ${pass.level}: ${Math.round(pass.progress * 100)}% (${XP_NAMES.season})`} />
          {pass.nextReward && <span className="hidden truncate text-[11px] text-white/55 sm:inline">Nivel {pass.nextReward.level}: {pass.nextReward.label}</span>}
        </div>
      )}
    </section>
  );
}
