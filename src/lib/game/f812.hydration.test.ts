/**
 * F81.2 · AUTH HYDRATION / CERO INVENTARIO FALSO — mientras la sesión o el estado del servidor no se conocen, ninguna
 * cifra del store (créditos, sobres, cartas) se pinta: ni la demo ni la caché. UNKNOWN nunca se colapsa en GUEST.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LOCAL_ECONOMY_BLOCKED, economyView, economyVisible, localEconomyBlockReason, type EconomyFacts } from "./localEconomy";
import { useGameStore } from "@/store/useGameStore";
const STARTER_CREDITS = 6000; // F80 · saldo de inicio de la demo (fijado en `useGameStore`, ver f80.packPrices.test)

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const base: EconomyFacts = { configured: true, loading: false, userId: null, serverOwner: null, cacheOwner: null, sessionStored: false, syncError: null };
const view = (f: Partial<EconomyFacts>) => economyView({ ...base, ...f });

/** Ejecuta el store real en un proceso aparte (backend «configurado», localStorage simulado con `keys`). */
function storeProcess(keys: Record<string, string>, body: string) {
  const script = `
    globalThis.window = globalThis;
    const keys = ${JSON.stringify(keys)};
    globalThis.localStorage = { get length() { return Object.keys(keys).length; }, key: (i) => Object.keys(keys)[i] ?? null, getItem: (k) => keys[k] ?? null, setItem: (k, v) => { keys[k] = String(v); }, removeItem: (k) => { delete keys[k]; } };
    const { useGameStore } = await import(${JSON.stringify("file:///" + join(ROOT, "src/store/useGameStore.ts").replace(/\\/g, "/"))});
    const { economyView } = await import(${JSON.stringify("file:///" + join(ROOT, "src/lib/game/localEconomy.ts").replace(/\\/g, "/"))});
    ${body}
  `;
  const r = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    cwd: ROOT, encoding: "utf8", env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "https://valorosters.example", NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key" },
  });
  const line = r.stdout.trim().split(/\r?\n/).pop() ?? "";
  assert.ok(line.startsWith("{"), `salida: ${r.stdout}\n${r.stderr}`);
  return JSON.parse(line);
}

const SESSION = { "sb-valorosters-auth-token": "{}" };
const DEMO_CACHE = { "drl-champions": JSON.stringify({ state: { credits: 6000, unopenedPacks: { inicial: 3, estandar: 1 }, ownedCards: [{ uid: "demo-1", cardId: "x", obtainedAt: 0 }] }, version: 0 }) };

test("F81.2 · A/B/C · sesión guardada + auth sin resolver → UNKNOWN: ni créditos, ni cartas, ni sobres (aunque el store tenga la demo)", () => {
  // `null` de usuario mientras se resuelve NO es «visitante».
  for (const f of [{ loading: true, sessionStored: true }, { loading: true }, { loading: true, cacheOwner: "u-1" }]) {
    assert.equal(view(f), "unknown", JSON.stringify(f));
    assert.equal(economyVisible(view(f)), false);
  }
  // Proceso real: el store rehidratado SÍ lleva la demo (6.000, sobres, cartas)… y la vista dice que no se pinta.
  const out = storeProcess({ ...SESSION, ...DEMO_CACHE }, `
    const s = useGameStore.getState();
    const v = economyView({ configured: true, loading: true, userId: null, serverOwner: s.serverOwner, cacheOwner: s.cacheOwner, sessionStored: true, syncError: null });
    console.log(JSON.stringify({ credits: s.credits, packs: s.unopenedPacks, cards: s.ownedCards.length, serverOwner: s.serverOwner, v }));
  `);
  assert.equal(out.credits, 6000, "la caché de demo existe en el store…");
  assert.ok(out.cards > 0 && out.packs.inicial > 0);
  assert.equal(out.serverOwner, null, "…pero no tiene dueño: serverOwner NO se persiste");
  assert.equal(out.v, "unknown", "…y por eso no se enseña");
});

