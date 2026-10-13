/**
 * F81.1 · INTEGRIDAD DE LA APERTURA EN PRODUCCIÓN — ninguna apertura local/falsa con cuenta; resultado del servidor
 * presentado EXACTAMENTE (ni filtrado, ni completado); fallos del servidor → error/reintento, nunca cartas.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CARDS, getCard, getPlayer } from "@/data/catalog";
import { LOCAL_ECONOMY_BLOCKED, SESSION_KEY_RE, localEconomyBlockReason, storedSessionPresent } from "./localEconomy";
import { INVALID_OPEN_RESULT, toOpenedResults } from "./sync";
import { buildRevealPlan, classifyOpenFailure, toOpenedInstances, selectHero } from "@/domain/packs/reveal";
import { useGameStore } from "@/store/useGameStore";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const fakeStorage = (keys: string[]) => ({ length: keys.length, key: (i: number) => keys[i] ?? null });
const CAT = { cards: CARDS, getCard, getPlayer };
const dto = (cardId: string, uid: string) => ({ uid, cardId, serial: null, mintedVersion: 1, isNew: true, value: 0, bucket: "common", byPity: false });

test("F81.1 · motor local PROHIBIDO con backend + sesión guardada (aunque React diga «sin usuario»)", () => {
  assert.equal(localEconomyBlockReason({ configured: true, storage: fakeStorage(["sb-valorosters-auth-token"]) }), LOCAL_ECONOMY_BLOCKED);
  assert.equal(localEconomyBlockReason({ configured: true, storage: fakeStorage(["sb-x-auth-token.0", "sb-x-auth-token.1"]) }), LOCAL_ECONOMY_BLOCKED, "sesión troceada");
  assert.equal(localEconomyBlockReason({ configured: true, storage: fakeStorage([]), signedIn: true }), LOCAL_ECONOMY_BLOCKED, "usuario o sesión resolviéndose");
  // Visitante de verdad (sin rastro de sesión) o build sin backend: el modo local de demostración sigue.
  assert.equal(localEconomyBlockReason({ configured: true, storage: fakeStorage(["drl-champions"]) }), null);
  assert.equal(localEconomyBlockReason({ configured: false, storage: fakeStorage(["sb-x-auth-token"]), signedIn: true }), null);
  assert.ok(SESSION_KEY_RE.test("sb-valorosters-auth-token") && !SESSION_KEY_RE.test("drl-champions"));
  assert.equal(storedSessionPresent(null), false);
});

test("F81.1 · ESTRUCTURAL: el store, con backend y sesión guardada, LANZA en vez de abrir (y no compra) — proceso real", () => {
  const script = `
    globalThis.window = globalThis;
    const keys = { "sb-valorosters-auth-token": "{}" };
    globalThis.localStorage = { get length() { return Object.keys(keys).length; }, key: (i) => Object.keys(keys)[i] ?? null, getItem: (k) => keys[k] ?? null, setItem: (k, v) => { keys[k] = String(v); }, removeItem: (k) => { delete keys[k]; } };
    const { useGameStore } = await import(${JSON.stringify("file:///" + join(ROOT, "src/store/useGameStore.ts").replace(/\\/g, "/"))});
    const s = useGameStore.getState();
    const before = JSON.stringify({ packs: s.unopenedPacks, cards: s.ownedCards.length, credits: s.credits });
    let threw = "";
    try { s.openPackFromInventory("inicial"); } catch (e) { threw = e.name; }
    const buy = s.buyPack("estandar");
    const a = useGameStore.getState();
    console.log(JSON.stringify({ threw, buy, before, after: JSON.stringify({ packs: a.unopenedPacks, cards: a.ownedCards.length, credits: a.credits }), lastOpened: a.lastOpened }));
  `;
  const r = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    cwd: ROOT, encoding: "utf8", env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "https://valorosters.example", NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key" },
  });
  const line = r.stdout.trim().split(/\r?\n/).pop() ?? "";
  assert.ok(line.startsWith("{"), `salida: ${r.stdout}\n${r.stderr}`);
  const out = JSON.parse(line);
  assert.equal(out.threw, "LocalEconomyBlockedError", "abrir en local LANZA");
  assert.equal(out.buy.ok, false); assert.equal(out.buy.error, LOCAL_ECONOMY_BLOCKED);
  assert.equal(out.after, out.before, "ni inventario, ni cartas, ni saldo cambian");
  assert.equal(out.lastOpened, null, "ninguna apertura queda para la ceremonia");
});

test("F81.1 · la ceremonia: con sesión SOLO servidor; el camino local está detrás de la barrera del store y nunca tras un fallo del servidor", () => {
  const exp = code(read("src/components/packs/PackOpeningExperience.tsx"));
  const trig = exp.slice(exp.indexOf("const triggerOpen"), exp.indexOf("}, [online, serverEconomy, openFromInventory")); // cuerpo, sin la lista de dependencias
  const iOnline = trig.indexOf("} else if (online) {"), iServer = trig.indexOf("await openPackOutcome(packId)"), iLocal = trig.indexOf("openFromInventory(packId)"), iCatch = trig.indexOf("} catch (e) {");
  assert.ok(iOnline > 0 && iServer > iOnline && iLocal > iServer && iCatch > iLocal, "online → servidor; local solo en la otra rama");
  assert.ok(!/openFromInventory/.test(trig.slice(iCatch)), "un fallo del servidor NUNCA cae al motor local");
  assert.ok(/if \(serverEconomy\) throw new Error\(SESSION_PENDING\);\s*res = openFromInventory\(packId\);/.test(trig), "sesión resolviéndose → error");
  const store = code(read("src/store/useGameStore.ts"));
  assert.match(store, /openPackFromInventory: \(packId\) => \{\s*if \(localEconomyBlockReason\(\)\) throw new LocalEconomyBlockedError\(\);/);
  assert.match(store, /buyPack: \(packId\) => \{\s*const blocked = localEconomyBlockReason\(\);\s*if \(blocked\) return \{ ok: false, error: blocked \};/);
});

test("F81.1 · el inventario que ve la UI ES el del servidor (Sobre Inicial incluido): sin filtro ni segunda fuente", () => {
  const prev = useGameStore.getState();
  useGameStore.getState().applyServerState({ credits: 2120, xp: 0, ownedCards: [], origins: {}, lockedUids: [], unopenedPacks: { inicial: 1 }, pityState: prev.pityState, packsOpened: 7, mintCounts: {} });
  assert.deepEqual(useGameStore.getState().unopenedPacks, { inicial: 1 });
  assert.equal(useGameStore.getState().unopenedPacks.inicial ?? 0, 1, "la pantalla de apertura lee esto (`available`)");
  assert.match(read("src/lib/game/sync.ts"), /unopenedPacks: state\.unopenedPacks,/);
  assert.match(read("src/components/packs/PackOpeningExperience.tsx"), /const available = useGameStore\(\(s\) => s\.unopenedPacks\[packId\] \?\? 0\);/);
});

test("F81.1 · resultado del servidor: se presenta EXACTO (ids y multiplicidad); vacío, desconocido, sin id o repetido → ERROR", () => {
  const [a, b] = [CARDS[0], CARDS[1]];
  const ok = toOpenedResults([dto(a.id, "u1"), dto(b.id, "u2"), dto(a.id, "u3")]);
  assert.deepEqual(ok.map((r) => [r.uid, r.card.id]), [["u1", a.id], ["u2", b.id], ["u3", a.id]], "mismo orden, mismas cartas, dos copias = dos entradas");
  for (const bad of [[], null, undefined, "x", [dto("no-existe__en-catalogo", "u1")], [{ uid: "", cardId: a.id }], [{ uid: "u1" }], [dto(a.id, "u1"), dto(b.id, "u1")]]) {
    assert.throws(() => toOpenedResults(bad), (e: Error) => e.message.startsWith(INVALID_OPEN_RESULT), JSON.stringify(bad));
  }
});

test("F81.1 · fallos del servidor → error con reintento seguro, nunca cartas: 500, timeout, red, no-poseído, inválido, sesión", () => {
  assert.equal(classifyOpenFailure(new Error("No se pudo completar la operación")).kind, "SERVER");
  assert.equal(classifyOpenFailure(new Error("No se pudo completar la operación")).retrySameKey, true);
  const timeout = new Error("signal timed out"); timeout.name = "TimeoutError";
  assert.equal(classifyOpenFailure(timeout).kind, "NETWORK");
  assert.equal(classifyOpenFailure(new TypeError("Failed to fetch")).kind, "NETWORK");
  assert.equal(classifyOpenFailure(new Error("No tienes ese sobre")).kind, "NO_PACK");
  assert.equal(classifyOpenFailure(new Error(`${INVALID_OPEN_RESULT}: carta desconocida`)).kind, "INVALID");
  assert.equal(classifyOpenFailure(new Error(LOCAL_ECONOMY_BLOCKED)).kind, "SESSION");
  // La red de la apertura tiene tope: una petición colgada termina en error, no en «abriendo…» para siempre.
  assert.match(read("src/lib/game/client.ts"), /\{ action: "open", packId, ref \}, OPEN_TIMEOUT_MS\)/);
});

test("F81.1 · lo que se muestra = el resultado autoritativo (hero ∈ resultado y = OVR máximo; resto y resumen = las mismas instancias)", () => {
  const picks = [CARDS[3], CARDS[10], CARDS[3], CARDS[40], CARDS[77]];
  const results = toOpenedResults(picks.map((c, i) => dto(c.id, `srv-${i}`)));
  const plan = buildRevealPlan(toOpenedInstances(results), [], CAT);
  const key = (xs: { uid: string; cardId: string }[]) => xs.map((x) => `${x.uid}:${x.cardId}`).sort();
  assert.deepEqual(key(plan.order), key(results.map((r) => ({ uid: r.uid, cardId: r.card.id }))), "orden de presentación = resultado (multiset)");
  assert.deepEqual(key(plan.items), key(plan.order));
  const hero = selectHero(plan.items);
  assert.ok(hero.ok);
  const max = Math.max(...results.map((r) => getCard(r.card.id)!.ovr));
  assert.equal(hero.ok && hero.hero.card.ovr, max);
  assert.ok(hero.ok && results.some((r) => r.uid === hero.hero.uid), "la hero es una instancia del resultado");
  assert.equal(plan.order.filter((i) => i.cardId === CARDS[3].id).length, 2, "multiplicidad conservada");
});

test("F81.1 · recargar no reabre: la recuperación lee lo guardado o repite la MISMA clave", () => {
  const exp = code(read("src/components/packs/PackOpeningExperience.tsx"));
  // Recarga con el revelado guardado → se marca abierto ANTES de pintarlo (nunca se reabre).
  const i = exp.indexOf("const saved = loadOpenReveal(packId,");
  const block = exp.slice(i, i + 260);
  assert.ok(i > 0 && block.indexOf("opened.current = true;") > 0 && block.indexOf("opened.current = true;") < block.indexOf("setResults(saved);"), "se marca abierto ANTES de pintarlo");
  assert.ok(read("src/lib/game/sync.ts").includes("const gesture = ref ?? loadPendingOpen(packId) ?? newOpenGesture();"), "misma clave tras recarga");
});
