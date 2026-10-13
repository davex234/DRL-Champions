/**
 * FASE 63 · ONBOARDING 5.0 — DOMINIO PURO.
 *
 * Estado (NOT_STARTED / IN_PROGRESS / COMPLETED) derivado de hechos reales + tres acuses; pasos sin cárcel lineal;
 * órdenes idempotentes y sin concesiones; cuerpo estricto; cuentas existentes (datos REALES medidos en la BD del VPS el
 * 2026-09-26, `docs/product/qa/fase63-onboarding/baseline.json`); ayuda de la primera partida; copy y terminología.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { JourneyFacts, RoleShortage } from "@/domain/journey";
import {
  buildOnboarding, decideFlags, matchHintFor, onboardingMetadata, onboardingStatus, parseOnboardingFlags, parseOnboardingRequest,
  stepDone, MATCH_HINTS, NO_FLAGS, ONBOARDING_COMMANDS, ONBOARDING_METADATA_KEY, ONBOARDING_ROUTES, ONBOARDING_STEPS, STEP_DEFS,
  type OnboardingFlags,
} from "./index";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const NOW = Date.parse("2026-09-26T12:00:00.000Z");

const roles = (have: number): RoleShortage[] => (["Duelista", "Controlador", "Iniciador", "Centinela", "Flex"] as const).map((role) => ({ role, have, need: 2 }));
const NOT_READY = { ready: false, dataVersion: null, roles: roles(0), shortages: roles(0) };
const READY = { ready: true, dataVersion: "VCT-2026", roles: roles(2), shortages: [] };
/** Cuenta recién creada por `handle_new_user`: 3 Iniciales + 1 Bronce, sin cartas, sin equipos, sin partidas. */
const J = (o: Partial<JourneyFacts> = {}): JourneyFacts => ({
  ownedCards: 0, packsOpened: 0, matchesCompleted: 0, unopenedPacks: 4, firstPackId: "inicial",
  decks: { total: 0, valid: 0, firstInvalid: null }, readyDeck: null, readiness: NOT_READY, ...o,
});
const F = (o: Partial<OnboardingFlags> = {}): OnboardingFlags => ({ ...NO_FLAGS, ...o });
const V = (j: Partial<JourneyFacts> = {}, f: Partial<OnboardingFlags> = {}) => buildOnboarding({ journey: J(j), flags: F(f), starter: { credits: 6000, packs: [{ packId: "estandar", qty: 1 }, { packId: "inicial", qty: 3 }] } });
const DECK = { id: "d1", name: "Mi primer equipo", cardIds: Array.from({ length: 10 }, (_, i) => `c${i}`), active: true };

/* ───────────── estado ───────────── */

test("F63 D01 · cuenta nueva sin tocar nada → NOT_STARTED, paso 1/6 bienvenida, EMPEZAR es una orden del servidor", () => {
  const v = V();
  assert.equal(v.status, "NOT_STARTED");
  assert.equal(v.active, true);
  assert.equal(v.current, "welcome");
  assert.equal(v.progress.label, "1/6");
  assert.equal(v.next?.command, "start");
  assert.equal(v.next?.cta, "Empezar");
});

test("F63 D02 · EMPEZAR → IN_PROGRESS paso 2/6: abrir el PRIMER sobre que posee (determinista: Bronce, luego Iniciales)", () => {
  const v = V({}, { startedAt: NOW });
  assert.equal(v.status, "IN_PROGRESS");
  assert.equal(v.current, "open");
  assert.equal(v.progress.label, "2/6");
  assert.equal(v.next?.href, "/abrir/estandar", "simulación: Bronce primero = 99,97 % con los 4 sobres de bienvenida");
  // Tras el primer sobre, los siguientes son los Iniciales (asistencia F41); sin Bronce, el Inicial desde el principio.
  assert.equal(V({ packsOpened: 1, ownedCards: 5, unopenedPacks: 3 }, { startedAt: NOW }).next?.href, "/abrir/inicial");
  const noBronze = buildOnboarding({ journey: J(), flags: F({ startedAt: NOW }), starter: { credits: 6000, packs: [{ packId: "inicial", qty: 3 }] } });
  assert.equal(noBronze.next?.href, "/abrir/inicial");
  assert.equal(v.next?.command, null);
  assert.deepEqual(v.starter, { credits: 6000, packs: [{ packId: "estandar", qty: 1 }, { packId: "inicial", qty: 3 }] });
});

