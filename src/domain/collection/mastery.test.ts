import test from "node:test";
import assert from "node:assert/strict";
import {
  masterySets, masterySet, progressFor, masteryRef, allMasteryRewards, MIN_SET_SIZE,
} from "./mastery";
import { getCard, CARDS } from "@/data/catalog";
import { cosmetic } from "@/domain/cosmetics/catalog";

test("hay conjuntos de los cuatro ejes y todos son alcanzables", () => {
  const sets = masterySets();
  const axes = new Set(sets.map((s) => s.axis));
  for (const a of ["equipo", "region", "variante", "rareza"]) {
    assert.ok(axes.has(a as never), `falta el eje ${a}`);
  }
  for (const s of sets) {
    assert.ok(s.cardIds.length >= MIN_SET_SIZE, `${s.id} tiene ${s.cardIds.length} cartas`);
    assert.ok(s.tiers.length > 0, `${s.id} sin escalones`);
  }
});

test("LA MAESTRIA NO PAGA NI UN CREDITO", () => {
  /*
   * La invariante económica de la Fase 13, y la condición para que esta capa pueda existir.
   * El grifo de temporada son 124.900 créditos no repetibles (`economy.md` §4, medido); 162
   * escalones que pagaran algo lo desbordarían y habríamos arreglado el endgame inflando la
   * economía que la Fase 12 acababa de calibrar.
   */
  for (const r of allMasteryRewards()) {
    assert.equal(r.credits ?? 0, 0, "un escalon paga creditos");
    assert.equal(r.xp ?? 0, 0, "un escalon paga XP");
    assert.equal(r.packCount ?? 0, 0, "un escalon paga sobres");
    assert.equal(r.cardId, undefined, "un escalon regala una carta");
    assert.ok((r.cosmetics?.length ?? 0) > 0, "un escalon no entrega ningun cosmetico");
  }
});

test("todos los cosmeticos de maestria se pueden pintar", () => {
  /*
   * Son 166 y no están escritos a mano: se derivan del id del conjunto. Si `cosmetic()` no
   * supiera resolverlos, el jugador conseguiría insignias invisibles — que es exactamente el
   * fallo que la Fase 10 documentó y la 12 cerró.
   */
  for (const r of allMasteryRewards()) {
    for (const id of r.cosmetics ?? []) {
      const def = cosmetic(id);
      assert.ok(def, `sin definicion: ${id}`);
      // Insignias casi siempre; el pleno de una region da ademas un TITULO, que es el
      // cosmetico mas visible que hay y por eso se reserva al recorrido mas largo.
      assert.ok(["insignia", "titulo"].includes(def!.family), `${id} es de familia ${def!.family}`);
      assert.ok(def!.label.length > 0, `${id} sin nombre`);
    }
  }

  // Y el titulo solo aparece en el pleno de una region: en ningun otro sitio.
  const titles = allMasteryRewards().flatMap((r) => (r.cosmetics ?? []).filter((c) => c.startsWith("titulo:")));
  assert.equal(titles.length, 4, `titulos de maestria: ${titles.join(", ")}`);
  assert.ok(titles.every((t) => t.startsWith("titulo:region:")));
});

test("todas las cartas de un conjunto existen en el catalogo", () => {
  for (const s of masterySets()) {
    for (const id of s.cardIds) assert.ok(getCard(id), `${s.id} apunta a ${id}, que no existe`);
  }
});

test("el progreso cuenta lo que se tiene, no lo que se ha abierto", () => {
  const s = masterySets().find((x) => x.axis === "equipo")!;
  assert.equal(progressFor(s, new Set()).owned, 0);
  // Duplicados: el mismo id dos veces no cuenta dos veces, porque es un `Set`.
  const half = s.cardIds.slice(0, Math.floor(s.cardIds.length / 2));
  assert.equal(progressFor(s, new Set(half)).owned, half.length);
  assert.equal(progressFor(s, new Set(s.cardIds)).owned, s.cardIds.length);
});

test("los escalones se alcanzan en orden y el pleno cierra el conjunto", () => {
  const s = masterySets().find((x) => x.axis === "equipo")!;
  const vacio = progressFor(s, new Set());
  assert.equal(vacio.reached.length, 0);
  assert.ok(vacio.next);
  assert.ok(vacio.toNext > 0);

  const lleno = progressFor(s, new Set(s.cardIds));
  assert.equal(lleno.reached.length, s.tiers.length);
  assert.equal(lleno.next, null);
  assert.equal(lleno.toNext, 0);
});

test("«faltan N» dice la verdad: sumar N cartas alcanza el escalon", () => {
  /*
   * Si esta cuenta estuviera mal, la interfaz diría «faltan 3» y al conseguir las tres el
   * escalón seguiría sin desbloquearse. Es la clase de fallo que destruye la confianza en
   * una barra de progreso.
   */
  for (const s of masterySets().slice(0, 12)) {
    for (const start of [0, Math.floor(s.cardIds.length / 3)]) {
      const owned = new Set(s.cardIds.slice(0, start));
      const p = progressFor(s, owned);
      if (!p.next) continue;
      for (const id of s.cardIds.slice(start, start + p.toNext)) owned.add(id);
      const after = progressFor(s, owned);
      assert.ok(after.reached.includes(p.next),
        `${s.id}: decia que faltaban ${p.toNext} y no alcanzo «${p.next.label}»`);
    }
  }
});

test("cada escalon tiene una clave de idempotencia distinta", () => {
  const refs = masterySets().flatMap((s) => s.tiers.map((t) => masteryRef(s.id, t.at)));
  assert.equal(new Set(refs).size, refs.length);
  // Y la clave identifica conjunto Y escalón: si no, cobrar uno cerraría el otro.
  assert.notEqual(masteryRef("equipo:x", 0.5), masteryRef("equipo:x", 1));
  assert.notEqual(masteryRef("equipo:x", 1), masteryRef("equipo:y", 1));
});

test("un conjunto inexistente no se puede pedir", () => {
  assert.equal(masterySet("no-existe"), null);
  assert.ok(masterySet(masterySets()[0].id));
});

test("los conjuntos por region cubren el catalogo entero", () => {
  /*
   * Cuatro regiones y ninguna carta huérfana: si una carta no cayera en ninguna región, su
   * dueño no podría completar nunca ningún conjunto que la incluyera.
   */
  const enRegiones = new Set(masterySets().filter((s) => s.axis === "region").flatMap((s) => s.cardIds));
  assert.equal(enRegiones.size, CARDS.length);
});

test("ningun conjunto es la coleccion entera con otro nombre", () => {
  // Un objetivo que abarca casi todo el catálogo no orienta una sesión: es la colección.
  for (const s of masterySets().filter((x) => x.axis !== "region")) {
    assert.ok(s.cardIds.length < CARDS.length * 0.15,
      `${s.id} tiene ${s.cardIds.length} de ${CARDS.length} cartas`);
  }
});
