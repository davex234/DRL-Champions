/**
 * F79 · NEXUS FORGE 2.0 — dominio puro: progresión, descubrimiento, cadenas, planos, POSEER vs CONSUMIR, selector,
 * auto-selección, validación del servidor, objetivos/logros, historial, pity, proyectos 2.0 y la validación del panel
 * con el catálogo REAL (331 cartas).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CARDS, getCard, getPlayer } from "@/data/catalog";
import { getPack } from "@/data/packs";
import { packCardClass, type PackCardClass } from "@/domain/packs/packClass";
import { canonicalCardTeam, TEAM_IDENTITIES } from "@/data/teamIdentities";
import type { CardDef } from "@/domain/cards/types";
import { DEFAULT_FORGE_CONFIG, mergeForgeConfig } from "./defaults";
import type { AdvancedRecipe, ForgeConfig } from "./types";
import { countFacts, forgeXp, levelFromXp, masteryViews, xpToNext, EMPTY_INVENTORY, type CraftOpFact, type ForgeFacts } from "./progression";
import { advancedState, blueprintOwned, chainViews, chainsCompleted, type UnlockContext } from "./discovery";
import { checkOwn, slotMatches } from "./requirements";
import { autoFill, buildMaterials, validateSelection, type OwnedCopy } from "./selector";
import { achievementClaimRef, achievementViews, objectiveClaimRef, objectiveViews, objectivesCompleted, periodKey, periodWindow } from "./objectives";
import { forgeHistory } from "./history";
import { effectivePool, pickFrom } from "./output";
import { missionDepths, projectStages } from "./projects";
import { evaluateForge, recipeGate } from "./snapshot";
import { progressEvents } from "./events";
import { advancedFloor, validateForgeConfig, type ForgeLookup } from "./validate";

const playerOf = (id: string) => getPlayer(id);
const teamOf = (def: Pick<CardDef, "playerId"> & { team?: string }) => canonicalCardTeam(def, playerOf(def.playerId) as never).key;
const of = (cls: PackCardClass) => CARDS.filter((c) => packCardClass(c) === cls).sort((a, b) => a.id.localeCompare(b.id));
const copies = (cardId: string, n: number, prefix: string, locked = false): OwnedCopy[] => Array.from({ length: n }, (_, i) => ({ uid: `${prefix}-${i}`, cardId, locked }));
const op = (recipeId: string, kind: "PACK" | "CARD", at: number, extra: Partial<CraftOpFact> = {}): CraftOpFact => ({ ref: `r:${recipeId}:${at}`, kind, recipeId, at, inputs: [], outputs: [], ...extra });
const facts = (ops: CraftOpFact[], over: Partial<ForgeFacts> = {}): ForgeFacts => ({ ops, projectClaims: [], completedMissions: new Set(), inventory: EMPTY_INVENTORY, ...over });
const active = (cfg: ForgeConfig): ForgeConfig => ({
  ...cfg,
  recipes: cfg.recipes.map((r) => ({ ...r, status: "ACTIVE" })), chains: cfg.chains.map((c) => ({ ...c, status: "ACTIVE" })),
  blueprints: cfg.blueprints.map((b) => ({ ...b, status: "ACTIVE" })), objectives: cfg.objectives.map((o) => ({ ...o, status: "ACTIVE" })),
  achievements: cfg.achievements.map((a) => ({ ...a, status: "ACTIVE" })),
});
const LOOKUP: ForgeLookup = {
  card: getCard, playerExists: (id) => !!playerOf(id), teamExists: (k) => TEAM_IDENTITIES.some((t) => t.canonicalId === k),
  variantExists: (v) => CARDS.some((c) => c.variantId === v), projectExists: (id) => id === "proj-real", missionExists: (id) => id === "mis-real",
  packExists: (id) => !!getPack(id), classPool: (cls) => of(cls).length,
};

/* ═══════════════════ nivel y XP ═══════════════════ */