test("F63 D03 · el recorrido completo por hechos: sobre → colección → equipo → partida → progreso → terminado", () => {
  assert.equal(V({ packsOpened: 1, ownedCards: 5, unopenedPacks: 3 }, { startedAt: NOW }).current, "collection");
  assert.equal(V({ packsOpened: 4, ownedCards: 20, unopenedPacks: 0, readiness: READY }, { startedAt: NOW }).current, "deck");
  const withDeck = V({ packsOpened: 4, ownedCards: 20, unopenedPacks: 0, readiness: READY, decks: { total: 1, valid: 1, firstInvalid: null }, readyDeck: DECK }, { startedAt: NOW });
  assert.equal(withDeck.current, "match");
  assert.equal(withDeck.next?.href, "/duelos/jugar?dificultad=EASY&primera=1");
  const played = V({ packsOpened: 4, ownedCards: 20, readiness: READY, decks: { total: 1, valid: 1, firstInvalid: null }, matchesCompleted: 1 }, { startedAt: NOW });
  assert.equal(played.current, "progress");
  assert.equal(played.progress.label, "6/6");
  assert.equal(played.next?.href, "/cuenta?seccion=progresion"); // IA 2026-10-07 · Mi cuenta → Progresión
  const done = V({ matchesCompleted: 1 }, { startedAt: NOW, finishedAt: NOW + 1 });
  assert.equal(done.status, "COMPLETED");
  assert.equal(done.reason, "FINISHED");
  assert.equal(done.active, false);
  assert.equal(done.next, null);
});

test("F63 D04 · sin cárcel lineal: lo ya hecho NO se vuelve a pedir (tiene equipo sin haber pulsado nada → partida)", () => {
  const v = V({ ownedCards: 30, packsOpened: 0, readiness: READY, decks: { total: 1, valid: 1, firstInvalid: null }, readyDeck: DECK });
  assert.equal(v.status, "IN_PROGRESS", "actividad real sin EMPEZAR ya no es «por empezar»");
  assert.equal(v.current, "match");
  for (const s of ["welcome", "open", "collection", "deck"] as const) assert.ok(v.steps.find((x) => x.id === s)!.done, s);
});

test("F63 D05 · cartas sin sobres abiertos (admin/legacy) → no pide abrir; con equipo inválido sigue ofreciendo crear el primero", () => {
  const v = V({ ownedCards: 12, packsOpened: 0, readiness: READY, decks: { total: 1, valid: 0, firstInvalid: { id: "x", name: "A medias", size: 6 } } });
  assert.equal(v.current, "deck");
  assert.equal(v.next?.command, "first-team");
  assert.equal(v.context.hasInvalidDeck, true);
});

test("F63 D06 · colección insuficiente sin sobres → Sobre Inicial (ruta real de la asistencia F41), con los roles que faltan", () => {
  const short = { ready: false, dataVersion: "VCT-2026", roles: roles(2).map((r) => (r.role === "Centinela" ? { ...r, have: 1 } : r)), shortages: [{ role: "Centinela" as const, have: 1, need: 2 }] };
  const v = V({ packsOpened: 4, ownedCards: 20, unopenedPacks: 0, firstPackId: null, readiness: short }, { startedAt: NOW });
  assert.equal(v.current, "collection");
  assert.equal(v.next?.href, "/packs/inicial");
  assert.match(v.next!.detail, /1 Centinela/);
});

test("F63 D07 · perder o empatar la primera partida cuenta igual (partidas terminadas, no victorias)", () => {
  const v = V({ matchesCompleted: 1, decks: { total: 1, valid: 1, firstInvalid: null } }, { startedAt: NOW });
  assert.equal(v.current, "progress");
  assert.ok(!/gan(a|ar) la/i.test(JSON.stringify(v.next)), "nada exige ganar");
});

test("F63 D08 · dos partidas sin pulsar SEGUIR JUGANDO → completado (la guía nunca retiene a quien ya juega)", () => {
  const v = V({ matchesCompleted: 2 }, { startedAt: NOW });
  assert.equal(v.status, "COMPLETED");
  assert.equal(v.reason, "PLAYING");
});

test("F63 D09 · saltar: COMPLETED/SKIPPED sin tocar hechos; se puede retomar solo si no estaría completo por otra vía", () => {
  const skipped = V({ packsOpened: 1, ownedCards: 5 }, { startedAt: NOW, skippedAt: NOW + 5 });
  assert.equal(skipped.status, "COMPLETED");
  assert.equal(skipped.reason, "SKIPPED");
  assert.equal(skipped.active, false);
  assert.equal(skipped.canResume, true);
  assert.equal(V({ matchesCompleted: 2 }, { skippedAt: NOW }).canResume, false);
});

