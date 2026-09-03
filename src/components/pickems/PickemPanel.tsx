"use client";

/**
 * PANEL DE PICK'EMS — la superficie donde se predice.
 *
 * Vive en un componente compartido porque lo usan DOS pantallas: la ficha del
 * torneo (`/torneos/[id]`, con el contexto de partidos) y el centro de
 * predicciones (`/pickems`). Duplicarlo habría significado dos comportamientos
 * de guardado y dos formas de mostrar el cierre.
 *
 * Regla que gobierna todo el componente: la UI es OPTIMISTA pero el servidor
 * MANDA. Si `submitPick` falla, se revierte lo mostrado; si falla por cierre, se
 * recarga para que el estado visible vuelva a coincidir con el real.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchPickemQuestions, fetchMyAnswers, fetchMyScore, submitPick, fetchPickemReward,
  type PickemQuestion, type MyScore, type LedgerRow,
} from "@/lib/game/client";
import { maxPoints, REWARD_TIERS, tierForPoints } from "@/domain/pickems/rewards";
import { packLabel } from "@/domain/pickems/ledger";
import type { Reward } from "@/domain/events/types";
import { Countdown } from "./Countdown";
import { PickemResultModal, type PickemResultData } from "./PickemResult";
import { Loading, ErrorState, EmptyState } from "@/components/ui/States";
import { formatCredits, plural, cn } from "@/lib/format";

/** Resume una recompensa en una línea legible. */
export function describeReward(r: Reward): string {
  const parts: string[] = [];
  if (r.credits) parts.push(`🪙 ${formatCredits(r.credits)}`);
  if (r.xp) parts.push(`${r.xp} XP`);
  if (r.tokens) parts.push(`🎟️ ${r.tokens}`);
  if (r.packId) parts.push(`${r.packCount ?? 1} × ${packLabel(r.packId)}`);
  return parts.join(" · ") || "—";
}

