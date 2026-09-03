"use client";

/**
 * PRESTIGIO (Fase 14).
 *
 * ────────────────────────── QUÉ RESUELVE ──────────────────────────
 *
 * El último problema abierto desde la Fase 11: **no había dónde gastar los créditos** una
 * vez hecha la colección. Medido en la Fase 14: un jugador saturado acumula 1.995 créditos
 * al día sin destino.
 *
 * Aquí se gastan. Una insignia que te ganaste completando un conjunto se puede llevar a
 * plata, oro y élite. No da nada: se ve.
 *
 * ────────────────────────── DECISIONES ──────────────────────────
 *
 * **1. La vitrina va primero, la tienda después.** Lo que ya has conseguido es el motivo
 * para conseguir lo siguiente. Si arriba estuviera el catálogo de precios, esto sería una
 * tienda con una sección de logros; al revés, es una vitrina con una forma de ampliarla.
 *
 * **2. El precio se enseña siempre, la compra solo cuando llega.** Un botón que se pulsa y
 * dice «no te llega» ya ha hecho perder el clic. Se ve el precio en el tono del escalón y,
 * si falta saldo, cuánto falta.
 *
 * **3. Nada parpadea.** Es una vitrina, no una máquina tragaperras. Los escalones tienen su
 * color y su glifo, y ahí se acaba el movimiento — que es además lo que la nota de
 * rendimiento de esta fase pide: sin animaciones permanentes.
 *
 * **4. Sin insignias, no hay panel.** A quien todavía no ha completado ningún conjunto esto
 * no le dice nada, y ocuparía el sitio de la colección para enseñarle una tienda vacía.
 */
import { useState } from "react";
import type { PrestigeView } from "@/lib/game/prestige";
import { buyPrestige } from "@/lib/game/prestige";
import { formatCredits, cn } from "@/lib/format";

const PAGE = 8;

export function PrestigePanel({
  view, onChanged, notify,
}: {
  view: PrestigeView;
  onChanged: () => void;
  notify?: (msg: string, ok?: boolean) => void;
}) {
  const [shown, setShown] = useState(PAGE);
  const [busy, setBusy] = useState<string | null>(null);

  // Sin conjuntos completados no hay nada que prestigiar ni nada que enseñar.
  if (view.totals.eligible === 0) return null;

  async function buy(setId: string, tierId: string) {
    setBusy(`${setId}:${tierId}`);
    try {
      const r = await buyPrestige(setId, tierId);
      notify?.(r.applied
        ? `${r.label} · quedan 🪙 ${formatCredits(r.credits)}`
        : "Ese escalón ya era tuyo");
      onChanged();
    } catch (e) {
      notify?.(e instanceof Error ? e.message : "No se pudo comprar", false);
    } finally {
      setBusy(null);
    }
  }

  const t = view.totals;

  return (
    <section className="mt-8" aria-label="Prestigio">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="nx-label">Prestigio</h2>
          <p className="mt-1 text-[12.5px] text-white/50">
            Mejora las insignias que ya te has ganado. Solo cambia cómo se ven.
          </p>
        </div>
        <div className="flex gap-4">
          <span className="text-right">
            <span className="nx-label block text-[9px]">Mejoradas</span>
            <span className="nx-readout text-[19px] text-white">{t.purchased}<span className="text-[12px] text-white/30">/{t.eligible}</span></span>
          </span>
          <span className="text-right">
            <span className="nx-label block text-[9px]">Invertido</span>
            <span className="nx-readout text-[19px] text-drl-gold">🪙 {formatCredits(t.burned)}</span>
          </span>
        </div>
      </div>

      {/* ── LA VITRINA: lo ya conseguido ── */}
      {view.owned.length > 0 && (
        <ul className="mb-4 flex flex-wrap gap-2">
          {view.owned.map((o) => (
            <li
              key={o.baseId}
              className="nx-clip-sm flex items-center gap-2 border px-3 py-2"
              style={{ borderColor: `${o.color}55`, background: `${o.color}14` }}
              title={`${o.label} · ${o.tierLabel}`}
            >
              <span aria-hidden style={{ color: o.color }}>◈</span>
              <span className="font-display text-[12px] font-bold uppercase tracking-[0.05em] text-white">
                {o.label}
              </span>
              <span
                className="font-display text-[9px] font-bold uppercase tracking-[0.14em]"
                style={{ color: o.color }}
              >
                {o.tierLabel}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* ── LO QUE SE PUEDE MEJORAR ── */}
      {view.offers.length === 0 ? (
        <p className="nx-plate nx-clip-sm px-4 py-3 text-[12.5px] text-white/55">
          Has llevado a élite todo lo que tienes. Completa más conjuntos para seguir.
        </p>
      ) : (
        <>
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {view.offers.slice(0, shown).map((o) => {
              const falta = o.price - view.credits;
              return (
                <li
                  key={`${o.setId}:${o.tierId}`}
                  className={cn(
                    "nx-clip-sm relative border p-3.5 transition duration-fast",
                    o.affordable ? "border-white/25" : "border-white/10",
                  )}
                  style={o.affordable ? { background: `${o.color}12` } : undefined}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span
                        className="font-display text-[9px] font-bold uppercase tracking-[0.14em]"
                        style={{ color: o.color }}
                      >
                        {o.tierLabel}
                      </span>
                      <div className="mt-0.5 truncate font-display text-[13.5px] font-bold uppercase tracking-[0.04em] text-white">
                        {o.label}
                      </div>
                    </div>
                    <span aria-hidden className="shrink-0 text-[15px]" style={{ color: o.color }}>◈</span>
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span className="nx-readout text-[13px]" style={{ color: o.color }}>
                      🪙 {formatCredits(o.price)}
                    </span>
                    {o.affordable ? (
                      <button
                        type="button"
                        onClick={() => void buy(o.setId, o.tierId)}
                        disabled={busy !== null}
                        className="nx-clip-sm px-3 py-1.5 font-display text-[10px] font-bold uppercase tracking-[0.12em] text-black transition duration-fast disabled:opacity-50"
                        style={{ background: o.color }}
                      >
                        {busy === `${o.setId}:${o.tierId}` ? "…" : "Mejorar"}
                      </button>
                    ) : (
                      <span className="text-[11px] text-white/35">
                        faltan {formatCredits(falta)}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          {shown < view.offers.length && (
            <div className="mt-4 flex flex-col items-center gap-1.5">
              <button
                type="button"
                onClick={() => setShown((n) => n + PAGE * 2)}
                className="rounded-control border border-white/15 px-6 py-2.5 font-display text-[13px] font-bold uppercase tracking-[0.12em] text-white/80 transition duration-fast hover:bg-white/[0.07]"
              >
                Ver más mejoras
              </button>
              <span className="nx-label">{shown} de {view.offers.length}</span>
            </div>
          )}
        </>
      )}
    </section>
  );
}
