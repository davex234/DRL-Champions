/**
 * COLECCIONES ILIMITADAS · el servidor nunca decide ni enseña con una colección parcial.
 *
 * El doble de base de datos corta cada respuesta en 1.000 filas SIN AVISAR, igual que PostgREST (`max_rows`). Con el
 * código anterior —una lectura de `user_cards` sin paginar— estos tests fallan en cuanto la cuenta pasa de 1.000 cartas.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MemSupabase, type Row } from "./testing/memSupabase";
import { CARDS } from "@/data/catalog";
import { IncompleteReadError, keysetAll, keysetEach } from "@/server/db/keyset";
import { __resetSummaryRpcProbe, loadCollectionSummary, readUserCards, readUserCardsByUid, summarize, toInstance } from "./userCards";
import { loadGameState } from "./inventory";
import { loadFacts } from "./progression";
import { loadOwned, loadOwnership } from "./duels";
import { previewSalvage, salvageCards, SALVAGE_BATCH } from "./economy";
import { getCollectionPersonal } from "./collection";
import { CARDS_PAGE_MAX, decodeCursor, encodeCursor, listCardInstances, lookupCardInstances, parseCardsQuery, type CardsQuery } from "./cardInstances";

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const uid = (owner: "a" | "b", i: number) => `${owner.repeat(8)}-0000-4000-8000-${String(i).padStart(12, "0")}`;
const DEFS = CARDS.filter((c) => c.combat);

/** `n` cartas para el usuario, repartidas por el catálogo en orden: la carta i-ésima es `DEFS[i % DEFS.length]`. */
function seed(db: MemSupabase, user: string, owner: "a" | "b", n: number, opts: { serialEvery?: number } = {}): void {
  const t = db.table("user_cards");
  for (let i = 0; i < n; i++) {
    t.push({ uid: uid(owner, i), user_id: user, card_id: DEFS[i % DEFS.length].id, serial: opts.serialEvery && i % opts.serialEvery === 0 ? i + 1 : null, origin: "pack", locked: false, obtained_at: new Date(1_700_000_000_000 + i * 1000).toISOString(), minted_version: 1 });
  }
}
function world(n: number, opts: { serialEvery?: number } = {}): MemSupabase {
  const db = new MemSupabase();
  db.seedUser(A); db.seedUser(B);
  seed(db, A, "a", n, opts);
  seed(db, B, "b", 7);
  __resetSummaryRpcProbe();
  return db;
}

/* ───────────────────────── el doble corta como PostgREST ───────────────────────── */

test("DOBLE · una lectura sin paginar se corta en 1.000 filas sin error (es el fallo que se corrige)", async () => {
  const db = world(1001);
  const { data, error } = await db.client.from("user_cards").select("uid").eq("user_id", A);
  assert.equal(error, null);
  assert.equal((data as Row[]).length, 1000, "PostgREST devuelve 1.000 y un 200: nadie se entera");
});

/* ───────────────────────── lectura por cursor ───────────────────────── */

for (const n of [0, 100, 999, 1000, 1001, 5000, 10_000, 50_000]) {
  test(`CURSOR · ${n} cartas: se leen TODAS, sin repetir ninguna, y el resumen cuenta exactamente ${n}`, async () => {
    const db = world(n);
    const rows = await readUserCards<{ uid: string; card_id: string }>(db.client, A, "uid, card_id");
    assert.equal(rows.length, n);
    assert.equal(new Set(rows.map((r) => r.uid)).size, n, "sin duplicados");
    if (n > 0) assert.equal(rows[n - 1].uid, uid("a", n - 1), "la última carta (la 1.001, la 50.000…) está");
    const s = await loadCollectionSummary(db.client, A);
    assert.equal(s.total, n);
    assert.equal(s.distinct, Math.min(n, DEFS.length));
    assert.equal(s.cards.reduce((t, c) => t + c.count, 0), n);
    assert.ok(s.cards.length <= DEFS.length, "el resumen lo acota el catálogo, no la colección");
  });
}

