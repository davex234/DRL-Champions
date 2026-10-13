"use client";

/**
 * DRL CREDITS · PIEZAS (Fase 49.1): la moneda, el héroe y la tarjeta de paquete.
 *
 * Mismo lenguaje que la Tienda 4.0 (marco del héroe, placas de precio, cortes en esquina), en oro. El arte de
 * cada paquete es PROPIO (`public/store/credits/*`, generado por `scripts/credits-art/render.ts`) y no lleva
 * texto: nombre y cantidad los pinta la interfaz, y la cantidad existe siempre como texto real.
 */
import type { CSSProperties } from "react";
import type { CreditProduct } from "@/domain/economy/drlCredits";
import { ACCENT } from "@/design/tokens";
import { rgbVar } from "@/components/store/storeView";
import { css as storeCss } from "@/components/store/storeClasses";
import { CREDITS_HERO_ART, PACK_TAGLINE, artKey, creditsArtFor, formatAmount } from "./creditsView";
import { creditsCss as css } from "./creditsClasses";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("credits");

const GOLD_RGB = rgbVar(ACCENT.gold);

/** La moneda DRL en pequeño (icono de saldo): oro con la corona en hexágono, como en el arte. */
export function DrlCoin({ size = 28 }: { size?: number }) {
  return (
    <svg aria-hidden viewBox="0 0 40 40" width={size} height={size} className={css.coinIcon}>
      <circle cx="20" cy="20" r="18" fill="currentColor" />
      <circle cx="20" cy="20" r="15.5" fill="none" stroke="rgb(0 0 0 / 0.28)" strokeWidth="1.4" />
      <path d="M20 9.5 L29 14.7 L29 25.3 L20 30.5 L11 25.3 L11 14.7 Z" fill="none" stroke="rgb(0 0 0 / 0.45)" strokeWidth="1.6" />
      <path d="M14.2 24 L13.4 16.8 L17 19.6 L20 14.4 L23 19.6 L26.6 16.8 L25.8 24 Z" fill="rgb(0 0 0 / 0.45)" />
      <ellipse cx="15" cy="13" rx="5" ry="2.2" fill="rgb(255 255 255 / 0.45)" />
    </svg>
  );
}

export function CreditsHero({ balance, balanceLabel }: { balance: number | null; balanceLabel: string }) {
  useLocale();
  return (
    <section
      id="creditos"
      aria-labelledby="credits-title"
      className={`${storeCss.hero} ${css.hero} ${storeCss.section} grid gap-0 lg:min-h-[400px] lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-2`}
      style={{ ["--hero-rgb" as string]: GOLD_RGB } as CSSProperties}
    >
      <span aria-hidden className={storeCss.heroBeams} />
      <span aria-hidden className={storeCss.heroShards} />

      <div className={`${storeCss.heroText} relative z-10 flex flex-col justify-center px-5 pb-2 pt-6 sm:px-8 lg:px-12 lg:py-10`}>
        <p className="font-display text-label font-bold uppercase tracking-wide2 text-drl-gold">{t("Tienda")}</p>
        <h1 id="credits-title" className="mt-2 font-display text-[clamp(40px,7vw,84px)] font-bold uppercase leading-[0.9] tracking-tight text-white">
          {t("DRL")} <span className={css.goldText}>{t("Credits")}</span>
        </h1>
        <p className="mt-3 font-display text-[clamp(15px,1.6vw,21px)] font-bold uppercase tracking-[0.14em] text-white">{t("Impulsa tu colección")}</p>
        <p className="mt-3 max-w-[46ch] text-body text-ink-secondary">
          {t("La moneda de NEXUS: compra sobres y todo lo que la tienda tenga a la venta. Cuantos más créditos, más cartas.")}
        </p>

        <div className="mt-6 flex flex-wrap items-stretch gap-3">
          <div className={`${css.balance} nx-clip-sm flex items-center gap-3 px-4 py-3`} aria-live="polite">
            <DrlCoin size={36} />
            <div>
              <p className="font-display text-label font-bold uppercase tracking-wide2 text-ink-muted">{td(balanceLabel)}</p>
              <p className="font-display text-readout-md font-bold tabular-nums text-drl-gold">
                {balance === null ? "—" : formatAmount(balance)} <span className="text-caption font-bold uppercase text-ink-secondary">{t("DRL Credits")}</span>
              </p>
            </div>
          </div>
          {/* Honesto sin ser un cartel: antes de cualquier acción queda claro que aún no se cobra. */}
          <p id="credits-payments-note" className={`${css.note} nx-clip-sm flex max-w-[34ch] items-center gap-2.5 px-3 py-2.5 text-caption text-ink-secondary`}>
            <span aria-hidden className={css.noteDot} />
            <span><strong className="font-bold text-white">{t("Pagos con dinero real: próximamente.")}</strong> {t("Hoy no se cobra nada; los créditos se ganan jugando.")}</span>
          </p>
        </div>
      </div>

      <div className="relative min-h-[220px] sm:min-h-[320px] lg:min-h-0">
        <img
          src={CREDITS_HERO_ART.file}
          alt={t("Cofre NEXUS rebosante de monedas DRL Credits, rodeado de pilas de monedas")}
          width={CREDITS_HERO_ART.width}
          height={CREDITS_HERO_ART.height}
          fetchPriority="high"
          decoding="async"
          className={`${css.heroArt} absolute inset-0 m-auto h-full w-full object-contain`}
        />
        <p className="absolute right-6 top-5 hidden text-right font-display text-caption font-bold uppercase leading-relaxed tracking-[0.34em] text-white/75 xl:block">
          {t("Más créditos")}<br />{t("Más cartas")}<br /><span className="text-drl-gold">{t("Más leyendas")}</span>
        </p>
      </div>
    </section>
  );
}

