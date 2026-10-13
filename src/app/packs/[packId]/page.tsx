"use client";

/**
 * FICHA DE SOBRE — `/packs/:packId` (Fase 21.1).
 *
 * Vista de detalle: artwork grande, nombre, categoría, precio, contenido (nº de cartas), reparto
 * de rareza REAL (`packStats`, medido) y CTA que usa el flujo de compra/apertura existente
 * (`usePackPurchase` → mismas RPC que la tienda). No fabrica datos: si el backend no expone algo,
 * la sección se omite. Respeta el ciclo de vida —un sobre no público (DRAFT/RETIRED) o inexistente
 * muestra su estado, nunca su contenido interno—.
 */
import { use, useEffect, useMemo, useRef, useState } from "react";
import { usePacksVersion } from "@/lib/packs/usePacksVersion";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getPack } from "@/data/packs";
import { isStoreVisible } from "@/domain/packs/lifecycle";
import { packIdentity, teamCardCount } from "@/components/packs/packIdentity";
import { ctaKindFor } from "@/components/packs/packCatalog";
import { packStats } from "@/data/packStats";
import { packOddsFor } from "@/domain/packs/odds";
import { PackOddsPanel } from "@/components/packs/PackOdds";
import { trackFlow } from "@/lib/telemetry/client";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { SealedPack } from "@/components/packs/SealedPack";
import { NxButton } from "@/components/ui/NxButton";
import { Badge } from "@/components/ui/Badge";
import { Readout } from "@/components/ui/Readout";
import { Toast } from "@/components/ui/Toast";
import { useToast } from "@/lib/useToast";
import { useGameStore } from "@/store/useGameStore";
import { usePackPurchase } from "@/lib/game/usePackPurchase";
import { formatCredits } from "@/lib/format";
import { fetchStarterStatus } from "@/lib/game/client";
import { starterOffer } from "@/lib/economy/starterOffer";
import { STARTER_POLICY } from "@/domain/economy/starter";
import { PackPurchaseCta } from "@/components/economy/PackPurchaseCta";
import type { StarterStatus } from "@/server/services/starter";


export default function PackDetailPage({ params }: { params: Promise<{ packId: string }> }) {
  const { packId } = use(params);
  return (
    <HydrationGate>
      <Detail packId={packId} />
    </HydrationGate>
  );
}

/** Estado a pantalla completa para «no encontrado / no disponible». Nunca revela un DRAFT. */
function Unavailable({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-2xl flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="font-display text-2xl font-bold uppercase text-white">{title}</h1>
      <p className="max-w-md text-sm text-ink-muted">{body}</p>
      <NxButton variant="secondary" size="md" href="/packs">Volver al catálogo</NxButton>
    </div>
  );
}