test("CURSOR · el número de consultas crece con las páginas, no hay tope de páginas ni de filas", async () => {
  const db = world(12_345);
  db.reads = 0;
  const rows = await readUserCards<{ uid: string }>(db.client, A, "uid");
  assert.equal(rows.length, 12_345);
  assert.equal(db.reads, 13, "12 páginas llenas + la última");
});

test("CURSOR · si el servidor recorta más de lo pedido (max_rows menor), se adopta su tamaño y no se pierde nada", async () => {
  const db = world(2_500);
  db.maxRows = 300;
  const rows = await readUserCards<{ uid: string }>(db.client, A, "uid");
  assert.equal(rows.length, 2_500, "una página corta NO se confunde con la última");
});

test("CURSOR · un fallo a mitad de lectura LANZA: nunca se devuelve una colección parcial", async () => {
  let calls = 0;
  const page = (after: string | null, limit: number) => {
    calls++;
    if (calls === 3) return Promise.resolve({ data: null, error: { message: "connection reset", code: "08006" } });
    const from = after === null ? 0 : Number(after) + 1;
    return Promise.resolve({ data: Array.from({ length: limit }, (_, i) => ({ k: String(from + i).padStart(9, "0") })), error: null, count: 10_000 });
  };
  await assert.rejects(keysetAll<{ k: string }>({ what: "prueba", key: (r) => r.k, page, pageSize: 100 }), IncompleteReadError);
  assert.equal(calls, 3);
});

test("CURSOR · un orden inestable (el cursor no avanza) se detecta en vez de girar para siempre", async () => {
  const page = () => Promise.resolve({ data: [{ k: "0001" }, { k: "0002" }], error: null, count: 99 });
  await assert.rejects(keysetEach<{ k: string }>({ what: "prueba", key: (r) => r.k, page, pageSize: 2, onPage: () => undefined }), /no avanza/);
});

test("CURSOR · cartas que entran o salen MIENTRAS se lee: las que estaban antes y después salen exactamente una vez", async () => {
  const db = world(3_000);
  const t = db.table("user_cards");
  const seen: string[] = [];
  let pages = 0;
  await keysetEach<{ uid: string }>({
    what: "user_cards", key: (r) => r.uid,
    page: (after, limit, withCount) => {
      let q = db.client.from("user_cards").select("uid", withCount ? { count: "exact" } : undefined).eq("user_id", A);
      if (after !== null) q = q.gt("uid", after);
      return q.order("uid", { ascending: true }).limit(limit) as unknown as PromiseLike<{ data: { uid: string }[] | null; error: null; count?: number | null }>;
    },
    onPage: (rows) => {
      for (const r of rows) seen.push(r.uid);
      pages++;
      if (pages === 1) {
        // Entre la página 1 y la 2: se borra una carta YA leída y otra AÚN no leída, y entra una nueva al principio y otra al final.
        db.tables.user_cards = t.filter((r) => r.uid !== uid("a", 10) && r.uid !== uid("a", 2_500));
        db.table("user_cards").push({ uid: `${"a".repeat(8)}-0000-4000-8000-000000000005x`.slice(0, 36), user_id: A, card_id: DEFS[0].id, serial: null, origin: "pack", locked: false, obtained_at: new Date().toISOString(), minted_version: 1 });
        db.table("user_cards").push({ uid: uid("a", 9_999), user_id: A, card_id: DEFS[0].id, serial: null, origin: "pack", locked: false, obtained_at: new Date().toISOString(), minted_version: 1 });
      }
    },
  });
  assert.equal(new Set(seen).size, seen.length, "ninguna carta se repite (con paginación por desplazamiento se repetiría o saltaría una)");
  const stable = new Set(Array.from({ length: 3_000 }, (_, i) => uid("a", i)).filter((u) => u !== uid("a", 10) && u !== uid("a", 2_500)));
  for (const u of stable) assert.ok(seen.includes(u) || u === uid("a", 10), u);
  assert.ok(!seen.includes(uid("a", 2_500)), "la borrada antes de leerse no aparece");
  assert.ok(seen.includes(uid("a", 9_999)), "la insertada por delante del cursor sí");
});

