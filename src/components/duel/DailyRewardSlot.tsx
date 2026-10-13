/**
 * CORE GAME LOOP (2026-10-07) · EL CUPO DIARIO DE RECOMPENSAS, DICHO EN EL RESULTADO.
 *
 * El PvE paga como mucho `DAILY_DUEL_AWARD_CAP` partidas por día UTC (Fase 42, cupos atómicos). Hasta ahora nadie lo
 * decía: la partida 21 terminaba sin bloque de recompensas y sin explicación. Aquí se dice, con el dato que el
 * SERVIDOR guardó para ESTA partida (`result.rewards.daily`): qué cupo ocupó, o que llegó con el tope agotado.
 *
 * Neutral a propósito: un hecho, no una urgencia (ni cuenta atrás, ni «te quedan», ni insistir en volver).
 * Sin dato (`daily` ausente: Draft, PvP, partida antigua o lectura fallida) no se pinta nada: nunca se inventa.
 */
import type { MatchRewardReceipt } from "@/lib/duel/types";
import { cn } from "@/lib/format";
import { ns, td } from "@/i18n/runtime";

const tr = ns("duel");

export function dailyRewardText(daily: NonNullable<MatchRewardReceipt["daily"]>): { line: string; detail: string | null } {
  if (daily.slot === null) {
    return {
      line: tr("Tope diario alcanzado: {cap} partidas con recompensa", { cap: daily.cap }),
      detail: tr("Puedes seguir jugando. Las recompensas de partida vuelven cada día a las 00:00 UTC."),
    };
  }
  return { line: tr("Partida con recompensa {slot} de {cap} hoy", { slot: daily.slot, cap: daily.cap }), detail: null };
}

export function DailyRewardSlot({ receipt, className }: { receipt: MatchRewardReceipt | null | undefined; className?: string }) {
  const daily = receipt?.daily;
  if (!daily) return null;
  const t = dailyRewardText(daily);
  return (
    <p
      data-testid="daily-reward-slot"
      data-capped={daily.slot === null ? "true" : "false"}
      className={cn("mx-auto max-w-xl text-center text-[13px]", daily.slot === null ? "text-white/80" : "text-white/55", className)}
    >
      <span className="block">{td(t.line)}</span>
      {t.detail && <span className="mt-1 block text-[12px] text-white/55">{td(t.detail)}</span>}
    </p>
  );
}
