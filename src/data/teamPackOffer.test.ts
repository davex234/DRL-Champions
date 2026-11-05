/**
 * LA OFERTA DE SOBRES DE EQUIPO — quién está dentro, quién salió y con qué arte (2026-09-22).
 *
 * El cambio de este día: llegaron los artes oficiales de Team Liquid y Karmine Corp —su ÚNICO
 * bloqueo auditado (`ARTWORK_PENDING`)— y pasaron a ACTIVE; NAVI se RETIRÓ del escaparate.
 *
 * Lo que este fichero protege:
 *
 *   · La oferta activa es exactamente la decidida, y no se cuela un DRAFT por descuido.
 *   · RETIRAR NO ES BORRAR: NAVI conserva definición, arte y capacidad de abrirse, porque hay
 *     inventario comprado que tiene que seguir funcionando.
 *   · Un sobre de equipo NO se activa si los datos no lo aguantan (sin cartas, o con un sesgo que
 *     no sube la probabilidad, o que la convierte en garantía). Eso lo dice la auditoría, no yo.
 *   · Cada sobre pinta SU arte, por la única fuente de verdad (`packArtwork`).
 *
 * OJO con una lectura fácil y equivocada: un Team Pack NO es un sobre exclusivo del equipo. Es un
 * sobre REGIONAL con SESGO (`boost-team-<id>`, peso 5 frente a 1). Puede —y debe— entregar cartas
 * de otros equipos de su región: es lo que separa «más probabilidad» de «garantía», y lo fija
 * `teamPackCatalog.test.ts`. Aquí se comprueba el límite que sí existe: nunca sale una carta de
 * FUERA de la región del sobre.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PACKS, getPack } from "./packs";
import { packArtwork, PACK_ART_AVAILABLE } from "./packArtwork";
import { IMPORT_MAP } from "../../scripts/pack-art-import";
import { TEAM_PACK_AUDIT, derivedBlockers, deriveStatus, teamCardsInCatalog, teamPackEconomics } from "./teamPackCatalog";
import { STORE_CATALOG } from "./storeCatalog";
import { isTeamPackCard, teamPackIdentity } from "./teamIdentities";
import { packLifecycle, isPurchasable, isStoreVisible, isPubliclyOpenable } from "@/domain/packs/lifecycle";
import { publicPacks, catalogGroups } from "@/components/packs/packCatalog";
import { buildPool } from "@/domain/packs/pool";
import { CardRegistry } from "@/collection/registry";

const teamPacks = () => PACKS.filter((p) => p.team);
const activos = () => teamPacks().filter((p) => packLifecycle(p) === "ACTIVE").map((p) => p.id).sort();
const audit = (packId: string) => TEAM_PACK_AUDIT.find((e) => e.packId === packId);

/* ═══════════ QUIÉN ESTÁ EN LA OFERTA ═══════════ */

test("F5134 T1 · la oferta activa de EQUIPOS es exactamente Heretics, Fnatic, G2, Team Liquid y Karmine Corp", () => {
  assert.deepEqual(activos(), ["team-fnatic", "team-g2", "team-heretics", "team-karmine", "team-liquid"]);
  const equipos = catalogGroups("equipos").flatMap((g) => g.packs.map((p) => p.id)).sort();
  assert.deepEqual(equipos, activos(), "el catálogo público enseña exactamente los activos");
});

test("F5134 T2 · NAVI fuera de la oferta, pero NO borrado: sigue definido, abrible y con su arte", () => {
  const navi = getPack("team-navi");
  assert.ok(navi, "la definición de NAVI se conserva");
  assert.equal(packLifecycle(navi!), "RETIRED", "retirado, no DRAFT ni eliminado");
  assert.equal(isStoreVisible(navi!), false, "fuera del escaparate");
  assert.equal(isPurchasable(navi!), false, "no se compra");
  assert.equal(isPubliclyOpenable(navi!), true, "los sobres ya comprados se siguen abriendo");
  assert.equal(packArtwork("team-navi"), "/packs/pack-team-navi.webp", "conserva su arte para el inventario");
  assert.ok(!publicPacks().some((p) => p.id === "team-navi"), "no aparece en /packs");
  /* Y sus valores no se han tocado: retirar es una decisión de escaparate, no de economía. */
  assert.equal(navi!.price, getPack("emea")!.price, "hereda el precio de su regional (3.500 desde la F57.6)");
  assert.equal(navi!.cardCount, 5);
  assert.deepEqual(navi!.weights, { common: 35, uncommon: 40, rare: 18, epic: 6, legendary: 1 });
});

test("F5134 T3 · Team Liquid y Karmine Corp: ACTIVOS porque la auditoría quedó sin bloqueos", () => {
  for (const [packId, team, cartas] of [["team-liquid", "TL", 11], ["team-karmine", "KC", 4]] as const) {
    const p = getPack(packId)!;
    assert.equal(packLifecycle(p), "ACTIVE", packId);
    assert.equal(p.team, team, `${packId}: alias de equipo`);
    const e = audit(packId)!;
    assert.deepEqual(derivedBlockers(e), [], `${packId}: sin bloqueos derivados de los datos`);
    assert.equal(deriveStatus(derivedBlockers(e), true), "READY", packId);
    assert.equal(e.status, "READY", `${packId}: el estado declarado es el medido`);
    assert.equal(teamCardsInCatalog(e), cartas, `${packId}: cartas reales con su equipo impreso`);
  }
});