/* ───────────────────────── resumen por carta ───────────────────────── */

test("RESUMEN · mejor ejemplar = serie más baja (sin serie al final) y después uid; cuenta copias, en venta y numeradas", () => {
  const rows = [
    { uid: "u3", cardId: "x", serial: null, mintedVersion: 1, obtainedAt: 300, origin: "pack", locked: true },
    { uid: "u2", cardId: "x", serial: 7, mintedVersion: 1, obtainedAt: 200, origin: "pack", locked: false },
    { uid: "u1", cardId: "x", serial: 40, mintedVersion: 2, obtainedAt: 100, origin: "craft", locked: false },
    { uid: "u9", cardId: "y", serial: null, mintedVersion: 1, obtainedAt: 0, origin: "pack", locked: false },
    { uid: "u8", cardId: "y", serial: null, mintedVersion: 1, obtainedAt: 500, origin: "pack", locked: false },
  ];
  const s = summarize(rows);
  assert.equal(s.total, 5); assert.equal(s.distinct, 2);
  const x = s.cards.find((c) => c.cardId === "x")!, y = s.cards.find((c) => c.cardId === "y")!;
  assert.deepEqual([x.count, x.locked, x.numbered, x.rep.uid, x.firstObtainedAt], [3, 1, 2, "u2", 100]);
  assert.deepEqual([y.count, y.numbered, y.rep.uid, y.firstObtainedAt], [2, 0, "u8", 500], "sin serie: uid más bajo; fecha 0 no cuenta como primera");
});

test("RESUMEN · la función de la base y el recorrido por cursor dan lo MISMO; sin la función (antes de la 0074) se recorre", async () => {
  const db = world(2_345, { serialEvery: 50 });
  const scan = await loadCollectionSummary(db.client, A);
  assert.equal(scan.via, "scan", "el doble no tiene la función: PGRST202 → recorrido");
  // La función de la base, reproducida con la MISMA agregación sobre todas las filas (lo que hace el SQL de 0074).
  const all = db.table("user_cards").filter((r) => r.user_id === A).map((r) => toInstance(r as never));
  const sql = summarize(all);
  (db as unknown as Record<string, unknown>).rpc_app_collection_summary = (a: Record<string, unknown>) => {
    assert.equal(a.p_user, A);
    return { total: sql.total, distinct: sql.distinct, cards: sql.cards.map((c) => ({ card_id: c.cardId, n: c.count, locked: c.locked, numbered: c.numbered, first_at: c.firstObtainedAt ? new Date(c.firstObtainedAt).toISOString() : null, rep: { uid: c.rep.uid, serial: c.rep.serial, minted_version: c.rep.mintedVersion, obtained_at: new Date(c.rep.obtainedAt).toISOString(), origin: c.rep.origin, locked: c.rep.locked } })) };
  };
  __resetSummaryRpcProbe();
  db.reads = 0;
  const rpc = await loadCollectionSummary(db.client, A);
  assert.equal(rpc.via, "rpc");
  assert.equal(db.reads, 0, "con la función: UNA llamada, ninguna lectura de tabla");
  assert.deepEqual({ ...rpc, via: null }, { ...scan, via: null });
});

