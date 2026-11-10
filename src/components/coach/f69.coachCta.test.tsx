/**
 * FASE 69 · F68-012 — en la fase de compra del Coach había dos CTA para lo mismo: «Comprar y empezar ronda» (panel) y
 * «Jugar la ronda» (pie anclado). Las dos llamaban a `loop.confirmBuy(tier)` con el nivel marcado. Igual en la sala
 * táctica: «Confirmar plan → Fase de compra» y «Comenzar fase de compra» = `confirmPreparation(input)`. La orden canónica
 * es la del pie (siempre visible); los paneles solo pintan su botón si se usan aislados (`onConfirm`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { BuyPhasePanel } from "./BuyPhasePanel";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

const BUY = {
  roundNumber: 1, side: "ATK" as const, recommendedTier: "eco" as const, economy: null, cards: [],
  scout: { rounds: 0, enemyEconomy: { buy: null, buyingPower: 0.3 } },
} as unknown as Parameters<typeof BuyPhasePanel>[0]["buy"];

test("F69 F68-012 · en el partido, la compra tiene UNA sola orden: el pie «Jugar la ronda»", () => {
  const page = read("src/app/entrenador/partido/page.tsx");
  assert.match(page, /<BuyPhasePanel buy=\{loop\.buy\} onChange=\{setBuyTier\} \/>/, "el panel no recibe onConfirm");
  assert.match(page, /label=\{(?:t|tr|i18nT)\("Jugar la ronda"\)\}[\s\S]{0,200}loop\.confirmBuy\(buyTier \?\? loop\.buy!\.recommendedTier \?\? "full"\)/, "el pie compra lo marcado");
  const html = renderToStaticMarkup(<BuyPhasePanel buy={BUY} onChange={() => undefined} />);
  assert.ok(!/Comprar y empezar ronda/i.test(html), "sin botón duplicado dentro del panel");
});

test("F69 F68-012 · la sala táctica tampoco duplica «Comenzar fase de compra»", () => {
  const page = read("src/app/entrenador/partido/page.tsx");
  assert.match(page, /<CoachTacticalPanel prep=\{loop\.prep\} onChange=\{setPrepInput\} \/>/);
  assert.match(page, /label=\{(?:t|tr|i18nT)\("Comenzar fase de compra"\)\}[\s\S]{0,260}loop\.confirmPreparation\(prepInput \?\? planPorDefecto\(loop\.prep!\)\)/);
  assert.match(read("src/components/coach/CoachTacticalPanel.tsx"), /\{onConfirm && \(\n\s*<button onClick=\{\(\) => onConfirm\(input\)\}/);
});

test("F69 F68-012 · uso aislado: con onConfirm el panel conserva su botón (no se pierde ninguna acción distinta)", () => {
  const html = renderToStaticMarkup(<BuyPhasePanel buy={BUY} onConfirm={() => undefined} />);
  assert.match(html, /Comprar y empezar ronda/i);
});
