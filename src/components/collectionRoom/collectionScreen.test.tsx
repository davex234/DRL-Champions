/**
 * FASE 37 · PANTALLA DE LA SALA, MODELO Y FOTOS QA — render de `CollectionRoomScreen` (la misma pantalla de `/coleccion`
 * y del arnés), piezas de `roomModel` y coherencia de las fixtures QA SYNTHETIC del arnés.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { CARDS, getPlayer } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";
import { buildCollectionSnapshot, cardTeamKeyOf, isValidCardId, type CollectionPersonalFacts } from "@/domain/collection/room";
import { DEFAULT_QUERY, type CollectionQuery } from "@/domain/collection/query";
import { CollectionRoomScreen } from "./CollectionRoomScreen";
import { NAV_SECTIONS, isItemActive, sectionForPath } from "@/design/nav";
import { aliasesFrom, roomEngine, teamIndexOf, teamOptionsOf, type CollectionAccess, type CollectionRoomModel } from "./roomModel";
import {
  ANON, COMPLETE, FRESH, SCENES, SERIAL_CARD, STARTER, TEAM_FULL, TEAM_NEAR, UNOWNED_CARD, VETERAN,
} from "@/app/design-system/fase37/fixtures";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
const INDEX = teamIndexOf(CARDS);

function model(facts: CollectionPersonalFacts, access: CollectionAccess = "server", o: Partial<CollectionRoomModel> = {}): CollectionRoomModel {
  const snap = buildCollectionSnapshot(CARDS, getPlayer, facts);
  return { access, loading: false, offline: false, stale: false, snap, engine: roomEngine(facts.instances, snap.favorites), teamOptions: teamOptionsOf(INDEX), aliasesOf: aliasesFrom(INDEX), ...o };
}

const screen = (m: CollectionRoomModel, q: Partial<CollectionQuery> = {}) =>
  renderToStaticMarkup(<CollectionRoomScreen room={m} query={{ ...DEFAULT_QUERY, ...q }} onQuery={() => {}} onOpen={() => { throw new Error("no se abre al pintar"); }} />);

const cardsIn = (h: string) => (h.match(/data-card="/g) ?? []).length;

/* ───────────── pantalla ───────────── */

test("PANTALLA · con sesión: cabecera, descubrir (mayor OVR) y álbum de la primera tanda (48); sin libro de sets", () => {
  const h = screen(model(VETERAN));
  assert.match(h, /data-access="server"/);
  assert.match(h, /data-testid="collection-hero"/);
  assert.match(h, /data-testid="collection-discovery"/);
  assert.match(h, /data-testid="discovery-top"/);
  assert.match(h, /Tus cartas de mayor OVR/);
  assert.ok(!/collection-book|discovery-near/.test(h), "limpieza 2026-10-07: el libro de sets y «Casi completos» no se pintan aquí");
  assert.equal(cardsIn(h), 48);
  assert.match(h, /Ver 48 cartas más/);
});

test("PANTALLA · el contador del álbum es el de resultados, no el de cartas montadas", () => {
  const h = screen(model(VETERAN));
  assert.match(h, new RegExp(`>${CARDS.length}</span> cartas`));
});

test("PANTALLA · sin sesión: sin estado de propiedad, sin descubrir ni libro, y ninguna carta «No conseguida»", () => {
  const h = screen(model(ANON, "anon"));
  assert.ok(!/Estado de la carta/.test(h));
  assert.ok(!/collection-discovery|collection-book/.test(h));
  assert.ok(!/No conseguida/.test(h));
  assert.equal(cardsIn(h), 48);
});

test("CABECERA · sin sesión: el catálogo (772 cartas) sin «0 / 772», sin porcentaje ni barras de progreso", () => {
  const h = screen(model(ANON, "anon"));
  const hero = h.slice(h.indexOf('data-testid="collection-hero"'), h.indexOf('data-testid="collection-album"'));
  assert.match(hero, new RegExp(`>${CARDS.length}</span>`));
  assert.match(hero, /cartas en el catálogo/);
  assert.match(hero, /Inicia sesión para guardar tu colección/);
  assert.ok(!/role="progressbar"/.test(hero), "sin barras que parezcan progreso propio");
  assert.ok(!/0,0 %|\/ \d+ cartas/.test(hero));
});

test("PANTALLA · sin conexión con foto previa: aviso textual y la colección sigue", () => {
  const h = screen(model(VETERAN, "server", { offline: true, stale: true }));
  assert.match(h, /Sin conexión: enseñamos tu colección tal como la teníamos/);
  assert.equal(cardsIn(h), 48);
});

