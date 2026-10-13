"use client";

/**
 * `/coleccion/comparar?a=<cardId>&b=<cardId>` — COMPARAR DOS CARTAS (Fase 37). Definiciones públicas del catálogo;
 * primero se proponen las tuyas. Los ids de la URL se validan contra el formato y el catálogo: nada más se interpreta.
 */
import { Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { getCard } from "@/data/catalog";
import { compareHref, isValidCardId } from "@/domain/collection/room";
import { CardCompareView } from "@/components/collectionRoom/CardCompareView";
import { useCollectionRoom } from "@/components/collectionRoom/useCollectionRoom";
import { NxButton } from "@/components/ui/NxButton";

export default function ComparePage() {
  return <HydrationGate><Suspense fallback={null}><Compare /></Suspense></HydrationGate>;
}

function Compare() {
  const params = useSearchParams();
  const router = useRouter();
  const room = useCollectionRoom();
  const rawA = params.get("a"); const rawB = params.get("b");
  const a = isValidCardId(rawA) ? getCard(rawA) : undefined;
  const b = isValidCardId(rawB) ? getCard(rawB) ?? null : null;

  return (
    <div className="space-y-5">
      <nav aria-label="Migas" className="text-caption text-ink-muted">
        <Link href={a ? `/coleccion/carta/${encodeURIComponent(a.id)}` : "/coleccion"} className="nx-focus inline-flex min-h-[44px] items-center hover:text-white">← {a ? "Volver a la ficha" : "Colección"}</Link>
      </nav>
      <header>
        <p className="font-display text-[12px] font-bold uppercase tracking-[0.18em] text-drl-cyan">Colección</p>
        <h1 className="font-display text-[clamp(28px,5vw,46px)] font-bold uppercase leading-none text-white">Comparar cartas</h1>
      </header>
      {!a ? (
        <div className="nx-clip-sm border border-white/10 bg-black/30 p-6 text-center" data-testid="compare-missing">
          <p className="text-body text-ink-muted">Abre la ficha de una carta y pulsa «Comparar» para elegir con cuál.</p>
          <NxButton variant="primary" size="md" href="/coleccion" className="mt-3">Ir a la colección</NxButton>
        </div>
      ) : (
        <CardCompareView a={a} b={b} candidates={room.cards} ownedIds={new Set(room.snap.byCard.keys())} onPickB={(id) => router.replace(compareHref(a.id, id))} />
      )}
    </div>
  );
}
