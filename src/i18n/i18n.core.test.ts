/**
 * I18N · NÚCLEO — selección de idioma, detección, fallback, precedencia, plurales/variables, formato y seguridad de la
 * preferencia. Todo puro (sin navegador ni red).
 */
import { test, beforeEach } from "node:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { DEFAULT_LOCALE, LOCALES, LOCALE_COOKIE, LOCALE_INFO, isLocale, localeFromCookieHeader, matchLocale, negotiateLocale, parseAcceptLanguage } from "./config";
import { formatMessage, messagePlaceholders, messagePluralCategories } from "./icu";
import { accountLocaleOf, decideLocale, parseStoredLocale } from "./preference";
import { __resetI18nForTests, formatDate, formatNumber, formatPercent, getLocale, i18nVersion, ns, registerCatalog, setActiveLocale, setLocaleResolver, subscribeLocale, td, translate } from "./runtime";
import { __resetCriticalForTests, beginCriticalOperation, isCriticalOperationActive, onCriticalIdle, withCriticalOperation } from "./critical";

beforeEach(() => { __resetI18nForTests(); __resetCriticalForTests(); });

/* ───────────── 1 · los ocho idiomas ───────────── */

test("IDIOMAS · son exactamente es, en, de, it, fr, pt-PT, pt-BR, ja; el español es el predeterminado y cada uno tiene nombre propio y bandera", () => {
  assert.deepEqual([...LOCALES], ["es", "en", "de", "it", "fr", "pt-PT", "pt-BR", "ja"]);
  assert.equal(DEFAULT_LOCALE, "es");
  assert.deepEqual(LOCALES.map((l) => LOCALE_INFO[l].name), ["Español", "English", "Deutsch", "Italiano", "Français", "Português (PT)", "Português (BR)", "日本語"]);
  assert.deepEqual(LOCALES.map((l) => LOCALE_INFO[l].flag), ["🇪🇸", "🇬🇧", "🇩🇪", "🇮🇹", "🇫🇷", "🇵🇹", "🇧🇷", "🇯🇵"]);
  assert.deepEqual(LOCALES.map((l) => LOCALE_INFO[l].intl), ["es-ES", "en-GB", "de-DE", "it-IT", "fr-FR", "pt-PT", "pt-BR", "ja-JP"]);
  for (const l of LOCALES) assert.ok(existsSync(join(process.cwd(), "public", LOCALE_INFO[l].flagFile)), `bandera local de ${l}`);
  for (const l of LOCALES) assert.ok(isLocale(l));
  for (const bad of ["zh", "pt", "pt-br", "ES", "", null, undefined, 3, {}, "es-ES"]) assert.equal(isLocale(bad), false);
});

test("SELECCIÓN · cada idioma se puede activar y los textos salen en ese idioma", () => {
  registerCatalog("en", { ui: { "Ajustes": "Settings" } });
  registerCatalog("de", { ui: { "Ajustes": "Einstellungen" } });
  registerCatalog("it", { ui: { "Ajustes": "Impostazioni" } });
  registerCatalog("fr", { ui: { "Ajustes": "Paramètres" } });
  registerCatalog("pt-PT", { ui: { "Ajustes": "Definições" } });
  registerCatalog("pt-BR", { ui: { "Ajustes": "Configurações" } });
  registerCatalog("ja", { ui: { "Ajustes": "設定" } });
  const t = ns("ui");
  const seen: string[] = [];
  for (const l of LOCALES) { setActiveLocale(l); assert.equal(getLocale(), l); seen.push(t("Ajustes")); }
  assert.deepEqual(seen, ["Ajustes", "Settings", "Einstellungen", "Impostazioni", "Paramètres", "Definições", "Configurações", "設定"]);
});

/* ───────────── 2 · detección del navegador ───────────── */