test("F79 E1 · curva: límites exactos de nivel, nivel máximo y XP derivada de las reglas centrales", () => {
  const c = DEFAULT_FORGE_CONFIG.curve;
  assert.equal(levelFromXp(0, c).level, 1);
  assert.equal(levelFromXp(xpToNext(1, c) - 1, c).level, 1, "1 XP antes del umbral sigue en 1");
  assert.equal(levelFromXp(xpToNext(1, c), c).level, 2, "justo en el umbral sube");
  assert.equal(levelFromXp(xpToNext(1, c), c).xpIntoLevel, 0);
  const total2to4 = xpToNext(1, c) + xpToNext(2, c) + xpToNext(3, c);
  assert.equal(levelFromXp(total2to4, c).level, 4);
  assert.equal(levelFromXp(-50, c).level, 1, "XP negativa no existe");
  const max = levelFromXp(10 ** 9, c);
  assert.equal(max.level, c.maxLevel); assert.ok(max.maxed); assert.equal(max.xpForNext, 0);
  assert.ok(xpToNext(10, c) > xpToNext(9, c), "la curva crece");
  const f = facts([op("pack-estandar-premium", "PACK", 1), op("card-plata-oro", "CARD", 2), op("forge-ruta-oro", "CARD", 3)], { projectClaims: [{ projectId: "p", at: 4 }, { projectId: "p", at: 5 }] });
  const xp = forgeXp(DEFAULT_FORGE_CONFIG, f, 1, 2);
  const X = DEFAULT_FORGE_CONFIG.xp;
  assert.equal(xp.crafts, X.craftPack + X.craftCard + X.craftAdvanced, "sobre + intercambio + avanzada, cada uno con SU valor");
  assert.equal(xp.projects, X.projectClaim, "un proyecto reclamado dos veces (no puede) cuenta UNA");
  assert.equal(xp.total, xp.crafts + X.projectClaim + X.chainComplete + 2 * X.objectiveComplete);
});

test("F79 E2 · maestría por rama, umbrales y siguiente objetivo", () => {
  const inv = { ...EMPTY_INVENTORY, distinctCards: 61 };
  const c = countFacts(facts([...Array.from({ length: 5 }, (_, i) => op("pack-premium-oro", "PACK", i)), op("card-plata-oro", "CARD", 9)]));
  const m = masteryViews(DEFAULT_FORGE_CONFIG, c, inv);
  const by = Object.fromEntries(m.map((x) => [x.branch, x]));
  assert.equal(by.SOBRES.rank, 2, "5 crafteos de sobres → rangos 1 (1) y 2 (5)");
  assert.equal(by.SOBRES.next, 15);
  assert.equal(by.INTERCAMBIO.rank, 1);
  assert.equal(by.PROYECTOS.rank, 0);
  assert.equal(by.COLECCION.rank, 2, "61 cartas distintas ≥ 25 y ≥ 60");
  assert.ok(DEFAULT_FORGE_CONFIG.mastery.find((x) => x.branch === "COLECCION")!.thresholds.every((t) => t <= CARDS.length), "umbrales de colección alcanzables con el catálogo real");
});

/* ═══════════════════ descubrimiento, cadenas, planos ═══════════════════ */

test("F79 E3 · estados de receta: LOCKED → DISCOVERED → AVAILABLE → COMPLETED (no repetible)", () => {
  const r = { ...DEFAULT_FORGE_CONFIG.recipes[0], status: "ACTIVE" } as AdvancedRecipe; // nivel 2
  const ctx = (level: number, done: string[] = []): UnlockContext => ({ level, mastery: [], recipesDone: new Set(done), blueprints: new Set() });
  assert.equal(advancedState(r, ctx(1), true), "LOCKED");
  assert.equal(advancedState(r, ctx(2), false), "DISCOVERED");
  assert.equal(advancedState(r, ctx(2), true), "AVAILABLE");
  assert.equal(advancedState(r, ctx(2, [r.id]), true), "COMPLETED");
  assert.equal(advancedState({ ...r, repeatable: true }, ctx(2, [r.id]), true), "AVAILABLE", "repetible: sigue disponible");
});

test("F79 E4 · LOCKED enseña silueta: pista y condiciones, pero NO qué consume ni qué sale", () => {
  const cfg = active(DEFAULT_FORGE_CONFIG);
  const core = evaluateForge({ cfg, facts: facts([]), now: Date.now(), claimedRefs: new Set(), materials: () => [] });
  const locked = core.recipes.find((x) => x.id === "forge-ruta-champions")!;
  assert.equal(locked.state, "LOCKED");
  assert.equal(locked.consume, null); assert.equal(locked.output, null); assert.equal(locked.own, null);
  assert.ok(locked.hint.length > 0 && locked.rules.length === 2 && locked.rules.every((x) => !x.met));
  assert.deepEqual(recipeGate(core, "forge-ruta-champions"), { ok: false, code: "RECIPE_LOCKED" });
  assert.deepEqual(recipeGate(core, "no-existe"), { ok: false, code: "RECIPE_UNAVAILABLE" });
});

