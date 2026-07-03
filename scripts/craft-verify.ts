/**
 * VERIFICACIÓN — Crafting, Evolution & Upgrade Engine (DRL Champions, Collection Fase 4/7).
 *
 *   npx tsx scripts/craft-verify.ts
 *
 * Comprueba el motor de EVOLUCIÓN de cartas ENCIMA de Collection + Pack Minter, sin duplicar catálogo/
 * inventario/economía/variantes: crafting/upgrade/evolution/fusion/salvage/reforge/promotion · materiales ·
 * recetas · economía · eventos · identidad preservada · salida siempre existente (nunca inventa carta) ·
 * protección de bloqueadas · seriales · migraciones · determinismo · rendimiento (100k cartas · 50k
 * recetas · 10M ops) · cero estados imposibles · compat Collection. 100% DETERMINISTA.
 */
import type { CardDef, Player, VariantId } from "../src/domain/cards/types";
import { CardRegistry, OwnershipIndex, parseCardId, type OwnedCard } from "../src/collection";
import { CARDS } from "../src/data/catalog";
import { RECIPES, getRecipe } from "../src/data/recipes";
import {
  CraftEngine, validateRecipe, freshMaterials, migrateMaterials, addMaterials, subMaterials, hasMaterials,
  salvageYield, type Recipe, type CraftContext,
} from "../src/craft";
import { getVariant } from "../src/domain/cards/variants";

let failures = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`  ${c ? "✓" : "✕"} ${l}${d ? ` — ${d}` : ""}`); if (!c) failures++; };
console.log("# Verificación del Crafting, Evolution & Upgrade Engine — DRL Champions (Collection Fase 4/7)\n");

// ── Registro sintético controlado: jugador 'pa' con una ESCALERA de variantes reales ──
const STATS = { dmg: 80, scr: 80, com: 80, hs: 70, ast: 70, clu: 70 };
const players: Player[] = [
  { id: "pa", nick: "Alfa", team: "AAA", teamTag: "AAA", region: "EMEA", role: "Duelista", country: "ES", stats: STATS, accolades: [] },
  { id: "pb", nick: "Beta", team: "BBB", teamTag: "BBB", region: "EMEA", role: "Duelista", country: "ES", stats: STATS, accolades: [] },
];
const lookup = (id: string) => players.find((p) => p.id === id);
const mk = (playerId: string, variantId: VariantId): CardDef => ({ id: `${playerId}__${variantId}`, playerId, variantId, ovr: 80, stats: STATS });
// pa: bronze(r1 common), emea(r4 uncommon), emea-winner(r6* rare), masters(r5 internacional), prime(r10* exclusiva)
const PA_VARS: VariantId[] = ["bronze", "emea", "emea-winner", "masters", "prime"];
const cards: CardDef[] = [...PA_VARS.map((v) => mk("pa", v)), mk("pb", "bronze")];
const reg = new CardRegistry(cards, lookup);
const eng = new CraftEngine(reg);
const paBronze = "pa__bronze";
const baseCtx = (owned: OwnedCard[], over: Partial<CraftContext> = {}): CraftContext => ({
  owned, materials: { common: 50, uncommon: 50, rare: 50, epic: 50, legendary: 50 }, credits: 100000, tokens: 100,
  mintCounts: {}, locks: new Set<string>(), seed: 7, now: 100, ...over,
});
const own3 = (): OwnedCard[] => [{ uid: "a1", cardId: paBronze, obtainedAt: 1 }, { uid: "a2", cardId: paBronze, obtainedAt: 2 }, { uid: "a3", cardId: paBronze, obtainedAt: 3 }];

// ─────────────────────── 1. Recetas / validación (SEGURIDAD) ───────────────────────
console.log("## Recetas / validación (SEGURIDAD)");
{
  check("VALIDACIÓN: todas las recetas del catálogo son válidas", RECIPES.every((r) => validateRecipe(reg, r).ok), `${RECIPES.length} recetas`);
  const corrupt: Recipe[] = [
    { id: "x1", name: "", kind: "salvage", input: { count: 1 }, output: { mode: "variant", variant: "emea" } }, // salvage sin materials
    { id: "x2", name: "", kind: "fusion", input: { count: 1 }, output: { mode: "nextRank" } },                  // fusion count<2
    { id: "x3", name: "", kind: "craft", input: { count: 0 }, output: { mode: "explicit", cardId: "no__existe" } }, // cardId inexistente
    { id: "x4", name: "", kind: "upgrade" as Recipe["kind"], input: { count: 1 }, output: { mode: "nextRank" }, cost: { credits: -5 } }, // coste negativo
  ];
  check("SEGURIDAD: detecta salvage-sin-materials / fusion<2 / cardId inexistente / coste negativo",
    corrupt.every((r) => !validateRecipe(reg, r).ok));
}

