"use client";

/**
 * NEXUS PICK'EMS — el modo competitivo de predicciones (Fase 24.2), como EVENTO VIVO (24.5).
 *
 *   ENTRO → VEO EL EVENTO ACTIVO → HAY PARTIDO EN DIRECTO → VEO MI PICK → TERMINA → EL CUADRO
 *   AVANZA → MI PREDICCIÓN PASA A ACERTADA/FALLADA → SUMO PUNTOS → CAMBIA MI POSICIÓN →
 *   APARECE EL SIGUIENTE PARTIDO → CONTINÚO
 *
 * De arriba abajo: selector de torneo, héroe (estado real, fase, posición, puntos, progreso),
 * aviso de actualización, cambios de la sesión, navegación, RESUMEN (pendientes, en directo,
 * siguiente partido, progreso del torneo, hoy, actividad), PREDICCIONES (tablero de liga o
 * cuadro), resultados, recompensas y clasificación.
 *
 * NO decide nada. Carga y refresca por `usePickem({ live: true })` (ritmo del dominio, pausa con
 * la pestaña oculta, sin red no sondea) y guarda por `/api/pickems`. «En directo» solo si el
 * backend lo dice; los puntos, resultados, clasificados y posiciones son del servidor.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { useAuth } from "@/lib/supabase/auth";
import { fetchPickemEvents, type PickemEventSummary, type PickemQuestion } from "@/lib/game/client";
import { usePickem } from "@/lib/usePickem";
import { useNow } from "@/lib/useNow";
import { trackPickem } from "@/lib/telemetry/pickems";
import { eventPhase, eventPhaseCoarse, groupQuestions, progressOf } from "@/domain/pickems/progress";
import { buildBracketModel, isBracketFormat, type BracketMatch } from "@/domain/pickems/bracket";
import { deriveLiveEventSnapshot } from "@/domain/pickems/live";
import { PickemHero } from "@/components/pickems/PickemHero";
import { PickemBoard, PENDING_ANCHOR_ID } from "@/components/pickems/PickemBoard";
import { BracketPickemView } from "@/components/pickems/bracket/BracketPickemView";
import { PickemResults } from "@/components/pickems/PickemResults";
import { PickemRewards } from "@/components/pickems/PickemRewards";
import { PickemResultModal, type PickemResultData } from "@/components/pickems/PickemResult";
import { EventSwitcher, type SwitcherEvent } from "@/components/pickems/EventSwitcher";
import { TournamentLeaderboard } from "@/components/pickems/TournamentLeaderboard";
import { LiveMatchCard } from "@/components/pickems/live/LiveMatchCard";
import {
  EventProgress, EventToday, RecentEventActivity, PendingPredictions, LiveUpdateNotice, LiveChangesBanner, EventNav, describeChange,
} from "@/components/pickems/live/EventSummary";
import { Loading, ErrorState, NeedsAccount } from "@/components/ui/States";
import { Toast } from "@/components/ui/Toast";
import { Plate } from "@/components/ui/Surface";
import { NxButton } from "@/components/ui/NxButton";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { useToast } from "@/lib/useToast";
import { MyPickems } from "@/components/pickems/predict/MyPickems";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const tr = ns("pickems");

const NEXT_ANCHOR_ID = "pickems-siguiente";

export default function PickemsPage() {
  useLocale();
  const configured = isSupabaseConfigured();
  const { user, profile, refreshProfile } = useAuth();
  const { toast, notify } = useToast();
  const tick = useNow(1000);
  // Antes del primer latido del reloj compartido (SSR / primer render) se usa el del sistema.
  const now = tick || Date.now();

  const [events, setEvents] = useState<PickemEventSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setListError(null);
    try {
      const rows = await fetchPickemEvents();
      setEvents(rows);
      setSelected((s) => {
        if (s && rows.some((r) => r.id === s)) return s;
        const t = Date.now();
        const phased = rows.map((r) => ({ r, phase: eventPhaseCoarse(toEventLike(r), t) }));
        return (phased.find((x) => x.phase === "activo") ?? phased.find((x) => x.phase === "proximo") ?? phased[0])?.r.id ?? null;
      });
    } catch (e) {
      setListError(e instanceof Error ? e.message : tr("No se pudieron cargar los Pick'ems"));
      setEvents([]);
    }
  }, []);

  useEffect(() => { if (configured) loadList(); else setEvents([]); }, [configured, loadList]);

  const { bundle, loading, error, saving, feedback, pick, reload, retry, live, ackChanges } = usePickem(selected, user?.id ?? null, { live: true });

  // Los puntos del perfil cambian cuando el corrector pasa: se refresca la cabecera global.
  const lastStamp = useMemo(() => (bundle?.score ? `${bundle.score.points}|${bundle.score.correct}` : "none"), [bundle?.score]);
  useEffect(() => { if (bundle) refreshProfile(); }, [lastStamp, bundle, refreshProfile]);

  const active = useMemo(() => events?.find((e) => e.id === selected) ?? null, [events, selected]);
  const questions = useMemo(() => bundle?.questions ?? [], [bundle]);
  const answers = useMemo(() => bundle?.answers ?? {}, [bundle]);
  const grouped = useMemo(() => groupQuestions(questions, now), [questions, now]);

  // Liga o cuadro (24.3/24.4): lo deciden las fases y las rondas reales. Modelo por minuto.
  const nowMinute = Math.floor(now / 60_000) * 60_000;
  const model = useMemo(
    () => (bundle ? buildBracketModel({ stages: bundle.stages, matches: bundle.matches, questions, answers, now: nowMinute }) : null),
    [bundle, questions, answers, nowMinute],
  );
  const useBracket = !!model && isBracketFormat(model.format) && model.reliable && model.rounds.length > 0;
  const phase = active ? eventPhase(toEventLike(active), questions, now) : "activo";

  // El evento vivo (24.5): estado real, en directo, siguiente, hoy, actividad, progreso.
  const snapshot = useMemo(() => (model && bundle ? deriveLiveEventSnapshot({
    model, stages: bundle.stages, event: active?.events ?? null, phase, questions, answers,
    score: bundle.score, ranking: bundle.ranking, reward: bundle.reward, userId: user?.id ?? null, now: nowMinute,
  }) : null), [model, bundle, active, phase, questions, answers, user?.id, nowMinute]);

  // Telemetría: una vez por torneo / partido en directo / resultado / clasificado / fallo.
  useEffect(() => { if (active) trackPickem("pickem_viewed", { once: active.id }); }, [active]);
  useEffect(() => { if (active && snapshot?.status === "live") trackPickem("event_live_viewed", { once: active.id }); }, [active, snapshot?.status]);
  useEffect(() => { for (const m of snapshot?.liveMatches ?? []) trackPickem("live_match_seen", { once: m.id }); }, [snapshot?.liveMatches]);
  useEffect(() => {
    if (!active || !user) return;
    if (grouped.resolved.some((q) => answers[q.id])) trackPickem("pickem_result_seen", { once: active.id });
  }, [active, user, grouped.resolved, answers]);
  useEffect(() => {
    if (active && (bundle?.ranking.length ?? 0) > 0) trackPickem("pickem_leaderboard_seen", { once: active.id });
  }, [active, bundle?.ranking.length]);
  useEffect(() => { if (live.refreshError && active) trackPickem("event_refresh_failed", { once: `${active.id}:${live.failures}` }); }, [live.refreshError, live.failures, active]);

  // Cambios de la sesión: toast con el primero relevante + telemetría; el banner los lista.
  const announced = useRef(0);
  useEffect(() => {
    if (live.changes.length <= announced.current) { announced.current = live.changes.length; return; }
    const fresh = live.changes.slice(announced.current);
    announced.current = live.changes.length;
    const top = fresh.find((c) => c.kind === "PREDICTION_RESOLVED" || c.kind === "REWARD_EARNED" || c.kind === "RANK_CHANGED" || c.kind === "QUALIFIED");
    const msg = top ? describeChange(top) : null;
    if (msg) notify(msg, top!.kind !== "PREDICTION_RESOLVED" || top!.outcome === "acertada");
    for (const c of fresh) {
      if (c.kind === "PREDICTION_RESOLVED") trackPickem("prediction_result_seen", { once: c.id });
      if (c.kind === "QUALIFIED") trackPickem("qualification_seen", { once: c.id });
    }
  }, [live.changes, notify]);
  const pointsDelta = useMemo(() => {
    const c = [...live.changes].reverse().find((x) => x.kind === "POINTS_CHANGED");
    return c && c.kind === "POINTS_CHANGED" ? c.to - c.from : null;
  }, [live.changes]);

  const switcherEvents: SwitcherEvent[] = useMemo(() => (events ?? []).map((e) => ({
    id: e.id,
    name: e.events?.name ?? e.title,
    phase: e.id === selected ? phase : eventPhaseCoarse(toEventLike(e), now),
    isDemo: e.events?.source === "demo",
  })), [events, selected, phase, now]);

  const p = progressOf(questions, answers, now);
  const nextMatch = snapshot?.nextMatches[0] ?? null;
  const nextIsPending = !!nextMatch && nextMatch.pickState === "pendiente";

  const goPending = useCallback(() => {
    const target = document.getElementById(nextIsPending ? NEXT_ANCHOR_ID : PENDING_ANCHOR_ID) ?? document.getElementById(PENDING_ANCHOR_ID);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [nextIsPending]);

  const qById = useMemo(() => new Map(questions.map((q) => [q.id, q])), [questions]);
  const pickFromMatch = useCallback((m: BracketMatch, option: string) => {
    const q = m.questionId ? qById.get(m.questionId) : null;
    if (q) void pick(q as PickemQuestion, option);
  }, [qById, pick]);

  const resultData: PickemResultData | null = active && bundle ? {
    eventName: active.events?.name ?? active.title,
    questions,
    answers: Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, v.option])),
    score: bundle.score,
    reward: bundle.reward,
    totalPoints: profile?.points ?? bundle.score?.points ?? 0,
  } : null;

  const navItems = [
    { id: "resumen", label: tr("Resumen") },
    { id: "predicciones", label: tr("Predicciones") },
    ...(useBracket ? [{ id: "cuadro", label: tr("Cuadro") }] : []),
    { id: "clasificacion", label: tr("Clasificación") },
    { id: "recompensas", label: tr("Recompensas") },
  ];

  const focusStageId = snapshot?.liveMatches[0]?.stageId ?? snapshot?.nextMatches[0]?.stageId;

  return (
    <section className="animate-rise">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <span className="nx-label">{tr("Jugar · Predicciones")}</span>
          <h1 className="mt-1 font-display text-[clamp(28px,5vw,44px)] font-bold uppercase leading-none text-white">
            {tr("Nexus Pick'ems")}
          </h1>
          <p className="mt-2 max-w-2xl text-body text-ink-muted">
            {tr("Predice campeón y partidos del competitivo real, suma puntos, sube en la clasificación y llévate recompensas.")}
          </p>
        </div>
        {user && (
          <NxButton variant="secondary" size="md" href="/pickems/historial">
            {tr("Mi historial →")}
          </NxButton>
        )}
      </header>

      {/* F87 · Pick'ems 2.0 (cuadros): solo aparece si hay alguno publicado. */}
      {configured && <div className="mb-6"><MyPickems /></div>}

      {!configured ? (
        <NeedsAccount what={tr("Tus predicciones")} />
      ) : events === null ? (
        <Loading label={tr("Cargando Pick'ems")} />
      ) : listError ? (
        <ErrorState message={td(listError)} onRetry={loadList} />
      ) : events.length === 0 ? (
        <Plate className="px-6 py-14 text-center">
          <p className="font-display text-h2 font-bold uppercase tracking-wide text-white">
            {tr("Todavía no hay Pick'ems")}
          </p>
          <p className="mx-auto mt-1.5 max-w-[48ch] text-body text-ink-muted">
            {tr("Aparecerán en cuanto haya un torneo con predicciones abiertas.")}
          </p>
          <NxButton variant="primary" size="lg" href="/torneos" className="mt-5">
            {tr("Ver torneos")}
          </NxButton>
        </Plate>
      ) : (
        <div className="space-y-5">
          {events.length > 1 && (
            <EventSwitcher events={switcherEvents} selected={selected} onSelect={setSelected} />
          )}

          {/* ── Héroe del torneo: estado real, fase, posición, puntos, progreso ── */}
          {active && (
            <PickemHero
              name={active.events?.name ?? active.title}
              description={td(active.description)}
              isDemo={active.events?.source === "demo"}
              phase={phase}
              statusLabel={snapshot?.statusLabel}
              stageLabel={snapshot?.stageLabel ?? null}
              tournamentProgress={snapshot?.progress ?? null}
              previousPosition={live.previousPosition}
              pointsDelta={pointsDelta}
              eventHref={`/torneos/${active.event_id}`}
              questions={questions}
              answers={answers}
              score={bundle?.score ?? null}
              ranking={bundle?.ranking ?? []}
              userId={user?.id ?? null}
              now={now}
              onGoPending={p.pending > 0 ? goPending : undefined}
              onExpire={reload}
            />
          )}

          {/* ── Estado de la actualización: sin red / error / datos antiguos ── */}
          {active && bundle && (
            <LiveUpdateNotice online={live.online} refreshError={live.refreshError} lastUpdatedAt={live.lastUpdatedAt} now={now} onRetry={reload} />
          )}
          <LiveChangesBanner changes={live.changes} onDismiss={ackChanges} />

          {active && !user && <NeedsAccount what={tr("Tus predicciones")} />}

          {active && user && (
            loading && !bundle ? (
              <Loading label={tr("Cargando predicciones")} />
            ) : error && !bundle ? (
              <ErrorState message={td(error)} onRetry={retry} />
            ) : questions.length === 0 && (snapshot?.progress.total ?? 0) === 0 ? (
              <Plate className="px-6 py-10 text-center">
                <p className="font-display text-h3 font-bold uppercase tracking-wide text-white">{tr("Sin preguntas todavía")}</p>
                <p className="mx-auto mt-1.5 max-w-[46ch] text-body text-ink-muted">
                  {tr("Este torneo aún no tiene predicciones publicadas.")}
                </p>
              </Plate>
            ) : (
              <>
                {resultData && <PickemResultModal pickemEventId={active.id} data={resultData} />}

                <EventNav items={navItems} />

                {/* ── RESUMEN: lo que pasa ahora ── */}
                <section id="resumen" aria-label={tr("Resumen del evento")} className="scroll-mt-24 space-y-4">
                  <PendingPredictions count={p.pending} onGo={goPending} />

                  {snapshot && snapshot.liveMatches.length > 0 && (
                    <div className="space-y-3" data-live-count={snapshot.liveMatches.length}>
                      {snapshot.liveMatches.length > 1 && (
                        <SectionTitle as="h2">{tr("En directo")} <span className="text-ink-faint">· {snapshot.liveMatches.length} {tr("partidos")}</span></SectionTitle>
                      )}
                      {snapshot.liveMatches.map((m) => (
                        <LiveMatchCard key={m.id} m={m} mode="live" now={now} canPick={false} highlight={live.changedIds.has(m.id)} />
                      ))}
                    </div>
                  )}

                  {nextMatch && (
                    <LiveMatchCard
                      id={NEXT_ANCHOR_ID}
                      m={nextMatch}
                      mode="next"
                      now={now}
                      saving={saving !== null && saving === nextMatch.questionId}
                      feedback={feedback && feedback.questionId === nextMatch.questionId ? feedback : null}
                      canPick={!!user}
                      onPick={pickFromMatch}
                      onExpire={reload}
                      highlight={live.changedIds.has(nextMatch.id)}
                      className="scroll-mt-24"
                    />
                  )}

                  {snapshot && <EventProgress progress={snapshot.progress} />}
                  {snapshot && <EventToday matches={snapshot.todayMatches} />}
                  {snapshot && <RecentEventActivity items={snapshot.activity} />}
                </section>

                {/* ── PREDICCIONES: cuadro (24.3/24.4) o tablero de liga (24.2), mismo hook, misma API ── */}
                <section id="predicciones" aria-label={tr("Predicciones")} className="scroll-mt-24">
                  {useBracket && model ? (
                    <BracketPickemView
                      model={model}
                      questions={questions}
                      answers={answers}
                      now={now}
                      saving={saving}
                      feedback={feedback}
                      canPick
                      onPick={pick}
                      onExpire={reload}
                      changedIds={live.changedIds}
                      initialStageId={focusStageId}
                    />
                  ) : (
                    <div data-view="league">
                      <PickemBoard
                        questions={questions}
                        answers={answers}
                        now={now}
                        saving={saving}
                        feedback={feedback}
                        canPick
                        showResolved={false}
                        onPick={pick}
                        onExpire={reload}
                      />
                    </div>
                  )}
                </section>

                {grouped.resolved.length > 0 && (
                  <section aria-label={tr("Resultados recientes")}>
                    <SectionTitle as="h2">
                      {tr("Resultados recientes")} <span className="text-ink-faint">({grouped.resolved.length})</span>
                    </SectionTitle>
                    <PickemResults questions={grouped.resolved} answers={answers} limit={8} />
                    {grouped.resolved.length > 8 && (
                      <p className="mt-2 text-caption text-ink-faint">
                        <Link href={`/pickems/historial/${active.id}`} className="nx-focus text-drl underline-offset-2 hover:underline">
                          {tr("Ver las {n} corregidas en el historial →", { n: grouped.resolved.length })}
                        </Link>
                      </p>
                    )}
                  </section>
                )}

                <div id="recompensas" className="scroll-mt-24">
                  <PickemRewards score={bundle?.score ?? null} reward={bundle?.reward ?? null} />
                </div>
              </>
            )
          )}

          {active && (
            <div id="clasificacion" className="scroll-mt-24">
              <TournamentLeaderboard
                pickemEventId={active.id}
                currentUserId={user?.id}
                rows={bundle ? bundle.ranking : undefined}
                className="mt-1"
              />
            </div>
          )}
        </div>
      )}

      <Toast toast={toast} />
    </section>
  );
}

function toEventLike(e: PickemEventSummary) {
  return {
    status: e.status,
    eventStatus: e.events?.status ?? null,
    startDate: e.events?.start_date ?? null,
    endDate: e.events?.end_date ?? null,
    opensAt: e.opens_at,
    locksAt: e.locks_at,
  };
}
