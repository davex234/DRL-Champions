"use client";

/**
 * PUENTE entre el servidor y el store de UI.
 *
 * Con sesión iniciada, `useGameStore` deja de ser la autoridad y pasa a ser una
 * caché de presentación: estas funciones piden la operación al servidor y luego
 * vuelcan el estado devuelto. Así la UI existente (tienda, apertura de sobres,
 * colección) sigue funcionando sin reescribirla, pero ya no decide nada.
 *
 * Sin sesión el juego mantiene su modo local, que es un modo legítimo de un solo
 * jugador — pero entonces nada de eso cuenta para ranking, torneos ni recompensas.
 */
import { useGameStore, type OpenedResult } from "@/store/useGameStore";
import { getCard } from "@/data/catalog";
import {
  fetchGameState, buyPack as apiBuyPack, openPack as apiOpenPack,
  buyAndOpenPack as apiBuyAndOpen, type OpenedCardDTO,
} from "./client";

/** Vuelca en el store el estado real del servidor. Devuelve false si no hay sesión. */
export async function syncFromServer(): Promise<boolean> {
  const state = await fetchGameState();
  if (!state) return false;
  useGameStore.getState().applyServerState({
    credits: state.credits,
    xp: state.xp,
    ownedCards: state.ownedCards,
    origins: state.origins,
    lockedUids: state.lockedUids,
    unopenedPacks: state.unopenedPacks,
    pityState: state.pity,
    packsOpened: state.packsOpened,
    mintCounts: state.mintCounts,
  });
  return true;
}

/** Traduce el resultado del servidor a la forma que ya consume la animación. */
function toOpenedResults(opened: OpenedCardDTO[]): OpenedResult[] {
  const out: OpenedResult[] = [];
  for (const o of opened) {
    const card = getCard(o.cardId);
    if (!card) continue; // carta fuera del catálogo vivo: no se muestra basura
    out.push({
      uid: o.uid,
      card,
      serial: o.serial ?? undefined,
      isNew: o.isNew,
      value: o.value,
    });
  }
  return out;
}

/** Compra un sobre en el servidor y refresca la caché. */
export async function buyPackOnline(packId: string): Promise<void> {
  await apiBuyPack(packId);
  await syncFromServer();
}

/**
 * Abre un sobre en el servidor.
 * Deja el resultado en `lastOpened` para que la pantalla de revelado lo anime.
 */
export async function openPackOnline(packId: string): Promise<OpenedResult[]> {
  const res = await apiOpenPack(packId);
  const results = toOpenedResults(res.opened);
  await syncFromServer();
  useGameStore.getState().setLastOpened(results);
  return results;
}

/** Compra y abre en un solo gesto (lo que hace la tienda). */
export async function buyAndOpenOnline(packId: string): Promise<OpenedResult[]> {
  const res = await apiBuyAndOpen(packId);
  const results = toOpenedResults(res.opened);
  await syncFromServer();
  useGameStore.getState().setLastOpened(results);
  return results;
}
