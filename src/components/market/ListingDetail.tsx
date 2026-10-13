"use client";

/**
 * DETALLE Y COMPRA DE UN LISTADO — mercado entre jugadores (Fase 23.2).
 *
 * ────────────────────────── QUÉ ES ──────────────────────────
 *
 * La ficha de «comprar una carta en un videojuego», no una fila de SQL. Enseña la carta
 * grande, sus estadísticas y las TRES cifras que nunca hay que mezclar —precio de venta,
 * valor de mercado y valor de instancia—, y lleva la compra por sus pasos: ver → confirmar
 * (con saldo antes y después) → resultado.
 *
 * ────────────────────────── QUÉ NO HACE ──────────────────────────
 *
 * No habla con la base de datos ni recalcula ninguna fórmula: pinta el `ListingView` que ya
 * trae resuelto el servidor y llama a `onBuy`, que es el ÚNICO camino de compra (el endpoint
 * de Fase 11). El precio, el saldo y el resultado los pone el servidor; aquí no hay compra
 * optimista. Si el mercado está cerrado (`canBuy=false`), el CTA no ejecuta nada.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { getCard } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";
import { marketValue, instanceValue } from "@/domain/economy/pricing";
import type { ListingView } from "@/lib/game/market";
import { formatCredits, cn } from "@/lib/format";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("market");

type Step = "detail" | "confirm" | "success";

const STAT_LABELS: [keyof import("@/domain/cards/types").PlayerStats, string][] = [
  ["dmg", "DMG"], ["scr", "ACS"], ["com", "COM"], ["hs", "HS"], ["ast", "AST"], ["clu", "CLU"],
];

export function ListingDetail({
  listing: l, credits, canBuy, onBuy, onClose,
}: {
  listing: ListingView;
  credits: number;
  canBuy: boolean;
  /** El camino de compra del servidor (Fase 11). Resuelve con el precio pagado o lanza. */
  onBuy: (l: ListingView) => Promise<{ price: number }>;
  onClose: () => void;
}) {
  useLocale();
  const reduce = useReducedMotion();
  const def = useMemo(() => getCard(l.cardId), [l.cardId]);
  const variant = def ? getVariant(def.variantId) : null;
  const instance = def ? instanceValue(def, l.serial ?? undefined) : l.reference;
  const market = def ? marketValue(def) : l.reference;

  const [step, setStep] = useState<Step>("detail");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => { dialogRef.current?.focus(); }, []);

  // Escape cierra —salvo mientras hay una compra en vuelo, que no se interrumpe a medias—.
  const close = useCallback(() => { if (!busy) onClose(); }, [busy, onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const enough = credits >= l.price;

  async function confirmBuy() {
    if (busy || !canBuy || !enough) return;
    setBusy(true);
    setError(null);
    try {
      await onBuy(l);
      setStep("success");
    } catch (e) {
      // Mensaje humano: el servicio ya traduce los errores de la RPC a algo legible.
      setError(e instanceof Error ? e.message : t("No hemos podido completar la compra."));
    } finally { setBusy(false); }
  }

  const anim = reduce
    ? {}
    : { initial: { opacity: 0, scale: 0.97 }, animate: { opacity: 1, scale: 1 }, exit: { opacity: 0, scale: 0.97 } };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm"
      onClick={close}
    >
      <motion.div
        {...anim}
        transition={{ duration: reduce ? 0 : 0.18 }}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="listing-detail-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="nx-focus nx-clip relative my-auto w-full max-w-[760px] border border-white/12 bg-[#0c0e13] p-5 shadow-2xl outline-none sm:p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <span className="nx-label !text-drl-cyan">{t("Mercado · carta")}</span>
            <h2 id="listing-detail-title" className="mt-1 font-display text-[22px] font-bold uppercase leading-none text-white">
              {l.nick} <span className="text-white/40">{td(l.variantLabel)}</span>
            </h2>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label={t("Cerrar")}
            className="nx-focus grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/12 text-white/60 transition hover:bg-white/[0.08] hover:text-white"
          >
            <span aria-hidden>✕</span>
          </button>
        </div>

        <div className="mt-4 grid gap-5 sm:grid-cols-[minmax(0,220px)_1fr] sm:items-start">
          {/* ── La carta, grande ── */}
          <div className="mx-auto w-[200px] sm:mx-0">
            {def && <PlayerCard card={def} size="md" interactive={!reduce} serial={l.serial ?? undefined} />}
          </div>

          {/* ── Sus datos ── */}
          <div className="min-w-0">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
              <Attr k={t("Jugador")} v={l.nick} />
              <Attr k={t("Equipo")} v={l.team} />
              <Attr k={t("Región")} v={l.region} />
              <Attr k={t("Rareza")} v={l.variantLabel} />
              <Attr k="OVR" v={String(l.ovr)} />
              {l.serial != null && (
                <Attr k={t("Serial")} v={`#${l.serial}${variant?.serialLimit ? ` / ${variant.serialLimit}` : ""}`} />
              )}
            </dl>

            {def && (
              <div className="mt-3 grid grid-cols-3 gap-2">
                {STAT_LABELS.map(([key, label]) => (
                  <div key={key} className="nx-clip-sm border border-white/[0.08] bg-white/[0.02] px-2 py-1.5 text-center">
                    <span className="nx-label !text-[9px] block">{td(label)}</span>
                    <span className="nx-readout text-[15px] text-white/85">{def.stats[key]}</span>
                  </div>
                ))}
              </div>
            )}

            {/* ── Las TRES cifras, cada una con su nombre (§22) ── */}
            <div className="mt-4 grid gap-2">
              <Money label={t("Precio de venta")} value={l.price} accent="var(--nx-gold)" strong />
              <Money label={t("Valor de mercado")} value={market} />
              <Money label={t("Valor de instancia")} value={instance} />
            </div>

            {/* ── El paso de compra ── */}
            <div className="mt-4">
              {step === "detail" && (
                <button
                  type="button"
                  disabled={!canBuy}
                  onClick={() => { setError(null); setStep("confirm"); }}
                  title={canBuy ? undefined : t("El comercio entre jugadores todavía no está abierto")}
                  className="nx-clip-sm min-h-[44px] w-full bg-drl px-4 font-display text-[13px] font-bold uppercase tracking-[0.1em] text-white shadow-glow transition hover:brightness-110 disabled:cursor-not-allowed disabled:bg-white/[0.06] disabled:text-white/35 disabled:shadow-none"
                >
                  {canBuy ? t("Comprar") : t("No disponible · mercado cerrado")}
                </button>
              )}

              {step === "confirm" && (
                <div className="nx-clip-sm border border-white/12 bg-white/[0.03] p-3.5">
                  <span className="nx-label !text-white/80">{t("Confirmar compra")}</span>
                  <div className="mt-2 grid gap-1.5 text-[13px]">
                    <Row k={t("Precio")} v={`🪙 ${formatCredits(l.price)}`} />
                    <Row k={t("Tu saldo")} v={`🪙 ${formatCredits(credits)}`} />
                    <Row
                      k={t("Después")}
                      v={`🪙 ${formatCredits(Math.max(0, credits - l.price))}`}
                      tone={enough ? undefined : "var(--nx-red)"}
                    />
                  </div>
                  {!enough && (
                    <p className="mt-2 text-[12px] text-drl-red">{t("Créditos insuficientes para esta compra.")}</p>
                  )}
                  {error && <p className="mt-2 text-[12px] text-drl-red" role="alert">{td(error)}</p>}
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => { setError(null); setStep("detail"); }}
                      disabled={busy}
                      className="nx-focus nx-clip-sm min-h-[44px] flex-1 border border-white/15 px-4 font-display text-[12px] font-bold uppercase tracking-[0.1em] text-white/70 transition hover:text-white disabled:opacity-40"
                    >
                      {t("Cancelar")}
                    </button>
                    <button
                      type="button"
                      onClick={confirmBuy}
                      disabled={busy || !enough || !canBuy}
                      className="nx-focus nx-clip-sm min-h-[44px] flex-1 bg-drl px-4 font-display text-[12px] font-bold uppercase tracking-[0.1em] text-white shadow-glow transition hover:brightness-110 disabled:cursor-not-allowed disabled:bg-white/[0.06] disabled:text-white/35 disabled:shadow-none"
                    >
                      {busy ? t("Comprando…") : t("Comprar")}
                    </button>
                  </div>
                </div>
              )}

              {step === "success" && (
                <div className="nx-clip-sm border border-ok/40 bg-ok/[0.08] p-3.5">
                  <span className="nx-label !text-ok">{t("Carta adquirida")}</span>
                  <p className="mt-1 text-[13px] text-white/75">
                    {t("{nick} {variante} por 🪙 {precio}. Saldo actualizado: 🪙 {saldo}.", { nick: l.nick, variante: td(l.variantLabel), precio: formatCredits(l.price), saldo: formatCredits(Math.max(0, credits - l.price)) })}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link
                      href="/coleccion"
                      className="nx-focus nx-clip-sm min-h-[44px] flex items-center bg-drl px-4 font-display text-[12px] font-bold uppercase tracking-[0.1em] text-white shadow-glow transition hover:brightness-110"
                    >
                      {t("Ver en colección")}
                    </Link>
                    <button
                      type="button"
                      onClick={onClose}
                      className="nx-focus nx-clip-sm min-h-[44px] border border-white/15 px-4 font-display text-[12px] font-bold uppercase tracking-[0.1em] text-white/70 transition hover:text-white"
                    >
                      {t("Volver al mercado")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function Attr({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0">
      <dt className="nx-label !text-[9px]">{td(k)}</dt>
      <dd className="truncate font-display text-[14px] font-bold text-white/90">{td(v)}</dd>
    </div>
  );
}

function Money({ label, value, accent = "rgba(255,255,255,0.55)", strong = false }: {
  label: string; value: number; accent?: string; strong?: boolean;
}) {
  useLocale();
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="nx-label">{td(label)}</span>
      <span className={cn("nx-readout", strong ? "text-[18px]" : "text-[14px]")} style={{ color: accent }}>
        🪙 {formatCredits(value)}
      </span>
    </div>
  );
}

function Row({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-white/45">{td(k)}</span>
      <span className="nx-readout text-[14px]" style={{ color: tone ?? "rgba(255,255,255,0.85)" }}>{td(v)}</span>
    </div>
  );
}
