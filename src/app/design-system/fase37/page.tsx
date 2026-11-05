"use client";

/**
 * ARNÉS QA · FASE 37 — `/design-system/fase37?scene=<escena>` (solo capturas y revisión).
 *
 * Renderiza la sala REAL (`CollectionRoomScreen`), la ficha REAL (`CardDetailView`) y el comparador REAL
 * (`CardCompareView`) con el catálogo real y copias QA SYNTHETIC (`./fixtures`). Sin sesión, sin red, sin BD.
 */
import { useEffect, useMemo, useState } from "react";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { CARDS, getCard, getPlayer } from "@/data/catalog";
import { PACKS } from "@/data/packs";
import { CardRegistry } from "@/collection";
import { buildCollectionSnapshot, packsThatCanContain, playerVariants, cardTeamKeyOf } from "@/domain/collection/room";
import { DEFAULT_QUERY, type CollectionQuery } from "@/domain/collection/query";
import { CollectionRoomScreen } from "@/components/collectionRoom/CollectionRoomScreen";
import { CardDetailView } from "@/components/collectionRoom/CardDetailView";
import { CardCompareView } from "@/components/collectionRoom/CardCompareView";
import { aliasesFrom, roomEngine, teamIndexOf, teamOptionsOf, type CollectionRoomModel } from "@/components/collectionRoom/roomModel";
import { SCENES, type CompareScene, type DetailScene, type HubScene } from "./fixtures";

export default function Fase37QaPage() {
  return <HydrationGate><Harness /></HydrationGate>;
}

function Harness() {
  const [scene, setScene] = useState<string | null>(null);
  useEffect(() => { setScene(new URLSearchParams(window.location.search).get("scene") ?? "hub-veteran"); }, []);
  if (scene === null) return null;
  const s = SCENES[scene];
  if (!s) return <p className="text-caption text-ink-muted">Escena desconocida. Disponibles: {Object.keys(SCENES).join(", ")}</p>;
  return (
    <div className="space-y-3" data-scene={scene}>
      <p className="border border-drl-gold/30 bg-drl-gold/[0.06] px-3 py-1 text-[11px] text-drl-gold/90" data-synthetic="true">
        QA SYNTHETIC · {s.note} · catálogo real, copias inventadas
      </p>
      {s.kind === "hub" && <Hub s={s} />}
      {s.kind === "detail" && <Detail s={s} />}
      {s.kind === "compare" && <Compare s={s} />}
    </div>
  );
}

function Hub({ s }: { s: HubScene }) {
  const [query, setQuery] = useState<CollectionQuery>({ ...DEFAULT_QUERY, ...s.query });
  const room = useMemo<CollectionRoomModel>(() => {
    const snap = buildCollectionSnapshot(CARDS, getPlayer, s.facts);
    const index = teamIndexOf(CARDS);
    return {
      access: s.access, loading: !!s.loading, offline: !!s.offline, stale: !!s.stale,
      snap, engine: roomEngine(s.facts.instances, snap.favorites), teamOptions: teamOptionsOf(index), aliasesOf: aliasesFrom(index),
    };
  }, [s]);
  return (
    <CollectionRoomScreen room={room} query={query} onQuery={setQuery} onOpen={() => {}} packs={s.packs ?? 0}
      forge={<p className="text-caption text-ink-muted">Forja: pieza existente, fuera del arnés.</p>} />
  );
}

function Detail({ s }: { s: DetailScene }) {
  const def = getCard(s.cardId)!;
  const player = getPlayer(def.playerId)!;
  const snap = useMemo(() => buildCollectionSnapshot(CARDS, getPlayer, s.facts), [s]);
  const [fav, setFav] = useState(() => snap.favorites.includes(def.id));
  const ownership = s.access === "anon" ? null : snap.byCard.get(def.id) ?? null;
  const availability = useMemo(() => (s.availabilityError ? null : packsThatCanContain(new CardRegistry(), PACKS, def)), [s, def]);
  const teamKey = cardTeamKeyOf(def, player).key;
  return (
    <div className="space-y-5">
      <nav aria-label="Migas" className="flex flex-wrap items-center gap-2 text-caption text-ink-muted">
        <span className="inline-flex min-h-[44px] items-center">← Colección</span>
        <span aria-hidden>/</span>
        <span className="text-white/80">{player.nick}</span>
      </nav>
      <CardDetailView
        def={def}
        player={player}
        access={s.access}
        loading={s.loading}
        offline={s.offline}
        ownership={ownership}
        variants={playerVariants(CARDS, def.playerId, s.access === "anon" ? null : snap)}
        availability={availability}
        sets={{ team: snap.sets.team.find((x) => x.key === teamKey) ?? null, region: snap.sets.region.find((x) => x.key === player.region) ?? null }}
        decks={s.facts.decks}
        favorite={{ available: snap.favoritesAvailable, active: fav, onToggle: () => setFav((v) => !v) }}
        showcase={{ available: snap.showcaseAvailable, count: s.facts.showcaseUids?.length ?? 0, onAdd: () => {} }}
        onAddToDeck={ownership && def.combat ? () => {} : undefined}
        message={s.message ?? null}
        initialFlipped={s.flipped}
      />
    </div>
  );
}

function Compare({ s }: { s: CompareScene }) {
  const a = getCard(s.a)!;
  const [b, setB] = useState(() => (s.b ? getCard(s.b) ?? null : null));
  const owned = useMemo(() => new Set(buildCollectionSnapshot(CARDS, getPlayer, s.facts).byCard.keys()), [s]);
  return (
    <div className="space-y-5">
      <header>
        <p className="font-display text-[12px] font-bold uppercase tracking-[0.18em] text-drl-cyan">Colección</p>
        <h1 className="font-display text-[clamp(28px,5vw,46px)] font-bold uppercase leading-none text-white">Comparar cartas</h1>
      </header>
      <CardCompareView a={a} b={b} candidates={[...CARDS]} ownedIds={owned} onPickB={(id) => setB(getCard(id) ?? null)} />
    </div>
  );
}
