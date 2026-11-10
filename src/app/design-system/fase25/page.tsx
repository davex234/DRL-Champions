"use client";

/**
 * ARNÉS QA · FASE 25 — `/design-system/fase25` (solo para capturas y revisión; no es una pantalla de juego).
 *
 * Siembra el estado LOCAL (sin sesión, sin servidor) con propiedad **QA SYNTHETIC** sobre el
 * catálogo REAL: cartas reales, sobres reales, seriales inventados, instancias inventadas. Nada
 * se escribe en ninguna base de datos. Con `?seed=1` rellena `useGameStore` (modo local del juego)
 * y desde aquí se enlazan las pantallas reales para fotografiarlas: hub, ficha, ceremonia,
 * colección, equipos. También expone en la propia página los componentes que exigen sesión
 * («Añadir al equipo» con un mazo de mentira) para poder verlos sin cuenta.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useGameStore } from "@/store/useGameStore";
import { CARDS, getPlayer } from "@/data/catalog";
import { getPack } from "@/data/packs";
import { packStats } from "@/data/packStats";
import { getVariant } from "@/domain/cards/variants";
import { packOddsFor } from "@/domain/packs/odds";
import { teamCardCount } from "@/components/packs/packIdentity";
import { PackOddsPanel } from "@/components/packs/PackOdds";
import { MyPacks } from "@/components/packs/MyPacks";
import { LoopStrip } from "@/components/lobby/LoopStrip";
import { AddToDeckSheet } from "@/components/deck/AddToDeckSheet";
import type { DeckCardLike } from "@/domain/cardgame/deckInsert";
import type { DuelDeckDTO } from "@/lib/duel/types";
import type { OwnedCard } from "@/domain/cards/types";
import { NxButton } from "@/components/ui/NxButton";
import { Badge } from "@/components/ui/Badge";
import { HydrationGate } from "@/components/layout/HydrationGate";

/** Propiedad sintética: 28 cartas reales, dos duplicadas, una de serie baja, tres recientes. */
function syntheticOwned(now: number): OwnedCard[] {
  const pool = CARDS.filter((c) => getPlayer(c.playerId)).slice(0, 60);
  const pick = (i: number) => pool[i % pool.length];
  const out: OwnedCard[] = [];
  for (let i = 0; i < 26; i++) out.push({ uid: `qa-${i}`, cardId: pick(i * 2).id, obtainedAt: now - (i + 2) * 3600_000 * 6, serial: i % 3 === 0 ? 100 + i : undefined });
  out.push({ uid: "qa-dup-1", cardId: pick(0).id, obtainedAt: now - 3600_000, serial: 842 });
  out.push({ uid: "qa-dup-2", cardId: pick(2).id, obtainedAt: now - 1800_000, serial: 3 });
  out.push({ uid: "qa-recent", cardId: pick(31).id, obtainedAt: now - 600_000 });
  return out;
}

const like = (uid: string, i: number): DeckCardLike | null => {
  const c = CARDS.filter((x) => x.combat && getPlayer(x.playerId))[i];
  if (!c) return null;
  const p = getPlayer(c.playerId)!;
  return { uid, cardId: c.id, playerId: c.playerId, nick: p.nick, role: c.role ?? p.role, variantId: c.variantId, ovr: c.ovr, combat: c.combat!, serial: null };
};

export default function Fase25QaPage() {
  return (
    <HydrationGate>
      <Harness />
    </HydrationGate>
  );
}