test("DETECCIÓN · el primer idioma soportado del navegador; variantes regionales; lo demás → español", () => {
  assert.equal(negotiateLocale(["de-AT", "en"]), "de");
  assert.equal(negotiateLocale(["fr-FR", "it-CH", "en"]), "fr");
  assert.equal(negotiateLocale(["nl-NL", "it-CH", "en"]), "it");
  assert.equal(negotiateLocale(["en-US"]), "en");
  assert.equal(negotiateLocale(["es-MX"]), "es");
  assert.equal(negotiateLocale(["zh-CN", "ko"]), "es");
  // portugués: Brasil solo con la región BR; `pt` a secas y cualquier otra región → Portugal
  assert.equal(negotiateLocale(["pt-BR", "ja"]), "pt-BR");
  assert.equal(negotiateLocale(["pt"]), "pt-PT");
  assert.equal(negotiateLocale(["pt-PT", "pt-BR"]), "pt-PT");
  assert.equal(negotiateLocale(["pt-AO"]), "pt-PT");
  assert.equal(matchLocale("PT_br"), "pt-BR");
  assert.equal(matchLocale("pt-Latn-BR"), "pt-BR");
  assert.equal(negotiateLocale(["ja-JP", "en"]), "ja");
  assert.equal(negotiateLocale(["fr-CA"]), "fr");
  assert.equal(negotiateLocale([]), "es");
  assert.equal(negotiateLocale(null), "es");
  assert.equal(negotiateLocale([42, null, "DE_de"]), "de");
  assert.equal(matchLocale("EN_us"), "en");
  assert.equal(matchLocale("english"), null);
});

test("DETECCIÓN · Accept-Language se ordena por q y se ignoran comodines y q=0", () => {
  assert.deepEqual(parseAcceptLanguage("fr;q=0.9, de;q=0.8, en;q=0.95, *;q=0.1, it;q=0"), ["en", "fr", "de"]);
  assert.equal(negotiateLocale(parseAcceptLanguage("nl-BE, nl;q=0.9, de;q=0.8")), "de");
  assert.equal(negotiateLocale(parseAcceptLanguage("pt-BR,pt;q=0.9,en-US;q=0.8")), "pt-BR");
  assert.equal(negotiateLocale(parseAcceptLanguage("ja,en-US;q=0.9")), "ja");
  assert.deepEqual(parseAcceptLanguage(null), []);
});

/* ───────────── 3 · fallback español ───────────── */

test("FALLBACK · sin traducción se ve el ESPAÑOL, nunca una clave ni un hueco", () => {
  registerCatalog("en", { store: { "Comprar": "Buy" } });
  setActiveLocale("en");
  const t = ns("store");
  assert.equal(t("Comprar"), "Buy");
  assert.equal(t("Texto que nadie ha traducido"), "Texto que nadie ha traducido");
  setActiveLocale("it"); // idioma sin ningún catálogo cargado
  assert.equal(t("Comprar"), "Comprar");
  assert.equal(td("Comprar"), "Comprar");
});

test("FALLBACK · una traducción vacía no tapa el texto; un módulo sin la clave la toma de otro módulo", () => {
  registerCatalog("de", { a: { "Cerrar": "" }, b: { "Cerrar": "Schließen" }, common: { "Volver": "Zurück" }, z: { "Volver": "Retour" } });
  setActiveLocale("de");
  assert.equal(ns("a")("Cerrar"), "Schließen");
  assert.equal(ns("nuevo")("Volver"), "Zurück", "«common» es la traducción canónica");
});

/* ───────────── 4 · persistencia y 5 · sincronización con la cuenta ───────────── */

test("PREFERENCIA · se lee el formato guardado y se rechaza lo corrupto o desconocido", () => {
  assert.deepEqual(parseStoredLocale('{"locale":"de","at":1700000000000}'), { locale: "de", at: 1700000000000 });
  assert.deepEqual(parseStoredLocale("it"), { locale: "it", at: 0 });
  for (const bad of [null, "", "zh", '{"locale":"zh"}', "{", '{"locale":"<script>"}', 7, '{"locale":"de","at":"x"}'.replace('"x"', "-5")]) {
    const r = parseStoredLocale(bad);
    if (bad === '{"locale":"de","at":-5}') assert.deepEqual(r, { locale: "de", at: 0 }); else assert.equal(r, null);
  }
});