/* ───────────── cuentas existentes (BD real, 2026-09-26) ───────────── */

test("F63 D10 · cuentas EXISTENTES: con partidas y sin haber empezado la guía → COMPLETADAS, jamás guía forzada", () => {
  // NEXUSDemo_2f86 (la cuenta del usuario): 10 partidas, 28 sobres abiertos, 352 cartas, 1 equipo.
  const mine = V({ matchesCompleted: 10, packsOpened: 28, ownedCards: 352, unopenedPacks: 0, firstPackId: null, readiness: READY, decks: { total: 1, valid: 1, firstInvalid: null }, readyDeck: DECK });
  assert.equal(mine.status, "COMPLETED");
  assert.equal(mine.reason, "SELF_GUIDED");
  assert.equal(mine.active, false);
  // qa_journey_9774_64ee (F40): 1 partida, sin cartas tras el reemplazo del catálogo → completada igualmente.
  assert.equal(V({ matchesCompleted: 1, packsOpened: 7, ownedCards: 0, unopenedPacks: 0, firstPackId: null }).status, "COMPLETED");
  // QA 8c326e52 / 1ff2c0ef: 15 partidas cada una.
  assert.equal(V({ matchesCompleted: 15, packsOpened: 16, ownedCards: 35 }).status, "COMPLETED");
});

test("F63 D11 · cuentas sin NINGUNA actividad (7 en la BD) son, de hecho, jugadores nuevos: bienvenida, sin conceder nada", () => {
  const v = V({ unopenedPacks: 4 });
  assert.equal(v.status, "NOT_STARTED");
  const d = decideFlags("start", J(), F(), NOW);
  assert.ok(d.ok && d.changed);
  assert.deepEqual(Object.keys(d.ok ? d.flags : {}).sort(), ["finishedAt", "skippedAt", "startedAt"], "solo acuses: ni créditos ni sobres");
});

test("F63 D12 · created_at no es autoridad: ni el dominio ni el servicio lo leen", () => {
  assert.ok(!/created_at|createdAt/.test(code(read("src/domain/onboarding/index.ts"))));
  const svc = code(read("src/server/services/onboarding.ts"));
  const facts = svc.slice(svc.indexOf("export async function readOnboardingFacts"), svc.indexOf("export async function readOnboarding("));
  assert.ok(!/created_at|createdAt/.test(facts));
});

/* ───────────── órdenes: idempotencia y seguridad ───────────── */

test("F63 D13 · EMPEZAR ×1/×2/×10 = el mismo acuse (la segunda vez no escribe)", () => {
  let f = F();
  let writes = 0;
  for (let i = 0; i < 10; i++) {
    const d = decideFlags("start", J(), f, NOW + i);
    assert.ok(d.ok);
    if (d.ok && d.changed) { writes++; f = d.flags; }
  }
  assert.equal(writes, 1);
  assert.equal(f.startedAt, NOW);
});

test("F63 D14 · TERMINAR exige una partida terminada en la BD: sin partida → 409 y sin escribir", () => {
  const d = decideFlags("finish", J(), F({ startedAt: NOW }), NOW);
  assert.equal(d.ok, false);
  assert.equal(d.ok ? 0 : d.status, 409);
  const ok = decideFlags("finish", J({ matchesCompleted: 1 }), F({ startedAt: NOW }), NOW + 9);
  assert.ok(ok.ok && ok.changed && ok.flags.finishedAt === NOW + 9);
  const again = decideFlags("finish", J({ matchesCompleted: 1 }), ok.ok ? ok.flags : F(), NOW + 99);
  assert.ok(again.ok && !again.changed, "repetir el callback no cambia nada");
});

test("F63 D15 · SALTAR con la guía completada no escribe; RETOMAR con la guía completada por otra vía → 409", () => {
  assert.deepEqual(decideFlags("skip", J({ matchesCompleted: 3 }), F(), NOW), { ok: true, changed: false, flags: F() });
  const r = decideFlags("resume", J({ matchesCompleted: 3 }), F({ skippedAt: NOW }), NOW);
  assert.equal(r.ok, false);
  const back = decideFlags("resume", J({ packsOpened: 1, ownedCards: 5 }), F({ skippedAt: NOW }), NOW + 1);
  assert.ok(back.ok && back.changed && back.flags.skippedAt === null && back.flags.startedAt === NOW + 1);
});