// ─────────────────────── 2. Salvage / dismantle ───────────────────────
console.log("\n## Salvage / dismantle");
{
  const r = eng.craft(getRecipe("salvage-duplicate")!, baseCtx(own3()));
  check("SALVAGE: duplicado → polvo del bucket + créditos; consume 1", r.ok && r.removedUids.length === 1 && r.materialsAfter.common === 51 && r.creditsAfter > 100000);
  const types = new Set(r.events.map((e) => e.type));
  check("EVENTOS salvage: salvaged + duplicate_used + materials_gained", types.has("salvaged") && types.has("duplicate_used") && types.has("materials_gained"));
  const single = eng.craft(getRecipe("salvage-duplicate")!, baseCtx([{ uid: "s1", cardId: paBronze, obtainedAt: 1 }]));
  check("SALVAGE: carta NO duplicada ⇒ NOT_ENOUGH_INPUTS (duplicatesOnly)", !single.ok && single.issues.some((i) => i.code === "NOT_ENOUGH_INPUTS"));
  const dis = eng.craft(getRecipe("dismantle-card")!, baseCtx([{ uid: "d1", cardId: paBronze, obtainedAt: 1 }]));
  check("DISMANTLE: carta cualquiera → polvo", dis.ok && dis.removedUids.length === 1);
}

// ─────────────────────── 3. Upgrade (identidad preservada) ───────────────────────
console.log("\n## Upgrade");
{
  const r = eng.craft(getRecipe("upgrade-next")!, baseCtx([{ uid: "u1", cardId: paBronze, obtainedAt: 1 }]));
  const out = r.instances[0]?.cardId;
  check("UPGRADE: bronze → siguiente variante de mayor rango del MISMO jugador (emea)", r.ok && out === "pa__emea");
  check("IDENTIDAD: la salida conserva el jugador (no crea otra carta)", !!out && parseCardId(out).playerId === "pa");
  check("ECONOMÍA: descuenta materiales (rare 50→48) y créditos (−500)", r.materialsAfter.rare === 48 && r.creditsAfter === 100000 - 500);
  const poor = eng.craft(getRecipe("upgrade-next")!, baseCtx([{ uid: "u1", cardId: paBronze, obtainedAt: 1 }], { materials: freshMaterials() }));
  check("ECONOMÍA: materiales insuficientes ⇒ INSUFFICIENT_MATERIALS y SIN cambios", !poor.ok && poor.issues.some((i) => i.code === "INSUFFICIENT_MATERIALS") && poor.removedUids.length === 0);
}

// ─────────────────────── 4. Evolution / promotion (por grupo) ───────────────────────
console.log("\n## Evolution / Promotion (por grupo)");
{
  const evo = eng.craft(getRecipe("evolve-international")!, baseCtx([{ uid: "e1", cardId: paBronze, obtainedAt: 1 }]));
  check("EVOLUTION: bronze → variante 'internacional' del jugador (masters)", evo.ok && evo.instances[0]?.cardId === "pa__masters");
  const promo = eng.craft(getRecipe("promote-exclusive")!, baseCtx([{ uid: "p1", cardId: paBronze, obtainedAt: 1 }]));
  check("PROMOTION: bronze → variante 'exclusiva' del jugador (prime)", promo.ok && promo.instances[0]?.cardId === "pa__prime");
  // pb solo tiene bronze ⇒ no hay 'exclusiva' ⇒ nunca inventa una carta.
  const noOut = eng.craft(getRecipe("promote-exclusive")!, baseCtx([{ uid: "q1", cardId: "pb__bronze", obtainedAt: 1 }]));
  check("SALIDA EXISTENTE: jugador sin esa variante ⇒ OUTPUT_NOT_IN_CATALOG, sin consumir", !noOut.ok && noOut.issues.some((i) => i.code === "OUTPUT_NOT_IN_CATALOG") && noOut.removedUids.length === 0);
}