test("F81.2 · A/B/C · los que pintan saldo, sobres y cartas pasan por la MISMA vista (HUD, compuerta, portada, cuenta, perfil)", () => {
  const shell = code(read("src/components/layout/GameShell.tsx"));
  const wallet = shell.slice(shell.indexOf("function Wallet()"), shell.indexOf("function Currency("));
  assert.match(wallet, /const hydrated = useGameStore\(\(s\) => s\.hydrated\) && economyVisible\(view\);/, "HUD: cifras solo con la vista resuelta");
  assert.match(wallet, /value=\{hydrated \? formatCredits\(credits\) : "—"\}/, "si no, «—»");
  const gate = code(read("src/components/layout/HydrationGate.tsx"));
  assert.match(gate, /if \(admin \|\| view === "server" \|\| view === "guest"\) return <>\{children\}<\/>;/);
  assert.match(gate, /if \(view === "unknown"\) return <GameLoader/);
  const home = code(read("src/app/page.tsx"));
  assert.match(home, /const ownedCards = useMemo\(\(\) => \(visible \? storeCards : \[\]\)/);
  assert.match(home, /const credits = visible \? storeCredits : null;/);
  assert.match(home, /economy === "unknown"/, "portada: esqueleto mientras no se sabe");
  assert.match(code(read("src/app/cuenta/page.tsx")), /const ownedCards = collectionReady \? storeCards : NO_CARDS;/);
  assert.match(code(read("src/components/player/PlayerProfileScreen.tsx")), /ownedReady \? storeOwned : \[\]/);
  for (const p of ["src/app/carrera/page.tsx", "src/app/entrenador/partido/page.tsx"]) assert.match(read(p), /<HydrationGate>/, p);
});

test("F81.2 · D · con usuario y el servidor LENTO: UNKNOWN hasta que el store tenga el estado de ESTA cuenta", () => {
  assert.equal(view({ userId: "u-1" }), "unknown", "sin estado todavía");
  assert.equal(view({ userId: "u-1", serverOwner: "u-2", cacheOwner: "u-2" }), "unknown", "el de otra cuenta no vale");
  assert.equal(view({ userId: "u-1", cacheOwner: "u-1" }), "unknown", "la caché de la misma cuenta TAMPOCO: no es de esta carga");
  assert.equal(view({ userId: "u-1", serverOwner: "u-1" }), "server");
  assert.equal(view({ userId: "u-1", syncError: "boom" }), "error", "fallo → reintento, no carga infinita ni demo");
  assert.equal(view({ userId: "u-1", serverOwner: "u-1", syncError: "boom" }), "server", "una relectura fallida no esconde lo ya recibido");
  // El volcado lleva dueño: así se pasa de UNKNOWN a SERVER, y sin dueño (llamadas antiguas) no cuenta.
  const prev = useGameStore.getState();
  const st = { credits: 2120, xp: 0, ownedCards: [], origins: {}, lockedUids: [], unopenedPacks: { estandar: 2 }, pityState: prev.pityState, packsOpened: 7, mintCounts: {} };
  useGameStore.setState({ serverOwner: null, cacheOwner: null });
  useGameStore.getState().applyServerState(st);
  assert.equal(useGameStore.getState().serverOwner, null);
  useGameStore.getState().applyServerState(st, "u-1");
  assert.deepEqual([useGameStore.getState().serverOwner, useGameStore.getState().cacheOwner, useGameStore.getState().credits], ["u-1", "u-1", 2120]);
  assert.match(read("src/lib/game/sync.ts"), /\}, state\.ownerId \?\? null\);/);
  // Una respuesta que llega con OTRA sesión activa se descarta (salir/entrar con otra cuenta a mitad de la lectura).
  const client = code(read("src/lib/game/client.ts"));
  assert.match(client, /if \(now !== owner\) throw new Error\(STALE_GAME_STATE\);\s*return \{ \.\.\.state, ownerId: owner \};/);
});

test("F81.2 · E · visitante CONFIRMADO: su demo sigue (vista GUEST y el motor local compra y abre)", () => {
  assert.equal(view({}), "guest");
  assert.equal(view({ configured: false, loading: true, userId: "x", sessionStored: true }), "guest", "build sin backend: solo hay modo local");
  const out = storeProcess({}, `
    const s = useGameStore.getState();
    const before = s.credits;
    const buy = s.buyPack("estandar");
    let opened = 0; try { opened = s.openPackFromInventory("inicial").length; } catch (e) { opened = -1; }
    console.log(JSON.stringify({ before, buy: buy.ok, opened }));
  `);
  assert.equal(out.before, STARTER_CREDITS);
  assert.equal(out.buy, true, "el visitante compra en su demo");
  assert.ok(out.opened > 0, "y abre");
});

