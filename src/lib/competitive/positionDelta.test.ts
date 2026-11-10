/**
 * RESULTADO ÚNICO · el cambio de puesto de una clasificatoria, guardado en la sesión del navegador por la página PvP y
 * leído por el centro Competitivo. Solo con las dos fotos de la escalera; nunca se inventa; nunca cruza de cuenta.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { positionDeltaFrom, readPositionDelta, savePositionDelta, validPositionDelta } from "./positionDelta";

const M = "11111111-2222-4333-8444-555555555555";
const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";

function withSession<T>(fn: (store: Map<string, string>) => T): T {
  const store = new Map<string, string>();
  const ss = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, String(v)) };
  const g = globalThis as unknown as { window?: unknown };
  const had = "window" in g; const prev = g.window;
  g.window = { sessionStorage: ss };
  try { return fn(store); } finally { if (had) g.window = prev; else delete g.window; }
}

test("PD-1 · sin las dos fotos (o fuera del Top) no hay cambio", () => {
  assert.equal(positionDeltaFrom(null), null);
  assert.equal(positionDeltaFrom(undefined), null);
  assert.equal(positionDeltaFrom({ positions: null, after: { position: 9 } }), null, "recarga a mitad de partida: sin foto previa");
  assert.equal(positionDeltaFrom({ positions: 5, after: { position: null } }), null, "fuera del Top");
  assert.deepEqual(positionDeltaFrom({ positions: 5, after: { position: 9 } }), { positions: 5, position: 9 });
  assert.deepEqual(positionDeltaFrom({ positions: 0, after: { position: 9 } }), { positions: 0, position: 9 }, "mantenerse también es un dato");
  assert.deepEqual(positionDeltaFrom({ positions: -3, after: { position: 12 } }), { positions: -3, position: 12 });
});

test("PD-2 · solo enteros y un puesto real", () => {
  for (const bad of [null, {}, { positions: 1.5, position: 9 }, { positions: 2, position: 0 }, { positions: "2", position: 9 }, { positions: 2, position: Number.NaN }]) {
    assert.equal(validPositionDelta(bad), false, JSON.stringify(bad));
  }
});

test("PD-3 · se guarda en la SESIÓN por cuenta y partida y se lee igual; lo dañado, ajeno o sin cuenta no se lee", () => {
  withSession((store) => {
    savePositionDelta(A, M, { positions: 5, position: 9 });
    assert.equal(store.get(`drl:ladder-delta:${A}:${M}`), JSON.stringify({ positions: 5, position: 9 }));
    assert.deepEqual(readPositionDelta(A, M), { positions: 5, position: 9 });
    assert.equal(readPositionDelta(A, "99999999-2222-4333-8444-555555555555"), null, "otra partida: nada");
    savePositionDelta(A, M, null);
    assert.deepEqual(readPositionDelta(A, M), { positions: 5, position: 9 }, "sin dato no se sobrescribe");
    savePositionDelta(A, "no-es-un-id", { positions: 1, position: 1 });
    savePositionDelta(null, M, { positions: 1, position: 1 });
    savePositionDelta("no-es-un-id", M, { positions: 1, position: 1 });
    assert.equal([...store.keys()].length, 1, "sin cuenta o con ids raros no se guarda nada");
    assert.equal(readPositionDelta(null, M), null);
    store.set(`drl:ladder-delta:${A}:${M}`, "{roto");
    assert.equal(readPositionDelta(A, M), null);
    store.set(`drl:ladder-delta:${A}:${M}`, JSON.stringify({ positions: 3, position: 0 }));
    assert.equal(readPositionDelta(A, M), null, "un puesto imposible no se enseña");
  });
  assert.equal(readPositionDelta(A, M), null, "sin navegador no hay sesión");
});

test("PD-4 · AISLAMIENTO: dos cuentas que jugaron LA MISMA partida en la misma pestaña no ven el puesto de la otra", () => {
  withSession(() => {
    savePositionDelta(A, M, { positions: 5, position: 9 });
    assert.equal(readPositionDelta(B, M), null, "B no lee el cambio de A aunque la partida sea la misma");
    savePositionDelta(B, M, { positions: -2, position: 40 });
    assert.deepEqual(readPositionDelta(A, M), { positions: 5, position: 9 });
    assert.deepEqual(readPositionDelta(B, M), { positions: -2, position: 40 });
  });
});

test("PD-5 · la página PvP guarda con la cuenta de la sesión, tras la segunda foto y nunca en privado", () => {
  const page = readFileSync(join(process.cwd(), "src/app/duelos/pvp/page.tsx"), "utf8");
  // La cuenta de la sesión sale de `useAuth()` (con o sin otros campos, p. ej. el `profile` de la cola 0078).
  assert.ok(/const \{[^}]*\buser: yo\b[^}]*\} = useAuth\(\);/.test(page));
  assert.ok(page.includes("const id = matchId, cuenta = yo?.id ?? null;") && page.includes("void endLadder().then((d) => savePositionDelta(cuenta, id, positionDeltaFrom(d)));"));
  assert.ok(page.includes('if (snap.mode === "PVP_PRIVATE") return; // Fase 29: la escalera no se mueve en un duelo privado.'), "sin foto previa en privado → sin cambio");
  assert.ok(!/localStorage/.test(readFileSync(join(process.cwd(), "src/lib/competitive/positionDelta.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")), "sesión, no almacenamiento permanente");
});