test("PRECEDENCIA · dispositivo > cuenta > navegador > español", () => {
  const dev = { locale: "de" as const, at: 10 };
  const acc = { locale: "it" as const, at: 5 };
  assert.equal(decideLocale({ device: dev, account: undefined, browserLanguages: ["en"] }).locale, "de");
  assert.equal(decideLocale({ device: null, account: acc, browserLanguages: ["en"] }).locale, "it");
  assert.equal(decideLocale({ device: null, account: null, browserLanguages: ["en-GB"] }).locale, "en");
  assert.equal(decideLocale({ device: null, account: undefined, browserLanguages: ["zh"] }).locale, "es");
  assert.equal(decideLocale({ device: null, account: undefined, browserLanguages: ["zh"] }).source, "default");
  assert.equal(decideLocale({ device: null, account: undefined, browserLanguages: ["ja"] }).locale, "ja");
  assert.equal(decideLocale({ device: null, account: undefined, browserLanguages: ["pt-BR"] }).locale, "pt-BR");
  assert.equal(decideLocale({ device: null, account: undefined, browserLanguages: ["es-AR"] }).source, "browser");
});

test("SINCRONIZACIÓN · con dispositivo y cuenta distintos gana la elección MÁS RECIENTE y se copia al otro lado", () => {
  const newerAccount = decideLocale({ device: { locale: "de", at: 10 }, account: { locale: "it", at: 20 }, browserLanguages: [] });
  assert.deepEqual([newerAccount.locale, newerAccount.source, newerAccount.writeDevice, newerAccount.writeAccount], ["it", "account", { locale: "it", at: 20 }, null]);
  const newerDevice = decideLocale({ device: { locale: "de", at: 30 }, account: { locale: "it", at: 20 }, browserLanguages: [] });
  assert.deepEqual([newerDevice.locale, newerDevice.source, newerDevice.writeDevice, newerDevice.writeAccount], ["de", "device", null, { locale: "de", at: 30 }]);
  // empate de fechas: no se pisa lo que el jugador ve en este dispositivo
  assert.equal(decideLocale({ device: { locale: "de", at: 20 }, account: { locale: "it", at: 20 }, browserLanguages: [] }).locale, "de");
});

test("SINCRONIZACIÓN · iguales no escriben nada; cuenta sin idioma recibe el del dispositivo; dispositivo nuevo adopta la cuenta", () => {
  const same = decideLocale({ device: { locale: "en", at: 1 }, account: { locale: "en", at: 99 }, browserLanguages: [] });
  assert.deepEqual([same.writeDevice, same.writeAccount], [null, null]);
  const firstLogin = decideLocale({ device: { locale: "en", at: 7 }, account: null, browserLanguages: [] });
  assert.deepEqual(firstLogin.writeAccount, { locale: "en", at: 7 });
  const newDevice = decideLocale({ device: null, account: { locale: "it", at: 3 }, browserLanguages: ["de"] });
  assert.deepEqual([newDevice.locale, newDevice.writeDevice], ["it", { locale: "it", at: 3 }]);
});

test("SINCRONIZACIÓN · un idioma solo DETECTADO nunca se guarda en la cuenta ni en el dispositivo", () => {
  const d = decideLocale({ device: null, account: null, browserLanguages: ["de-DE"] });
  assert.deepEqual([d.locale, d.source, d.writeDevice, d.writeAccount], ["de", "browser", null, null]);
});