test("F79 E5 · cadena: cada paso abre el siguiente; terminada da su bonus UNA vez; DRAFT no cuenta", () => {
  const cfg = active(DEFAULT_FORGE_CONFIG);
  const steps = cfg.chains[0].steps;
  assert.equal(chainsCompleted(cfg, new Set(steps.slice(0, 2))), 0);
  assert.equal(chainsCompleted(cfg, new Set(steps)), 1);
  assert.equal(chainsCompleted(DEFAULT_FORGE_CONFIG, new Set(steps)), 0, "la cadena en DRAFT no da nada");
  const v = chainViews(cfg, new Set(steps.slice(0, 1)))[0];
  assert.equal(v.done, 1); assert.equal(v.total, 3); assert.equal(v.completed, false);
  const ctx: UnlockContext = { level: 1, mastery: [], recipesDone: new Set([steps[0]]), blueprints: new Set() };
  const second = cfg.recipes.find((x) => x.id === steps[1])!;
  assert.notEqual(advancedState(second, ctx, true), "LOCKED", "hecho el paso 1, el 2 se desbloquea");
  assert.equal(advancedState(second, { ...ctx, recipesDone: new Set() }, true), "LOCKED");
});

test("F79 E6 · planos: ESTADO derivado de su fuente (no moneda); DRAFT nunca se tiene", () => {
  const ctx = { level: 5, projectsClaimed: new Set(["p1"]), missionsCompleted: new Set(["m1"]), achievementsDone: new Set(["a1"]) };
  const bp = (source: never) => ({ id: "b", name: "Plano", hint: "", status: "ACTIVE" as const, source });
  assert.ok(blueprintOwned(bp({ type: "FORGE_LEVEL", min: 5 } as never), ctx));
  assert.ok(!blueprintOwned(bp({ type: "FORGE_LEVEL", min: 6 } as never), ctx));
  assert.ok(blueprintOwned(bp({ type: "PROJECT_CLAIMED", projectId: "p1" } as never), ctx));
  assert.ok(blueprintOwned(bp({ type: "MISSION_COMPLETED", missionId: "m1" } as never), ctx));
  assert.ok(blueprintOwned(bp({ type: "ACHIEVEMENT", achievementId: "a1" } as never), ctx));
  assert.ok(!blueprintOwned({ ...bp({ type: "FORGE_LEVEL", min: 1 } as never), status: "DRAFT" }, ctx));
  // Derivado: calcularlo dos veces (dos pestañas) da lo mismo; no hay nada que «conceder» dos veces.
  assert.equal(blueprintOwned(bp({ type: "FORGE_LEVEL", min: 5 } as never), ctx), blueprintOwned(bp({ type: "FORGE_LEVEL", min: 5 } as never), ctx));
});

test("F79 E6b · analítica de progresión: subir de nivel nombra level_up, plano, receta desbloqueada y cadena; repetir no nombra nada", () => {
  const cfg = active(DEFAULT_FORGE_CONFIG);
  const ev = (ops: CraftOpFact[]) => evaluateForge({ cfg, facts: facts(ops), now: 0, claimedRefs: new Set(), materials: () => [] });
  // 4 sobres = 80 XP (nivel 1); el 5º llega a 100 → nivel 2: se abre el paso 1 de la cadena.
  const four = Array.from({ length: 4 }, (_, i) => op("pack-estandar-premium", "PACK", i));
  const five = [...four, op("pack-estandar-premium", "PACK", 4)];
  const e1 = progressEvents(ev(four), ev(five));
  assert.deepEqual(e1.find((e) => e.msg === "level_up"), { msg: "level_up", from: 1, to: 2 });
  assert.ok(e1.some((e) => e.msg === "recipe_unlock" && e.recipeId === "forge-ruta-oro"));
  assert.deepEqual(progressEvents(ev(five), ev(five)), [], "la misma foto (un reintento) no nombra nada");
  // Nivel 5 → el plano Sello (FORGE_LEVEL 5) pasa a poseído.
  const many = (n: number) => Array.from({ length: n }, (_, i) => op("pack-estandar-premium", "PACK", i));
  let n = 5; while (levelFromXp(n * cfg.xp.craftPack, cfg.curve).level < 5) n++;
  assert.ok(progressEvents(ev(many(n - 1)), ev(many(n))).some((e) => e.msg === "blueprint_unlock" && e.blueprintId === "bp-sello-champions"));
  const steps = cfg.chains[0].steps;
  const chainOps = steps.map((r, i) => op(r, "CARD", 100 + i));
  assert.ok(progressEvents(ev(chainOps.slice(0, 2)), ev(chainOps)).some((e) => e.msg === "chain_complete" && e.chainId === cfg.chains[0].id));
});

