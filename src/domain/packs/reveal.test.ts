/**
 * FASE 38 · LA REVELACIÓN — plan, resumen, máquina de estados de presentación y fallos. Catálogo REAL; las copias de
 * estas pruebas son sintéticas (uids `u-…`). Nada de aquí sortea: se presenta un resultado dado.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CARDS, getCard, getPlayer } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";
import type { CardDef } from "@/domain/cards/types";
import { BUCKET_LABEL, cardHref, completionPct, rarityOf, teamKeyOf, type OwnedInstanceFact } from "@/domain/collection/room";
import type { RarityBucket } from "@/domain/packs/types";
import {
  FEATURED_CRITERION, INITIAL_REVEAL, MAX_SET_DELTAS, PRESTIGE_EXTRA_MS, REDUCED_HOLD_MS, REVEAL_HOLD_MS,
  beforeExcluding, buildRevealPlan, canOpen, classifyOpenFailure, hasResult, revealReducer, type OpenedInstance, type RevealState,
} from "./reveal";
import { qaSerializedCard } from "@/app/design-system/serialFixture";
// ANTES de cualquier captura de `CARDS`: la carta de QA se da de alta y todo el proceso ve el mismo catálogo.
const SERIALIZED = qaSerializedCard() /* catálogo diseñado sin serializadas: carta local de QA */;

const CAT = { cards: CARDS, getCard, getPlayer };
const of = (r: RarityBucket) => CARDS.find((c) => rarityOf(c) === r)!;
/** Carta de esa rareza de un jugador que no esté entre los excluidos (para no crear «variantes» sin querer). */
const ofOther = (r: RarityBucket, ...exclude: CardDef[]) => CARDS.find((c) => rarityOf(c) === r && !exclude.some((e) => e.playerId === c.playerId))!;
const ofAll = (r: RarityBucket) => CARDS.filter((c) => rarityOf(c) === r);
let n = 0;
const op = (c: CardDef, serial: number | null = null): OpenedInstance => ({ uid: `u-open-${++n}`, cardId: c.id, serial, mintedVersion: 1 });
const own = (c: CardDef, serial: number | null = null): OwnedInstanceFact => ({ uid: `u-own-${++n}`, cardId: c.id, serial, mintedVersion: 1 });
const MULTI = (() => {
  const by = new Map<string, CardDef[]>();
  for (const c of CARDS) by.set(c.playerId, [...(by.get(c.playerId) ?? []), c]);
  return [...by.values()].find((v) => v.length >= 3)!;
})();
const plan = (opened: OpenedInstance[], before: OwnedInstanceFact[] | null = [], reduced = false) => buildRevealPlan(opened, before, CAT, { reduced });

/* ───────────── plan · autoridad ───────────── */

test("PLAN · conserva el ORDEN autoritativo del servidor (no reordena por rareza)", () => {
  const opened = [op(of("legendary")), op(of("common")), op(of("rare"))];
  assert.deepEqual(plan(opened).items.map((i) => i.cardId), opened.map((o) => o.cardId));
});

test("PLAN · cada carta es EXACTAMENTE su instancia: uid ↔ carta ↔ serial ↔ versión", () => {
  const opened = [op(SERIALIZED, 42), op(of("common")), op(of("uncommon"))];
  const items = plan(opened).items;
  items.forEach((it, i) => {
    assert.equal(it.uid, opened[i].uid);
    assert.equal(it.cardId, opened[i].cardId);
    assert.equal(it.card.id, opened[i].cardId);
    assert.equal(it.serial, opened[i].serial);
    assert.equal(it.mintedVersion, 1);
  });
});

test("PLAN · una carta fuera del catálogo vivo no se inventa: se cuenta aparte", () => {
  const p = plan([op(of("common")), { uid: "u-x", cardId: "nadie__gold", serial: null, mintedVersion: 1 }]);
  assert.equal(p.items.length, 1);
  assert.equal(p.summary.unresolved, 1);
  assert.equal(p.summary.total, 1);
});