test("SEGURIDAD · user_metadata lo escribe el usuario: solo se acepta uno de los cuatro idiomas y una fecha numérica", () => {
  assert.deepEqual(accountLocaleOf({ locale: "it", locale_at: 12 }), { locale: "it", at: 12 });
  assert.deepEqual(accountLocaleOf({ locale: "de", locale_at: "9999999999999" }), { locale: "de", at: 0 });
  assert.deepEqual(accountLocaleOf({ locale: "de", locale_at: Infinity }), { locale: "de", at: 0 });
  for (const bad of [null, undefined, "de", {}, { locale: "xx" }, { locale: ["de"] }, { locale: "../../etc" }, { locale: "<img onerror=1>" }]) assert.equal(accountLocaleOf(bad), null);
});

test("SEGURIDAD · la cookie de idioma se valida contra la lista (no se refleja lo que mande el cliente)", () => {
  assert.equal(localeFromCookieHeader(`a=1; ${LOCALE_COOKIE}=de; b=2`), "de");
  assert.equal(localeFromCookieHeader(`${LOCALE_COOKIE}=it-IT`), "it");
  assert.equal(localeFromCookieHeader(`${LOCALE_COOKIE}=pt-BR`), "pt-BR");
  assert.equal(localeFromCookieHeader(`${LOCALE_COOKIE}=ja`), "ja");
  for (const bad of [`${LOCALE_COOKIE}=zh`, `${LOCALE_COOKIE}=`, `${LOCALE_COOKIE}=<script>`, `${LOCALE_COOKIE}=../x`, "otra=de", "", null]) assert.equal(localeFromCookieHeader(bad), null);
});

/* ───────────── 6 · cambio sin efectos secundarios ───────────── */

test("CAMBIO · avisa a los suscriptores una vez por cambio real y no hace nada si el idioma es el mismo", () => {
  let calls = 0;
  const off = subscribeLocale(() => { calls++; });
  const v0 = i18nVersion();
  setActiveLocale("es"); assert.equal(calls, 0);
  setActiveLocale("en"); assert.equal(calls, 1);
  setActiveLocale("en"); assert.equal(calls, 1);
  assert.ok(i18nVersion() > v0);
  off();
  setActiveLocale("de"); assert.equal(calls, 1);
});

test("CAMBIO · operación crítica: se cuenta, se cierra una sola vez y avisa al quedar libre", async () => {
  let idle = 0;
  onCriticalIdle(() => { idle++; });
  const end1 = beginCriticalOperation();
  const end2 = beginCriticalOperation();
  assert.equal(isCriticalOperationActive(), true);
  end1(); end1(); // idempotente: cerrar dos veces no libera la otra
  assert.equal(isCriticalOperationActive(), true);
  assert.equal(idle, 0);
  end2();
  assert.equal(isCriticalOperationActive(), false);
  assert.equal(idle, 1);
  await assert.rejects(withCriticalOperation(async () => { assert.equal(isCriticalOperationActive(), true); throw new Error("fallo de red"); }));
  assert.equal(isCriticalOperationActive(), false, "un fallo también libera");
  assert.equal(idle, 2);
});

test("SERVIDOR · sin idioma de petición el servidor traduce a español (contrato de la API intacto); con resolver, el suyo", () => {
  registerCatalog("en", { server: { "No autenticado": "Not signed in" } });
  assert.equal(translate("server", "No autenticado"), "No autenticado");
  setLocaleResolver(() => "en");
  assert.equal(translate("server", "No autenticado"), "Not signed in");
  setLocaleResolver(() => undefined);
  assert.equal(getLocale(), "es");
});

/* ───────────── 8 · plurales y variables ───────────── */

test("VARIABLES · se sustituyen; una que falta queda visible como hueco, no como «undefined»", () => {
  assert.equal(formatMessage("Tienes {n} sobres de {name}", { n: 3, name: "Oro" }, "es-ES"), "Tienes 3 sobres de Oro");
  assert.equal(formatMessage("Hola {name}", {}, "es-ES"), "Hola {name}");
  assert.equal(formatMessage("Texto {con} llaves", undefined, "es-ES"), "Texto {con} llaves", "sin variables no se interpreta");
  assert.equal(formatMessage("{a}{a}-{b}", { a: "x", b: 0 }, "en-GB"), "xx-0");
});

