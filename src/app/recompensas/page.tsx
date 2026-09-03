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

const fmt = (s: string) =>
  new Date(s).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function RecompensasPage() {
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
      setError(e instanceof Error ? e.message : "No se pudieron cargar tus recompensas");
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
        <NeedsAccount what="Tus recompensas" />
      </section>
    );
  }

  return (
    <section className="animate-rise">
      <Header />

      {loading ? (
        <Loading label="Cargando recompensas" />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : (
        <div className="space-y-8">
          {/* ── Última recompensa ── */}
          {latest ? (
            (() => {
              const d = describeLedger(latest.reason, latest.ref);
              return (
                <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/5 p-6">
                  <p className="text-[10px] uppercase tracking-widest text-emerald-300/70">
                    Última recompensa
                  </p>
                  <h2 className="mt-1 font-display text-2xl font-bold uppercase tracking-wide text-white">
                    {d.label}
                  </h2>
                  {d.pickemEventId && titles[d.pickemEventId] && (
                    <p className="mt-1 text-sm text-white/55">{titles[d.pickemEventId]}</p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {latest.delta > 0 && (
                      <Chip>🪙 {formatCredits(latest.delta)} créditos</Chip>
                    )}
                    {d.tier?.reward.xp ? <Chip>{d.tier.reward.xp} XP</Chip> : null}
                    {d.tier?.reward.tokens ? <Chip>🎟️ {d.tier.reward.tokens}</Chip> : null}
                    {d.tier?.reward.packId ? (
                      <Chip>{d.tier.reward.packCount ?? 1} × {packLabel(d.tier.reward.packId)}</Chip>
                    ) : null}
                  </div>
                  <p className="mt-3 text-xs text-white/40">{fmt(latest.created_at)}</p>
                </div>
              );
            })()
          ) : (
            <EmptyState
              icon="🎁"
              title="Todavía no tienes recompensas"
              hint="Haz tus predicciones en un torneo: al corregirse, las recompensas llegan solas a tu cuenta."
              action={{ href: "/pickems", label: "Ir a Pick'ems" }}
            />
          )}

          {/* ── Detalle completo de la última recompensa de Pick'ems ── */}
          {detail && (
            <div>
              <h2 className="mb-3 font-display text-xl font-bold uppercase tracking-wide text-white">
                Cómo la conseguiste
              </h2>
              <div className="rounded-2xl border border-white/10 bg-base-700/30 p-5">
                <PickemResultBody data={detail} />
              </div>
            </div>
          )}

          {/* ── Rango ──
              Solo cuando no hay desglose: el desglose ya cuenta el rango, con el salto
              de antes y después, y repetirlo dejaba dos bloques «Tu rango» seguidos. */}
          {profile && !detail && (
            <div>
              <h2 className="mb-3 font-display text-xl font-bold uppercase tracking-wide text-white">
                Tu rango
              </h2>
              <RankBadge
                points={profile.points ?? 0}
                action={{ href: "/ranking", label: "Clasificación" }}
              />
            </div>
          )}

          {/* ── Resumen ── */}
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Recompensas obtenidas" value={String(rewards.length)} />
            <Stat label="Créditos ganados" value={`🪙 ${formatCredits(totalCredits)}`} tone="gold" />
            <Stat
              label="Sobres sin abrir"
              value={String(packTotal)}
              tone={packTotal > 0 ? "cyan" : undefined}
              action={packTotal > 0 ? { href: "/inventario", label: "Abrir" } : undefined}
            />
          </div>

          {/* ── Escalones ── */}
          <div>
            <h2 className="mb-3 font-display text-xl font-bold uppercase tracking-wide text-white">
              Escalones de recompensa
            </h2>
            <p className="mb-3 max-w-2xl text-sm text-white/50">
              En cada torneo se concede el escalón más alto que alcances con tus puntos de Pick&apos;ems.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {REWARD_TIERS.map((t) => (
                <div key={t.id} className="rounded-2xl border border-white/10 bg-base-700/40 p-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="font-display text-sm font-bold uppercase tracking-wide text-white">
                      {t.label}
                    </p>
                    <span className="shrink-0 text-[10px] uppercase tracking-widest text-white/40">
                      {plural(t.minPoints, "pt", "pts")}
                    </span>
                  </div>
                  <ul className="mt-2 space-y-0.5 text-xs text-white/55">
                    {t.reward.credits ? <li>🪙 {formatCredits(t.reward.credits)} créditos</li> : null}
                    {t.reward.xp ? <li>{t.reward.xp} XP</li> : null}
                    {t.reward.tokens ? <li>🎟️ {t.reward.tokens} tokens</li> : null}
                    {t.reward.packId ? (
                      <li>{t.reward.packCount ?? 1} × {packLabel(t.reward.packId)}</li>
                    ) : null}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          {/* ── Historial ── */}
          <div>
            <h2 className="mb-3 font-display text-xl font-bold uppercase tracking-wide text-white">
              Historial de movimientos
            </h2>
            {ledger.length === 0 ? (
              <EmptyState icon="📜" title="Sin movimientos todavía" />
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-white/10">
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="bg-base-800/60 text-left text-[10px] uppercase tracking-widest text-white/40">
                      <th className="px-4 py-2.5 font-medium">Concepto</th>
                      <th className="px-4 py-2.5 font-medium">Fecha</th>
                      <th className="px-4 py-2.5 text-right font-medium">Importe</th>
                      <th className="px-4 py-2.5 text-right font-medium">Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.map((r) => {
                      const d = describeLedger(r.reason, r.ref);
                      return (
                        <tr key={r.id} className="border-t border-white/5">
                          <td className="px-4 py-2.5">
                            <span className="text-white/85">{d.label}</span>
                            {d.pickemEventId && titles[d.pickemEventId] && (
                              <span className="block text-[11px] text-white/40">
                                {titles[d.pickemEventId]}
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
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function Header() {
  return (
    <header className="mb-6">
      <h1 className="font-display text-3xl font-bold uppercase tracking-wide text-white">
        Recompensas
      </h1>
      <p className="mt-1 text-white/50">
        Todo lo que has ganado compitiendo, con su recibo.
      </p>
    </header>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 font-display text-xs text-white/80">
      {children}
    </span>
  );
}

function Stat({
  label, value, tone, action,
}: {
  label: string;
  value: string;
  tone?: "gold" | "cyan";
  action?: { href: string; label: string };
}) {
  return (
    <div className={cn("rounded-2xl border p-5",
      tone === "gold" ? "border-drl-gold/25 bg-drl-gold/5"
      : tone === "cyan" ? "border-drl-cyan/25 bg-drl-cyan/5"
      : "border-white/10 bg-base-700/40")}>
      <p className="text-[10px] uppercase tracking-widest text-white/40">{label}</p>
      <p className={cn("mt-1 font-display text-2xl font-bold",
        tone === "gold" ? "text-drl-gold" : tone === "cyan" ? "text-drl-cyan" : "text-white")}>
        {value}
      </p>
      {action && (
        <Link href={action.href} className="nx-action mt-2">
          {action.label} →
        </Link>
      )}
    </div>
  );
}
