import test from "node:test";
import assert from "node:assert/strict";
import {
  publicPacks, catalogGroups, availableTabs, tabForPack, ctaKindFor, isCatalogVisible,
  CATALOG_TAB_ORDER,
} from "./packCatalog";
import { PACKS, getPack } from "@/data/packs";
import { packLifecycle } from "@/domain/packs/lifecycle";

// 1 · ACTIVE aparece; 2 · DRAFT no; 3 · RETIRED no.
test("visibilidad del catálogo = ciclo de vida (ACTIVE sí, DRAFT/RETIRED no)", () => {
  const ids = new Set(publicPacks().map((p) => p.id));
  // ACTIVE conocidos aparecen.
  for (const id of ["estandar", "premium", "emea", "americas", "team-heretics", "team-g2"]) {
    assert.ok(ids.has(id), `${id} (ACTIVE) debería aparecer`);
  }
  // RETIRED no (prime).
  assert.ok(!ids.has("prime"), "prime (RETIRED) no debe aparecer");
  // DRAFT no. Team Liquid y Karmine Corp SALIERON de esta lista el 2026-09-22: su auditoría
  // tenía un único bloqueo (el artwork) y al llegar su arte oficial pasaron a ACTIVE.
  for (const id of ["team-loud", "team-blg", "team-tyl", "team-lev", "team-m8"]) {
    assert.equal(packLifecycle(getPack(id)!), "DRAFT");
    assert.ok(!ids.has(id), `${id} (DRAFT) no debe filtrarse al catálogo público`);
  }
  // Coherencia: todo lo público es exactamente lo ACTIVE.
  for (const p of publicPacks()) assert.equal(packLifecycle(p), "ACTIVE", `${p.id} no es ACTIVE`);
  assert.equal(publicPacks().length, PACKS.filter((p) => packLifecycle(p) === "ACTIVE").length);
});

// 4 · El precio mostrado procede del backend (no se inventa): la card usa pack.price tal cual.
test("el precio y nº de cartas del catálogo son los del PackDef (no hardcodeados)", () => {
  for (const p of publicPacks()) {
    const src = getPack(p.id)!;
    assert.equal(p.price, src.price);
    assert.equal(p.cardCount, src.cardCount);
  }
});

// 6 (parcial) · pack inexistente / no visible se distingue.
test("isCatalogVisible respeta el ciclo de vida", () => {
  assert.equal(isCatalogVisible(getPack("estandar")!), true);
  assert.equal(isCatalogVisible(getPack("prime")!), false);
  assert.equal(isCatalogVisible(getPack("team-loud")!), false);
});

test("categorías — cada pack cae en una pestaña, y las pestañas cubren lo visible", () => {
  const groups = catalogGroups("todos");
  const enGrupos = groups.flatMap((g) => g.packs.map((p) => p.id)).sort();
  assert.deepEqual(enGrupos, publicPacks().map((p) => p.id).sort(), "todo pack visible está en una pestaña");
  // Ninguna pestaña vacía.
  for (const g of groups) assert.ok(g.packs.length > 0);
  // Las pestañas son un subconjunto ordenado del orden canónico.
  const tabs = groups.map((g) => g.tab);
  assert.deepEqual(tabs, CATALOG_TAB_ORDER.filter((t) => tabs.includes(t)));
});

test("Team Heretics aparece en la pestaña Equipos y es ACTIVE", () => {
  const th = getPack("team-heretics")!;
  assert.equal(packLifecycle(th), "ACTIVE");
  assert.equal(tabForPack(th), "equipos");
  const equipos = catalogGroups("equipos");
  assert.ok(equipos.length === 1);
  assert.ok(equipos[0].packs.some((p) => p.id === "team-heretics"), "Team Heretics debe estar en Equipos");
  // Y ningún Team Pack DRAFT se cuela en Equipos.
  for (const p of equipos[0].packs) assert.equal(packLifecycle(p), "ACTIVE");
});

test("pestañas por región y rareza contienen lo esperado", () => {
  assert.equal(tabForPack(getPack("emea")!), "regiones");
  assert.equal(tabForPack(getPack("americas")!), "regiones");
  assert.equal(tabForPack(getPack("estandar")!), "rareza");
  assert.equal(tabForPack(getPack("icon")!), "rareza");
  assert.equal(tabForPack(getPack("masters")!), "eventos");
  // availableTabs incluye "todos" primero y solo pestañas con contenido.
  const tabs = availableTabs();
  assert.equal(tabs[0], "todos");
  assert.ok(tabs.includes("equipos") && tabs.includes("regiones") && tabs.includes("rareza"));
});

test("CTA — evento va a eventos, gratis abre, resto compra", () => {
  assert.equal(ctaKindFor(getPack("masters")!), "event"); // tiene eventId
  assert.equal(ctaKindFor(getPack("inicial")!), "free");  // price 0
  assert.equal(ctaKindFor(getPack("estandar")!), "buy");
  assert.equal(ctaKindFor(getPack("team-heretics")!), "buy");
});
