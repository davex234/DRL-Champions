import test from "node:test";
import assert from "node:assert/strict";
import { composeDistribution, poolAllows, type PoolDef, type PoolEntry } from "./distribution";
import { CardRegistry } from "@/collection/registry";
import { buildPool } from "./pool";
import { CARDS } from "@/data/catalog";
import { getPack } from "@/data/packs";

/**
 * LA CLAVE DE UNA DISTRIBUCIÓN TIENE QUE IDENTIFICAR SU CONTENIDO.
 *
 * Estas pruebas nacen de un fallo REAL encontrado auditando 8.4.3: la clave era
 * `${pool.id}#${entries.length}`, así que dos configuraciones distintas con el mismo número de
 * entradas compartían clave — y `buildPool` cachea la PERTENENCIA por esa clave. Sustituir una
 * carta por otra dejaba la base de datos correcta y el proceso repartiendo la configuración
 * anterior indefinidamente.
 *
 * No se vio en 8.3 porque allí los cambios de pool se hacían desvinculando un pool y vinculando
 * otro con distinto id: la clave cambiaba por el identificador, nunca por el contenido.
 */

const POOL = (id: string, entries: [string, number, PoolEntry["mode"]][]): { pool: PoolDef; priority: number } => ({
  pool: {
    id, mode: "EXPLICIT", rules: {},
    entries: entries.map(([cardId, weight, mode]) => ({ cardId, weight, mode })),
    availableFrom: null, availableTo: null,
  },
  priority: 100,
});

const AHORA = 1_760_000_000_000;

test("DISTRIBUCIÓN · cambiar QUÉ cartas hay cambia la clave, aunque haya el mismo número", () => {
  const a = composeDistribution([POOL("p", [["x__gold", 1, "INCLUDE"], ["y__gold", 1, "INCLUDE"]])], AHORA)!;
  const b = composeDistribution([POOL("p", [["x__gold", 1, "INCLUDE"], ["z__gold", 1, "INCLUDE"]])], AHORA)!;
  assert.notEqual(a.key, b.key, "dos pertenencias distintas no pueden compartir clave de caché");
});

test("DISTRIBUCIÓN · cambiar un peso cambia la clave", () => {
  const a = composeDistribution([POOL("p", [["x__gold", 1, "INCLUDE"]])], AHORA)!;
  const b = composeDistribution([POOL("p", [["x__gold", 9, "INCLUDE"]])], AHORA)!;
  assert.notEqual(a.key, b.key);
});

test("DISTRIBUCIÓN · cambiar INCLUDE por EXCLUDE cambia la clave", () => {
  const a = composeDistribution([POOL("p", [["x__gold", 1, "INCLUDE"]])], AHORA)!;
  const b = composeDistribution([POOL("p", [["x__gold", 1, "EXCLUDE"]])], AHORA)!;
  assert.notEqual(a.key, b.key);
});

test("DISTRIBUCIÓN · la misma configuración en otro orden es la MISMA clave", () => {
  const a = composeDistribution([POOL("p", [["x__gold", 1, "INCLUDE"], ["y__gold", 2, "INCLUDE"]])], AHORA)!;
  const b = composeDistribution([POOL("p", [["y__gold", 2, "INCLUDE"], ["x__gold", 1, "INCLUDE"]])], AHORA)!;
  assert.equal(a.key, b.key, "reordenar la lista no es un cambio de distribución");
});

test("DISTRIBUCIÓN · buildPool NO devuelve la pertenencia anterior tras sustituir una carta", () => {
  /*
   * La prueba de arriba mira la clave; esta mira la consecuencia, que es lo que importa.
   * Mismo registro (misma entrada del WeakMap), mismo sobre, dos configuraciones de 3 cartas.
   */
  const registry = new CardRegistry(CARDS);
  const pack = getPack("inicial")!;
  const comunes = CARDS.filter((c) => c.variantId === "base").slice(0, 4).map((c) => c.id);
  assert.ok(comunes.length === 4, "el catálogo debe tener al menos 4 cartas base (común)");

  const dA = composeDistribution(
    [POOL("p", comunes.slice(0, 3).map((id) => [id, 1, "INCLUDE"] as [string, number, PoolEntry["mode"]]))],
    AHORA,
  )!;
  const dB = composeDistribution(
    [POOL("p", [comunes[0], comunes[1], comunes[3]].map((id) => [id, 1, "INCLUDE"] as [string, number, PoolEntry["mode"]]))],
    AHORA,
  )!;

  const idsA = buildPool(registry, pack, dA).flat.map((c) => c.id).sort();
  const idsB = buildPool(registry, pack, dB).flat.map((c) => c.id).sort();
  assert.notDeepEqual(idsA, idsB, "buildPool sirvió el pool anterior para una configuración nueva");
  assert.ok(idsB.includes(comunes[3]), "la carta nueva tiene que estar en el pool nuevo");
  assert.ok(!idsB.includes(comunes[2]), "la carta retirada del pool no puede seguir saliendo");
});

test("DISTRIBUCIÓN · EXCLUDE gana a INCLUDE, y la carta no queda ni con peso", () => {
  const d = composeDistribution(
    [POOL("p", [["x__gold", 5, "INCLUDE"], ["x__gold", 1, "EXCLUDE"]])],
    AHORA,
  )!;
  assert.equal(d.members?.has("x__gold"), false);
  assert.equal(d.excluded.has("x__gold"), true);
  assert.equal(poolAllows(d, { id: "x__gold" } as never), false);
});

test("DISTRIBUCIÓN · sin pools dentro de su ventana no hay configuración (comportamiento previo a 8.3)", () => {
  const fuera = POOL("p", [["x__gold", 1, "INCLUDE"]]);
  fuera.pool.availableFrom = AHORA + 1000;
  assert.equal(composeDistribution([fuera], AHORA), null);
});
