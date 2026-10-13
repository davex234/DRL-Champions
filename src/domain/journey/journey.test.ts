/**
 * FASE 40 · PLAYER JOURNEY — DOMINIO PURO: detección, pasos, edges, legado, preparación del equipo y copy de reglas.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildPlayerJourney, deckReadiness, firstPackOf, shortageLabel, DISCOVERY, FIRST_MATCH_RULES, FREE_PACK_ID, JOURNEY_ROUTES,
  JOURNEY_STEPS, STEP_COPY, type JourneyFacts, type ReadinessCard,
} from "./index";
import { CardRegistry } from "@/collection/registry";
import { autocomplete, indexPool } from "@/domain/deckBuilder/builder";
import { builderCollection } from "@/server/services/deckTeams";
import { getPack } from "@/data/packs";
import { DUEL_ROLES } from "@/domain/cardgame/types";
import type { RoleId } from "@/domain/cards/types";

const ROLES = DUEL_ROLES;
const roles = (have: Partial<Record<RoleId, number>>) => ROLES.map((role) => ({ role, have: Math.min(have[role] ?? 0, 2), need: 2 }));
const readiness = (have: Partial<Record<RoleId, number>>) => {
  const r = roles(have);
  const shortages = r.filter((x) => x.have < x.need);
  return { ready: shortages.length === 0, dataVersion: "VCT-2026", roles: r, shortages };
};
const FULL = readiness({ Duelista: 2, Controlador: 2, Iniciador: 2, Centinela: 2, Flex: 2 });
const EMPTY = readiness({});

const fresh = (o: Partial<JourneyFacts> = {}): JourneyFacts => ({
  ownedCards: 0, packsOpened: 0, matchesCompleted: 0, unopenedPacks: 4, firstPackId: "inicial",
  decks: { total: 0, valid: 0, firstInvalid: null }, readyDeck: null, readiness: EMPTY, ...o,
});
const J = (o: Partial<JourneyFacts> = {}) => buildPlayerJourney(fresh(o));

/* ───────────── detección ───────────── */

test("J01 · cuenta nueva detectada por hechos: ACTIVE, bienvenida, paso ABRE, 0/4", () => {
  const j = J();
  assert.equal(j.status, "ACTIVE");
  assert.equal(j.welcome, true);
  assert.equal(j.currentStep, "open");
  assert.deepEqual(j.completedSteps, []);
  assert.equal(j.progress.label, "0/4");
  assert.equal(j.isComplete, false);
});

test("J02 · cuenta ANTIGUA sin actividad (sin cartas, sin partidas) sigue necesitando la primera sesión", () => {
  const j = J({ unopenedPacks: 4 });
  assert.equal(j.status, "ACTIVE");
  assert.equal(j.currentStep, "open");
});

test("J03 · cuenta con cartas, equipo y partidas = COMPLETA (sin FTUE retroactivo)", () => {
  const j = J({ ownedCards: 120, packsOpened: 30, matchesCompleted: 45, unopenedPacks: 0, firstPackId: null, decks: { total: 3, valid: 2, firstInvalid: null }, readiness: FULL });
  assert.equal(j.status, "COMPLETE");
  assert.equal(j.currentStep, null);
  assert.equal(j.nextAction, null);
  assert.equal(j.justCompleted, false);
  assert.equal(j.welcome, false);
});

