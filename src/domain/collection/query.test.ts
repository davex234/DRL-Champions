/**
 * FASE 37 · CONSULTA DE LA COLECCIÓN — URL como texto hostil, filtros reales combinados, búsqueda sin diacríticos,
 * orden compuesto determinista y comparación de combate sin veredicto.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CARDS, getPlayer } from "@/data/catalog";
import { CollectionEngine, emptyMeta } from "@/collection";
import { compareCombat, deltaText } from "@/collection/compare";
import { normalizeText } from "@/collection/filter";
import { getVariant } from "@/domain/cards/variants";
import { bucketForRank } from "@/domain/packs/types";
import {
  DEFAULT_QUERY, OWNERSHIP_LABEL, QUERY_LIMITS, SORTS, SORT_LABEL, activeFilterCount, parseCollectionQuery, runCollectionQuery, serializeCollectionQuery, toFilterSpec, toggleIn,
  type CollectionQuery,
} from "./query";
import { teamKeyOf } from "./room";

const P = (s: string) => new URLSearchParams(s);
const q = (patch: Partial<CollectionQuery> = {}): CollectionQuery => ({ ...DEFAULT_QUERY, ...patch });

// Índice de alias por clave de equipo sobre el catálogo real.
const aliases = new Map<string, Set<string>>();
for (const c of CARDS) { const p = getPlayer(c.playerId)!; const k = teamKeyOf(p.team).key; if (!aliases.has(k)) aliases.set(k, new Set()); aliases.get(k)!.add(p.team); }
const aliasesOf = (k: string) => [...(aliases.get(k) ?? [])];

const owned = CARDS.slice(0, 60).flatMap((c, i) => (i % 3 === 0 ? [c, c] : [c])).map((c, i) => ({ uid: `u${i}`, cardId: c.id, obtainedAt: 0 }));
const engine = new CollectionEngine(owned, { ...emptyMeta(), favorites: [CARDS[0].id, CARDS[3].id, CARDS[300].id] });
const run = (x: CollectionQuery) => runCollectionQuery(engine.views(), x, aliasesOf);

/* ───────────── URL ───────────── */

test("URL · vacía = consulta por defecto; serializar la por defecto = cadena vacía", () => {
  assert.deepEqual(parseCollectionQuery(P("")), DEFAULT_QUERY);
  assert.equal(serializeCollectionQuery(DEFAULT_QUERY), "");
});

test("URL · ida y vuelta estable con todos los campos", () => {
  const full = q({ q: "leviatan", own: "owned", rarity: ["legendary", "rare"], role: ["Flex"], region: ["EMEA"], team: ["fnatic"], edition: ["champions-s"], dup: true, fav: true, minOvr: 70, maxOvr: 88, sort: "copies" });
  assert.deepEqual(parseCollectionQuery(P(serializeCollectionQuery(full))), full);
});

test("URL · valores fuera de la lista blanca se ignoran (no se inventan filtros)", () => {
  const r = parseCollectionQuery(P("tener=robadas&rareza=mythic,legendary&rol=Wildcard,Flex&region=Marte&edicion=god&orden=precio"));
  assert.equal(r.own, "all");
  assert.deepEqual(r.rarity, ["legendary"]);
  assert.deepEqual(r.role, ["Flex"]);
  assert.deepEqual(r.region, []);
  assert.deepEqual(r.edition, []);
  assert.equal(r.sort, "ovr-desc");
});

test("URL · búsqueda normalizada y acotada; parámetros gigantes se descartan", () => {
  assert.equal(parseCollectionQuery(P("q=%20%20Leviat%C3%A1n%20%20")).q, "leviatan");
  assert.ok(parseCollectionQuery(P(`q=${"x".repeat(200)}`)).q.length <= QUERY_LIMITS.q);
  assert.equal(parseCollectionQuery(P(`q=${"x".repeat(QUERY_LIMITS.rawParam + 1)}`)).q, "");
});

test("URL · claves de equipo validadas: sin inyección ni rutas", () => {
  const r = parseCollectionQuery(P("equipo=fnatic,raw:MIBR,../etc,<script>,raw:" + "x".repeat(80)));
  assert.deepEqual(r.team, ["fnatic", "raw:MIBR"]);
});

test("URL · OVR: solo enteros 0–99; mínimo y máximo invertidos se corrigen", () => {
  assert.deepEqual([parseCollectionQuery(P("min=90&max=70")).minOvr, parseCollectionQuery(P("min=90&max=70")).maxOvr], [70, 90]);
  assert.equal(parseCollectionQuery(P("min=-5")).minOvr, null);
  assert.equal(parseCollectionQuery(P("min=100")).minOvr, null);
  assert.equal(parseCollectionQuery(P("min=7e1")).minOvr, null);
});

