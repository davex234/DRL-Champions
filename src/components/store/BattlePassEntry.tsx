/**
 * IA 2026-10-07 · EL PASE DE BATALLA DESDE LA TIENDA — una entrada, no una copia del pase.
 *
 * Lleva al pase canónico (`/temporada/pase`). Sobre el PREMIUM dice solo lo que es verdad hoy (`config/monetization`):
 * con `PAYMENTS_ENABLED = false` no existe compra, así que se anuncia su precio como «próximamente» y no hay botón de
 * comprar; nunca «comprado» (aquí no se lee ningún derecho). Si algún día hay pagos reales, el flujo vive en el pase.
 */
import Link from "next/link";
import { ROUTES } from "@/design/nav";
import { PASS_PRODUCT, PAYMENTS_ENABLED, formatPrice } from "@/config/monetization";
import { ns, td } from "@/i18n/runtime";

const t = ns("store");

export function battlePassStoreLine(paymentsEnabled = PAYMENTS_ENABLED): string {
  return paymentsEnabled
    ? `${PASS_PRODUCT.label} · ${formatPrice(PASS_PRODUCT.price)}`
    : t("{label} · {price} · próximamente", { label: td(PASS_PRODUCT.label), price: formatPrice(PASS_PRODUCT.price) });
}

export function BattlePassEntry() {
  return (
    <Link
      href={`${ROUTES.battlePass}?desde=tienda`}
      data-testid="store-battle-pass"
      className="nx-focus nx-clip group relative isolate flex min-h-[120px] items-center justify-between gap-4 overflow-hidden px-5 py-5 sm:min-h-[140px] sm:px-8"
      style={{
        background: "radial-gradient(80% 140% at 0% 50%, rgba(255,211,92,0.30), transparent 62%), linear-gradient(160deg, rgba(20,16,6,0.92), rgba(7,8,14,0.95))",
        boxShadow: "inset 0 0 0 1px rgba(255,211,92,0.45), inset 0 1px 0 rgba(255,211,92,0.9)",
      }}
    >
      <svg aria-hidden viewBox="0 0 600 140" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 -z-10 h-full w-full opacity-60">
        <polyline points="300,120 360,92 420,104 480,64 540,76 600,30" fill="none" stroke="rgba(255,211,92,0.7)" strokeWidth="2.5" />
      </svg>
      <span className="min-w-0">
        <span className="block font-display text-[11px] font-bold uppercase tracking-[0.24em] text-drl-gold">{t("Temporada")}</span>
        <span className="mt-1 block font-display text-[clamp(26px,3.4vw,40px)] font-extrabold uppercase leading-none text-white">{t("Pase de batalla")}</span>
        <span className="mt-2 block text-[13px] text-white/70" data-testid="store-battle-pass-premium">{battlePassStoreLine()}</span>
      </span>
      <span className="nx-clip-sm shrink-0 bg-drl-gold px-4 py-3 font-display text-[13px] font-bold uppercase tracking-[0.14em] text-[#221703] transition group-hover:brightness-110">
        {t("Ver pase")}
      </span>
    </Link>
  );
}
