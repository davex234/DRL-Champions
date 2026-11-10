/**
 * FASE 65 · BALANCE LAB — el laboratorio es reproducible, juega mazos legales con el motor real, agrega bien y no escribe.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  catalogCards, labSnapshot, randomDeck, scoredDeck, pveOpponentDeck, playMatch, shadowDecision, isLegalDeck,
  STRATEGIES, POLICIES, wilson, meanCi, shrink, pearson, add, mergeTallies, type Tally,
} from "./lab";
import { createRng } from "@/domain/cardgame/opponent";
import { autocomplete, indexPool, type BuilderCard } from "@/domain/deckBuilder/builder";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8").replace(/\r\n/g, "\n");
const pool = catalogCards();
const decks = (() => { let r = createRng(65); return Array.from({ length: 40 }, () => { const d = randomDeck(r, pool); r = d.rng; return d.cardIds; }); })();

test("F65 LAB 01 · el catálogo entero entra en el laboratorio (331 cartas, todas con trío de combate)", () => {
  assert.equal(pool.length, 331);
  assert.ok(pool.every((c) => [c.combat.stronghold, c.combat.gamesense, c.combat.entryfrag].every(Number.isFinite)));
});

test("F65 LAB 02 · reproducibilidad: misma semilla ⇒ misma partida; otra semilla ⇒ otra partida (motor real)", () => {
  const a = labSnapshot(decks[0], "a"), b = labSnapshot(decks[1], "b");
  for (const p of POLICIES) assert.deepEqual(playMatch(a, b, p, p, "A", 123), playMatch(a, b, p, p, "A", 123), p);
  const outs = new Set(Array.from({ length: 30 }, (_, i) => JSON.stringify(playMatch(a, b, "NORMAL", "NORMAL", "A", i + 1).encounters)));
  assert.ok(outs.size > 20, "semillas distintas producen partidas distintas");
});

test("F65 LAB 03 · generación: aleatorios, por estrategia y rival de PvE pasan SIEMPRE el validador canónico", () => {
  let r = createRng(7);
  for (let i = 0; i < 500; i++) { const d = randomDeck(r, pool); r = d.rng; assert.ok(isLegalDeck(d.cardIds).valid, `aleatorio ${i}`); }
  for (const [name, s] of Object.entries(STRATEGIES)) {
    assert.ok(isLegalDeck(scoredDeck(pool, s).cardIds).valid, name);
    let rr = createRng(3); for (let v = 0; v < 10; v++) { const d = scoredDeck(pool, s, { rng: rr, noise: 6 }); rr = d.rng!; assert.ok(isLegalDeck(d.cardIds).valid, `${name}~${v}`); }
  }
  for (const target of [700, 800, 850, 900, 950]) assert.ok(isLegalDeck(pveOpponentDeck(target, pool)).valid, `pve ${target}`);
});

test("F65 LAB 04 · OVR_MAX del laboratorio = `autocomplete` real del constructor (mismo total de OVR)", () => {
  const b: BuilderCard[] = pool.map((c) => ({ uid: c.cardId, cardId: c.cardId, playerId: c.playerId, nick: c.playerName, team: c.team, country: "", role: c.role, region: c.region, variantId: c.variantId, ovr: c.ovr, combat: c.combat, serial: null, dataVersion: c.dataVersion, statBoost: c.statBoost, obtainedAt: 0 }));
  const auto = autocomplete([], indexPool(b));
  assert.ok(auto.ok);
  const sum = (ids: readonly string[]) => ids.reduce((s, id) => s + pool.find((c) => c.cardId === id)!.ovr, 0);
  assert.equal(sum(scoredDeck(pool, STRATEGIES.OVR_MAX).cardIds), sum(auto.ok ? auto.uids : []));
});

test("F65 LAB 05 · el rival de PvE copia el algoritmo de `buildOpponentDeck` (huella del código del servidor)", () => {
  const s = read("src", "server", "services", "duels.ts");
  const body = s.slice(s.indexOf("function buildOpponentDeck"), s.indexOf("// Instancias sintéticas del rival"));
  // Si cambia el servidor, este laboratorio debe revisarse (pveOpponentDeck) y la huella actualizarse a propósito.
  assert.equal(createHash("sha256").update(body).digest("hex"), "3d40e7bf2df784afed0718f51d4d88739d98935358663c1f31948680eadac24f");
});

test("F65 LAB 06 · desempate en sombra CURRENT = decisión del motor en todas las partidas", () => {
  for (let i = 0; i < 300; i++) {
    const m = playMatch(labSnapshot(decks[i % 40], "x"), labSnapshot(decks[(i * 7 + 1) % 40], "y"), "HARD", "HARD", i % 2 ? "A" : "B", i + 1);
    const s = shadowDecision(m, "CURRENT");
    assert.equal(s.winner, m.winner);
    assert.equal(s.by === "DRAW" ? "NONE" : s.by, m.decidedBy);
    assert.ok(m.integrityOk);
  }
});

test("F65 LAB 07 · cambio de lado: el primer atacante es lo único que cambia y la partida sigue siendo legal", () => {
  const a = labSnapshot(decks[2], "a"), b = labSnapshot(decks[3], "b");
  const m1 = playMatch(a, b, "HARD", "HARD", "A", 99), m2 = playMatch(a, b, "HARD", "HARD", "B", 99);
  assert.equal(m1.encounters[0].attacker, "A"); assert.equal(m2.encounters[0].attacker, "B");
  for (const m of [m1, m2]) {
    assert.equal(m.encounters.length, 10);
    assert.deepEqual(m.encounters.map((e) => e.attacker), Array.from({ length: 10 }, (_, i) => ((i % 2 === 0) === (m.first === "A") ? "A" : "B")));
  }
});

test("F65 LAB 08 · sustitución emparejada: la misma carta contra sí misma da diferencia 0 exacta", () => {
  const opp = labSnapshot(decks[5], "o");
  for (let i = 0; i < 50; i++) {
    const d = playMatch(labSnapshot(decks[4], "p"), opp, "HARD", "HARD", "A", i + 1).winner;
    assert.equal(playMatch(labSnapshot(decks[4], "p"), opp, "HARD", "HARD", "A", i + 1).winner, d);
  }
});

test("F65 LAB 09 · intervalos: Wilson y media con IC desde sumas (streaming) coinciden con el cálculo directo", () => {
  const w = wilson(50, 100);
  assert.ok(Math.abs(w.lo - 0.4038) < 1e-3 && Math.abs(w.hi - 0.5962) < 1e-3);
  assert.deepEqual(wilson(0, 10).lo, 0);
  const xs = [1, -1, 0, 0.5, 1, 0, -0.5, 1];
  const n = xs.length, sum = xs.reduce((s, x) => s + x, 0), sq = xs.reduce((s, x) => s + x * x, 0);
  const m = meanCi(n, sum, sq);
  const mean = sum / n, sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1));
  assert.ok(Math.abs(m.mean - mean) < 1e-12 && Math.abs(m.sd - sd) < 1e-12);
  assert.ok(Math.abs(pearson([1, 2, 3], [2, 4, 6]) - 1) < 1e-12);
});

test("F65 LAB 10 · agregación: fusionar fragmentos = agregar todo de una vez; contracción no infla el ruido", () => {
  const whole: Tally = {}, p1: Tally = {}, p2: Tally = {};
  for (let i = 0; i < 100; i++) { add(whole, `k${i % 7}`, i); add(i < 40 ? p1 : p2, `k${i % 7}`, i); }
  assert.deepEqual(mergeTallies(mergeTallies({}, p1), p2), whole);
  const noisy = shrink([{ mean: 0.3, se: 0.3 }, { mean: -0.3, se: 0.3 }, { mean: 0, se: 0.3 }]);
  assert.equal(noisy.tau2, 0); assert.ok(noisy.shrunk.every((x) => Math.abs(x - noisy.grand) < 1e-12));
  const real = shrink([{ mean: 0.3, se: 0.01 }, { mean: -0.3, se: 0.01 }, { mean: 0, se: 0.01 }]);
  assert.ok(Math.abs(real.shrunk[0] - 0.3) < 0.01);
});

test("F65 LAB 11 · sin BD, sin red y sin reloj: el laboratorio y el script solo importan dominio puro", () => {
  for (const f of [read("src", "domain", "balance", "lab.ts"), read("scripts", "balance", "simulate.ts")]) {
    const imports = [...f.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    assert.ok(imports.every((i) => !/supabase|server\/|@\/app|next/.test(i)), imports.join(" "));
    assert.doesNotMatch(f, /\bfetch\(|createClient|\.insert\(|\.update\(|\.upsert\(|\.rpc\(/);
  }
  const lab = read("src", "domain", "balance", "lab.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(lab, /Math\.random|Date\.now|new Date/);
});
