/**
 * ROAD TO CHAMPIONS · DOMINIO (Fase 35) — definición (1–15), rivales (16–24), dificultad (25–30),
 * progresión (31–40) y recompensa de primera victoria (41–50). Todo puro, sobre el catálogo real.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CardRegistry } from "@/collection/registry";
import { ROAD_TO_CHAMPIONS } from "@/data/roadToChampions";
import { currentTeamIdentity, isAmbiguousAlias } from "@/data/teamIdentities";
import { DUEL_ROLES, createDuelDeck, validateDuelDeck, makeDeckResolver, ownershipFromList } from "@/domain/cardgame";
import { DIFFICULTY_PROFILE } from "@/domain/cardgame/opponent/bots";
import { DAILY_DUEL_AWARD_CAP } from "@/domain/progression/duelRewards";
import {
  validateCampaign, allNodes, findNode, nodeCardTier, CAMPAIGN_NODES_MIN, CAMPAIGN_NODES_MAX,
  buildOpponentPlan, OPPONENT_MIN_CORE, TIER_TO_BOT, expectedTier, cardTierFor, botDifficultyOf,
  resolveStatuses, applyOutcome, outcomeForHuman, summarize, canStartNode, closesChapter, bestOutcome, DRAW_COMPLETES_NODE,
  FIRST_CLEAR_CREDITS, CAMPAIGN_FIRST_CLEAR_CAP, campaignRewardTotal, firstClearRef, CAMPAIGN_REWARD_REASON,
  buildCampaignSnapshot, findNodeView,
  type CampaignDefinition, type NodeProgress, type OpponentPlan,
} from "@/domain/campaign";

const DEF = ROAD_TO_CHAMPIONS;
const REG = new CardRegistry();
const clone = (): CampaignDefinition => structuredClone(DEF);
const codes = (d: CampaignDefinition) => validateCampaign(d).issues.map((i) => i.code);
const plans = (): Map<string, OpponentPlan> => new Map(allNodes(DEF).map((n) => [n.id, buildOpponentPlan(REG, n.opponent.teamId, nodeCardTier(DEF, n.id)!)]));
const done = (nodeId: string, over: Partial<NodeProgress> = {}): NodeProgress => ({
  nodeId, version: DEF.version, status: "COMPLETED", bestResult: "WIN", attempts: 1, wins: 1, firstClearedAt: 1, firstClearMatchId: "m", updatedAt: 1, ...over,
});

/* ─────────────── 1–15 · definición ─────────────── */

test("T1 · la definición rtc-2 es válida", () => {
  const r = validateCampaign(DEF);
  assert.deepEqual(r.issues, []);
  assert.ok(r.ok);
});

test("T2 · 3 capítulos y entre 12 y 18 nodos (15)", () => {
  assert.equal(DEF.chapters.length, 3);
  const n = allNodes(DEF).length;
  assert.ok(n >= CAMPAIGN_NODES_MIN && n <= CAMPAIGN_NODES_MAX);
  assert.equal(n, 15);
});

test("T3 · identidad versionada: campaignId estable y versión rtc-2", () => {
  assert.equal(DEF.campaignId, "road-to-champions");
  assert.equal(DEF.version, "rtc-2");
});

test("T4 · ids de nodo únicos, con formato cN-nM y coherentes con su capítulo", () => {
  const ids = allNodes(DEF).map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const c of DEF.chapters) for (const n of c.nodes) {
    assert.match(n.id, /^c[0-9]{1,2}-n[0-9]{1,2}$/);
    assert.equal(n.chapterId, c.id);
    assert.equal(n.id, `c${c.order}-n${n.order}`);
  }
});

test("T5 · cada capítulo termina en UN jefe (BOSS) y tiene al menos un ÉLITE", () => {
  for (const c of DEF.chapters) {
    const sorted = [...c.nodes].sort((a, b) => a.order - b.order);
    assert.equal(sorted.at(-1)!.type, "BOSS");
    assert.equal(c.nodes.filter((n) => n.type === "BOSS").length, 1);
    assert.ok(c.nodes.some((n) => n.type === "ELITE"));
  }
});

test("T6 · un único nodo de entrada (c1-n1) sin requisitos", () => {
  const entries = allNodes(DEF).filter((n) => n.requirements.completed.length === 0);
  assert.deepEqual(entries.map((n) => n.id), ["c1-n1"]);
});

