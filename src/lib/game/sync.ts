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
import { loadPendingOpen, newOpenGesture, savePendingOpen, clearPendingOpen } from "./openRecovery";
import { useGameStore, type OpenedResult } from "@/store/useGameStore";
import { useArtworkStore } from "@/store/useArtworkStore";
import { getCard, registerServerCards } from "@/data/catalog";
import {
  fetchGameState, buyPack as apiBuyPack, openPack as apiOpenPack,
  buyAndOpenPack as apiBuyAndOpen, type OpenedCardDTO,
} from "./client";
import { ns } from "@/i18n/runtime";
import { beginCriticalOperation } from "@/i18n/critical";
import { fetchInstancesByUid, toOwnedCard } from "./instances";
import { useTeamStore } from "@/store/useTeamStore";
import { settleTeamCollections } from "@/lib/teamCollections/client";
import { summarizeSettle, useCollectionRewardStore } from "@/lib/teamCollections/rewardNotice";
import type { CardOrigin } from "@/collection";

const t = ns("game");

/** `uid` que los equipos del entrenador referencian y que el estado (un ejemplar por carta) no trae. */
async function pinnedInstances(have: readonly { uid: string }[]) {
  const known = new Set(have.map((o) => o.uid));
  const wanted = new Set<string>();
  for (const t of useTeamStore.getState().teams) {
    for (const u of [...t.starters, ...t.subs, ...(t.reserves ?? []), t.captainUid, t.iglUid, t.coachUid]) if (typeof u === "string" && !known.has(u)) wanted.add(u);
  }
  if (wanted.size === 0) return null;
  return fetchInstancesByUid([...wanted]);
}

/**
 * COLECCIONES ILIMITADAS · trae a la memoria ejemplares concretos que el estado (un ejemplar por carta) no incluye:
 * las cartas de un sobre recién abierto que son copias repetidas. Sin esto, el revelado pintaría esas copias sin el
 * artwork de SU versión (el artwork va por `uid`). Es presentación: si falla, no rompe la apertura, que ya ocurrió.
 */
export async function ensureInstances(uids: readonly string[]): Promise<void> {
  const have = new Set(useGameStore.getState().ownedCards.map((o) => o.uid));
  const missing = uids.filter((u) => !have.has(u));
  if (missing.length === 0) return;
  try {
    const r = await fetchInstancesByUid(missing);
    if (!r) return;
    useArtworkStore.getState().addArtworks(r.artworks);
    useGameStore.getState().addOwnedInstances(r.items.map(toOwnedCard), Object.fromEntries(r.items.map((i) => [i.uid, i.origin as CardOrigin])));
  } catch { /* presentación: el sobre ya está abierto */ }
}

/**
 * COLECCIONES POR EQUIPO · la primera compleción de un equipo (300 XP de temporada), sus XP pendientes cuando empieza
 * una temporada y las insignias regionales se guardan con `POST {action:"settle"}`. Antes solo se pedía al entrar en
 * Colecciones: quien completaba un equipo abriendo sobres y no entraba allí no cobraba nada. Ahora se pide también tras
 * cada sincronización con el servidor (al iniciar sesión, al recargar y tras las operaciones que cambian el
 * inventario), en segundo plano y como mucho una vez por minuto. El servidor decide y comprueba todo; repetirlo es
 * inofensivo; si falla (sin 0075, límite, red) no rompe nada y se reintenta en la próxima sincronización.
 */
export const COLLECTION_SETTLE_EVERY_MS = 60_000;
let lastCollectionSettle = -Infinity;
export function settleCollectionsInBackground(settle: () => Promise<unknown> = settleTeamCollections, now = Date.now()): boolean {
  if (now - lastCollectionSettle < COLLECTION_SETTLE_EVERY_MS) return false;
  lastCollectionSettle = now;
  void settle().then((r) => {
    // Lo que se acaba de guardar se avisa en el armazón (CollectionRewardNotice), aunque no se esté en Colecciones.
    const gained = summarizeSettle(r);
    if (gained) useCollectionRewardStore.getState().push(gained);
  }).catch(() => { /* se reintenta en la próxima sincronización o al entrar en Colecciones */ });
  return true;
}
/** Para pruebas. */
export const resetCollectionSettleThrottle = () => { lastCollectionSettle = -Infinity; };

