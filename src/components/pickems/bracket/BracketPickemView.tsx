"use client";

/**
 * LA VISTA DE ELIMINATORIAS (Fase 24.3) — el cuadro con los Pick'ems dentro.
 *
 *   [ FASE DE GRUPOS ] [ PLAYOFFS ]        ← solo si los datos separan las dos fases
 *   ¿Quién será campeón?                    ← la MISMA pregunta champion de 24.2
 *   [ CUADRO ]                              ← cajas con predicción directa
 *   Más predicciones                        ← preguntas sin caja (marcador exacto, etc.)
 *
 * Comparte TODO con la vista de liga: el hook (`usePickem`), el dominio (`progress`), la API
 * (`/api/pickems`), las submissions, el scoring, el progreso y las recompensas. Solo cambia
 * qué se pinta. Elegir un equipo en una caja llama al mismo `pick(q, option)` del tablero.
 */
import { useEffect, useMemo, useState } from "react";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { Plate } from "@/components/ui/Surface";
import { PickQuestion } from "../PickQuestion";
import { PickemBoard } from "../PickemBoard";
import { TournamentBracket } from "./TournamentBracket";
import { BracketStageTabs } from "./BracketStageTabs";
import type { PickemQuestion } from "@/lib/game/client";
import type { PickFeedback } from "@/lib/usePickem";
import { FEATURED_KINDS, type AnswerMap } from "@/domain/pickems/progress";
import type { BracketModel, BracketMatch } from "@/domain/pickems/bracket";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("pickems");

export function BracketPickemView({
  model, questions, answers, now, saving, feedback, canPick, readOnly, onPick, onExpire, showResolved = false, bracketMode, changedIds, initialStageId,
}: {
  model: BracketModel;
  questions: PickemQuestion[];
  answers: AnswerMap;
  now: number;
  saving: string | null;
  feedback: PickFeedback | null;
  canPick: boolean;
  readOnly?: boolean;
  onPick: (q: PickemQuestion, option: string) => void;
  onExpire?: () => void;
  /** Historial: enseñar también las preguntas corregidas fuera del cuadro. */
  showResolved?: boolean;
  /** Solo para QA/pruebas. */
  bracketMode?: "desktop" | "mobile";
  /** 24.5 · ids que acaban de cambiar (brillo breve). */
  changedIds?: Set<string>;
  /** 24.5 · fase a abrir (la del partido en directo / siguiente), si el evento la conoce. */
  initialStageId?: string | null;
}) {
  useLocale();
  const bracketStages = model.stages.filter((s) => s.bracket);
  const [stageId, setStageId] = useState<string | null>(() => {
    if (initialStageId !== undefined && model.stages.some((s) => s.id === initialStageId)) return initialStageId;
    // Abre en la fase con algo abierto o en juego; si no, la última (los playoffs).
    const stageHas = (s: (typeof model.stages)[number], pred: (m: (typeof model.matches)[string]) => boolean) =>
      s.roundIds.some((rid) => model.rounds.find((r) => r.id === rid)?.matchIds.some((mid) => pred(model.matches[mid])));
    const live = model.stages.find((s) => stageHas(s, (m) => m.lockState === "open" || m.status === "live"));
    // Sin nada abierto: la primera fase con partidos por jugar que YA tienen equipos (no una fase futura toda «Por definir»).
    const upcoming = model.stages.find((s) => stageHas(s, (m) => m.status !== "finished" && m.status !== "completed" && !!m.teamA && !!m.teamB));
    return (live ?? upcoming ?? model.stages[model.stages.length - 1])?.id ?? null;
  });
  useEffect(() => {
    if (!model.stages.some((s) => s.id === stageId)) setStageId(model.stages[model.stages.length - 1]?.id ?? null);
  }, [model.stages, stageId]);

  const stage = model.stages.find((s) => s.id === stageId) ?? null;
  const qById = useMemo(() => new Map(questions.map((q) => [q.id, q])), [questions]);

  // Del partido a la pregunta: el pick del cuadro es el pick del tablero.
  const pickFromMatch = (m: BracketMatch, option: string) => {
    const q = m.questionId ? qById.get(m.questionId) : null;
    if (q) onPick(q, option);
  };

  const featured = questions.filter((q) => FEATURED_KINDS.has(q.kind));
  const inBracket = new Set(
    Object.values(model.matches).filter((m) => m.stageId === stageId && m.questionId).map((m) => m.questionId!),
  );
  const stageMatchIds = new Set(Object.values(model.matches).filter((m) => m.stageId === stageId).map((m) => m.id));
  // Preguntas de esta fase que NO tienen caja: marcador exacto, o partidos sin pregunta de ganador.
  const leftover = questions.filter((q) =>
    !FEATURED_KINDS.has(q.kind) && !inBracket.has(q.id) && (!q.match_id || stageMatchIds.has(q.match_id)));
  const groupQuestions = questions.filter((q) => !FEATURED_KINDS.has(q.kind) && q.match_id && stageMatchIds.has(q.match_id));

  return (
    <div className="space-y-5" data-view="bracket" data-format={model.format} id="cuadro">
      <BracketStageTabs stages={model.stages} selected={stageId} onSelect={setStageId} />

      {featured.length > 0 && (
        <section aria-label={t("Predicciones destacadas")}>
          <SectionTitle as="h2">{t("Predicción destacada")}</SectionTitle>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
            {featured.map((q) => (
              <PickQuestion key={q.id} q={q} mine={answers[q.id]} now={now} saving={saving === q.id}
                feedback={feedback?.questionId === q.id ? feedback : null}
                disabled={!canPick || (saving !== null && saving !== q.id)} readOnly={readOnly} featured
                onPick={(option) => onPick(q, option)} onExpire={onExpire} />
            ))}
          </div>
        </section>
      )}

      {stage?.bracket ? (
        <section aria-label={t("Cuadro · {name}", { name: td(stage.name) })}>
          <SectionTitle as="h2">
            {bracketStages.length > 1 || model.stages.length > 1 ? td(stage.name) : t("Cuadro de eliminatorias")}
            <span className="text-ink-faint"> ({stage.roundIds.length} {stage.roundIds.length === 1 ? t("ronda") : t("rondas")})</span>
          </SectionTitle>
          <TournamentBracket
            model={model}
            stageId={stageId}
            saving={saving}
            feedback={feedback}
            readOnly={readOnly || !canPick}
            onPick={pickFromMatch}
            onExpire={onExpire}
            forceMode={bracketMode}
            changedIds={changedIds}
          />
        </section>
      ) : stage ? (
        // Fase de grupos: la vista de liga de 24.2, con las preguntas de esta fase.
        groupQuestions.length > 0 ? (
          <PickemBoard questions={groupQuestions} answers={answers} now={now} saving={saving} feedback={feedback}
            canPick={canPick} readOnly={readOnly} showResolved={showResolved} onPick={onPick} onExpire={onExpire} />
        ) : (
          <Plate className="px-6 py-8 text-center">
            <p className="font-display text-h3 font-bold uppercase tracking-wide text-white">{t("Sin predicciones en esta fase")}</p>
          </Plate>
        )
      ) : null}

      {stage?.bracket && leftover.length > 0 && (
        <section aria-label={t("Más predicciones")}>
          <SectionTitle as="h2">{t("Más predicciones")} <span className="text-ink-faint">({leftover.length})</span></SectionTitle>
          <PickemBoard questions={leftover} answers={answers} now={now} saving={saving} feedback={feedback}
            canPick={canPick} readOnly={readOnly} showResolved={showResolved} onPick={onPick} onExpire={onExpire} />
        </section>
      )}
    </div>
  );
}