/* ═══════════════════ POSEER vs CONSUMIR ═══════════════════ */

test("F79 E7 · POSEER se comprueba y NO consume; CONSUMIR filtra por clase/edición/equipo/jugador REALES", () => {
  const inv = { distinctCards: 3, distinctByVariant: { "masters-l": 2 }, distinctPlayers: 3, ownedCardIds: new Set([of("masters")[0].id]) };
  assert.equal(checkOwn({ type: "OWN_EDITION", variantId: "masters-l", min: 2 }, inv).met, true);
  assert.equal(checkOwn({ type: "OWN_EDITION", variantId: "masters-l", min: 3 }, inv).met, false);
  assert.equal(checkOwn({ type: "OWN_DISTINCT_PLAYERS", min: 4 }, inv).met, false);
  assert.equal(checkOwn({ type: "OWN_CARD", cardId: of("masters")[0].id }, inv).met, true);
  const m = of("masters").find((c) => c.variantId === "masters-l")!;
  assert.ok(slotMatches(m, { qty: 1, class: "masters" }, teamOf));
  assert.ok(slotMatches(m, { qty: 1, class: "masters", variantId: "masters-l" }, teamOf));
  assert.ok(!slotMatches(m, { qty: 1, class: "masters", variantId: "masters-sdc" }, teamOf));
  assert.ok(!slotMatches(m, { qty: 1, class: "oro" }, teamOf));
  assert.ok(slotMatches(m, { qty: 1, class: "masters", playerId: m.playerId }, teamOf));
  assert.ok(!slotMatches(m, { qty: 1, class: "masters", team: "__no-such-team__" }, teamOf));
});

/* ═══════════════════ selector, auto-selección, validación ═══════════════════ */

const plata = of("plata");
const P = (i: number) => plata[i].id;

function mats(owned: OwnedCopy[], opts: { deck?: string[]; fav?: string[]; show?: string[]; slots?: { qty: number; class: PackCardClass }[] } = {}) {
  return buildMaterials({ owned, inDeck: new Set(opts.deck ?? []), favoriteCardIds: new Set(opts.fav ?? []), showcaseUids: new Set(opts.show ?? []), slots: opts.slots ?? [{ qty: 4, class: "plata" }], cardOf: getCard, teamOf });
}

test("F79 S1 · materiales: última copia, bloqueadas (mercado), equipos y protección", () => {
  const owned = [...copies(P(0), 3, "a"), ...copies(P(1), 1, "b"), ...copies(P(2), 2, "c"), { uid: "c-lock", cardId: P(2), locked: true }, ...copies(P(3), 2, "d")];
  const m = mats(owned, { deck: ["a-0"], fav: [P(3)] })[0];
  const by = Object.fromEntries(m.candidates.map((c) => [c.cardId, c]));
  assert.equal(by[P(0)].usable, 2, "3 copias (1 en equipo): libres 2, desbloqueadas−1 = 2");
  assert.ok(!by[P(0)].free.some((f) => f.uid === "a-0"), "la del equipo no se ofrece");
  assert.equal(by[P(1)], undefined, "una sola copia: jamás");
  assert.equal(by[P(2)].usable, 1, "2 desbloqueadas + 1 en venta → solo 1 (la de venta no es la que conservas)");
  assert.ok(by[P(3)].free.every((f) => f.protectedBy.includes("FAVORITE")), "favorita: protegida");
  assert.equal(m.availableTotal, 2 + 1 + 1);
  assert.equal(m.availableUnprotected, 2 + 1, "la favorita no cuenta para la auto-selección");
});

