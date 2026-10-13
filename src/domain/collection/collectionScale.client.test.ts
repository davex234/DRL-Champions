/**
 * COLECCIONES ILIMITADAS · el cliente cuenta copias con los recuentos del servidor, no con la longitud de una lista.
 *
 * Con cuenta, el estado trae UN ejemplar por carta. Todo lo que antes hacía `lista.length` o agrupaba ejemplares para
 * saber «cuántas tengo» tiene que dar lo mismo con 50.000 copias que con 5.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CARDS, getPlayer } from "@/data/catalog";
import type { OwnedCard } from "@/domain/cards/types";
import { copiesByCard, ownedTotalOf, duplicates } from "@/store/selectors";
import { OwnershipIndex } from "@/collection/ownership";
import { CollectionEngine } from "@/collection/engine";
import { buildCollectionSnapshot, type OwnedInstanceFact } from "@/domain/collection/room";
import { buildTeamCollection } from "@/domain/collections/teamCollection";
import { buildRevealPlan, holdingsMinus, holdingsPlus, type OpenedInstance } from "@/domain/packs/reveal";
import { trimMaterialsForView, autoFill, type SlotMaterials } from "@/domain/forge/selector";
import { copiesByCard as poolCopies } from "@/domain/deckBuilder/pool";
import type { BuilderCard } from "@/domain/deckBuilder/builder";
import { getVariant } from "@/domain/cards/variants";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
const DEFS = CARDS.filter((c) => c.combat).slice(0, 6);
const rep = (i: number, serial?: number): OwnedCard => ({ uid: `u-${i}`, cardId: DEFS[i].id, serial, obtainedAt: 1 });
/** Estado «con cuenta»: un ejemplar por carta y los recuentos del servidor (50.000 copias en total). */
const SERVER = { ownedCards: [rep(0, 3), rep(1), rep(2)], ownedCounts: { [DEFS[0].id]: 30_000, [DEFS[1].id]: 19_999, [DEFS[2].id]: 1 }, ownedTotal: 50_000 };
/** Demo local: sin recuentos, la lista ES la colección. */
const LOCAL = { ownedCards: [rep(0), { ...rep(0), uid: "u-0b" }, rep(1)], ownedCounts: null, ownedTotal: null };

test("SELECTORES · con cuenta mandan los recuentos del servidor; en la demo local se cuentan los ejemplares", () => {
  assert.equal(ownedTotalOf(SERVER), 50_000);
  assert.equal(copiesByCard(SERVER)[DEFS[0].id], 30_000);
  assert.equal(ownedTotalOf(LOCAL), 3);
  assert.deepEqual(copiesByCard(LOCAL), { [DEFS[0].id]: 2, [DEFS[1].id]: 1 });
  assert.equal(ownedTotalOf({ ownedCards: SERVER.ownedCards, ownedCounts: SERVER.ownedCounts }), 50_000, "sin total explícito se suman los recuentos");
  assert.equal(duplicates(LOCAL.ownedCards).length, 1, "la demo local sigue listando sus repetidas");
});

test("MOTOR DE COLECCIÓN · copias, total y duplicados salen de los recuentos; la propiedad, de los ejemplares", () => {
  const own = new OwnershipIndex(SERVER.ownedCards, SERVER.ownedCounts);
  assert.equal(own.countOf(DEFS[0].id), 30_000);
  assert.equal(own.countOf(DEFS[5].id), 0);
  assert.equal(own.totalInstances(), 50_000);
  assert.equal(own.distinctCount(), 3);
  assert.equal(own.bestSerial(DEFS[0].id), 3);
  const views = new CollectionEngine(SERVER.ownedCards, undefined, undefined, SERVER.ownedCounts).ownedViews();
  assert.equal(views.length, 3);
  assert.equal(views.find((v) => v.cardId === DEFS[1].id)!.count, 19_999);
  assert.equal(new OwnershipIndex(LOCAL.ownedCards).countOf(DEFS[0].id), 2, "sin recuentos: como siempre");
});

