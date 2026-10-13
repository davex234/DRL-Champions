"use client";

/**
 * RESULTADOS RECIENTES (Fase 24.2) — qué predije, qué salió, qué sumé.
 *
 * Presentación pura. Cada fila lee tres cosas que ya vienen resueltas del servidor:
 *   · mi respuesta ........... `pickem_answers.option_key`
 *   · el resultado ........... `pickem_questions_public.correct_option` (solo tras el cierre)
 *   · acierto y puntos ....... `pickem_answers.is_correct` / `points_award` (los escribe el corrector)
 *
 * «ACERTADA +100» y «FALLADA +0» se dicen con palabra, marca e insignia; el color es el
 * tercer refuerzo. No se compara nada aquí que el corrector no haya comparado ya; cuando
 * todavía no ha pasado, la cifra se marca como pendiente en vez de inventarse.
 */
import { Plate } from "@/components/ui/Surface";
import { Badge } from "@/components/ui/Badge";
import { TeamLogo } from "@/components/cards/layers/TeamLogo";
import { cn } from "@/lib/format";
import type { PickemQuestion } from "@/lib/game/client";
import { stateOf, awardedPoints, type AnswerMap } from "@/domain/pickems/progress";
import { KIND_LABEL } from "./PickQuestion";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("pickems");

const labelOf = (q: PickemQuestion, key: string | null | undefined) =>
  q.options.find((o) => o.key === key)?.label ?? key ?? "—";

function Glifo({ tipo }: { tipo: "acierto" | "fallo" | "neutro" }) {
  const tone = tipo === "acierto" ? "var(--nx-ok)" : tipo === "fallo" ? "var(--nx-bad)" : "var(--nx-ink-faint)";
  return (
    <span
      aria-hidden
      className="grid h-7 w-7 shrink-0 place-items-center rounded-full"
      style={{ boxShadow: `inset 0 0 0 1.5px ${tone}`, background: `${tone}1f` }}
    >
      <svg viewBox="0 0 12 12" className="h-3.5 w-3.5" fill="none" stroke={tone} strokeWidth="2" strokeLinecap="round">
        {tipo === "acierto" && <path d="M2 6.4 4.8 9.2 10 3.4" />}
        {tipo === "fallo" && <><path d="M3 3l6 6" /><path d="M9 3l-6 6" /></>}
        {tipo === "neutro" && <path d="M3 6h6" />}
      </svg>
    </span>
  );
}

export function PickemResults({
  questions, answers, limit, className,
}: {
  /** Preguntas YA corregidas, en el orden en que se quieren enseñar. */
  questions: PickemQuestion[];
  answers: AnswerMap;
  limit?: number;
  className?: string;
}) {
  useLocale();
  const rows = limit ? questions.slice(0, limit) : questions;
  if (rows.length === 0) return null;

  return (
    <ol className={cn("space-y-2", className)} aria-label={t("Resultados recientes")}>
      {rows.map((q) => {
        const mine = answers[q.id];
        const estado = stateOf(q, mine);
        const awarded = awardedPoints(mine);
        const hit = estado === "acertada";
        const miss = estado === "fallada";
        const withLogo = q.kind !== "match_score";
        const pts = hit ? (awarded ?? q.points) : 0;
        return (
          <li key={q.id}>
            <Plate
              tone={hit ? "success" : miss ? "primary" : "neutral"}
              className="flex items-center gap-3 px-3 py-2.5 sm:px-4"
              data-state={estado}
            >
              <Glifo tipo={hit ? "acierto" : miss ? "fallo" : "neutro"} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-[13px] font-bold uppercase tracking-wide text-white">
                  <span className="text-ink-faint">{td(KIND_LABEL[q.kind]) ?? td(q.kind)} · </span>{td(q.prompt)}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-caption">
                  <span className="flex items-center gap-1.5 text-ink-muted">
                    {t("Tu predicción:")}
                    {mine ? (
                      <b className="flex items-center gap-1 text-white">
                        {withLogo && <TeamLogo team={labelOf(q, mine.option)} size={16} />}
                        {labelOf(q, mine.option)}
                      </b>
                    ) : <b className="text-ink-faint">{t("no participaste")}</b>}
                  </span>
                  <span className="flex items-center gap-1.5 text-ink-muted">
                    {t("Resultado:")}
                    <b className="flex items-center gap-1 text-white">
                      {withLogo && <TeamLogo team={labelOf(q, q.correct_option)} size={16} />}
                      {labelOf(q, q.correct_option)}
                    </b>
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                {hit
                  ? <Badge tone="ok" solid>{t("Acertada")}</Badge>
                  : miss
                    ? <Badge tone="bad" dot>{t("Fallada")}</Badge>
                    : <Badge tone="muted" dot>{t("No jugada")}</Badge>}
                <span
                  className={cn("nx-readout text-[16px] tabular-nums", hit ? "text-ok" : "text-ink-faint")}
                  aria-label={mine ? t("{pts} puntos", { pts }) : t("sin puntos")}
                >
                  +{pts}
                  {hit && awarded === null && <span className="nx-label ml-1">{t("pend.")}</span>}
                </span>
              </div>
            </Plate>
          </li>
        );
      })}
    </ol>
  );
}
