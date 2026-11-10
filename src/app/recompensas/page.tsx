"use client";

/**
 * RECOMPENSAS — qué has ganado y qué te falta.
 *
 * La fuente es el libro mayor real (`credit_transactions`): cada recompensa
 * concedida por el servidor deja ahí su asiento con una clave de idempotencia.
 * No hay una segunda tabla de "recompensas" que pudiera desincronizarse — lo que
 * se ve aquí es exactamente lo que se cobró.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import {
  fetchLedger, fetchPickemTitles, fetchMyPacks,
  fetchPickemQuestions, fetchMyAnswers, fetchMyScore,
  type LedgerRow,
} from "@/lib/game/client";
import { describeLedger, isReward, packLabel } from "@/domain/pickems/ledger";
import { REWARD_TIERS } from "@/domain/pickems/rewards";
import { RankBadge } from "@/components/progression/RankBadge";
import { PickemResultBody, type PickemResultData } from "@/components/pickems/PickemResult";
import { Loading, ErrorState, EmptyState, NeedsAccount } from "@/components/ui/States";
import { formatCredits, plural, cn } from "@/lib/format";
import { Plate, Piece, Recessed } from "@/components/ui/Surface";
import { Readout } from "@/components/ui/Readout";
import { Badge } from "@/components/ui/Badge";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { ns, td as i18nTd, getIntlLocale } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const i18nT = ns("recompensas");

const fmt = (s: string) =>
  new Date(s).toLocaleString(getIntlLocale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function RecompensasPage() {
  useLocale();
  const configured = isSupabaseConfigured();
  const { user, profile } = useAuth();

  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [packs, setPacks] = useState<Record<string, number>>({});
  const [detail, setDetail] = useState<PickemResultData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const rows = await fetchLedger(100);
      setLedger(rows);

      const ids = [...new Set(rows
        .map((r) => describeLedger(r.reason, r.ref).pickemEventId)
        .filter((v): v is string => !!v))];
      const [t, p] = await Promise.all([fetchPickemTitles(ids), fetchMyPacks()]);
      setTitles(t); setPacks(p);

      /*
       * Desglose completo de la ÚLTIMA recompensa de Pick'ems. Es el mismo componente
       * que enseña el aviso al corregirse el torneo, con los mismos datos: quien no vio
       * el aviso —o quiere repasarlo— encuentra aquí exactamente lo mismo, y no dos
       * versiones distintas de la misma historia.
       */
      const lastPickem = rows
        .map((r) => ({ row: r, d: describeLedger(r.reason, r.ref) }))
        .find((x) => x.d.kind === "reward" && x.d.pickemEventId);

      if (lastPickem?.d.pickemEventId) {
        const id = lastPickem.d.pickemEventId;
        const [qs, mine, sc] = await Promise.all([
          fetchPickemQuestions(id), fetchMyAnswers(id), fetchMyScore(id),
        ]);
        setDetail({
          eventName: t[id] ?? "Pick'ems",
          questions: qs,
          answers: mine,
          score: sc,
          reward: lastPickem.row,
          totalPoints: profile?.points ?? sc?.points ?? 0,
        });
      } else {
        setDetail(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : i18nT("No se pudieron cargar tus recompensas"));
    } finally {
      setLoading(false);
    }
  }, [profile?.points]);

  useEffect(() => { if (configured && user) load(); else setLoading(false); }, [configured, user, load]);

  const rewards = useMemo(() => ledger.filter((r) => isReward(r.reason)), [ledger]);
  const latest = rewards[0] ?? null;
  const totalCredits = useMemo(
    () => rewards.reduce((s, r) => s + Math.max(0, r.delta), 0), [rewards]);
  const packTotal = useMemo(
    () => Object.values(packs).reduce((s, n) => s + n, 0), [packs]);

  if (!configured || !user) {
    return (
      <section className="animate-rise">
        <Header />
        <NeedsAccount what={i18nT("Tus recompensas")} />
      </section>
    );
  }

  return (
    <section className="animate-rise">
      <Header />

      {loading ? (
        <Loading label={i18nT("Cargando recompensas")} />
      ) : error ? (
        <ErrorState message={i18nTd(error)} onRetry={load} />
      ) : (
        <div className="space-y-8">
          {/* ── Última recompensa ── */}
          {latest ? (
            (() => {
              const d = describeLedger(latest.reason, latest.ref);
              return (
                <Piece tone="success" className="p-6">
                  <p className="text-[10px] uppercase tracking-widest text-emerald-300/70">
                    {i18nT("Última recompensa")}
                  </p>
                  <h2 className="mt-1 font-display text-2xl font-bold uppercase tracking-wide text-white">
                    {i18nTd(d.label)}
                  </h2>
                  {d.pickemEventId && titles[d.pickemEventId] && (
                    <p className="mt-1 text-sm text-white/55">{i18nTd(titles[d.pickemEventId])}</p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {latest.delta > 0 && (
                      <Chip>🪙 {formatCredits(latest.delta)} {i18nT("créditos")}</Chip>
                    )}
                    {d.tier?.reward.xp ? <Chip>{d.tier.reward.xp} {i18nT("XP")}</Chip> : null}
                    {d.tier?.reward.packId ? (
                      <Chip>{d.tier.reward.packCount ?? 1} × {packLabel(d.tier.reward.packId)}</Chip>
                    ) : null}
                  </div>
                  <p className="mt-3 text-xs text-white/40">{fmt(latest.created_at)}</p>
                </Piece>
              );
            })()
          ) : (
            <EmptyState
              icon="🎁"
              title={i18nT("Todavía no tienes recompensas")}
              hint={i18nT("Haz tus predicciones en un torneo: al corregirse, las recompensas llegan solas a tu cuenta.")}
              action={{ href: "/pickems", label: i18nT("Ir a Pick'ems") }}
            />
          )}

          {/* ── Detalle completo de la última recompensa de Pick'ems ── */}
          {detail && (
            <div>
              <SectionTitle as="h2" className="!mb-3 [&>*]:!text-[15px] [&>*]:!text-white">
                {i18nT("Cómo la conseguiste")}
              </SectionTitle>
              <Plate className="p-5">
                <PickemResultBody data={detail} />
              </Plate>
            </div>
          )}

          {/* ── Rango ──
              Solo cuando no hay desglose: el desglose ya cuenta el rango, con el salto
              de antes y después, y repetirlo dejaba dos bloques «Tu rango» seguidos. */}
          {profile && !detail && (
            <div>
              <SectionTitle as="h2" className="!mb-3 [&>*]:!text-[15px] [&>*]:!text-white">
                {i18nT("Tu rango")}
              </SectionTitle>
              <RankBadge
                points={profile.points ?? 0}
                action={{ href: "/ranking", label: i18nT("Clasificación") }}
              />
            </div>
          )}

          {/* ── Resumen ── */}
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label={i18nT("Recompensas obtenidas")} value={String(rewards.length)} />
            <Stat label={i18nT("Créditos ganados")} value={`🪙 ${formatCredits(totalCredits)}`} tone="gold" />
            <Stat
              label={i18nT("Sobres sin abrir")}
              value={String(packTotal)}
              tone={packTotal > 0 ? "cyan" : undefined}
              action={packTotal > 0 ? { href: "/inventario", label: i18nT("Abrir") } : undefined}
            />
          </div>

          {/* ── Escalones ── */}
          <div>
            <h2 className="mb-3 font-display text-xl font-bold uppercase tracking-wide text-white">
              {i18nT("Escalones de recompensa")}
            </h2>
            <p className="mb-3 max-w-2xl text-sm text-white/50">
              {i18nT("En cada torneo se concede el escalón más alto que alcances con tus puntos de Pick'ems.")}
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {REWARD_TIERS.map((t) => (
                <Plate key={t.id} className="p-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="font-display text-sm font-bold uppercase tracking-wide text-white">
                      {i18nTd(t.label)}
                    </p>
                    <span className="shrink-0 text-[10px] uppercase tracking-widest text-white/40">
                      {plural(t.minPoints, "pt", "pts")}
                    </span>
                  </div>
                  <ul className="mt-2 space-y-0.5 text-xs text-white/55">
                    {t.reward.credits ? <li>🪙 {formatCredits(t.reward.credits)} {i18nT("créditos")}</li> : null}
                    {t.reward.xp ? <li>{t.reward.xp} {i18nT("XP")}</li> : null}
                    {t.reward.packId ? (
                      <li>{t.reward.packCount ?? 1} × {packLabel(t.reward.packId)}</li>
                    ) : null}
                  </ul>
                </Plate>
              ))}
            </div>
          </div>

          {/* ── Historial ── */}
          <div>
            <h2 className="mb-3 font-display text-xl font-bold uppercase tracking-wide text-white">
              {i18nT("Historial de movimientos")}
            </h2>
            {ledger.length === 0 ? (
              <EmptyState icon="📜" title={i18nT("Sin movimientos todavía")} />
            ) : (
              <Recessed depth="sm" className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="bg-base-800/60 text-left text-[10px] uppercase tracking-widest text-white/40">
                      <th className="px-4 py-2.5 font-medium">{i18nT("Concepto")}</th>
                      <th className="px-4 py-2.5 font-medium">{i18nT("Fecha")}</th>
                      <th className="px-4 py-2.5 text-right font-medium">{i18nT("Importe")}</th>
                      <th className="px-4 py-2.5 text-right font-medium">{i18nT("Saldo")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.map((r) => {
                      const d = describeLedger(r.reason, r.ref);
                      return (
                        <tr key={r.id} className="border-t border-white/5">
                          <td className="px-4 py-2.5">
                            <span className="text-white/85">{i18nTd(d.label)}</span>
                            {d.pickemEventId && titles[d.pickemEventId] && (
                              <span className="block text-[11px] text-white/40">
                                {i18nTd(titles[d.pickemEventId])}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-white/45">{fmt(r.created_at)}</td>
                          <td className={cn("px-4 py-2.5 text-right font-display tabular-nums",
                            r.delta >= 0 ? "text-emerald-300" : "text-drl")}>
                            {r.delta >= 0 ? "+" : ""}{formatCredits(r.delta)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-display tabular-nums text-white/50">
                            {formatCredits(r.balance_after)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Recessed>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function Header() {
  useLocale();
  return (
    <header className="mb-6">
      <h1 className="font-display text-[clamp(28px,5vw,44px)] font-bold uppercase leading-none text-white">
        {i18nT("Recompensas")}
      </h1>
      <p className="mt-1 text-white/50">
        {i18nT("Todo lo que has ganado compitiendo, con su recibo.")}
      </p>
    </header>
  );
}

/**
 * FASE 11 · Era una CÁPSULA (`rounded-full`). El sistema tiene su pieza para decir un dato
 * corto y no es una píldora: es la insignia con el chaflán de la casa.
 */
function Chip({ children }: { children: React.ReactNode }) {
  return <Badge tone="muted">{children}</Badge>;
}

function Stat({
  label, value, tone, action,
}: {
  label: string;
  value: string;
  tone?: "gold" | "cyan";
  action?: { href: string; label: string };
}) {
  useLocale();
  /*
   * FASE 11 · La cifra pasa a `Readout`, la primitiva de la cifra competitiva: misma familia
   * condensada, cifras tabulares y su etiqueta en versalitas encima. Y el enlace de acción
   * llega a 44 px de objetivo táctil, que es lo que le faltaba.
   */
  return (
    <Plate tone={tone === "gold" ? "gold" : tone === "cyan" ? "cyan" : "neutral"} className="p-5">
      <Readout
        size="md"
        label={i18nTd(label)}
        value={value}
        tone={tone === "gold" ? "var(--nx-gold)" : tone === "cyan" ? "var(--nx-cyan)" : undefined}
      />
      {action && (
        <Link href={action.href} className="nx-action mt-1">
          {i18nTd(action.label)} →
        </Link>
      )}
    </Plate>
  );
}
