/**
 * EL BUCLE DE SOBRES · CONTRATOS (Fase 25) — pruebas 7–14, 45–56 del brief que se afirman
 * sobre el CÓDIGO REAL (rutas, servicios, pantallas), como hacen las suites anteriores del
 * proyecto: sin base de datos, leyendo lo que hay escrito y lo que exporta cada módulo.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PACKS } from "@/data/packs";
import { isStoreVisible } from "@/domain/packs/lifecycle";
import { publicPacks, featuredPacks } from "./packCatalog";
import { FLOWS, EVENT_NAMES } from "@/lib/telemetry/contract";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const ROUTE = read("../../app/api/game/packs/route.ts");
const SERVICE = read("../../server/services/packs.ts");
const CEREMONY = read("./PackOpeningExperience.tsx");
const SYNC = read("../../lib/game/sync.ts");
const SHEET = read("../deck/AddToDeckSheet.tsx");
const HUB = read("../../app/packs/page.tsx");
const DETAIL = read("../../app/packs/[packId]/page.tsx");
const MYPACKS = read("./MyPacks.tsx");
const MARKET = read("../../config/features.ts");

/* ─────────────── 7–8 · idempotencia ─────────────── */

test("7+8 · comprar, abrir y comprar-y-abrir reenvían el `ref` del gesto al servicio (una operación = una clave)", () => {
  assert.ok(ROUTE.includes("buyPack(session.admin, session.userId, packId, ref, undefined, priceOpts)"));
  assert.ok(ROUTE.includes("openPackForUser(session.admin, session.userId, packId, ref)"), "el hueco de 24.x: `open` sin ref");
  assert.ok(ROUTE.includes("buyAndOpen(session.admin, session.userId, packId, ref, undefined, priceOpts)"));
  assert.ok(SERVICE.includes('packOpRef(userId, "open", gesture ?? anonymousGesture())'));
});

test("10+11 · un gesto por apertura: la capa de sync lo fija, lo guarda antes de pedir y lo reutiliza al reintentar", () => {
  assert.ok(SYNC.includes("const gesture = ref ?? loadPendingOpen(packId) ?? newOpenGesture();"), "el gesto se reutiliza si hay uno pendiente");
  const i = SYNC.indexOf("savePendingOpen(packId, gesture);");
  const j = SYNC.indexOf("clearPendingOpen();", i);
  assert.ok(i > 0 && j > i && SYNC.slice(i, j).includes("await apiOpenPack(packId, gesture);"), "guardar → pedir → limpiar, en ese orden");
  assert.ok(CEREMONY.includes("openPackOutcome(packId)"), "la ceremonia no compone el gesto: lo hace la capa de sync");
  assert.ok(SYNC.includes("return (await openPackOutcome(packId, ref)).results;"), "openPackOnline es la misma operación");
  assert.ok(/if \(opened\.current\) return;\s*opened\.current = true;/.test(CEREMONY), "doble clic: la segunda pulsación no abre");
});

test("12 · saltar solo salta la PRESENTACIÓN: reutiliza `results`, nunca vuelve a pedir ni sortear", () => {
  const skip = CEREMONY.slice(CEREMONY.indexOf("const skipToSummary"), CEREMONY.indexOf("const openAnother"));
  assert.ok(skip.includes('dispatch({ type: "SKIP" })'));
  assert.ok(!/openPackOnline|openPackOutcome|openFromInventory|apiOpenPack/.test(skip));
});

/* ─────────────── 13–14, 45–49 · autoridad del servidor ─────────────── */

