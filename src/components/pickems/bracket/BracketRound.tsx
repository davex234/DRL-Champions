"use client";

/**
 * UNA COLUMNA DEL CUADRO (Fase 24.3) — la ronda, con su encabezado y sus partidos.
 *
 * `section` + `h3`: un lector de pantalla recorre «Cuartos → 4 partidos», sin necesitar las
 * líneas. En escritorio los partidos se reparten a lo alto (`justify-around`) para que la
 * columna siguiente quede centrada respecto a la anterior: es lo que hace que se lea como un
 * embudo. En móvil (`compact`) es una lista vertical.
 */
import { cn } from "@/lib/format";
import { BracketMatchCard } from "./BracketMatch";
import type { PickFeedback } from "@/lib/usePickem";
import type { BracketColumn, BracketMatch } from "@/domain/pickems/bracket";
import { ns, td } from "@/i18n/runtime";
import { roundText } from "@/lib/bracket/roundText";
import { useLocale } from "@/i18n/react";

const t = ns("pickems");

export const roundAnchorId = (roundId: string) => `bracket-${roundId.replace(/[^a-z0-9]+/gi, "-")}`;

export function BracketRound({
  column, saving, feedback, readOnly, onPick, onExpire, compact, className, style, changedIds,
}: {
  column: BracketColumn;
  saving: string | null;
  feedback: PickFeedback | null;
  readOnly?: boolean;
  onPick?: (m: BracketMatch, option: string) => void;
  onExpire?: () => void;
  compact?: boolean;
  className?: string;
  style?: React.CSSProperties;
  /** 24.5 · ids que acaban de cambiar en este refresco. */
  changedIds?: Set<string>;
}) {
  useLocale();
  const { round, matches } = column;
  return (
    <section
      id={roundAnchorId(round.id)}
      aria-label={roundText(round.label)}
      className={cn("flex shrink-0 flex-col", compact ? "w-full gap-3" : "w-[260px] gap-4 sm:w-[280px]", className)}
      style={style}
    >
      <h3 className="flex items-baseline gap-2">
        <span
          className="nx-clip-sm px-2.5 py-1 font-display text-[10px] font-bold uppercase tracking-[0.28em]"
          style={{
            color: round.side === "lower" ? "rgba(238,241,248,0.7)" : round.side === "grand" ? "var(--nx-gold)" : "var(--nx-cyan)",
            background: "rgba(6,8,14,0.85)",
            boxShadow: `inset 0 0 0 1px ${round.side === "grand" ? "rgba(255,211,92,0.4)" : round.side === "lower" ? "rgba(255,255,255,0.18)" : "rgba(25,227,255,0.35)"}`,
          }}
        >
          {roundText(round.label)}
        </span>
        {round.group && <span className="nx-label" style={{ color: "var(--nx-gold)" }}>{t("Grupo")} {td(round.group)}</span>}
        <span className="nx-label">{matches.length} {matches.length === 1 ? t("partido") : t("partidos")}</span>
      </h3>
      <div className={cn("flex flex-1 flex-col gap-4", !compact && "justify-around")}>
        {matches.map((m) => (
          <BracketMatchCard
            key={m.id}
            m={m}
            roundLabel={round.label}
            saving={saving !== null && saving === m.questionId}
            feedback={feedback && feedback.questionId === m.questionId ? feedback : null}
            readOnly={readOnly}
            onPick={onPick}
            onExpire={onExpire}
            compact={compact}
            highlight={changedIds?.has(m.id)}
          />
        ))}
      </div>
    </section>
  );
}