test("PANTALLA · error del servidor con foto previa: aviso distinto al de sin conexión", () => {
  const h = screen(model(VETERAN, "server", { stale: true }));
  assert.match(h, /El servidor no ha respondido/);
  assert.ok(!/Sin conexión/.test(h));
});

test("PANTALLA · modo local: nunca enseña el aviso del servidor", () => {
  assert.ok(!/collection-offline/.test(screen(model(STARTER, "local", { stale: true, offline: true }))));
});

test("PANTALLA · «Conseguidas»: solo cartas tuyas en la rejilla", () => {
  const h = screen(model(VETERAN), { own: "owned" });
  assert.ok(cardsIn(h) > 0);
  assert.ok(!/>No conseguida</.test(h), "ninguna marca «No conseguida» (el selector «No conseguidas» sí existe)");
  assert.ok(!/data-owned="false"/.test(h));
});

test("PANTALLA · «No conseguidas»: todas marcadas con texto, no solo color", () => {
  const h = screen(model(VETERAN), { own: "missing" });
  assert.equal(cardsIn(h), 48);
  assert.equal((h.match(/>No conseguida</g) ?? []).length, 48);
});

test("PANTALLA · búsqueda sin resultados: sin rejilla y con «Limpiar»", () => {
  const h = screen(model(VETERAN), { q: "zzqx" });
  assert.equal(cardsIn(h), 0);
  assert.match(h, /Buscando «zzqx»/);
  assert.match(h, /Limpiar/);
});

test("PANTALLA · los filtros activos se ven como chips con su nombre", () => {
  const h = screen(model(VETERAN), { rarity: ["legendary"], dup: true, minOvr: 80 });
  assert.match(h, />Legendaria</);
  assert.match(h, />Duplicadas</);
  assert.match(h, /OVR ≥ 80/);
});

test("PANTALLA · legendarias: exactamente las del catálogo real", () => {
  const total = buildCollectionSnapshot(CARDS, getPlayer, FRESH).sets.rarity.find((s) => s.key === "legendary")!.total;
  const h = screen(model(VETERAN), { rarity: ["legendary"] });
  assert.ok(total > 0);
  assert.equal(cardsIn(h), Math.min(48, total));
  assert.match(h, new RegExp(`>${total}</span> ${total === 1 ? "carta" : "cartas"}`));
});

test("PANTALLA · solo duplicadas: cada carta de la rejilla lleva su ×N", () => {
  const h = screen(model(VETERAN), { dup: true });
  const n = cardsIn(h);
  assert.ok(n > 0);
  assert.ok((h.match(/×\d+/g) ?? []).length >= n);
});

test("PANTALLA · cada carta tiene nombre accesible con jugador, OVR, rareza, variante y estado", () => {
  const h = screen(model(VETERAN), { own: "missing" });
  assert.match(h, /aria-label="[^"]+, OVR \d+, [^"]+, [^"]+, no conseguida\. Abrir ficha"/);
});

