"use client";

/**
 * F87 · LA PANTALLA DE UN PICK'EM 2.0: cabecera (evento, fase, estado, próximo cierre con su HORA EXACTA, progreso,
 * puntos, recompensas) → el cuadro → clasificación → reglas. Sin sesión: el cuadro real y la clasificación pública;
 * los picks piden cuenta. Todo lo que muestra sale de `useBracket` (servidor) y del dominio puro.
 */
import Link from "next/link";
import { useMemo, useState } from "react";
import { useAuth } from "@/lib/supabase/auth";
import { useBracket, PickemError, type PickNotice } from "@/lib/pickems/bracketClient";
import { pendingPicks, scoreEntry, PHASE_LABEL, type PredictionContext } from "@/domain/pickems/prediction";
import { TIER_LABEL } from "@/domain/pickems/bracketRewards";
import { eligibilityMessage, policyOf, requirementText, type Eligibility } from "@/domain/pickems/eligibility";
import { Countdown } from "@/components/pickems/Countdown";
import { Badge } from "@/components/ui/Badge";
import { Plate } from "@/components/ui/Surface";
import { NxButton } from "@/components/ui/NxButton";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { Loading, ErrorState, EmptyState } from "@/components/ui/States";
import { cn } from "@/lib/format";
import { PredictBoard } from "./PredictBoard";
import type { BracketView } from "@/server/services/pickemBrackets";

const fmtExact = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
const pct = (x: number) => `${Math.round(x * 100)} %`;