test("PLAN · sin resultado no hay nada que presentar", () => {
  const p = plan([]);
  assert.equal(p.items.length, 0);
  assert.equal(p.summary.featured, null);
  assert.equal(p.summary.bestRarity, null);
});

/* ───────────── rarezas ───────────── */

for (const [r, moment] of [["common", "quick"], ["uncommon", "presence"], ["rare", "impact"], ["epic", "strong"], ["legendary", "max"]] as const) {
  test(`RAREZA · ${r}: etiqueta real del catálogo y momento «${moment}»`, () => {
    const it = plan([op(of(r))]).items[0];
    assert.equal(it.rarity, r);
    assert.equal(it.rarityLabel, BUCKET_LABEL[r]);
    assert.equal(it.moment, moment);
  });
}

test("RAREZA · solo desde «rara» se canta; común y poco común no anuncian nada", () => {
  const items = plan([op(of("common")), op(of("uncommon")), op(of("rare")), op(of("epic")), op(of("legendary"))]).items;
  assert.deepEqual(items.map((i) => i.herald), ["", "", BUCKET_LABEL.rare, BUCKET_LABEL.epic, BUCKET_LABEL.legendary]);
});

test("RAREZA · sin niveles inventados: toda carta cae en uno de los cinco del catálogo", () => {
  const items = plan(CARDS.slice(0, 120).map((c) => op(c))).items;
  for (const it of items) assert.ok(["common", "uncommon", "rare", "epic", "legendary"].includes(it.rarity));
});

test("RITMO · la anticipación crece con la rareza (común < poco común < rara < épica < legendaria)", () => {
  const order: RarityBucket[] = ["common", "uncommon", "rare", "epic", "legendary"];
  const holds = order.map((r) => plan([op(of(r))]).items[0].holdMs);
  for (let i = 1; i < holds.length; i++) assert.ok(holds[i] > holds[i - 1], `${order[i]} > ${order[i - 1]}`);
});

test("RITMO · un sobre de cinco comunes no es un peaje: ≤ 2 s de anticipación en total", () => {
  const total = plan(ofAll("common").slice(0, 5).map((c) => op(c))).items.reduce((s, i) => s + i.holdMs, 0);
  assert.ok(total <= 2000, String(total));
  assert.equal(REVEAL_HOLD_MS.common, 320);
});

test("RITMO · con movimiento reducido todas giran casi al instante", () => {
  for (const it of plan([op(of("common")), op(of("legendary")), op(SERIALIZED, 1)], [], true).items) assert.equal(it.holdMs, REDUCED_HOLD_MS);
});

/* ───────────── nueva / duplicada / variante ───────────── */

test("NUEVA · definición sin copias antes de abrir → nueva, ×1", () => {
  const it = plan([op(of("rare"))], []).items[0];
  assert.equal(it.status, "new");
  assert.equal(it.copiesAfter, 1);
  assert.equal(it.newVariant, false);
});

test("DUPLICADA · definición ya poseída → duplicada con el total DESPUÉS de esta copia", () => {
  const c = of("common");
  const it = plan([op(c)], [own(c), own(c)]).items[0];
  assert.equal(it.status, "duplicate");
  assert.equal(it.copiesAfter, 3);
});

test("MISMA CARTA DOS VECES · la primera NUEVA, la segunda DUPLICADA ×2 (nunca dos «nuevas»)", () => {
  const c = of("uncommon");
  const items = plan([op(c), op(c)], []).items;
  assert.deepEqual(items.map((i) => i.status), ["new", "duplicate"]);
  assert.deepEqual(items.map((i) => i.copiesAfter), [1, 2]);
});

test("MISMA CARTA YA POSEÍDA DOS VECES · duplicada ×(n+1) y ×(n+2)", () => {
  const c = of("common");
  const items = plan([op(c), op(c)], [own(c)]).items;
  assert.deepEqual(items.map((i) => i.copiesAfter), [2, 3]);
  assert.ok(items.every((i) => i.status === "duplicate"));
});

