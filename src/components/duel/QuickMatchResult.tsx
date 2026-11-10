"use client";

/**
 * RESULTADO DE PARTIDA RÁPIDA — adaptador de la pantalla única de resultados (`result/DuelResult`).
 *
 * Solo traduce el modo a datos: JUGAR OTRA = otra partida rápida por el flujo canónico de la página (`rematch()`, con su
 * cerrojo `inFlight`), VER PARTIDA = la repetición, VOLVER AL LOBBY = `/`. Las recompensas son las del RECIBO del servidor
 * (`result.rewards`); si no se concedió nada, no hay bloque. Aquí no se paga, no se reclama y no se lee progreso.
 */
import { DuelResult } from "./result/DuelResult";
import { MAIN_MENU_HREF } from "@/lib/duel/quickResult";
import { dailyCapReached, resultEarnings, resultKind } from "@/lib/duel/resultSummary";
import { DailyRewardSlot } from "./DailyRewardSlot";
import type { DuelMatchView } from "@/lib/duel/types";
import { ns } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("duel");

export function QuickMatchResult({ view, onContinue }: {
  view: DuelMatchView;
  /** JUGAR OTRA: otra partida rápida (la página la crea por su camino canónico, con su propio cerrojo). */
  onContinue: () => void;
}) {
  useLocale();
  const r = view.result;
  const kind = resultKind(r);
  if (!r || !kind) return null;
  return (
    <DuelResult
      mode="QUICK"
      kind={kind}
      score={{ you: r.scoreYou, rival: r.scoreRival }}
      earnings={resultEarnings(r)}
      footnote={dailyCapReached(r) ? <DailyRewardSlot receipt={r.rewards} className="mt-5" /> : null}
      primary={{ label: t("Jugar otra"), onClick: onContinue, once: true, testId: "result-play-again" }}
      replayHref={`/duelos/replay/${view.matchId}`}
      lobby={{ label: t("Volver al lobby"), href: MAIN_MENU_HREF }}
    />
  );
}
