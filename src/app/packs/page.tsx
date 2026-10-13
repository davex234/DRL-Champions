"use client";

/**
 * PACK HUB — `/packs` (Fase 25).
 *
 * Antes era un catálogo: pestañas y una rejilla. Ahora es la sección de juego de los sobres,
 * en este orden y por este motivo:
 *
 *   1. MIS SOBRES   — lo que YA tienes, agrupado (×n) con «Abrir». El bucle empieza aquí.
 *   2. DESTACADOS   — un sobre por familia visible (equipo, región, casa), con su motivo real.
 *   3. TIENDA       — todo el catálogo público por pestañas (Rareza · Regiones · Equipos · Eventos).
 *
 * Solo ACTIVE se compra; RETIRED no aparece en la tienda pero, si se posee, sale en «Mis sobres»
 * y se abre; DRAFT no existe para esta pantalla. La autoridad es la MISMA que la del servidor
 * (`domain/packs/lifecycle`). Ningún precio, peso ni probabilidad se calcula aquí.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { useGameStore } from "@/store/useGameStore";
import { PackCatalogCard } from "@/components/packs/PackCatalogCard";
import { MyPacks } from "@/components/packs/MyPacks";
import { SealedPack } from "@/components/packs/SealedPack";
import { packIdentity } from "@/components/packs/packIdentity";
import {
  catalogGroups, availableTabs, publicPacks, featuredPacks, CATALOG_TAB_LABEL, type CatalogTab,
} from "@/components/packs/packCatalog";
import { trackFlow } from "@/lib/telemetry/client";
import { formatCredits } from "@/lib/format";
import { Plate } from "@/components/ui/Surface";
import { Badge } from "@/components/ui/Badge";

export default function PacksHubPage() {
  return (
    <HydrationGate>
      <Hub />
    </HydrationGate>
  );
}

/** Categoría inicial desde el hash (`/packs#equipos`), para poder enlazar desde la tienda. */
function tabFromHash(available: (CatalogTab | "todos")[]): CatalogTab | "todos" {
  if (typeof window === "undefined") return "todos";
  const h = window.location.hash.replace(/^#/, "");
  return (available as string[]).includes(h) ? (h as CatalogTab | "todos") : "todos";
}

function Hub() {
  const unopened = useGameStore((s) => s.unopenedPacks);
  const credits = useGameStore((s) => s.credits);
  const tabs = useMemo(() => availableTabs(), []);
  const [tab, setTab] = useState<CatalogTab | "todos">("todos");

  useEffect(() => {
    setTab(tabFromHash(tabs));
    const onHash = () => setTab(tabFromHash(tabs));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [tabs]);
  useEffect(() => { trackFlow("pack_ceremony", "hub_viewed"); }, []);

  const groups = useMemo(() => catalogGroups(tab), [tab]);
  const featured = useMemo(() => featuredPacks(publicPacks()), []);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 md:py-8">
      {/* ── Cabecera ── */}
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="nx-label">Jugar · Sobres</p>
          <h1 className="font-display text-2xl font-bold uppercase tracking-wide text-white md:text-3xl">
            Sobres
          </h1>
          <p className="mt-1 max-w-lg text-sm text-ink-muted">
            Abre los que tienes, mira qué puede salir de cada uno y consigue el siguiente.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-caption text-ink-faint">Tu saldo</span>
          <span className="nx-readout text-sm font-bold text-drl-gold">{formatCredits(credits)} <span className="text-caption font-normal text-ink-faint">créditos</span></span>
        </div>
      </header>

      {/* ── 1 · MIS SOBRES ── */}
      <MyPacks />

      {/* ── 2 · DESTACADOS ── */}
      {featured.length > 0 && (
        <section aria-label="Destacados" className="mb-8">
          <h2 className="mb-3 font-display text-label font-bold uppercase tracking-wide2 text-ink-muted">Destacados</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {featured.map(({ pack, why }) => {
              const id = packIdentity(pack);
              return (
                <Link
                  key={pack.id}
                  href={`/packs/${pack.id}`}
                  className="nx-focus group"
                  aria-label={`${pack.name}: ${why}`}
                >
                  <Plate className="relative flex items-center gap-4 overflow-hidden p-4 transition-colors hover:bg-white/[0.06]">
                    <div aria-hidden className="absolute inset-0 opacity-60" style={{ background: `radial-gradient(70% 90% at 0% 50%, ${pack.accent}22, transparent 70%)` }} />
                    <div className="relative shrink-0 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:scale-[1.03]">
                      <SealedPack pack={pack} cutProgress={0} width={64} />
                    </div>
                    <div className="relative min-w-0">
                      <p className="font-display text-label font-bold uppercase tracking-wide2 text-ink-faint">{id.categoryLabel}</p>
                      <p className="truncate font-display text-base font-bold text-white">{pack.name}</p>
                      <p className="mt-0.5 line-clamp-2 text-caption text-ink-secondary">{why}</p>
                      <p className="mt-1 nx-readout text-caption" style={{ color: pack.price <= 0 ? "var(--nx-ok)" : "var(--nx-gold)" }}>
                        {pack.price <= 0 ? "Gratis" : `${formatCredits(pack.price)} créditos`}
                        {(unopened[pack.id] ?? 0) > 0 && <Badge tone="info" className="ml-2">{unopened[pack.id]} sin abrir</Badge>}
                      </p>
                    </div>
                  </Plate>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* ── 3 · TIENDA ── */}
      <section aria-label="Tienda de sobres">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-label font-bold uppercase tracking-wide2 text-ink-muted">Tienda</h2>
          <nav aria-label="Categorías de sobres" className="flex flex-wrap gap-2">
            {tabs.map((t) => {
              const active = t === tab;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  aria-pressed={active}
                  className={
                    "nx-focus nx-clip-sm min-h-[44px] px-4 py-2 font-display text-label font-bold uppercase tracking-wide2 transition " +
                    (active
                      ? "bg-drl text-white shadow-glow"
                      : "bg-white/[0.04] text-ink-muted shadow-[inset_0_0_0_1px_rgba(255,255,255,0.10)] hover:text-white hover:bg-white/[0.08]")
                  }
                >
                  {CATALOG_TAB_LABEL[t]}
                </button>
              );
            })}
          </nav>
        </div>

        {groups.length === 0 ? (
          <div className="nx-clip flex min-h-[240px] flex-col items-center justify-center gap-2 bg-white/[0.02] p-8 text-center shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
            <p className="font-display text-lg font-bold text-white">No hay sobres en esta categoría</p>
            <p className="text-sm text-ink-muted">Prueba con otra pestaña.</p>
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.tab} className="mb-8">
              {(tab === "todos") && (
                <h3 className="mb-3 font-display text-label font-bold uppercase tracking-wide2 text-ink-faint">
                  {g.label}
                  <span className="ml-2 text-ink-faint/70">{g.packs.length}</span>
                </h3>
              )}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 lg:grid-cols-4">
                {g.packs.map((p) => (
                  <PackCatalogCard key={p.id} pack={p} owned={unopened[p.id] ?? 0} />
                ))}
              </div>
            </section>
          ))
        )}
      </section>
    </div>
  );
}