test("NUEVA VARIANTE · jugador que ya tenías con otra definición → nueva en tu colección y nueva variante", () => {
  const [a, b] = MULTI;
  const it = plan([op(b)], [own(a)]).items[0];
  assert.equal(it.status, "new");
  assert.equal(it.newVariant, true);
  assert.match(it.announcement, /Nueva variante en tu colección/);
});

test("NUEVA VARIANTE · dos definiciones del mismo jugador en el mismo sobre: la segunda es variante", () => {
  const [a, b] = MULTI;
  const items = plan([op(a), op(b)], []).items;
  assert.deepEqual(items.map((i) => [i.status, i.newVariant]), [["new", false], ["new", true]]);
});

test("COPIAS vs VARIANTES · una copia más de la misma definición no es «nueva variante»", () => {
  const [a] = MULTI;
  assert.equal(plan([op(a)], [own(a)]).items[0].newVariant, false);
});

test("SIN FOTO PREVIA · no se afirma nada: estado desconocido, sin ×N ni progreso", () => {
  const p = plan([op(of("rare"))], null);
  assert.equal(p.items[0].status, "unknown");
  assert.equal(p.items[0].copiesAfter, null);
  assert.equal(p.summary.newCount, null);
  assert.equal(p.summary.collection, null);
  assert.equal(p.summary.firstLegendary, null);
  assert.ok(!/Nueva|Duplicada/.test(p.items[0].announcement));
});

test("FOTO TOMADA TRAS SINCRONIZAR · las instancias de ESTA apertura no cuentan como «antes»", () => {
  const c = of("epic");
  const o = op(c);
  const p = plan([o], [{ uid: o.uid, cardId: c.id, serial: null, mintedVersion: 1 }]);
  assert.equal(p.items[0].status, "new");
  assert.equal(p.summary.collection!.gainedUnique, 1);
});

test("RECUPERACIÓN · `beforeExcluding` quita exactamente las instancias abiertas", () => {
  const c = of("common");
  const keep = own(c); const o = op(c);
  assert.deepEqual(beforeExcluding([keep, { uid: o.uid, cardId: c.id, serial: null, mintedVersion: 1 }], [o]), [keep]);
});

