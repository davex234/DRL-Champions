/**
 * APERTURA DE SOBRES 2026-10-15 · SALA POR RAREZA, RESTO CARTA A CARTA Y SIN WALKOUT. Catálogo REAL y escenas del arnés
 * `/design-system/fase81` (r-*). Nada de aquí sortea ni toca economía: se presenta un resultado dado.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CARDS, getCard, getPlayer } from "@/data/catalog";
import type { CardDef } from "@/domain/cards/types";
import { PACK_CLASS_COLOR, PACK_CLASS_ORDER, packCardClass } from "@/domain/packs/packClass";
import {
  ATMOSPHERE_ENTER_MS, ATMOSPHERE_EXIT_MS, ATMOSPHERE_REDUCED_MS, CLASS_ATMOSPHERE, NEUTRAL_ATMOSPHERE, REVEAL_PREP_MS, REVEAL_PREP_REDUCED_MS,
  atmosphereForCard, mixHex, revealPrepMs, sceneAtmosphere,
} from "@/domain/packs/atmosphere";
import { INITIAL_REVEAL, buildRevealPlan, revealReducer, toOpenedInstances, type RevealEvent, type RevealItem, type RevealState } from "@/domain/packs/reveal";
import type { RevealAtmosphere as Atmosphere } from "@/domain/packs/atmosphere";
type Scene = { card: RevealItem | null; atmosphere: Atmosphere | null };
import { f81Results, f81Scene } from "@/app/design-system/fase81/fixtures";
import { RevealAtmosphere } from "./RevealAtmosphere";
import { CardBack } from "./CardBack";

const CAT = { cards: CARDS, getCard, getPlayer };
const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const run = (s: RevealState, ...evs: RevealEvent[]) => evs.reduce(revealReducer, s);

/** Tono (0–360) de un `#rrggbb`. */
function hue(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
const lum = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).reduce((a, v) => a + v, 0) / 3;
const one = (pred: (c: CardDef) => boolean) => { const c = CARDS.find(pred); assert.ok(c, "carta real del catálogo"); return c!; };

/* ═══════════════════ el color de cada rareza ═══════════════════ */

test("ATM1 · una carta MASTERS (Masters L y Masters SDC) produce la sala LILA/VIOLETA", () => {
  for (const v of ["masters-l", "masters-sdc"]) {
    const a = atmosphereForCard(one((c) => c.variantId === v));
    assert.equal(a.key, "masters", v);
    assert.ok(hue(a.glow) >= 250 && hue(a.glow) <= 290, `luz violeta (${a.glow}, ${hue(a.glow).toFixed(0)}°)`);
    assert.ok(hue(a.mid) >= 250 && hue(a.mid) <= 290, `fondo violeta (${a.mid})`);
    assert.equal(a.tone, "dark");
  }
});

test("ATM2 · una carta ICON (Record Breaker y Moments) produce la sala BLANCA/MARFIL, clara y premium", () => {
  for (const v of ["record-breaker", "moments"]) {
    const a = atmosphereForCard(one((c) => c.variantId === v));
    assert.equal(a.key, "icon", v);
    assert.equal(a.tone, "light");
    assert.equal(a.tier, 3);
    assert.ok(lum(a.mid) > 240, `centro marfil (${a.mid})`);
    assert.ok(lum(a.deep) > 190, `borde claro, no negro (${a.deep})`);
  }
});

test("ATM3 · una carta ORO (edición base, OVR 86–92) produce la sala DORADA con reflejos metálicos", () => {
  const a = atmosphereForCard(one((c) => c.variantId === "base" && c.ovr >= 86 && c.ovr <= 92));
  assert.equal(a.key, "oro");
  assert.equal(a.glow, PACK_CLASS_COLOR.oro, "el oro de la clase");
  assert.ok(hue(a.glow) >= 38 && hue(a.glow) <= 52 && hue(a.mid) >= 30 && hue(a.mid) <= 50, "dorado");
  assert.equal(a.sheen, true, "reflejos metálicos");
});