test("F5134 T4 · ningún sobre de equipo se activa si los datos no lo aguantan", () => {
  const malos = ["NO_TEAM_CARDS", "BOOST_INEFFECTIVE", "BOOST_IS_GUARANTEE", "IDENTITY_UNPROVEN"];
  for (const p of teamPacks().filter((x) => packLifecycle(x) === "ACTIVE")) {
    const e = audit(p.id);
    if (!e) continue;   // NAVI y los de fuera del encargo no están auditados
    for (const b of derivedBlockers(e)) assert.ok(!malos.includes(b), `${p.id} está ACTIVE con el bloqueo ${b}`);
  }
  /* Y los que siguen en DRAFT no se han colado en la oferta. */
  const drafts = teamPacks().filter((p) => packLifecycle(p) === "DRAFT");
  assert.ok(drafts.length >= 13, `quedan ${drafts.length} en DRAFT`);
  for (const p of drafts) {
    assert.ok(!publicPacks().some((x) => x.id === p.id), `${p.id} (DRAFT) no puede aparecer`);
    assert.equal(isPurchasable(p), false, p.id);
  }
});

/* ═══════════ IDENTIDAD, ARTE Y PRECIO ═══════════ */

test("F5134 T5 · cada sobre de equipo apunta a SU equipo canónico", () => {
  const esperado: Record<string, string> = {
    "team-heretics": "team-heretics", "team-fnatic": "fnatic", "team-g2": "g2",
    "team-liquid": "team-liquid", "team-karmine": "karmine-corp", "team-navi": "navi",
  };
  for (const [packId, canonical] of Object.entries(esperado)) {
    const p = getPack(packId)!;
    assert.equal(teamPackIdentity(p.team!)?.canonicalId, canonical, packId);
  }
});

test("F5134 T6 · cada sobre pinta SU arte, por la fuente de verdad y sin repetirse", () => {
  const artes = new Map<string, string>();
  for (const p of teamPacks().filter((x) => packLifecycle(x) !== "DRAFT")) {
    const art = packArtwork(p.id);
    assert.equal(art, `/packs/pack-${p.id}.webp`, `${p.id}: arte por convención`);
    assert.ok(PACK_ART_AVAILABLE.has(p.id), `${p.id}: declarado en el manifiesto`);
    assert.ok(!artes.has(art!), `${p.id} comparte arte con ${artes.get(art!)}`);
    artes.set(art!, p.id);
  }
  assert.equal(artes.size, 6, "los cinco activos y NAVI, cada uno con el suyo");
});

test("F5134 T7 · EWC conserva su producto y estrena arte", () => {
  const ewc = getPack("ewc")!;
  assert.equal(packArtwork("ewc"), "/packs/pack-ewc.webp");
  /* Solo cambia la imagen: contenido, pesos declarados, garantía y evento siguen donde estaban. Pack Opening 3.1: el precio
     pasa a 8.500 y el sorteo a su plan por ranuras (la garantía vive en la carta destacada: Champions S o Icon). */
  assert.equal(ewc.price, 8500);
  assert.equal(ewc.cardCount, 5);
  assert.equal(ewc.guaranteedMin, "epic");
  assert.equal(ewc.eventId, "ewc-2026");
  assert.equal(packLifecycle(ewc), "ACTIVE");
  assert.deepEqual(ewc.weights, { common: 8, uncommon: 38, rare: 32, epic: 19, legendary: 3 });
});

test("F5134 T8 · el precio no se inventa: se deriva del sobre regional de su región", () => {
  for (const p of teamPacks()) {
    const eco = teamPackEconomics(p.restrictRegion!);
    assert.equal(p.price, eco.price, `${p.id}: precio`);
    assert.equal(p.cardCount, eco.cardCount, `${p.id}: cartas`);
    assert.deepEqual(p.weights, eco.weights, `${p.id}: pesos`);
  }
  assert.equal(getPack("team-liquid")!.price, getPack("emea")!.price, "Team Liquid hereda del Sobre EMEA");
  assert.equal(getPack("team-karmine")!.price, getPack("emea")!.price);
});

/* ═══════════ POOL ═══════════ */

