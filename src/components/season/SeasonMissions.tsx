"use client";

/**
 * FASE 52 · MISIONES Y SIGUIENTE OBJETIVO del Season Command Center.
 *
 * Las misiones son las de la tanda REAL del pase (`objectives.all` de la foto del servidor), agrupadas por
 * su tipo real (diarias, semanales, de temporada, hitos) con `missionGroups`: sin Marketplace, ninguna de
 * mercado. Cada una dice qué pide, cuánto llevas, qué da (créditos con la moneda DRL, sobre con su arte,
 * XP de pase) y en qué estado está. Las diarias y semanales dicen cuándo se renuevan SOLO porque el
 * servidor fija `expiresAt`; se cuenta desde `serverNow` de la foto, nunca desde el reloj del dispositivo.
 *
 * Reclamar sigue en `/logros`: una misión COMPLETADA enlaza allí.
 */
import Link from "next/link";
import { cn } from "@/lib/format";
import { packArtwork } from "@/data/packArtwork";
import { getPack } from "@/data/packs";
import { DrlCoin } from "@/components/credits/CreditsPieces";
import { countdown, formatCountdown } from "@/domain/season/time";
import { missionGroups, nextSteps, type MissionView, type NextStep } from "@/domain/season/hubView";
import type { SeasonPersonal } from "@/server/services/season";
import { RewardVisual, rewardLabel } from "./SeasonRewards";
import { GameGlyph } from "@/components/ui/game/GameGlyph";

/** Como DRL Credits (`formatAmount`): agrupación SIEMPRE («1.500», no «1500»). */
const fmt = (n: number) => new Intl.NumberFormat("es-ES", { useGrouping: "always" }).format(n);

const STATE: Record<MissionView["state"], { label: string; cls: string }> = {
  ACTIVE: { label: "En curso", cls: "text-[#2fe0ff] shadow-[inset_0_0_0_1px_rgba(47,224,255,0.45)]" },
  COMPLETE: { label: "Completada", cls: "bg-[#ffd35c] text-[#1a1204]" },
  CLAIMED: { label: "✓ Reclamada", cls: "text-[#3fd696] shadow-[inset_0_0_0_1px_rgba(63,214,150,0.45)]" },
};