test("F79 S2 · auto-selección conservadora: duplicados primero, menor OVR, nunca protegidas ni última copia", () => {
  const lowOvr = [...plata].sort((a, b) => a.ovr - b.ovr || a.id.localeCompare(b.id));
  const [lo, hi] = [lowOvr[0], lowOvr[lowOvr.length - 1]];
  const owned = [...copies(hi.id, 5, "h"), ...copies(lo.id, 3, "l"), ...copies(P(5) === hi.id || P(5) === lo.id ? P(6) : P(5), 9, "f")];
  const fav = owned.find((o) => o.uid === "f-0")!.cardId;
  const m = mats(owned, { fav: [fav], show: ["h-1"] });
  const a = autoFill(m);
  assert.equal(a.missing, 0);
  assert.equal(a.uids.length, 4);
  assert.ok(!a.uids.some((u) => u.startsWith("f-")), "la favorita (9 copias) NO se coge aunque tenga más duplicados");
  assert.ok(!a.uids.includes("h-1"), "la copia de la vitrina no se coge");
  assert.ok(a.uids.filter((u) => u.startsWith("h-")).length <= 4, "tope por carta: 5 copias → como mucho 4");
  // Sin la favorita, las de más copias van primero.
  assert.ok(a.uids[0].startsWith("h-"), "más duplicados primero");
  const short = autoFill(mats(copies(P(0), 2, "x")));
  assert.equal(short.missing, 3, "2 copias → solo 1 entregable → faltan 3");
});

test("F79 S3 · validación del servidor: cuenta, repetidas, ajenas, última copia, protegidas confirmadas y reparto por huecos", () => {
  const owned = [...copies(P(0), 4, "a"), ...copies(P(1), 3, "b")];
  const fav = [P(1)];
  const m = mats(owned, { fav });
  assert.deepEqual(validateSelection(["a-0", "a-1", "a-2"], m), { ok: false, error: "WRONG_COUNT" });
  assert.deepEqual(validateSelection(["a-0", "a-0", "a-1", "a-2"], m), { ok: false, error: "DUPLICATE_INPUT" });
  assert.deepEqual(validateSelection(["a-0", "a-1", "a-2", "zzz"], m), { ok: false, error: "NOT_ELIGIBLE" });
  assert.deepEqual(validateSelection(["a-0", "a-1", "a-2", "a-3"], m), { ok: false, error: "LAST_COPY" }, "4 de 4 copias: dejaría 0");
  assert.deepEqual(validateSelection(["a-0", "a-1", "a-2", "b-0"], m), { ok: false, error: "PROTECTED" }, "favorita sin confirmar");
  const okc = validateSelection(["a-0", "a-1", "a-2", "b-0"], m, ["b-0"]);
  assert.ok(okc.ok && okc.protectedUsed.length === 1 && okc.protectedUsed[0] === "b-0", "confirmada: se acepta y se sabe cuál");
  // Huecos distintos: 2 plata + 2 oro. Una copia de plata no puede ocupar un hueco de oro.
  const oro = of("oro");
  const two = mats([...copies(P(0), 3, "p"), ...copies(oro[0].id, 3, "o")], { slots: [{ qty: 2, class: "plata" }, { qty: 2, class: "oro" }] });
  assert.ok(validateSelection(["p-0", "p-1", "o-0", "o-1"], two).ok);
  assert.deepEqual(validateSelection(["p-0", "p-1", "p-2", "o-0"], two), { ok: false, error: "LAST_COPY" });
  const twoMore = mats([...copies(P(0), 5, "p"), ...copies(oro[0].id, 3, "o")], { slots: [{ qty: 2, class: "plata" }, { qty: 2, class: "oro" }] });
  assert.deepEqual(validateSelection(["p-0", "p-1", "p-2", "o-0"], twoMore), { ok: false, error: "SLOT_MISMATCH" }, "3 platas no caben en 2 huecos de plata");
});

test("F79 S4 · tope compartido: una carta que encaja en dos huecos no puede dar más que su última copia", () => {
  const owned = copies(P(0), 3, "a"); // 2 entregables
  const m = mats(owned, { slots: [{ qty: 2, class: "plata" }, { qty: 2, class: "plata" }] });
  const a = autoFill(m);
  assert.equal(a.uids.length, 2, "aunque haya dos huecos, solo 2 copias salen de una carta con 3");
  assert.equal(a.missing, 2);
});

/* ═══════════════════ objetivos, logros, historial, pity, proyectos ═══════════════════ */

test("F79 O1 · periodos UTC: día y semana ISO (lunes), sin depender de la zona horaria", () => {
  assert.equal(periodKey("DAILY", Date.UTC(2026, 9, 1, 23, 59)), "D2026-10-01");
  assert.equal(periodKey("DAILY", Date.UTC(2026, 9, 2, 0, 0)), "D2026-10-02");
  assert.equal(periodKey("WEEKLY", Date.UTC(2026, 0, 1)), "W2026-01", "1-ene-2026 (jueves) es la semana 1");
  assert.equal(periodKey("WEEKLY", Date.UTC(2027, 0, 1)), "W2026-53", "1-ene-2027 (viernes) cae en la última semana de 2026");
  const w = periodWindow("WEEKLY", Date.UTC(2026, 9, 1, 12));
  assert.equal(new Date(w.start).getUTCDay(), 1, "la semana empieza en lunes");
  assert.equal(w.end - w.start, 7 * 86_400_000);
});