test("ÁLBUM · la foto usa los recuentos por carta (copias, duplicados y numeradas) y un ejemplar por carta basta", () => {
  const instances: OwnedInstanceFact[] = [
    { uid: "u-0", cardId: DEFS[0].id, serial: 1, mintedVersion: 1 },
    { uid: "u-1", cardId: DEFS[1].id, serial: null, mintedVersion: 1 },
  ];
  const holdings = { [DEFS[0].id]: { count: 12_000, numbered: 40 }, [DEFS[1].id]: { count: 2, numbered: 0 } };
  const snap = buildCollectionSnapshot(CARDS, getPlayer, { instances, holdings, favorites: null, showcaseUids: null, decks: null });
  assert.equal(snap.uniqueOwned, 2);
  assert.equal(snap.totalCopies, 12_002);
  assert.equal(snap.duplicates, 12_000);
  assert.equal(snap.byCard.get(DEFS[0].id)!.count, 12_000);
  assert.equal(snap.serials.owned, 40, "numeradas: las que dice el servidor, no las de la lista");
  assert.equal(snap.serials.number1, 1);
  assert.equal(snap.serials.lowest?.serial, 1);
  const local = buildCollectionSnapshot(CARDS, getPlayer, { instances, favorites: null, showcaseUids: null, decks: null });
  assert.equal(local.totalCopies, 2, "sin recuentos (demo local) se cuentan los ejemplares");
  assert.equal(local.serials.owned, 1);
});

test("EQUIPOS DE LA COLECCIÓN · las copias por carta salen de los recuentos", () => {
  const withCounts = buildTeamCollection(SERVER.ownedCards, { counts: SERVER.ownedCounts });
  const cell = withCounts.flatMap((t) => t.cards).find((c) => c.cardId === DEFS[0].id)!;
  assert.equal(cell.count, 30_000);
  assert.equal(buildTeamCollection(LOCAL.ownedCards).flatMap((t) => t.cards).find((c) => c.cardId === DEFS[0].id)!.count, 2);
});

test("APERTURA · «ahora tienes N» y el total de copias salen de los recuentos previos, no de contar ejemplares", () => {
  const catalog = { cards: CARDS, getCard: (id: string) => CARDS.find((c) => c.id === id), getPlayer };
  const before: OwnedInstanceFact[] = [{ uid: "u-0", cardId: DEFS[0].id, serial: null, mintedVersion: 1 }];
  const opened: OpenedInstance[] = [
    { uid: "n-1", cardId: DEFS[0].id, serial: null, mintedVersion: 1 } as OpenedInstance,
    { uid: "n-2", cardId: DEFS[3].id, serial: null, mintedVersion: 1 } as OpenedInstance,
  ];
  const holdings = { [DEFS[0].id]: { count: 4_000, numbered: 0 } };
  const plan = buildRevealPlan(opened, before, catalog as never, { holdings });
  const dup = plan.items.find((i) => i.cardId === DEFS[0].id)!, fresh = plan.items.find((i) => i.cardId === DEFS[3].id)!;
  assert.equal(dup.status, "duplicate");
  assert.equal(dup.copiesAfter, 4_001, "antes diría 2: contaba el único ejemplar de la lista");
  assert.equal(fresh.status, "new");
  assert.equal(plan.summary.collection?.copiesBefore, 4_000);
  assert.equal(plan.summary.collection?.copiesAfter, 4_002);
  assert.equal(plan.summary.collection?.gainedUnique, 1);
  // De una apertura a la siguiente, y de vuelta en una recuperación.
  const next = holdingsPlus(holdings, opened);
  assert.deepEqual([next[DEFS[0].id].count, next[DEFS[3].id].count], [4_001, 1]);
  assert.deepEqual(holdingsMinus(next, opened), holdings);
  // Sin recuentos (demo local): como siempre.
  assert.equal(buildRevealPlan(opened, before, catalog as never).items.find((i) => i.cardId === DEFS[0].id)!.copiesAfter, 2);
});

test("FORJA · la foto recorta las copias libres por carta a lo que la receta puede consumir, sin tocar los recuentos", () => {
  const free = (n: number, guardedEvery = 0) => Array.from({ length: n }, (_, i) => ({ uid: `f-${i}`, protectedBy: guardedEvery && i % guardedEvery === 0 ? (["FAVORITE"] as never[]) : [] }));
  const mats: SlotMaterials[] = [
    { index: 0, slot: { qty: 3 } as never, need: 3, availableUnprotected: 8_999, availableTotal: 8_999, candidates: [{ cardId: "x", ovr: 80, playerId: "p", variantId: "v", copies: 9_000, usable: 8_999, free: free(9_000, 2) }] },
    { index: 1, slot: { qty: 2 } as never, need: 2, availableUnprotected: 1, availableTotal: 1, candidates: [{ cardId: "y", ovr: 70, playerId: "q", variantId: "v", copies: 2, usable: 1, free: free(2) }] },
  ];
  const view = trimMaterialsForView(mats);
  const x = view[0].candidates[0];
  assert.equal(x.free.length, 10, "5 sin protección + 5 protegidas (la receta entera pide 5)");
  assert.equal(x.free.filter((f) => f.protectedBy.length === 0).length, 5);
  assert.deepEqual([x.copies, x.usable, view[0].availableUnprotected, view[0].availableTotal], [9_000, 8_999, 8_999, 8_999], "los recuentos son los de la colección completa");
  assert.equal(view[1].candidates[0].free.length, 2, "lo que ya cabe no se toca");
  assert.deepEqual(autoFill(view).bySlot[0], autoFill(mats).bySlot[0], "la auto-selección elige las mismas copias");
  assert.ok(JSON.stringify(view).length < JSON.stringify(mats).length / 100);
});

