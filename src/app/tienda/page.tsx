"use client";

/**
 * TIENDA 4.0 — la tienda de NEXUS DRLCards (Fase 49).
 *
 * ══════════════════════════ QUÉ ES ══════════════════════════
 *
 *   destacado   una edición real con sus cartas reales (`STORE_CATALOG.featuredHero`).
 *   sobres      los sobres ACTIVOS: aperturas aleatorias. Se compran con créditos (lo de siempre).
 *   cajas       10 sobres de un tipo, al inventario y sin abrir. Dinero real: pendiente de pasarela.
 *   cartas      cartas concretas que vende la casa (NO es el Marketplace, que sigue cerrado).
 *   packs       combinaciones explícitas de sobres, cartas y créditos.
 *
 * ══════════════════════════ QUIÉN DECIDE ══════════════════════════
 *
 * Qué se enseña: `data/storeCatalog.ts` pasado por el resolvedor (`domain/store/resolve.ts`), que cruza
 * la configuración con el catálogo real y el ciclo de vida (un sobre DRAFT o RETIRED no aparece nunca).
 * Qué se compra: el SERVIDOR. Con sesión, un sobre lo cobra `buyPackOnline` → `/api/game/packs` →
 * `app_buy_pack` (precio del catálogo del servidor); sin sesión, el motor local. Aquí no hay ni una
 * cifra económica escrita a mano, y el dinero real no se finge: sin pasarela, «Próximamente».
 */
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { resolveStore } from "@/domain/store/resolve";
import { usePacksVersion } from "@/lib/packs/usePacksVersion";
import type { ResolvedProduct } from "@/domain/store/types";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { Toast } from "@/components/ui/Toast";
import { useToast } from "@/lib/useToast";
import { useGameStore } from "@/store/useGameStore";
import { useAuth } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { buyPackOnline } from "@/lib/game/sync";
import { newGesture } from "@/lib/game/client";
import { playSound } from "@/lib/sound";
import { StoreHero } from "@/components/store/StoreHero";
import { StoreTabs } from "@/components/store/StoreTabs";
import { BoxOfferCard, BundleOfferCard, CardOfferCard, PackOfferCard, SectionHead } from "@/components/store/StoreProducts";
import { PurchaseModal, type PurchasePhase } from "@/components/store/PurchaseModal";
import { css } from "@/components/store/storeClasses";
import { BattlePassEntry } from "@/components/store/BattlePassEntry";
import { useServerEconomy, SESSION_PENDING } from "@/lib/game/serverEconomy";
import "./store.css";

export default function TiendaPage() {
  return (
    <HydrationGate>
      <Store />
    </HydrationGate>
  );
}

/** Sobres que se ven sin desplegar: dos filas en escritorio (F72.4: la tarjeta es mínima, caben más). */
const PACKS_FOLDED = 8;