test("F63 D16 · ninguna orden de acuse toca hechos del juego (no hay rama que conceda): la vista solo cambia de estado", () => {
  for (const c of ["start", "skip", "resume", "finish"] as const) {
    const j = J({ matchesCompleted: 1, packsOpened: 1, ownedCards: 5 });
    const before = JSON.stringify(j);
    decideFlags(c, j, F({ startedAt: NOW }), NOW);
    assert.equal(JSON.stringify(j), before, c);
  }
  assert.equal(decideFlags("first-team", J(), F(), NOW).ok, false, "first-team no es un acuse");
});

test("F63 D17 · cuerpo ESTRICTO: solo `{ action }` con una orden conocida (sin userId, sin flags, sin recompensas)", () => {
  for (const c of ONBOARDING_COMMANDS) assert.deepEqual(parseOnboardingRequest({ action: c }), { ok: true, command: c });
  for (const bad of [null, [], "start", {}, { action: "grant" }, { action: "start", userId: "x" }, { action: "finish", finishedAt: 1 }, { action: 1 }, { action: "START" }]) {
    assert.equal(parseOnboardingRequest(bad).ok, false, JSON.stringify(bad));
  }
});

test("F63 D18 · acuses: lectura tolerante (basura = no hecho) y escritura namespaced con versión", () => {
  assert.deepEqual(parseOnboardingFlags(null), F());
  assert.deepEqual(parseOnboardingFlags({ provider: "email" }), F());
  assert.deepEqual(parseOnboardingFlags({ [ONBOARDING_METADATA_KEY]: "x" }), F());
  assert.deepEqual(parseOnboardingFlags({ [ONBOARDING_METADATA_KEY]: { startedAt: "no-date", skippedAt: -5, finishedAt: {} } }), F());
  const f = F({ startedAt: NOW, finishedAt: NOW + 1000 });
  const meta = onboardingMetadata(f);
  assert.deepEqual(Object.keys(meta), [ONBOARDING_METADATA_KEY]);
  assert.equal((meta[ONBOARDING_METADATA_KEY] as { v: number }).v, 1);
  assert.deepEqual(parseOnboardingFlags(meta), f, "ida y vuelta exacta");
});

/* ───────────── pasos, rutas y copy ───────────── */

test("F63 D19 · seis pasos con objetivo, condición real, CTA y ruta de reanudación", () => {
  assert.deepEqual([...ONBOARDING_STEPS], ["welcome", "open", "collection", "deck", "match", "progress"]);
  for (const s of ONBOARDING_STEPS) {
    assert.ok(STEP_DEFS[s].title && STEP_DEFS[s].objective && STEP_DEFS[s].doneWhen && STEP_DEFS[s].resume, s);
    assert.equal(typeof stepDone(s, J(), F()), "boolean");
  }
});