test("13+14+45–49 · el cliente no elige carta, serial, rareza ni precio: la ruta solo lee action/packId/ref y el servicio saca el precio del catálogo", () => {
  const bodyFields = [...new Set([...ROUTE.matchAll(/body\.(\w+)/g)].map((m) => m[1]))].sort();
  // ICON (2026-10-09) · `expectedPrice`: el precio que el jugador VIO. No decide el cobro (el servicio cobra `pack.price`
  // del catálogo del servidor); solo lo BLOQUEA con 409 si no coincide (`checkExpectedPrice`).
  assert.deepEqual(bodyFields, ["action", "expectedPrice", "packId", "ref"]);
  assert.ok(!/body\.(cardId|serial|rarity|price|credits|seed|cards)\b/.test(ROUTE));
  assert.ok(SERVICE.includes("const seen = checkExpectedPrice(pack, opts.expectedPrice);") && SERVICE.includes("p_price: pack.price,"));
  assert.ok(SERVICE.includes("randomInt("), "semilla criptográfica en servidor");
  assert.ok(!/seed:\s*body|req\.body/.test(SERVICE));
  assert.ok(SERVICE.includes("guardPublicOpen(pack)"));
  assert.ok(SERVICE.includes("guardPurchase(pack)"));
});

/* ─────────────── 1–4 · ciclo de vida en las pantallas ─────────────── */

test("1+2+3 · el hub y la ficha solo enseñan lo visible (ACTIVE); DRAFT/RETIRED no se listan ni se compran", () => {
  for (const p of publicPacks()) assert.ok(isStoreVisible(p));
  const hidden = PACKS.filter((p) => !isStoreVisible(p));
  assert.ok(hidden.length > 0, "el catálogo real tiene DRAFT/RETIRED para probarlo");
  for (const p of hidden) assert.ok(!publicPacks().some((v) => v.id === p.id));
  for (const f of featuredPacks(publicPacks())) assert.ok(isStoreVisible(f.pack));
  assert.ok(DETAIL.includes("if (!isStoreVisible(pack))"));
  assert.ok(MYPACKS.includes("ownedPackGroups(unopened, getPack)"), "«Mis sobres» filtra con el ciclo de vida del dominio");
  assert.ok(HUB.includes("<MyPacks />"));
});

/* ─────────────── deck loop ─────────────── */

test("44 · resumen → mazo: el botón existe, exige confirmación y persiste en el servidor (saveDuelDeck), nunca en el cliente", () => {
  assert.ok(CEREMONY.includes("Añadir al equipo"));
  assert.ok(CEREMONY.includes('<AddToDeckSheet card={deckCard} origin="pack_summary"'));
  assert.ok(SHEET.includes("persist({ id: deck.id, name: deck.name, cardUids: uids })"));
  assert.ok(SHEET.includes("persist = saveDuelDeck"));
  assert.ok(SHEET.includes('plan.kind !== "free" && !replaceUid'), "sustituir sin elegir a quién está deshabilitado");
  assert.ok(!/useGameStore|localStorage/.test(SHEET), "los mazos no viven en el cliente");
});

/* ─────────────── telemetría ─────────────── */

test("telemetría · solo la taxonomía existente: flujos declarados en el contrato, sin eventos nuevos", () => {
  for (const src of [HUB, DETAIL, CEREMONY, SHEET]) {
    for (const m of src.matchAll(/trackFlow\("([a-z_]+)"/g)) assert.ok((FLOWS as readonly string[]).includes(m[1]), m[1]);
    assert.ok(!/track\("(pack_opened|card_revealed|pack_viewed)"/.test(src), "sin nombres de evento fuera del contrato");
  }
  assert.equal(EVENT_NAMES.length, 4, "el contrato de eventos no ha crecido");
});

/* ─────────────── 51 · Marketplace ─────────────── */

test("51 · el Marketplace sigue cerrado y la ceremonia no vende, no valora y no manda al mercado (Fase 38)", () => {
  assert.ok(/GLOBAL_MARKET_ENABLED\s*=\s*false/.test(MARKET));
  const all = CEREMONY + read("./PackSummary.tsx") + read("./CardReveal.tsx") + read("./PackStage.tsx") + read("./PackStatus.tsx");
  assert.ok(!/quickSell|\bvender\b|\bventa\b|\bmercado\b|\bmarket\b|formatCredits|🪙|valor total/i.test(all.replace(/\/\*[\s\S]*?\*\//g, "")), "sin venta rápida, valor ni mercado");
});
