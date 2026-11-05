import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { __resetI18nForTests, registerCatalog, setActiveLocale, td } from "./runtime";
import { CONTENT_MAX_ENTRIES, registerContentTranslations, sanitizeContentTranslations } from "./content";
import { CONTENT_TRANSLATIONS_ENABLED } from "@/config/features";

beforeEach(() => { __resetI18nForTests(); });

test("CONTENIDO · sin capa, el texto del CMS se ve en español (respaldo) y nunca una clave", () => {
  registerCatalog("en", { packs: { "Abrir sobre": "Open pack" } });
  setActiveLocale("en");
  assert.equal(td("Sobre Aniversario"), "Sobre Aniversario");
});

test("CONTENIDO · con capa, td() pinta la traducción opcional y el resto sigue en español", () => {
  registerCatalog("en", { packs: { "Abrir sobre": "Open pack" } });
  assert.equal(registerContentTranslations("en", { "Sobre Aniversario": "Anniversary Pack" }), 1);
  setActiveLocale("en");
  assert.equal(td("Sobre Aniversario"), "Anniversary Pack");
  assert.equal(td("Misión sin traducir"), "Misión sin traducir");
  setActiveLocale("de");
  assert.equal(td("Sobre Aniversario"), "Sobre Aniversario");
  setActiveLocale("es");
  assert.equal(td("Sobre Aniversario"), "Sobre Aniversario");
});

test("CONTENIDO · lo traducido en el código manda sobre la capa", () => {
  registerCatalog("en", { packs: { "Sobre Oro": "Gold Pack" } });
  registerContentTranslations("en", { "Sobre Oro": "Golden Envelope" });
  setActiveLocale("en");
  assert.equal(td("Sobre Oro"), "Gold Pack");
});

test("CONTENIDO · se descartan entradas vacías, no textuales, enormes o con variables distintas", () => {
  const clean = sanitizeContentTranslations({
    "Gana {n} partidas": "Win {n} matches",
    "Abre {n} sobres": "Open {count} packs",
    "Vacía": "   ",
    "Número": 7,
    "Larga": "x".repeat(601),
    "  Con espacios  ": "  Trimmed  ",
  });
  assert.deepEqual(clean, { "Gana {n} partidas": "Win {n} matches", "Con espacios": "Trimmed" });
  for (const bad of [null, undefined, "x", 3, ["a"]]) assert.deepEqual(sanitizeContentTranslations(bad), {});
});

test("CONTENIDO · tope de entradas y español intacto", () => {
  const many = Object.fromEntries(Array.from({ length: CONTENT_MAX_ENTRIES + 50 }, (_, i) => [`Texto ${i}`, `Text ${i}`]));
  assert.equal(Object.keys(sanitizeContentTranslations(many)).length, CONTENT_MAX_ENTRIES);
  assert.equal(registerContentTranslations("es", { "Sobre Aniversario": "x" }), 0);
});

test("CONTENIDO · una plantilla de la capa también recompone textos con cifras", () => {
  registerContentTranslations("it", { "Gana {n} partidas con el equipo de la semana": "Vinci {n} partite con la squadra della settimana" });
  setActiveLocale("it");
  assert.equal(td("Gana 3 partidas con el equipo de la semana"), "Vinci 3 partite con la squadra della settimana");
});

test("CONTENIDO · el interruptor nace apagado (la tabla es una propuesta sin aplicar)", () => {
  assert.equal(CONTENT_TRANSLATIONS_ENABLED, false);
});