test("F63 D20 · todas las rutas de la guía EXISTEN en la app (nada inventado)", () => {
  const exists = (href: string) => {
    const path = href.split("?")[0].replace(/^\//, "");
    if (path === "") return existsSync(join(ROOT, "src/app/page.tsx"));
    const parts = path.split("/");
    let dir = join(ROOT, "src/app");
    for (const p of parts) {
      if (existsSync(join(dir, p))) { dir = join(dir, p); continue; }
      const dyn = readdirSync(dir).find((d) => d.startsWith("["));
      if (!dyn) return false;
      dir = join(dir, dyn);
    }
    return existsSync(join(dir, "page.tsx"));
  };
  for (const href of [ONBOARDING_ROUTES.home, ONBOARDING_ROUTES.packRoute("inicial"), ONBOARDING_ROUTES.freePack, ONBOARDING_ROUTES.collection, ONBOARDING_ROUTES.manualDeck, ONBOARDING_ROUTES.firstMatch, ONBOARDING_ROUTES.progress, ONBOARDING_ROUTES.play, ONBOARDING_ROUTES.guide]) {
    assert.ok(exists(href), href);
  }
});

test("F63 D21 · ayuda de la primera partida: una vez al atacar y una al defender; nada fuera de partida", () => {
  assert.equal(matchHintFor({ status: "IN_PROGRESS", youAreAttacker: true }, new Set()), "attack");
  assert.equal(matchHintFor({ status: "IN_PROGRESS", youAreAttacker: false }, new Set()), "defend");
  assert.equal(matchHintFor({ status: "IN_PROGRESS", youAreAttacker: true }, new Set(["attack"])), null);
  assert.equal(matchHintFor({ status: "COMPLETED", youAreAttacker: true }, new Set()), null);
  // Reglas del motor: SH ↔ EF, GS ↔ GS; empate de turno = nadie puntúa.
  assert.match(MATCH_HINTS.defend.lines.join(" "), /SH contra EF, GS contra GS/);
  assert.match(MATCH_HINTS.defend.lines.join(" "), /nadie puntúa/);
  assert.match(MATCH_HINTS.attack.lines.join(" "), /valor más alto gana/);
  const matchup = read("src/domain/cards/combat.ts");
  assert.match(matchup, /stronghold: "entryfrag",\s*gamesense: "gamesense",\s*entryfrag: "stronghold"/);
});

const UI = ["OnboardingKit.tsx", "OnboardingHome.tsx", "FirstCardLesson.tsx", "OnboardingCollectionCoach.tsx", "FirstMatchHelp.tsx", "OnboardingProgress.tsx", "OnboardingRail.tsx"]
  .map((f) => read(`src/components/onboarding/${f}`)).join("\n") + read("src/domain/onboarding/index.ts") + read("src/app/como-jugar/page.tsx");

test("F63 D22 · terminología única: carta, sobre, colección, EQUIPO, partida, XP de cuenta / de temporada, objetivo", () => {
  const visible = code(UI);
  assert.ok(!/\bmazos?\b/i.test(visible), "nunca «mazo»");
  assert.ok(!/\bplantillas?\b/i.test(visible), "nunca «plantilla»");
  assert.ok(!/\bbaraja/i.test(visible), "nunca «baraja»");
  assert.ok(!/\bCOM\b/.test(visible), "la estadística impresa es FKS, no COM");
  assert.match(visible, /XP de cuenta/);
  assert.match(visible, /XP de temporada/);
});

test("F63 D23 · primera sesión sin sistemas avanzados: ni mercado, ni pagos, ni Pick'ems, ni admin, ni fórmulas", () => {
  const visible = code(UI);
  for (const bad of [/market|mercado/i, /pago|payment|€|euro/i, /pick'?em/i, /admin/i, /desguace|salvage/i, /probabilidad/i]) {
    assert.ok(!bad.test(visible), String(bad));
  }
});

test("F63 D24 · la guía no concede nada: el cliente de la guía no llama a sobres, recompensas ni reclamos", () => {
  const client = code(read("src/lib/onboarding/client.ts"));
  assert.ok(!/\/api\/game\/(packs|progression|store|credits|economy)/.test(client));
  assert.ok(!/localStorage/.test(client), "el estado no vive en localStorage");
  const svc = code(read("src/server/services/onboarding.ts"));
  for (const bad of ["app_grant_reward", "app_adjust_credits", "app_buy_pack", "app_grant_pack", "user_packs\").insert", "credit_transactions\").insert", "award("]) {
    assert.ok(!svc.includes(bad), `el servicio no toca ${bad}`);
  }
});

test("F63 D25 · sin migración: la cabeza es 0058 (PRE-F70, privilegios) y los acuses van en app_metadata (servidor)", () => {
  const files = readdirSync(join(ROOT, "supabase/migrations")).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  // F73 añade 0059 (crafteo y misiones) y 0060 (desguace atómico, última copia): AUTORIZADAS y APLICADAS el 2026-09-30.
  assert.equal(files[files.length - 1], "0074_collection_scale.sql"); // COLECCIONES ILIMITADAS · 0074 (índices de cursor y resumen por carta; aditiva y opcional: el servidor funciona igual sin ella) es la última; antes F87.2 · 0073 (launch guard de Pick'ems: elegibilidad y puerta de tiempo) es la última; antes F87.1 · 0072, F87 · 0071 (Pick'ems 2.0: cuadros de predicción, cierre por partido, liquidación y reclamos; aditiva) es la última; antes F86.2 · 0070 (feedback de la Closed Alpha + embudo derivado) es la última; antes F86 · 0069 (torneos de jugadores) es la última del repositorio (cabeza = 0069; 0068 tag público de cuenta; 0067 gestión de admins, F85 añadió 0066, F84 añadió 0065, F83 0064, ops/release). F82 añadió 0062 y F89 0063.
  const svc = read("src/server/services/onboarding.ts");
  assert.match(svc, /auth\.admin\.updateUserById\(userId, \{ app_metadata: next \}\)/);
  assert.ok(!/user_metadata/.test(code(svc)), "user_metadata lo puede escribir el cliente: no se usa");
});
