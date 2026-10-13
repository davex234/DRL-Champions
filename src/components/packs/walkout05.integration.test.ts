/**
 * WALKOUT 0.5 · el walkout DENTRO de la apertura real — contrato (puro + código).
 *
 * EL SERVIDOR DECIDE, EL WALKOUT PRESENTA. Estos tests fijan que la integración es estrictamente visual: qué cartas
 * se presentan con walkout (clase de sobre), con qué identidad (la de la carta, sin ajustes DEV), en qué orden y cómo
 * encaja en la máquina de presentación; que saltar, repetir, recargar o fallar no cambian el resultado ni piden nada; y
 * que el despliegue nace APAGADO. La QA en navegador (mismo flujo, cartas reales) es `scripts/_walkout05-qa.ts`.
 *
 *   P01–P05 intensidad por clase de sobre · P06–P10 identidad real (TR, JP, US, KR, sin nacionalidad, cambios seguidos)
 *   P11–P18 máquina de presentación (normal sin cambios, varias especiales, hero dentro/fuera, SALTAR, F5, doble clic)
 *   P19–P22 recompensa intacta (no muta, no pide, no escribe) · P23–P26 despliegue OFF, carga diferida, audio que falla
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CARDS, getCard, getPlayer } from "@/data/catalog";
import { getPack } from "@/data/packs";
import type { CardDef } from "@/domain/cards/types";
import { packCardClass } from "@/domain/packs/packClass";
import { INITIAL_REVEAL, buildRevealPlan, revealReducer, toOpenedInstances, type RevealEvent, type RevealState } from "@/domain/packs/reveal";
import { packWalkoutAllowed, packWalkoutQueue, walkoutFlow, walkoutIntensityForCard } from "@/domain/walkout/packWalkout";
import { countryArenaTheme } from "@/domain/walkout/countryTheme";
import { walkoutIdentityFromCard } from "@/domain/walkout/input";
import { WalkoutAudio } from "@/lib/walkout/audio";
import { PACK_WALKOUT_3D_ENABLED } from "@/config/features";
import { f81Results, WALKOUT_SCENES } from "@/app/design-system/fase81/fixtures";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const CAT = { cards: CARDS, getCard, getPlayer };
const card = (id: string): CardDef => { const c = getCard(id); assert.ok(c, id); return c; };
const planOf = (ids: string[]) => buildRevealPlan(toOpenedInstances(ids.map((id, i) => ({ uid: `u${i}`, card: card(id) }))), null, CAT);
const queueOf = (ids: string[]) => packWalkoutQueue(planOf(ids).order);
const code = (q: ReturnType<typeof queueOf>[number]) => countryArenaTheme({ flag: q.identity.flag, region: q.identity.region, nationality: q.identity.nationality }, null, { light: "#fff", accent: "#fff" }).code;
const run = (s: RevealState, ...es: RevealEvent[]) => es.reduce(revealReducer, s);
const opened = (count: number, flow: { walkouts?: number; heroWalked?: boolean; rest?: number } = {}) =>
  run(INITIAL_REVEAL, { type: "OPEN_REQUESTED" }, { type: "OPEN_SUCCEEDED", count, repeated: false, cinematic: true, ...flow });

/* ───────── intensidad = clase de sobre ───────── */

test("P01 · Base y Masters → STANDARD (la revelación de siempre), aunque tengan OVR alto", () => {
  for (const c of CARDS.filter((x) => ["base", "plata", "oro", "masters"].includes(packCardClass(x) ?? ""))) assert.equal(walkoutIntensityForCard(c), "STANDARD", c.id);
  assert.ok(CARDS.some((c) => c.variantId === "base" && c.ovr >= 90), "hay Base de 90+ y no tienen walkout");
});
test("P02 · Champions S → RARE (presentación breve)", () => { for (const c of CARDS.filter((x) => x.variantId === "champions-s")) assert.equal(walkoutIntensityForCard(c), "RARE", c.id); });
test("P03 · Future Star → WALKOUT (entrada humana completa)", () => { for (const c of CARDS.filter((x) => x.variantId === "future-star")) assert.equal(walkoutIntensityForCard(c), "WALKOUT", c.id); });
test("P04 · Record Breaker y Moments → MEGA_WALKOUT", () => {
  const icons = CARDS.filter((x) => x.variantId === "record-breaker" || x.variantId === "moments");
  assert.ok(icons.length >= 3);
  for (const c of icons) assert.equal(walkoutIntensityForCard(c), "MEGA_WALKOUT", c.id);
});
test("P05 · ni el OVR, ni la rareza, ni el precio deciden: una edición desconocida o una Base fuera de rango no tienen walkout", () => {
  assert.equal(walkoutIntensityForCard({ variantId: "base", ovr: 99 }), "STANDARD");
  assert.equal(walkoutIntensityForCard({ variantId: "prime-desconocida" as CardDef["variantId"], ovr: 95 }), "STANDARD");
  const src = read("src/domain/walkout/packWalkout.ts");
  assert.doesNotMatch(src, /rarityOf|\.price|cost/);
});

