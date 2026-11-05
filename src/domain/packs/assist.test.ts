/**
 * FASE 41 · `openPack` CON ASISTENCIA DE PRIMER EQUIPO: inerte si no llega, solo roles que faltan y jugadores nuevos en
 * los huecos asistidos, misma rareza, determinista y con repliegue si no hay candidatos.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CardRegistry } from "@/collection/registry";
import { getPack } from "@/data/packs";
import { freshPity } from "./pity";
import { openPack, type StarterAssist } from "./openPack";
import { BUCKET_INDEX } from "./pool";

const REG = new CardRegistry();
const INICIAL = getPack("inicial")!;
const ESTANDAR = getPack("estandar")!;
const roleOf = (cardId: string) => { const c = REG.card(cardId)!; return c.role ?? REG.player(c.playerId)!.role; };
const ctx = (seed: number, assist?: StarterAssist | null) => ({ seed, owned: new Set<string>(), pity: freshPity(), assist });

test("sin `assist` (o null) el sorteo es idéntico al de antes, semilla a semilla", () => {
  for (let seed = 1; seed <= 300; seed++) {
    const a = openPack(REG, INICIAL, ctx(seed)).decisions.map((d) => d.card.id);
    const b = openPack(REG, INICIAL, ctx(seed, null)).decisions.map((d) => d.card.id);
    assert.deepEqual(a, b);
  }
});

test("huecos asistidos: rol que falta y jugador que no tiene", () => {
  for (let seed = 1; seed <= 400; seed++) {
    const assist: StarterAssist = { slots: 2, needByRole: { Centinela: 2, Flex: 1 }, ownedPlayers: new Set() };
    const d = openPack(REG, INICIAL, ctx(seed, assist)).decisions;
    assert.equal(d.length, 5);
    const first = d.slice(0, 2).map((x) => roleOf(x.card.id));
    // El primero siempre es de un rol que falta; el segundo también salvo que el primero ya cubriera el único Flex y
    // quede Centinela (sigue siendo rol que falta).
    for (const r of first) assert.ok(r === "Centinela" || r === "Flex", `semilla ${seed}: ${r}`);
    assert.notEqual(d[0].card.playerId, d[1].card.playerId, "dos jugadores distintos");
  }
});

test("huecos no asistidos (3.º–5.º) siguen el sorteo normal (cualquier rol aparece)", () => {
  const roles = new Set<string>();
  for (let seed = 1; seed <= 300; seed++) {
    const d = openPack(REG, INICIAL, ctx(seed, { slots: 2, needByRole: { Centinela: 2 }, ownedPlayers: new Set() })).decisions;
    for (const x of d.slice(2)) roles.add(roleOf(x.card.id));
  }
  assert.ok(roles.size >= 4);
});

test("jugadores ya poseídos nunca salen en un hueco asistido", () => {
  const owned = new Set(REG.cards.filter((c) => (c.role ?? REG.player(c.playerId)?.role) === "Centinela").slice(0, 40).map((c) => c.playerId));
  for (let seed = 1; seed <= 300; seed++) {
    const d = openPack(REG, INICIAL, ctx(seed, { slots: 2, needByRole: { Centinela: 2 }, ownedPlayers: owned })).decisions;
    for (const x of d.slice(0, 2)) if (roleOf(x.card.id) === "Centinela") assert.ok(!owned.has(x.card.playerId));
  }
});

test("rareza: la asistencia no sube la rareza (frecuencia de común en huecos asistidos ≈ pesos del Sobre Inicial)", () => {
  let commons = 0; let n = 0; let high = 0;
  for (let seed = 1; seed <= 4000; seed++) {
    const d = openPack(REG, INICIAL, ctx(seed, { slots: 2, needByRole: { Duelista: 2, Controlador: 2, Iniciador: 2, Centinela: 2, Flex: 2 }, ownedPlayers: new Set() })).decisions;
    for (const x of d.slice(0, 2)) { n++; if (x.bucket === "common") commons++; if (BUCKET_INDEX[x.bucket] >= BUCKET_INDEX.epic) high++; }
  }
  const pc = commons / n;
  assert.ok(pc > 0.6 && pc < 0.8, `común ${pc}`);
  assert.ok(high / n < 0.02, `épica+ ${high / n}`);
});

test("sin candidatos (todos los jugadores del rol poseídos) → hueco normal, nunca vacío", () => {
  const all = new Set(REG.cards.map((c) => c.playerId));
  for (let seed = 1; seed <= 50; seed++) {
    const d = openPack(REG, INICIAL, ctx(seed, { slots: 2, needByRole: { Flex: 2 }, ownedPlayers: all })).decisions;
    assert.equal(d.length, 5);
  }
});

test("determinista: misma semilla y misma asistencia ⇒ mismas cartas", () => {
  const assist = (): StarterAssist => ({ slots: 2, needByRole: { Iniciador: 1, Flex: 2 }, ownedPlayers: new Set() });
  for (let seed = 1; seed <= 100; seed++) {
    assert.deepEqual(openPack(REG, INICIAL, ctx(seed, assist())).decisions.map((d) => d.card.id), openPack(REG, INICIAL, ctx(seed, assist())).decisions.map((d) => d.card.id));
  }
});

test("la necesidad se consume: con 1 Flex pendiente, el 2.º hueco no repite rol cubierto", () => {
  for (let seed = 1; seed <= 300; seed++) {
    const d = openPack(REG, INICIAL, ctx(seed, { slots: 2, needByRole: { Flex: 1, Centinela: 1 }, ownedPlayers: new Set() })).decisions;
    const [r0, r1] = [roleOf(d[0].card.id), roleOf(d[1].card.id)];
    assert.notEqual(r0, r1, `semilla ${seed}: ${r0} ${r1}`);
  }
});

test("slots 0 = inerte", () => {
  for (let seed = 1; seed <= 100; seed++) {
    assert.deepEqual(openPack(REG, INICIAL, ctx(seed, { slots: 0, needByRole: { Flex: 2 }, ownedPlayers: new Set() })).decisions.map((d) => d.card.id), openPack(REG, INICIAL, ctx(seed)).decisions.map((d) => d.card.id));
  }
});

test("necesidad vacía = inerte", () => {
  for (let seed = 1; seed <= 100; seed++) {
    assert.deepEqual(openPack(REG, ESTANDAR, ctx(seed, { slots: 2, needByRole: {}, ownedPlayers: new Set() })).decisions.map((d) => d.card.id), openPack(REG, ESTANDAR, ctx(seed)).decisions.map((d) => d.card.id));
  }
});