function Detail({ packId }: { packId: string }) {
  const router = useRouter();
  const { toast, notify } = useToast();
  const { purchase, online } = usePackPurchase();
  const credits = useGameStore((s) => s.credits);
  const owned = useGameStore((s) => s.unopenedPacks[packId] ?? 0);
  const [busy, setBusy] = useState(false);
  /** F68 · guardia SÍNCRONA: `busy` (estado) no corta un segundo clic en la misma tarea; esto sí. */
  const inFlight = useRef(false);
  // Fase 41 · el Sobre Inicial gratis lo decide el servidor: se pregunta antes de ofrecerlo.
  const isStarter = packId === STARTER_POLICY.packId;
  const [starter, setStarter] = useState<StarterStatus | null | undefined>(undefined);
  useEffect(() => {
    if (!isStarter || !online) return;
    let alive = true;
    fetchStarterStatus().then((s) => { if (alive) setStarter(s); }).catch(() => { if (alive) setStarter(null); });
    return () => { alive = false; };
  }, [isStarter, online, owned]);

  usePacksVersion(); // F60: sobres del panel
  const pack = getPack(packId);
  // Fase 25 · telemetría con la taxonomía existente: flujo `pack_ceremony`, contexto `pack_viewed`.
  useEffect(() => { if (pack && isStoreVisible(pack)) trackFlow("pack_ceremony", `pack_viewed:${pack.id}`); }, [pack]);

  // Estados de ciclo de vida — sin filtrar contenido de un sobre no público.
  if (!pack) return <Unavailable title="Sobre no encontrado" body="Este sobre no existe en el catálogo de NEXUS." />;
  if (!isStoreVisible(pack)) {
    return <Unavailable title="Sobre no disponible" body="Este sobre no está disponible ahora mismo. Echa un vistazo al resto del catálogo." />;
  }

  const id = packIdentity(pack);
  const cta = ctaKindFor(pack);
  const gratis = pack.price <= 0;
  const offer = isStarter ? starterOffer({ owned, online, status: starter }) : null;
  const stats = packStats(pack.id);
  const team = pack.team ? teamCardCount(pack.team) : null;
  // Fase 25 · probabilidades comprensibles derivadas de la distribución MEDIDA con el motor real.
  const odds = packOddsFor(pack, stats ?? null, team?.total ?? 0);

  async function handleCta() {
    if (busy) return;
    // Evento: no se compra aquí; se va al Centro de Eventos (misma regla que la tienda).
    if (cta === "event") { router.push("/eventos"); return; }
    // Si ya tienes uno, ábrelo sin comprar otro.
    if (owned > 0 || offer?.kind === "has-unopened") { router.push(`/abrir/${pack!.id}`); return; }
    if (offer && !offer.enabled) return;
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const res = await purchase(pack!.id);
      if (res.ok) { trackFlow("pack_ceremony", `pack_purchased:${pack!.id}`); router.push(`/abrir/${pack!.id}`); }
      else notify(res.error ?? "No se pudo comprar el sobre", false);
    } catch {
      notify("Error de red. Inténtalo de nuevo.", false);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }


  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:py-8">
      <Link href="/packs" className="nx-focus mb-5 inline-flex items-center gap-1 text-caption text-ink-muted hover:text-white">
        ← Sobres
      </Link>

      <div className="grid gap-6 md:grid-cols-[minmax(0,340px)_1fr] md:gap-10">
        {/* ── Artwork grande ── */}
        <div className="flex items-start justify-center">
          <div className="relative" style={{ filter: "drop-shadow(0 24px 48px rgba(0,0,0,0.55))" }}>
            <SealedPack pack={pack} cutProgress={0} width={300} />
          </div>
        </div>

        {/* ── Ficha ── */}
        <div className="flex flex-col">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="info" solid>{id.categoryLabel}</Badge>
            {id.monogram && <Badge tone="muted">{id.monogram}</Badge>}
            {owned > 0 && <Badge tone="info" dot>{owned} sin abrir</Badge>}
          </div>

          <h1 className="mt-3 font-display text-3xl font-bold uppercase leading-none text-white">{pack.name}</h1>
          {pack.description && <p className="mt-2 max-w-lg text-sm text-ink-muted">{pack.description}</p>}

          <div className="mt-5 flex flex-wrap items-end gap-x-8 gap-y-3">
            <Readout size="md" label="Precio" value={offer ? offer.priceLabel : gratis ? "Gratis" : formatCredits(pack.price)} unit={gratis ? undefined : "créditos"} tone={offer && offer.priceLabel !== "Gratis" ? undefined : gratis ? "var(--nx-ok)" : "var(--nx-gold)"} />
            <Readout size="sm" label="Contiene" value={pack.cardCount} unit={pack.cardCount === 1 ? "carta" : "cartas"} />
            <Readout size="sm" label="Tu saldo" value={formatCredits(credits)} unit="créditos" />
          </div>

          {/* ── Probabilidades comprensibles (Fase 25): por carta, por sobre, garantía, equipo ── */}
          <PackOddsPanel odds={odds} />

          {/* ── CTA (Fase 41: componente compartido con el arnés) ── */}
          <PackPurchaseCta pack={pack} cta={cta} credits={credits} owned={owned} offer={offer} busy={busy} onAction={handleCta} />
        </div>
      </div>

      <Toast toast={toast} />
    </div>
  );
}
