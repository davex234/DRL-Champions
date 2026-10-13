"use client";

/**
 * COLLECTION ROOM · ESTADO COMPARTIDO (Fase 37) — álbum, ficha de carta y comparador leen de aquí.
 *
 *   definiciones   → catálogo público (`CARDS`, se reconstruye si cambia el roster)
 *   instancias     → con sesión: la foto del servidor (`/api/game/collection`); mientras llega, la copia sincronizada
 *                    del store (misma fuente, `/api/game/state`). Sin Supabase: la colección local. Sin sesión: ninguna.
 *   favoritos, vitrina, equipos → solo del servidor; `null` si no hay (no se inventan).
 *
 * Todo lo derivado (progreso, sets, filtros, orden) es puro y se calcula aquí, sin pedir nada por carta.
 */
import { useMemo } from "react";
import { CARDS, getPlayer } from "@/data/catalog";
import type { OwnedCard } from "@/collection";
import { buildCollectionSnapshot, type OwnedInstanceFact } from "@/domain/collection/room";
import { useAuth } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { useGameStore } from "@/store/useGameStore";
import { useRosterStore } from "@/store/useRosterStore";
import { useCollectionPersonal } from "@/lib/collection/client";
import { aliasesFrom, roomEngine, teamIndexOf, teamOptionsOf, type CollectionAccess, type CollectionRoomModel } from "./roomModel";

export type { CollectionAccess };

const toFact = (o: OwnedCard): OwnedInstanceFact => ({ uid: o.uid, cardId: o.cardId, serial: o.serial ?? null, mintedVersion: o.mintedVersion ?? null });

export function useCollectionRoom() {
  const configured = isSupabaseConfigured();
  const { user, loading: authLoading } = useAuth();
  const signedIn = configured && !!user;
  const storeCards = useGameStore((s) => s.ownedCards);
  const rosterVersion = useRosterStore((s) => s.version);
  const personal = useCollectionPersonal({ enabled: signedIn && !authLoading, userKey: user?.id ?? null });
  const access: CollectionAccess = !configured ? "local" : signedIn || authLoading ? "server" : "anon";

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cards = useMemo(() => [...CARDS], [rosterVersion]);

  const instances = useMemo<OwnedInstanceFact[]>(() => {
    if (signedIn) return personal.data?.instances ?? storeCards.map(toFact);
    if (!configured) return storeCards.map(toFact);
    return [];
  }, [signedIn, configured, personal.data, storeCards]);

  const snap = useMemo(() => buildCollectionSnapshot(cards, getPlayer, {
    instances,
    favorites: signedIn ? personal.data?.favorites ?? null : null,
    showcaseUids: signedIn ? personal.data?.showcase?.uids ?? null : null,
    decks: signedIn ? personal.data?.decks ?? null : null,
  }), [cards, instances, signedIn, personal.data]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const engine = useMemo(() => roomEngine(instances, snap.favorites), [instances, snap.favorites, rosterVersion]);
  const teamIndex = useMemo(() => teamIndexOf(cards), [cards]);
  const teamOptions = useMemo(() => teamOptionsOf(teamIndex), [teamIndex]);
  const aliasesOf = useMemo(() => aliasesFrom(teamIndex), [teamIndex]);

  const loading = access === "server" && (authLoading || (personal.status === "loading" && !personal.data && storeCards.length === 0));
  const model: CollectionRoomModel = {
    access, loading, snap, engine, teamOptions, aliasesOf,
    offline: personal.status === "offline" || !personal.online, stale: personal.stale,
  };

  return { ...model, signedIn, cards, instances, personal };
}