/** Vuelca en el store el estado real del servidor. Devuelve false si no hay sesión. */
export async function syncFromServer(): Promise<boolean> {
  const state = await fetchGameState();
  if (!state) return false;
  /*
   * PRIMERO el catálogo, DESPUÉS el estado.
   *
   * El orden no es cosmético. Todo lo que pinta una carta la resuelve con `getCard()`, y una
   * carta creada desde el panel no está en el catálogo compilado del navegador: si el estado
   * entrara antes, la colección se pintaría una vez sin ella. Registrando primero, cuando el
   * store notifica el cambio la definición ya existe.
   */
  if (state.catalogPatch) {
    registerServerCards(state.catalogPatch.cards, state.catalogPatch.players);
  }
  /*
   * El artwork, TAMBIÉN antes que el estado, y por el mismo motivo que el catálogo: quien
   * pinta un ejemplar lo busca por `uid` en cuanto el store notifica, y si el mapa llegara
   * después la colección se pintaría una vez sin artwork y otra con él.
   */
  /*
   * COLECCIONES ILIMITADAS · el estado trae UN ejemplar por carta. Los equipos del entrenador guardan `uid` concretos
   * que pueden no ser ese ejemplar: se piden por `uid` ANTES de volcar el estado, para que ningún equipo se pinte un
   * instante como «carta inexistente». Si la consulta falla, se sigue sin ellos (el equipo lo dirá) y no se rompe la
   * sincronización.
   */
  const pinned = await pinnedInstances(state.ownedCards).catch(() => null);
  useArtworkStore.getState().setArtworks({ ...(state.artworks ?? {}), ...(pinned?.artworks ?? {}) });
  useGameStore.getState().applyServerState({
    credits: state.credits,
    xp: state.xp,
    ownedCards: pinned ? [...state.ownedCards, ...pinned.items.map(toOwnedCard)] : state.ownedCards,
    ownedCounts: state.ownedCounts ?? null,
    ownedTotal: state.ownedTotal ?? null,
    lockedCounts: state.lockedCounts ?? null,
    origins: state.origins,
    lockedUids: state.lockedUids,
    unopenedPacks: state.unopenedPacks,
    pityState: state.pity,
    packsOpened: state.packsOpened,
    mintCounts: state.mintCounts,
  }, state.ownerId ?? null);
  settleCollectionsInBackground();
  return true;
}

/**
 * F81.2 · la carga de la cuenta al iniciar sesión/recargar (CloudSync) y su reintento: deja en el store el estado del
 * servidor CON dueño, o el motivo del fallo (`syncError`) para que la pantalla ofrezca reintentar en vez de cargar para
 * siempre o caer a la demo. `isCurrent` = la petición sigue siendo la vigente (no la de una sesión anterior).
 */
export async function hydrateAccount(isCurrent: () => boolean = () => true): Promise<boolean> {
  if (isCurrent()) useGameStore.setState({ syncError: null });
  try {
    const ok = await syncFromServer();
    if (!ok && isCurrent()) useGameStore.setState({ syncError: t("Sin sesión") });
    return ok;
  } catch (e) {
    if (isCurrent()) {
      console.error("[sync] no se pudo cargar el estado del servidor:", e);
      useGameStore.setState({ syncError: e instanceof Error ? e.message : String(e) });
    }
    return false;
  }
}

/** F81.1 · resultado del servidor que no se puede presentar sin inventar o esconder nada. */
export const INVALID_OPEN_RESULT = "Resultado de apertura no válido";

/**
 * Traduce el resultado del servidor a la forma que ya consume la animación.
 *
 * F81.1 · ESTRICTO. Antes una carta que el catálogo vivo no conocía se SALTABA en silencio (el sobre enseñaba 4 de 5) y
 * una lista vacía acababa como «no tienes ese sobre». Ahora cualquier resultado que no sea exactamente presentable
 * (vacío, sin uid/cardId, uid repetido, carta desconocida) es un ERROR: la pantalla lo dice y no completa nada en local.
 * Lo que sí se presenta es EXACTAMENTE lo que devolvió el servidor, con su multiplicidad (dos copias = dos entradas).
 */
