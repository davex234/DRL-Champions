/**
 * LA GAMA BASE — BRONCE → PLATA → ORO (Packs Base 4.0).
 *
 * Tres escalones de la casa (categoría `nexus`) que tienen que leerse como una escalera. Lo que
 * este fichero protege no son los nombres: es que la escalera SEA una escalera cuando se la mide
 * con el instrumento del propio repo (`PACK_STATS`, generado por `economy:model` con el motor de
 * sorteo real), y que renombrar dos productos no haya roto nada de lo que ya estaba persistido.
 *
 * ─────────── PRODUCTO ≠ ESCALÓN INTERNO ───────────
 *
 * `PackTier` sigue siendo `base | premium | elite | legend` y se DERIVA de la garantía, no del
 * nombre comercial. Bronce es `base`, Plata es `premium` y Oro es `elite`. Que el producto
 * intermedio ya no se llame «Premium» no cambia el escalón que el dominio calcula.
 *
 * ─────────── POR QUÉ BRONCE Y PLATA CONSERVAN SUS `id` ───────────
 *
 * `estandar` y `premium` viven en `user_packs`, en el libro mayor, en los carriles y misiones de
 * la temporada y en el trigger de alta de la migración 0011. El renombrado es de NOMBRE: mismo
 * id, mismo precio, mismos pesos. Aquí se comprueba que sigue siendo así.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PACKS, getPack } from "./packs";
import { PACK_STATS } from "./packStats";
import { packArtwork, PACK_ART_AVAILABLE } from "./packArtwork";
import { STORE_CATALOG } from "./storeCatalog";
import { IMPORT_MAP } from "../../scripts/pack-art-import";
import { tierForPack, categoryForPack } from "@/components/packs/packIdentity";
import { packLifecycle, isPurchasable, isPubliclyOpenable } from "@/domain/packs/lifecycle";
import { buildPool } from "@/domain/packs/pool";
import { CardRegistry } from "@/collection/registry";
import { CURRENT_SEASON } from "./season";
import { STARTER_POLICY } from "@/domain/economy/starter";
import { powerRuleFor } from "@/domain/packs/power";
import { mainPackDistribution } from "@/domain/packs/packClass";

/** La gama, en orden. El id es el histórico: renombrar no mueve identificadores. */
const GAMA = [
  { id: "estandar", nombre: "Sobre Bronce", tier: "base" },
  { id: "premium", nombre: "Sobre Plata", tier: "premium" },
  { id: "oro", nombre: "Sobre Oro", tier: "elite" },
] as const;

/* ═══════════ EL SOBRE DE BIENVENIDA ═══════════ */

test("F541 I1 · el Sobre Inicial estrena arte oficial y NO cambia como producto", () => {
  const inicial = getPack("inicial")!;
  /* Un solo Sobre Inicial: el arte nuevo sustituye al anterior, no crea un segundo producto. */
  assert.equal(PACKS.filter((p) => p.id === "inicial").length, 1);

  /* Arte: por la fuente de verdad, y venido del PNG que entregó arte. */
  assert.equal(packArtwork("inicial"), "/packs/pack-inicial.webp");
  assert.ok(PACK_ART_AVAILABLE.has("inicial"));
  assert.equal(IMPORT_MAP.find((m) => m.packId === "inicial")?.file, "inicial.png");

  /* Producto intacto: gratis, cinco cartas, sin garantía, mismos pesos y mismo sorteo. */
  assert.equal(inicial.price, 0, "sigue siendo gratis");
  assert.equal(inicial.cardCount, 5);
  assert.equal(inicial.guaranteedMin, undefined);
  assert.deepEqual(inicial.weights, { common: 70, uncommon: 26, rare: 3.5, epic: 0.5, legendary: 0 });
  assert.equal(packLifecycle(inicial), "ACTIVE");
  assert.equal(isPubliclyOpenable(inicial), true);
  assert.equal(inicial.restrictRegion, undefined);
  assert.equal(inicial.team, undefined);
  assert.equal(inicial.eventId, undefined);

  /* Y las reglas de reclamación del starter siguen siendo las suyas. */
  assert.equal(STARTER_POLICY.packId, "inicial");
  assert.equal(STARTER_POLICY.maxFreeClaims, 8);
  assert.equal(STARTER_POLICY.assistSlots, 2);

  /* Su pool es el catálogo entero (la gama base, desde el hotfix 57.2, tiene techo de poder; el Inicial no). */
  const registry = new CardRegistry();
  assert.equal(buildPool(registry, inicial).flat.length, registry.cards.length);
  assert.equal(powerRuleFor("inicial"), null);
});

/* ═══════════ LA ESCALERA ═══════════ */