function Store() {
  const router = useRouter();
  const { toast, notify } = useToast();
  const { user } = useAuth();
  /* Con sesión, la compra la valida y la cobra el servidor; sin ella, la economía local. */
  const online = isSupabaseConfigured() && !!user;
  const serverEconomy = useServerEconomy();
  const credits = useGameStore((s) => s.credits);
  const unopened = useGameStore((s) => s.unopenedPacks);
  const buyPack = useGameStore((s) => s.buyPack);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<ResolvedProduct | null>(null);
  const [phase, setPhase] = useState<PurchasePhase>({ at: "confirm" });
  const [allPacks, setAllPacks] = useState(false);
  /*
   * F68 · UNA COMPRA POR GESTO. `busy` es estado de React: dos clics en la misma tarea leían el mismo `false` y cobraban
   * dos veces (cada uno con su propia clave). `inFlight` corta el segundo en el acto, y la clave del gesto (una por
   * apertura del diálogo) hace que un reintento tras un fallo de red lo deduplique el servidor (`economy_ops`).
   */
  const inFlight = useRef(false);
  const gesture = useRef<string | null>(null);

  // La vista se resuelve una vez por visita con el reloj actual (las ventanas de fechas se respetan).
  const packsV = usePacksVersion(); // F60: los sobres del panel aparecen/desaparecen sin recargar
  const view = useMemo(() => resolveStore(Date.now()), [packsV]); // eslint-disable-line react-hooks/exhaustive-deps
  const heroProduct = view.hero ? view.packs.find((p) => p.packId === view.hero!.packId) ?? null : null;
  const packsShown = allPacks ? view.packs : view.packs.slice(0, PACKS_FOLDED);

  function select(p: ResolvedProduct) {
    playSound("pack.select");
    gesture.current = newGesture();
    setPhase({ at: "confirm" });
    setSelected(p);
  }

  /** Compra un sobre. Devuelve true si se pudo. Misma ruta de siempre: el servidor cobra y valida. */
  async function purchase(packId: string): Promise<boolean> {
    if (online) {
      try {
        await buyPackOnline(packId, gesture.current ?? undefined);
        return true;
      } catch (e) {
        setPhase({ at: "failed", message: e instanceof Error ? e.message : "No se pudo comprar" });
        return false;
      }
    }
    // F69 · sesión aún resolviéndose: ni compra local (saldo inventado) ni servidor (sin token).
    if (serverEconomy) { setPhase({ at: "failed", message: SESSION_PENDING }); return false; }
    const res = buyPack(packId);
    if (!res.ok) { setPhase({ at: "failed", message: res.error ?? "No se pudo comprar" }); return false; }
    return true;
  }

  async function confirm() {
    const packId = selected?.kind === "PACK" ? selected.packId : undefined;
    if (busy || inFlight.current || !packId) return;
    inFlight.current = true;
    setBusy(true);
    setPhase({ at: "working" });
    try {
      if (await purchase(packId)) {
        gesture.current = null; // compra hecha: otra compra será otro gesto (otra apertura del diálogo)
        setPhase({ at: "done", balance: useGameStore.getState().credits });
        notify(`${selected!.name} añadido a tu inventario`, true);
      }
    } finally { inFlight.current = false; setBusy(false); }
  }

  function openNow() {
    const packId = selected?.packId;
    if (!packId || busy) return;
    router.push(`/abrir/${packId}`);
  }

  const tabs = [
    { id: "destacado", label: "Destacado" },
    { id: "sobres", label: "Sobres", count: view.packs.length },
    { id: "cajas", label: "Cajas", count: view.boxes.length },
    { id: "cartas", label: "Cartas", count: view.cards.length },
    { id: "packs", label: "Packs", count: view.bundles.length },
  ].filter((t) => t.id !== "destacado" || view.hero);

  return (
    <div className={`${css.page} space-y-8 sm:space-y-10`}>
      <span aria-hidden className={css.atmos} />

      {view.hero && <StoreHero hero={view.hero} onCta={() => (heroProduct ? select(heroProduct) : document.getElementById("sobres")?.scrollIntoView())} />}

      <StoreTabs tabs={tabs} />

      {/* IA 2026-10-07 · el pase se alcanza desde la Tienda (entrada al pase canónico; no se duplica aquí). */}
      <BattlePassEntry />

      {/* ── SOBRES ── */}
      <section id="sobres" aria-labelledby="h-sobres" className={css.section}>
        <SectionHead
          id="h-sobres"
          title="Sobres"
          subtitle="Consigue cartas aleatorias y amplía tu colección."
          action={
            <button type="button" onClick={() => setAllPacks((v) => !v)} className="nx-action nx-focus" aria-expanded={allPacks} aria-controls="lista-sobres">
              {allPacks ? "Ver menos" : `Ver todos · ${view.packs.length}`} →
            </button>
          }
        />
        <div id="lista-sobres" className={`${css.grid} grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4`}>
          {packsShown.map((p, i) => (
            <PackOfferCard key={p.productId} product={p} owned={unopened[p.packId!] ?? 0} index={i} onSelect={select} />
          ))}
        </div>
        {/* Puente al catálogo por categoría (Fase 21.4): la ficha completa de cada sobre vive en /packs. */}
        <nav aria-label="Explorar el catálogo de sobres" className="mt-4 flex flex-wrap items-center gap-2">
          <span className="mr-1 font-display text-label uppercase tracking-wide2 text-ink-faint">Catálogo</span>
          {[
            { href: "/packs", label: "Todos" },
            { href: "/packs#rareza", label: "Rareza" },
            { href: "/packs#regiones", label: "Regiones" },
            { href: "/packs#equipos", label: "Equipos" },
          ].map((c) => (
            <Link key={c.label} href={c.href} className="nx-focus nx-clip-sm bg-white/[0.04] px-3 py-2 font-display text-label font-bold uppercase tracking-wide2 text-ink-secondary shadow-[inset_0_0_0_1px_rgba(255,255,255,0.10)] transition hover:bg-white/[0.08] hover:text-white">
              {c.label}
            </Link>
          ))}
        </nav>
      </section>

      {/* ── CAJAS ── */}
      {view.boxes.length > 0 && (
        <section id="cajas" aria-labelledby="h-cajas" className={css.section}>
          <SectionHead id="h-cajas" title="Cajas" subtitle="10 sobres del mismo tipo, a tu inventario y sin abrir." />
          <div className={`${css.grid} grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4`}>
            {view.boxes.map((p, i) => <BoxOfferCard key={p.productId} product={p} index={i} onSelect={select} />)}
          </div>
        </section>
      )}

      {/* ── CARTAS ── (F72.4: misma tarjeta que el resto; edición, rareza y OVR en el detalle) */}
      {view.cards.length > 0 && (
        <section id="cartas" aria-labelledby="h-cartas" className={css.section}>
          <SectionHead id="h-cartas" title="Cartas destacadas" subtitle="Cartas concretas de la tienda NEXUS. No es el Marketplace." />
          <div className={`${css.grid} grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4`}>
            {view.cards.map((p, i) => <CardOfferCard key={p.productId} product={p} index={i} onSelect={select} />)}
          </div>
        </section>
      )}

      {/* ── PACKS ── (el contenido de cada pack, en el detalle) */}
      {view.bundles.length > 0 && (
        <section id="packs" aria-labelledby="h-packs" className={css.section}>
          <SectionHead id="h-packs" title="Packs especiales" subtitle="Sobres, cartas y créditos en un solo producto." />
          <div className={`${css.grid} grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4`}>
            {view.bundles.map((p, i) => <BundleOfferCard key={p.productId} product={p} index={i} onSelect={select} />)}
          </div>
        </section>
      )}

      <p className="text-caption text-ink-faint">
        Los precios en créditos los fija y los cobra el servidor. El pago con dinero real todavía no está activo: nada se cobra
        ni se concede sin un pago confirmado.
      </p>

      {selected && (
        <PurchaseModal
          product={selected}
          credits={credits}
          owned={selected.packId ? unopened[selected.packId] ?? 0 : 0}
          phase={phase}
          onConfirm={confirm}
          onOpenNow={openNow}
          onClose={() => { if (!busy) setSelected(null); }}
        />
      )}

      <Toast toast={toast} />
    </div>
  );
}