test("URL · listas acotadas y sin repetidos", () => {
  assert.deepEqual(parseCollectionQuery(P("rol=Flex,Flex,Duelista")).role, ["Flex", "Duelista"]);
  let x = q();
  for (const t of Array.from({ length: 30 }, (_, i) => `raw:T${i}`)) x = toggleIn(x, "team", t);
  assert.equal(x.team.length, QUERY_LIMITS.values);
});

test("URL · Record (params de página) también se acepta", () => {
  assert.equal(parseCollectionQuery({ tener: "missing", orden: "player" }).own, "missing");
});

/* ───────────── búsqueda ───────────── */

test("BÚSQUEDA · sin mayúsculas ni diacríticos, por jugador y por equipo", () => {
  assert.equal(normalizeText("  LEVIATÁN  Esports "), "leviatan esports");
  const player = getPlayer(CARDS[0].playerId)!;
  const byNick = run(q({ q: player.nick.toUpperCase() }));
  assert.ok(byNick.length > 0 && byNick.every((v) => normalizeText(v.nick).includes(normalizeText(player.nick)) || normalizeText(v.team).includes(normalizeText(player.nick)) || normalizeText(v.label).includes(normalizeText(player.nick)) || v.cardId.includes(normalizeText(player.nick))));
  const byTeam = run(q({ q: player.team }));
  assert.ok(byTeam.some((v) => v.team === player.team));
});

test("BÚSQUEDA · caracteres de expresión regular no rompen nada", () => {
  assert.deepEqual(run(q({ q: "(.*+?[" })), []);
});

test("BÚSQUEDA · por identificador de carta", () => {
  assert.deepEqual(run(q({ q: CARDS[5].id })).map((v) => v.cardId), [CARDS[5].id]);
});

/* ───────────── filtros combinados ───────────── */

test("FILTRO · poseídas + rareza", () => {
  const r = run(q({ own: "owned", rarity: ["common"] }));
  assert.ok(r.length > 0 && r.every((v) => v.owned && bucketForRank(v.rank) === "common"));
});

test("FILTRO · no conseguidas + equipo (identidad con varios alias)", () => {
  const r = run(q({ own: "missing", team: ["fnatic"] }));
  assert.ok(r.length > 0);
  assert.ok(r.every((v) => !v.owned && teamKeyOf(v.team).key === "fnatic"));
  assert.ok(new Set(r.map((v) => v.team)).size >= 1);
});

test("FILTRO · rol + rango de OVR", () => {
  const r = run(q({ role: ["Centinela"], minOvr: 70, maxOvr: 80 }));
  assert.ok(r.length > 0 && r.every((v) => v.role === "Centinela" && v.ovr >= 70 && v.ovr <= 80));
});

test("FILTRO · región + duplicadas", () => {
  const r = run(q({ region: ["EMEA", "Americas", "Pacific", "China"], dup: true }));
  assert.ok(r.length > 0 && r.every((v) => v.count >= 2));
});

test("FILTRO · favoritas + equipo", () => {
  const team = teamKeyOf(getPlayer(CARDS[0].playerId)!.team).key;
  const r = run(q({ fav: true, team: [team] }));
  assert.ok(r.every((v) => v.favorite && teamKeyOf(v.team).key === team));
  assert.ok(r.some((v) => v.cardId === CARDS[0].id));
});

test("FILTRO · edición", () => {
  const r = run(q({ edition: ["masters-l"] }));
  assert.ok(r.length > 0 && r.every((v) => v.variantId === "masters-l"));
});

test("FILTRO · sin resultados es una lista vacía, no un error", () => {
  assert.deepEqual(run(q({ minOvr: 99, maxOvr: 99, rarity: ["common"] })), []);
});

test("FILTRO · el FilterSpec del motor recibe exactamente lo pedido", () => {
  const spec = toFilterSpec(q({ own: "missing", dup: true, team: ["fnatic"], rarity: ["rare"] }), aliasesOf);
  assert.equal(spec.owned, false);
  assert.equal(spec.minCount, 2);
  assert.ok(spec.teams!.includes("Fnatic") && spec.teams!.includes("FNC"));
  assert.deepEqual(spec.rarities, ["rare"]);
  assert.equal(activeFilterCount(q({ own: "missing", dup: true, team: ["fnatic"], rarity: ["rare"], q: "x", sort: "rarity" })), 4);
});

/* ───────────── orden ───────────── */

test("ORDEN · por defecto OVR ↓ → rareza ↓ → jugador, total y determinista", () => {
  const r = run(q());
  assert.equal(r.length, CARDS.length);
  for (let i = 1; i < r.length; i++) {
    const a = r[i - 1], b = r[i];
    assert.ok(a.ovr > b.ovr || (a.ovr === b.ovr && (a.rank > b.rank || (a.rank === b.rank && a.nick.localeCompare(b.nick, "es") <= 0))), `${a.cardId} / ${b.cardId}`);
  }
  assert.deepEqual(run(q()).map((v) => v.cardId), r.map((v) => v.cardId));
});