/* ───────── identidad 100 % de la carta ───────── */

test("P06 · carta turca (Lar0k, Future Star) → TUR, bandera turca, BBL; sin ajustes DEV", () => {
  const [q] = queueOf(["lar0k__future-star", "sato__base", "leaf__base", "aspas__base", "trent__base"]);
  assert.equal(q.cardId, "lar0k__future-star"); assert.equal(q.intensity, "WALKOUT");
  assert.equal(code(q), "TUR"); assert.equal(q.identity.flag?.iso, "TR"); assert.equal(q.identity.team.tag.toUpperCase(), "BBL");
  assert.deepEqual(q.identity.overrides, []);
  assert.equal(q.identity.ovr, card("lar0k__future-star").ovr); assert.equal(q.identity.artwork, card("lar0k__future-star").image ?? null);
});
test("P07 · carta japonesa (Absol) → JPN · P08 estadounidense (reduxx, trent) → USA · coreana (xross, buzz) → KOR", () => {
  const cases: [string, string][] = [["absol__future-star", "JPN"], ["reduxx__future-star", "USA"], ["trent__champions-s", "USA"], ["xross__future-star", "KOR"], ["buzz__champions-s", "KOR"]];
  for (const [id, exp] of cases) { const [q] = queueOf([id]); assert.equal(code(q), exp, id); assert.equal(q.identity.nationality.code, exp, id); }
});
test("P09 · sin nacionalidad: tema regional rotulado o neutro, nunca un país inventado (en el catálogo real ninguna especial carece de país)", () => {
  const specials = CARDS.filter((c) => walkoutIntensityForCard(c) !== "STANDARD");
  assert.ok(specials.every((c) => walkoutIdentityFromCard(c, getPlayer(c.playerId)).nationality.status === "country"), "hoy todas las especiales tienen país con bandera");
  const fs = card("lar0k__future-star");
  const un = walkoutIdentityFromCard(fs, { nick: "x", country: "UN", region: "EMEA", role: "Duelist", team: "BBL" } as never);
  const t = countryArenaTheme({ flag: un.flag, region: un.region, nationality: un.nationality }, null, { light: "#fff", accent: "#fff" });
  assert.equal(un.flag, null); assert.equal(t.kind, "region"); assert.equal(t.code, "EMEA");
  const none = walkoutIdentityFromCard(fs, { nick: "x", country: "", region: null, role: "Duelist", team: "BBL" } as never);
  assert.equal(countryArenaTheme({ flag: none.flag, region: none.region, nationality: none.nationality }, null, { light: "#fff", accent: "#fff" }).kind, "neutral");
});
test("P10 · varias especiales de países distintos en el MISMO sobre: cada walkout lleva la suya (CA, CZ, KR) y en el orden de presentación", () => {
  const plan = planOf(WALKOUT_SCENES["w-mega"].ids as string[]);
  const q = packWalkoutQueue(plan.order);
  assert.deepEqual(q.map((x) => x.uid), plan.order.map((x) => x.uid), "mismo orden que la ceremonia (hero primero)");
  assert.deepEqual(new Set(q.map(code)), new Set(["CAN", "CZE", "KOR"]));
  assert.equal(q[0].uid, plan.hero.ok ? plan.hero.hero.uid : "", "la hero abre la cola");
});

/* ───────── máquina de presentación ───────── */

