"use client";

/**
 * PANEL DE PICK'EMS — la superficie donde se predice, empotrada en la ficha del torneo.
 *
 * Vive en un componente compartido porque lo usa la ficha del torneo (`/torneos/[id]`) y,
 * hasta la Fase 24.2, también el centro de predicciones. Ahora `/pickems` compone las mismas
 * piezas (`PickemBoard`, `PickemRewards`, `PickemResults`) con un héroe propio, y las dos
 * pantallas cargan y guardan por el MISMO hook (`usePickem`): sigue sin haber dos
 * implementaciones del guardado ni del cierre.
 *
 * Regla que gobierna todo: la UI es OPTIMISTA pero el servidor MANDA. Vive en `usePickem`.
 */
import { useEffect, useMemo, useRef } from "react";
import { usePickem } from "@/lib/usePickem";
import { useNow } from "@/lib/useNow";
import type { MyScore } from "@/lib/game/client";
import { maxPoints } from "@/domain/pickems/rewards";
import { progressOf, positionOf } from "@/domain/pickems/progress";
import { PickemResultModal, type PickemResultData } from "./PickemResult";
import { PickemBoard } from "./PickemBoard";
import { PickemRewards } from "./PickemRewards";
import { Loading, ErrorState } from "@/components/ui/States";
import { Plate, Recessed } from "@/components/ui/Surface";
import { Readout } from "@/components/ui/Readout";
import { StatusDot } from "@/components/ui/Badge";
import { formatCredits } from "@/lib/format";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("pickems");

export { describeReward } from "./PickemRewards";

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
  useLocale();
  const { bundle, loading, error, saving, feedback, pick, reload, retry } = usePickem(pickemEventId, userId);
  const now = useNow(1000);

  /*
   * `onScoreChange` avisa al contenedor, y el contenedor suele responder recargando. Se
   * guarda en una ref y solo se avisa cuando los puntos CAMBIAN de verdad, para no cerrar
   * un ciclo cargar → avisar → recargar → cargar…
   */
  const notifyRef = useRef(onScoreChange);
  notifyRef.current = onScoreChange;
  const lastNotified = useRef<string | null>(null);
  useEffect(() => {
    if (!bundle) return;
    const sc = bundle.score;
    const stamp = sc ? `${sc.points}|${sc.correct}|${sc.total}` : "none";
    if (lastNotified.current !== stamp) {
      lastNotified.current = stamp;
      notifyRef.current?.(sc);
    }
  }, [bundle]);

  // Avisos con el toast del contenedor, además de la línea de estado de la pregunta.
  const lastFeedback = useRef<typeof feedback>(null);
  useEffect(() => {
    if (!feedback || feedback === lastFeedback.current) return;
    lastFeedback.current = feedback;
    if (feedback.kind === "saved") onNotify(t("Predicción guardada"), true);
    else if (feedback.kind === "error" || feedback.kind === "locked") onNotify(feedback.message, false);
  }, [feedback, onNotify]);

  const questions = useMemo(() => bundle?.questions ?? [], [bundle]);
  const answers = useMemo(() => bundle?.answers ?? {}, [bundle]);
  const score = bundle?.score ?? null;

  const resultData: PickemResultData = useMemo(() => ({
    eventName: eventName ?? "Pick'ems",
    questions,
    answers: Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, v.option])),
    score,
    reward: bundle?.reward ?? null,
    totalPoints: totalPoints ?? score?.points ?? 0,
  }), [eventName, questions, answers, score, bundle?.reward, totalPoints]);

  if (loading && !bundle) return <Loading label={t("Cargando predicciones")} />;
  if (error && !bundle) return <ErrorState message={td(error)} onRetry={retry} />;
  if (questions.length === 0) {
    return (
      <Plate className="px-6 py-10 text-center">
        <p className="font-display text-h3 font-bold uppercase tracking-wide text-white">
          {t("Sin preguntas todavía")}
        </p>
        <p className="mx-auto mt-1.5 max-w-[46ch] text-body text-ink-muted">
          {t("Este torneo aún no tiene predicciones publicadas.")}
        </p>
      </Plate>
    );
  }

  const p = progressOf(questions, answers, now);
  const total = maxPoints(questions.map((q) => q.points));
  const position = positionOf(bundle?.ranking ?? [], userId);

  return (
    <div className="space-y-4">
      {userId && <PickemResultModal pickemEventId={pickemEventId} data={resultData} />}

      {/* ── Marcador ── */}
      {userId && (
        <Plate className="px-4 py-3.5 sm:px-5" aria-label={t("Tu marcador en este Pick'em")}>
          <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
            <Readout size="lg" label={t("Tus puntos")} value={score ? formatCredits(score.points) : "—"} unit={`/ ${total}`} tone="var(--nx-gold)" />
            <Readout size="sm" label={t("Predicciones")} value={`${p.answered} / ${p.total}`} />
            {score && <Readout size="sm" label={t("Aciertos")} value={String(score.correct)} tone="var(--nx-ok)" />}
            <Readout size="sm" label={t("Posición")} value={position ? `#${position}` : score ? "+100" : t("Sin clasificar")} />
          </div>
          <Recessed depth="sm" className="mt-3 h-1.5 overflow-hidden">
            <span
              className="block h-full transition-[width] duration-normal motion-reduce:transition-none"
              style={{ width: `${p.pct}%`, background: "var(--nx-gold)" }}
              role="progressbar"
              aria-valuenow={p.pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={t("Predicciones completadas")}
            />
          </Recessed>
        </Plate>
      )}

      {userId && p.pending > 0 && (
        <Recessed depth="sm" className="flex items-center gap-2.5 border-l-2 border-l-drl-cyan px-4 py-2.5">
          <StatusDot tone="info" pulse size={6} />
          <span className="text-body text-drl-cyan">
            {p.pending === 1 ? t("Te queda 1 predicción por hacer.") : t("Te quedan {pending} predicciones por hacer.", { pending: p.pending })}
          </span>
        </Recessed>
      )}

      <PickemBoard
        questions={questions}
        answers={answers}
        now={now}
        saving={saving}
        feedback={feedback}
        canPick={!!userId}
        onPick={pick}
        onExpire={reload}
      />

      {userId && <PickemRewards score={score} reward={bundle?.reward ?? null} />}
    </div>
  );
}
