/**
 * FASE 69 · AUTORIDAD DEL HUD (tras F68-010). Auditoría de toda mutación LOCAL de créditos, XP, sobres, cartas y
 * materiales alcanzable con cuenta. Hallazgos arreglados: reclamo de /colecciones (applyReward local, enlazado en el
 * menú), la Forja de /coleccion (craft local), las salas locales de /mercado (compra/venta/liquidación contra bots),
 * los logros de /manager (créditos locales) y el simulador de Pick'ems del panel de admin. Regla: con cuenta (o
 * mientras la sesión se resuelve) ningún modo local concede ni cobra; el saldo final siempre es el del servidor.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8").replace(/\r\n/g, "\n");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/.*$/gm, "");
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(join(ROOT, dir))) {
    const p = `${dir}/${n}`;
    if (statSync(join(ROOT, p)).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n)) out.push(p);
  }
  return out;
}

test("F69 · useServerEconomy: con cuenta O mientras la sesión se resuelve, la economía es del servidor", () => {
  const s = code(read("src/lib/game/serverEconomy.ts"));
  assert.match(s, /return configured && \(loading \|\| !!user\);/);
});

test("F69 · /colecciones: con cuenta el reclamo local está apagado y el clic no concede nada", () => {
  const s = code(read("src/app/colecciones/page.tsx"));
  assert.match(s, /const serverEconomy = useServerEconomy\(\);/);
  assert.match(s, /disabled=\{!prog\.complete \|\| serverEconomy\}/);
  assert.match(s, /onClick=\{\(\) => \{ if \(serverEconomy\) return; if \(claim\(/);
});

test("F69 · /coleccion: la Forja local solo se monta sin cuenta; con cuenta, aviso y enlace al desguace del servidor", () => {
  assert.match(read("src/app/coleccion/page.tsx"), /forge=\{<ForgeGate \/>\}/);
  const g = code(read("src/components/craft/ForgeGate.tsx"));
  assert.match(g, /if \(!serverEconomy\) return <ForgePanel \/>;/);
  assert.match(g, /href="\/inventario"/);
});

test("F69 · /mercado: con cuenta solo la sala Global; el mercado local ni se siembra ni se liquida", () => {
  const s = code(read("src/app/mercado/page.tsx"));
  assert.match(s, /useEffect\(\(\) => \{\n\s*if \(serverEconomy\) return;\n\s*ensureSeeded\(\);\n\s*refreshMarket\(\);/);
  assert.match(s, /const tab: Tab = serverEconomy \? "global" : pickedTab;/);
  assert.match(s, /serverEconomy\n\s*\? \[\["global", "Global"\]\]/);
});

test("F69 · /manager: el logro con premio en créditos locales no se reclama con cuenta", () => {
  const s = code(read("src/components/career/CoachProfile.tsx"));
  assert.match(s, /a\.complete && !a\.claimed && !serverEconomy \?/);
});

test("F69 · simulador de Pick'ems del admin: no toca el saldo ni la XP del store", () => {
  const s = code(read("src/store/useEngineStore.ts"));
  assert.ok(!/addCredits|addXp|grantPack|useGameStore/.test(s));
});

test("F69 · lista CERRADA de módulos que mutan la economía local: ninguno nuevo sin pasar por esta auditoría", () => {
  const MUTATORS = /\b(addCredits|spendCredits|addXp|grantPack|grantCard|addMaterials|addCosmetics|applyReward)\(/;
  const found = walk("src").filter((f) => MUTATORS.test(code(read(f)))).sort();
  assert.deepEqual(found, [
    "src/lib/rewards.ts",            // aplicador compartido (solo lo usan los stores de abajo)
    "src/store/useBattlePassStore.ts", // código muerto: ninguna pantalla lo importa
    "src/store/useCollectionsStore.ts", // reclamo de /colecciones: apagado con cuenta
    "src/store/useEventsStore.ts",   // /eventos: botones apagados con cuenta (useOnline)
    "src/store/useManagerStore.ts",  // logros de /manager: apagado con cuenta
    "src/store/useMarketStore.ts",   // salas locales de /mercado: ocultas con cuenta
  ]);
});

test("F69 · compra/apertura/desguace: mientras la sesión se resuelve NO hay camino local (ni saldo ni cartas inventadas)", () => {
  const cases: [string, RegExp][] = [
    ["src/app/tienda/page.tsx", /if \(serverEconomy\) \{ setPhase\(\{ at: "failed", message: SESSION_PENDING \}\); return false; \}\n\s*const res = buyPack\(packId\);/],
    ["src/components/packs/PackStoreCard.tsx", /if \(serverEconomy\) \{ onNotify\(SESSION_PENDING, false\); return false; \}\s*\n\s*const res = buyPack\(pack\.id\);/],
    ["src/lib/game/usePackPurchase.ts", /if \(serverEconomy\) return \{ ok: false, error: SESSION_PENDING \};\s*\n\s*const res = buyPackLocal\(packId\);/],
    ["src/components/packs/PackOpeningExperience.tsx", /if \(serverEconomy\) throw new Error\(SESSION_PENDING\);\n\s*res = openFromInventory\(packId\);/],
    ["src/app/inventario/page.tsx", /if \(serverEconomy\) \{ notify\(SESSION_PENDING, false\); return; \}\s*\n\s*quickSellMany\(/],
  ];
  for (const [f, re] of cases) assert.match(code(read(f)), re, f);
});