test("F540 B1 · Bronce → Plata → Oro existe, en ese orden, y es la gama de la casa", () => {
  for (const g of GAMA) {
    const p = getPack(g.id);
    assert.ok(p, `${g.id} no existe`);
    assert.equal(p!.name, g.nombre);
    assert.equal(packLifecycle(p!), "ACTIVE", `${g.id} tiene que poder comprarse`);
    assert.equal(categoryForPack(p!), "nexus", `${g.id}: gama de la casa, no evento ni equipo`);
    assert.ok(p!.price > 0, `${g.id}: precio`);
  }
  const precios = GAMA.map((g) => getPack(g.id)!.price);
  assert.deepEqual(precios, [2500, 6000, 12000]); // F80 (F57.4: 1.000 / 2.500 / 4.000; antes 750 / 2.500 / 5.000)
  assert.ok(precios[0] < precios[1] && precios[1] < precios[2], "el precio sube en cada escalón");
});

test("F540 B2 · el escalón interno se deriva de la GARANTÍA, no del nombre comercial", () => {
  for (const g of GAMA) assert.equal(tierForPack(getPack(g.id)!), g.tier, g.id);
  assert.equal(getPack("estandar")!.guaranteedMin, undefined, "Bronce no promete nada");
  assert.equal(getPack("premium")!.guaranteedMin, "rare");
  assert.equal(getPack("oro")!.guaranteedMin, "epic");
});

test("F540 B3 · MEDIDO: Bronce < Plata < Oro en valor medio y calidad, y más Prime e Icon en cada escalón", () => {
  const s = GAMA.map((g) => PACK_STATS[g.id]);
  for (const [i, g] of GAMA.entries()) assert.ok(s[i], `${g.id} sin estadística medida`);

  /* Valor medio del contenido: sube en cada escalón. */
  assert.ok(s[0].meanValue < s[1].meanValue, `valor medio ${s[0].meanValue} → ${s[1].meanValue}`);
  assert.ok(s[1].meanValue < s[2].meanValue, `valor medio ${s[1].meanValue} → ${s[2].meanValue}`);

  /* Y la CALIDAD sube: menos comunes y más épicas conforme se sube. */
  assert.ok(s[0].drawn.common > s[1].drawn.common && s[1].drawn.common > s[2].drawn.common, "comunes bajan");
  assert.ok(s[0].drawn.epic < s[1].drawn.epic && s[1].drawn.epic < s[2].drawn.epic, "épicas suben");

  /*
   * FASE 57.3 · la gama base sortea por CLASE DE SOBRE (`packClass`) con una tabla decidida por producto, y los precios
   * NO se han tocado. Consecuencia MEDIDA y reportada (no escondida): el valor de mercado por crédito ya NO sube con el
   * escalón (Bronce ≈ 6,1× → Plata ≈ 4,4× → Oro ≈ 3,5×), porque Bronce ahora puede dar Masters/Champions/Prime/Icon.
   * Ajustar precios es una decisión aparte. Lo que sí se exige: subir de escalón da MÁS probabilidad de Prime e Icon.
   */
  for (let i = 1; i < GAMA.length; i++) {
    const [a, b] = [mainPackDistribution(GAMA[i - 1].id)!, mainPackDistribution(GAMA[i].id)!];
    assert.ok(b.prime > a.prime && b.icon > a.icon, `${GAMA[i].id}: más Prime e Icon que ${GAMA[i - 1].id}`);
  }
});

test("F540 B4 · pesos y sorteo válidos: suman, no prometen rarezas imposibles y no se salen del pool", () => {
  const registry = new CardRegistry();
  for (const g of GAMA) {
    const p = getPack(g.id)!;
    const suma = Object.values(p.weights).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(suma - 100) < 0.001, `${g.id}: los pesos suman ${suma}`);
    for (const w of Object.values(p.weights)) assert.ok(w >= 0, `${g.id}: peso negativo`);
    assert.ok(p.cardCount > 0, `${g.id}: cartas por sobre`);

    const pool = buildPool(registry, p).flat;
    assert.ok(pool.length > 0, `${g.id}: pool vacío`);
    /* Fase 57.3 · sin techo de poder: el pool es el catálogo entero y la tabla por clase decide (ninguna rareza imposible). */
    assert.equal(powerRuleFor(g.id), null, `${g.id}: sin techo de OVR`);
    assert.deepEqual(pool.map((c) => c.id), registry.cards.map((c) => c.id), `${g.id}: pool = catálogo`);
    assert.deepEqual(PACK_STATS[g.id].impossible, [], `${g.id}: ninguna rareza imposible`);
    assert.equal(p.restrictRegion, undefined, `${g.id}: la gama base no es regional`);
    assert.equal(p.team, undefined);
    assert.equal(p.eventId, undefined);
  }
});

/* ═══════════ RENOMBRAR NO ES ROMPER ═══════════ */

