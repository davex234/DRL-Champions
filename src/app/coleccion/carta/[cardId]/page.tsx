"use client";

/**
 * `/coleccion/carta/[cardId]` — FICHA DE CARTA (Fase 37). Enlace estable a una DEFINICIÓN del catálogo: funciona sin
 * sesión y aunque no tengas la carta (datos públicos). Con sesión añade TUS copias, seriales, favorita, vitrina y
 * equipos, leídos del servidor. Nunca muestra copias, seriales ni dueños de otros jugadores: no existe forma de pedirlos.
 */
import { use, useMemo, useState } from "react";
import Link from "next/link";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { getCard, getPlayer } from "@/data/catalog";
import { PACKS } from "@/data/packs";
import { CardRegistry } from "@/collection";
import { cardTeamKeyOf, isValidCardId, packsThatCanContain, playerVariants } from "@/domain/collection/room";
import { CardDetailView } from "@/components/collectionRoom/CardDetailView";
import { useCollectionRoom } from "@/components/collectionRoom/useCollectionRoom";
import { AddToDeckSheet } from "@/components/deck/AddToDeckSheet";
import type { DeckCardLike } from "@/domain/cardgame/deckInsert";
import { saveShowcase } from "@/lib/player/client";
import { NxButton } from "@/components/ui/NxButton";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("coleccion");

export default function CardPage({ params }: { params: Promise<{ cardId: string }> }) {
  const { cardId } = use(params);
  return <HydrationGate><CardRoute raw={cardId} /></HydrationGate>;
}

function decode(raw: string): string {
  try { return decodeURIComponent(raw); } catch { return ""; }
}

function CardRoute({ raw }: { raw: string }) {
  useLocale();
  const id = decode(raw);
  const room = useCollectionRoom();
  const [deckCard, setDeckCard] = useState<DeckCardLike | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<"fav" | "showcase" | null>(null);

  const def = isValidCardId(id) ? getCard(id) : undefined;
  const player = def ? getPlayer(def.playerId) : undefined;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const registry = useMemo(() => new CardRegistry(), [room.cards]);
  const availability = useMemo(() => {
    if (!def) return null;
    try { return packsThatCanContain(registry, PACKS, def); } catch { return null; }
  }, [registry, def]);

  if (!def || !player) {
    return (
      <div className="nx-clip-sm mx-auto max-w-lg border border-white/10 bg-black/30 p-6 text-center" data-testid="card-not-found">
        <h1 className="font-display text-[24px] font-bold uppercase text-white">{t("Carta no encontrada")}</h1>
        <p className="mt-2 text-body text-ink-muted">{t("Ese enlace no corresponde a ninguna carta del catálogo de NEXUS.")}</p>
        <NxButton variant="primary" size="md" href="/coleccion" className="mt-4">{t("Ir a la colección")}</NxButton>
      </div>
    );
  }

  const ownership = room.access === "anon" ? null : room.snap.byCard.get(def.id) ?? null;
  const rep = ownership?.instances[0] ?? null;
  const showcaseData = room.personal.data?.showcase ?? null;
  const teamKey = cardTeamKeyOf(def, player).key;

  async function toggleFavorite() {
    setBusy("fav"); setMessage(null);
    const r = await room.personal.toggleFavorite(def!.id);
    if (!r.ok && r.message) setMessage(r.message);
    setBusy(null);
  }

  async function addShowcase(uid: string) {
    if (!showcaseData) return;
    setBusy("showcase"); setMessage(null);
    try {
      await saveShowcase([...showcaseData.uids, uid].slice(0, 3), showcaseData.version);
      setMessage(t("Añadida a tu vitrina."));
      room.personal.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : t("No se pudo guardar la vitrina"));
    } finally {
      setBusy(null);
    }
  }

  const deckCandidate: DeckCardLike | null = rep && def.combat
    ? { uid: rep.uid, cardId: def.id, playerId: def.playerId, nick: player.nick, role: def.role ?? player.role, variantId: def.variantId, ovr: def.ovr, combat: def.combat, serial: rep.serial ?? null }
    : null;

  return (
    <div className="space-y-5">
      <nav aria-label={t("Migas")} className="flex flex-wrap items-center gap-2 text-caption text-ink-muted">
        <Link href="/coleccion" className="nx-focus inline-flex min-h-[44px] items-center hover:text-white">{t("← Colección")}</Link>
        <span aria-hidden>/</span>
        <span className="text-white/80">{player.nick}</span>
      </nav>
      <CardDetailView
        def={def}
        player={player}
        access={room.access}
        loading={room.loading}
        offline={room.access === "server" && room.offline}
        ownership={ownership}
        variants={playerVariants(room.cards, def.playerId, room.access === "anon" ? null : room.snap)}
        availability={availability}
        sets={{
          team: room.snap.sets.team.find((s) => s.key === teamKey) ?? null,
          region: room.snap.sets.region.find((s) => s.key === player.region) ?? null,
        }}
        decks={room.personal.data?.decks ?? null}
        favorite={{ available: room.snap.favoritesAvailable, active: room.snap.favorites.includes(def.id), busy: busy === "fav", onToggle: toggleFavorite }}
        showcase={{ available: room.snap.showcaseAvailable && !!showcaseData, count: showcaseData?.uids.length ?? 0, busy: busy === "showcase", onAdd: addShowcase }}
        onAddToDeck={deckCandidate ? () => setDeckCard(deckCandidate) : undefined}
        message={td(message)}
      />
      {deckCard && <AddToDeckSheet card={deckCard} origin="card_detail" onClose={() => { setDeckCard(null); room.personal.refresh(); }} />}
    </div>
  );
}
