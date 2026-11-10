"use client";

/**
 * `/coleccion` — COLLECTION ROOM 3.0 (Fase 37). «Tengo 100 cartas» → «Esta es mi colección».
 *
 * La ruta conecta la pantalla (`CollectionRoomScreen`) con tu sesión (`useCollectionRoom`: catálogo público + tu foto
 * del servidor) y con la URL: búsqueda, filtros y orden viven en la dirección (`?q=…&rareza=…`), así se comparten y
 * sobreviven a recargar. La URL nunca autoriza nada: solo describe qué mirar. Tocar una carta abre su ficha estable
 * (`/coleccion/carta/[cardId]`), también si no la tienes. Sin precios, valores, ventas ni mercado.
 *
 * Se conserva la Forja (pestaña). LIMPIEZA DE /COLECCION (2026-10-07): la página es MIS CARTAS. Lo que no son cartas
 * sigue en su sitio canónico, sin duplicarse aquí: sets e insignias (F82 + Maestría y Prestigio) en la Sala de Trofeos
 * (`/coleccion/trofeos`); objetivos y logros de colección en Progresión (`/progresion`) y Logros (`/logros`).
 */
import { Suspense, useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { ForgeGate } from "@/components/craft/ForgeGate";
import { cardHref } from "@/domain/collection/room";
import { parseCollectionQuery, serializeCollectionQuery, type CollectionQuery } from "@/domain/collection/query";
import { CollectionRoomScreen } from "@/components/collectionRoom/CollectionRoomScreen";
import { useCollectionRoom } from "@/components/collectionRoom/useCollectionRoom";
import { useGameStore } from "@/store/useGameStore";
import { useAuth } from "@/lib/supabase/auth";
import { useOnboarding } from "@/lib/onboarding/client";

export default function ColeccionPage() {
  return (
    <HydrationGate>
      <Suspense fallback={null}>
        <CollectionRoute />
      </Suspense>
    </HydrationGate>
  );
}

function CollectionRoute() {
  const room = useCollectionRoom();
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const unopenedPacks = useGameStore((s) => s.unopenedPacks);
  /* F63 · la guía de la primera sesión (del servidor, compartida con las demás pantallas). */
  const onboarding = useOnboarding(user?.id ?? null, room.signedIn);

  const query = useMemo(() => parseCollectionQuery(new URLSearchParams(params.toString())), [params]);
  const setQuery = useCallback((q: CollectionQuery) => {
    const s = serializeCollectionQuery(q);
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }, [router, pathname]);

  const totalPacks = Object.values(unopenedPacks).reduce((s, n) => s + n, 0);

  return (
    <CollectionRoomScreen room={room} query={query} onQuery={setQuery} onOpen={(id) => router.push(cardHref(id))} packs={totalPacks} forge={<ForgeGate />}
      onboarding={room.signedIn ? onboarding.view : undefined} />
  );
}
