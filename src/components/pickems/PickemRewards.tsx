"use client";

/**
 * RECOMPENSAS DEL TORNEO (Fase 24.2) — lo que el backend va a conceder, y nada más.
 *
 * ────────────────────────── DE DÓNDE SALE ──────────────────────────
 *
 *   · Los escalones: `REWARD_TIERS` (`domain/pickems/rewards`), la MISMA tabla que lee
 *     `scorePickemEvent` para pagar. No hay una lista paralela en la UI.
 *   · Lo alcanzado: `pickem_scores.points`, que escribe el corrector.
 *   · Lo CONSEGUIDO: el asiento real de `credit_transactions` con `ref = pickem:<id>:<tier>`.
 *     Una recompensa solo se dice conseguida si el libro mayor la tiene.
 *
 * ────────────────────────── LO QUE NO HAY ──────────────────────────
 *
 * No hay botón «Reclamar». `app_grant_reward` concede sola al corregir el torneo, con clave
 * de idempotencia por escalón; un segundo flujo de reclamación sería un segundo sitio donde
 * duplicar. Y no se promete nada: un escalón alcanzado pero no pagado se dice «alcanzado ·
 * se abona al corregir», que es exactamente lo que va a pasar.
 */
import { REWARD_TIERS, tierForPoints, type RewardTier } from "@/domain/pickems/rewards";
import { describeLedger, packLabel } from "@/domain/pickems/ledger";
import type { Reward } from "@/domain/events/types";
import type { LedgerRow, MyScore } from "@/lib/game/client";
import { Plate } from "@/components/ui/Surface";
import { Badge } from "@/components/ui/Badge";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { formatCredits, cn } from "@/lib/format";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const tr = ns("pickems");

/** Resume una recompensa en una línea legible. */
export function describeReward(r: Reward): string {
  const parts: string[] = [];
  if (r.credits) parts.push(td("{v} créditos", { v: formatCredits(r.credits) }));
  if (r.xp) parts.push(`${r.xp} XP`);
  if (r.packId) parts.push(`${r.packCount ?? 1} × ${td(packLabel(r.packId))}`);
  return parts.join(" · ") || "—";
}

export type TierStatus = "conseguida" | "alcanzada" | "pendiente";

/**
 * Estado de cada escalón para este usuario. Función pura, probada aparte.
 *
 * «Conseguida» exige el asiento del libro mayor del escalón pagado (o de uno superior: se
 * paga solo el más alto, y los inferiores quedan cubiertos). «Alcanzada» son los puntos sin
 * el asiento todavía. Lo demás, pendiente, con lo que falta.
 */
export function tierStatuses(
  score: MyScore | null, reward: LedgerRow | null,
): { tier: RewardTier; status: TierStatus; missing: number }[] {
  const points = score?.points ?? 0;
  const paidTier = reward ? describeLedger(reward.reason, reward.ref).tier : null;
  const paidIdx = paidTier ? REWARD_TIERS.findIndex((t) => t.id === paidTier.id) : -1;
  return REWARD_TIERS.map((tier, i) => {
    const reached = points >= tier.minPoints;
    const status: TierStatus = paidIdx >= i ? "conseguida" : reached ? "alcanzada" : "pendiente";
    return { tier, status, missing: Math.max(0, tier.minPoints - points) };
  });
}

const STATUS_LABEL: Record<TierStatus, string> = {
  conseguida: "Conseguida", alcanzada: "Alcanzada", pendiente: "Pendiente",
};

export function PickemRewards({
  score, reward, className,
}: {
  score: MyScore | null;
  reward: LedgerRow | null;
  className?: string;
}) {
  useLocale();
  const rows = tierStatuses(score, reward);
  const current = tierForPoints(score?.points ?? 0);

  return (
    <section className={className} aria-label={tr("Recompensas del torneo")}>
      <SectionTitle as="h2">{tr("Recompensas del torneo")}</SectionTitle>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {rows.map(({ tier, status, missing }) => {
          const done = status === "conseguida";
          const reached = status !== "pendiente";
          return (
            <Plate
              key={tier.id}
              tone={done ? "gold" : reached ? "success" : "neutral"}
              className={cn("px-3 py-2.5 transition duration-fast motion-reduce:transition-none", done && "nx-reward-glow")}
              data-status={status}
            >
              <div className="flex items-center justify-between gap-2">
                <b className={cn("truncate font-display text-[13px] font-bold uppercase tracking-wide",
                  done ? "text-drl-gold" : reached ? "text-ok" : "text-ink-secondary")}>
                  {td(tier.label)}
                </b>
                {done
                  ? <Badge tone="gold" solid>{td(STATUS_LABEL.conseguida)}</Badge>
                  : reached
                    ? <Badge tone="ok" dot>{td(STATUS_LABEL.alcanzada)}</Badge>
                    : <span className="nx-label shrink-0">{tier.minPoints} {tr("pts")}</span>}
              </div>
              <p className="mt-1.5 text-caption text-ink-muted">{describeReward(tier.reward)}</p>
              <p className="mt-1 nx-label">
                {done
                  ? tr("Ya en tu cuenta")
                  : reached
                    ? tr("Se abona al corregir el torneo")
                    : tr("Te faltan {n, plural, one {# punto} other {# puntos}}", { n: missing })}
              </p>
            </Plate>
          );
        })}
      </div>
      <p className="mt-2.5 text-caption text-ink-faint">
        {current
          ? tr("Se concede el escalón más alto alcanzado (ahora: {escalon}), de forma automática al corregirse el torneo. No hay nada que reclamar.", { escalon: td(current.label) })
          : tr("Se concede el escalón más alto alcanzado, de forma automática al corregirse el torneo. No hay nada que reclamar.")}
      </p>
    </section>
  );
}