export function PickemPanel({
  pickemEventId,
  userId,
  onNotify,
  onScoreChange,
  eventName,
  totalPoints,
}: {
  pickemEventId: string;
  /** `null` si no hay sesión: se muestra en solo lectura. */
  userId: string | null;
  onNotify: (msg: string, ok: boolean) => void;
  /** Avisa al contenedor cuando cambian los puntos (para refrescar cabeceras). */
  onScoreChange?: (score: MyScore | null) => void;
  /** Nombre del torneo, para encabezar el resumen de resultado. */
  eventName?: string;
  /** Puntos TOTALES del perfil, para calcular el salto de rango en el resumen. */
  totalPoints?: number;
}) {
  const [questions, setQuestions] = useState<PickemQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [score, setScore] = useState<MyScore | null>(null);
  const [reward, setReward] = useState<LedgerRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  /*
   * `onScoreChange` avisa al contenedor, y el contenedor suele responder recargando.
   * Si `load` dependiera de ese callback, o lo invocara en cada carga, se cerraría un
   * ciclo: cargar → avisar → el padre recarga → el panel se remonta → cargar… Aquí se
   * corta por los dos lados: la identidad del callback se guarda en una ref (no entra
   * en las dependencias) y solo se avisa cuando los puntos CAMBIAN de verdad.
   */
  const notifyRef = useRef(onScoreChange);
  notifyRef.current = onScoreChange;
  const lastNotified = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [qs, mine, sc, rw] = await Promise.all([
        fetchPickemQuestions(pickemEventId),
        userId ? fetchMyAnswers(pickemEventId) : Promise.resolve({}),
        userId ? fetchMyScore(pickemEventId) : Promise.resolve(null),
        userId ? fetchPickemReward(pickemEventId) : Promise.resolve(null),
      ]);
      setQuestions(qs); setAnswers(mine); setScore(sc); setReward(rw);

      const stamp = sc ? `${sc.points}|${sc.correct}|${sc.total}` : "none";
      if (lastNotified.current !== stamp) {
        lastNotified.current = stamp;
        notifyRef.current?.(sc);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar las predicciones");
    } finally {
      setLoading(false);
    }
  }, [pickemEventId, userId]);

  useEffect(() => { load(); }, [load]);

  async function pick(q: PickemQuestion, option: string) {
    if (q.locked || saving || !userId) return;
    setSaving(q.id);
    const previous = answers[q.id];
    setAnswers((a) => ({ ...a, [q.id]: option })); // optimista
    try {
      await submitPick(q.id, option);
      onNotify("Predicción guardada", true);
    } catch (e) {
      setAnswers((a) => {
        const next = { ...a };
        if (previous) next[q.id] = previous; else delete next[q.id];
        return next;
      });
      const msg = e instanceof Error ? e.message : "No se pudo guardar";
      onNotify(msg, false);
      // Si el servidor dice que ya cerró, nuestra vista está desfasada.
      if (msg.includes("cerrada")) load();
    } finally {
      setSaving(null);
    }
  }

  const total = useMemo(() => maxPoints(questions.map((q) => q.points)), [questions]);
  const answered = questions.filter((q) => answers[q.id]).length;
  const open = questions.filter((q) => !q.locked);
  const resolved = questions.filter((q) => q.locked && q.correct_option);
  const pending = open.filter((q) => !answers[q.id]).length;

  // Resultado: qué acerté, qué fallé y cuánto sumé.
  const outcome = useMemo(() => {
    let hits = 0, misses = 0, earned = 0;
    for (const q of resolved) {
      const mine = answers[q.id];
      if (!mine) continue;
      if (mine === q.correct_option) { hits++; earned += q.points; } else misses++;
    }
    return { hits, misses, earned };
  }, [resolved, answers]);

  const tier = tierForPoints(score?.points ?? 0);
  const nextTier = REWARD_TIERS.find((t) => t.minPoints > (score?.points ?? 0)) ?? null;

  // Todo lo que necesita el resumen de resultado, con los datos que este panel ya tiene
  // cargados: no se vuelve a pedir nada al servidor para pintarlo.
  const resultData: PickemResultData = {
    eventName: eventName ?? "Pick'ems",
    questions,
    answers,
    score,
    reward,
    totalPoints: totalPoints ?? score?.points ?? 0,
  };

  if (loading) return <Loading label="Cargando predicciones" />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (questions.length === 0) {
    return <EmptyState icon="🗳️" title="Sin preguntas todavía"
      hint="Este torneo aún no tiene predicciones publicadas." />;
  }

  return (
    <div className="space-y-4">
      {/* Resumen del resultado: sale solo la primera vez tras cada corrección. */}
      {userId && <PickemResultModal pickemEventId={pickemEventId} data={resultData} />}

      {/* ── Marcador ── */}
      {userId && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border border-white/10 bg-base-700/40 px-5 py-4">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-white/40">Tus puntos</p>
            <p className="font-display text-2xl font-bold text-drl-gold">
              {score?.points ?? 0}
              <span className="text-sm font-normal text-white/40"> / {total}</span>
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-white/40">Respondidas</p>
            <p className="font-display text-lg text-white">{answered} / {questions.length}</p>
          </div>
          {resolved.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/40">Aciertos</p>
              <p className="font-display text-lg">
                <span className="text-emerald-300">{outcome.hits}</span>
                <span className="text-white/30"> / {outcome.hits + outcome.misses}</span>
              </p>
            </div>
          )}
          <div className="ml-auto text-right">
            <p className="text-[10px] uppercase tracking-widest text-white/40">Recompensa</p>
            <p className={cn("font-display text-sm", tier ? "text-emerald-300" : "text-white/40")}>
              {tier ? tier.label : "Sin escalón todavía"}
            </p>
            {nextTier && (
              <p className="text-[11px] text-white/35">
                {plural(nextTier.minPoints - (score?.points ?? 0), "pt", "pts")} para {nextTier.label}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Aviso de estado global ── */}
      {userId && pending > 0 && (
        <p className="rounded-xl border border-drl-cyan/30 bg-drl-cyan/5 px-4 py-2.5 text-sm text-drl-cyan">
          {pending === 1 ? "Te queda 1 predicción por hacer." : `Te quedan ${pending} predicciones por hacer.`}
        </p>
      )}
      {open.length === 0 && (
        <p className="rounded-xl border border-white/10 bg-base-700/40 px-4 py-2.5 text-sm text-white/55">
          Todas las predicciones de este torneo están cerradas.
        </p>
      )}

      {/* ── Preguntas ── */}
      {questions.map((q) => {
        const mine = answers[q.id];
        const isResolved = q.locked && !!q.correct_option;
        const hit = isResolved && mine === q.correct_option;
        return (
          <div key={q.id}
            className={cn("rounded-2xl border p-4 transition",
              isResolved && hit ? "border-emerald-400/30 bg-emerald-400/[0.04]"
              : isResolved && mine ? "border-drl/30 bg-drl/[0.04]"
              : q.locked ? "border-white/8 bg-base-800/40"
              : "border-white/10 bg-base-700/40")}>

            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className={cn("font-display text-sm uppercase tracking-wide",
                q.locked ? "text-white/50" : "text-white")}>{q.prompt}</p>
              <div className="flex shrink-0 items-center gap-2">
                <span className="rounded-full bg-drl-gold/10 px-2 py-0.5 font-display text-[10px] font-bold uppercase tracking-wider text-drl-gold">
                  {plural(q.points, "pt", "pts")}
                </span>
                <span className="text-[10px] uppercase tracking-widest text-white/35">
                  {q.locked
                    ? <span className="text-white/45">Predicción cerrada</span>
                    : <Countdown to={q.locks_at} onExpire={load} />}
                </span>
              </div>
            </div>

            <div className={cn("grid gap-2",
              q.options.length > 3 ? "sm:grid-cols-3 lg:grid-cols-4" : "sm:grid-cols-2")}>
              {q.options.map((o) => {
                const selected = mine === o.key;
                const isCorrect = isResolved && q.correct_option === o.key;
                const isWrongPick = isResolved && selected && q.correct_option !== o.key;
                return (
                  <button
                    key={o.key}
                    type="button"
                    disabled={q.locked || saving === q.id || !userId}
                    aria-pressed={selected}
                    onClick={() => pick(q, o.key)}
                    className={cn(
                      "rounded-xl border px-3 py-2.5 text-left font-display text-sm transition",
                      "disabled:cursor-not-allowed",
                      isCorrect ? "border-emerald-400/60 bg-emerald-400/10 text-emerald-300"
                      : isWrongPick ? "border-drl/60 bg-drl/10 text-drl"
                      : selected ? "border-drl bg-drl/15 text-white shadow-glow"
                      : q.locked ? "border-white/8 bg-white/[0.02] text-white/35"
                      : "border-white/10 bg-white/5 text-white/70 hover:border-white/25 hover:text-white",
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate">{o.label}</span>
                      {selected && <span aria-hidden>{isWrongPick ? "✕" : "●"}</span>}
                      {isCorrect && !selected && <span aria-hidden>✓</span>}
                    </span>
                  </button>
                );
              })}
            </div>

            {/*
              Estado explícito de la predicción mientras la pregunta sigue abierta. El
              aviso flotante desaparece a los pocos segundos, y sin esto lo único que
              quedaba era el botón resaltado — que no dice si llegó a guardarse.
            */}
            {!q.locked && userId && (
              <p className="mt-2 text-[11px] uppercase tracking-widest" role="status">
                {saving === q.id ? (
                  <span className="text-white/40">Guardando…</span>
                ) : mine ? (
                  <span className="text-emerald-300">✓ Predicción guardada · puedes cambiarla hasta el cierre</span>
                ) : (
                  <span className="text-white/35">Sin predicción · elige una opción</span>
                )}
              </p>
            )}

            {/* Resultado explícito: qué predije, qué salió, cuánto sumé. */}
            {isResolved && (
              <p className={cn("mt-2.5 text-xs",
                hit ? "text-emerald-300" : mine ? "text-drl" : "text-white/40")}>
                {mine
                  ? hit
                    ? `✓ Acertaste · +${q.points} puntos`
                    : `✕ Fallaste · predijiste ${q.options.find((o) => o.key === mine)?.label ?? mine}, ganó ${q.options.find((o) => o.key === q.correct_option)?.label ?? q.correct_option}`
                  : "No participaste en esta pregunta"}
              </p>
            )}
            {q.locked && !isResolved && (
              <p className="mt-2.5 text-xs text-white/40">
                Cerrada · pendiente del resultado
                {mine ? ` · tu predicción: ${q.options.find((o) => o.key === mine)?.label ?? mine}` : ""}
              </p>
            )}
          </div>
        );
      })}

      {/* ── Recompensas de este torneo ── */}
      {userId && (
        <div className="rounded-2xl border border-white/10 bg-base-700/30 p-4">
          <p className="mb-3 text-[11px] uppercase tracking-widest text-white/40">
            Recompensas de este torneo
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {REWARD_TIERS.map((t) => {
              const reached = (score?.points ?? 0) >= t.minPoints;
              return (
                <div key={t.id}
                  className={cn("rounded-xl border px-3 py-2.5",
                    reached ? "border-emerald-400/50 bg-emerald-400/10" : "border-white/10 bg-white/[0.02]")}>
                  <div className="flex items-center justify-between gap-2">
                    <p className={cn("font-display text-xs uppercase tracking-wide",
                      reached ? "text-emerald-300" : "text-white/55")}>{t.label}</p>
                    <span className={cn("text-[10px] uppercase tracking-widest",
                      reached ? "text-emerald-300" : "text-white/35")}>
                      {reached ? "✓ Obtenida" : plural(t.minPoints, "pt", "pts")}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-white/45">{describeReward(t.reward)}</p>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-[11px] text-white/35">
            Se concede el escalón más alto alcanzado, y llega a tu cuenta al corregirse el torneo.
          </p>
        </div>
      )}
    </div>
  );
}
