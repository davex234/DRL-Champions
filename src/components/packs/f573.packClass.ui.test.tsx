/**
 * FASE 57.3 · UI — la ficha enseña la tabla por clase de la línea principal, «Garantizada» solo donde es verdad (fix F25),
 * y la ceremonia del Sobre Icon es de UNA carta (sin tira, sin contador, sin «Revelar todas»).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { getPack } from "@/data/packs";
import { packStats } from "@/data/packStats";
import { packOddsFor } from "@/domain/packs/odds";
import { MAIN_PACK_LINE, mainPackDistribution, activeClasses, PACK_CLASS_LABEL } from "@/domain/packs/packClass";
import { PackOddsPanel } from "./PackOdds";
import { PackHand } from "./PackHand";

const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const panel = (id: string) => html(<PackOddsPanel odds={packOddsFor(getPack(id)!, packStats(id) ?? null, 0)} />);
const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

/** Igual que la ficha: porcentaje con un decimal y coma (64,7 %). */
const fmt = (pct: number) => `${(Math.round(pct * 10) / 10).toLocaleString("es-ES")} %`;

test("FICHA · Sobre ICON (2026-10-09, `icon-single`): 1 carta, 100 % Icon, «Icon garantizada», la frase exacta y la probabilidad de cada Icon", () => {
  const h = panel("icon-single");
  assert.match(h, /1 carta por sobre/);
  assert.match(h, /Icon garantizada/);
  assert.match(h, /data-class="icon"[\s\S]*?100 %/);
  // Sin huecos normales: no se pinta una caja «0 cartas normales».
  assert.doesNotMatch(h, /data-slot="regular"/);
  assert.match(h, /data-slot="featured"[\s\S]*?Icon 100 %/);
  assert.match(h, /data-best-odds[\s\S]*?OVR 90\+/);
  assert.equal((h.match(/data-class="/g) ?? []).length, 1, "solo la clase Icon");
  // Frase del encargo con la tabla APROBADA (65 / 17,5 / 17,5): ahora sí es verdad que las de menor valor son más probables.
  assert.match(h, /data-icon-text[^>]*>Contiene exactamente 1 carta ICON garantizada\. Las ICON de menor valor tienen mayor probabilidad de aparecer\.</);
  assert.match(h, /data-icon-method[^>]*>Nivel 18\.400: 65 % · Nivel 26\.500: 35 %\./);
  assert.doesNotMatch(h, /data-icon-top/, "una carta: sin «al menos una de 95»");
  assert.equal((h.match(/<li data-card="/g) ?? []).length, 3, "las 3 Icon del catálogo, cada una con su probabilidad");
  for (const [nick, p] of [["PatMen", "65"], ["marteen", "17,5"], ["mada", "17,5"]]) assert.match(h, new RegExp(`>${nick}</b> · OVR 9[25] · <span[^>]*>${p} %</span> por carta`), nick);
});

test("FICHA · ICON Premium (2026-10-09, id histórico `icon`): 3 cartas, 3 ICON garantizadas, independientes, pesos por carta y P(≥ 1 de 95) = 72,54 %", () => {
  const h = panel("icon");
  assert.match(h, /3 cartas por sobre/);
  assert.match(h, /Icon garantizada/);
  assert.match(h, /data-icon-text[^>]*>Contiene exactamente 3 cartas ICON garantizadas\. Cada carta se sortea por separado: pueden repetirse\. Las ICON de menor valor tienen mayor probabilidad de aparecer\.</);
  for (const [nick, p] of [["PatMen", "65"], ["marteen", "17,5"], ["mada", "17,5"]]) assert.match(h, new RegExp(`>${nick}</b> · OVR 9[25] · <span[^>]*>${p} %</span> por carta`), nick);
  assert.match(h, /data-icon-top[^>]*>Probabilidad de al menos una ICON de 95 OVR: 72,54 %\.</);
  for (const r of ["Común", "Poco común", "Rara", "Épica", "Legendaria"]) assert.ok(!h.includes(`>${r}<`), r);
});

test("FICHA · cada sobre de la línea pinta SU tabla (cifras exactas) y ninguno salvo Icon dice «garantizada»", () => {
  for (const id of MAIN_PACK_LINE) {
    const h = panel(id), t = mainPackDistribution(id)!;
    assert.match(h, /data-draw-mode="class-distribution"/);
    for (const k of activeClasses(t)) assert.match(h, new RegExp(`data-class="${k}"[\\s\\S]*?>${PACK_CLASS_LABEL[k]}<[\\s\\S]*?${fmt(t[k])}`), `${id}/${k}`);
    assert.match(h, /data-slot="featured"/, id);
    assert.equal((h.match(/data-class="/g) ?? []).length, activeClasses(t).length, id);
    if (id !== "icon" && id !== "icon-single") assert.doesNotMatch(h, /garantizada/i, id);
    // Icon por sobre (2026-10-09): la frase exacta con la probabilidad CONFIGURADA (no medida, no redondeada).
    const want = { estandar: "1", premium: "5", oro: "10", masters: "15", champions: "20" }[id as string];
    if (want) assert.match(h, new RegExp(`data-icon-text[^>]*>Probabilidad de conseguir al menos una carta ICON en este sobre: ${want} %<`), id);
  }
  // Bronce, tal cual el plan: media por carta exacta de 4 normales + la destacada.
  const b = panel("estandar");
  for (const [k, p] of [["Base", "62,6"], ["Plata", "28"], ["Oro", "6,4"], ["Masters", "2"], ["Champions", "0,6"], ["Prime", "0,3"], ["Icon", "0,2"]] as const) assert.match(b, new RegExp(`>${k}<[\\s\\S]*?${p} %`), `${k}`);
  assert.match(b, /4 cartas normales[\s\S]*?Base 72 % · Plata 25 % · Oro 3 %/);
  assert.match(b, /dentro de cada clase, las cartas de OVR más alto son menos probables/);
});

test("F25 · un sobre por rareza con garantía «X o superior» ya no marca ninguna fila «Garantizada» si puede salir algo mejor", () => {
  const h = panel("prime"); // Pack Opening 3.1: EWC ya sortea por plan; Prime (retirado, recompensa) sigue por rareza.
  assert.doesNotMatch(h, />Garantizada</);
  assert.match(h, /Garantiza al menos una carta <b[^>]*>épica<\/b> o superior/);
});

test("CEREMONIA · un sobre de UNA carta (caso genérico de la pieza): un dorso, «1 carta», sin «Revelar todas», sin tira ni contador", () => {
  const hand = html(<PackHand slots={[{ revealed: false }]} accent="#f5f0e6" mode="hand" />);
  assert.equal((hand.match(/data-card-back/g) ?? []).length, 1);
  const stage = read("src/components/packs/PackStage.tsx");
  assert.ok(stage.includes('count === 1 ? "1 carta" : `${count} cartas`'));
  assert.ok(/\{count > 1 && <div[\s\S]*?Revelar todas/.test(stage), "«Revelar todas» solo con más de una carta");
  const exp = read("src/components/packs/PackOpeningExperience.tsx");
  // F81 · con una sola carta la hero ES el sobre: CONTINUAR lleva al resumen y no hay «resto».
  assert.ok(read("src/components/packs/HeroReveal.tsx").includes('{total > 1 ? `Continuar · ${total - 1} más` : "Ver resumen"}'), "una carta: sin «resto»");
  assert.ok(exp.includes('{phase === "rest" && <RestReveal'), "el resto solo existe como fase propia");
});