test("P11 · sin especiales (o despliegue apagado) la ceremonia es EXACTAMENTE la de siempre: intro → tensión → hero → resto → resumen", () => {
  let s = opened(5);
  assert.equal(s.walkouts, 0); assert.equal(s.rest, 4);
  s = run(s, { type: "INTRO_DONE" }); assert.equal(s.phase, "buildup");
  s = run(s, { type: "BUILDUP_DONE" }, { type: "HERO_SHOWN" }, { type: "CONTINUE" }); assert.equal(s.phase, "rest");
  assert.equal(run(opened(1), { type: "INTRO_DONE" }, { type: "BUILDUP_DONE" }, { type: "HERO_SHOWN" }, { type: "CONTINUE" }).phase, "summary", "una carta: la hero ES el sobre");
});
test("P12 · varias especiales: intro → walkout ×N (uno detrás de otro) → resto → resumen; la hero dentro de la cola no se repite", () => {
  const f = walkoutFlow(3, "u0", [{ uid: "u0" }, { uid: "u1" }, { uid: "u2" }]);
  assert.deepEqual(f, { walkouts: 3, heroWalked: true, rest: 0 });
  let s = run(opened(3, f), { type: "INTRO_DONE" });
  assert.equal(s.phase, "walkout"); assert.equal(s.walkoutIndex, 0);
  s = run(s, { type: "WALKOUT_DONE" }); assert.equal(s.walkoutIndex, 1);
  s = run(s, { type: "WALKOUT_DONE" }); assert.equal(s.walkoutIndex, 2);
  s = run(s, { type: "WALKOUT_DONE" }); assert.equal(s.phase, "summary", "Icon de 3 especiales: sin resto");
});
test("P13 · la especial NO es la hero (Absol 87 frente a una Base 90): walkout primero y después la hero de siempre y el resto", () => {
  const plan = planOf(WALKOUT_SCENES["w-jp"].ids as string[]);
  const q = packWalkoutQueue(plan.order);
  const f = walkoutFlow(5, plan.hero.ok ? plan.hero.hero.uid : null, q);
  assert.deepEqual(f, { walkouts: 1, heroWalked: false, rest: 3 });
  let s = run(opened(5, f), { type: "INTRO_DONE" }, { type: "WALKOUT_DONE" });
  assert.equal(s.phase, "buildup", "tras el walkout, la hero (Base 90)");
  s = run(s, { type: "BUILDUP_DONE" }, { type: "HERO_SHOWN" }, { type: "CONTINUE" }); assert.equal(s.phase, "rest");
});
test("P14 · cambio de intensidad entre cartas y repetidas: Champions S ×2 + otra Champions S = 3 walkouts RARE, uno por instancia", () => {
  const q = queueOf(WALKOUT_SCENES["w-dup"].ids as string[]);
  assert.equal(q.length, 3); assert.ok(q.every((x) => x.intensity === "RARE"));
  assert.equal(new Set(q.map((x) => x.uid)).size, 3, "las repetidas son instancias distintas");
  const us = queueOf(WALKOUT_SCENES["w-us"].ids as string[]);
  assert.deepEqual(us.map((x) => [x.cardId, x.intensity]), [["trent__champions-s", "RARE"], ["reduxx__future-star", "WALKOUT"]]);
});
test("P15 · SALTAR durante un walkout va al resumen de las MISMAS cartas (count intacto); un toque en la intro lleva al primer walkout, no se lo salta", () => {
  const s = run(opened(5, { walkouts: 2, heroWalked: true, rest: 3 }), { type: "INTRO_DONE" });
  const k = run(s, { type: "SKIP" });
  assert.equal(k.phase, "summary"); assert.equal(k.count, 5); assert.equal(k.skipped, true);
  assert.equal(run(opened(5, { walkouts: 1, heroWalked: true, rest: 4 }), { type: "ADVANCE" }).phase, "walkout");
  assert.equal(run(s, { type: "ADVANCE" }).phase, "walkout", "ADVANCE no salta un walkout (lo avanza su propio CONTINUAR)");
  assert.equal(run(s, { type: "CONTINUE" }).phase, "walkout");
});
test("P16 · WALKOUT_DONE fuera de un walkout no hace nada (un clic tardío no adelanta la ceremonia)", () => {
  for (const ph of [opened(5), run(opened(5), { type: "INTRO_DONE" })]) assert.equal(run(ph, { type: "WALKOUT_DONE" }), ph);
});
test("P17 · RECARGA a mitad (recuperación): resumen directo de lo guardado, sin walkouts ni reapertura", () => {
  const r = run(INITIAL_REVEAL, { type: "RECOVER_STARTED" }, { type: "OPEN_SUCCEEDED", count: 5, repeated: true, walkouts: 2 });
  assert.equal(r.phase, "summary"); assert.equal(r.recovered, true);
  assert.equal(run(INITIAL_REVEAL, { type: "RECOVERED", count: 5 }).phase, "summary");
  const src = read("src/components/packs/PackOpeningExperience.tsx");
  assert.match(src, /una recuperación va al resumen directo: el walkout no se repite tras recargar/);
});
test("P18 · doble clic en ABRIR = una petición; con walkouts también (la máquina no cambia)", () => {
  const s = run(INITIAL_REVEAL, { type: "OPEN_REQUESTED" }, { type: "OPEN_REQUESTED" });
  assert.equal(s.requests, 1); assert.equal(s.phase, "requesting");
  const f = run(s, { type: "OPEN_SUCCEEDED", count: 5, repeated: false, walkouts: 9 });
  assert.equal(f.walkouts, 5, "nunca más walkouts que cartas");
});