test("CONSTRUCTOR · «×N» sale de `copies` (un ejemplar por carta en el pool); sin él, se cuentan los ejemplares", () => {
  const card = (uid: string, cardId: string, copies?: number) => ({ uid, cardId, copies } as unknown as BuilderCard);
  const m = poolCopies([card("a", "x", 12_000), card("b", "y"), card("c", "y"), card("d", "z", 1)]);
  assert.deepEqual([m.get("x"), m.get("y"), m.get("z")], [12_000, 2, 1]);
});

test("CLIENTE · el estado sincronizado y las pantallas no cuentan copias con la longitud de la lista", () => {
  const store = read("src/store/useGameStore.ts");
  assert.ok(store.includes("ownedCounts: s.ownedCounts ?? null") && store.includes("ownedTotal: s.ownedTotal ?? null"), "el store guarda los recuentos del servidor");
  assert.ok(/resetGame:[\s\S]*?ownedCounts: null/.test(store), "salir de la cuenta borra los recuentos (la demo local cuenta sus ejemplares)");
  const sync = read("src/lib/game/sync.ts");
  assert.ok(sync.includes("ownedCounts: state.ownedCounts ?? null") && sync.includes("pinnedInstances(state.ownedCards)"), "los uid de los equipos del entrenador se piden aparte");
  assert.ok(read("src/app/cuenta/page.tsx").includes("{ n: ownedTotal }") && !read("src/app/cuenta/page.tsx").includes("n: ownedCards.length"));
  assert.ok(read("src/store/useBattlePassStore.ts").includes("cards_owned: ownedTotalOf(g)"));
  const inv = read("src/app/inventario/page.tsx");
  assert.ok(inv.includes("preview?.salvageable") && inv.includes("SALVAGE_BATCH") && inv.includes("fetchSalvagePreview()"), "el desguace va por tandas");
  assert.ok(!/salvage\(\[\.\.\.preview\.uids, \.\.\.confirmed\]/.test(inv), "ya no se envían todas las repetidas en una sola operación");
  const detail = read("src/app/coleccion/carta/[cardId]/page.tsx");
  assert.ok(detail.includes('useCardInstances({ enabled: ownsIt, cardId: def?.id ?? null, sort: "serial", limit: 48'), "las copias de una carta se cargan por páginas");
  // El estado ya no persiste una lista que crezca con la colección: lo que va a localStorage es un ejemplar por carta + recuentos.
  assert.ok(read("src/server/services/inventory.ts").includes("ownedCards.push({ uid: c.rep.uid, cardId: c.cardId"));
});

test("CARGA POR PÁGINAS · una petición a la vez, respuestas viejas descartadas, reintento de la misma página y sin duplicados", () => {
  const hook = read("src/lib/game/useCardInstances.ts");
  assert.ok(hook.includes("if (inFlight.current) return;"), "ni el scroll ni un doble toque lanzan dos peticiones");
  assert.ok(hook.includes("if (mine !== token.current) return;"), "una respuesta de otra consulta no se pinta");
  assert.ok(hook.includes("page.items.filter((i) => !seen.current.has(i.uid))"), "sin duplicados aunque el servidor repita una fila");
  assert.ok(hook.includes("inFlight.current?.abort();"), "cambiar de carta o de cuenta aborta lo que viaja");
  assert.ok(hook.includes("cursor: first ? null : cursor.current"), "reintentar repite la MISMA página (el cursor solo avanza al llegar la respuesta)");
  assert.ok(!/localStorage|sessionStorage/.test(hook), "las páginas no se persisten");
  const more = read("src/components/ui/LoadMore.tsx");
  assert.ok(more.includes("useReachEnd(onMore, hasMore && !loading && !error)") && more.includes('role="alert"') && more.includes('aria-live="polite"'));
  // Estética: las tarjetas siguen siendo las del juego (no se cambia el componente de carta).
  assert.ok(getVariant(DEFS[0].variantId).label.length > 0);
});