test("ATM4 · el resto de rarezas usa SU color (el de la clase y el arte real), cada una distinta", () => {
  assert.equal(atmosphereForCard(one((c) => c.variantId === "base" && c.ovr <= 81)).key, "base");
  assert.equal(atmosphereForCard(one((c) => c.variantId === "base" && c.ovr >= 82 && c.ovr <= 85)).key, "plata");
  assert.equal(atmosphereForCard(one((c) => c.variantId === "champions-s")).key, "champions");
  assert.equal(atmosphereForCard(one((c) => c.variantId === "future-star")).key, "prime");
  for (const k of ["base", "plata", "oro", "prime", "icon"] as const) {
    if (k === "icon") continue; // la sala Icon es marfil; su luz es blanca (el marfil de la clase es el fondo)
    assert.equal(CLASS_ATMOSPHERE[k].glow, PACK_CLASS_COLOR[k], `${k}: la luz es el color de la clase`);
  }
  assert.ok(lum(CLASS_ATMOSPHERE.icon.mid) >= lum(PACK_CLASS_COLOR.icon), "Icon: fondo marfil como su clase");
  assert.equal(CLASS_ATMOSPHERE.champions.glow, "#ffe08a", "Champions S: el oro campeón de su edición, sobre negro");
  const glows = PACK_CLASS_ORDER.map((k) => CLASS_ATMOSPHERE[k].glow);
  assert.equal(new Set(glows).size, glows.length, "siete clases, siete luces");
  // Intensidad proporcional: nunca baja al subir de clase; las bajas no son una pantalla vacía (foco, halo y suelo siempre).
  const tiers = PACK_CLASS_ORDER.map((k) => CLASS_ATMOSPHERE[k].tier);
  for (let i = 1; i < tiers.length; i++) assert.ok(tiers[i] >= tiers[i - 1] || PACK_CLASS_ORDER[i] === "prime", PACK_CLASS_ORDER[i]);
  assert.equal(CLASS_ATMOSPHERE.icon.tier, 3); assert.equal(CLASS_ATMOSPHERE.masters.tier, 2);
});

test("ATM5 · TODAS las cartas del catálogo tienen sala de su clase (ninguna cae a la reserva)", () => {
  for (const c of CARDS) {
    const cls = packCardClass(c);
    assert.ok(cls, `${c.id} tiene clase`);
    assert.equal(atmosphereForCard(c).key, cls, c.id);
  }
});

test("ATM6 · la rareza sale de la carta (edición + OVR), no del nombre, el jugador ni el precio; desconocidas → reserva segura", () => {
  const m = one((c) => c.variantId === "masters-l");
  assert.deepEqual(atmosphereForCard({ ...m, id: "x__otra", playerId: "otro" } as CardDef), atmosphereForCard(m));
  assert.equal(atmosphereForCard(null).key, "neutral");
  assert.equal(atmosphereForCard(undefined).key, "neutral");
  assert.equal(atmosphereForCard({ variantId: "no-existe" as CardDef["variantId"], ovr: 90 }).key, "neutral", "edición desconocida");
  assert.equal(atmosphereForCard({ variantId: "base", ovr: Number.NaN }).key, "neutral", "OVR no válido");
  // Una edición real fuera de la línea de sobres (regionales/antiguas): el color de SU edición, nunca otra clase.
  const emea = atmosphereForCard({ variantId: "emea", ovr: 80 });
  assert.equal(emea.key, "special"); assert.equal(emea.glow, "#19e3ff");
  assert.equal(mixHex("#ffffff", "#000000", 0.5), "#808080");
  assert.equal(mixHex("rojo", "#000000", 0.5), "rojo");
});

/* ═══════════════════ secuencia: cada revelado, su sala ═══════════════════ */