test("F81.2 · F · sesión caducada: UNKNOWN mientras se resuelve; si queda la sesión guardada sin usuario, reintento; demo solo confirmada", () => {
  assert.equal(view({ loading: true, sessionStored: true }), "unknown");
  assert.equal(view({ sessionStored: true }), "unverified", "sin usuario y con sesión guardada NO es visitante (reintento, no carga infinita)");
  assert.equal(economyVisible("unverified"), false);
  // supabase-js borró la sesión inválida → visitante; con la caché de la cuenta todavía puesta, primero se limpia.
  assert.equal(view({ cacheOwner: "u-1" }), "unknown");
  assert.equal(view({}), "guest");
  const sync = code(read("src/components/sync/CloudSync.tsx"));
  assert.match(sync, /if \(!configured \|\| loading \|\| user \|\| storedSessionPresent\(\)\) return;/, "la limpieza exige visitante CONFIRMADO");
  assert.match(sync, /if \(s\.cacheOwner \|\| s\.serverOwner\) \{\s*s\.resetGame\(\);/);
  const gate = code(read("src/components/layout/HydrationGate.tsx"));
  assert.match(gate, /testId="economy-unavailable"/);
  assert.match(gate, /label: "Reintentar"/);
});

test("F81.2 · G · login: la demo se esconde en cuanto aparece el usuario y hasta que llegue SU estado", () => {
  const demo = { serverOwner: null, cacheOwner: null };
  assert.equal(view(demo), "guest");
  assert.equal(view({ ...demo, loading: true }), "unknown", "inicio de sesión en curso");
  assert.equal(view({ ...demo, userId: "u-1" }), "unknown", "usuario sin estado todavía");
  assert.equal(view({ userId: "u-1", serverOwner: "u-1", cacheOwner: "u-1" }), "server");
});

test("F81.2 · H · logout: la caché de la cuenta NO pasa a ser «demo»; la demo aparece tras confirmarse visitante y limpiar", () => {
  assert.equal(view({ serverOwner: "u-1", cacheOwner: "u-1" }), "unknown", "salió: caché ajena, no se enseña");
  assert.equal(view({ serverOwner: "u-1", cacheOwner: "u-1", sessionStored: true }), "unverified");
  const out = storeProcess({}, `
    const st = { credits: 2120, xp: 900, ownedCards: [{ uid: "srv-1", cardId: "x", obtainedAt: 0 }], origins: {}, lockedUids: [], unopenedPacks: { estandar: 2 }, pityState: useGameStore.getState().pityState, packsOpened: 7, mintCounts: {} };
    useGameStore.getState().applyServerState(st, "u-1");
    const persisted = JSON.parse(localStorage.getItem("drl-champions")).state;
    useGameStore.getState().resetGame();
    const s = useGameStore.getState();
    const v = economyView({ configured: true, loading: false, userId: null, serverOwner: s.serverOwner, cacheOwner: s.cacheOwner, sessionStored: false, syncError: null });
    console.log(JSON.stringify({ persistedOwner: persisted.cacheOwner, persistedServerOwner: "serverOwner" in persisted, credits: s.credits, cards: s.ownedCards.length, packs: s.unopenedPacks, owner: [s.serverOwner, s.cacheOwner], v }));
  `);
  assert.equal(out.persistedOwner, "u-1", "la caché persistida sabe de quién es");
  assert.equal(out.persistedServerOwner, false, "serverOwner nunca se persiste");
  assert.deepEqual(out.owner, [null, null]);
  assert.equal(out.credits, STARTER_CREDITS, "tras limpiar: demo de verdad, no el saldo de la cuenta");
  assert.equal(out.cards, 0);
  assert.equal(out.v, "guest");
});

test("F81.2 · I · detalle de sobre y apertura por URL directa: tras la compuerta (la propiedad no se decide con la demo)", () => {
  for (const p of ["src/app/packs/[packId]/page.tsx", "src/app/abrir/[packId]/page.tsx", "src/app/packs/page.tsx", "src/app/inventario/page.tsx", "src/app/tienda/page.tsx", "src/app/coleccion/page.tsx"]) {
    assert.match(read(p), /<HydrationGate>/, p);
  }
  // La compuerta exige la vista, no solo la rehidratación de Zustand (la causa de F81.2).
  const gate = code(read("src/components/layout/HydrationGate.tsx"));
  assert.ok(gate.indexOf("useEconomyView()") > 0 && gate.indexOf('if (!hydrated)') < gate.indexOf('view === "server"'));
});

test("F81.2 · J/K · durante la hidratación con cuenta, el motor local NI abre NI compra (barrera F81.1 intacta)", () => {
  assert.equal(localEconomyBlockReason({ configured: true, storage: { length: 0, key: () => null }, signedIn: true }), LOCAL_ECONOMY_BLOCKED);
  const out = storeProcess({ ...SESSION, ...DEMO_CACHE }, `
    const s = useGameStore.getState();
    const before = JSON.stringify({ packs: s.unopenedPacks, cards: s.ownedCards.length, credits: s.credits });
    let threw = ""; try { s.openPackFromInventory("inicial"); } catch (e) { threw = e.name; }
    const buy = s.buyPack("estandar");
    const a = useGameStore.getState();
    console.log(JSON.stringify({ threw, buy, same: before === JSON.stringify({ packs: a.unopenedPacks, cards: a.ownedCards.length, credits: a.credits }), lastOpened: a.lastOpened }));
  `);
  assert.equal(out.threw, "LocalEconomyBlockedError");
  assert.deepEqual(out.buy, { ok: false, error: LOCAL_ECONOMY_BLOCKED });
  assert.equal(out.same, true);
  assert.equal(out.lastOpened, null);
});
