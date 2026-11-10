"use client";

/**
 * EN DIRECTO · SIGUIENTE PARTIDO (Fase 24.5) — la MISMA caja del cuadro, con marco de evento.
 *
 * No hay una segunda implementación del partido ni de la predicción: se reutiliza
 * `BracketMatchCard` (equipos, marcador real, estado, tu pick, botones que llaman al mismo
 * `pick` del hook). Aquí solo se añade el marco: «EN DIRECTO» solo si el backend lo dice, o
 * «SIGUIENTE PARTIDO» con la cuenta atrás local y la urgencia (umbral en el dominio).
 */
import { Badge, StatusDot } from "@/components/ui/Badge";
import { cn } from "@/lib/format";
import { Countdown } from "../Countdown";
import { BracketMatchCard } from "../bracket/BracketMatch";
import type { PickFeedback } from "@/lib/usePickem";
import type { LiveMatch } from "@/domain/pickems/live";
import { isUrgent } from "@/domain/pickems/live";
import type { BracketMatch } from "@/domain/pickems/bracket";
import { ns, getIntlLocale } from "@/i18n/runtime";
import { roundText } from "@/lib/bracket/roundText";
import { useLocale } from "@/i18n/react";

const t = ns("pickems");

const fmtWhen = (iso: string | null): string => {
  if (!iso) return t("Sin fecha");
  const d = new Date(iso);
  return `${d.toLocaleTimeString(getIntlLocale(), { hour: "2-digit", minute: "2-digit" })} · ${d.toLocaleDateString(getIntlLocale(), { day: "numeric", month: "short" })}`;
};

export function LiveMatchCard({
  m, mode, now, saving, feedback, canPick, onPick, onExpire, highlight, id, className,
}: {
  m: LiveMatch;
  mode: "live" | "next";
  now: number;
  saving?: boolean;
  feedback?: PickFeedback | null;
  canPick: boolean;
  onPick?: (m: BracketMatch, option: string) => void;
  onExpire?: () => void;
  /** Acaba de cambiar en este refresco: brillo breve. */
  highlight?: boolean;
  id?: string;
  className?: string;
}) {
  useLocale();
  const urgent = mode === "next" && isUrgent(m.locksAt, now);
  const tone = mode === "live" ? "25,227,255" : urgent ? "255,211,92" : "255,255,255";
  return (
    <section
      id={id}
      aria-label={mode === "live" ? t("En directo: {v} contra {v2}", { v: m.teamA?.name ?? t("Por definir"), v2: m.teamB?.name ?? t("Por definir") }) : t("Siguiente partido")}
      data-live-mode={mode}
      className={cn("nx-clip relative", className)}
      style={{
        background: `linear-gradient(180deg, rgb(${tone} / 0.10), transparent 40%)`,
        boxShadow: `inset 0 0 0 1px rgb(${tone} / ${mode === "live" ? 0.45 : urgent ? 0.4 : 0.14})`,
      }}
    >
      <header className="flex flex-wrap items-center justify-between gap-2 px-3 pt-2.5 sm:px-4">
        <span className="flex items-center gap-2">
          {mode === "live"
            ? <Badge tone="key" dot pulse>{t("En directo")}</Badge>
            : <span className="flex items-center gap-1.5"><StatusDot tone="info" size={5} /><span className="nx-label !text-white">{t("Siguiente partido")}</span></span>}
          <span className="nx-label">{m.stageName ? `${m.stageName} · ` : ""}{roundText(m.roundLabel)}</span>
        </span>
        {mode === "live" ? (
          <span className="nx-label">{fmtWhen(m.startsAt)}</span>
        ) : m.lockState === "open" && m.locksAt ? (
          <span className={cn("nx-label", urgent && "!text-drl-gold")} data-urgent={urgent ? "true" : undefined}>
            <Countdown to={m.locksAt} onExpire={onExpire} prefix={urgent ? t("¡Cierra en") : t("Cierra en")} />
          </span>
        ) : (
          <span className="nx-label">{fmtWhen(m.startsAt)}</span>
        )}
      </header>
      <div className="p-2.5 sm:p-3">
        <BracketMatchCard
          m={m}
          roundLabel={m.roundLabel}
          compact
          saving={saving}
          feedback={feedback}
          readOnly={!canPick}
          onPick={onPick}
          onExpire={onExpire}
          highlight={highlight}
        />
      </div>
    </section>
  );
}