function plan(scene: Parameters<typeof f81Results>[0]) {
  const res = f81Results(scene);
  const p = buildRevealPlan(toOpenedInstances(res), null, CAT);
  const hero = p.hero.ok ? p.hero.hero : null;
  return { res, p, hero, rest: p.order.filter((i) => i.uid !== hero?.uid) };
}

test("SEQ1 · un sobre con las SIETE clases cambia de sala en cada revelado y nunca enseña la de la carta anterior", () => {
  const { hero, rest } = plan("r-mixed");
  assert.ok(hero);
  let s: RevealState = run(INITIAL_REVEAL, { type: "OPEN_REQUESTED" }, { type: "OPEN_SUCCEEDED", count: rest.length + 1, repeated: false }, { type: "INTRO_DONE" });
  assert.equal(s.phase, "buildup");
  assert.equal(sceneAtmosphere(s, hero, rest).atmosphere?.key, "neutral", "la tensión: luz neutra, sin anticipar la rareza");
  s = run(s, { type: "BUILDUP_DONE" });
  const seen: string[] = [sceneAtmosphere(s, hero, rest).atmosphere!.key];
  assert.equal(sceneAtmosphere(s, hero, rest).card?.uid, hero!.uid);
  s = run(s, { type: "HERO_SHOWN" }, { type: "CONTINUE" });
  for (let k = 0; k < rest.length; k++) {
    assert.equal(s.phase, "rest"); assert.equal(s.restIndex, k); assert.equal(s.restShown, false);
    const prep: Scene = sceneAtmosphere(s, hero, rest);
    assert.equal(prep.atmosphere?.key, "neutral", `carta ${k}: antes del giro, luz neutra (ni la anterior ni la siguiente)`);
    s = run(s, { type: "REST_SHOWN" });
    const shown: Scene = sceneAtmosphere(s, hero, rest);
    assert.equal(shown.card?.uid, rest[k].uid, "la sala es de ESTA carta");
    assert.equal(shown.atmosphere?.key, atmosphereForCard(rest[k].card).key);
    seen.push(shown.atmosphere!.key);
    s = run(s, { type: "ADVANCE" });
  }
  assert.equal(s.phase, "summary");
  assert.equal(sceneAtmosphere(s, hero, rest).atmosphere, null, "el resumen tiene su propia escena");
  assert.deepEqual([...seen].sort(), ["base", "champions", "icon", "masters", "oro", "plata", "prime"], "siete revelados, siete salas");
  // El color de la PRIMERA carta no se queda: hay al menos 6 cambios de sala.
  assert.equal(seen.filter((k, i) => i > 0 && k !== seen[i - 1]).length, 6);
});

test("SEQ2 · la sala anterior se va ANTES de que gire la siguiente (salida < la preparación más corta)", () => {
  assert.ok(ATMOSPHERE_EXIT_MS < Math.min(...Object.values(REVEAL_PREP_MS)), "con movimiento");
  assert.ok(ATMOSPHERE_REDUCED_MS < REVEAL_PREP_REDUCED_MS, "con movimiento reducido");
  assert.ok(ATMOSPHERE_EXIT_MS < ATMOSPHERE_ENTER_MS, "entra suave, sale rápido: sin parpadeo");
  assert.ok(revealPrepMs(3, false) > revealPrepMs(0, false), "más preparación cuanto más alta la clase");
  assert.equal(revealPrepMs(3, true), REVEAL_PREP_REDUCED_MS, "reducido: sin hacer esperar");
});