export function CreditPackCard({ product, badge, index, paymentsOpen }: { product: CreditProduct; badge: string | null; index: number; paymentsOpen: boolean }) {
  useLocale();
  const art = creditsArtFor(product.productId);
  const key = artKey(product.productId);
  const top = badge === "Mayor paquete";
  return (
    <article
      className={`${css.card} ${badge === "Más elegido" ? css.cardPopular : ""} ${top ? css.cardTop : ""} flex w-[72%] shrink-0 snap-start flex-col sm:w-auto`}
      style={{ ["--d" as string]: `${index * 70}ms` } as CSSProperties}
      aria-label={t("{name}: {credits} DRL Credits", { name: td(product.name), credits: formatAmount(product.credits) })}
    >
      {badge && <span className={`${css.badge} ${top ? css.badgeTop : ""} font-display text-label font-bold uppercase tracking-wide2`}>{td(badge)}</span>}
      <div className="px-4 pt-5">
        <h2 className="font-display text-caption font-bold uppercase tracking-wide2 text-white">{td(product.name)}</h2>
        <p className="mt-1 font-display text-readout-lg font-bold leading-none tabular-nums">
          <span className={css.goldText}>{formatAmount(product.credits)}</span>
        </p>
        <p className="mt-1 font-display text-caption font-bold uppercase tracking-wide text-drl-gold/80">{t("DRL Credits")}</p>
      </div>
      <div className={`${css.art} relative mx-auto -mt-1 w-full`}>
        {art && (
          <img
            src={art.file}
            alt={t("{credits} DRL Credits: {v}", { credits: formatAmount(product.credits), v: art.chest === "premium" ? t("cofre premium rebosante y montañas de monedas") : art.chest === "standard" ? t("cofre abierto lleno de monedas") : art.coins > 30 ? t("muchas pilas de monedas") : art.coins > 10 ? t("pequeñas pilas de monedas") : t("unas pocas monedas") })}
            width={art.width}
            height={art.height}
            loading="lazy"
            decoding="async"
            sizes="(min-width: 1280px) 260px, (min-width: 640px) 45vw, 80vw"
            className="block h-auto w-full"
          />
        )}
      </div>
      <div className="mt-auto space-y-2.5 px-4 pb-4">
        <p className="text-caption text-ink-secondary">{td(PACK_TAGLINE[key]) ?? ""}</p>
        <div className={`${css.divider}`} aria-hidden />
        <p className={`${css.price} nx-clip-sm flex items-center justify-center gap-2 py-2 font-display text-caption font-bold uppercase tracking-wide`}>
          <span aria-hidden className="text-drl-gold">€</span> {t("· Por anunciar")}
        </p>
        <button
          type="button"
          disabled={!paymentsOpen}
          aria-describedby="credits-payments-note"
          className={`${css.cta} nx-focus nx-clip-sm w-full py-2.5 font-display text-label font-bold uppercase tracking-wide2`}
        >
          {t("Próximamente")}
        </button>
      </div>
    </article>
  );
}