test("F79 O2 · objetivos: ventana del periodo, recompensa idempotente por periodo, XP una vez por objetivo y periodo", () => {
  const now = Date.UTC(2026, 9, 1, 12);
  const cfg = active({ ...DEFAULT_FORGE_CONFIG, objectives: [{ id: "obj-d", name: "Diario", period: "DAILY", metric: "CRAFT_ANY", target: 2, reward: { credits: 100 }, status: "ACTIVE", activeWindows: [{ from: now - 3 * 86_400_000, to: null }] }] });
  const ops = [op("card-plata-oro", "CARD", now - 3600_000), op("pack-premium-oro", "PACK", now - 1000), op("pack-premium-oro", "PACK", now - 86_400_000)];
  const [v] = objectiveViews(cfg, ops, now, new Set());
  assert.equal(v.progress, 2); assert.equal(v.state, "COMPLETED");
  assert.equal(objectiveViews(cfg, ops, now, new Set([objectiveClaimRef("obj-d", v.periodKey)]))[0].state, "CLAIMED");
  assert.equal(objectiveViews(cfg, ops, now + 86_400_000, new Set())[0].progress, 0, "al día siguiente empieza de cero");
  assert.equal(objectivesCompleted(cfg, ops), 1, "ayer hubo 1 (no llega), hoy 2 → un completado");
});

test("F79 O2b · activar un objetivo NO da XP por el pasado: solo cuentan crafteos desde su activación (sello del servidor)", () => {
  const now = Date.UTC(2026, 9, 10, 12);
  const days = Array.from({ length: 6 }, (_, i) => op("pack-premium-oro", "PACK", now - (i + 1) * 86_400_000));
  const obj = (activeFrom?: number) => active({ ...DEFAULT_FORGE_CONFIG, objectives: [{ id: "o", name: "Diario", period: "DAILY", metric: "CRAFT_ANY", target: 1, reward: {}, status: "ACTIVE", ...(activeFrom !== undefined ? { activeWindows: [{ from: activeFrom, to: null }] } : {}) }] });
  assert.equal(objectivesCompleted(obj(), days), 0, "sin sello: nada");
  assert.equal(objectivesCompleted(obj(now - 3600_000), days), 0, "activado hoy: los 6 días anteriores no cuentan");
  assert.equal(objectivesCompleted(obj(now - 2.5 * 86_400_000), days), 2, "activado hace 2,5 días: solo los 2 días posteriores");
  const today = [...days, op("pack-premium-oro", "PACK", now - 600_000)];
  assert.equal(objectiveViews(obj(now - 3600_000), today, now, new Set())[0].progress, 1, "lo de hoy tras activarse sí cuenta");
  assert.equal(objectiveViews(obj(now - 300_000), today, now, new Set())[0].progress, 0, "lo de hoy ANTES de activarse no");
});

test("F79 O3 · logros: progreso, sin recompensa = DONE (nada que reclamar), con recompensa → reclamable una vez", () => {
  const cfg = active(DEFAULT_FORGE_CONFIG);
  const v = { craftsTotal: 12, advancedCrafts: 0, chainsDone: 0, projectsClaimed: 1, forgeLevel: 3 };
  const by = Object.fromEntries(achievementViews(cfg, v, new Set()).map((a) => [a.id, a]));
  assert.equal(by["ach-primera-forja"].state, "DONE");
  assert.equal(by["ach-forjador"].state, "DONE");
  assert.equal(by["ach-maestro-forja"].state, "ACTIVE"); assert.equal(by["ach-maestro-forja"].progress, 12);
  const rewarded = { ...cfg, achievements: [{ ...cfg.achievements[0], reward: { credits: 50 } }] };
  assert.equal(achievementViews(rewarded, v, new Set())[0].state, "COMPLETED");
  assert.equal(achievementViews(rewarded, v, new Set([achievementClaimRef(cfg.achievements[0].id)]))[0].state, "CLAIMED");
});

