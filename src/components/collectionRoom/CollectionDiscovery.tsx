"use client";

/**
 * COLLECTION ROOM · DESCUBRIR (Fase 37). Formas de recorrer la colección sin buscar nada concreto, SOLO con hechos:
 * tus favoritas y tus cartas de mayor OVR. Sin recomendador. LIMPIEZA DE /COLECCION (2026-10-07): «Casi completos» (sets)
 * sale de la página de cartas; los sets viven en la Sala de Trofeos. `snap.nearComplete` sigue en la foto (dominio intacto).
 */
import Link from "next/link";
import type { CardDef } from "@/domain/cards/types";
import { cardHref } from "@/domain/collection/room";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("collectionRoom");

const ROW = 8;

export function CollectionDiscovery({ favorites, topOwned }: {
  favorites: CardDef[];
  topOwned: CardDef[];
}) {
  useLocale();
  if (favorites.length === 0 && topOwned.length === 0) return null;
  return (
    <section aria-label={t("Descubrir tu colección")} data-testid="collection-discovery" className="space-y-4">
      {favorites.length > 0 && <CardRow title={t("Tus favoritas")} cards={favorites.slice(0, ROW)} testId="discovery-favorites" />}
      {topOwned.length > 0 && <CardRow title={t("Tus cartas de mayor OVR")} cards={topOwned.slice(0, ROW)} testId="discovery-top" />}
    </section>
  );
}

function CardRow({ title, cards, testId }: { title: string; cards: CardDef[]; testId: string }) {
  useLocale();
  return (
    <div data-testid={testId}>
      <h2 className="mb-2 font-display text-[15px] font-bold uppercase tracking-[0.08em] text-white">{td(title)}</h2>
      {/* Fase 44.1 · hueco arriba para que la carta pueda «salir de la pared» sin que el carril la recorte. */}
      <ul className="-mt-2 flex gap-3 overflow-x-auto pb-3 pt-3">
        {cards.map((c) => (
          <li key={c.id} className="nx-card-lift relative shrink-0">
            <Link href={cardHref(c.id)} className="nx-focus block w-[150px]" aria-label={t("Abrir ficha de {id}, OVR {ovr}", { id: c.id, ovr: c.ovr })}>
              <PlayerCard card={c} size="sm" interactive={false} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