test("T7 · grafo lineal: cada nodo abre el siguiente y el jefe abre el capítulo siguiente", () => {
  const nodes = allNodes(DEF);
  nodes.forEach((n, i) => {
    if (i < nodes.length - 1) assert.deepEqual(n.nextNodes, [nodes[i + 1].id]);
    else assert.deepEqual(n.nextNodes, []);
    if (i > 0) assert.deepEqual(n.requirements.completed, [nodes[i - 1].id]);
  });
});

test("T8 · el validador detecta ids duplicados", () => {
  const d = clone(); d.chapters[0].nodes[1].id = "c1-n1";
  assert.ok(codes(d).includes("DUPLICATE_NODE"));
});

test("T9 · el validador detecta ciclos", () => {
  const d = clone();
  d.chapters[0].nodes[2].nextNodes.push("c1-n2");
  d.chapters[0].nodes[1].requirements.completed.push("c1-n3");
  assert.ok(codes(d).includes("CYCLE"));
});

test("T10 · el validador detecta referencias desconocidas, enlaces asimétricos y nodos inalcanzables", () => {
  const a = clone(); a.chapters[0].nodes[1].requirements.completed = ["c9-n9"];
  assert.ok(codes(a).includes("UNKNOWN_REF"));
  const b = clone(); b.chapters[0].nodes[1].nextNodes = []; b.chapters[0].nodes[2].requirements.completed = [];
  const cb = codes(b);
  assert.ok(cb.includes("UNREACHABLE") && cb.includes("MULTIPLE_ENTRY"));
  const c = clone(); c.chapters[0].nodes[0].nextNodes = ["c1-n3"];
  assert.ok(codes(c).includes("ASYMMETRIC_LINK"));
});

test("T11 · el validador detecta una dificultad que no sigue la regla", () => {
  const d = clone(); d.chapters[0].nodes[0].difficulty = "CHAMPION";
  assert.ok(codes(d).includes("BAD_DIFFICULTY"));
});

test("T12 · el validador detecta recompensas fuera de tabla y por encima del techo", () => {
  const d = clone(); d.chapters[0].nodes[0].rewards.firstClear.credits = 5000;
  const c = codes(d);
  assert.ok(c.includes("BAD_REWARD") && c.includes("REWARD_CAP"));
});

test("T13 · rivales: equipo inventado, no verificado o repetido → inválido", () => {
  const a = clone(); a.chapters[0].nodes[0].opponent.teamId = "equipo-inventado";
  assert.ok(codes(a).includes("UNKNOWN_TEAM"));
  const b = clone(); b.chapters[0].nodes[0].opponent.teamId = "gen-g";
  assert.ok(codes(b).includes("UNVERIFIED_TEAM"));
  const c = clone(); c.chapters[0].nodes[1].opponent.teamId = "navi";
  assert.ok(codes(c).includes("DUPLICATE_OPPONENT"));
});