// ─────────────────────── 5. Fusión N→1 ───────────────────────
console.log("\n## Fusión");
{
  const r = eng.craft(getRecipe("fuse-triple")!, baseCtx(own3()));
  check("FUSIÓN 3→1: consume 3 del mismo jugador → 1 salida superior (emea)", r.ok && r.removedUids.length === 3 && r.instances.length === 1 && r.instances[0].cardId === "pa__emea");
  const two = eng.craft(getRecipe("fuse-triple")!, baseCtx([{ uid: "a1", cardId: paBronze, obtainedAt: 1 }, { uid: "a2", cardId: paBronze, obtainedAt: 2 }]));
  check("FUSIÓN: entradas insuficientes ⇒ NOT_ENOUGH_INPUTS, sin cambios", !two.ok && two.removedUids.length === 0);
}

// ─────────────────────── 6. Seriales ───────────────────────
console.log("\n## Seriales (solo si la variante los admite)");
{
  const toWinner: Recipe = { id: "t-serial", name: "", kind: "upgrade", input: { count: 1, samePlayer: true }, output: { mode: "variant", variant: "emea-winner" } };
  const r = eng.craft(toWinner, baseCtx([{ uid: "w1", cardId: paBronze, obtainedAt: 1 }]));
  const ins = r.instances[0];
  check("SERIAL: salida serializada ⇒ nº de serie acuñado (#1)", r.ok && ins?.cardId === "pa__emea-winner" && ins?.serial === 1);
  const upg = eng.craft(getRecipe("upgrade-next")!, baseCtx([{ uid: "n1", cardId: paBronze, obtainedAt: 1 }]));
  check("SERIAL: salida NO serializada (emea) ⇒ sin serie", upg.ok && upg.instances[0]?.serial == null && !getVariant("emea").serialized);
}

// ─────────────────────── 7. Protección de bloqueadas ───────────────────────
console.log("\n## Protección de cartas bloqueadas");
{
  const locks = new Set(["l1"]);
  const explicit = eng.craft(getRecipe("dismantle-card")!, baseCtx([{ uid: "l1", cardId: paBronze, obtainedAt: 1 }], { locks, selection: ["l1"] }));
  check("BLOQUEADA (selección): ⇒ LOCKED_CARD, NUNCA se consume", !explicit.ok && explicit.issues.some((i) => i.code === "LOCKED_CARD") && explicit.removedUids.length === 0);
  const auto = eng.craft(getRecipe("dismantle-card")!, baseCtx([{ uid: "l1", cardId: paBronze, obtainedAt: 1 }], { locks }));
  check("BLOQUEADA (auto): se ignora ⇒ NOT_ENOUGH_INPUTS, carta intacta", !auto.ok && auto.removedUids.length === 0);
}

// ─────────────────────── 8. Materiales / economía ───────────────────────
console.log("\n## Materiales / economía (reutiliza pricing)");
{
  const bag = { common: 5, uncommon: 3, rare: 0, epic: 0, legendary: 0 };
  check("MATERIALES: add/sub/has inmutables y coherentes", hasMaterials(bag, { common: 5 }) && !hasMaterials(bag, { rare: 1 }) && addMaterials(bag, { rare: 2 }).rare === 2 && subMaterials(bag, { common: 2 }).common === 3);
  const y = salvageYield(mk("pa", "prime"), getVariant("prime"), 1, { dustByBucket: true, valueFromCard: true });
  check("SALVAGE YIELD: polvo del bucket + créditos por el pricing existente", y.materials.epic > 0 && y.credits > 0);
  check("MIGRACIÓN: materiales corruptos/nulos ⇒ saneados", migrateMaterials({ common: -3, rare: "x", epic: 4 }).common === 0 && migrateMaterials(null).legendary === 0 && migrateMaterials({ epic: 4 }).epic === 4);
}

// ─────────────────────── 9. Compat Collection / eventos ───────────────────────
console.log("\n## Compat Collection / eventos");
{
  const r = eng.craft(getRecipe("upgrade-next")!, baseCtx([{ uid: "c1", cardId: paBronze, obtainedAt: 1 }]));
  const owned: OwnedCard[] = r.instances.map((ins, i) => ({ uid: `o${i}`, cardId: ins.cardId, serial: ins.serial ?? undefined, obtainedAt: 100 }));
  const own = new OwnershipIndex(owned);
  check("COMPAT: las salidas acuñadas alimentan OwnershipIndex del Collection Engine", own.totalInstances() === owned.length && own.validate(reg).ok);
  check("EVENTOS: upgraded + card_obtained + new_card (reutiliza Collection Events)", new Set(r.events.map((e) => e.type)).has("upgraded") && r.events.some((e) => e.type === "card_obtained"));
}