/* ───────── la recompensa no se toca ───────── */

test("P19 · la cola y el flujo NO mutan el resultado ni el plan (mismo contenido, mismo orden, mismas cartas)", () => {
  const res = f81Results("w-mega");
  const before = JSON.stringify(res);
  const plan = buildRevealPlan(toOpenedInstances(res), null, CAT);
  const orderBefore = plan.order.map((i) => i.uid).join();
  Object.freeze(res); plan.order.forEach((i) => Object.freeze(i));
  const q = packWalkoutQueue(plan.order); walkoutFlow(res.length, plan.hero.ok ? plan.hero.hero.uid : null, q);
  assert.equal(JSON.stringify(res), before); assert.equal(plan.order.map((i) => i.uid).join(), orderBefore);
  assert.ok(q.every((x) => res.some((r) => r.uid === x.uid && r.card.id === x.cardId)), "cada walkout es una instancia del resultado");
});
test("P20 · el walkout no conoce la red, el store, el inventario ni el servidor (solo presenta)", () => {
  for (const f of ["src/domain/walkout/packWalkout.ts", "src/components/packs/PackWalkout.tsx", "src/components/walkout/WalkoutDirector.tsx", "src/components/walkout/WalkoutStage.tsx", "src/lib/walkout/controller.ts", "src/lib/walkout/audio.ts"]) {
    const src = read(f);
    assert.doesNotMatch(src, /fetch\(|openPack|apiOpenPack|useGameStore|@\/server\/|supabase|economy|ownedCards|unopenedPacks/, f);
  }
});
test("P21 · la apertura sigue pidiendo UNA vez con la misma clave y guarda lo mismo: el walkout se calcula DESPUÉS del resultado y no entra en la petición", () => {
  const src = read("src/components/packs/PackOpeningExperience.tsx");
  assert.match(src, /const out = await openPackOutcome\(packId\);\n\s+res = out\.results;/);
  assert.match(src, /saveOpenReveal\(packId, res\);/);
  assert.match(src, /dispatch\(\{ type: "OPEN_SUCCEEDED", count: res\.length, repeated, cinematic: heroIsPresentable\(res\), \.\.\.ceremonyFlow\(res\) \}\)/);
  // REPETIR es solo la animación del director (ninguna llamada fuera de él)
  assert.match(read("src/components/packs/PackWalkout.tsx"), /const replay = \(\) => \{ primeAudio\(\); trackFlow\("pack_ceremony", "walkout_replay"\); ref\.current\?\.replay\(\); \};/);
});
test("P22 · las escenas QA usan cartas REALES del catálogo y el número de cartas de su sobre", () => {
  for (const [scene, w] of Object.entries(WALKOUT_SCENES)) {
    for (const id of w.ids) assert.ok(getCard(id), `${scene}: ${id}`);
    assert.equal(w.ids.length, getPack(w.packId)!.cardCount, `${scene}: cartas del sobre ${w.packId}`);
  }
});

/* ───────── despliegue, carga, fallos ───────── */

test("P23 · desde Walkout 0.7 el despliegue está en «all» (autorizado por el propietario); en producción no hay vía local ni de QA; «admins» solo con el veredicto explícito del servidor", () => {
  assert.equal(PACK_WALKOUT_3D_ENABLED, "all");
  assert.equal(packWalkoutAllowed({ rollout: PACK_WALKOUT_3D_ENABLED, admin: null, devOptIn: false, production: true }), true, "cualquier jugador, sin sesión admin ni ajustes locales");
  const base = { rollout: "off" as const, admin: null, devOptIn: false, production: true };
  assert.equal(packWalkoutAllowed(base), false);
  assert.equal(packWalkoutAllowed({ ...base, devOptIn: true }), false, "en producción el opt-in local no cuenta");
  assert.equal(packWalkoutAllowed({ ...base, qa: true }), false, "en producción el arnés no cuenta");
  assert.equal(packWalkoutAllowed({ ...base, production: false, devOptIn: true }), true, "en next dev, el navegador que lo pide");
  for (const g of ["checking", "denied", "unconfigured", null] as const) assert.equal(packWalkoutAllowed({ ...base, rollout: "admins", admin: g }), false, String(g));
  assert.equal(packWalkoutAllowed({ ...base, rollout: "admins", admin: "granted" }), true);
  assert.equal(packWalkoutAllowed({ ...base, rollout: "all" }), true);
  // sin «admins», ni siquiera se pregunta al servidor
  assert.match(read("src/components/packs/PackOpeningExperience.tsx"), /\{PACK_WALKOUT_3D_ENABLED === "admins" && <AdminProbe onResult=\{setAdminGate\} \/>\}/);
});
test("P24 · carga diferida: la apertura importa el walkout con next/dynamic (ssr:false); three.js solo lo importan los módulos de escena", () => {
  const src = read("src/components/packs/PackOpeningExperience.tsx");
  assert.match(src, /const loadPackWalkout = \(\) => import\("\.\/PackWalkout"\);/);
  assert.match(src, /dynamic\(\(\) => loadPackWalkout\(\)\.then\(\(m\) => m\.PackWalkout\), \{\n\s+ssr: false,/);
  assert.doesNotMatch(src, /from "@\/components\/walkout\/|from "three"/);
  assert.doesNotMatch(read("src/components/packs/PackWalkout.tsx"), /from "three"/);
});
test("P25 · un fallo del walkout nunca bloquea: frontera de errores → se registra y CONTINÚA; OMITIR y CERRAR quedan por encima (capa aislada)", () => {
  const src = read("src/components/packs/PackWalkout.tsx");
  assert.match(src, /class WalkoutBoundary extends Component/);
  assert.match(src, /const onFail = useCallback\(\(e: unknown\) => \{[\s\S]*?finish\(\);/);
  assert.match(src, /className="absolute inset-x-0 bottom-0 z-surface isolate/);
  const exp = read("src/components/packs/PackOpeningExperience.tsx");
  assert.match(exp, /<PackWalkout key=\{walkoutItem\.uid\}/, "una escena por carta: se desmonta y libera antes de la siguiente");
});
test("P26 · audio que falla (contexto que lanza, nodo que no se crea) → la escena sigue en silencio, sin excepción", () => {
  const a = new WalkoutAudio(() => { throw new Error("audio roto"); });
  assert.doesNotThrow(() => a.play("arena", {}));
  assert.equal(a.failed, true);
  const broken = new WalkoutAudio(() => ({ currentTime: 0, createOscillator() { throw new Error("sin nodos"); }, createGain() { throw new Error("sin nodos"); }, createBufferSource() { throw new Error("sin nodos"); }, createBiquadFilter() { throw new Error("sin nodos"); } } as unknown as AudioContext));
  assert.doesNotThrow(() => broken.play("revealHit", { intensity: 1 }));
  assert.doesNotThrow(() => new WalkoutAudio(() => null).play("footsteps", {}));
});