test("RESUMEN · lecturas simultáneas del mismo usuario comparten UNA lectura en vuelo; después se vuelve a leer (no es caché)", async () => {
  const db = world(1_500);
  db.reads = 0;
  const [x, y, z] = await Promise.all([loadCollectionSummary(db.client, A), loadCollectionSummary(db.client, A), loadCollectionSummary(db.client, B)]);
  assert.equal(x, y, "misma lectura");
  assert.equal(z.total, 7, "otro usuario, otra lectura");
  const afterParallel = db.reads;
  assert.equal(afterParallel, 2 + 1, "A: 2 páginas (1.500 filas) una sola vez · B: 1 página");
  db.table("user_cards").push({ uid: uid("a", 77_777), user_id: A, card_id: DEFS[0].id, serial: null, origin: "pack", locked: false, obtained_at: new Date().toISOString(), minted_version: 1 });
  assert.equal((await loadCollectionSummary(db.client, A)).total, 1_501, "una llamada posterior ve la carta nueva");
  __resetSummaryRpcProbe();
  const broken = Object.assign(Object.create(db) as MemSupabase, { rpc: async () => ({ data: null, error: { code: "XX000", message: "boom" } }) });
  await assert.rejects(loadCollectionSummary(broken as never, A), IncompleteReadError);
  assert.equal((await loadCollectionSummary(db.client, A)).total, 1_501, "un fallo no deja nada pegado");
});

test("RESUMEN · un error de la función que NO es «no existe» lanza (no se disimula con un recorrido)", async () => {
  const db = world(10);
  (db as unknown as Record<string, unknown>).rpc_app_collection_summary = () => { throw new Error("permission denied for function"); };
  await assert.rejects(loadCollectionSummary(db.client, A), IncompleteReadError);
});

/* ───────────────────────── estado de juego y decisiones económicas ───────────────────────── */

test("ESTADO · 1.001 cartas: total y recuentos exactos, un ejemplar por carta y tamaño acotado por el catálogo", async () => {
  const db = world(1001);
  const s = await loadGameState(db.client, A);
  assert.equal(s.ownedTotal, 1001, "antes: 1.000");
  assert.equal(Object.values(s.ownedCounts).reduce((n, c) => n + c, 0), 1001);
  assert.equal(s.ownedCards.length, Math.min(1001, DEFS.length));
  assert.equal(new Set(s.ownedCards.map((c) => c.cardId)).size, s.ownedCards.length, "uno por carta");
  const big = await loadGameState(world(50_000).client, A);
  assert.equal(big.ownedTotal, 50_000);
  assert.equal(big.ownedCards.length, DEFS.length, "50.000 copias siguen siendo ≤ catálogo en la respuesta");
  assert.ok(JSON.stringify(big).length < 400_000, `el estado no crece con la colección (${JSON.stringify(big).length} B)`);
});

test("ESTADO · el motor de sobres ve TODAS las cartas distintas: una carta cuya única copia cae tras la fila 1.000 cuenta como poseída", async () => {
  const db = world(0);
  const filler = DEFS[0], rare = DEFS[1];
  const t = db.table("user_cards");
  for (let i = 0; i < 1_500; i++) t.push({ uid: uid("a", i), user_id: A, card_id: filler.id, serial: null, origin: "pack", locked: false, obtained_at: new Date(0).toISOString(), minted_version: 1 });
  t.push({ uid: uid("a", 999_999), user_id: A, card_id: rare.id, serial: null, origin: "pack", locked: false, obtained_at: new Date(0).toISOString(), minted_version: 1 });
  const s = await loadGameState(db.client, A);
  assert.ok(s.ownedCards.some((c) => c.cardId === rare.id), "el antiduplicados y «es nueva» la tienen en cuenta");
  assert.equal(s.ownedCounts[filler.id], 1_500);
});

test("ESTADO · un fallo de lectura LANZA: ni la pantalla ni el motor de sobres reciben un inventario vacío o parcial", async () => {
  const db = world(50);
  db.failTables.add("user_cards");
  await assert.rejects(loadGameState(db.client, A), IncompleteReadError);
});

test("MISIONES Y LOGROS · con más de 1.000 cartas: «cartas» no se queda en 1.000 y los logros ven todas las cartas", async () => {
  const db = world(2_600);
  const f = await loadFacts(db.client, A);
  assert.equal(f.metrics.owned_cards, 2_600);
  assert.equal(f.metrics.distinct_cards, DEFS.length);
  assert.equal(f.ctx.ownedCardIds.size, DEFS.length);
  assert.equal(f.ownedInstances, 2_600);
  assert.equal(f.cardRows.length, DEFS.length, "una fila por carta con la fecha de su primera copia");
});

