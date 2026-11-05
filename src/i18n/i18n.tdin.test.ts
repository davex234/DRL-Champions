/**
 * I18N · `tdIn` — texto-dato con el SENTIDO de su módulo.
 *
 * `td` resuelve por un índice plano (gana `common`, luego el primer módulo del catálogo, que en los trozos generados va
 * por orden alfabético): una etiqueta con dos
 * sentidos sale con el del módulo equivocado. `tdIn(módulo, valor)` mira primero el catálogo del módulo que define la
 * tabla y, si no la tiene, hace exactamente lo que `td`.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { __resetI18nForTests, registerCatalog, setActiveLocale, td, tdIn } from "./runtime";

beforeEach(() => { __resetI18nForTests(); });

const AMBIGUOUS = {
  campaign: { "Bloqueado": "Locked", "Final": "Final" },
  pickems: { "Final": "Finished" },
  social: { "Bloqueado": "Blocked", "Reto de {name}": "Challenge from {name}", "{n, plural, one {# amigo} other {# amigos}}": "{n, plural, one {# friend} other {# friends}}" },
  store: { "Comprar": "Buy", "Necesitas {n} créditos": "You need {n} credits" },
};

test("TDIN · gana el sentido del módulo indicado, no el del primer módulo alfabético", () => {
  registerCatalog("en", AMBIGUOUS);
  setActiveLocale("en");
  assert.equal(td("Bloqueado"), "Locked", "td: índice plano → campaign (alfabético)");
  assert.equal(tdIn("social", "Bloqueado"), "Blocked");
  assert.equal(tdIn("campaign", "Bloqueado"), "Locked");
  assert.equal(td("Final"), "Final");
  assert.equal(tdIn("pickems", "Final"), "Finished");
});

test("TDIN · si el módulo no tiene el texto (o no existe) se comporta exactamente como td", () => {
  registerCatalog("en", AMBIGUOUS);
  setActiveLocale("en");
  for (const mod of ["store", "no-existe", ""]) {
    for (const source of ["Bloqueado", "Final", "Comprar", "Shr1mp", "Necesitas 3.000 créditos", "Comprar · Bloqueado", "x"]) {
      assert.equal(tdIn(mod, source), td(source), `${mod} / ${source}`);
    }
  }
  assert.equal(tdIn("pickems", "Necesitas 3.000 créditos"), "You need 3.000 credits", "plantilla del servidor: la de td");
  assert.equal(tdIn("pickems", "Team Heretics"), "Team Heretics", "un nombre propio pasa intacto");
});

test("TDIN · una traducción vacía en el módulo no cuenta: cae a td", () => {
  registerCatalog("de", { social: { "Bloqueado": "" }, campaign: { "Bloqueado": "Gesperrt" } });
  setActiveLocale("de");
  assert.equal(tdIn("social", "Bloqueado"), "Gesperrt");
});

test("TDIN · en español devuelve el texto fuente tal cual (el catálogo ni se mira)", () => {
  registerCatalog("en", AMBIGUOUS);
  setActiveLocale("es");
  assert.equal(tdIn("social", "Bloqueado"), "Bloqueado");
  assert.equal(tdIn("social", "Reto de {name}", { name: "Ana" }), "Reto de Ana");
  assert.equal(tdIn("social", "Reto de {name}"), "Reto de {name}", "sin variables no se interpreta, igual que td");
});

test("TDIN · variables y plurales con la traducción del módulo", () => {
  registerCatalog("en", { career: { "Reto de {name}": "{name}'s dare" }, ...AMBIGUOUS });
  setActiveLocale("en");
  assert.equal(td("Reto de {name}", { name: "Ana" }), "Ana's dare", "td: gana career (va antes en el catálogo)");
  assert.equal(tdIn("social", "Reto de {name}", { name: "Ana" }), "Challenge from Ana");
  assert.equal(tdIn("social", "{n, plural, one {# amigo} other {# amigos}}", { n: 1 }), "1 friend");
  assert.equal(tdIn("social", "{n, plural, one {# amigo} other {# amigos}}", { n: 4 }), "4 friends");
  assert.equal(tdIn("store", "Reto de {name}", { name: "Ana" }), td("Reto de {name}", { name: "Ana" }), "sin entrada propia → td");
});

test("TDIN · lo que no es texto pasa intacto, con su tipo", () => {
  registerCatalog("en", AMBIGUOUS);
  setActiveLocale("en");
  assert.equal(tdIn("social", undefined), undefined);
  assert.equal(tdIn("social", null), null);
  assert.equal(tdIn("social", ""), "");
  assert.equal(tdIn("social", 7), 7);
});

test("TDIN · no cambia td: el índice plano sigue prefiriendo common y después el orden alfabético", () => {
  registerCatalog("en", { ...AMBIGUOUS, common: { "Final": "End" } });
  setActiveLocale("en");
  assert.equal(td("Final"), "End");
  assert.equal(tdIn("pickems", "Final"), "Finished");
  assert.equal(tdIn("store", "Final"), "End");
});