export function toOpenedResults(opened: unknown): OpenedResult[] {
  if (!Array.isArray(opened) || opened.length === 0) throw new Error(`${INVALID_OPEN_RESULT}: sin cartas`);
  const out: OpenedResult[] = [];
  const uids = new Set<string>();
  for (const raw of opened as OpenedCardDTO[]) {
    if (!raw || typeof raw.uid !== "string" || !raw.uid || typeof raw.cardId !== "string" || !raw.cardId) throw new Error(`${INVALID_OPEN_RESULT}: carta sin identificador`);
    if (uids.has(raw.uid)) throw new Error(`${INVALID_OPEN_RESULT}: ejemplar repetido`);
    uids.add(raw.uid);
    const o = raw;
    const card = getCard(o.cardId);
    if (!card) throw new Error(`${INVALID_OPEN_RESULT}: carta desconocida`);
    out.push({
      uid: o.uid,
      card,
      serial: o.serial ?? undefined,
      mintedVersion: o.mintedVersion ?? null,
      isNew: o.isNew,
      value: o.value,
    });
  }
  return out;
}

/** Compra un sobre en el servidor y refresca la caché. */
/** F68 · `ref` = clave de idempotencia del GESTO de compra: el mismo gesto reintentado nunca cobra dos veces. */
export async function buyPackOnline(packId: string, ref?: string): Promise<void> {
  // I18N · una compra en curso aplaza un cambio de idioma (no añade ni repite ninguna petición).
  const endCritical = beginCriticalOperation();
  try {
  await apiBuyPack(packId, ref);
  // F69 · la compra YA está cobrada: si la relectura falla, no se presenta como «compra fallida» (el HUD se pone al
  // día con la siguiente sincronización de CloudSync; reintentar con la misma clave no cobra dos veces).
  await syncFromServer().catch(() => undefined);
  } finally { endCritical(); }
}

/**
 * Abre un sobre en el servidor.
 * Deja el resultado en `lastOpened` para que la pantalla de revelado lo anime.
 */
export async function openPackOnline(packId: string, ref?: string): Promise<OpenedResult[]> {
  return (await openPackOutcome(packId, ref)).results;
}

/** Fase 38 · ¿hay una apertura de este sobre enviada y sin confirmar en esta pestaña? (recarga a mitad de la ida y vuelta) */
export const hasPendingOpen = (packId: string): boolean => loadPendingOpen(packId) !== null;

/**
 * Fase 38 · lo mismo que `openPackOnline`, diciendo además si el servidor DEVOLVIÓ una apertura ya hecha con esta clave
 * (`repeated`): la ceremonia la presenta como recuperación, no como un sobre nuevo.
 */
export async function openPackOutcome(packId: string, ref?: string): Promise<{ results: OpenedResult[]; repeated: boolean }> {
  /*
   * Fase 25 · UN GESTO POR APERTURA. Si hay una apertura pendiente de este sobre (la respuesta
   * anterior se perdió), se repite con el MISMO gesto: el servidor devuelve lo que ya guardó
   * (`economy_ops`) o abre por primera vez, nunca dos veces. El gesto se guarda ANTES de pedir,
   * para sobrevivir a una recarga a mitad de la ida y vuelta, y se borra al confirmar.
   */
  const gesture = ref ?? loadPendingOpen(packId) ?? newOpenGesture();
  savePendingOpen(packId, gesture);
  let res: Awaited<ReturnType<typeof apiOpenPack>>;
  try {
    res = await apiOpenPack(packId, gesture);
  } catch (e) {
    // «No tienes ese sobre» con clave nueva o ya confirmada: no hay nada que reintentar con este gesto.
    if (e instanceof Error && /No tienes ese sobre/i.test(e.message)) clearPendingOpen();
    throw e;
  }
  clearPendingOpen();
  /*
   * Se sincroniza ANTES de traducir el resultado. La apertura ya ocurrió en el servidor, así
   * que el estado que llega trae las instancias nuevas — y con ellas la definición de una
   * carta que el catálogo compilado no conoce. Traduciendo primero, `toOpenedResults` la
   * descartaría con su `if (!card) continue` y el sobre se abriría enseñando cuatro cartas
   * de cinco, sin decir por qué.
   */
  await syncFromServer();
  await ensureInstances(res.opened.map((o) => o.uid));
  const results = toOpenedResults(res.opened);
  useGameStore.getState().setLastOpened(results);
  return { results, repeated: res.repeated === true };
}

/** Compra y abre en un solo gesto (lo que hace la tienda). */
export async function buyAndOpenOnline(packId: string, ref?: string): Promise<OpenedResult[]> {
  const res = ref ? await apiBuyAndOpen(packId, ref) : await apiBuyAndOpen(packId);
  // Mismo orden que en `openPackOnline`, y por el mismo motivo.
  await syncFromServer();
  await ensureInstances(res.opened.map((o) => o.uid));
  const results = toOpenedResults(res.opened);
  useGameStore.getState().setLastOpened(results);
  return results;
}