test("EQUIPOS · la propiedad no lee la colección entera: un ejemplar por carta + los uid pedidos; un uid ajeno nunca vuelve", async () => {
  const db = world(20_000);
  db.table("duel_decks");
  db.reads = 0;
  const { owned, counts } = await loadOwnership(db.client, A);
  assert.equal(owned.length, DEFS.length);
  assert.equal(Object.values(counts).reduce((n, c) => n + c, 0), 20_000);
  const far = uid("a", 19_999), alien = uid("b", 3);
  const got = await loadOwned(db.client, A, [far, alien]);
  assert.ok(got.some((o) => o.uid === far), "una copia de la fila 19.999 es válida para un equipo");
  assert.ok(!got.some((o) => o.uid === alien), "la carta de otra cuenta no");
});

test("COLECCIÓN · la foto personal lleva recuentos exactos y un ejemplar por carta (sin techo ni «truncated»)", async () => {
  const db = world(30_000, { serialEvery: 100 });
  const r = await getCollectionPersonal(db.client, A, { now: 1 });
  assert.ok(r.ok && r.data);
  assert.equal(r.data.total, 30_000);
  assert.equal(r.data.instances.length, DEFS.length);
  assert.equal(Object.values(r.data.holdings).reduce((n, h) => n + h.count, 0), 30_000);
  assert.equal(Object.values(r.data.holdings).reduce((n, h) => n + h.numbered, 0), 300);
  assert.ok(!("truncated" in r.data));
});

/* ───────────────────────── desguace ───────────────────────── */

function salvageWorld(copies: number): MemSupabase {
  const db = new MemSupabase();
  db.seedUser(A, 0);
  const t = db.table("user_cards");
  for (let i = 0; i < copies; i++) t.push({ uid: uid("a", i), user_id: A, card_id: DEFS[i % 3].id, serial: null, origin: "pack", locked: false, obtained_at: new Date(0).toISOString(), minted_version: null });
  __resetSummaryRpcProbe();
  return db;
}

test("DESGUACE · 2.500 copias de 3 cartas: la vista previa ve TODAS (2.497 desguazables) y manda una tanda de 500", async () => {
  const db = salvageWorld(2_500);
  const p = await previewSalvage(db.client, A);
  assert.ok(p.ok);
  assert.equal(p.data.salvageable, 2_497, "se conserva una de cada carta; antes solo veía 1.000 filas arbitrarias");
  assert.equal(p.data.uids.length, SALVAGE_BATCH);
  assert.equal(p.data.lines.length, 3);
  assert.equal(p.data.lines.reduce((n, l) => n + l.salvageable, 0), 2_497);
  assert.equal(p.data.total, p.data.lines.reduce((n, l) => n + l.subtotal, 0));
  assert.ok(p.data.batchTotal > 0 && p.data.batchTotal < p.data.total);
});

test("DESGUACE · por tandas hasta agotar: se paga exactamente el total previsto, queda UNA copia de cada carta y nada se duplica", async () => {
  const db = salvageWorld(1_700);
  const first = await previewSalvage(db.client, A);
  assert.ok(first.ok);
  const expected = first.data.total;
  let paid = 0, gone = 0, rounds = 0;
  for (let p: Awaited<ReturnType<typeof previewSalvage>> = first; p.ok && p.data.uids.length > 0; p = await previewSalvage(db.client, A)) {
    const r = await salvageCards(db.client, A, p.data.uids, `salvage:${A}:ronda-${rounds++}`);
    assert.ok(r.ok, r.ok ? "" : r.error);
    paid += r.data.paid; gone += r.data.salvaged;
    assert.ok(rounds < 10, "termina");
  }
  assert.equal(gone, 1_697);
  assert.equal(paid, expected, "la suma de las tandas es el total de la vista previa");
  assert.equal(db.table("user_cards").filter((r) => r.user_id === A).length, 3);
  assert.equal(Number(db.table("profiles").find((r) => r.id === A)!.credits), expected);
  assert.equal(rounds, 4, "500 + 500 + 500 + 197");
});