function Harness() {
  // Sin `useSearchParams` (exige Suspense en el export estático): la query se lee en el cliente.
  const [seed, setSeed] = useState(false);
  const [scene, setScene] = useState("");
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setSeed(q.get("seed") === "1");
    setScene(q.get("scene") ?? "");
  }, []);
  const [seeded, setSeeded] = useState(false);
  const [sheet, setSheet] = useState(false);
  const unopened = useGameStore((s) => s.unopenedPacks);
  const ownedCards = useGameStore((s) => s.ownedCards);

  useEffect(() => {
    if (!seed) return;
    const now = Date.now();
    useGameStore.setState({
      ownedCards: syntheticOwned(now),
      unopenedPacks: { estandar: 4, premium: 1, "team-heretics": 2 },
      credits: 12_500,
    });
    setSeeded(true);
  }, [seed]);

  const th = getPack("team-heretics");
  const odds = useMemo(() => (th ? packOddsFor(th, packStats(th.id) ?? null, teamCardCount("Team Heretics").total) : null), [th]);
  const candidate = like("qa-new", 0);
  const fakeDeck: DuelDeckDTO | null = useMemo(() => {
    const cards = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => like(`qa-deck-${i}`, i * 3)).filter((c): c is DeckCardLike => !!c);
    // Dos del mismo rol que el candidato para forzar la comparación.
    if (!candidate) return null;
    const seenPlayers = new Set<string>();
    const sameRole = CARDS.filter((x) => x.combat && (x.role ?? getPlayer(x.playerId)?.role) === candidate.role && x.playerId !== candidate.playerId)
      .filter((x) => (seenPlayers.has(x.playerId) ? false : (seenPlayers.add(x.playerId), true))).slice(0, 2)
      .map((c, i) => { const p = getPlayer(c.playerId)!; return { uid: `qa-role-${i}`, cardId: c.id, playerId: c.playerId, nick: p.nick, role: c.role ?? p.role, variantId: c.variantId, ovr: c.ovr, combat: c.combat!, serial: null } as DeckCardLike; });
    const all = [...sameRole, ...cards.filter((c) => c.role !== candidate.role)].slice(0, 10);
    return {
      id: "qa-deck", name: "QA SYNTHETIC · Mi equipo", cardUids: all.map((c) => c.uid), valid: false, status: "INCOMPLETE",
      roleCounts: { Duelista: 0, Controlador: 0, Iniciador: 0, Centinela: 0, Flex: 0 }, missingByRole: { Duelista: 0, Controlador: 0, Iniciador: 0, Centinela: 0, Flex: 0 },
      errors: [], sumOvr: all.reduce((s, c) => s + c.ovr, 0), updatedAt: Date.now(),
      cards: all.map((c) => ({ uid: c.uid, cardId: c.cardId, playerId: c.playerId, nick: c.nick, team: getPlayer(c.playerId)!.team, country: "", role: c.role, region: getPlayer(c.playerId)!.region, variantId: c.variantId, ovr: c.ovr, combat: c.combat, serial: null })),
    } as DuelDeckDTO;
  }, [candidate]);

  useEffect(() => { if (scene === "deck") setSheet(true); }, [scene]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Badge tone="warn" solid>QA SYNTHETIC</Badge>
        <h1 className="font-display text-2xl font-bold uppercase text-white">Arnés Fase 25</h1>
        <span className="text-caption text-ink-faint">Catálogo real · propiedad inventada · sin servidor</span>
        {seeded && <Badge tone="ok" dot>Estado local sembrado</Badge>}
      </div>

      <div className="mb-8 flex flex-wrap gap-2">
        {!seeded && <NxButton variant="primary" size="md" href="/design-system/fase25?seed=1">Sembrar estado QA</NxButton>}
        <NxButton variant="secondary" size="md" href="/packs">Pack Hub</NxButton>
        <NxButton variant="secondary" size="md" href="/packs/team-heretics">Ficha Team Heretics</NxButton>
        <NxButton variant="secondary" size="md" href="/abrir/estandar">Ceremonia (estándar)</NxButton>
        <NxButton variant="secondary" size="md" href="/coleccion">Colección</NxButton>
        <NxButton variant="secondary" size="md" href="/coleccion/equipos">Equipos</NxButton>
        <NxButton variant="secondary" size="md" href="/">Home</NxButton>
      </div>

      <section className="mb-10">
        <h2 className="nx-label mb-3">Tira del bucle (home)</h2>
        <LoopStrip unopened={unopened} owned={ownedCards} deck={{ name: "QA SYNTHETIC · Mi equipo", size: 8, valid: false }} />
      </section>

      <section className="mb-10">
        <h2 className="nx-label mb-3">Mis sobres (agrupados)</h2>
        <MyPacks />
      </section>

      {odds && (
        <section className="mb-10">
          <h2 className="nx-label">Probabilidades · Team Heretics (medidas)</h2>
          <PackOddsPanel odds={odds} />
        </section>
      )}

      <section className="mb-10">
        <h2 className="nx-label mb-3">Del sobre al mazo · comparación</h2>
        <p className="mb-3 text-sm text-ink-muted">
          Mazo de mentira con el rol del candidato lleno: obliga a elegir a quién sustituir. Guardar no llama al servidor aquí.
        </p>
        <NxButton variant="primary" size="md" onClick={() => setSheet(true)} disabled={!candidate || !fakeDeck}>Abrir «Añadir al equipo»</NxButton>
        {sheet && candidate && fakeDeck && (
          <AddToDeckSheet
            card={candidate}
            origin="qa"
            onClose={() => setSheet(false)}
            loadDecks={async () => ({ decks: [fakeDeck] })}
            persist={async (input) => ({ deck: { ...fakeDeck, cardUids: input.cardUids, valid: input.cardUids.length === 10 } })}
          />
        )}
      </section>

      <p className="text-caption text-ink-faint">
        Rarezas reales del catálogo: {[...new Set(CARDS.map((c) => getVariant(c.variantId).label))].slice(0, 8).join(" · ")}…
        {" "}<Link href="/design-system" className="underline">Volver al sistema de diseño</Link>
      </p>
    </div>
  );
}