test("PLURALES · reglas del idioma, casos exactos y # con formato numérico", () => {
  const m = "{n, plural, =0 {Sin cartas} one {# carta} other {# cartas}}";
  assert.deepEqual([0, 1, 2, 1500].map((n) => formatMessage(m, { n }, "es-ES")), ["Sin cartas", "1 carta", "2 cartas", "1.500 cartas"]);
  const en = "{n, plural, one {# card} other {# cards}}";
  assert.deepEqual([1, 0, 2, 1500].map((n) => formatMessage(en, { n }, "en-GB")), ["1 card", "0 cards", "2 cards", "1,500 cards"]);
  assert.deepEqual([1, 2].map((n) => formatMessage("{n, plural, one {# Karte} other {# Karten}}", { n }, "de-DE")), ["1 Karte", "2 Karten"]);
  assert.deepEqual([1, 2].map((n) => formatMessage("{n, plural, one {# carta} other {# carte}}", { n }, "it-IT")), ["1 carta", "2 carte"]);
  assert.equal(formatMessage("{n, plural, one {Te falta # de {set}} other {Te faltan # de {set}}}", { n: 2, set: "EMEA" }, "es-ES"), "Te faltan 2 de EMEA");
});

test("PLURALES · el auditor ve las mismas variables y categorías en original y traducción", () => {
  assert.deepEqual(messagePlaceholders("{n, plural, one {# de {set}} other {# de {set}}} · {who}"), ["n", "set", "who"]);
  assert.deepEqual(messagePluralCategories("{n, plural, =0 {a} one {b} other {c}}"), { n: ["=0", "one", "other"] });
  assert.deepEqual(messagePlaceholders("sin variables"), []);
});

/* ───────────── 9 · formato de números y fechas ───────────── */

test("FORMATO · miles y decimales por idioma (y cuatro cifras agrupadas en español)", () => {
  // francés y portugués de Portugal separan los miles con un espacio duro (U+202F / U+00A0): se normaliza para comparar
  const sp = (x: string) => x.replace(/[\u00a0\u202f]/g, " ");
  assert.deepEqual(LOCALES.map((l) => sp(formatNumber(30000, undefined, l))), ["30.000", "30,000", "30.000", "30.000", "30 000", "30 000", "30.000", "30,000"]);
  assert.deepEqual(LOCALES.map((l) => sp(formatNumber(5000, undefined, l))), ["5.000", "5,000", "5.000", "5.000", "5 000", "5 000", "5.000", "5,000"]);
  assert.deepEqual(LOCALES.map((l) => formatNumber(17.5, { maximumFractionDigits: 1 }, l)), ["17,5", "17.5", "17,5", "17,5", "17,5", "17,5", "17,5", "17.5"]);
  // los DÍGITOS de un precio son los mismos en los ocho
  for (const n of [30000, 80000, 2500]) assert.equal(new Set(LOCALES.map((l) => formatNumber(n, undefined, l).replace(/[^\d]/g, ""))).size, 1);
});

test("FORMATO · un porcentaje es el MISMO valor en los ocho idiomas (solo cambia el separador)", () => {
  const digits = (s: string) => s.replace(/[^\d]/g, "");
  for (const p of [0.01, 0.05, 0.1, 0.15, 0.2, 0.65, 0.175]) {
    const out = LOCALES.map((l) => formatPercent(p, 1, l));
    assert.equal(new Set(out.map(digits)).size, 1, `${p}: ${out.join(" | ")}`);
    for (const o of out) assert.ok(o.includes("%"));
  }
  assert.match(formatPercent(0.175, 1, "en"), /^17\.5\s?%$/);
  assert.match(formatPercent(0.175, 1, "de"), /^17,5\s?%$/);
});