test("SEQ3 · avanzar, retroceder y terminar: un paso cada vez; atrás vuelve a cartas YA vistas y, desde la primera, a la hero", () => {
  const base = run(INITIAL_REVEAL, { type: "OPEN_REQUESTED" }, { type: "OPEN_SUCCEEDED", count: 4, repeated: false }, { type: "INTRO_DONE" }, { type: "BUILDUP_DONE" }, { type: "HERO_SHOWN" }, { type: "CONTINUE" });
  assert.equal(base.rest, 3);
  // Un toque antes del giro, gira ya (no se salta la carta).
  const a = run(base, { type: "ADVANCE" });
  assert.equal(a.restIndex, 0); assert.equal(a.restShown, true);
  const b = run(a, { type: "ADVANCE" });
  assert.equal(b.restIndex, 1); assert.equal(b.restShown, false);
  const back = run(b, { type: "BACK" });
  assert.equal(back.restIndex, 0); assert.equal(back.restShown, true, "la anterior vuelve boca arriba, sin girar otra vez");
  assert.equal(run(back, { type: "BACK" }).phase, "hero_hold", "desde la primera del resto, a la hero quieta");
  const again0 = run(run(back, { type: "BACK" }), { type: "CONTINUE" });
  assert.equal(again0.restIndex, 0, "y CONTINUAR vuelve a empezar el resto…");
  assert.equal(again0.restShown, true, "…con la carta ya vista boca arriba (no gira otra vez)");
  // Avanzar de nuevo sobre cartas ya vistas: boca arriba; la primera NO vista todavía, gira.
  const fwd = run(back, { type: "ADVANCE" });
  assert.equal(fwd.restIndex, 1); assert.equal(fwd.restShown, false, "la 1 aún no había girado");
  const seen1 = run(fwd, { type: "REST_SHOWN" }, { type: "BACK" }, { type: "ADVANCE" });
  assert.equal(seen1.restIndex, 1); assert.equal(seen1.restShown, true, "la 1 ya vista: boca arriba");
  // Terminar: tras la última, el resumen; OMITIR desde cualquier carta, también.
  const end = run(b, { type: "REST_SHOWN" }, { type: "ADVANCE" }, { type: "REST_SHOWN" }, { type: "ADVANCE" });
  assert.equal(end.phase, "summary");
  assert.equal(run(b, { type: "SKIP" }).phase, "summary");
  // Fuera del resto, «atrás» y «girada» no hacen nada.
  for (const ph of [INITIAL_REVEAL, run(base, { type: "SKIP" })]) {
    assert.equal(run(ph, { type: "BACK" }), ph); assert.equal(run(ph, { type: "REST_SHOWN" }), ph);
  }
  // «Abrir otro»: el cursor vuelve a cero.
  const again = run(end, { type: "RESET" });
  assert.equal(again.restIndex, 0); assert.equal(again.restShown, false); assert.equal(again.restSeen, -1);
});

test("SEQ4 · una sola carta (Sobre ICON): la hero ES el sobre, sala marfil y sin resto", () => {
  const { hero, rest } = plan("w-icon");
  assert.equal(rest.length, 0);
  const s = run(INITIAL_REVEAL, { type: "OPEN_REQUESTED" }, { type: "OPEN_SUCCEEDED", count: 1, repeated: false }, { type: "INTRO_DONE" }, { type: "BUILDUP_DONE" });
  assert.equal(sceneAtmosphere(s, hero, rest).atmosphere?.key, "icon");
  assert.equal(run(s, { type: "HERO_SHOWN" }, { type: "CONTINUE" }).phase, "summary");
});

test("SEQ5 · las escenas del arnés: hero Masters → lila, hero Icon → marfil, hero Oro → dorado; misma clase seguida = misma sala", () => {
  for (const [scene, key] of [["r-masters", "masters"], ["r-icon", "icon"], ["r-gold", "oro"]] as const) {
    const { hero } = plan(scene);
    assert.equal(atmosphereForCard(hero!.card).key, key, scene);
  }
  const { rest } = plan("r-same");
  assert.deepEqual(rest.map((i) => atmosphereForCard(i.card).key), ["plata", "plata"]);
});