test("F5134 T9 · el pool de un sobre de equipo es el de SU REGIÓN, y sus cartas propias son las impresas", () => {
  const registry = new CardRegistry();
  for (const p of teamPacks().filter((x) => packLifecycle(x) === "ACTIVE")) {
    const flat = buildPool(registry, p).flat;
    assert.ok(flat.length > 0, `${p.id}: pool vacío`);
    for (const c of flat) {
      assert.equal(registry.player(c.playerId)?.region, p.restrictRegion, `${p.id}: ${c.id} es de otra región`);
    }
    const suyas = flat.filter((c) => isTeamPackCard(c, registry.player(c.playerId), p.team));
    assert.ok(suyas.length > 0, `${p.id}: sin cartas del equipo no hay sesgo posible`);
    /*
     * El sobre NO es exclusivo: el sesgo repondera, no restringe. Si el pool fuera casi solo del
     * equipo, «más probabilidad» se habría convertido en «garantía» — el límite es de la casa.
     */
    assert.ok(flat.length > suyas.length * 2, `${p.id}: el pool es casi solo del equipo (${suyas.length}/${flat.length})`);
  }
});

test("F5134 T10 · Team Liquid y Karmine Corp solo cuentan como suyas las cartas de su equipo impreso", () => {
  const registry = new CardRegistry();
  for (const [packId, tag] of [["team-liquid", "TL"], ["team-karmine", "KC"]] as const) {
    const p = getPack(packId)!;
    const suyas = buildPool(registry, p).flat.filter((c) => isTeamPackCard(c, registry.player(c.playerId), p.team));
    assert.equal(suyas.length, teamCardsInCatalog(audit(packId)!), `${packId}: mismas cartas que mide la auditoría`);
    for (const c of suyas) {
      assert.equal(teamPackIdentity(tag)?.canonicalId, teamPackIdentity(p.team!)?.canonicalId, `${packId}: identidad`);
    }
  }
});

/* ═══════════ TIENDA ═══════════ */

test("F5134 T11 · la tienda ofrece los cinco de equipo y no ofrece NAVI", () => {
  const ofertas = STORE_CATALOG.packOffers;
  const ids = ofertas.map((o) => o.id);
  assert.equal(new Set(ids).size, ids.length, "sin ofertas duplicadas");
  assert.equal(new Set(ofertas.map((o) => o.packId)).size, ofertas.length, "un producto no se ofrece dos veces");
  const activas = ofertas.filter((o) => o.enabled).map((o) => o.packId);
  for (const id of ["team-heretics", "team-fnatic", "team-g2", "team-liquid", "team-karmine"]) {
    assert.ok(activas.includes(id), `${id} debe ofrecerse`);
  }
  assert.ok(!activas.includes("team-navi"), "NAVI ya no se ofrece");
  /* La entrada de NAVI se conserva deshabilitada: el historial de configuración no se borra. */
  assert.equal(ofertas.find((o) => o.packId === "team-navi")?.enabled, false);
  /* Y toda oferta activa apunta a un producto que existe y se puede vender. */
  for (const packId of activas) {
    const p = getPack(packId);
    assert.ok(p, `${packId}: oferta sin producto`);
    assert.equal(isPurchasable(p!), true, `${packId}: ofertado pero no vendible`);
  }
});

test("F5135 G1 · G2 es UN solo producto, y su arte canónico es el oficial importado", () => {
  /* Hotfix visual del 2026-09-22: el sobre de G2 cambió de imagen y NADA más. */
  const porId = PACKS.filter((p) => p.id === "team-g2");
  const porEquipo = PACKS.filter((p) => p.team === "G2" || p.team === "G2 Esports");
  assert.equal(porId.length, 1, "una única definición de G2 por id");
  assert.deepEqual(porEquipo.map((p) => p.id), ["team-g2"], "nadie más dice ser G2");

  const g2 = porId[0];
  assert.equal(packArtwork(g2.id), "/packs/pack-team-g2.webp", "resuelve por la fuente de verdad");
  assert.ok(PACK_ART_AVAILABLE.has("team-g2"));
  /* Y ese fichero es el arte oficial importado, no el dibujo procedimental de antes. */
  const origen = IMPORT_MAP.find((m) => m.packId === "team-g2");
  assert.ok(origen, "team-g2 tiene que estar en el importador de arte oficial");
  assert.equal(origen!.file, "G2.png");

  /* El producto no se ha movido ni un milimetro. */
  assert.equal(g2.name, "Sobre G2");
  assert.equal(g2.team, "G2");
  assert.equal(teamPackIdentity(g2.team!)?.canonicalId, "g2");
  assert.equal(g2.restrictRegion, "Americas");
  assert.equal(g2.price, 3500, "3.000 → 3.500 en la F57.6, con el regional de Americas");
  assert.equal(g2.cardCount, 5);
  assert.deepEqual(g2.weights, { common: 35, uncommon: 40, rare: 18, epic: 6, legendary: 1 });
  assert.equal(packLifecycle(g2), "ACTIVE");
  assert.equal(isPurchasable(g2), true);
  assert.equal(teamCardsInCatalog(audit("team-g2")!), 20, "sus 20 cartas de G2 siguen ahí");
  assert.deepEqual(derivedBlockers(audit("team-g2")!), []);
});

test("F5134 T12 · ningún id de sobre repetido en el catálogo", () => {
  const ids = PACKS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, "hay ids duplicados en data/packs.ts");
});