test("F540 B5 · Bronce y Plata conservan su identificador persistido, sus cartas y sus pesos (precio: Fase 57.4)", () => {
  const bronce = getPack("estandar")!;
  const plata = getPack("premium")!;
  assert.equal(bronce.price, 2500); // F80: 1.000 → 2.500 (F57.4: 750 → 1.000)
  assert.equal(bronce.cardCount, 5);
  assert.deepEqual(bronce.weights, { common: 55, uncommon: 35, rare: 8, epic: 1.8, legendary: 0.2 });
  assert.equal(plata.price, 6000); // F80: 2.500 → 6.000
  assert.equal(plata.cardCount, 6);
  assert.deepEqual(plata.weights, { common: 30, uncommon: 45, rare: 18, epic: 6, legendary: 1 });
  /* Lo que ya estaba concedido sigue apuntando a estos ids: no hay migración que hacer. */
  assert.equal(isPubliclyOpenable(bronce), true, "un Bronce en el inventario se abre");
  assert.equal(isPubliclyOpenable(plata), true);
  assert.equal(isPurchasable(bronce), true);
  assert.equal(isPurchasable(plata), true);
});

test("F540 B6 · las recompensas ya declaradas siguen siendo válidas sin tocarlas", () => {
  /* Temporada y misiones siguen concediendo los MISMOS packId; solo cambió cómo se llaman. */
  const carril = Object.values(CURRENT_SEASON.free).map((r) => r.packId).filter(Boolean);
  assert.ok(carril.includes("estandar") || carril.includes("premium"), "el carril sigue dando gama base");
  for (const id of [...new Set(carril)]) assert.ok(getPack(id as string), `el carril concede ${id}, que tiene que existir`);
  for (const m of CURRENT_SEASON.missionPool) {
    if (m.reward.packId) assert.ok(getPack(m.reward.packId), `la misión ${m.id} concede ${m.reward.packId}`);
  }
  /* Y el carril competitivo tampoco se ha quedado apuntando a un producto que ya no existe. */
  for (const r of Object.values(CURRENT_SEASON.competitive ?? {})) {
    if (r.packId) assert.ok(getPack(r.packId), `el carril competitivo concede ${r.packId}`);
  }
});

test("F540 B7 · Prime sigue retirado y no vuelve por la puerta de atrás", () => {
  const prime = getPack("prime")!;
  assert.equal(packLifecycle(prime), "RETIRED");
  assert.equal(isPurchasable(prime), false);
  assert.equal(isPubliclyOpenable(prime), true, "los Prime concedidos se siguen abriendo");
  assert.ok(!STORE_CATALOG.packOffers.some((o) => o.packId === "prime" && o.enabled), "no se vende");
});

/* ═══════════ ARTE Y TIENDA ═══════════ */

test("F540 B8 · cada escalón pinta SU arte oficial, por la fuente de verdad", () => {
  const artes = new Set<string>();
  for (const g of GAMA) {
    const art = packArtwork(g.id);
    assert.equal(art, `/packs/pack-${g.id}.webp`, `${g.id}: convención`);
    assert.ok(PACK_ART_AVAILABLE.has(g.id), `${g.id}: declarado`);
    assert.ok(!artes.has(art!), `${g.id} repite arte`);
    artes.add(art!);
  }
  /* Y el arte de cada uno viene del PNG que entregó arte, no de un dibujo. */
  const origen = (id: string) => IMPORT_MAP.find((m) => m.packId === id)?.file;
  assert.equal(origen("estandar"), "Bronze.png");
  assert.equal(origen("premium"), "Plata.png");
  assert.equal(origen("oro"), "oro.png");
});

test("F540 B9 · la tienda ofrece los tres, en orden, y sin duplicar productos", () => {
  const ofertas = STORE_CATALOG.packOffers.filter((o) => o.enabled);
  const orden = GAMA.map((g) => ofertas.find((o) => o.packId === g.id));
  for (const [i, o] of orden.entries()) assert.ok(o, `${GAMA[i].id} no se ofrece`);
  assert.ok(orden[0]!.sortOrder < orden[1]!.sortOrder && orden[1]!.sortOrder < orden[2]!.sortOrder, "Bronce → Plata → Oro");
  const packIds = STORE_CATALOG.packOffers.map((o) => o.packId);
  assert.equal(new Set(packIds).size, packIds.length, "un producto no se ofrece dos veces");
});

test("F540 B10 · ningún id repetido y Oro es el único producto nuevo de la gama", () => {
  const ids = PACKS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, "ids duplicados en el catálogo");
  const nexus = PACKS.filter((p) => categoryForPack(p) === "nexus" && packLifecycle(p) === "ACTIVE").map((p) => p.id).sort();
  assert.deepEqual(nexus, ["estandar", "oro", "premium"], "la gama activa de la casa son exactamente tres");
});
