"use client";

/**
 * FASE 44 · «LISTO PARA ABRIR» — el sobre como OBJETO y ABRIR SOBRE como la acción dominante.
 *
 * Pieza con props (la monta el inventario real y el arnés): el sobre sellado canónico (`SealedPack`) inclinado y con
 * luz de su acento, que responde al apuntar/enfocar (nivel 1), y un botón grande que lleva a la ceremonia. No abre
 * nada por sí misma: navegar a `/abrir/<id>` es lo que inicia la apertura (servidor primero, como siempre).
 */
import Link from "next/link";
import type { PackDef } from "@/domain/packs/types";
import { SealedPack } from "./SealedPack";
import { NxButton } from "@/components/ui/NxButton";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("packs");

export function PackOpenStage({ pack, packId, total }: { pack: PackDef; packId: string; total: number }) {
  useLocale();
  return (
    <div
      data-testid="inventory-open-stage"
      data-motion-level="1"
      className="nx-clip relative isolate grid items-center gap-6 overflow-hidden border px-6 py-7 sm:grid-cols-[auto_minmax(0,1fr)] sm:px-10"
      style={{ borderColor: `${pack.accent}66`, background: `radial-gradient(70% 120% at 12% 60%, ${pack.accent}40, transparent 65%), linear-gradient(160deg, rgba(14,16,28,0.97), rgba(6,7,13,0.99))` }}
    >
      <Link href={`/abrir/${packId}`} aria-label={t("Abrir {name}", { name: td(pack.name) })} className="nx-mode group relative mx-auto block h-[230px] w-[170px]">
        <span aria-hidden className="nx-mode-glow absolute inset-0 -z-10 blur-2xl" style={{ background: `radial-gradient(closest-side, ${pack.accent}, transparent)` }} />
        <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <span className="block" style={{ transform: "scale(0.55) rotate(-6deg)" }}>
            <span className="nx-mode-art block">
              <SealedPack pack={pack} cutProgress={0} />
            </span>
          </span>
        </span>
      </Link>
      <div className="min-w-0 text-center sm:text-left">
        <p className="nx-label" style={{ color: pack.accent }}>{t("Listo para abrir")}</p>
        <p className="mt-1 font-display text-[clamp(26px,4vw,42px)] font-bold uppercase leading-none text-white">{td(pack.name)}</p>
        <p className="mt-2 text-[15px] text-white/60">
          {total === 1 ? t("Tienes 1 sobre sin abrir.") : t("Tienes {total} sobres sin abrir.", { total })} {pack.cardCount === 1 ? t("1 carta real por sobre.") : t("{cardCount} cartas reales por sobre.", { cardCount: pack.cardCount })}
        </p>
        <div className="mt-5">
          <NxButton variant="primary" size="lg" href={`/abrir/${packId}`} data-cta="primary" data-testid="inventory-open-cta" className="!min-h-[60px] min-w-[240px] !text-[18px]">
            {t("Abrir sobre")}
          </NxButton>
        </div>
      </div>
    </div>
  );
}
