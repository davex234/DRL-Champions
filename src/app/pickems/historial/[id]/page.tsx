"use client";

/**
 * DETALLE HISTÓRICO DE UN TORNEO (Fase 24.2) — mis predicciones, una a una.
 *
 *     VCT EMEA Stage 2 · Finalizado
 *     14 predicciones · 11 acertadas · 3 falladas · 1.450 pts · Posición #18
 *     [ lista de preguntas con mi elección, el resultado y los puntos ]
 *
 * Es de SOLO LECTURA: el tablero recibe `readOnly`, así que aunque una pregunta siguiera
 * abierta no se puede tocar desde aquí. Para predecir se vuelve a `/pickems`. Todo sale del
 * mismo hook que la pantalla principal (`usePickem`): no hay una segunda lectura del torneo.
 */
import { use, useMemo } from "react";
import Link from "next/link";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { useAuth } from "@/lib/supabase/auth";
import { usePickem } from "@/lib/usePickem";
import { useNow } from "@/lib/useNow";
import { describeLedger } from "@/domain/pickems/ledger";
import { eventPhase, PHASE_LABEL, progressOf, positionOf } from "@/domain/pickems/progress";
import { PickemBoard } from "@/components/pickems/PickemBoard";
import { BracketPickemView } from "@/components/pickems/bracket/BracketPickemView";
import { buildBracketModel, isBracketFormat } from "@/domain/pickems/bracket";
import { PickemRewards } from "@/components/pickems/PickemRewards";
import { TournamentLeaderboard } from "@/components/pickems/TournamentLeaderboard";
import { Loading, ErrorState, NeedsAccount, DemoBadge } from "@/components/ui/States";
import { Stage } from "@/components/ui/Surface";
import { Badge } from "@/components/ui/Badge";
import { Readout } from "@/components/ui/Readout";
import { NxButton } from "@/components/ui/NxButton";
import { formatCredits } from "@/lib/format";

export default function PickemHistoryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const configured = isSupabaseConfigured();
  const { user, loading: authLoading } = useAuth();
  const { bundle, loading, error, retry } = usePickem(id, user?.id ?? null);
  const now = useNow(60_000);
  const t = now || Date.now();

  const questions = useMemo(() => bundle?.questions ?? [], [bundle]);
  const answers = useMemo(() => bundle?.answers ?? {}, [bundle]);
  // `t` late por minuto (useNow(60_000)); el cuadro se reconstruye a ese ritmo, que es suficiente.
  const tMinute = Math.floor(t / 60_000) * 60_000;
  const ev = bundle?.event ?? null;
  const name = ev?.events?.name ?? ev?.title ?? "Torneo";
  const phase = ev
    ? eventPhase({ status: ev.status, eventStatus: ev.events?.status, startDate: ev.events?.start_date, endDate: ev.events?.end_date }, questions, t)
    : "finalizado";
  const p = progressOf(questions, answers, t);
  const score = bundle?.score ?? null;
  const position = positionOf(bundle?.ranking ?? [], user?.id ?? null);
  const reward = bundle?.reward ? describeLedger(bundle.reward.reason, bundle.reward.ref) : null;
  const participated = p.answered > 0;
  // Si el torneo fue un cuadro, el historial lo enseña como cuadro: SOLO LECTURA (24.3).
  const model = useMemo(
    () => (bundle ? buildBracketModel({ stages: bundle.stages, matches: bundle.matches, questions, answers, now: tMinute }) : null),
    [bundle, questions, answers, tMinute],
  );
  const useBracket = !!model && isBracketFormat(model.format) && model.reliable && model.rounds.length > 0;

  return (
    <section className="animate-rise">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link href="/pickems/historial" className="nx-focus text-[13px] text-drl underline-offset-2 hover:underline">
          ← Mi historial
        </Link>
        <NxButton variant="tertiary" size="md" href="/pickems">Ir a Pick&apos;ems →</NxButton>
      </header>

      {!configured || (!authLoading && !user) ? (
        <NeedsAccount what="Tus predicciones" />
      ) : loading && !bundle ? (
        <Loading label="Cargando el torneo" />
      ) : error && !bundle ? (
        <ErrorState message={error} onRetry={retry} />
      ) : !ev ? (
        <ErrorState message="Este torneo no existe o ya no está disponible." onRetry={retry} />
      ) : (
        <div className="space-y-5">
          <Stage tone={phase === "activo" ? "cyan" : "neutral"} grid className="p-5 sm:p-6" aria-label="Resumen del torneo">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={phase === "activo" ? "key" : phase === "proximo" ? "info" : "muted"} dot>{PHASE_LABEL[phase]}</Badge>
              {ev.events?.source === "demo" && <DemoBadge />}
              {phase !== "activo" && <Badge tone="muted">Solo lectura</Badge>}
            </div>
            <h1 className="mt-2 font-display text-[clamp(24px,4vw,40px)] font-bold uppercase leading-none text-white">{name}</h1>

            {participated ? (
              <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-5" aria-label="Tu resultado en este torneo">
                <Readout size="md" label="Predicciones" value={`${p.answered} / ${p.total}`} />
                <Readout size="md" label="Acertadas" value={String(p.hits)} tone="var(--nx-ok)" />
                <Readout size="md" label="Falladas" value={String(p.misses)} tone="var(--nx-bad)" />
                <Readout size="md" label="Puntos" value={score ? formatCredits(score.points) : "—"} tone="var(--nx-gold)" />
                <Readout size="md" label="Posición" value={position ? `#${position}` : score ? "+100" : "Sin clasificar"} tone={position ? "var(--nx-accent)" : undefined} />
              </div>
            ) : (
              <p className="mt-3 text-body text-ink-muted">No participaste en este torneo.</p>
            )}

            {reward?.tier && (
              <p className="mt-3"><Badge tone="gold" solid>Recompensa conseguida · {reward.tier.label}</Badge></p>
            )}
            {phase === "activo" && (
              <p className="mt-3 text-caption text-ink-muted">
                Este torneo sigue abierto: para cambiar una predicción ve a{" "}
                <Link href="/pickems" className="text-drl underline-offset-2 hover:underline">Pick&apos;ems</Link>.
              </p>
            )}
          </Stage>

          {questions.length === 0 ? (
            <p className="text-body text-ink-muted">Este torneo no tiene preguntas publicadas.</p>
          ) : useBracket && model ? (
            <BracketPickemView
              model={model}
              questions={questions}
              answers={answers}
              now={t}
              saving={null}
              feedback={null}
              canPick={false}
              readOnly
              showResolved
              onPick={() => undefined}
            />
          ) : (
            <PickemBoard
              questions={questions}
              answers={answers}
              now={t}
              saving={null}
              feedback={null}
              canPick={false}
              readOnly
              onPick={() => undefined}
            />
          )}

          {participated && <PickemRewards score={score} reward={bundle?.reward ?? null} />}

          <TournamentLeaderboard pickemEventId={id} currentUserId={user?.id} rows={bundle ? bundle.ranking : undefined} className="mt-1" />
        </div>
      )}
    </section>
  );
}