test("SEQ6 · presentar NO toca el resultado: mismas cartas, mismo orden, mismos uids (ni una tirada nueva)", () => {
  const { res, p, hero, rest } = plan("r-mixed");
  const before = JSON.stringify(res);
  const order = p.order.map((i) => i.uid).join();
  Object.freeze(res); p.order.forEach((i) => Object.freeze(i));
  let s: RevealState = run(INITIAL_REVEAL, { type: "OPEN_REQUESTED" }, { type: "OPEN_SUCCEEDED", count: res.length, repeated: false }, { type: "INTRO_DONE" }, { type: "BUILDUP_DONE" }, { type: "HERO_SHOWN" }, { type: "CONTINUE" });
  for (let k = 0; k < 20 && s.phase === "rest"; k++) { sceneAtmosphere(s, hero, rest); s = run(s, k % 3 === 2 ? { type: "BACK" } : { type: "ADVANCE" }); }
  assert.equal(JSON.stringify(res), before);
  assert.equal(p.order.map((i) => i.uid).join(), order);
  assert.equal(s.requests, 1, "una sola petición en toda la ceremonia");
  assert.deepEqual(f81Scene("r-mixed").cards.map((c) => c.id), res.map((r) => r.card.id), "el orden del servidor no cambia");
});

/* ═══════════════════ la escena: sin monigote, capa y contratos ═══════════════════ */