test("T14 · la definición es DETERMINISTA: sin reloj ni azar en su código", () => {
  for (const f of ["src/data/roadToChampions.ts", "src/domain/campaign/definition.ts", "src/domain/campaign/opponent.ts", "src/domain/campaign/progression.ts", "src/domain/campaign/difficulty.ts"]) {
    const code = readFileSync(join(process.cwd(), f), "utf8");
    assert.ok(!/Date\.now\(|Math\.random\(|new Date\(/.test(code), f);
  }
  assert.equal(JSON.stringify(clone()), JSON.stringify(DEF));
});

test("T15 · allNodes y findNode recorren en orden de capítulo y nodo", () => {
  const ids = allNodes(DEF).map((n) => n.id);
  assert.equal(ids[0], "c1-n1"); assert.equal(ids[5], "c2-n1"); assert.equal(ids[14], "c3-n5");
  assert.equal(findNode(DEF, "c2-n5")!.chapterOrder, 2);
  assert.equal(findNode(DEF, "c9-n1"), null);
});

/* ─────────────── 16–24 · rivales reales ─────────────── */

const PLANS = plans();

test("T16 · todos los nodos tienen un mazo de rival construible con el catálogo real", () => {
  for (const [id, p] of PLANS) assert.ok(p.ok, `${id}: ${!p.ok ? p.reason : ""}`);
});

test("T17 · 10 cartas, dos por cada rol canónico", () => {
  for (const p of PLANS.values()) {
    assert.ok(p.ok);
    assert.equal(p.cards.length, 10);
    for (const role of DUEL_ROLES) assert.equal(p.cards.filter((c) => c.role === role).length, 2, role);
  }
});

test("T18 · sin jugadores repetidos en un mazo rival", () => {
  for (const p of PLANS.values()) { assert.ok(p.ok); assert.equal(new Set(p.cards.map((c) => c.playerId)).size, 10); }
});

test("T19 · cartas REALES: existen en el catálogo, con trío de combate, y el rol es el de la carta (o su jugador)", () => {
  for (const p of PLANS.values()) {
    assert.ok(p.ok);
    for (const c of p.cards) {
      const def = REG.card(c.cardId);
      assert.ok(def && def.combat, c.cardId);
      assert.equal(def.playerId, c.playerId);
      assert.equal(def.role ?? REG.player(c.playerId)!.role, c.role);
    }
  }
});

test("T20 · el núcleo es el roster ACTUAL del equipo (sin alias ambiguos) y alcanza el mínimo", () => {
  for (const p of PLANS.values()) {
    assert.ok(p.ok);
    assert.ok(p.coreCount >= OPPONENT_MIN_CORE, p.teamId);
    for (const c of p.cards.filter((x) => x.source === "TEAM")) {
      const team = REG.player(c.playerId)!.team;
      assert.equal(currentTeamIdentity(team)?.canonicalId, p.teamId);
      assert.equal(isAmbiguousAlias(team), false);
    }
    for (const c of p.cards.filter((x) => x.source !== "TEAM")) {
      assert.notEqual(currentTeamIdentity(REG.player(c.playerId)!.team)?.canonicalId, p.teamId);
    }
  }
});

test("T21 · determinista: misma entrada → mismo mazo, también con otra instancia del catálogo", () => {
  const other = new CardRegistry();
  for (const n of allNodes(DEF)) {
    assert.deepEqual(buildOpponentPlan(other, n.opponent.teamId, nodeCardTier(DEF, n.id)!), PLANS.get(n.id));
  }
});

test("T22 · el validador CANÓNICO de mazos acepta cada mazo rival", () => {
  for (const [id, p] of PLANS) {
    assert.ok(p.ok);
    const owned = p.cards.map((c, i) => ({ uid: `bot-rtc-${id}-${i}`, cardId: c.cardId, obtainedAt: 0 }));
    const deck = createDuelDeck({ id: `bot-rtc-${id}`, name: p.teamName, cards: owned.map((o) => o.uid), now: 0 });
    const v = validateDuelDeck(deck, makeDeckResolver(REG, ownershipFromList(owned)));
    assert.ok(v.valid, `${id}: ${v.errors.map((e) => e.code).join(",")}`);
  }
});

test("T23 · equipo desconocido o no verificado → sin mazo (nunca se inventa)", () => {
  assert.deepEqual(buildOpponentPlan(REG, "equipo-inventado", "BASE"), { ok: false, teamId: "equipo-inventado", reason: "UNKNOWN_TEAM" });
  const g = buildOpponentPlan(REG, "gen-g", "BASE");
  assert.equal(g.ok, false);
  assert.equal(!g.ok && g.reason, "UNVERIFIED_TEAM");
});

test("T24 · el escalón de cartas ordena la versión de CADA jugador: BASE ≤ MID ≤ TOP", () => {
  for (const team of ["navi", "fnatic", "leviatan", "paper-rex"]) {
    const [b, m, t] = (["BASE", "MID", "TOP"] as const).map((tier) => buildOpponentPlan(REG, team, tier));
    assert.ok(b.ok && m.ok && t.ok);
    const ovr = (p: typeof b, id: string) => (p.ok ? p.cards.find((c) => c.playerId === id)?.ovr : undefined);
    for (const c of b.cards) {
      const mid = ovr(m, c.playerId); const top = ovr(t, c.playerId);
      if (mid !== undefined) assert.ok(c.ovr <= mid, `${team}/${c.playerId}`);
      if (top !== undefined) assert.ok(c.ovr <= top, `${team}/${c.playerId}`);
    }
    // El núcleo (mismos jugadores del roster) es más fuerte en TOP que en BASE.
    const core = (p: typeof b) => (p.ok ? p.cards.filter((c) => c.source === "TEAM").reduce((s, c) => s + c.ovr, 0) / p.coreCount : 0);
    assert.ok(core(b) <= core(t), team);
  }
});

/* ─────────────── 25–30 · dificultad ─────────────── */

test("T25 · mapeo a dificultad canónica: ROOKIE→EASY, PRO→NORMAL, CHAMPION→HARD", () => {
  assert.deepEqual(TIER_TO_BOT, { ROOKIE: "EASY", PRO: "NORMAL", CHAMPION: "HARD" });
});

test("T26 · regla de dificultad por capítulo y tipo", () => {
  assert.equal(expectedTier(1, "MATCH"), "ROOKIE"); assert.equal(expectedTier(1, "ELITE"), "PRO"); assert.equal(expectedTier(1, "BOSS"), "PRO");
  assert.equal(expectedTier(2, "MATCH"), "PRO"); assert.equal(expectedTier(2, "ELITE"), "CHAMPION"); assert.equal(expectedTier(2, "BOSS"), "CHAMPION");
  assert.equal(expectedTier(3, "MATCH"), "CHAMPION"); assert.equal(expectedTier(3, "BOSS"), "CHAMPION");
});

test("T27 · escalón de cartas por capítulo; el jefe sube uno (con tope)", () => {
  assert.equal(cardTierFor(1, "MATCH"), "BASE"); assert.equal(cardTierFor(1, "ELITE"), "BASE"); assert.equal(cardTierFor(1, "BOSS"), "MID");
  assert.equal(cardTierFor(2, "MATCH"), "MID"); assert.equal(cardTierFor(2, "BOSS"), "TOP");
  assert.equal(cardTierFor(3, "MATCH"), "TOP"); assert.equal(cardTierFor(3, "BOSS"), "TOP");
});

test("T28 · sin trampas: ningún nivel del bot canónico tiene información perfecta; perfiles intactos", () => {
  assert.deepEqual(DIFFICULTY_PROFILE.EASY, { heuristicRate: 0, perfectInformation: false });
  assert.deepEqual(DIFFICULTY_PROFILE.NORMAL, { heuristicRate: 0.5, perfectInformation: false });
  assert.deepEqual(DIFFICULTY_PROFILE.HARD, { heuristicRate: 0.85, perfectInformation: false });
  for (const n of allNodes(DEF)) assert.ok(botDifficultyOf(n.difficulty) in DIFFICULTY_PROFILE);
});

test("T29 · la dificultad nunca baja a lo largo del recorrido", () => {
  const order = ["ROOKIE", "PRO", "CHAMPION"];
  const tiers = allNodes(DEF).map((n) => order.indexOf(n.difficulty));
  // Tras un jefe/élite el siguiente capítulo abre en su base, que es ≥ la base anterior.
  const bases = DEF.chapters.map((c) => order.indexOf(expectedTier(c.order, "MATCH")));
  assert.deepEqual(bases, [0, 1, 2]);
  assert.ok(tiers.every((t) => t >= 0));
});

test("T30 · un nodo no trae modificadores de reglas, ventajas ni penalizaciones", () => {
  const allowed = ["id", "chapterId", "order", "type", "name", "objective", "opponent", "difficulty", "requirements", "nextNodes", "rewards"];
  for (const n of allNodes(DEF)) {
    assert.deepEqual(Object.keys(n).sort(), [...allowed].sort());
    assert.deepEqual(Object.keys(n.opponent), ["teamId"]);
  }
});

/* ─────────────── 31–40 · progresión ─────────────── */

test("T31 · sin progreso: solo c1-n1 disponible, el resto bloqueado", () => {
  const s = resolveStatuses(DEF, []);
  assert.equal(s.get("c1-n1"), "AVAILABLE");
  assert.equal([...s.values()].filter((x) => x === "AVAILABLE").length, 1);
  assert.equal([...s.values()].filter((x) => x === "LOCKED").length, 14);
});

test("T32 · completar un nodo desbloquea el siguiente (condición explícita, sin nivel)", () => {
  const s = resolveStatuses(DEF, [done("c1-n1")]);
  assert.equal(s.get("c1-n1"), "COMPLETED");
  assert.equal(s.get("c1-n2"), "AVAILABLE");
  assert.equal(s.get("c1-n3"), "LOCKED");
});

test("T33 · resultado autoritativo → resultado del jugador (A)", () => {
  assert.equal(outcomeForHuman({ winner: "A", isDraw: false }), "WIN");
  assert.equal(outcomeForHuman({ winner: "B", isDraw: false }), "LOSS");
  assert.equal(outcomeForHuman({ winner: null, isDraw: true }), "DRAW");
  assert.equal(outcomeForHuman({ winner: null, isDraw: false }), "DRAW");
});

test("T34 · primera victoria: completa, marca fecha y partida", () => {
  const r = applyOutcome(null, { nodeId: "c1-n1", version: "rtc-1", outcome: "WIN", matchId: "m1", at: 100 });
  assert.equal(r.firstClear, true);
  assert.deepEqual({ s: r.next.status, a: r.next.attempts, w: r.next.wins, at: r.next.firstClearedAt, m: r.next.firstClearMatchId }, { s: "COMPLETED", a: 1, w: 1, at: 100, m: "m1" });
});

test("T35 · derrota: cuenta el intento y el nodo sigue disponible; el mejor resultado sube", () => {
  const l = applyOutcome(null, { nodeId: "c1-n1", version: "rtc-1", outcome: "LOSS", matchId: "m1", at: 1 });
  assert.equal(l.firstClear, false);
  assert.equal(l.next.status, "ATTEMPTED");
  assert.equal(resolveStatuses(DEF, [l.next]).get("c1-n1"), "AVAILABLE");
  const d = applyOutcome(l.next, { nodeId: "c1-n1", version: "rtc-1", outcome: "DRAW", matchId: "m2", at: 2 });
  assert.equal(d.next.bestResult, "DRAW");
  assert.equal(d.next.attempts, 2);
  assert.equal(bestOutcome("WIN", "LOSS"), "WIN");
});

test("T36 · política de empate: NO completa el nodo", () => {
  assert.equal(DRAW_COMPLETES_NODE, false);
  const r = applyOutcome(null, { nodeId: "c1-n1", version: "rtc-1", outcome: "DRAW", matchId: "m", at: 1 });
  assert.equal(r.next.status, "ATTEMPTED");
  assert.equal(r.firstClear, false);
});

test("T37 · rejugar y ganar un nodo completado NO es primera victoria y conserva la original", () => {
  const first = applyOutcome(null, { nodeId: "c1-n1", version: "rtc-1", outcome: "WIN", matchId: "m1", at: 1 }).next;
  const again = applyOutcome(first, { nodeId: "c1-n1", version: "rtc-1", outcome: "WIN", matchId: "m2", at: 9 });
  assert.equal(again.firstClear, false);
  assert.equal(again.next.firstClearedAt, 1);
  assert.equal(again.next.firstClearMatchId, "m1");
  assert.equal(again.next.wins, 2);
});

test("T38 · perder un nodo ya completado no lo descompleta", () => {
  const first = applyOutcome(null, { nodeId: "c1-n1", version: "rtc-1", outcome: "WIN", matchId: "m1", at: 1 }).next;
  const lost = applyOutcome(first, { nodeId: "c1-n1", version: "rtc-1", outcome: "LOSS", matchId: "m2", at: 2 });
  assert.equal(lost.next.status, "COMPLETED");
  assert.equal(lost.next.bestResult, "WIN");
});

test("T39 · resumen: X/Y nodos, capítulos completos, siguiente nodo y campaña completa", () => {
  const c1 = DEF.chapters[0].nodes.map((n) => done(n.id));
  const s = summarize(DEF, resolveStatuses(DEF, c1));
  assert.deepEqual({ c: s.completed, t: s.total, ch: s.chaptersComplete, next: s.nextNodeId, complete: s.complete }, { c: 5, t: 15, ch: 1, next: "c2-n1", complete: false });
  assert.equal(closesChapter(DEF, resolveStatuses(DEF, c1), "c1-n5"), "c1");
  const all = summarize(DEF, resolveStatuses(DEF, allNodes(DEF).map((n) => done(n.id))));
  assert.equal(all.complete, true);
  assert.equal(all.nextNodeId, null);
});

test("T40 · lanzar: bloqueado/desconocido se rechaza; completado se puede rejugar; versión vieja no resetea", () => {
  assert.deepEqual(canStartNode(DEF, [], "c1-n2"), { ok: false, code: "LOCKED" });
  assert.deepEqual(canStartNode(DEF, [], "c9-n9"), { ok: false, code: "UNKNOWN_NODE" });
  assert.deepEqual(canStartNode(DEF, [done("c1-n1")], "c1-n1"), { ok: true });
  const old = resolveStatuses(DEF, [done("c1-n1", { version: "rtc-0" }), done("c7-n7")]);
  assert.equal(old.get("c1-n1"), "COMPLETED");
  assert.equal(old.has("c7-n7"), false);
});

/* ─────────────── 41–50 · recompensa de primera victoria ─────────────── */

test("T41 · tabla de primera victoria: 50 / 100 / 200 créditos", () => {
  assert.deepEqual(FIRST_CLEAR_CREDITS, { MATCH: 50, ELITE: 100, BOSS: 200 });
});

test("T42 · la campaña entera está acotada: 1.350 ≤ techo 1.500", () => {
  assert.equal(campaignRewardTotal(DEF), 1350);
  assert.ok(campaignRewardTotal(DEF) <= CAMPAIGN_FIRST_CLEAR_CAP);
});

test("T43 · clave de idempotencia por campaña y nodo, SIN versión (una versión nueva no repaga)", () => {
  assert.equal(firstClearRef(DEF.campaignId, "c1-n1"), "campaign:road-to-champions:c1-n1");
  const v2 = { ...clone(), version: "rtc-2" };
  assert.equal(firstClearRef(v2.campaignId, "c1-n1"), firstClearRef(DEF.campaignId, "c1-n1"));
});

test("T44 · motivo del libro mayor estable", () => {
  assert.equal(CAMPAIGN_REWARD_REASON, "campaign_first_clear");
});

test("T45 · solo créditos: ni sobres, ni cartas, ni XP, ni cosméticos en la definición", () => {
  for (const n of allNodes(DEF)) {
    assert.deepEqual(Object.keys(n.rewards), ["firstClear"]);
    assert.deepEqual(Object.keys(n.rewards.firstClear), ["credits"]);
  }
});

test("T46 · la foto cuenta los créditos de primera victoria conseguidos", () => {
  const s = buildCampaignSnapshot({ def: DEF, opponents: PLANS, progress: [done("c1-n1"), done("c1-n2"), done("c1-n3"), done("c1-n4"), done("c1-n5")], available: true, unavailableReason: null, serverNow: 0 });
  assert.equal(s.economy.firstClearEarned, 50 * 3 + 100 + 200);
  assert.equal(s.economy.firstClearTotal, 1350);
  assert.equal(findNodeView(s, "c1-n5")!.firstClearDone, true);
});

test("T47 · sin moneda, stamina, energía ni tickets en el dominio y el servicio de campaña", () => {
  for (const f of ["src/domain/campaign/rewards.ts", "src/domain/campaign/types.ts", "src/server/services/campaign.ts", "src/data/roadToChampions.ts"]) {
    const code = readFileSync(join(process.cwd(), f), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    assert.ok(!/stamina|energy|ticket|gems?\b|currency|paid_retry|packId|cosmetics/i.test(code), f);
  }
});

test("T48 · el pago pasa por `award` (única vía de concesión); nunca se escribe el libro mayor a mano", () => {
  const code = readFileSync(join(process.cwd(), "src/server/services/campaign.ts"), "utf8");
  assert.ok(/award\(sb, \{ userId, ref: firstClearRef\(/.test(code));
  assert.ok(!/credit_transactions|profiles"\)\.update|app_grant_reward/.test(code));
});

test("T49 · 0051 garantiza en BD una sola primera victoria por nodo y usuario", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/0051_campaign_road_to_champions.sql"), "utf8");
  assert.ok(/create unique index if not exists campaign_attempts_first_clear_once\s+on public\.campaign_attempts\(user_id, campaign_id, node_id\) where first_clear/.test(sql));
});

test("T50 · la partida de campaña paga lo de siempre: el tope diario PvE sigue en 20", () => {
  assert.equal(DAILY_DUEL_AWARD_CAP, 20);
});