test("NO obtained_at · el dominio de la revelación no conoce fechas de obtención", () => {
  const src = readFileSync(join(process.cwd(), "src/domain/packs/reveal.ts"), "utf8");
  assert.ok(!/obtained|obtainedAt|Date\.now|Math\.random|openPack|PackEngine|weights|pity/.test(src.replace(/\/\*[\s\S]*?\*\//g, "")));
});

/* ───────────── seriales ───────────── */

const limit = getVariant(SERIALIZED.variantId).serialLimit;

test("SERIAL · sin serial: sin texto ni prestigio", () => {
  const it = plan([op(of("common"))]).items[0];
  assert.equal(it.serialText, null);
  assert.equal(it.prestige, null);
});

test("SERIAL · normal: formato canónico #N/LÍMITE y sin prestigio", () => {
  const s = Math.min(limit ?? 500, 250);
  const it = plan([op(SERIALIZED, s)]).items[0];
  assert.equal(it.serialText, `#${s}/${limit}`);
  assert.equal(it.prestige, null);
});

for (const [serial, tier, label] of [[88, "TOP_100", "Top 100"], [7, "TOP_10", "Top 10"], [1, "NUMBER_ONE", "#1"]] as const) {
  test(`SERIAL · #${serial} → ${label} (prestigio visual)`, () => {
    const it = plan([op(SERIALIZED, serial)]).items[0];
    assert.equal(it.prestige?.tier, tier);
    assert.equal(it.prestige?.label, label);
  });
}

test("SERIAL #1 · momento propio: heraldo «Serial #1» y pausa extra", () => {
  const one = plan([op(SERIALIZED, 1)]).items[0];
  const plain = plan([op(SERIALIZED, 400)]).items[0];
  assert.equal(one.herald, "Serial #1");
  assert.equal(one.holdMs - plain.holdMs, PRESTIGE_EXTRA_MS.NUMBER_ONE);
});

test("SERIAL · no cambia la carta: OVR y stats de combate son los del catálogo con cualquier serial", () => {
  for (const s of [1, 7, 88, 300]) {
    const it = plan([op(SERIALIZED, s)]).items[0];
    assert.equal(it.card.ovr, getCard(SERIALIZED.id)!.ovr);
    assert.deepEqual(it.card.combat, getCard(SERIALIZED.id)!.combat);
  }
});

/* ───────────── accesibilidad y enlaces ───────────── */

test("LECTOR · «Carta 2 de 3. Jugador. Rareza. OVR N. Nueva en tu colección.»", () => {
  const c = of("rare");
  const common = ofOther("common", c);
  const it = plan([op(common), op(c), op(ofOther("uncommon", c, common))]).items[1];
  assert.equal(it.announcement, `Carta 2 de 3. ${getPlayer(c.playerId)!.nick}. ${BUCKET_LABEL.rare}. OVR ${c.ovr}. Nueva en tu colección.`);
});

test("LECTOR · duplicada y serial se dicen en texto", () => {
  const it = plan([op(SERIALIZED, 7)], [own(SERIALIZED, 90), own(SERIALIZED, 91)]).items[0];
  assert.match(it.announcement, new RegExp(`Serial #7/${limit}\\.`));
  assert.match(it.announcement, /Duplicada, ahora tienes 3\./);
});

test("ENLACE · cada carta lleva a su ficha real de Colección", () => {
  const c = of("epic");
  assert.equal(plan([op(c)]).items[0].href, cardHref(c.id));
});

/* ───────────── resumen ───────────── */

test("RESUMEN · recuentos exactos (nuevas, duplicadas, variantes)", () => {
  const [a, b] = MULTI; const d = ofOther("common", a);
  const s = plan([op(d), op(b), op(ofOther("rare", a, d)), op(d)], [own(a), own(d)]).summary;
  assert.equal(s.total, 4);
  assert.equal(s.newCount, 2);
  assert.equal(s.duplicateCount, 2);
  assert.equal(s.newVariantCount, 1);
});

test("RESUMEN · todas duplicadas: 30 → 30 sin fingir progreso, copias sí suben", () => {
  const cs = ofAll("common").slice(0, 5);
  const before = [...cs.map((c) => own(c)), ...ofAll("uncommon").slice(0, 25).map((c) => own(c))];
  const col = plan(cs.map((c) => op(c)), before).summary.collection!;
  assert.equal(col.uniqueBefore, 30);
  assert.equal(col.uniqueAfter, 30);
  assert.equal(col.gainedUnique, 0);
  assert.equal(col.copiesAfter - col.copiesBefore, 5);
  assert.equal(col.pctAfter, col.pctBefore);
});

test("RESUMEN · todas nuevas: +N definiciones exactas", () => {
  const col = plan(ofAll("uncommon").slice(0, 5).map((c) => op(c)), ofAll("common").slice(0, 30).map((c) => own(c))).summary.collection!;
  assert.deepEqual([col.uniqueBefore, col.uniqueAfter, col.gainedUnique], [30, 35, 5]);
});

test("RESUMEN · mezcla: el delta es el de las definiciones realmente nuevas", () => {
  const [c1, c2, c3] = ofAll("common");
  const col = plan([op(c1), op(c2), op(c2), op(c3)], [own(c1)]).summary.collection!;
  assert.equal(col.gainedUnique, 2);
  assert.equal(col.copiesAfter - col.copiesBefore, 4);
});

test("RESUMEN · % de colección calculado igual que Collection (definiciones, no copias)", () => {
  const before = ofAll("common").slice(0, 30).map((c) => own(c));
  const col = plan([op(of("legendary"))], before).summary.collection!;
  assert.equal(col.catalogTotal, CARDS.length);
  assert.equal(col.pctBefore, completionPct(30, CARDS.length));
  assert.equal(col.pctAfter, completionPct(31, CARDS.length));
});

test("RESUMEN · mejor rareza exacta", () => {
  assert.equal(plan([op(of("common")), op(of("epic")), op(of("rare"))]).summary.bestRarity, "epic");
});

test("DESTACADA (F81) · es la HERO: mayor OVR, nunca la rareza; criterio explícito", () => {
  const epics = ofAll("epic").sort((a, b) => b.ovr - a.ovr);
  const p = plan([op(epics[epics.length - 1]), op(epics[0])]);
  assert.equal(p.summary.featured!.cardId, epics[0].id);
  assert.equal(p.summary.featuredCriterion, FEATURED_CRITERION);
  assert.equal(p.summary.featured, p.hero.ok ? p.hero.hero : null, "la destacada y la hero son la misma instancia");
  // Una carta de MENOR rareza con MAYOR OVR es la hero (la rareza no decide).
  const lowHigh = CARDS.filter((c) => rarityOf(c) === "rare").sort((a, b) => b.ovr - a.ovr)[0];
  const highLow = CARDS.filter((c) => rarityOf(c) === "legendary" && c.ovr < lowHigh.ovr)[0];
  if (highLow) assert.equal(plan([op(highLow), op(lowHigh)]).summary.featured!.cardId, lowHigh.id);
});

test("DESTACADA (F81) · empate de OVR: una sola, fija para la apertura (no el serial)", () => {
  const a = op(SERIALIZED, 90), b = op(SERIALIZED, 12);
  const first = plan([a, b]).summary.featured!.uid;
  for (let i = 0; i < 20; i++) assert.equal(plan([a, b]).summary.featured!.uid, first);
  assert.ok([a.uid, b.uid].includes(first));
});

test("SERIAL DESTACADO · el de mayor prestigio; sin prestigio no hay destacado", () => {
  assert.equal(plan([op(SERIALIZED, 88), op(SERIALIZED, 7), op(SERIALIZED, 300)]).summary.serialHighlight!.serial, 7);
  assert.equal(plan([op(SERIALIZED, 300)]).summary.serialHighlight, null);
});

/* ───────────── sets ───────────── */

const TEAM = (() => {
  const by = new Map<string, CardDef[]>();
  for (const c of CARDS) { const k = teamKeyOf(getPlayer(c.playerId)!.team).key; by.set(k, [...(by.get(k) ?? []), c]); }
  return [...by.entries()].filter(([, v]) => v.length >= 6).sort((a, b) => a[1].length - b[1].length)[0];
})();

test("SETS · progreso exacto del equipo: X → X+1 / total", () => {
  const [key, cards] = TEAM;
  const s = plan([op(cards[3])], cards.slice(0, 3).map((c) => own(c))).summary;
  const team = s.sets.find((d) => d.kind === "team" && d.key === key)!;
  assert.deepEqual([team.before, team.after, team.total], [3, 4, cards.length]);
  assert.equal(team.completed, false);
});

test("SETS · como mucho 3 progresos (no es un panel)", () => {
  const s = plan(CARDS.slice(0, 5).map((c) => op(c)), []).summary;
  assert.ok(s.sets.length <= MAX_SET_DELTAS);
});

test("SETS · completar un set es un hecho: «completado» solo con esta apertura y sin recompensa en el tipo", () => {
  const [key, cards] = TEAM;
  const s = plan([op(cards[cards.length - 1])], cards.slice(0, -1).map((c) => own(c))).summary;
  const done = s.completedSets.find((d) => d.kind === "team" && d.key === key)!;
  assert.ok(done && done.after === done.total);
  assert.equal(s.sets[0].completed, true, "lo completado va primero");
  assert.ok(!Object.keys(done).some((k) => /reward|credit|xp|prize/i.test(k)));
});

test("SETS · una duplicada de un set ya completo no lo «completa» otra vez", () => {
  const [, cards] = TEAM;
  const s = plan([op(cards[0])], cards.map((c) => own(c))).summary;
  assert.equal(s.completedSets.length, 0);
});

test("PRIMERA LEGENDARIA · verdadero solo si antes había 0 definiciones legendarias", () => {
  assert.equal(plan([op(of("legendary"))], [own(of("common"))]).summary.firstLegendary, true);
  const [l1, l2] = ofAll("legendary");
  assert.equal(plan([op(l2)], [own(l1)]).summary.firstLegendary, false);
  assert.equal(plan([op(of("rare"))], []).summary.firstLegendary, false);
});

/* ───────────── máquina de estados de presentación ───────────── */

const run = (...events: Parameters<typeof revealReducer>[1][]) => events.reduce(revealReducer, INITIAL_REVEAL);
const fail = (kind: "NETWORK" | "NO_PACK" | "SERVER") => ({ type: "OPEN_FAILED" as const, failure: { ...classifyOpenFailure(""), kind } });

test("ESTADO · listo → pedir: una petición", () => {
  const s = run({ type: "OPEN_REQUESTED" });
  assert.equal(s.phase, "requesting");
  assert.equal(s.requests, 1);
});

test("ESTADO · doble clic: el segundo gesto no cambia nada (misma referencia)", () => {
  const once = run({ type: "OPEN_REQUESTED" });
  assert.equal(revealReducer(once, { type: "OPEN_REQUESTED" }), once);
  assert.equal(once.requests, 1);
});

test("ESTADO · no se puede pedir otra apertura durante la ceremonia", () => {
  const s = run({ type: "OPEN_REQUESTED" }, { type: "OPEN_SUCCEEDED", count: 5, repeated: false }, { type: "INTRO_DONE" }, { type: "BUILDUP_DONE" });
  assert.equal(revealReducer(s, { type: "OPEN_REQUESTED" }), s);
  assert.equal(canOpen(s), false);
});

test("ESTADO · error del servidor: sin revelado falso (no hay cartas ni fases de ceremonia)", () => {
  const s = run({ type: "OPEN_REQUESTED" }, fail("SERVER"));
  assert.equal(s.phase, "error");
  assert.equal(s.count, 0);
  for (const type of ["INTRO_DONE", "BUILDUP_DONE", "HERO_SHOWN", "ADVANCE", "CONTINUE", "REST_DONE", "SKIP"] as const) assert.equal(revealReducer(s, { type }), s, type);
  assert.equal(hasResult(s), false);
});

test("ESTADO · reintento tras error: vuelve a «listo» y permite una nueva petición", () => {
  const s = run({ type: "OPEN_REQUESTED" }, fail("NETWORK"), { type: "DISMISS_ERROR" }, { type: "OPEN_REQUESTED" });
  assert.equal(s.phase, "requesting");
  assert.equal(s.requests, 2);
});

test("ESTADO · sin sobre (otra pestaña lo abrió): estado propio, no un error fatal", () => {
  const s = run({ type: "OPEN_REQUESTED" }, fail("NO_PACK"));
  assert.equal(s.phase, "no_pack");
});

test("ESTADO · el revelado solo empieza con el resultado autoritativo recibido", () => {
  const waiting = run({ type: "OPEN_REQUESTED" });
  for (const type of ["INTRO_DONE", "ADVANCE", "SKIP"] as const) assert.equal(revealReducer(waiting, { type }), waiting, type);
  const s = revealReducer(waiting, { type: "OPEN_SUCCEEDED", count: 5, repeated: false });
  assert.deepEqual([s.phase, s.count], ["opening", 5]);
});

test("ESTADO · un «éxito» sin cartas no se celebra", () => {
  assert.equal(run({ type: "OPEN_REQUESTED" }, { type: "OPEN_SUCCEEDED", count: 0, repeated: false }).phase, "error");
});

test("ESTADO · respuesta repetida con resultado: se presenta y se marca", () => {
  const s = run({ type: "OPEN_REQUESTED" }, { type: "OPEN_SUCCEEDED", count: 5, repeated: true });
  assert.equal(s.repeated, true);
  assert.equal(s.phase, "opening");
});

test("F81 · flujo completo: intro → tensión → hero → hero quieta → resto → resumen", () => {
  const seen: string[] = [];
  let s: RevealState = run({ type: "OPEN_REQUESTED" }, { type: "OPEN_SUCCEEDED", count: 5, repeated: false });
  seen.push(s.phase);
  for (const type of ["INTRO_DONE", "BUILDUP_DONE", "HERO_SHOWN", "CONTINUE", "REST_DONE"] as const) { s = revealReducer(s, { type }); seen.push(s.phase); }
  assert.deepEqual(seen, ["opening", "buildup", "hero", "hero_hold", "rest", "summary"]);
  assert.deepEqual([s.count, s.requests, s.skipped], [5, 1, false]);
});

test("F81 · una sola carta: la hero ES el sobre (CONTINUAR → resumen, sin «resto»)", () => {
  const s = run({ type: "OPEN_REQUESTED" }, { type: "OPEN_SUCCEEDED", count: 1, repeated: false }, { type: "INTRO_DONE" }, { type: "BUILDUP_DONE" }, { type: "HERO_SHOWN" }, { type: "CONTINUE" });
  assert.equal(s.phase, "summary");
});

test("F81 · un toque AVANZA un paso y nunca se salta la hero", () => {
  const opening = run({ type: "OPEN_REQUESTED" }, { type: "OPEN_SUCCEEDED", count: 4, repeated: false });
  assert.equal(revealReducer(opening, { type: "ADVANCE" }).phase, "hero", "intro → hero (no al resumen)");
  const buildup = revealReducer(opening, { type: "INTRO_DONE" });
  assert.equal(revealReducer(buildup, { type: "ADVANCE" }).phase, "hero");
  const hero = revealReducer(buildup, { type: "BUILDUP_DONE" });
  assert.equal(revealReducer(hero, { type: "ADVANCE" }).phase, "hero_hold", "girando → quieta");
});

test("F81 · CONTINUAR solo con la hero quieta: un doble clic no encadena «resto → resumen»", () => {
  const hold = run({ type: "OPEN_REQUESTED" }, { type: "OPEN_SUCCEEDED", count: 5, repeated: false }, { type: "INTRO_DONE" }, { type: "BUILDUP_DONE" }, { type: "HERO_SHOWN" });
  const once = revealReducer(hold, { type: "CONTINUE" });
  assert.equal(once.phase, "rest");
  assert.equal(revealReducer(once, { type: "CONTINUE" }), once, "el segundo clic no hace nada");
  const opening = run({ type: "OPEN_REQUESTED" }, { type: "OPEN_SUCCEEDED", count: 5, repeated: false });
  assert.equal(revealReducer(opening, { type: "CONTINUE" }), opening);
  // Los relojes fuera de su fase no hacen nada (sin estados imposibles).
  assert.equal(revealReducer(hold, { type: "BUILDUP_DONE" }), hold);
  assert.equal(revealReducer(hold, { type: "INTRO_DONE" }), hold);
  assert.equal(revealReducer(once, { type: "HERO_SHOWN" }), once);
});

test("F81 · sin hero presentable (OVR inválido): sin cinemática, resumen directo y marcado", () => {
  const s = run({ type: "OPEN_REQUESTED" }, { type: "OPEN_SUCCEEDED", count: 5, repeated: false, cinematic: false });
  assert.deepEqual([s.phase, s.cinematic, s.count], ["summary", false, 5]);
});

test("SALTAR · desde cualquier momento con resultado va al resumen con el MISMO recuento", () => {
  const base = [{ type: "OPEN_REQUESTED" as const }, { type: "OPEN_SUCCEEDED" as const, count: 5, repeated: false }];
  const steps = [{ type: "INTRO_DONE" as const }, { type: "BUILDUP_DONE" as const }, { type: "HERO_SHOWN" as const }, { type: "CONTINUE" as const }];
  for (let k = 0; k <= steps.length; k++) {
    const s = run(...base, ...steps.slice(0, k), { type: "SKIP" });
    assert.deepEqual([s.phase, s.count, s.skipped, s.requests], ["summary", 5, true, 1], `tras ${k} pasos`);
  }
});

test("SALTAR · sin resultado no hay nada que saltar; en el resumen no hace nada", () => {
  assert.equal(revealReducer(INITIAL_REVEAL, { type: "SKIP" }), INITIAL_REVEAL);
  const sum = run({ type: "OPEN_REQUESTED" }, { type: "OPEN_SUCCEEDED", count: 2, repeated: false }, { type: "SKIP" });
  assert.equal(revealReducer(sum, { type: "SKIP" }), sum);
});

test("RECUPERACIÓN · con apertura pendiente se recupera al resumen, sin ceremonia nueva", () => {
  const s = run({ type: "RECOVER_STARTED" }, { type: "OPEN_SUCCEEDED", count: 5, repeated: true });
  assert.deepEqual([s.phase, s.recovered, s.count], ["summary", true, 5]);
  assert.equal(s.requests, 0, "recuperar no es una apertura nueva");
});

test("RECUPERACIÓN · resultado guardado en la pestaña → resumen directo", () => {
  const s = run({ type: "RECOVERED", count: 4 });
  assert.deepEqual([s.phase, s.recovered, s.count], ["summary", true, 4]);
});

test("ABRIR OTRO · reinicia la presentación; la siguiente apertura es otra petición", () => {
  const sum = run({ type: "OPEN_REQUESTED" }, { type: "OPEN_SUCCEEDED", count: 5, repeated: false }, { type: "SKIP" });
  const again = revealReducer(revealReducer(sum, { type: "RESET" }), { type: "OPEN_REQUESTED" });
  assert.deepEqual([again.phase, again.requests, again.count], ["requesting", 2, 0]);
});

test("ABRIR OTRO · no se reinicia a mitad de ceremonia", () => {
  const s = run({ type: "OPEN_REQUESTED" }, { type: "OPEN_SUCCEEDED", count: 5, repeated: false });
  assert.equal(revealReducer(s, { type: "RESET" }), s);
});

/* ───────────── fallos ───────────── */

test("FALLO · red caída → reintento con la MISMA clave", () => {
  const f = classifyOpenFailure(new TypeError("Failed to fetch"));
  assert.deepEqual([f.kind, f.retrySameKey], ["NETWORK", true]);
});

test("FALLO · «No tienes ese sobre» → sin sobre, sin reintento", () => {
  const f = classifyOpenFailure(new Error("No tienes ese sobre"));
  assert.deepEqual([f.kind, f.retrySameKey], ["NO_PACK", false]);
  assert.match(f.message, /otra pestaña/);
});

test("FALLO · sesión caducada y sobre no disponible tienen su propio mensaje", () => {
  assert.equal(classifyOpenFailure(new Error("No autenticado")).kind, "AUTH");
  assert.equal(classifyOpenFailure(new Error("Sobre no encontrado")).kind, "UNAVAILABLE");
});

test("FALLO · cualquier otro error es del servidor y reintentar es seguro (misma operación)", () => {
  const f = classifyOpenFailure(new Error("XX000 boom"));
  assert.deepEqual([f.kind, f.retrySameKey], ["SERVER", true]);
  assert.ok(!/XX000|boom/.test(f.message), "sin detalles internos");
});
