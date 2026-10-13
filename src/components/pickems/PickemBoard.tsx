"use client";

/**
 * EL TABLERO DE PREDICCIONES (Fase 24.2) — las preguntas, por lo que se puede hacer con ellas.
 *
 *   DESTACADA        ¿Quién será campeón?           (champion / advance)
 *   PENDIENTES       lo que requiere acción, en orden de cierre
 *   TUS ELECCIONES   abiertas y ya respondidas (se pueden cambiar)
 *   EN JUEGO         cerradas, esperando resultado
 *   CORREGIDAS       con resultado (opcional: la pantalla de Pick'ems las resume aparte)
 *
 * Ninguna pregunta se esconde; cada una está en exactamente un bloque. La agrupación es de
 * `domain/pickems/progress` (pura y probada): aquí solo se pinta.
 */
import { SectionTitle } from "@/components/ui/SectionTitle";
import { PickQuestion } from "./PickQuestion";
import type { PickemQuestion } from "@/lib/game/client";
import type { PickFeedback } from "@/lib/usePickem";
import { groupQuestions, type AnswerMap } from "@/domain/pickems/progress";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("pickems");

export const PENDING_ANCHOR_ID = "pickems-pendientes";

export function PickemBoard({
  questions, answers, now, saving, feedback, canPick, readOnly, showResolved = true, onPick, onExpire,
}: {
  questions: PickemQuestion[];
  answers: AnswerMap;
  now: number;
  saving: string | null;
  feedback: PickFeedback | null;
  /** Hay sesión y se puede elegir. */
  canPick: boolean;
  readOnly?: boolean;
  showResolved?: boolean;
  onPick: (q: PickemQuestion, option: string) => void;
  onExpire?: () => void;
}) {
  useLocale();
  const g = groupQuestions(questions, now);
  const pendientes = g.open.filter((q) => !answers[q.id]);
  const elegidas = g.open.filter((q) => !!answers[q.id]);

  const render = (q: PickemQuestion, featured = false) => (
    <PickQuestion
      key={q.id}
      q={q}
      mine={answers[q.id]}
      now={now}
      saving={saving === q.id}
      feedback={feedback?.questionId === q.id ? feedback : null}
      disabled={!canPick || (saving !== null && saving !== q.id)}
      readOnly={readOnly}
      featured={featured}
      onPick={(option) => onPick(q, option)}
      onExpire={onExpire}
    />
  );

  const bloques: { id?: string; titulo: string; lista: PickemQuestion[] }[] = [
    { id: PENDING_ANCHOR_ID, titulo: t("Pendientes"), lista: pendientes },
    { titulo: t("Tus elecciones"), lista: elegidas },
    { titulo: t("En juego"), lista: g.inPlay },
    ...(showResolved ? [{ titulo: t("Corregidas"), lista: g.resolved }] : []),
  ];

  return (
    <div className="space-y-5">
      {g.featured.length > 0 && (
        <section aria-label={t("Predicciones destacadas")}>
          <SectionTitle as="h2">{t("Predicción destacada")}</SectionTitle>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3">{g.featured.map((q) => render(q, true))}</div>
        </section>
      )}

      {bloques.map(({ id, titulo, lista }) =>
        lista.length === 0 ? null : (
          <section key={titulo} id={id} aria-label={td(titulo)} className="scroll-mt-24">
            <SectionTitle as="h2">
              {td(titulo)} <span className="text-ink-faint">({lista.length})</span>
            </SectionTitle>
            {/* `minmax(0,1fr)`: la pista no puede crecer por un nombre largo sin salto; la pieza encoge y trunca. */}
            <div className="grid grid-cols-[minmax(0,1fr)] gap-2.5">{lista.map((q) => render(q))}</div>
          </section>
        ),
      )}
    </div>
  );
}