test("ORDEN · OVR ↑, rareza y copias (F71.3: sin jugador ni equipo)", () => {
  const asc = run(q({ sort: "ovr-asc" }));
  assert.ok(asc[0].ovr <= asc[asc.length - 1].ovr);
  const rarity = run(q({ sort: "rarity" }));
  assert.ok(rarity[0].rank >= rarity[rarity.length - 1].rank);
  const copies = run(q({ sort: "copies", own: "owned" }));
  assert.ok(copies[0].count >= copies[copies.length - 1].count);
});

/* ───────────── comparación ───────────── */

const variantsOf = (pid: string) => CARDS.filter((c) => c.playerId === pid);

test("COMPARAR · misma carta: todo «=» y marcado como misma carta", () => {
  const c = compareCombat(CARDS[0], CARDS[0])!;
  assert.equal(c.sameCard, true);
  assert.ok(c.rows.every((r) => r.delta === 0 && r.deltaText === "="));
});

test("COMPARAR · dos variantes del mismo jugador se marcan como tales", () => {
  const [x, y] = variantsOf(CARDS.find((c) => variantsOf(c.playerId).length >= 2)!.playerId);
  const c = compareCombat(x, y)!;
  assert.equal(c.samePlayer, true);
  assert.equal(c.sameCard, false);
});

test("COMPARAR · filas en orden: OVR, Stronghold, Gamesense, Entryfrag, con las cifras EXACTAS del catálogo", () => {
  const a = CARDS[10], b = CARDS[300];
  const c = compareCombat(a, b)!;
  assert.deepEqual(c.rows.map((r) => r.key), ["ovr", "stronghold", "gamesense", "entryfrag"]);
  assert.deepEqual([c.rows[0].a, c.rows[1].a, c.rows[2].a, c.rows[3].a], [a.ovr, a.combat!.stronghold, a.combat!.gamesense, a.combat!.entryfrag]);
  for (const r of c.rows) assert.equal(r.delta, r.a - r.b);
});

test("COMPARAR · signos: +N, −N (signo menos tipográfico) e «=»; frase accesible", () => {
  assert.equal(deltaText(3), "+3");
  assert.equal(deltaText(-5), "−5");
  assert.equal(deltaText(0), "=");
  const a = CARDS.find((c) => c.ovr === 80)!;
  const b = CARDS.find((c) => c.ovr === 75)!;
  const r = compareCombat(a, b)!.rows[0];
  assert.equal(r.sentence, "OVR: 80 frente a 75, 5 más");
});

test("COMPARAR · roles distintos no producen veredicto: no hay «mejor»", () => {
  const duel = CARDS.find((c) => (c.role ?? getPlayer(c.playerId)!.role) === "Duelista")!;
  const sent = CARDS.find((c) => (c.role ?? getPlayer(c.playerId)!.role) === "Centinela")!;
  const c = compareCombat(duel, sent)!;
  assert.ok(!("better" in c));
  assert.ok(!JSON.stringify(c).includes("better"));
});

test("COMPARAR · sin stats de combate → null (no se inventan)", () => {
  assert.equal(compareCombat({ ...CARDS[0], combat: undefined }, CARDS[1]), null);
});

test("COMPARAR · una no poseída se compara igual (definición pública)", () => {
  const unowned = CARDS.find((c) => !engine.views().find((v) => v.cardId === c.id)!.owned)!;
  assert.ok(compareCombat(unowned, CARDS[0]));
  assert.ok(getVariant(unowned.variantId));
});

test("F71.3 · el desplegable de orden es exactamente OVR ↓, OVR ↑, Rareza y Copias (sin Jugador ni Equipo)", () => {
  const labels = SORTS.map((s) => SORT_LABEL[s]);
  assert.deepEqual(labels, ["OVR (mayor primero)", "OVR (menor primero)", "Rareza", "Copias"]);
  assert.ok(!labels.includes("Jugador") && !labels.includes("Equipo"));
  // Cada opción ordena de verdad (y la de por defecto sigue siendo OVR ↓).
  const desc = run(q({ sort: "ovr-desc" }));
  assert.ok(desc[0].ovr >= desc[desc.length - 1].ovr);
  const asc = run(q({ sort: "ovr-asc" }));
  assert.ok(asc[0].ovr <= asc[asc.length - 1].ovr);
  const rarity = run(q({ sort: "rarity" }));
  assert.ok(rarity[0].rank >= rarity[rarity.length - 1].rank);
  const copies = run(q({ sort: "copies", own: "owned" }));
  assert.ok(copies[0].count >= copies[copies.length - 1].count);
  // Enlaces antiguos con ?orden=player / ?orden=team caen al orden por defecto, sin romper.
  for (const old of ["player", "team"]) assert.equal(parseCollectionQuery({ orden: old }).sort, "ovr-desc");
  // El resto de la consulta (TODAS / POSEÍDAS / NO CONSEGUIDAS) sigue igual.
  assert.deepEqual(Object.values(OWNERSHIP_LABEL), ["Todas", "Poseídas", "No conseguidas"]);
});
