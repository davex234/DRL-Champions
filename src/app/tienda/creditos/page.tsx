"use client";

/**
 * TIENDA · DRL CREDITS (Fase 18.1; rediseño premium en la Fase 49.1).
 *
 * ────────────────────────── QUÉ ENSEÑA ──────────────────────────
 *
 * La moneda del juego como producto: héroe con su arte, el saldo REAL y los cinco paquetes, cada uno con su
 * propia imagen (más créditos = más monedas; lo fija `data/creditsArt.test.ts`). Las cantidades salen del
 * catálogo del servidor (`GET /api/game/credits`) o, sin sesión, del mismo catálogo en el cliente.
 *
 * ────────────────────────── LO QUE NO HACE ──────────────────────────
 *
 * No cobra ni concede. `PAYMENTS_ENABLED=false` y no hay pasarela: los botones dicen «Próximamente» y no
 * llaman a nada. Los precios en euros no están decididos: «€ · Por anunciar», sin precios tachados de
 * referencia. La compra de prueba del servidor (`sandboxPurchase`) solo existe fuera de producción y esta
 * pantalla no la ofrece. Y si el servidor no confirma `sandbox: true`, no se pinta el catálogo.
 */
import "../store.css";
import "./credits.css";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { fetchCredits, type CreditsView } from "@/lib/game/credits";
import { activeProducts, formatDelta, formatDRLC, KIND_LABEL } from "@/domain/economy/drlCredits";
import { PAYMENTS_ENABLED } from "@/config/monetization";
import { useGameStore } from "@/store/useGameStore";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { ErrorState, EmptyState } from "@/components/ui/States";
import { CreditsHero, CreditPackCard } from "@/components/credits/CreditsPieces";
import { packBadge } from "@/components/credits/creditsView";
import { creditsCss as css } from "@/components/credits/creditsClasses";
import { css as storeCss } from "@/components/store/storeClasses";
import { cn } from "@/lib/format";
import { ns, td as i18nTd, getIntlLocale } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const i18nT = ns("tienda");