test("SCN1 · el monigote (walkout 3D) no forma parte de la apertura en ninguna fase", () => {
  const exp = read("src/components/packs/PackOpeningExperience.tsx");
  for (const banned of [/<PackWalkout/, /import\("\.\/PackWalkout"\)/, /PACK_WALKOUT_3D_ENABLED/, /walkoutItems|walkoutFlow|packWalkoutQueue/, /components\/walkout\//, /from "three"/]) {
    assert.doesNotMatch(exp, banned, String(banned));
  }
  for (const f of ["HeroReveal.tsx", "RestReveal.tsx", "RevealSpotlight.tsx", "RevealAtmosphere.tsx", "PackStage.tsx", "PackSummary.tsx"]) {
    assert.doesNotMatch(read(`src/components/packs/${f}`), /PackWalkout|WalkoutStage|human3d|stage3d|walkout\//, f);
  }
  // Sin hueco: el resto ocupa la escena entera (no hay ninguna capa reservada para la figura).
  assert.match(read("src/components/packs/RestReveal.tsx"), /className="absolute inset-0 z-floating flex flex-col items-center justify-center/);
});

test("SCN2 · una sola sala persistente, calculada con el mismo estado que la carta; movimiento reducido respetado (y la preferencia del jugador)", () => {
  const exp = read("src/components/packs/PackOpeningExperience.tsx");
  assert.match(exp, /const \{ card: sceneCard, atmosphere \} = sceneAtmosphere\(state, best, restItems\);/);
  assert.match(exp, /<RevealAtmosphere atmosphere=\{atmosphere\} reduced=\{reduced\} cardUid=\{sceneCard\?\.uid \?\? null\} \/>/);
  assert.match(exp, /const reduced = openingReduced\(openingPref, systemReduced\);/);
  assert.equal(exp.match(/<RevealAtmosphere/g)?.length, 1, "una capa, no una por carta");
  // Teclado: ← vuelve en el resto.
  assert.match(exp, /k === "ArrowLeft" && phase === "rest"\) \{ e\.preventDefault\(\); back\(\); \}/);
});

test("SCN3 · la capa pinta la clase pedida; en reducido no hay nada que gire ni motas; sin sala, nada", () => {
  const icon = renderToStaticMarkup(createElement(RevealAtmosphere, { atmosphere: CLASS_ATMOSPHERE.icon, reduced: false, cardUid: "u1" }));
  assert.match(icon, /data-atmosphere="icon"/); assert.match(icon, /data-tone="light"/); assert.match(icon, /data-card-uid="u1"/);
  assert.match(icon, /atmosphere-rays/); assert.match(icon, /atmosphere-sheen/);
  const base = renderToStaticMarkup(createElement(RevealAtmosphere, { atmosphere: CLASS_ATMOSPHERE.base, reduced: false }));
  assert.ok(!/atmosphere-rays/.test(base), "Base: limpia, sin la corona de las clases altas");
  assert.ok(!/rounded-full" style="left:/.test(base), "Base: sin motas");
  assert.match(base, /radial-gradient/, "pero con luz: nunca una pantalla vacía");
  const red = renderToStaticMarkup(createElement(RevealAtmosphere, { atmosphere: CLASS_ATMOSPHERE.masters, reduced: true }));
  assert.match(red, /data-atmosphere="masters"/);
  assert.ok(!/rounded-full" style="left:/.test(red), "reducido: sin motas");
  assert.match(renderToStaticMarkup(createElement(RevealAtmosphere, { atmosphere: null, reduced: false })), /data-atmosphere="none"/);
  assert.equal(NEUTRAL_ATMOSPHERE.tier, 0);
});

test("SCN5 · el elemento que gira en 3D no lleva `filter` (aplana preserve-3d: tras el giro se vería el dorso espejado)", () => {
  const src = read("src/components/packs/RevealSpotlight.tsx");
  const style = src.match(/style=\{\{ transformStyle: "preserve-3d"[^\n]*\}\}/)?.[0] ?? "";
  assert.ok(style, "existe el elemento 3D");
  assert.doesNotMatch(style, /filter|opacity/);
  assert.match(src, /backfaceVisibility: "hidden", transform: "rotateY\(180deg\)"/, "la cara, de espaldas hasta el giro");
});

test("SCN6 · «Animaciones de apertura» llega también al sobre y al dorso (nada se mueve con «Reducidas»); la tienda sigue con el sistema", () => {
  assert.match(read("src/components/packs/PackStage.tsx"), /<SealedPack [^>]*reducedOverride=\{reduced\}/);
  assert.match(read("src/components/packs/RevealSpotlight.tsx"), /<CardBack [^>]*reducedOverride=\{reduced\}/);
  for (const f of ["SealedPack.tsx", "CardBack.tsx"]) assert.match(read(`src/components/packs/${f}`), /const reduced = reducedOverride \?\? systemReduced;/, f);
  const back = (o: Record<string, unknown>) => renderToStaticMarkup(createElement(CardBack, { accent: "#ffce4f", className: "w-[92px]", ...o }));
  assert.equal(back({ reducedOverride: true }), back({ reducedOverride: true, pulse: false }), "reducido: el sigilo no respira");
});

test("SCN7 · en la sala clara (Icon) el botón secundario es legible (fondo oscuro, no blanco sobre marfil)", () => {
  assert.match(read("src/components/packs/RestReveal.tsx"), /shown && atmosphere\.tone === "light" \? "!min-h-\[52px\] flex-1 !bg-\[#1a1408\]\/85 !text-white"/);
});

test("SCN8 · el DORSO no anticipa la rareza: se carga con luz neutra en la hero y en cada carta del resto", () => {
  for (const f of ["HeroReveal.tsx", "RestReveal.tsx"]) {
    const src = read(`src/components/packs/${f}`);
    assert.match(src, /accent=\{NEUTRAL_ATMOSPHERE\.glow\}/, f);
    assert.doesNotMatch(src, /accent=\{atmosphere\.glow\}/, `${f}: el color de la carta antes del giro`);
  }
});

test("SCN4 · la escena no toca red, store, economía ni azar", () => {
  for (const f of ["src/domain/packs/atmosphere.ts", "src/components/packs/RevealAtmosphere.tsx", "src/components/packs/RevealSpotlight.tsx", "src/components/packs/RestReveal.tsx", "src/components/packs/HeroReveal.tsx"]) {
    const s = read(f);
    for (const banned of [/useGameStore\(|useGameStore\.getState/, /lib\/game\/sync/, /openPackOutcome/, /\bfetch\(/, /\/api\//, /Math\.random/, /credits|price/]) assert.ok(!banned.test(s), `${f}: ${banned}`);
  }
});