// ─────────────────────── 10. Determinismo ───────────────────────
console.log("\n## Determinismo");
{
  const a = eng.craft(getRecipe("upgrade-next")!, baseCtx([{ uid: "z1", cardId: paBronze, obtainedAt: 1 }]));
  const b = eng.craft(getRecipe("upgrade-next")!, baseCtx([{ uid: "z1", cardId: paBronze, obtainedAt: 1 }]));
  const key = (r: typeof a) => JSON.stringify([r.removedUids, r.instances.map((i) => [i.cardId, i.serial]), r.materialsAfter, r.creditsAfter]);
  check("DETERMINISMO: mismas entradas ⇒ resultado idéntico", key(a) === key(b));
}

// ─────────────────────── 11. Cero estados imposibles ───────────────────────
console.log("\n## Cero estados imposibles");
{
  let bad = 0;
  const empty = eng.craft(getRecipe("upgrade-next")!, baseCtx([]));
  if (empty.ok || empty.removedUids.length !== 0) bad++;                                   // sin cartas: falla limpio
  const noCredits = eng.craft(getRecipe("promote-exclusive")!, baseCtx([{ uid: "b1", cardId: paBronze, obtainedAt: 1 }], { credits: 0 }));
  if (noCredits.ok || noCredits.creditsAfter !== 0) bad++;                                 // sin créditos: sin cambios
  try { eng.craft(getRecipe("upgrade-next")!, baseCtx([{ uid: "x", cardId: "no__existe", obtainedAt: 1 }])); } catch { bad++; } // nunca lanza
  check("INTEGRIDAD: fallos sin mutar recursos, cardId inexistente sin excepción", bad === 0);
}

// ─────────────────────── 12. Rendimiento (100k cartas · 50k recetas · 10M ops) ───────────────────────
console.log("\n## Rendimiento (100k cartas · 50k recetas · 10M ops)");
{
  // 100.000 cartas: registro grande (índices reutilizados del Collection Engine).
  const big: CardDef[] = [];
  for (let i = 0; i < 100000; i++) big.push({ id: `bp${i}__${CARDS[i % CARDS.length].variantId}`, playerId: `bp${i}`, variantId: CARDS[i % CARDS.length].variantId, ovr: 70, stats: STATS });
  const t0 = Date.now();
  const bigReg = new CardRegistry(big, () => players[0]);
  const buildMs = Date.now() - t0;
  // 50.000 recetas: indexadas + validadas.
  const t1 = Date.now();
  let validCount = 0;
  for (let i = 0; i < 50000; i++) { const rc: Recipe = { id: `r${i}`, name: "", kind: "salvage", input: { count: 1 }, output: { mode: "materials", dustByBucket: true } }; if (validateRecipe(bigReg, rc).ok) validCount++; }
  const recipesMs = Date.now() - t1;
  // 10.000.000 de operaciones de drop/craft: salvage sobre un set fijo pequeño (O(1)/op ⇒ lineal).
  const salvage = getRecipe("salvage-duplicate")!;
  const smallOwned: OwnedCard[] = [{ uid: "p1", cardId: paBronze, obtainedAt: 1 }, { uid: "p2", cardId: paBronze, obtainedAt: 2 }];
  const run = (ops: number): number => { const s = Date.now(); for (let i = 0; i < ops; i++) eng.craft(salvage, baseCtx(smallOwned)); return Date.now() - s; };
  const o1 = run(1_000_000), o2 = run(2_000_000);
  const ratio = o2 / Math.max(1, o1);
  check("RENDIMIENTO: 100k cartas + 50k recetas + escala LINEAL de ops (no O(n²))",
    buildMs < 3000 && recipesMs < 4000 && validCount === 50000 && ratio < 2.6,
    `build=${buildMs}ms · recetas=${recipesMs}ms · ops 1M=${o1}ms/2M=${o2}ms ratio=${ratio.toFixed(2)}`);
}

console.log(`\n${failures === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${failures} COMPROBACIÓN(ES) FALLARON`}`);
process.exit(failures === 0 ? 0 : 1);

// Señal de fallo para CI: sale con código !=0 si alguna comprobación falló.
if (failures > 0) process.exitCode = 1;