test("DESGUACE · repetir una tanda con la misma clave no paga ni borra dos veces", async () => {
  const db = salvageWorld(40);
  const p = await previewSalvage(db.client, A);
  assert.ok(p.ok);
  const a = await salvageCards(db.client, A, p.data.uids, `salvage:${A}:misma`);
  const before = db.table("user_cards").length;
  const b = await salvageCards(db.client, A, p.data.uids, `salvage:${A}:misma`);
  assert.ok(a.ok && b.ok && b.data.repeated);
  assert.equal(b.data.paid, a.data.paid);
  assert.equal(db.table("user_cards").length, before);
});

test("DESGUACE · cartas de otra cuenta en la lista: se descartan; solo con ajenas, no se desguaza nada", async () => {
  const db = salvageWorld(10);
  db.seedUser(B, 0);
  for (let i = 0; i < 5; i++) db.table("user_cards").push({ uid: uid("b", i), user_id: B, card_id: DEFS[0].id, serial: null, origin: "pack", locked: false, obtained_at: new Date(0).toISOString(), minted_version: null });
  const alien = [uid("b", 1), uid("b", 2)];
  const r = await salvageCards(db.client, A, alien, `salvage:${A}:ajenas`);
  assert.ok(!r.ok && r.status === 409);
  assert.equal(db.table("user_cards").filter((x) => x.user_id === B).length, 5, "las cartas de B siguen ahí");
});

/* ───────────────────────── listado paginado de ejemplares ───────────────────────── */

const q = (over: Partial<CardsQuery> = {}): CardsQuery => ({ cardId: null, sort: "uid", locked: null, numbered: false, limit: 100, cursor: null, ...over });

async function walk(db: MemSupabase, user: string, base: CardsQuery): Promise<{ uids: string[]; pages: number; total: number | null }> {
  const uids: string[] = []; let cursor: string | null = base.cursor; let pages = 0; let total: number | null = null;
  for (;;) {
    const r = await listCardInstances(db.client, user, { ...base, cursor });
    assert.ok(r.ok, r.ok ? "" : r.error);
    if (pages === 0) total = r.data.total;
    if (cursor !== null) assert.equal(r.data.total, null, "el total solo viaja en la primera página");
    pages++;
    for (const i of r.data.items) uids.push(i.uid);
    assert.equal(r.data.hasMore, r.data.nextCursor !== null);
    if (!r.data.nextCursor) return { uids, pages, total };
    cursor = r.data.nextCursor;
    assert.ok(pages < 2_000);
  }
}

test("LISTADO · 0 cartas: página vacía, sin más páginas, total 0", async () => {
  const r = await listCardInstances(world(0).client, A, q());
  assert.ok(r.ok);
  assert.deepEqual([r.data.items.length, r.data.hasMore, r.data.nextCursor, r.data.total], [0, false, null, 0]);
});

for (const n of [100, 999, 1000, 1001, 5000]) {
  test(`LISTADO · ${n} cartas: se recorren todas por cursor, sin repetir, y la última página no tiene siguiente`, async () => {
    const db = world(n);
    const w = await walk(db, A, q({ limit: 100 }));
    assert.equal(w.total, n);
    assert.equal(w.uids.length, n);
    assert.equal(new Set(w.uids).size, n);
    assert.equal(w.pages, Math.ceil(n / 100));
    assert.deepEqual(w.uids, [...w.uids].sort(), "orden estable y determinista (uid)");
    assert.equal(w.uids[n - 1], uid("a", n - 1));
  });
}

