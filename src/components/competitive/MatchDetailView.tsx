"use client";

/**
 * DETALLE DE PARTIDA RANKED (Fase 28). Solo lo que la partida ya reveló: marcador, desenlace real
 * (con abandono/tiempo nombrados), asiento de rating (antes → después), los turnos con las cartas
 * y estadísticas enfrentadas (`TurnHistory` + `RoundStrip`), desempate si lo hubo y tu carta
 * destacada. La vista llega proyectada por el servidor (`projectMatchFor`): lo no jugado del
 * rival no está en los datos.
 */
import { playerHref } from "@/lib/player/href";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Readout } from "@/components/ui/Readout";
import { Plate, Stage } from "@/components/ui/Surface";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { DuelCard } from "@/components/duel/DuelCard";
import { TurnHistory } from "@/components/duel/TurnHistory";
import { FeaturedCardPanel, DecisionPanel, RoundStrip } from "@/components/duel/MatchSummary";
import { OUTCOME_LABEL } from "@/domain/pvpLadder/ladder";
import type { CompetitiveMatchDetail } from "@/server/services/competitive";
import { outcomeTone } from "./MatchHistoryList";
import { ns, td, getIntlLocale } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("competitive");

const fmt = (ms: number) => new Date(ms).toLocaleString(getIntlLocale(), { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

export function MatchDetailView({ detail }: { detail: CompetitiveMatchDetail }) {
  useLocale();
  const v = detail.view;
  const r = v.result;
  const tone = outcomeTone(detail.outcome);
  return (
    <div className="space-y-6" data-scene="match-detail" data-outcome={detail.outcome}>
      <Stage tone={tone === "ok" ? "success" : tone === "bad" ? "primary" : "gold"} grid className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="nx-label">{t("Ranked ·")} {fmt(detail.at)}</span>
            <h1 className="mt-1 font-display text-[clamp(28px,5vw,44px)] font-bold uppercase leading-none text-white">{td(OUTCOME_LABEL[detail.outcome])}</h1>
            <p className="mt-2 text-body text-ink-secondary">
              {t("vs")} <Link href={playerHref(detail.rival.userId)} className="nx-focus font-semibold text-white underline-offset-2 hover:underline"><span aria-hidden>{detail.rival.avatar} </span>{detail.rival.username}</Link>
              {detail.lifecycle !== "FINISHED" && <Badge tone="warn" className="ml-2">{detail.lifecycle === "ABANDONED" ? t("Abandono") : t("Tiempo agotado")}</Badge>}
            </p>
          </div>
          <div className="nx-readout flex items-center gap-4 text-[clamp(38px,8vw,64px)]">
            <span className="text-ok">{v.scoreYou}</span><span className="text-white/25">–</span><span className="text-drl">{v.scoreRival}</span>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-6" data-testid="match-rating">
          {detail.rating ? (
            <>
              <Readout size="sm" label={t("Rating antes")} value={detail.rating.oldRating} />
              <Readout size="sm" label={t("Cambio")} value={`${detail.rating.delta >= 0 ? "+" : ""}${detail.rating.delta}`} tone={detail.rating.delta >= 0 ? "var(--nx-ok)" : "var(--nx-danger, #ff2e63)"} />
              <Readout size="sm" label={t("Rating después")} value={detail.rating.newRating} tone="var(--nx-cyan)" />
              <Readout size="sm" label={t("Rating del rival")} value={detail.rating.opponentRating} />
            </>
          ) : (
            <span className="text-caption text-ink-muted">{t("Sin liquidar todavía: el rating llegará en cuanto el servidor cierre la partida.")}</span>
          )}
        </div>
        {r && <p className="mt-3 text-caption text-ink-secondary">{td(r.reason)}</p>}
        {/* Fase 33 · la repetición: solo participantes, con lo no jugado del rival redactado en servidor. */}
        <p className="mt-2"><Link href={`/duelos/replay/${detail.matchId}`} className="nx-focus nx-action inline-flex min-h-[44px] items-center" data-action="replay">{t("Ver la partida →")}</Link></p>
      </Stage>

      {r && <DecisionPanel result={r} />}
      <FeaturedCardPanel history={v.history} cards={[...v.yourUsed, ...v.yourHand]} />

      <section aria-label={t("Turno a turno")}>
        <SectionTitle>{t("Turno a turno")}</SectionTitle>
        <RoundStrip history={v.history} yours={[...v.yourUsed, ...v.yourHand]} theirs={v.rivalUsed} />
        <div className="mt-3"><TurnHistory turns={v.history} emptyLabel={t("No llegó a jugarse ningún turno.")} /></div>
      </section>

      <section aria-label={t("Cartas jugadas")} className="grid gap-4 sm:grid-cols-2">
        <Plate className="p-4">
          <span className="nx-label">{t("Tus cartas jugadas · {n}", { n: v.yourUsed.length })}</span>
          <div className="mt-2 flex flex-wrap gap-1.5">{v.yourUsed.map((c) => <DuelCard key={c.uid} card={c} size="xs" />)}</div>
        </Plate>
        <Plate className="p-4">
          <span className="nx-label">{t("Cartas jugadas por {nombre} · {n}", { nombre: detail.rival.username, n: v.rivalUsed.length })}</span>
          <div className="mt-2 flex flex-wrap gap-1.5">{v.rivalUsed.map((c) => <DuelCard key={c.uid} card={c} size="xs" />)}</div>
          {v.rivalRemaining > 0 && <p className="mt-2 text-caption text-ink-faint">{t("{n} cartas no llegaron a jugarse y siguen ocultas.", { n: v.rivalRemaining })}</p>}
        </Plate>
      </section>
    </div>
  );
}