test("LIMPIEZA /COLECCION · la página de cartas no pinta sets, maestría ni objetivos (siguen en su sitio canónico)", () => {
  const h = screen(model(VETERAN));
  assert.ok(!/Completa tus sets|Libro de la colección|Casi completos|Maestría|Objetivos de colección|data-set="/i.test(h));
  const page = read("src/app/coleccion/page.tsx");
  assert.ok(!/MasteryPanel|PrestigePanel|CollectionObjectives|fetchMastery|fetchPrestige|CollectionBook/.test(page));
  assert.ok(!/CollectionBook/.test(read("src/components/collectionRoom/CollectionRoomScreen.tsx")));
  // Sets: Sala de Trofeos (F82) + Maestría y Prestigio, mismos componentes y lecturas, ahora allí.
  const trophies = read("src/app/coleccion/trofeos/page.tsx");
  assert.match(trophies, /<TrophyRoomScreen room=\{room\}>/);
  assert.match(trophies, /<MasteryPanel view=\{mastery\}/);
  assert.match(trophies, /<PrestigePanel view=\{prestige\}/);
  assert.match(trophies, /fetchMastery\(\)/);
  // Objetivos y logros: Progresión (reclama) y Logros.
  assert.match(read("src/components/progression/ProgressionScreen.tsx"), /<ProgressionHub/);
  assert.match(read("src/app/logros/page.tsx"), /claimAchievement\(a\.id\)/);
  // El enlace a la Sala de Trofeos sigue en la cabecera de la colección.
  assert.match(read("src/components/collectionRoom/CollectionRoomScreen.tsx"), /href="\/coleccion\/trofeos" data-testid="trophy-room-link"/);
});

test("LIMPIEZA /COLECCION · desplegable Colección: Mis cartas, Colecciones (Sala de Trofeos) e Inventario, sin subtítulos", () => {
  const sec = NAV_SECTIONS.find((s) => s.id === "coleccion")!;
  assert.deepEqual(sec.items.map((i) => [i.href, i.label]), [["/coleccion", "Mis cartas"], ["/coleccion/trofeos", "Colecciones"], ["/inventario", "Inventario"]]);
  assert.ok(sec.items.every((i) => !("hint" in i)), "ningún subtítulo (regla global: src/design/navMenus.test.tsx)");
  const shell = read("src/components/layout/GameShell.tsx");
  for (const t of ["Todo el catálogo y lo que posees", "Sets completos y su", "Tus sobres sin abrir y tus duplicadas"]) {
    assert.ok(!shell.includes(t) && !read("src/design/nav.ts").includes(t), t);
  }
  assert.ok(shell.includes('"nx-clip-sm nx-focus transition-colors duration-fast", NAV_MENU_ITEM, NAV_MENU_ROW,'), "centrada, compacta y con foco visible");
  // Activo: la entrada más específica; la sección se conserva también en el antiguo /colecciones.
  assert.ok(isItemActive("/coleccion/trofeos/team:g2", "/coleccion/trofeos") && !isItemActive("/coleccion/trofeos", "/coleccion"));
  assert.ok(isItemActive("/coleccion/carta/x", "/coleccion"));
  assert.equal(sectionForPath("/colecciones")?.id, "coleccion");
  assert.equal(sectionForPath("/coleccion/trofeos")?.id, "coleccion");
  // Navegación global limpia (2026-10-07): la misma regla vale ya para TODOS los menús (contrato en src/design/navMenus.test.tsx).
});

test("PANTALLA · cuenta nueva: libro a 0 y sin sets «casi completos» inventados", () => {
  const m = model(FRESH);
  assert.equal(m.snap.uniqueOwned, 0);
  assert.equal(m.snap.nearComplete.length, 0);
  assert.equal(cardsIn(screen(m)), 48);
});

test("PANTALLA · sin precio, valor, venta, mercado ni «Recientes»", () => {
  const h = screen(model(VETERAN));
  assert.ok(!/precio|valor|Vender|Mercado|🪙|Recientes|venta/i.test(h));
});

test("PANTALLA · la ruta y el arnés montan la MISMA pantalla (no hay una segunda sala)", () => {
  assert.match(read("src/app/coleccion/page.tsx"), /<CollectionRoomScreen /);
  assert.match(read("src/app/design-system/fase37/page.tsx"), /<CollectionRoomScreen /);
  assert.match(read("src/app/design-system/fase37/page.tsx"), /<CardDetailView/);
  assert.match(read("src/app/design-system/fase37/page.tsx"), /<CardCompareView/);
});

/* ───────────── modelo ───────────── */

test("MODELO · equipos por identidad: suman el catálogo y agrupan varios valores de Player.team (TH/Team Heretics…)", () => {
  const total = [...INDEX.values()].reduce((s, t) => s + t.total, 0);
  assert.equal(total, CARDS.length);
  // El equipo es el de la CARTA (impreso, canónico): un mismo equipo reúne cartas de jugadores con distinto
  // `Player.team` — Team Heretics junta «TH», «Team Heretics» (y a comeback, NAVI en VLR, con TH impreso).
  const valoresPorEquipo = new Map<string, Set<string>>();
  for (const c of CARDS) {
    const k = cardTeamKeyOf(c, getPlayer(c.playerId)).key;
    valoresPorEquipo.set(k, (valoresPorEquipo.get(k) ?? new Set()).add(getPlayer(c.playerId)!.team));
  }
  assert.ok([...valoresPorEquipo.values()].some((v) => v.size >= 2));
  assert.equal(INDEX.get("team-heretics")?.total, 11);
  assert.ok([...INDEX.keys()].every((k) => !k.startsWith("raw:")), "ninguna carta sin equipo canónico");
});

test("MODELO · opciones de equipo ordenadas por nombre en español", () => {
  const labels = teamOptionsOf(INDEX).map((t) => t.label);
  assert.deepEqual(labels, [...labels].sort((a, b) => a.localeCompare(b, "es")));
});

test("MODELO · alias de un equipo desconocido → lista vacía (nunca todos)", () => {
  assert.deepEqual(aliasesFrom(INDEX)("raw:No existe"), []);
});

test("MODELO · el motor ve todo el catálogo y marca como tuyas solo las definiciones con copia", () => {
  const e = roomEngine(STARTER.instances, []);
  const views = e.views();
  assert.equal(views.length, CARDS.length);
  assert.equal(views.filter((v) => v.owned).length, new Set(STARTER.instances.map((i) => i.cardId)).size);
});

test("MODELO · favoritas del servidor en la vista; la lista de entrada no se muta", () => {
  const favs = [CARDS[3].id];
  const e = roomEngine([], favs);
  assert.equal(e.views().find((v) => v.cardId === CARDS[3].id)?.favorite, true);
  assert.deepEqual(favs, [CARDS[3].id]);
});

test("MODELO · copias: el motor cuenta copias, la foto cuenta definiciones", () => {
  const two = [{ uid: "a", cardId: CARDS[0].id, serial: null, mintedVersion: 1 }, { uid: "b", cardId: CARDS[0].id, serial: null, mintedVersion: 1 }];
  assert.equal(roomEngine(two, []).views().find((v) => v.cardId === CARDS[0].id)?.count, 2);
  const snap = buildCollectionSnapshot(CARDS, getPlayer, { instances: two, favorites: [], showcaseUids: [], decks: [] });
  assert.equal(snap.uniqueOwned, 1);
  assert.equal(snap.duplicates, 1);
});

/* ───────────── fixtures QA SYNTHETIC ───────────── */

test("QA SYNTHETIC · el arnés lo dice en pantalla y las fixtures se declaran inventadas", () => {
  assert.match(read("src/app/design-system/fase37/page.tsx"), /QA SYNTHETIC/);
  assert.match(read("src/app/design-system/fase37/fixtures.ts"), /INVENTADAS/);
});

test("QA SYNTHETIC · toda carta de escena existe en el catálogo real (sin cartas falsas)", () => {
  for (const [name, s] of Object.entries(SCENES)) {
    const ids = s.kind === "detail" ? [s.cardId] : s.kind === "compare" ? [s.a, ...(s.b ? [s.b] : [])] : [];
    for (const id of ids) assert.ok(isValidCardId(id) && CARDS.some((c) => c.id === id), `${name}: ${id}`);
    for (const i of s.facts.instances) assert.ok(CARDS.some((c) => c.id === i.cardId), `${name}: ${i.cardId}`);
  }
});

test("QA SYNTHETIC · uids únicos en cada colección", () => {
  for (const f of [VETERAN, STARTER, COMPLETE]) assert.equal(new Set(f.instances.map((i) => i.uid)).size, f.instances.length);
});

test("QA SYNTHETIC · seriales solo en variantes serializadas, dentro de su tirada y sin repetirse por carta", () => {
  for (const f of [VETERAN, STARTER, COMPLETE]) {
    const seen = new Set<string>();
    for (const i of f.instances) {
      const v = getVariant(CARDS.find((c) => c.id === i.cardId)!.variantId);
      if (!v.serialized) { assert.equal(i.serial, null); continue; }
      assert.ok(i.serial !== null && i.serial >= 1 && i.serial <= (v.serialLimit ?? 500));
      const key = `${i.cardId}#${i.serial}`;
      assert.ok(!seen.has(key), key);
      seen.add(key);
    }
  }
});

test("QA SYNTHETIC · veterano: #1 de la serializada, un equipo completo y otro casi completo", () => {
  const snap = buildCollectionSnapshot(CARDS, getPlayer, VETERAN);
  assert.equal(snap.byCard.get(SERIAL_CARD.id)?.bestSerial, 1);
  assert.equal(snap.sets.team.find((s) => s.key === TEAM_FULL)?.complete, true);
  assert.ok(snap.nearComplete.some((s) => s.kind === "team" && s.key === TEAM_NEAR));
  assert.ok(!snap.byCard.has(UNOWNED_CARD.id));
});

test("QA SYNTHETIC · catálogo completo = 100 % y cuenta nueva = 0 %", () => {
  assert.equal(buildCollectionSnapshot(CARDS, getPlayer, COMPLETE).completionPct, 100);
  assert.equal(buildCollectionSnapshot(CARDS, getPlayer, FRESH).completionPct, 0);
});

test("QA SYNTHETIC · el anónimo no trae favoritos, vitrina ni equipos", () => {
  const snap = buildCollectionSnapshot(CARDS, getPlayer, ANON);
  assert.equal(snap.favoritesAvailable, false);
  assert.equal(snap.showcaseAvailable, false);
  assert.equal(snap.decksAvailable, false);
});

test("QA SYNTHETIC · hay escenas para cada estado pedido (sala, libro, álbum, ficha, comparador)", () => {
  const names = Object.keys(SCENES);
  for (const p of ["hub-", "book-", "album-", "detail-", "compare-"]) assert.ok(names.some((n) => n.startsWith(p)), p);
  for (const n of ["hub-offline", "hub-anon", "hub-complete", "detail-unowned", "detail-offline", "detail-showcase-full", "album-no-results"]) assert.ok(n in SCENES, n);
});