test("FORMATO · fechas con el orden y los nombres de cada idioma; una fecha inválida no revienta", () => {
  const d = new Date(Date.UTC(2026, 9, 10, 12));
  const out = LOCALES.map((l) => formatDate(d, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }, l));
  assert.deepEqual(out, ["10 de octubre de 2026", "10 October 2026", "10. Oktober 2026", "10 ottobre 2026", "10 octobre 2026", "10 de outubro de 2026", "10 de outubro de 2026", "2026年10月10日"]);
  assert.equal(formatDate("no es una fecha"), "");
});

/* ───────────── 10 · errores (texto que llega del servidor) ───────────── */

test("ERRORES · un mensaje fijo del servidor se traduce en el cliente por su texto; lo desconocido pasa intacto", () => {
  registerCatalog("en", { api: { "No autenticado": "Not signed in", "Créditos insuficientes": "Not enough credits" } });
  setActiveLocale("en");
  assert.equal(td("No autenticado"), "Not signed in");
  assert.equal(td("Créditos insuficientes"), "Not enough credits");
  assert.equal(td("TenZ"), "TenZ");
  assert.equal(td(""), "");
  assert.equal(td(null), null);
  assert.equal(td(undefined), undefined);
  assert.equal(td(42 as unknown as string), 42);
});

test("ERRORES · un mensaje COMPUESTO por el servidor se reconoce por su plantilla y conserva sus valores", () => {
  registerCatalog("de", { server: {
    "Necesitas {n} créditos y tienes {have}.": "Du brauchst {n} Credits und hast {have}.",
    "Te faltan {missing} cartas de {role}": "Dir fehlen {missing} Karten: {role}",
    "Duelista": "Duellant",
  } });
  setActiveLocale("de");
  assert.equal(td("Necesitas 30.000 créditos y tienes 1.250."), "Du brauchst 30.000 Credits und hast 1.250.");
  assert.equal(td("Te faltan 2 cartas de Duelista"), "Dir fehlen 2 Karten: Duellant", "los valores que son texto conocido también se traducen");
  assert.equal(td("Otra frase que no encaja con ninguna plantilla."), "Otra frase que no encaja con ninguna plantilla.");
  setActiveLocale("es");
  assert.equal(td("Necesitas 30.000 créditos y tienes 1.250."), "Necesitas 30.000 créditos y tienes 1.250.");
});

test("ERRORES · una plantilla demasiado genérica no se usa (no se «traduce» cualquier cosa)", () => {
  registerCatalog("en", { x: { "{a} de {b}": "{a} of {b}" } });
  setActiveLocale("en");
  assert.equal(td("Paper Rex de Singapur llega"), "Paper Rex de Singapur llega");
});

test("ERRORES · texto compuesto por piezas: tramos « · », valores anidados y otra capitalización", () => {
  registerCatalog("de", { server: {
    "{credits} créditos": "{credits} Credits",
    "{xp} XP del pase": "{xp} Pass-XP",
    "Sobre Estándar": "Standard-Pack",
    "Siguiente recompensa del pase · nivel {level}: {reward}": "Nächste Pass-Belohnung · Level {level}: {reward}",
  } });
  setActiveLocale("de");
  assert.equal(td("150 créditos · 250 XP del pase"), "150 Credits · 250 Pass-XP");
  assert.equal(td("Siguiente recompensa del pase · nivel 7: Sobre estándar"), "Nächste Pass-Belohnung · Level 7: Standard-Pack");
  assert.equal(td("1.200 créditos"), "1.200 Credits");
});

test("ERRORES · una plantilla corta solo acepta CIFRAS: «Tus créditos» no se confunde con «{n} créditos»", () => {
  registerCatalog("en", { server: { "{credits} créditos": "{credits} credits" } });
  setActiveLocale("en");
  assert.equal(td("Tus créditos"), "Tus créditos");
  assert.equal(td("Sin créditos"), "Sin créditos");
  assert.equal(td("30.000 créditos"), "30.000 credits");
});