test("LISTADO · copias de UNA carta ordenadas por serie (numeradas primero, ascendente) y después por uid; filtros combinados", async () => {
  const db = world(0);
  const t = db.table("user_cards");
  const card = DEFS[0].id;
  for (let i = 0; i < 260; i++) t.push({ uid: uid("a", i), user_id: A, card_id: card, serial: i % 4 === 0 ? 1000 - i : null, origin: "pack", locked: i % 10 === 0, obtained_at: new Date(i).toISOString(), minted_version: 1 });
  for (let i = 300; i < 340; i++) t.push({ uid: uid("a", i), user_id: A, card_id: DEFS[1].id, serial: null, origin: "pack", locked: false, obtained_at: new Date(i).toISOString(), minted_version: 1 });
  const all = await walk(db, A, q({ cardId: card, sort: "serial", limit: 48 }));
  assert.equal(all.total, 260); assert.equal(all.uids.length, 260); assert.equal(new Set(all.uids).size, 260);
  const byUid = new Map(t.map((r) => [r.uid as string, r]));
  const serials = all.uids.map((u) => byUid.get(u)!.serial as number | null);
  const firstNull = serials.indexOf(null);
  assert.equal(firstNull, 65, "65 numeradas primero");
  assert.deepEqual(serials.slice(0, firstNull), [...serials.slice(0, firstNull)].sort((a, b) => a! - b!));
  assert.ok(serials.slice(firstNull).every((s) => s === null));
  assert.deepEqual(all.uids.slice(firstNull), [...all.uids.slice(firstNull)].sort());
  const numbered = await walk(db, A, q({ cardId: card, sort: "serial", numbered: true, limit: 20 }));
  assert.equal(numbered.uids.length, 65); assert.equal(numbered.total, 65);
  const free = await walk(db, A, q({ cardId: card, sort: "serial", locked: false, limit: 50 }));
  assert.equal(free.uids.length, 234); assert.equal(free.total, 234);
  assert.ok(free.uids.every((u) => byUid.get(u)!.locked === false));
  const lockedNumbered = await walk(db, A, q({ cardId: card, sort: "uid", locked: true, numbered: true, limit: 5 }));
  assert.equal(lockedNumbered.uids.length, 13, "filtros combinados: en venta Y numeradas (i múltiplo de 20)");
});

test("LISTADO · cartas que entran y salen mientras se pagina: ninguna se repite y las que no se tocaron salen todas", async () => {
  const db = world(600);
  const first = await listCardInstances(db.client, A, q({ limit: 100 }));
  assert.ok(first.ok);
  db.tables.user_cards = db.table("user_cards").filter((r) => r.uid !== uid("a", 5) && r.uid !== uid("a", 350)); // una ya vista, otra pendiente
  db.table("user_cards").push({ uid: uid("a", 700), user_id: A, card_id: DEFS[0].id, serial: null, origin: "pack", locked: false, obtained_at: new Date().toISOString(), minted_version: 1 });
  const rest = await walk(db, A, q({ limit: 100, cursor: first.data.nextCursor }));
  const all = [...first.data.items.map((i) => i.uid), ...rest.uids];
  assert.equal(new Set(all).size, all.length);
  assert.ok(!all.includes(uid("a", 350)) && all.includes(uid("a", 700)) && all.includes(uid("a", 599)));
  assert.equal(all.length, 600, "600 − 1 pendiente borrada + 1 nueva (la ya vista y borrada se quedó en la primera página)");
});

test("SEGURIDAD · cuentas aisladas: ni el listado, ni la consulta por uid, ni un cursor ajeno enseñan cartas de otro", async () => {
  const db = world(300);
  const mine = await walk(db, B, q({ limit: 3 }));
  assert.equal(mine.uids.length, 7);
  assert.ok(mine.uids.every((u) => u.startsWith("bbbbbbbb")));
  // Un cursor emitido para A, usado por B: solo desplaza el punto de partida DENTRO de las cartas de B.
  const pageA = await listCardInstances(db.client, A, q({ limit: 3 }));
  assert.ok(pageA.ok && pageA.data.nextCursor);
  const crossed = await listCardInstances(db.client, B, q({ limit: 100, cursor: pageA.data.nextCursor }));
  assert.ok(crossed.ok);
  assert.ok(crossed.data.items.every((i) => i.uid.startsWith("bbbbbbbb")), "el cursor no es una credencial: la consulta filtra por el usuario del token");
  const look = await lookupCardInstances(db.client, B, [uid("a", 1), uid("a", 2), uid("b", 1)]);
  assert.ok(look.ok);
  assert.deepEqual(look.data.items.map((i) => i.uid), [uid("b", 1)]);
  assert.deepEqual((await readUserCardsByUid(db.client, A, [uid("b", 0)])).length, 0);
  const json = JSON.stringify(look.data);
  assert.ok(!/user_id|email/.test(json), "no viaja el dueño ni nada ajeno al ejemplar");
});