export function PredictScreen({ slug, forceMode }: { slug: string; forceMode?: "desktop" | "mobile" }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const b = useBracket(slug, userId);
  const [claimMsg, setClaimMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [claiming, setClaiming] = useState(false);

  const lockedSet = useMemo(() => new Set((b.view?.nodes ?? []).filter((n) => n.locked).map((n) => n.matchId)), [b.view]);
  const live = useMemo(() => (b.ctx ? scoreEntry(b.ctx, b.picks, (id) => lockedSet.has(id)) : null), [b.ctx, b.picks, lockedSet]);
  const pending = useMemo(() => (b.ctx ? pendingPicks(b.ctx, b.picks, (id) => !lockedSet.has(id)).length : 0), [b.ctx, b.picks, lockedSet]);

  if (b.loading && !b.view) return <Loading label="Cargando el cuadro…" />;
  // FULL GAME AUDIT · un Pick'em inexistente o sin publicar es «no encontrado», no «Algo ha fallado».
  if (b.error && !b.view && b.error.status === 404) return <EmptyState title="Pick'em no disponible" hint="Este Pick'em no existe o aún no está publicado." action={{ href: "/pickems", label: "Ver Pick'ems" }} />;
  if (b.error && !b.view) return <ErrorState message={b.error.message} onRetry={() => void b.reload()} />;
  const claim = async () => {
    setClaiming(true);
    try {
      const r = await b.claim();
      setClaimMsg({ ok: true, text: r.applied ? `Recompensa reclamada: ${r.items.join(" + ")}` : "Ya la habías reclamado." });
    } catch (e) {
      setClaimMsg({ ok: false, text: e instanceof PickemError ? e.message : "No se pudo reclamar" });
    } finally { setClaiming(false); }
  };
  return (
    <PredictView v={b.view!} ctx={b.ctx!} picks={b.picks} notice={b.notice} inFlight={b.inFlight} signedIn={!!userId} live={live} pending={pending}
      onPick={b.pick} onExpire={() => void b.reload()} onClaim={claim} claiming={claiming} claimMsg={claimMsg} forceMode={forceMode} />
  );
}

/** Presentación pura de un Pick'em (la usan la pantalla real y el arnés de QA). */
export function PredictView({ v, ctx, picks, notice, inFlight, signedIn, live, pending, onPick, onExpire, onClaim, claiming, claimMsg, forceMode }: {
  v: BracketView; ctx: PredictionContext; picks: Record<string, string>; notice: PickNotice | null; inFlight: string | null; signedIn: boolean;
  live: ReturnType<typeof scoreEntry> | null; pending: number; onPick?: (matchId: string, teamId: string | null) => void; onExpire?: () => void;
  onClaim: () => void; claiming: boolean; claimMsg: { ok: boolean; text: string } | null; forceMode?: "desktop" | "mobile";
}) {
  const open = v.phase === "OPEN" || v.phase === "UPCOMING";
  const scorable = live?.scorable ?? v.nodes.length;
  const incomplete = signedIn && open && pending > 0;
  const b = { notice, inFlight, picks, ctx, pick: onPick, reload: () => onExpire?.() };

  return (
    <div className="space-y-6">
      {/* ── Cabecera ── */}
      <Plate className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="nx-label">{v.eventName ?? "Evento"} · {v.formatLabel}</p>
            <h1 className="font-display text-2xl font-bold uppercase tracking-[0.04em] text-white sm:text-3xl">{v.title}</h1>
          </div>
          <Badge tone={v.phase === "OPEN" ? "key" : v.phase === "SETTLED" ? "ok" : v.phase === "CANCELLED" ? "bad" : "muted"} dot={v.phase === "OPEN"} pulse={v.phase === "OPEN"}>{PHASE_LABEL[v.phase]}</Badge>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Próximo cierre" value={v.nextLockAt ? <Countdown to={v.nextLockAt} prefix="" onExpire={() => b.reload()} className="font-display text-lg font-bold text-white" /> : "—"} hint={v.nextLockAt ? fmtExact(v.nextLockAt) : open ? "" : "Sin cierres pendientes"} />
          <Stat label="Tus predicciones" value={signedIn ? `${live?.picked ?? 0} / ${scorable}` : "—"} hint={signedIn ? (pending > 0 ? `${pending} por hacer ahora` : "Al día") : "Inicia sesión"} />
          <Stat label="Puntos" value={signedIn ? `${live?.points ?? 0} / ${live?.maxPoints ?? v.maxPoints}` : `máx. ${v.maxPoints}`} hint={signedIn && live ? `${live.correct} ✓ · ${live.wrong} ✕ · ${live.pending} pendientes` : "Más puntos en rondas tardías"} />
          <Stat label="Posición" value={v.me?.position ? `#${v.me.position}` : "—"} hint={`${v.leaderboard.participants} participante${v.leaderboard.participants === 1 ? "" : "s"}${v.leaderboard.provisional ? " · provisional" : ""}`} />
        </div>

        {signedIn && live && (
          <div aria-label={`Progreso: ${live.picked} de ${scorable} predicciones`} className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
            <div className="h-full bg-drl-cyan transition-[width] duration-300 motion-reduce:transition-none" style={{ width: pct(scorable ? live.picked / scorable : 0) }} />
          </div>
        )}

        {incomplete && (
          <p role="status" className="nx-clip-sm px-3 py-2 text-sm text-warn" style={{ background: "rgba(255,180,60,0.08)", boxShadow: "inset 0 0 0 1px rgba(255,180,60,0.3)" }}>
            <b className="font-display uppercase tracking-wide">Pick&apos;em incompleto</b> · te faltan {pending} predicción{pending === 1 ? "" : "es"} que ya puedes hacer. Cada partido se cierra a su hora de inicio; sin pick no puntúa{v.rewards ? ` y por debajo del ${pct(v.rewards.minCompletion)} no hay recompensa ni «perfecto»` : ""}.
          </p>
        )}
        {!signedIn && (
          <p className="text-sm text-ink-secondary">Puedes ver el cuadro real. Para predecir: <Link className="text-drl-cyan underline" href="/cuenta">inicia sesión</Link>.</p>
        )}
        {b.notice?.status === "error" && <p role="alert" className="text-sm text-bad">{b.notice.message}</p>}
      </Plate>

      {/* ── Recompensas: exactamente lo que entrega el servidor ── */}
      <RewardsPanel v={v} onClaim={onClaim} claiming={claiming} claimMsg={claimMsg} />

      {/* ── El cuadro ── */}
      <section aria-label="Cuadro de predicción">
        <SectionTitle>{v.descriptor.kind === "GSL_GROUPS" || v.descriptor.kind === "ROUND_ROBIN" ? "Grupos" : "Cuadro"}</SectionTitle>
        <PredictBoard view={v} ctx={b.ctx} picks={b.picks} notice={b.notice} inFlight={b.inFlight} signedIn={signedIn} onPick={open ? b.pick : undefined} forceMode={forceMode} />
      </section>

      {/* ── Clasificación ── */}
      <section aria-label="Clasificación">
        <SectionTitle>Clasificación{v.leaderboard.provisional ? " provisional" : ""}</SectionTitle>
        {v.leaderboard.rows.length === 0 ? (
          <p className="text-sm text-ink-secondary">Aún nadie ha predicho este cuadro.</p>
        ) : (
          <ol className="divide-y divide-white/[0.06] overflow-hidden rounded-md bg-white/[0.02]">
            {v.leaderboard.rows.map((r) => (
              <li key={`${r.position}-${r.username}-${r.tag}`} className={cn("flex items-center gap-3 px-3 py-2", r.me && "bg-drl-cyan/[0.07]")}>
                <span className="nx-readout w-8 text-right text-ink-muted">#{r.position}</span>
                <span className="min-w-0 flex-1 truncate font-display text-sm font-bold uppercase text-white">{r.username} <span className="text-ink-faint">{r.tag}</span>{r.me && <span className="sr-only"> (tú)</span>}</span>
                <span className="nx-label">{r.correct} ✓</span>
                <span className="nx-readout w-12 text-right text-white">{r.points}</span>
              </li>
            ))}
            {v.leaderboard.me && !v.leaderboard.rows.some((r) => r.me) && (
              <li className="flex items-center gap-3 bg-drl-cyan/[0.07] px-3 py-2">
                <span className="nx-readout w-8 text-right text-ink-muted">#{v.leaderboard.me.position}</span>
                <span className="min-w-0 flex-1 truncate font-display text-sm font-bold uppercase text-white">{v.leaderboard.me.username} <span className="text-ink-faint">{v.leaderboard.me.tag}</span></span>
                <span className="nx-label">{v.leaderboard.me.correct} ✓</span>
                <span className="nx-readout w-12 text-right text-white">{v.leaderboard.me.points}</span>
              </li>
            )}
          </ol>
        )}
      </section>

      {/* ── Reglas ── */}
      <section aria-label="Reglas" className="space-y-2 text-sm text-ink-secondary">
        <SectionTitle>Reglas</SectionTitle>
        <ul className="list-disc space-y-1 pl-5">
          <li>Eliges el ganador de cada partido directamente en el cuadro. Tu elección avanza sola al siguiente cruce de TU cuadro (y, en doble eliminación, el perdedor cae al cuadro bajo).</li>
          <li>Cada predicción se cierra cuando empieza su partido real (hora del servidor). Si el partido se retrasa después de cerrar, sigue cerrada.</li>
          <li>Si cambias un pick, se quitan solo las predicciones posteriores que dependían de él.</li>
          <li>Acierto = el equipo que elegiste gana ese partido real. Puntos por partido: {[...new Set(v.descriptor.nodes.map((n) => `${n.roundLabel} ${n.points}`))].join(" · ")}. Máximo: {v.maxPoints}.</li>
          <li>Un partido anulado por la organización no suma ni resta. «Perfecto» = todos los partidos puntuables con pick y acertados.</li>
          <li>Las recompensas (si las hay) se reclaman cuando el Pick&apos;em se liquida, tras confirmarse los resultados.</li>
        </ul>
        <p className="nx-label text-ink-faint">Puntuación {v.scoringVersion} · horas en tu zona horaria</p>
      </section>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <p className="nx-label">{label}</p>
      <div className="truncate font-display text-lg font-bold text-white">{value}</div>
      {hint && <p className="truncate text-xs text-ink-muted" title={hint}>{hint}</p>}
    </div>
  );
}

/** F87.2 · ¿puede esta cuenta cobrar? Con icono y texto (nunca solo color). Lo decide el servidor. */
function EligibilityNote({ e }: { e: Eligibility }) {
  return (
    <div role="note" data-testid="pickem-eligibility" data-eligible={e.eligible ? "true" : "false"} data-code={e.code}
      className={cn("nx-clip-sm flex items-start gap-2 px-3 py-2 text-sm", e.eligible ? "text-ok" : "text-ink-secondary")}
      style={{ background: "rgba(255,255,255,0.03)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.1)" }}>
      <span aria-hidden className="mt-0.5 shrink-0">{e.eligible ? "✓" : "ⓘ"}</span>
      <span className="min-w-0 break-words">
        <span className="sr-only">{e.eligible ? "Cuenta con derecho a recompensas. " : "Cuenta sin derecho a recompensas todavía. "}</span>
        {eligibilityMessage(e)}
        {!e.eligible && <span className="mt-1 block text-ink-faint">{requirementText(policyOf(e.policy))}</span>}
      </span>
    </div>
  );
}

function RewardsPanel({ v, onClaim, claiming, claimMsg }: { v: BracketView; onClaim: () => void; claiming: boolean; claimMsg: { ok: boolean; text: string } | null }) {
  return (
    <section aria-label="Recompensas">
      <SectionTitle>Recompensas</SectionTitle>
      {!v.rewards ? (
        <p className="text-sm text-ink-secondary">{v.rewardsNote}</p>
      ) : (
        <div className="space-y-3">
          <ul className="grid grid-cols-2 gap-2 lg:grid-cols-5">
            {v.rewards.tiers.map((t) => (
              <li key={t.id} className={cn("nx-clip-sm space-y-1 px-3 py-2", v.me?.tier === t.id && "ring-1 ring-drl-gold")} style={{ background: "rgba(255,255,255,0.03)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.1)" }}>
                <p className="font-display text-xs font-bold uppercase tracking-wide text-drl-gold">{t.label}</p>
                <p className="nx-label">{t.id === "PARTICIPATION" ? `Predecir ≥ ${pct(v.rewards!.minCompletion)} a tiempo` : t.id === "PERFECT" ? "Todo acertado" : `≥ ${pct(t.minRatio ?? 0)} de los puntos`}</p>
                <p className="text-sm text-white">{t.items.join(" + ")}</p>
              </li>
            ))}
          </ul>
          <p className="nx-label text-ink-faint">Se cobra el escalón más alto alcanzado, una vez. {v.rewardsNote}</p>
          {v.me?.rewardEligibility && !v.me.claim && <EligibilityNote e={v.me.rewardEligibility} />}
          {v.me?.claim ? (
            <p className="text-sm text-ok">✓ Reclamado: {TIER_LABEL[v.me.claim.tier]} · {v.me.claim.items.join(" + ")}</p>
          ) : v.me?.claimable ? (
            <NxButton variant="primary" onClick={onClaim} disabled={claiming}>{claiming ? "Reclamando…" : `Reclamar · ${TIER_LABEL[v.me.tier!]}`}</NxButton>
          ) : v.status === "SETTLED" && v.me?.tier && v.me.rewardEligibility && !v.me.rewardEligibility.eligible ? (
            <p className="text-sm text-ink-secondary" data-testid="pickem-result-no-reward">Tu resultado: <b className="text-white">{TIER_LABEL[v.me.tier]}</b>. Sin premio para esta cuenta en este Pick&apos;em.</p>
          ) : v.status === "SETTLED" && v.me ? (
            <p className="text-sm text-ink-secondary">No alcanzaste ningún escalón en este Pick&apos;em.</p>
          ) : null}
          {claimMsg && <p role="status" className={cn("text-sm", claimMsg.ok ? "text-ok" : "text-bad")}>{claimMsg.text}</p>}
        </div>
      )}
    </section>
  );
}