const fmtDate = (s: string) =>
  new Date(s).toLocaleString(getIntlLocale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function CreditosPage() {
  return (
    <HydrationGate>
      <Credits />
    </HydrationGate>
  );
}

function Credits() {
  useLocale();
  const configured = isSupabaseConfigured();
  const { user } = useAuth();
  const online = configured && !!user;
  const localCredits = useGameStore((s) => s.credits);

  const [view, setView] = useState<CreditsView | null>(null);
  const [loading, setLoading] = useState(online);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setView(await fetchCredits());
    } catch (e) {
      setError(e instanceof Error ? e.message : i18nT("No se pudieron cargar tus DRL Credits"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (online) void load();
    else setLoading(false);
  }, [online, load]);

  /*
   * El servidor NO ha confirmado que esto no cobra. Antes que arriesgarse a enseñar una compra que quizá sí
   * cobra, la pantalla se cierra y lo dice (regla de la Fase 18.1, intacta).
   */
  if (online && view && view.sandbox !== true) {
    return (
      <ErrorState
        message={i18nT("El servidor no ha confirmado que esta tienda no cobre, así que no se muestra el catálogo.")}
        onRetry={() => void load()}
      />
    );
  }

  const products = view?.products?.length ? view.products : activeProducts();
  const balance = online ? (view ? view.balance : null) : localCredits;
  const balanceLabel = online ? i18nT("Tu saldo") : i18nT("Tu saldo en este dispositivo");

  return (
    <div className={`${css.page} space-y-8 sm:space-y-10`}>
      <span aria-hidden className={css.atmos} />

      <CreditsHero balance={loading ? null : balance} balanceLabel={balanceLabel} />

      {/* ── Los cinco paquetes ── */}
      <section aria-labelledby="h-paquetes" className={storeCss.section}>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h2 id="h-paquetes" className="font-display text-[clamp(22px,2.6vw,30px)] font-bold uppercase leading-none tracking-wide text-white">{i18nT("Paquetes")}</h2>
            <p className="text-caption text-ink-muted">{i18nT("Más créditos, más monedas.")}</p>
          </div>
          <Link href="/tienda" className="nx-action nx-focus">{i18nT("Ir a la tienda →")}</Link>
        </div>
        <div className={`${css.rail} -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 pt-3 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 md:grid-cols-3 xl:grid-cols-5`} data-rail>
          {products.map((p, i) => (
            <CreditPackCard key={p.productId} product={p} badge={packBadge(p, products)} index={i} paymentsOpen={PAYMENTS_ENABLED} />
          ))}
        </div>
      </section>

      {/* ── Lo que hay que saber, sin letra pequeña ── */}
      <section aria-label={i18nT("Cómo funcionan los DRL Credits")} className={`${css.strip} grid gap-4 p-5 sm:grid-cols-3 sm:p-6`}>
        {[
          { t: i18nT("Se ganan jugando"), d: i18nT("Partidas, misiones, logros y eventos te dan DRL Credits desde el primer día.") },
          { t: i18nT("Compra con dinero real: próximamente"), d: i18nT("Todavía no hay pasarela de pago. No se te cobrará nada ni se pedirá ningún dato.") },
          { t: i18nT("No son dinero"), d: i18nT("No se retiran, no se transfieren entre jugadores y no se convierten en euros.") },
        ].map((x) => (
          <div key={x.t} className="flex gap-3">
            <span aria-hidden className={`${css.noteDot} mt-1.5`} />
            <div>
              <p className="font-display text-label font-bold uppercase tracking-wide2 text-drl-gold">{i18nTd(x.t)}</p>
              <p className="mt-1 text-caption text-ink-secondary">{i18nTd(x.d)}</p>
            </div>
          </div>
        ))}
      </section>

      {/* ── Movimientos: el libro mayor real (solo con sesión) ── */}
      {online && (
        <section aria-labelledby="h-movimientos" className={storeCss.section}>
          <h2 id="h-movimientos" className="nx-label mb-3">{i18nT("Tus movimientos")}</h2>
          {error ? (
            <ErrorState message={i18nTd(error)} onRetry={() => void load()} />
          ) : !view ? (
            <p className="text-caption text-ink-muted">{i18nT("Cargando…")}</p>
          ) : view.history.length === 0 ? (
            <EmptyState icon="📄" title={i18nT("Todavía no hay movimientos")} hint={i18nT("Cuando ganes o gastes DRL Credits, cada movimiento aparecerá aquí con su saldo resultante.")} />
          ) : (
            <div className={`${css.strip} overflow-x-auto`}>
              <table className="w-full text-left text-body">
                <thead>
                  <tr className="border-b border-white/10 text-ink-muted">
                    <th scope="col" className="px-4 py-2.5 font-display text-label uppercase tracking-wide2">{i18nT("Cuándo")}</th>
                    <th scope="col" className="px-4 py-2.5 font-display text-label uppercase tracking-wide2">{i18nT("Concepto")}</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-display text-label uppercase tracking-wide2">{i18nT("Movimiento")}</th>
                    <th scope="col" className="hidden px-4 py-2.5 text-right font-display text-label uppercase tracking-wide2 sm:table-cell">{i18nT("Saldo")}</th>
                  </tr>
                </thead>
                <tbody>
                  {view.history.map((h, i) => (
                    <tr key={`${h.at}-${i}`} className="border-b border-white/[0.06] last:border-0">
                      <td className="px-4 py-2.5 text-ink-muted sm:whitespace-nowrap">{fmtDate(h.at)}</td>
                      <td className="px-4 py-2.5 text-ink-secondary">
                        {i18nTd(KIND_LABEL[h.kind]) ?? i18nTd(h.kind)}
                        {h.reason && <span className="text-ink-faint"> · {i18nTd(h.reason)}</span>}
                      </td>
                      <td className={cn("whitespace-nowrap px-4 py-2.5 text-right font-display font-bold tabular-nums", h.delta >= 0 ? "text-drl-gold" : "text-ink-muted")}>
                        {formatDelta(h.delta)}
                      </td>
                      <td className="hidden whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-ink-muted sm:table-cell">{formatDRLC(h.balanceAfter)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