test("F79 H1 · historial desde el libro mayor: tipo, materiales, resultado, orden y sin intentos fallidos", () => {
  const h = forgeHistory({
    ops: [op("pack-estandar-premium", "PACK", 1, { inputs: [{ packId: "estandar", qty: 4 }], outputs: [{ packId: "premium", qty: 1 }] }),
      op("card-plata-oro", "CARD", 3, { inputs: [{ uid: "u1", cardId: P(0) }, { uid: "u2", cardId: P(0) }, { uid: "u3", cardId: P(1) }], outputs: [{ uid: "o", cardId: of("oro")[0].id }] }),
      op("forge-ruta-oro", "CARD", 2)],
    projectClaims: [{ projectId: "p", at: 4, cardId: "x" }], rewardClaims: [{ ref: "forge:obj:obj-d:D2026-10-01", at: 5 }, { ref: "m73:mission:x", at: 6 }],
  });
  assert.deepEqual(h.map((e) => e.type), ["OBJECTIVE", "PROJECT", "EXCHANGE", "ADVANCED", "PACK"], "más reciente primero; asientos ajenos fuera");
  const ex = h.find((e) => e.type === "EXCHANGE")!;
  assert.deepEqual(ex.consumed, [{ cardId: P(0), qty: 2 }, { cardId: P(1), qty: 1 }]);
  assert.equal(ex.produced[0].qty, 1);
});

test("F79 P1 · pity DESACTIVADO por defecto: el pool es exactamente el de F73; activado prefiere no poseídas", () => {
  const pool = of("oro");
  assert.equal(DEFAULT_FORGE_CONFIG.pity.enabled, false);
  const off = effectivePool(pool, new Set([pool[0].id]), DEFAULT_FORGE_CONFIG.pity);
  assert.equal(off.pool.length, pool.length); assert.equal(off.pityApplied, false);
  const on = effectivePool(pool, new Set([pool[0].id]), { enabled: true, preferUnowned: true });
  assert.equal(on.pool.length, pool.length - 1); assert.ok(on.pityApplied);
  assert.equal(effectivePool(pool, new Set(pool.map((c) => c.id)), { enabled: true, preferUnowned: true }).pool.length, pool.length, "si ya las tienes todas, el pool entero");
  assert.equal(pickFrom(pool, -1), null); assert.equal(pickFrom(pool, pool.length), null); assert.equal(pickFrom(pool, 0)?.id, pool[0].id);
});

test("F79 PJ1 · proyectos 2.0: etapas por profundidad de dependencias + reúne + fabrica + reclama", () => {
  const mv = (id: string, deps: string[], done: boolean) => ({ id, name: id, description: "", target: 1, progress: done ? 1 : 0, state: (done ? "COMPLETED" : "ACTIVE") as never, reward: {}, hasReward: false, projectId: "p", dependsOn: deps, conditionType: "MATCH_WIN" as never, sortOrder: 0 });
  const ms = [mv("a", [], true), mv("b", [], true), mv("c", ["a", "b"], false)];
  assert.deepEqual([...missionDepths(ms).entries()].sort(), [["a", 1], ["b", 1], ["c", 2]]);
  const own = [{ kind: "OWN" as const, req: { type: "OWN_DISTINCT_PLAYERS" as const, min: 3 }, met: false, have: 1, need: 3, label: "x" }];
  const r = projectStages(ms, { projectId: "p", own: [own[0].req], fabricateRecipeId: "forge-x" }, own, { recipeId: "forge-x", name: "Forja X", done: false }, false);
  assert.deepEqual(r.stages.map((s) => s.kind), ["MISSIONS", "MISSIONS", "OWN", "FABRICATE", "CLAIM"]);
  assert.equal(r.stages[0].done, true); assert.equal(r.stages[1].done, false);
  assert.equal(r.extrasMet, false);
  const plain = projectStages(ms, undefined, [], null, false);
  assert.deepEqual(plain.stages.map((s) => s.kind), ["MISSIONS", "MISSIONS", "CLAIM"], "sin extras: igual que F73");
  assert.equal(plain.extrasMet, true);
});

/* ═══════════════════ configuración del panel ═══════════════════ */