export function SeasonMissions({ objectives, serverNow }: { objectives: NonNullable<SeasonPersonal["objectives"]>; serverNow: number }) {
  const groups = missionGroups(objectives.all ?? objectives.list);
  return (
    <section aria-labelledby="missions-title" data-testid="season-missions" className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="nx-label !text-[#ff5aa8]">Misiones de temporada</p>
          <h2 id="missions-title" className="mt-1 font-display text-[clamp(22px,2.6vw,32px)] font-extrabold uppercase leading-none text-white">Tus misiones</h2>
          <p className="mt-1.5 text-[13px] text-white/60">Cada misión da XP de pase al reclamarla: es lo que sube tu nivel de temporada.</p>
        </div>
        {objectives.claimable > 0 && (
          <Link href="/logros" className="nx-focus inline-flex min-h-[44px] items-center bg-[#ffd35c] px-4 font-display text-[12px] font-extrabold uppercase tracking-[0.14em] text-[#1a1204] hover:brightness-110" data-testid="missions-claim">
            Reclamar {objectives.claimable} en Logros →
          </Link>
        )}
      </header>

      {(objectives.rotationPending || objectives.unassigned) && (
        <p role="status" className="border-l-2 border-l-[#2fe0ff] bg-white/[0.03] px-3 py-2 text-[13px] text-white/75" data-testid="missions-rotation">
          {objectives.unassigned ? "Aún no tienes misiones asignadas." : "Hay una tanda nueva de misiones."} Se asignan al abrir{" "}
          <Link href="/logros" className="text-[#2fe0ff] underline">Logros y pase</Link>.
        </p>
      )}

      {groups.length === 0 ? (
        <p className="border border-white/10 bg-white/[0.03] px-4 py-6 text-center text-[14px] text-white/60" data-testid="missions-empty">No hay misiones activas en este momento.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {groups.map((g) => (
            <div key={g.kind} className="nx-clip-sm border border-white/10 bg-[linear-gradient(180deg,rgba(12,16,28,0.95),rgba(6,8,14,0.95))] p-3 sm:p-4" data-mission-kind={g.kind}>
              <div className="mb-2.5 flex items-baseline justify-between gap-2">
                <h3 className="font-display text-[14px] font-extrabold uppercase tracking-[0.16em] text-white">{g.label}</h3>
                <span className="nx-label !text-white/50">{g.missions.filter((m) => m.state !== "ACTIVE").length}/{g.missions.length} hechas</span>
              </div>
              <ul className="space-y-2">
                {g.missions.map((m) => <li key={`${m.id}@${m.assignedAt}`}><MissionCard m={m} serverNow={serverNow} /></li>)}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function MissionCard({ m, serverNow }: { m: MissionView; serverNow: number }) {
  const s = STATE[m.state];
  const renueva = m.expiresAt && m.state !== "CLAIMED" && m.expiresAt > serverNow ? formatCountdown(countdown(m.expiresAt, serverNow)).primary.toLowerCase() : null;
  const pack = m.packId ? packArtwork(m.packId) : null;
  return (
    <article
      className={cn(
        "relative flex gap-3 px-3 py-2.5 transition-[background-color,box-shadow] duration-300",
        m.state === "COMPLETE" ? "bg-[rgba(255,211,92,0.08)] shadow-[inset_0_0_0_1px_rgba(255,211,92,0.7),0_0_20px_-8px_rgba(255,211,92,0.9)]"
          : m.state === "CLAIMED" ? "bg-white/[0.02] opacity-70 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
            : "bg-white/[0.035] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]",
      )}
      data-mission={m.id}
      data-state={m.state}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <b className="min-w-0 font-display text-[14px] font-bold uppercase leading-tight tracking-[0.04em] text-white">{m.label}</b>
          <span className={cn("px-1.5 py-0.5 font-display text-[9.5px] font-bold uppercase tracking-[0.14em]", s.cls)}>{s.label}</span>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <div
            className="h-2 flex-1 overflow-hidden rounded-full bg-black/60"
            role="progressbar"
            aria-label={`Progreso de «${m.label}»`}
            aria-valuemin={0}
            aria-valuemax={m.goal}
            aria-valuenow={Math.min(m.current, m.goal)}
            aria-valuetext={m.state === "ACTIVE" ? `${fmt(Math.min(m.current, m.goal))} de ${fmt(m.goal)}` : s.label}
          >
            <span
              className={cn("block h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none", m.state === "ACTIVE" ? "bg-[linear-gradient(90deg,#1aa6e6,#2fe0ff)]" : m.state === "COMPLETE" ? "bg-[#ffd35c]" : "bg-[#3fd696]")}
              style={{ width: `${m.ratio * 100}%` }}
            />
          </div>
          <span className="shrink-0 font-display text-[12px] font-bold tabular-nums text-white/80">{fmt(Math.min(m.current, m.goal))} / {fmt(m.goal)}</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
          {m.rewardCredits > 0 && <span className="inline-flex items-center gap-1 font-display font-bold text-[#ffd35c]"><DrlCoin size={14} />{fmt(m.rewardCredits)}</span>}
          {m.packId && (
            <span className="inline-flex items-center gap-1 text-white/80">
              {pack && <img src={pack} alt="" width={14} height={20} loading="lazy" decoding="async" className="h-5 w-auto" />}
              {m.packCount > 1 ? `${m.packCount}× ` : ""}{getPack(m.packId)?.name ?? m.packId}
            </span>
          )}
          {m.xp > 0 && <span className="font-display font-bold text-[#2fe0ff]">+{fmt(m.xp)} XP de pase</span>}
          {renueva && <span className="ml-auto text-white/45" data-testid="mission-renews">Renueva en {renueva}</span>}
        </div>
        {m.state === "COMPLETE" && (
          <Link href="/logros" className="nx-focus mt-2 inline-flex min-h-[36px] items-center font-display text-[11px] font-bold uppercase tracking-[0.14em] text-[#ffd35c] underline-offset-4 hover:underline">
            Reclamar en Logros →
          </Link>
        )}
      </div>
    </article>
  );
}

/** «¿Qué hago ahora?», con cifras exactas de la foto: reclamar, la misión más cercana y el siguiente nivel. */
export function SeasonNextSteps({ personal }: { personal: SeasonPersonal }) {
  const pass = personal.pass;
  const steps = nextSteps({
    pass,
    objectives: personal.objectives?.all ?? personal.objectives?.list ?? [],
    claimableLevels: (pass?.claimable.free ?? 0) + (pass?.claimable.competitive ?? 0),
    claimableMissions: personal.objectives?.claimable ?? 0,
  });
  if (steps.length === 0) return null;
  return (
    <section aria-labelledby="next-title" data-testid="season-next" className="grid gap-3 md:grid-cols-3">
      <h2 id="next-title" className="sr-only">Siguiente objetivo</h2>
      {steps.map((st) => <StepCard key={st.kind} st={st} />)}
    </section>
  );
}

function StepCard({ st }: { st: NextStep }) {
  const base = "nx-clip-sm relative flex min-h-[104px] items-center gap-3 overflow-hidden border px-4 py-3";
  if (st.kind === "claim") {
    return (
      <Link href={st.href} className={cn(base, "nx-focus border-[rgba(255,211,92,0.6)] bg-[rgba(255,211,92,0.08)] hover:bg-[rgba(255,211,92,0.14)]")} data-step="claim">
        <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#ffd35c] text-[20px] text-[#1a1204]"><GameGlyph name="star" className="h-5 w-5" strokeWidth={2.2} /></span>
        <span className="min-w-0">
          <span className="nx-label !text-[#ffd35c]">Ahora</span>
          <b className="block font-display text-[16px] font-extrabold uppercase leading-tight text-white">{st.count} {st.count === 1 ? "recompensa" : "recompensas"} por reclamar</b>
          <span className="text-[12.5px] text-white/65">En Logros y pase →</span>
        </span>
      </Link>
    );
  }
  if (st.kind === "mission") {
    return (
      <div className={cn(base, "border-[rgba(47,224,255,0.35)] bg-[rgba(47,224,255,0.05)]")} data-step="mission">
        <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[rgba(47,224,255,0.15)] font-display text-[15px] font-extrabold text-[#2fe0ff]">{st.remaining}</span>
        <span className="min-w-0">
          <span className="nx-label !text-[#2fe0ff]">Misión más cercana</span>
          <b className="block font-display text-[15px] font-extrabold uppercase leading-tight text-white">Te {st.remaining === 1 ? "falta" : "faltan"} {fmt(st.remaining)} para «{st.label}»</b>
          <span className="text-[12.5px] text-white/65">{fmt(st.current)} / {fmt(st.goal)}{st.xp > 0 ? ` · +${fmt(st.xp)} XP de pase` : ""}{st.rewardCredits > 0 ? ` · ${fmt(st.rewardCredits)} créditos` : ""}</span>
        </span>
      </div>
    );
  }
  return (
    <div className={cn(base, "border-white/15 bg-white/[0.03]")} data-step="level">
      <span className="shrink-0"><RewardVisual reward={st.reward} size={52} /></span>
      <span className="min-w-0">
        <span className="nx-label">Siguiente nivel · {st.nextLevel}</span>
        <b className="block font-display text-[15px] font-extrabold uppercase leading-tight text-white">Te faltan {fmt(st.xpRemaining)} XP de pase</b>
        <span className="text-[12.5px] text-white/65">{st.reward ? rewardLabel(st.reward) : "Sin recompensa en el carril libre"}</span>
      </span>
    </div>
  );
}
