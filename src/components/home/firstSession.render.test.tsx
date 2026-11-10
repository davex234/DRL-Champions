/**
 * RESULTADO ÚNICO · «Primera sesión completada» trasladada al lobby (`MainMenu`): misma foto del vestíbulo, sin
 * peticiones nuevas, una vez por cuenta y navegador.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { DailyLoopSnapshot } from "@/domain/dailyLoop";
import { FirstSessionDiscovery, firstSessionSeen, markFirstSessionSeen, shouldShowFirstSession } from "./FirstSessionDiscovery";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const U = "user-qa-1";
/* Solo los campos que lee `homeJourneyMode`; el resto de la foto no interviene en esta decisión. */
const snap = (j: { isComplete: boolean; justCompleted: boolean } | null, signedIn = true) =>
  ({ signedIn, journey: j, primaryAction: { id: "play" }, live: null }) as unknown as DailyLoopSnapshot;

function withStorage<T>(fn: () => T): T {
  const store = new Map<string, string>();
  const ls = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, String(v)) };
  const g = globalThis as unknown as { window?: unknown };
  const had = "window" in g; const prev = g.window;
  g.window = { localStorage: ls };
  try { return fn(); } finally { if (had) g.window = prev; else delete g.window; }
}

test("FS-1 · se enseña SOLO con la primera sesión recién completada (dato del servidor), con sesión y sin marca", () => {
  const never = () => false;
  assert.equal(shouldShowFirstSession(snap({ isComplete: true, justCompleted: true }), U, never), true);
  assert.equal(shouldShowFirstSession(snap({ isComplete: true, justCompleted: false }), U, never), false, "segunda partida en adelante");
  assert.equal(shouldShowFirstSession(snap({ isComplete: false, justCompleted: false }), U, never), false, "recorrido en curso");
  assert.equal(shouldShowFirstSession(snap(null), U, never), false, "sin recorrido en la foto");
  assert.equal(shouldShowFirstSession(snap({ isComplete: true, justCompleted: true }, false), U, never), false, "sin sesión");
  assert.equal(shouldShowFirstSession(snap({ isComplete: true, justCompleted: true }), null, never), false, "sin cuenta conocida");
  assert.equal(shouldShowFirstSession(snap({ isComplete: true, justCompleted: true }), U, () => true), false, "ya vista");
});

test("FS-2 · una vez por cuenta: tras enseñarla queda marcada; otra cuenta en el mismo navegador sí la ve", () => {
  withStorage(() => {
    const s = snap({ isComplete: true, justCompleted: true });
    assert.equal(shouldShowFirstSession(s, U, firstSessionSeen), true);
    markFirstSessionSeen(U);
    assert.equal(firstSessionSeen(U), true);
    assert.equal(shouldShowFirstSession(s, U, firstSessionSeen), false, "no aparece repetidamente");
    assert.equal(shouldShowFirstSession(s, "user-qa-2", firstSessionSeen), true);
  });
});

test("FS-3 · en servidor no pinta nada (se decide en el navegador tras montar)", () => {
  assert.equal(renderToStaticMarkup(<FirstSessionDiscovery snap={snap({ isComplete: true, justCompleted: true })} userKey={U} />), "");
});

test("FS-4 · el lobby la monta con la MISMA foto y sin peticiones nuevas; se marca al enseñarla", () => {
  const comp = code(read("src", "components", "home", "FirstSessionDiscovery.tsx"));
  assert.ok(!/fetch\(|fetchDailyLoop|useDailyLoop|\/api\//.test(comp), "sin lecturas nuevas");
  assert.ok(comp.includes("<JourneyDiscovery items={discoveryItems(snap)} offline={offline} />"), "los destinos de siempre");
  assert.ok(comp.includes("setOpenFor(userKey);\n    markFirstSessionSeen(userKey);"));
  assert.ok(comp.includes("useDialogLayer(open, () => setOpenFor(null), true, panel);"), "capa con foco, Escape y tabulador atrapado");
  const menu = read("src", "components", "home", "MainMenu.tsx");
  assert.ok(menu.includes('{signedIn && <FirstSessionDiscovery snap={snap} userKey={userKey} offline={network !== "online"} />}'));
  assert.ok(read("src", "app", "page.tsx").includes("userKey={user?.id ?? null}"));
});

test("FS-5 · la progresión no cambia: la foto sigue diciendo «recién completada» por la primera partida y el servidor la decide", () => {
  assert.ok(read("src", "domain", "journey", "index.ts").includes("justCompleted: f.matchesCompleted === 1"));
});

test("FS-6 · cambio de cuenta: la capa es de la cuenta para la que se abrió, y la foto de la cuenta anterior no decide", () => {
  const comp = code(read("src", "components", "home", "FirstSessionDiscovery.tsx"));
  assert.ok(comp.includes("const open = openFor !== null && openFor === userKey;"), "si cambia la cuenta, la capa de la anterior se cierra");
  assert.ok(comp.includes("if (prev && prev.userKey !== userKey && prev.snap === snap) return;"), "la foto que había antes del cambio no cuenta para la cuenta nueva");
});

test("FS-7 · el vestíbulo descarta una respuesta que llega cuando la sesión ya es de OTRA cuenta (y no bloquea la nueva)", () => {
  const hook = code(read("src", "lib", "dailyLoop", "client.ts"));
  assert.ok(hook.includes("const key = owner.current;") && hook.includes("if (!enabled || inflight.current === key) return;"), "el cerrojo es por cuenta");
  assert.ok(hook.includes("if (!alive.current || owner.current !== key) return;\n      setSnap(r.data);"), "respuesta de otra cuenta: se descarta");
  assert.ok(hook.includes("setSnap(null); setClock(null); setStale(false); setStatus(\"loading\");"), "al cambiar de cuenta se vacía la foto");
});
