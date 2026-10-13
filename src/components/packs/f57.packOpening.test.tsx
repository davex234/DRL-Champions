/**
 * FASE 57 · PACK OPENING 5.0 — la ceremonia nueva sobre la MISMA autoridad (servidor decide, reducer presenta).
 *
 * Máquina de estados (gesto por carta, saltar, abrir otro, error antes del resultado), número dinámico de cartas,
 * arte del sobre por `packArtwork`, CardArt canónico sin envoltorios visuales, dorso de silueta, rareza y momento
 * máximo desde el resultado real, movimiento reducido, tamaño del sobre por ventana y ausencia de azar/economía.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { CARDS, getCard, getPlayer } from "@/data/catalog";
import { PACKS } from "@/data/packs";
import { packArtwork, PACK_ART_AVAILABLE } from "@/data/packArtwork";
import { getVariant } from "@/domain/cards/variants";
import {
  INITIAL_REVEAL, revealReducer, buildRevealPlan, hasResult, type RevealState, type RevealEvent,
} from "@/domain/packs/reveal";
import type { OpenedResult } from "@/store/useGameStore";
import { SealedPack, tornEdge } from "./SealedPack";
import { CardBack } from "./CardBack";
import { PackHand } from "./PackHand";
import { CardReveal } from "./CardReveal";
import { ceremonyPackWidth, RUPTURE_MS, RUPTURE_REDUCED_MS, OPENING_BEATS } from "./PackStage";
import { LEGEND, COMMON, RARE, MIXED, ICON3, single } from "@/app/design-system/fase57/fixtures";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const CAT = { cards: CARDS, getCard, getPlayer };
const run = (events: RevealEvent[], from: RevealState = INITIAL_REVEAL) => events.reduce(revealReducer, from);
const opened = (n: number): RevealState => run([{ type: "OPEN_REQUESTED" }, { type: "OPEN_SUCCEEDED", count: n, repeated: false }]);

const STAGE = read("src/components/packs/PackStage.tsx");
const REVEAL = read("src/components/packs/CardReveal.tsx");
const BACK = read("src/components/packs/CardBack.tsx");
const SEALED = read("src/components/packs/SealedPack.tsx");
const EXP = read("src/components/packs/PackOpeningExperience.tsx");

/* ═══════════════════ autoridad: el servidor decide, la ceremonia presenta ═══════════════════ */

test("A1 · un gesto = una petición: el doble clic / Enter repetido no pide dos aperturas", () => {
  const s = run([{ type: "OPEN_REQUESTED" }, { type: "OPEN_REQUESTED" }, { type: "OPEN_REQUESTED" }]);
  assert.equal(s.requests, 1);
  assert.equal(s.phase, "requesting");
  assert.ok(EXP.includes("if (opened.current) return;\n    opened.current = true;"), "pestillo antes de la petición");
});

test("A2 · error ANTES del resultado: ninguna carta, ninguna ceremonia de éxito, reintento con la misma clave", () => {
  const s = run([{ type: "OPEN_REQUESTED" }, { type: "OPEN_FAILED", failure: { kind: "NETWORK", title: "x", message: "y", retrySameKey: true } }]);
  assert.equal(s.phase, "error"); assert.equal(s.count, 0); assert.equal(hasResult(s), false);
  assert.equal(revealReducer(s, { type: "SKIP" }).phase, "error", "sin resultado no se salta a un resumen");
  assert.ok(EXP.includes("if (phase === \"error\" && state.failure) {"), "el error se pinta antes del escenario");
});

test("A3 · la animación no toca el resultado: el plan conserva el ORDEN y las cartas autoritativas, con y sin movimiento", () => {
  const a = buildRevealPlan(MIXED.opened, MIXED.before, CAT, { reduced: false });
  const b = buildRevealPlan(MIXED.opened, MIXED.before, CAT, { reduced: true });
  assert.deepEqual(a.items.map((i) => i.uid), MIXED.opened.map((o) => o.uid));
  assert.deepEqual(a.items.map((i) => i.cardId), b.items.map((i) => i.cardId));
  assert.deepEqual(a.items.map((i) => i.rarity), b.items.map((i) => i.rarity));
  for (const src of [STAGE, REVEAL, BACK, SEALED, EXP]) assert.ok(!/Math\.random|makeRng|PackEngine|weights|odds|\.price\b|app_grant/.test(code(src)), "sin azar ni economía en la ceremonia");
});

