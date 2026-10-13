"use client";

/**
 * MIS SOBRES (Fase 25) — los sobres que el jugador YA tiene, agrupados por producto.
 *
 *   PACK ESTÁNDAR  ×4   [ Abrir ]
 *
 * Una fila por producto, nunca cuatro tarjetas iguales. El recuento sale del inventario real
 * (`useGameStore.unopenedPacks`, que con sesión es una copia del servidor). Un RETIRED que se
 * posee se enseña y se abre (regla de ciclo de vida), pero se dice que ya no está a la venta.
 * Un DRAFT jamás aparece: `ownedPackGroups` filtra con la misma autoridad que el servidor.
 */
import Link from "next/link";
import { useMemo } from "react";
import { useGameStore } from "@/store/useGameStore";
import { getPack } from "@/data/packs";
import { ownedPackGroups, totalOwnedPacks } from "@/domain/collection/showcase";
import { packIdentity } from "./packIdentity";
import { SealedPack } from "./SealedPack";
import { NxButton } from "@/components/ui/NxButton";
import { Badge } from "@/components/ui/Badge";
import { Plate } from "@/components/ui/Surface";
import { plural } from "@/lib/format";

export function MyPacks({ compact = false, title = "Mis sobres" }: { compact?: boolean; title?: string }) {
  const unopened = useGameStore((s) => s.unopenedPacks);
  const groups = useMemo(() => ownedPackGroups(unopened, getPack), [unopened]);
  const total = totalOwnedPacks(unopened);

  if (groups.length === 0) {
    if (compact) return null;
    return (
      <Plate className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="nx-label">{title}</p>
            <p className="mt-1 text-sm text-ink-muted">No tienes sobres sin abrir. Elige uno de la tienda y la ceremonia empieza aquí.</p>
          </div>
          <NxButton variant="secondary" size="md" href="/packs#rareza">Ver la tienda</NxButton>
        </div>
      </Plate>
    );
  }

  return (
    <section aria-label={title} className={compact ? "" : "mb-8"}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="font-display text-label font-bold uppercase tracking-wide2 text-ink-muted">
          {title} <span className="ml-1 nx-readout text-white">{total}</span>
        </h2>
        {!compact && <Link href="/inventario" className="nx-focus text-caption text-ink-faint hover:text-white">Inventario →</Link>}
      </div>
      <ul className={compact ? "flex gap-3 overflow-x-auto pb-1" : "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"}>
        {groups.map(({ pack, count, retired }) => {
          const id = packIdentity(pack);
          return (
            <li key={pack.id} className={compact ? "min-w-[260px] shrink-0" : ""}>
              <Plate className="flex items-center gap-4 p-3 transition-colors hover:bg-white/[0.05]">
                <div className="relative shrink-0" aria-hidden>
                  <SealedPack pack={pack} cutProgress={0} width={compact ? 56 : 72} />
                  <span className="absolute -right-2 -top-2 nx-readout rounded-full bg-drl px-2 py-0.5 text-[12px] font-bold text-white shadow-glow">
                    ×{count}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-caption font-bold uppercase tracking-wide text-white">{pack.name}</p>
                  <p className="truncate text-caption text-ink-faint">
                    {id.categoryLabel} · {plural(pack.cardCount, "carta", "cartas")}
                    {retired && <> · <Badge tone="warn">Ya no se vende</Badge></>}
                  </p>
                  <p className="sr-only">{count} {count === 1 ? "unidad" : "unidades"}</p>
                </div>
                <NxButton variant="primary" size={compact ? "sm" : "md"} href={`/abrir/${pack.id}`} aria-label={`Abrir ${pack.name}`}>
                  Abrir
                </NxButton>
              </Plate>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
