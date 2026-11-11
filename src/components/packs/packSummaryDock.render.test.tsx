/**
 * RESUMEN DEL SOBRE · el dock de acciones. Pegado al pie por defecto; EN SU SITIO solo con la guía de la primera sesión
 * delante (F63: en 390 px tapaba los botones de la guía). En los dos casos, las mismas acciones. Regresión del verify de
 * experiencia (sección packs), que buscaba el literal anterior a F63.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { PackSummary } from "./PackSummary";
import { SCENES } from "@/app/design-system/fase38/fixtures";
import { buildRevealPlan } from "@/domain/packs/reveal";
import { CARDS, getCard, getPlayer } from "@/data/catalog";

const scene = SCENES["summary-open-another"];
if (scene.kind !== "summary") throw new Error("fixture summary-open-another");
const plan = buildRevealPlan(scene.plan.opened, scene.plan.before, { cards: CARDS, getCard, getPlayer });
const render = (extra: Partial<Parameters<typeof PackSummary>[0]> = {}) => renderToStaticMarkup(
  <PackSummary packName="Sobre" plan={plan} available={scene.available} packsLeft={scene.packsLeft} onOpenAnother={() => {}} onNavigate={() => {}} {...extra} />,
);
const ACTIONS = ["summary-open-another", "summary-view-collection", "summary-play"];

test("PSD-1 · sin guía: dock PEGADO al pie con ABRIR OTRO (dominante), COLECCIÓN y JUGAR", () => {
  const h = render();
  assert.match(h, /data-dock="sticky"/);
  assert.match(h, /class="sticky bottom-0[^"]*"/);
  for (const id of ACTIONS) assert.ok(h.includes(`data-testid="${id}"`), id);
  assert.equal((h.match(/data-cta="primary"/g) ?? []).length, 1);
});

test("PSD-2 · con la guía de la primera sesión: dock en su sitio (no tapa la guía) y las MISMAS acciones", () => {
  const h = render({ dockStatic: true, lead: "Guía de la primera sesión" });
  assert.match(h, /data-dock="static"/);
  assert.match(h, /class="relative bottom-0[^"]*"/);
  assert.ok(!/class="sticky bottom-0/.test(h));
  for (const id of ACTIONS) assert.ok(h.includes(`data-testid="${id}"`), id);
  assert.ok(h.includes('data-testid="summary-lead"'));
});

test("PSD-3 · la apertura solo deja el dock estático cuando hay guía", () => {
  const exp = readFileSync(join(process.cwd(), "src/components/packs/PackOpeningExperience.tsx"), "utf8");
  assert.ok(exp.includes("dockStatic={!!guide}"));
});