test("J04 · created_at NO es autoridad: los hechos no tienen fecha de alta y el dominio no lee reloj", () => {
  const src = readFileSync(join(process.cwd(), "src/domain/journey/index.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(!/created_?at|createdAt|obtained_?at|obtainedAt|Date\.now|new Date|Math\.random/.test(src));
  const keys = Object.keys(fresh());
  assert.ok(!keys.some((k) => /created|obtained|date|time/i.test(k)));
});

test("J05 · la bienvenida solo existe mientras no hay nada hecho (no se repite para siempre)", () => {
  assert.equal(J().welcome, true);
  assert.equal(J({ packsOpened: 1, ownedCards: 5, unopenedPacks: 3 }).welcome, false);
  assert.equal(J({ ownedCards: 5, unopenedPacks: 0, firstPackId: null }).welcome, false);
});

test("J06 · reanudar: tras abrir un sobre ayer y volver hoy, el paso es COLECCIONA (sin bienvenida ni «primer sobre»)", () => {
  const j = J({ packsOpened: 1, ownedCards: 5, unopenedPacks: 3, readiness: readiness({ Duelista: 2, Iniciador: 1 }) });
  assert.equal(j.currentStep, "collect");
  assert.equal(j.welcome, false);
  assert.equal(j.nextAction!.title, "Sigue abriendo sobres");
});

test("J07 · el recorrido siempre deja explorar por libre (canSkip) y no da nada al hacerlo (no hay campo de recompensa)", () => {
  const j = J();
  assert.equal(j.canSkip, true);
  assert.ok(!/reward|credits|xp|pack(s)?Granted/i.test(JSON.stringify(Object.keys(j))));
  assert.ok(!/reward|créditos|XP/.test(JSON.stringify(j.nextAction)));
});

/* ───────────── pasos ───────────── */

test("J08 · cuatro pasos en orden: Abre · Colecciona · Construye · Juega, con su frase", () => {
  assert.deepEqual([...JOURNEY_STEPS], ["open", "collect", "build", "play"]);
  assert.deepEqual(J().steps.map((s) => s.verb), ["Abre", "Colecciona", "Construye", "Juega"]);
  assert.equal(STEP_COPY.open.line, "Tu colección empieza aquí.");
  assert.equal(STEP_COPY.collect.line, "Cada carta representa un jugador real.");
  assert.equal(STEP_COPY.build.line, "Forma un equipo legal de diez cartas."); // F64 · «equipo»
  assert.equal(STEP_COPY.play.line, "Pon tu equipo a prueba.");
  assert.deepEqual(J().steps.map((s) => s.index), [1, 2, 3, 4]);
});

test("J09 · exactamente un paso actual mientras está activo; ninguno cuando está completo", () => {
  for (const j of [J(), J({ ownedCards: 5, packsOpened: 1 }), J({ ownedCards: 30, readiness: FULL }), J({ ownedCards: 30, readiness: FULL, decks: { total: 1, valid: 1, firstInvalid: null } })]) {
    assert.equal(j.steps.filter((s) => s.current).length, 1);
  }
  assert.equal(J({ matchesCompleted: 1 }).steps.filter((s) => s.current).length, 0);
});

test("J10 · primer sobre REAL: CTA a la ruta canónica /abrir/[packId] del sobre que posee", () => {
  const n = J().nextAction!;
  assert.equal(n.step, "open");
  assert.equal(n.cta, "Abrir mi primer sobre");
  assert.equal(n.href, "/abrir/inicial");
  assert.equal(J({ firstPackId: "estandar", unopenedPacks: 1 }).nextAction!.href, "/abrir/estandar");
});

test("J11 · sin sobres ni cartas: nunca se concede nada; se propone el Sobre Inicial GRATIS del catálogo real", () => {
  const n = J({ unopenedPacks: 0, firstPackId: null }).nextAction!;
  assert.equal(n.href, JOURNEY_ROUTES.freePack);
  assert.equal(n.href, "/packs/inicial");
  const pack = getPack(FREE_PACK_ID)!;
  assert.ok(pack, "el sobre existe en el catálogo");
  assert.equal(pack.price, 0, "y es gratis hoy");
});

test("J12 · abrir un sobre avanza por HECHOS (packs_opened o cartas), no por una bandera de animación", () => {
  assert.equal(J({ packsOpened: 1 }).steps[0].done, true);
  assert.equal(J({ ownedCards: 5 }).steps[0].done, true);
  assert.equal(J({ packsOpened: 0, ownedCards: 0 }).steps[0].done, false);
  const keys = Object.keys(fresh());
  assert.ok(!keys.some((k) => /animation|seen|flag|dismiss|step/i.test(k)), "ningún hecho de presentación");
});

test("J13 · COLECCIONA: con sobres pendientes, abrir el siguiente; roles que faltan en el texto; enlace a la colección", () => {
  const j = J({ packsOpened: 1, ownedCards: 5, unopenedPacks: 3, readiness: readiness({ Duelista: 2, Controlador: 2, Iniciador: 1 }) });
  const n = j.nextAction!;
  assert.equal(n.step, "collect");
  assert.equal(n.href, "/abrir/inicial");
  assert.match(n.detail, /1 Iniciador · 2 Centinela · 2 Flex/);
  assert.deepEqual(n.secondary, { label: "Ver mi colección", href: "/coleccion?tener=owned" });
});

test("J14 · COLECCIONA sin sobres: ruta gratuita (Sobre Inicial), nunca un regalo", () => {
  const n = J({ packsOpened: 4, ownedCards: 20, unopenedPacks: 0, firstPackId: null, readiness: readiness({ Duelista: 2, Controlador: 2, Iniciador: 2, Centinela: 1 }) }).nextAction!;
  assert.equal(n.cta, "Conseguir Sobre Inicial gratis");
  assert.equal(n.href, "/packs/inicial");
  assert.match(n.detail, /1 Centinela · 2 Flex/);
});

test("J15 · colección suficiente → CONSTRUYE aunque no haya abierto sobres (cartas sin sobres: se salta el sobre)", () => {
  const j = J({ ownedCards: 40, packsOpened: 0, unopenedPacks: 0, firstPackId: null, readiness: FULL });
  assert.equal(j.currentStep, "build");
  assert.deepEqual(j.completedSteps, ["open", "collect"]);
  assert.equal(j.nextAction!.cta, "Ir al constructor");
  assert.equal(j.nextAction!.href, "/duelos/mazos?nuevo=1");
});

test("J16 · equipo guardado INCOMPLETO no cuenta: se vuelve a ese equipo para terminarlo", () => {
  const j = J({ ownedCards: 40, packsOpened: 4, unopenedPacks: 0, readiness: FULL, decks: { total: 1, valid: 0, firstInvalid: { id: "d1", name: "Equipo 1", size: 7 } } });
  assert.equal(j.currentStep, "build");
  assert.equal(j.steps[2].done, false);
  assert.equal(j.nextAction!.href, "/duelos/mazos?deck=d1");
  assert.match(j.nextAction!.detail, /7\/10/);
});

test("J17 · CONSTRUYE solo se completa con un equipo GUARDADO y LEGAL (valid > 0)", () => {
  assert.equal(J({ ownedCards: 40, readiness: FULL, decks: { total: 2, valid: 0, firstInvalid: { id: "x", name: "x", size: 10 } } }).steps[2].done, false);
  assert.equal(J({ ownedCards: 40, readiness: FULL, decks: { total: 1, valid: 1, firstInvalid: null } }).steps[2].done, true);
});

test("J18 · equipo legal sin partidas → JUEGA directamente, contra el bot FÁCIL canónico en PvE (nunca ranked)", () => {
  const j = J({ ownedCards: 40, packsOpened: 4, unopenedPacks: 0, readiness: FULL, decks: { total: 1, valid: 1, firstInvalid: null }, readyDeck: { id: "d", name: "Equipo 1", cardIds: ["a"], active: true } });
  assert.equal(j.currentStep, "play");
  assert.equal(j.nextAction!.cta, "Jugar mi primer combate");
  assert.equal(j.nextAction!.href, "/duelos/jugar?dificultad=EASY&primera=1");
  assert.ok(!/pvp|competitivo|ranked|draft/i.test(j.nextAction!.href));
  assert.equal(j.nextAction!.title, "Equipo listo"); // F64 · «equipo»
  assert.deepEqual(j.context.readyDeck, { id: "d", name: "Equipo 1", cardIds: ["a"], active: true });
});

test("J19 · GANAR, PERDER o EMPATAR completan igual: el dominio solo cuenta partidas terminadas", () => {
  const keys = Object.keys(fresh());
  assert.ok(!keys.some((k) => /win|won|loss|draw|result/i.test(k)), "no existe un hecho de victoria");
  const j = J({ ownedCards: 40, readiness: FULL, decks: { total: 1, valid: 1, firstInvalid: null }, matchesCompleted: 1 });
  assert.equal(j.isComplete, true);
  assert.equal(j.justCompleted, true);
  assert.equal(j.progress.label, "4/4");
});

test("J20 · «Primera sesión completada» solo con UNA partida; con más, la home es la de siempre", () => {
  assert.equal(J({ matchesCompleted: 1 }).justCompleted, true);
  assert.equal(J({ matchesCompleted: 2 }).justCompleted, false);
  assert.equal(J({ matchesCompleted: 0 }).justCompleted, false);
});

test("J21 · partidas SIN equipo (datos legacy) → COMPLETA (contrato explícito)", () => {
  const j = J({ ownedCards: 0, packsOpened: 0, unopenedPacks: 0, firstPackId: null, matchesCompleted: 3, decks: { total: 0, valid: 0, firstInvalid: null } });
  assert.equal(j.isComplete, true);
  assert.ok(j.steps.every((s) => s.done));
});

test("J22 · equipo legal con cartas sin marcar (datos raros): lo guardado cuenta y no se vuelve atrás", () => {
  const j = J({ ownedCards: 0, packsOpened: 0, readiness: EMPTY, decks: { total: 1, valid: 1, firstInvalid: null } });
  assert.deepEqual(j.completedSteps, ["open", "collect", "build"]);
  assert.equal(j.currentStep, "play");
});

test("J23 · determinista: mismos hechos → mismo recorrido", () => {
  const f = fresh({ ownedCards: 12, packsOpened: 2, unopenedPacks: 2, readiness: readiness({ Duelista: 2, Flex: 1 }) });
  assert.deepEqual(buildPlayerJourney(f), buildPlayerJourney(structuredClone(f)));
});

test("J24 · progreso con denominador real (pasos hechos / 4) y coherente con los pasos", () => {
  for (const f of [fresh(), fresh({ ownedCards: 3 }), fresh({ ownedCards: 30, readiness: FULL }), fresh({ ownedCards: 30, readiness: FULL, decks: { total: 1, valid: 1, firstInvalid: null } }), fresh({ matchesCompleted: 1 })]) {
    const j = buildPlayerJourney(f);
    assert.equal(j.progress.value, j.steps.filter((s) => s.done).length);
    assert.equal(j.progress.max, 4);
  }
});

test("J25 · combinatoria de hechos: nunca un paso hecho detrás de uno pendiente salvo por datos legacy, y el actual es el primero pendiente", () => {
  const opts = { owned: [0, 5, 40], opened: [0, 1, 4], unopened: [0, 3], ready: [EMPTY, FULL], valid: [0, 1], matches: [0, 1, 5] };
  let n = 0;
  for (const ownedCards of opts.owned) for (const packsOpened of opts.opened) for (const unopenedPacks of opts.unopened) for (const r of opts.ready) for (const valid of opts.valid) for (const matchesCompleted of opts.matches) {
    const j = J({ ownedCards, packsOpened, unopenedPacks, firstPackId: unopenedPacks ? "inicial" : null, readiness: r, decks: { total: valid, valid, firstInvalid: null }, matchesCompleted });
    const firstPending = j.steps.find((s) => !s.done)?.id ?? null;
    assert.equal(j.currentStep, j.isComplete ? null : firstPending);
    if (j.isComplete) assert.equal(j.nextAction, null); else assert.equal(j.nextAction!.step, j.currentStep);
    if (j.nextAction) assert.ok(/^\/(abrir|packs|coleccion|duelos)\b/.test(j.nextAction.href), j.nextAction.href);
    n++;
  }
  assert.equal(n, 216);
});

// F63 · REESCRITO A PROPÓSITO: el contador es el de la guía de seis pasos (bienvenida · sobre · colección · equipo · partida · progreso).
test("J26 · eyebrow con el paso en TEXTO («Tu inicio · 3/6 · Colecciona»)", () => {
  assert.equal(J({ ownedCards: 5 }).nextAction!.eyebrow, "Tu inicio · 3/6 · Colecciona");
  assert.equal(J().nextAction!.eyebrow, "Tu inicio · 2/6 · Abre");
});

/* ───────────── primer sobre ───────────── */

test("J27 · primer sobre determinista entre los que POSEE: el inicial primero, luego el estándar, luego orden estable", () => {
  assert.equal(firstPackOf([{ packId: "estandar", qty: 1 }, { packId: "inicial", qty: 3 }]), "inicial");
  assert.equal(firstPackOf([{ packId: "premium", qty: 1 }, { packId: "estandar", qty: 1 }]), "estandar");
  assert.equal(firstPackOf([{ packId: "zeta", qty: 1 }, { packId: "alfa", qty: 2 }]), "alfa");
  assert.equal(firstPackOf([{ packId: "inicial", qty: 0 }]), null);
  assert.equal(firstPackOf([]), null);
});

/* ───────────── preparación del equipo ───────────── */

const card = (playerId: string, role: RoleId, dataVersion = "VCT-2026", combat = true): ReadinessCard => ({ playerId, role, dataVersion, combat });

test("J28 · preparación: 2 jugadores distintos por rol en una sola versión → lista", () => {
  const cat = new Map<string, ReadinessCard>();
  ROLES.forEach((r, i) => { cat.set(`a${i}`, card(`pa${i}`, r)); cat.set(`b${i}`, card(`pb${i}`, r)); });
  const r = deckReadiness([...cat.keys()], (id) => cat.get(id) ?? null);
  assert.equal(r.ready, true);
  assert.deepEqual(r.shortages, []);
});

test("J29 · variantes del MISMO jugador no cuentan dos veces (Flex real, sin comodín)", () => {
  const cat = new Map<string, ReadinessCard>();
  ROLES.forEach((r, i) => { cat.set(`a${i}`, card(`pa${i}`, r)); cat.set(`b${i}`, card(`pb${i}`, r)); });
  cat.set("b4", card("pa4", "Flex"));
  const r = deckReadiness([...cat.keys()], (id) => cat.get(id) ?? null);
  assert.equal(r.ready, false);
  assert.deepEqual(r.shortages, [{ role: "Flex", have: 1, need: 2 }]);
  // Un Duelista de más no tapa un Flex que falta.
  cat.set("extra", card("px", "Duelista"));
  assert.equal(deckReadiness([...cat.keys()], (id) => cat.get(id) ?? null).ready, false);
});

test("J30 · versiones de datos no se mezclan; cartas sin combate o desconocidas no cuentan", () => {
  const cat = new Map<string, ReadinessCard>();
  ROLES.forEach((r, i) => { cat.set(`a${i}`, card(`pa${i}`, r, "V1")); cat.set(`b${i}`, card(`pb${i}`, r, "V2")); });
  assert.equal(deckReadiness([...cat.keys()], (id) => cat.get(id) ?? null).ready, false);
  const noCombat = new Map<string, ReadinessCard>();
  ROLES.forEach((r, i) => { noCombat.set(`a${i}`, card(`pa${i}`, r)); noCombat.set(`b${i}`, card(`pb${i}`, r, "VCT-2026", false)); });
  assert.equal(deckReadiness([...noCombat.keys(), "ghost"], (id) => noCombat.get(id) ?? null).ready, false);
  assert.equal(deckReadiness([], () => null).ready, false);
  assert.equal(deckReadiness([], () => null).dataVersion, null);
});

test("J31 · preparación = `autocomplete` real del constructor sobre 1.500 colecciones aleatorias del catálogo real", () => {
  const reg = new CardRegistry();
  const cards = reg.cards;
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  let agreeReady = 0; let agreeNot = 0;
  for (let t = 0; t < 1500; t++) {
    const size = 5 + Math.floor(rnd() * 45);
    const ids = Array.from({ length: size }, () => cards[Math.floor(rnd() * cards.length)].id);
    const owned = ids.map((cardId, i) => ({ uid: `u${i}`, cardId, obtainedAt: 0 }));
    const auto = autocomplete([], indexPool(builderCollection(owned as never) as never)).ok;
    const ours = deckReadiness(ids, (id) => {
      const c = reg.card(id); const p = c ? reg.player(c.playerId) : undefined;
      return c && p ? { playerId: c.playerId, role: c.role ?? p.role, dataVersion: c.dataVersion ?? "", combat: !!c.combat } : null;
    }).ready;
    assert.equal(ours, auto, `colección ${t}`);
    if (ours) agreeReady++; else agreeNot++;
  }
  assert.ok(agreeReady > 50 && agreeNot > 50, `cobertura de ambos casos: ${agreeReady}/${agreeNot}`);
});

test("J32 · etiqueta de faltas en texto: «1 Centinela · 2 Flex»", () => {
  assert.equal(shortageLabel([{ role: "Centinela", have: 1, need: 2 }, { role: "Flex", have: 0, need: 2 }]), "1 Centinela · 2 Flex");
  assert.equal(shortageLabel([]), "");
});

/* ───────────── primer combate y destinos ───────────── */

test("J33 · reglas del primer combate = motor duel-combat-2: turno empatado sin punto; final turnos → OVR (+1) → total (sin punto) → empate", () => {
  const text = FIRST_MATCH_RULES.map((r) => r.text).join(" ");
  assert.match(text, /Si empatan, nadie puntúa/);
  assert.match(text, /suma de OVR de los equipos \(da un punto\)/); // F63 · «equipo», terminología única
  assert.match(text, /total de estadística declarada \(sin punto\)/);
  assert.match(text, /si no, empate/);
  assert.match(text, /impone la tabla del juego/);
  const resolver = readFileSync(join(process.cwd(), "src/domain/cardgame/combat/resolver.ts"), "utf8");
  assert.ok(resolver.includes('decidedBy = "OVR_TIEBREAK"') && resolver.includes("NO otorga") && resolver.includes("NO_POINT"));
  const rules = readFileSync(join(process.cwd(), "src/domain/cardgame/combat/rules.ts"), "utf8");
  assert.ok(/CURRENT_COMBAT_RULES = COMBAT_RULES_V2/.test(rules) && /finalTiebreak: "STAT_MARGIN"/.test(rules) && /encounterTie: "NO_POINT"/.test(rules));
  assert.equal(FIRST_MATCH_RULES.length, 4);
});

test("J34 · destinos tras la primera sesión: los cinco reales con una línea; ninguna ruta inventada", () => {
  assert.deepEqual(DISCOVERY.map((d) => d.id), ["campaign", "draft", "competitive", "collection", "season"]);
  for (const d of DISCOVERY) {
    const seg = d.href.split("?")[0].split("/").filter(Boolean);
    const page = join(process.cwd(), "src", "app", ...seg, "page.tsx");
    assert.ok(require("node:fs").existsSync(page), `${d.href} existe`);
    assert.ok(d.line.length > 10 && d.line.length < 80);
  }
});

test("J35 · rutas del recorrido existen en la app", () => {
  const fs = require("node:fs") as typeof import("node:fs");
  const exists = (href: string) => {
    let dir = join(process.cwd(), "src", "app");
    for (const seg of href.split(/[?#]/)[0].split("/").filter(Boolean)) {
      if (fs.existsSync(join(dir, seg))) { dir = join(dir, seg); continue; }
      const dyn = fs.readdirSync(dir).find((x) => /^\[[^.\]]+\]$/.test(x));
      if (!dyn) return false;
      dir = join(dir, dyn);
    }
    return fs.existsSync(join(dir, "page.tsx"));
  };
  for (const href of [JOURNEY_ROUTES.packRoute("inicial"), JOURNEY_ROUTES.freePack, JOURNEY_ROUTES.collection, JOURNEY_ROUTES.newDeck, JOURNEY_ROUTES.editDeck("x"), JOURNEY_ROUTES.firstMatch, JOURNEY_ROUTES.play]) {
    assert.ok(exists(href), href);
  }
});