test("SEGURIDAD · cursores inválidos: basura, de otros filtros, de otra versión o con un uid que no es uuid → 400, nunca un error interno", async () => {
  const db = world(50);
  const base = q({ limit: 10 });
  const good = encodeCursor(base, { p: "u", u: uid("a", 9) });
  assert.deepEqual(decodeCursor(good, base), { p: "u", u: uid("a", 9) });
  const forged = (body: unknown) => Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
  const real = JSON.parse(Buffer.from(good, "base64url").toString("utf8")) as { f: string };
  const bad = [
    "", "%%%", "a".repeat(500), "bm8ganNvbg", forged(null), forged([1]), forged({ v: 2, f: real.f, at: { p: "u", u: uid("a", 9) } }),
    forged({ v: 1, f: "otra-huella", at: { p: "u", u: uid("a", 9) } }),
    forged({ v: 1, f: real.f, at: { p: "u", u: "'; drop table user_cards; --" } }),
    forged({ v: 1, f: real.f, at: { p: "u", u: uid("a", 9), extra: 1 } }),
    forged({ v: 1, f: real.f, at: { p: "s", s: 5 } }), // posición de serie en un orden por uid
    encodeCursor(q({ limit: 10, cardId: DEFS[0].id }), { p: "u", u: uid("a", 9) }), // emitido para otros filtros
  ];
  for (const c of bad) {
    assert.equal(decodeCursor(c, base), null, c.slice(0, 30));
    const r = await listCardInstances(db.client, A, { ...base, cursor: c });
    assert.ok(!r.ok && r.status === 400 && r.code === "BAD_CURSOR", c.slice(0, 30));
  }
});

test("SEGURIDAD · parámetros: claves desconocidas, usuario, límites fuera de rango y listas de uid mal formadas → 400", () => {
  const p = (s: string) => parseCardsQuery(new URLSearchParams(s));
  for (const s of ["userId=" + A, "user=" + A, "offset=10", "limit=0", "limit=101", "limit=1e2", "limit=-1", "sort=price", "sort=serial", "card=../../etc", "locked=2", "numbered=0", "card=a&card=b", "uids=", "uids=nope", "uids=" + uid("a", 1) + "&limit=5", "uids=" + Array.from({ length: 61 }, (_, i) => uid("a", i)).join(",")]) {
    const r = p(s);
    assert.ok(!r.ok && r.status === 400, s);
  }
  const ok = p(`card=${encodeURIComponent(DEFS[0].id)}&limit=${CARDS_PAGE_MAX}&locked=0`);
  assert.ok(ok.ok && ok.data.kind === "page" && ok.data.query.sort === "serial" && ok.data.query.limit === CARDS_PAGE_MAX && ok.data.query.locked === false);
  const lk = p(`uids=${uid("a", 1)},${uid("a", 1)},${uid("a", 2)}`);
  assert.ok(lk.ok && lk.data.kind === "lookup" && lk.data.uids.length === 2, "sin repetidos");
});

test("LISTADO · un fallo de la base responde error controlado (500 genérico), no una página vacía que parezca «sin cartas»", async () => {
  const db = world(20);
  db.failTables.add("user_cards");
  const r = await listCardInstances(db.client, A, q());
  assert.ok(!r.ok && r.status === 500 && r.code === "UNAVAILABLE");
  const l = await lookupCardInstances(db.client, A, [uid("a", 1)]);
  assert.ok(!l.ok && l.status === 500);
});
