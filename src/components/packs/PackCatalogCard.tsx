"use client";

/**
 * TARJETA DE SOBRE DEL CATÁLOGO (Fase 21.1).
 *
 * Card grande y visual para `/packs`: el objeto (artwork o dibujo procedimental vía `SealedPack`),
 * el nombre, la categoría, el precio en DRL Credits, el estado y un CTA. NADA técnico: ni id, ni
 * pool, ni pesos, ni lifecycle interno. Toda la información sale de la fuente de verdad
 * (`PackDef` + `packIdentity`); no se fabrica nada.
 */
import Link from "next/link";
import type { PackDef } from "@/domain/packs/types";
import { packIdentity } from "./packIdentity";
import { ctaKindFor } from "./packCatalog";
import { SealedPack } from "./SealedPack";
import { Badge } from "@/components/ui/Badge";
import { formatCredits } from "@/lib/format";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("packs");

export function PackCatalogCard({ pack, owned = 0 }: { pack: PackDef; owned?: number }) {
  useLocale();
  const id = packIdentity(pack);
  const cta = ctaKindFor(pack);
  const gratis = pack.price <= 0;

  return (
    <Link
      href={`/packs/${pack.id}`}
      className="nx-focus nx-clip group relative flex flex-col overflow-hidden bg-white/[0.03] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.10)] transition hover:bg-white/[0.06] hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.20)]"
      aria-label={t("{name} — ver ficha", { name: td(pack.name) })}
    >
      {/* Objeto del sobre, centrado sobre un escenario oscuro. */}
      <div className="relative flex items-center justify-center px-4 pt-5 pb-2" style={{ background: "radial-gradient(120% 90% at 50% 0%, rgba(255,255,255,0.05), transparent 70%)" }}>
        <div className="pointer-events-none transition-transform duration-300 group-hover:-translate-y-1 group-hover:scale-[1.03]">
          <SealedPack pack={pack} cutProgress={0} width={150} />
        </div>
        {owned > 0 && (
          <span className="absolute right-3 top-3">
            <Badge tone="info" solid>{owned} {t("sin abrir")}</Badge>
          </span>
        )}
      </div>

      {/* Datos: categoría, nombre, precio + CTA. */}
      <div className="flex flex-1 flex-col gap-2 border-t border-edge/60 p-4">
        <span className="font-display text-label font-bold uppercase tracking-wide2 text-ink-faint">
          {td(id.categoryLabel)}
          {id.monogram ? ` · ${id.monogram}` : ""}
        </span>
        <h3 className="font-display text-base font-bold leading-tight text-white">{td(pack.name)}</h3>

        {/* La fila salta de línea cuando precio + CTA no caben (dos columnas a 390 px; «Pack ansehen», «Vedi
            pacchetto»): el CTA baja entero, alineado a la derecha, en vez de salirse de la tarjeta. */}
        <div className="mt-auto flex flex-wrap items-end justify-between gap-x-2 gap-y-1.5 pt-2">
          <span className="nx-readout text-sm font-bold" style={{ color: gratis ? "var(--nx-ok)" : "var(--nx-gold)" }}>
            {gratis ? t("Gratis") : `${formatCredits(pack.price)}`}
            {!gratis && <span className="ml-1 text-caption font-normal text-ink-faint">{t("créditos")}</span>}
          </span>
          <span
            className="nx-clip-sm ml-auto inline-flex items-center whitespace-nowrap px-3 py-1.5 font-display text-label font-bold uppercase text-white/85 transition group-hover:text-white"
            style={{ background: "rgba(255,255,255,0.06)" }}
          >
            {cta === "event" ? t("Ver evento") : owned > 0 ? t("Abrir") : gratis ? t("Abrir") : t("Ver sobre")}
          </span>
        </div>
      </div>
    </Link>
  );
}