test("A4 · la ceremonia sigue pidiendo UNA apertura al servidor y guarda el resultado antes de animar", () => {
  assert.ok(EXP.includes("const out = await openPackOutcome(packId);"));
  // Walkout 0.5 · el éxito lleva además el ritmo de los walkouts (`ceremonyFlow`, solo presentación del resultado YA guardado)
  const success = 'dispatch({ type: "OPEN_SUCCEEDED", count: res.length, repeated, cinematic: heroIsPresentable(res), ...ceremonyFlow(res) });';
  assert.ok(EXP.includes(success), "la ceremonia arranca con el resultado recibido");
  assert.ok(EXP.indexOf("saveOpenReveal(packId, res);") < EXP.indexOf(success), "el resultado se guarda antes de la ceremonia");
});

/* ═══════════════════ revelado: gesto por carta, saltar, revelar todas ═══════════════════ */

test("R1 · F81: la cinemática es intro → tensión → HERO → hero quieta → resto → resumen (sin carta a carta)", () => {
  let s = opened(3);
  const seen = [s.phase];
  for (const type of ["INTRO_DONE", "BUILDUP_DONE", "HERO_SHOWN", "CONTINUE", "REST_DONE"] as const) { s = revealReducer(s, { type }); seen.push(s.phase); }
  assert.deepEqual(seen, ["opening", "buildup", "hero", "hero_hold", "rest", "summary"]);
  assert.ok(!code(EXP).includes("<CardReveal"), "la experiencia ya no revela carta a carta");
  assert.ok(code(EXP).includes("<HeroReveal") && code(EXP).includes("<RestReveal"));
});

test("R2 · F81: un toque avanza un paso y nunca se salta la hero; CONTINUAR solo con la hero quieta", () => {
  assert.equal(revealReducer(opened(4), { type: "ADVANCE" }).phase, "hero");
  const hold = run([{ type: "INTRO_DONE" }, { type: "BUILDUP_DONE" }, { type: "HERO_SHOWN" }], opened(4));
  const rest = revealReducer(hold, { type: "CONTINUE" });
  assert.equal(rest.phase, "rest");
  assert.equal(revealReducer(rest, { type: "CONTINUE" }), rest, "doble clic en CONTINUAR: nada");
});

test("R3 · OMITIR desde la intro, la tensión, la hero o el resto → resumen de las MISMAS cartas, sin pedir nada", () => {
  for (const pre of [[], [{ type: "INTRO_DONE" }], [{ type: "INTRO_DONE" }, { type: "BUILDUP_DONE" }], [{ type: "INTRO_DONE" }, { type: "BUILDUP_DONE" }, { type: "HERO_SHOWN" }, { type: "CONTINUE" }]] as RevealEvent[][]) {
    const s = run([...pre, { type: "SKIP" }], opened(5));
    assert.deepEqual([s.phase, s.count, s.requests, s.skipped], ["summary", 5, 1, true]);
  }
  assert.ok(EXP.includes("const showSkip = hasResult(state) && phase !== \"summary\";"), "Omitir visible desde que existe el resultado");
  assert.ok(!/openPackOutcome/.test(EXP.slice(EXP.indexOf("const skipToSummary"), EXP.indexOf("const openAnother"))), "saltar no llama al servidor");
});

test("R4 · ABRIR OTRO = otra operación: solo desde el resumen, reinicia el pestillo y cuenta una petición más", () => {
  const s = run([{ type: "SKIP" }], opened(5));
  const again = revealReducer(s, { type: "RESET" });
  assert.equal(again.phase, "ready"); assert.equal(again.requests, 1);
  const s2 = revealReducer(again, { type: "OPEN_REQUESTED" });
  assert.equal(s2.requests, 2, "exactamente una petición más");
  assert.deepEqual(revealReducer(opened(5), { type: "RESET" }).phase, "opening", "a mitad de ceremonia no se reinicia");
  const oa = EXP.slice(EXP.indexOf("const openAnother"), EXP.indexOf("RECUPERACIÓN TRAS RECARGA"));
  assert.ok(oa.includes("opened.current = false;") && oa.includes("clearOpenReveal();") && oa.includes('dispatch({ type: "RESET" });'));
});