test("F79 V1 · los valores por defecto son válidos con el catálogo REAL y todo el contenido nuevo nace DRAFT", () => {
  assert.deepEqual(validateForgeConfig(DEFAULT_FORGE_CONFIG, LOOKUP), []);
  const all = [...DEFAULT_FORGE_CONFIG.recipes, ...DEFAULT_FORGE_CONFIG.chains, ...DEFAULT_FORGE_CONFIG.blueprints, ...DEFAULT_FORGE_CONFIG.objectives, ...DEFAULT_FORGE_CONFIG.achievements];
  assert.ok(all.every((x) => x.status === "DRAFT"), "nada se publica solo");
  assert.ok([...DEFAULT_FORGE_CONFIG.objectives, ...DEFAULT_FORGE_CONFIG.achievements].every((x) => Object.keys(x.reward).length === 0), "sin recompensas de producción inventadas");
  assert.deepEqual(mergeForgeConfig({}), DEFAULT_FORGE_CONFIG);
  assert.equal(mergeForgeConfig({ xp: { craftPack: 7 } }).xp.craftCard, DEFAULT_FORGE_CONFIG.xp.craftCard, "un documento viejo sin un campo no rompe nada");
});

test("F79 V2 · activadas tal cual, las plantillas pasan su suelo y nunca son mejor ruta que el intercambio F73", () => {
  assert.deepEqual(validateForgeConfig(active(DEFAULT_FORGE_CONFIG), LOOKUP), [], "activables: por encima de su suelo seguro");
  const F73 = { oro: 3, masters: 8, champions: 14 } as Record<string, number>; // plata→oro, oro→masters, masters→champions
  for (const r of DEFAULT_FORGE_CONFIG.recipes) {
    const out = (r.output as { class: string }).class;
    assert.ok(r.consume.reduce((s, x) => s + x.qty, 0) > F73[out], `${r.id}: pide más que el intercambio equivalente`);
    assert.ok((advancedFloor(r, getCard)?.ratio ?? 99) <= r.consume.reduce((s, x) => s + x.qty, 0));
  }
});

test("F79 V3 · el panel rechaza: debajo del suelo, contenido inventado, dependencias en borrador, ciclos y recompensas fuera de tope", () => {
  const base = active(DEFAULT_FORGE_CONFIG);
  const codes = (c: ForgeConfig) => validateForgeConfig(c, LOOKUP).map((p) => p.code);
  assert.ok(codes({ ...base, recipes: base.recipes.map((r, i) => (i === 0 ? { ...r, consume: [{ qty: 2, class: "plata" }] } : r)) }).includes("BELOW_FLOOR"));
  assert.ok(codes({ ...base, recipes: [...base.recipes, { ...base.recipes[0], id: "forge-falsa", consume: [{ qty: 6, class: "plata", variantId: "edicion-inventada" }] }] }).includes("UNKNOWN_VARIANT"));
  assert.ok(codes({ ...base, recipes: [...base.recipes, { ...base.recipes[0], id: "forge-falsa2", output: { type: "CARD", cardId: "jugador-inventado__base" } }] }).includes("UNKNOWN_CARD"));
  assert.ok(codes({ ...base, recipes: [...base.recipes, { ...base.recipes[0], id: "forge-baja", consume: [{ qty: 6, class: "oro" }], output: { type: "CLASS", class: "plata" } }] }).includes("DOWNGRADE"));
  assert.ok(codes({ ...base, recipes: [...base.recipes, { ...base.recipes[0], id: "forge-icon", consume: [{ qty: 30, class: "prime" }], output: { type: "CLASS", class: "icon" } }] }).includes("SCARCE_OUTPUT"), "Icon (3 cartas) sería una garantía");
  assert.ok(codes({ ...base, blueprints: base.blueprints.map((b) => ({ ...b, status: "DRAFT" })) }).includes("DRAFT_DEPENDENCY"), "receta activa con plano en borrador");
  assert.ok(codes({ ...base, recipes: base.recipes.map((r, i) => (i === 0 ? { ...r, unlock: [{ type: "RECIPE_DONE", recipeId: "forge-ruta-champions" }] } : r)) }).includes("CYCLE"));
  assert.ok(codes({ ...base, objectives: [{ ...base.objectives[0], reward: { credits: 999_999 } }] }).includes("BAD_REWARD"));
  assert.ok(codes({ ...base, recipes: [...base.recipes, { ...base.recipes[0], id: "sin-prefijo" }] }).includes("BAD_ID"));
  assert.ok(codes({ ...base, recipes: [base.recipes[0], base.recipes[0]] }).includes("DUP_ID"));
  assert.ok(codes({ ...base, curve: { ...base.curve, growth: 9 } }).includes("BAD_CURVE"));
  assert.ok(codes({ ...base, projects: [{ projectId: "no-existe", own: [], fabricateRecipeId: null }] }).includes("UNKNOWN_PROJECT"));
});
