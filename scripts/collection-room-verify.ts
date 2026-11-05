/**
 * FASE 37 · VERIFICADOR DE LA COLLECTION ROOM — `npm run collection-room:verify` (todo; `collection:verify` lo encadena
 *   tras el verificador del Collection Core Engine) o `collection-content:verify` · `collection-security:verify` ·
 *   `collection-performance:verify`.
 *
 * Sin base de datos real: catálogo real, dominio puro, servicio contra `MemorySupabase` y el código fuente de rutas,
 * cliente, UI y la migración 0052. RLS/PostgREST/`app_rate_take` reales: NO EJECUTADO — REQUIERE BD DE PRUEBAS AISLADA.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { CARDS, TOTAL_CARDS, getPlayer } from "../src/data/catalog";
import { PACKS } from "../src/data/packs";
import { CardRegistry } from "../src/collection";
import { isPurchasable } from "../src/domain/packs/lifecycle";
import { getVariant } from "../src/domain/cards/variants";
import {
  BUCKET_ORDER, EDITION_ORDER, REGION_ORDER, ROLE_ORDER, buildCollectionSnapshot, cardHref, isValidCardId, packsThatCanContain, playerVariants, rarityOf,
  type CollectionPersonalFacts, type OwnedInstanceFact,
} from "../src/domain/collection/room";
import { DEFAULT_QUERY, QUERY_LIMITS, parseCollectionQuery, runCollectionQuery } from "../src/domain/collection/query";
import { compareCombat } from "../src/collection/compare";
import { MemorySupabase } from "../src/server/services/testing/memorySupabase";
import { getCollectionPersonal, setFavorite } from "../src/server/services/collection";
import { aliasesFrom, roomEngine, teamIndexOf } from "../src/components/collectionRoom/roomModel";

const section = process.argv[2] ?? "all";
let ok = 0; let ko = 0;
const check = (label: string, cond: boolean, detail = "") => { if (cond) ok++; else ko++; console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`); };
const want = (s: string) => section === "all" || section === s;
const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const walk = (dir: string): string[] => readdirSync(join(ROOT, dir)).flatMap((f) => {
  const rel = `${dir}/${f}`;
  return statSync(join(ROOT, rel)).isDirectory() ? walk(rel) : [rel];
});

const U = "aaaaaaaa-0000-4000-8000-000000000370";
const OTHER = "bbbbbbbb-0000-4000-8000-000000000370";
const none: CollectionPersonalFacts = { instances: [], favorites: [], showcaseUids: [], decks: [] };
const inst = (cardId: string, n: number, serial: number | null = null): OwnedInstanceFact => ({ uid: `u-${cardId}-${n}`, cardId, serial, mintedVersion: 1 });
const sum = (xs: { total: number }[]) => xs.reduce((s, x) => s + x.total, 0);

const COLLECTION_UI = [
  "src/app/coleccion/page.tsx", "src/app/coleccion/carta/[cardId]/page.tsx", "src/app/coleccion/comparar/page.tsx",
  ...walk("src/components/collectionRoom").filter((f) => !f.includes(".test.")), "src/lib/collection/client.ts",
];

function world(): MemorySupabase {
  const db = new MemorySupabase();
  db.unique.user_card_favorites = [{ cols: ["user_id", "card_id"] }];
  db.tables = {
    user_cards: [
      { uid: "u1", user_id: U, card_id: CARDS[0].id, serial: null, minted_version: 1, origin: "pack", obtained_at: "2026-09-15T00:00:00Z" },
      { uid: "x1", user_id: OTHER, card_id: CARDS[2].id, serial: 1, minted_version: 1, origin: "pack", obtained_at: "2026-09-15T00:00:00Z" },
    ],
    user_card_favorites: [{ user_id: OTHER, card_id: CARDS[2].id, created_at: "2026-09-15T00:00:00Z" }],
    player_profile_customization: [{ user_id: OTHER, showcase_card_uids: ["x1"], featured_achievement_ids: [], version: 2 }],
    duel_decks: [{ id: "dX", user_id: OTHER, name: "Ajeno", card_uids: ["x1"], updated_at: "2026-09-15T00:00:00Z" }],
    duel_active_deck: [{ user_id: OTHER, deck_id: "dX" }],
    profiles: [{ id: OTHER, email: "other@example.com", is_admin: true }],
  };
  return db;
}

function median(fn: () => void, runs = 5): number {
  const times: number[] = [];
  for (let i = 0; i < runs; i++) { const t = performance.now(); fn(); times.push(performance.now() - t); }
  return times.sort((a, b) => a - b)[Math.floor(runs / 2)];
}

async function main() {
  if (want("content")) {
    console.log("\n· CONTENIDO (catálogo real)");
    const snap = buildCollectionSnapshot(CARDS, getPlayer, none);
    check("total del catálogo = definiciones reales (no un 772 fijo)", snap.catalogTotal === CARDS.length && CARDS.length === TOTAL_CARDS, String(snap.catalogTotal));
    check("sin «772» escrito a mano en el dominio ni en la UI de colección", ![...walk("src/domain/collection").filter((f) => !f.includes(".test.")), ...COLLECTION_UI].some((f) => /\b772\b/.test(code(read(f)))));
    check("todos los ids de carta con formato canónico", CARDS.every((c) => isValidCardId(c.id)));
    check("definición sin datos de instancia (serial, dueño, uid)", CARDS.every((c) => !("serial" in c) && !("owner" in c) && !("uid" in c) && !("userId" in c)));
    check("rarezas: solo enums reales y suman el catálogo", CARDS.every((c) => BUCKET_ORDER.includes(rarityOf(c))) && sum(snap.sets.rarity) === CARDS.length);
    check("roles reales (Flex incluido) y suman el catálogo", snap.sets.role.every((s) => (ROLE_ORDER as readonly string[]).includes(s.key)) && sum(snap.sets.role) === CARDS.length && (snap.sets.role.find((s) => s.key === "Flex")?.total ?? 0) > 0);
    check("regiones reales y suman el catálogo", snap.sets.region.every((s) => (REGION_ORDER as readonly string[]).includes(s.key)) && sum(snap.sets.region) === CARDS.length);
    check("ediciones reales y suman el catálogo", snap.sets.edition.every((s) => (EDITION_ORDER as readonly string[]).includes(s.key)) && sum(snap.sets.edition) === CARDS.length);
    const labels = snap.sets.team.map((s) => s.label.toLowerCase());
    check("equipos por identidad: suman el catálogo y sin dos sets con el mismo nombre", sum(snap.sets.team) === CARDS.length && new Set(labels).size === labels.length, `${snap.sets.team.length} equipos`);
    check("sin sets vacíos inventados", Object.values(snap.sets).every((xs) => xs.every((s) => s.total > 0)));
    check("stats de combate presentes en todo el catálogo", CARDS.every((c) => !!c.combat));
    let exact = true;
    for (let i = 0; i < CARDS.length; i += 7) {
      const a = CARDS[i]; const b = CARDS[(i * 13 + 5) % CARDS.length];
      const r = compareCombat(a, b)!;
      exact &&= r.rows[0].a === a.ovr && r.rows.slice(1).every((row) => row.a === a.combat![row.key as "stronghold"] && row.b === b.combat![row.key as "stronghold"]) && !("better" in r);
    }
    check("comparar usa OVR y stats del catálogo tal cual y sin veredicto", exact);
    const registry = new CardRegistry();
    const avail = CARDS.map((c) => packsThatCanContain(registry, PACKS, c));
    const purchasable = new Set(PACKS.filter((p) => isPurchasable(p)).map((p) => p.id));
    check("«dónde puede salir»: solo sobres ACTIVOS a la venta (nunca DRAFT ni RETIRED)", avail.every((xs) => xs.every((x) => purchasable.has(x.packId))));
    check("todas las cartas pueden salir en algún sobre activo", avail.every((xs) => xs.length > 0), `${avail.filter((xs) => xs.length === 0).length} sin sobre`);
    const all = buildCollectionSnapshot(CARDS, getPlayer, { ...none, instances: CARDS.map((c) => inst(c.id, 1)) });
    const twice = buildCollectionSnapshot(CARDS, getPlayer, { ...none, instances: CARDS.flatMap((c) => [inst(c.id, 1), inst(c.id, 2)]) });
    check("catálogo completo = 100 % y 0 duplicadas", all.completionPct === 100 && all.duplicates === 0 && all.uniqueOwned === CARDS.length);
    check("dos copias de todo: sigue 100 % (definiciones, no copias) y duplicadas = catálogo", twice.completionPct === 100 && twice.duplicates === CARDS.length && twice.totalCopies === 2 * CARDS.length);
    check("sin sets «casi completos» ni completos con 0 cartas", snap.nearComplete.length === 0 && Object.values(snap.sets).every((xs) => xs.every((s) => !s.complete)));
    const half = buildCollectionSnapshot(CARDS, getPlayer, { ...none, instances: CARDS.filter((_, i) => i % 4 !== 0).map((c) => inst(c.id, 1)) });
    check("casi completo: ≥ 70 %, < 100 % y set de al menos 5", half.nearComplete.every((s) => s.pct >= 70 && s.pct < 100 && s.total >= 5 && !s.complete), `${half.nearComplete.length} sets`);
    const shuffled = [...half.byCard.values()].flatMap((o) => o.instances).reverse();
    const again = buildCollectionSnapshot(CARDS, getPlayer, { ...none, instances: shuffled });
    check("la mejor carta es determinista (no depende del orden de llegada)", again.best?.cardId === half.best?.cardId && again.best?.uid === half.best?.uid);
    const p = CARDS[0].playerId;
    const vars = playerVariants(CARDS, p, twice);
    check("variantes de jugador ≠ copias (variantes cuentan definiciones)", vars.total === CARDS.filter((c) => c.playerId === p).length && vars.owned === vars.total);
    const facts: CollectionPersonalFacts = { ...none, instances: [inst(CARDS[0].id, 1)] };
    const before = JSON.stringify(facts);
    buildCollectionSnapshot(CARDS, getPlayer, facts);
    check("la foto es pura (no muta la entrada)", JSON.stringify(facts) === before);
    check("instancia huérfana (carta retirada del catálogo) contada aparte, sin romper el total", buildCollectionSnapshot(CARDS, getPlayer, { ...none, instances: [inst("nadie__gold", 1)] }).unknownInstances === 1);
    check("seriales solo en variantes serializadas del catálogo", CARDS.filter((c) => getVariant(c.variantId).serialized).every((c) => (getVariant(c.variantId).serialLimit ?? 0) > 0));
  }

  if (want("security")) {
    console.log("\n· SEGURIDAD");
    const route = read("src/app/api/game/collection/route.ts");
    check("GET: cualquier parámetro (?userId=) → 400", route.includes('if ([...new URL(req.url).searchParams.keys()].length > 0) return bad("Parámetro no válido");'));
    check("sin sesión → 401 (colección privada denegada al anónimo)", route.includes('"UNAUTHENTICATED", 401'));
    check("usuario siempre del token", route.includes("getCollectionPersonal(session.admin, session.userId)") && route.includes("setFavorite(session.admin, session.userId, body.cardId, body.favorite)") && !/body\.userId/.test(code(route)));
    check("POST de cuerpo cerrado y acotado", route.includes('"FIELD_NOT_ALLOWED"') && route.includes("if (raw.length > 2_000)"));
    check("personal no-store y límites propios", route.includes('"cache-control": "no-store"') && route.includes('"collection_read"') && route.includes('"collection_write"'));
    const db = world();
    const mine = await getCollectionPersonal(db.client, U);
    const json = JSON.stringify(mine.data);
    check("lectura propia: nada del otro (uid, serial, favoritos, vitrina, equipos, correo, admin)", mine.ok && !/x1|dX|Ajeno|other@example\.com|is_admin/.test(json) && mine.data!.favorites!.length === 0);
    check("leer no escribe", db.writes().length === 0, db.writes().join(","));
    const bad = ["../../etc/passwd", "..%2F..%2Fetc", "a".repeat(5000), "<script>__x", "Benjy__Gold", "", null, 7, { id: CARDS[0].id }];
    let rejected = true;
    for (const b of bad) { const r = await setFavorite(db.client, U, b, true); rejected &&= r.status === 400; }
    check("favorito: ids inválidos, rutas y cuerpos gigantes → 400 sin tocar la BD", rejected && db.writes().length === 0);
    check("favorito: carta inexistente → 404", (await setFavorite(db.client, U, "nadie__gold", true)).status === 404);
    await setFavorite(db.client, U, CARDS[2].id, false);
    check("favorito: quitar no afecta a los favoritos de otro usuario", db.rows("user_card_favorites").some((r) => r.user_id === OTHER));
    await setFavorite(db.client, U, CARDS[1].id, true);
    const writes = db.writes().filter((w) => w !== "rpc:app_content_distribution_snapshot");
    check("favorito: la única escritura es user_card_favorites", writes.length > 0 && writes.every((w) => w.endsWith(":user_card_favorites")), writes.join(","));
    const huge = parseCollectionQuery(new URLSearchParams({ q: "x".repeat(4000), rareza: "legendary,mythic", equipo: "<script>alert(1)</script>", min: "-5", max: "999", orden: "drop" }));
    check("URL: consulta gigante recortada y valores desconocidos descartados", huge.q.length <= QUERY_LIMITS.q && huge.rarity.join() === "legendary" && huge.team.length === 0 && huge.sort === DEFAULT_QUERY.sort);
    const index = teamIndexOf(CARDS);
    let safe = true;
    for (const q of ["(.*)+[", "\\", "a{999999}", "$^|?*"]) {
      try { runCollectionQuery(roomEngine([], []).views(), { ...DEFAULT_QUERY, q }, aliasesFrom(index)); } catch { safe = false; }
    }
    check("búsqueda sin regex peligrosa (caracteres especiales no rompen)", safe);
    check("enlace de ficha codificado", cardHref("a/../b").includes("%2F"));
    const detail = read("src/app/coleccion/carta/[cardId]/page.tsx");
    check("la ficha valida el id antes de usarlo", detail.includes("isValidCardId(id) ? getCard(id) : undefined"));
    const client = COLLECTION_UI.map(read).join("\n");
    check("sin service role en cliente ni UI de colección", !/service_role|SERVICE_ROLE|supabaseAdmin|createAdminClient/i.test(client));
    check("sin localStorage/sessionStorage como persistencia de favoritos", !/localStorage|sessionStorage/.test(code(client)));
    check("sin precio, venta, mercado ni venta rápida en la colección", !/quickSell|instanceValue|marketValue|listForSale|Vender|Mercado|🪙/i.test(code(client)));
    check("vitrina y equipos por sus APIs existentes (sin tablas directas)", !/from\("duel_decks"\)|from\("player_profile_customization"\)/.test(code(client)) && client.includes("saveShowcase(") && client.includes("<AddToDeckSheet"));
    const mig = read("supabase/migrations/0052_collection_favorites.sql");
    check("0052: RLS de lectura propia, sin escritura del cliente", mig.includes("enable row level security") && mig.includes("revoke all on public.user_card_favorites from anon, authenticated;") && mig.includes("using (auth.uid() = user_id)") && !/grant (insert|update|delete)/i.test(mig));
    const market = walk("src").filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes(".test.")).map((f) => [f, read(f)] as const).filter(([, s]) => /GLOBAL_MARKET_ENABLED\s*=/.test(s));
    check("mercado sigue cerrado (GLOBAL_MARKET_ENABLED=false)", market.length > 0 && market.every(([, s]) => !/GLOBAL_MARKET_ENABLED\s*=\s*true/.test(s)), market.map(([f]) => f).join(","));
    console.log("  · RLS / PostgREST / app_rate_take reales: NO EJECUTADO — REQUIERE BD DE PRUEBAS AISLADA");
  }

  if (want("performance")) {
    console.log("\n· RENDIMIENTO");
    const many: OwnedInstanceFact[] = [];
    for (let i = 0; i < 20_000; i++) many.push(inst(CARDS[i % CARDS.length].id, i));
    const facts: CollectionPersonalFacts = { instances: many, favorites: CARDS.slice(0, 200).map((c) => c.id), showcaseUids: many.slice(0, 3).map((x) => x.uid), decks: Array.from({ length: 100 }, (_, d) => ({ id: `d${d}`, name: `E${d}`, active: d === 0, cardUids: many.slice(d, d + 8).map((x) => x.uid) })) };
    const tSnap = median(() => buildCollectionSnapshot(CARDS, getPlayer, facts));
    check("foto con 20 000 copias, 200 favoritas y 100 equipos < 400 ms", tSnap < 400, `${tSnap.toFixed(1)} ms`);
    const engine = roomEngine(many, facts.favorites!);
    const index = teamIndexOf(CARDS);
    const views = engine.views();
    const tQuery = median(() => { runCollectionQuery(views, { ...DEFAULT_QUERY, q: "a", rarity: ["rare", "epic"], minOvr: 60 }, aliasesFrom(index)); runCollectionQuery(views, { ...DEFAULT_QUERY, sort: "copies" }, aliasesFrom(index)); });
    check("buscar + filtrar + ordenar el catálogo entero en cliente < 60 ms", tQuery < 60, `${tQuery.toFixed(1)} ms`);
    const screen = read("src/components/collectionRoom/CollectionRoomScreen.tsx");
    check("rejilla por tandas de 48 (nunca 772 cartas montadas)", screen.includes("const COLLECTION_PAGE = 48;") && screen.includes("results.slice(0, shown)"));
    const grid = read("src/components/album/AlbumGrid.tsx");
    check("Card3D estático en la rejilla (sin inclinación por carta)", grid.includes('mode="static"') && !/mode="(hover|legendary|selected|showcase)"/.test(grid));
    const ui = walk("src/components/collectionRoom").filter((f) => f.endsWith(".tsx") && !f.includes(".test.")).map(read).join("\n");
    check("una sola carta con profundidad en la sala (cabecera)", (ui.match(/mode="hover"/g) ?? []).length === 1);
    check("fotos de carta con carga diferida", walk("src/components/cards").some((f) => read(f).includes('loading="lazy"')));
    check("movimiento reducido respetado al girar", /useReducedMotion|prefers-reduced-motion/.test(read("src/components/collectionRoom/CardDetailView.tsx")));
    const svc = code(read("src/server/services/collection.ts"));
    check("servicio sin N+1: lecturas en paralelo y paginación por rango", svc.includes("await Promise.all([") && svc.includes(".range(from, from + PAGE - 1)"));
    const db = new MemorySupabase();
    db.tables = { user_cards: Array.from({ length: 2500 }, (_, i) => ({ uid: `u${String(i).padStart(5, "0")}`, user_id: U, card_id: CARDS[i % CARDS.length].id, serial: null, minted_version: 1 })), user_card_favorites: [], player_profile_customization: [], duel_decks: Array.from({ length: 40 }, (_, d) => ({ id: `d${d}`, user_id: U, name: `E${d}`, card_uids: [], updated_at: "2026-09-15T00:00:00Z" })), duel_active_deck: [] };
    const r = await getCollectionPersonal(db.client, U);
    const reads = db.log.filter((l) => l.startsWith("select:"));
    check("2 500 copias y 40 equipos: ≤ 8 lecturas (sin una por carta ni por equipo)", r.ok && r.data!.instances.length === 2500 && reads.length <= 8, `${reads.length} lecturas: ${reads.join(",")}`);
  }

  console.log(`\n${ok} ✓ · ${ko} ✗`);
  if (ko > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