test("R5 · recarga con el resultado ya guardado → resumen directo, sin volver a abrir", () => {
  const s = run([{ type: "RECOVERED", count: 4 }]);
  assert.deepEqual([s.phase, s.count, s.requests, s.recovered], ["summary", 4, 0, true]);
  const rec = EXP.slice(EXP.indexOf("RECUPERACIÓN TRAS RECARGA"), EXP.indexOf("Fase 38 · recarga con la petición ENVIADA"));
  assert.ok(rec.includes("opened.current = true;") && !rec.includes("openPackOutcome"), "recuperar no abre");
});

/* ═══════════════════ número dinámico, arte del sobre, dorso ═══════════════════ */

test("D1 · tantas cartas como trae el resultado (1…6), no un 5 fijo", () => {
  for (const n of [1, 3, 4, 5, 6]) {
    const h = html(<PackHand slots={Array.from({ length: n }, () => ({ revealed: false }))} accent="#19e3ff" mode="hand" />);
    assert.equal((h.match(/data-card-back/g) ?? []).length, n, `${n}`);
  }
  assert.ok(new Set(PACKS.map((p) => p.cardCount)).size > 1);
});

test("D2 · el sobre de la ceremonia es SU arte (packArtwork) para todos los sobres con arte; sin arte, el dibujado", () => {
  for (const p of PACKS) {
    const h = html(<SealedPack pack={p} cutProgress={0} width={260} ceremony />);
    const art = packArtwork(p.id);
    if (PACK_ART_AVAILABLE.has(p.id)) assert.ok(art && h.includes(`src="${art}"`) && h.includes("data-pack-art"), p.id);
    else assert.ok(!h.includes("data-pack-art"), `${p.id} sin arte se dibuja`);
  }
  for (const src of [STAGE, REVEAL, BACK, SEALED]) assert.ok(!/["'`]\/packs\/pack-|\.webp["'`]/.test(code(src).replace(/packArt\w*/g, "")), "ninguna ruta de arte escrita a mano");
});

test("D3 · el sobre ES el asset: en ceremonia sin caja ni sombra rectangular; al rasgar, borde dentado sobre la imagen", () => {
  const icon = PACKS.find((p) => p.id === "icon")!;
  const h = html(<SealedPack pack={icon} cutProgress={0} width={260} ceremony />);
  const body = h.slice(h.indexOf("data-pack-body"), h.indexOf("data-pack-art"));
  assert.ok(!/shadow-card|nx-clip/.test(body), "sin caja");
  assert.ok(/drop-shadow/.test(body), "profundidad por drop-shadow");
  const torn = html(<SealedPack pack={icon} cutProgress={0} width={260} ceremony torn />);
  assert.ok(torn.includes("data-pack-mouth"), "sale luz de la boca");
  assert.match(tornEdge(17.5), /^polygon\(0\.00% 17\.50%/);
  assert.equal(tornEdge(17.5), tornEdge(17.5), "determinista");
  const tienda = html(<SealedPack pack={icon} cutProgress={0} width={120} />);
  assert.ok(tienda.includes("shadow-card"), "la tienda no cambia");
});

test("D4 · el dorso es una silueta de carta: proporción 5/7, sigilo NEXUS, luz por drop-shadow, sin borde ni box-shadow", () => {
  const h = html(<CardBack accent="#ffd35c" className="w-[92px]" />);
  assert.match(h, /aspect-\[5\/7\]/); assert.match(h, /M50 10 L84 30/); assert.match(h, /drop-shadow/);
  assert.ok(!/box-shadow|border-2|shadow-card|nx-clip/.test(h), "sin caja");
  assert.match(h, /NEXUS/, "marca propia, sin terceros");
  const carga = html(<CardBack accent="#ffd35c" charged={1} chargeColor="#ff2e63" className="w-[92px]" />);
  assert.match(carga, /#ff2e63/);
});

/* ═══════════════════ la carta: CardArt, rareza real, momento máximo ═══════════════════ */

function reveal(card = LEGEND, o: { revealed?: boolean; armed?: boolean; reduced?: boolean } = {}) {
  const plan = buildRevealPlan(single(card).opened, single(card).before, CAT);
  const it = plan.items[0];
  const r = { uid: it.uid, card: it.card, serial: undefined, isNew: true, value: 0 } as OpenedResult;
  return html(<CardReveal result={r} item={it} index={0} total={1} isLast onNext={() => {}} revealed={o.revealed ?? false} armed={o.armed ?? false} onShown={() => {}} reducedOverride={o.reduced ?? false} />);
}

test("C1 · boca abajo en reposo: invita al gesto y NO filtra la carta (cara oculta, sin rareza)", () => {
  const h = reveal(LEGEND);
  assert.match(h, /data-armed="false"/); assert.match(h, /data-testid="reveal-prompt"/);
  assert.match(h, /aria-hidden="true" data-face="front"/);
  assert.ok(!/reveal-herald|reveal-energy/.test(h), "sin heraldo ni energía antes del gesto");
});

test("C2 · anticipación según la rareza REAL: energía solo en las altas; la común no la tiene", () => {
  assert.match(reveal(LEGEND, { armed: true }), /data-testid="reveal-energy"/);
  assert.ok(!/reveal-energy/.test(reveal(COMMON, { armed: true })));
  assert.ok(!/reveal-energy/.test(reveal(LEGEND, { armed: true, reduced: true })), "movimiento reducido: sin energía");
});

test("C3 · momento máximo solo para legendaria/serial #1 revelada; destello contenido, y luz quieta con movimiento reducido", () => {
  assert.match(reveal(LEGEND, { revealed: true, armed: true }), /data-testid="reveal-max-flash"/);
  assert.ok(!/reveal-max-flash|reveal-max-glow/.test(reveal(RARE, { revealed: true, armed: true })));
  const red = reveal(LEGEND, { revealed: true, armed: true, reduced: true });
  assert.ok(!/reveal-max-flash/.test(red) && /reveal-max-glow/.test(red), "reducido: sin destello, con luz dorada quieta");
  const flash = REVEAL.slice(REVEAL.indexOf("EL MOMENTO MÁXIMO"), REVEAL.indexOf("ONDA DE CHOQUE"));
  assert.ok(/opacity: \[0, 0\.9, 0\]/.test(flash) && /duration: 0\.7/.test(flash) && !/inset-0/.test(flash), "breve y en la zona de la carta, no pantalla completa");
  assert.ok(!/Demon1|demon1|"icon__/.test(code(REVEAL)), "nada de cartas cableadas");
});

test("C4 · la cara revelada es el CardArt del ejemplar, sin caja, borde ni fondo alrededor", () => {
  const h = reveal(LEGEND, { revealed: true, armed: true });
  assert.match(h, /aria-hidden="false" data-face="front"/);
  assert.match(h, /nx-card-art|data-card-art-wrap|<img/);
  const front = REVEAL.slice(REVEAL.indexOf('data-face="front"') - 200, REVEAL.indexOf("</CardVisual>"));
  assert.ok(!/border|boxShadow|shadow-card|bg-|rounded/.test(front), "sin envoltorio visual alrededor del asset");
  assert.ok(REVEAL.includes("<CardVisual uid={result.uid}") && REVEAL.includes("<PlayerCard card={result.card}"));
});

test("C5 · nueva / duplicada vienen del plan (colección de ANTES), no de la animación", () => {
  const plan = buildRevealPlan(MIXED.opened, MIXED.before, CAT);
  assert.equal(plan.items[0].status, "duplicate");
  const it = plan.items[0];
  const r = { uid: it.uid, card: it.card, isNew: false, value: 0 } as OpenedResult;
  const h = html(<CardReveal result={r} item={it} index={0} total={5} onNext={() => {}} revealed armed onShown={() => {}} />);
  assert.match(h, /data-badge="duplicate"/); assert.match(h, /Duplicada · ×/);
});

/* ═══════════════════ escena: ritmo, movimiento reducido, tamaño ═══════════════════ */

test("M1 · el acto de apertura mantiene el orden (tensión → rasgado → cartas → fuera), también con movimiento reducido", () => {
  assert.ok(OPENING_BEATS.tear < OPENING_BEATS.emerge && OPENING_BEATS.emerge < OPENING_BEATS.packOut);
  assert.ok(RUPTURE_MS >= 1500 && RUPTURE_MS <= 2600, "premium pero sin hacer esperar");
  assert.ok(EXP.includes("reduced ? RUPTURE_REDUCED_MS : RUPTURE_MS"));
  assert.ok(STAGE.includes("{!reduced && <ParticleBurst"), "sin partículas con movimiento reducido");
  assert.ok(STAGE.includes("reduced ? { x: dir * 14, y: -10, rotate: 0, opacity: 0 }"), "mitades sin vuelo ni giro con movimiento reducido");
});

/*
 * FASE 57.1 · CAUSA RAÍZ DEL «NO HA CAMBIADO». En Windows con «efectos de animación» apagados, Chrome informa
 * `prefers-reduced-motion: reduce` a TODAS las páginas. F57 respetaba esa preferencia quitando casi todo: apertura de
 * 0,42 s, sin mitades, cartas por fundido de 0,2 s, giro de 0,12 s y anticipación de 0,18 s — visualmente, la apertura
 * anterior. Estos contratos impiden volver a eso: el modo reducido quita movimiento, NO la ceremonia.
 */
test("M1b · movimiento reducido = misma ceremonia legible: cada acto dura lo bastante para verse", () => {
  assert.ok(RUPTURE_REDUCED_MS >= 1200 && RUPTURE_REDUCED_MS < RUPTURE_MS, "el acto de apertura se ve (≥ 1,2 s) y es más corto que el completo");
  const beats = { tear: RUPTURE_REDUCED_MS * OPENING_BEATS.tear, emerge: RUPTURE_REDUCED_MS * OPENING_BEATS.emerge };
  assert.ok(beats.tear >= 400 && beats.emerge - beats.tear >= 200, "sellado → rasgado → cartas, con pausa entre actos");
  const hand = read("src/components/packs/PackHand.tsx");
  assert.ok(hand.includes("{ initial: { opacity: 0, y: 40 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.45, delay: i * 0.12"), "las cartas salen de una en una");
  assert.ok(REVEAL.includes("Math.min(900, 350 +"), "anticipación reducida de 0,35 a 0,9 s según rareza, no 0,18 s");
  assert.ok(!/reduced \? 0\.12/.test(code(REVEAL)), "sin giro instantáneo de 0,12 s");
  assert.ok(REVEAL.includes('opacity: revealed ? 1 : 0, transition: "opacity 0.4s ease 0.1s"'), "sin giro 3D: la cara entra con un fundido");
  assert.ok(STAGE.includes("? { opacity: [1, 1, 1, 0], y: [-10, -10, -10, 30], scale: 1 }"), "el sobre se desvanece al final del acto");
});

test("M2 · el sobre ocupa ~la mitad de la altura útil y nunca se sale del ancho (390 → 1920)", () => {
  for (const [w, h] of [[390, 844], [768, 1024], [1024, 768], [1366, 768], [1440, 900], [1920, 1080]]) {
    const pw = ceremonyPackWidth(w, h);
    const ph = pw * (380 / 260);
    assert.ok(pw <= w * 0.66 + 1, `${w}: ancho`);
    assert.ok(ph <= h * 0.5 + 1, `${w}: alto ≤ 50 %`);
    assert.ok(ph >= Math.min(h * 0.38, 170 * (380 / 260)) - 1, `${w}: presencia`);
  }
});

test("M3 · el tema sale del sobre (acento del catálogo): ninguna tabla de colores por pack en la ceremonia", () => {
  for (const src of [STAGE, BACK]) assert.ok(!/icon:\s*["']#|oro:\s*["']#|estandar:\s*["']#/.test(src));
  assert.ok(STAGE.includes('const accent = pack.accent ?? "#ff2e63";'));
  assert.ok(CARDS.length === 331 || CARDS.length >= 331, "catálogo intacto");
  assert.ok(getVariant(LEGEND.variantId).palette.primary.startsWith("#"));
  assert.equal(ICON3.opened.length, PACKS.find((p) => p.id === "icon")!.cardCount, "el arnés del Icon usa sus 3 cartas (Fase 57.4)");
});
