/**
 * FASE 52 · SEASON COMMAND CENTER — la vista deriva de las definiciones REALES, el servidor manda, los
 * reclamos siguen siendo idempotentes y el Marketplace cerrado no ofrece misiones imposibles.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { CURRENT_SEASON } from "@/data/season";
import { SEASON_CALENDAR } from "@/data/seasonCalendar";
import { freshPassState } from "@/battlepass";
import type { MetaObjective } from "@/domain/progression/meta";
import {
  rewardParts, trackColumns, focusColumnIndex, nodeState, missionGroups, missionView, nextSteps, type PassLike,
} from "./hubView";
import { FakeSupabase } from "@/server/services/testing/fakeSupabase";
import { MemSupabase } from "@/server/services/testing/memSupabase";
import { getSeasonHub } from "@/server/services/season";
import { claimPassLevel, getProgression } from "@/server/services/progression";
import { GLOBAL_MARKET_ENABLED } from "@/config/features";
import { SeasonRewardTrack, RewardVisual } from "@/components/season/SeasonRewards";
import { SeasonMissions } from "@/components/season/SeasonMissions";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

/** Un pase construido con los carriles REALES de la temporada (mismos objetos Reward). */
function pase(level: number, opts: { claimedFree?: number[]; compOpen?: boolean; claimedComp?: number[]; into?: number } = {}): PassLike & { nextReward: null; name: string } {
  const lvls = (track: Record<number, (typeof CURRENT_SEASON.free)[number]>, claimed: number[], open: boolean) =>
    Object.keys(track).map(Number).sort((a, b) => a - b).map((l) => ({ level: l, reward: track[l], claimed: claimed.includes(l), claimable: open && l <= level && !claimed.includes(l) }));
  return {
    name: CURRENT_SEASON.name, level, maxLevel: CURRENT_SEASON.maxLevel, xpIntoLevel: opts.into ?? 400, xpForNext: CURRENT_SEASON.xpPerLevel,
    progress: (opts.into ?? 400) / CURRENT_SEASON.xpPerLevel, competitiveUnlocked: !!opts.compOpen, nextReward: null,
    tracks: { free: lvls(CURRENT_SEASON.free, opts.claimedFree ?? [], true), competitive: lvls(CURRENT_SEASON.competitive!, opts.claimedComp ?? [], !!opts.compOpen) },
  };
}

const obj = (id: string, kind: string, metric: string, current: number, goal: number, o: Partial<MetaObjective> = {}): MetaObjective => ({
  id, label: id, kind, metric, current, goal, complete: current >= goal, claimed: false, rewardCredits: 100, xp: 50, packId: null, packCount: 0, assignedAt: 1, expiresAt: null, ...o,
});

/* ═══════════ CARRIL DE RECOMPENSAS ═══════════ */

test("F52 T1 · el carril sale de los carriles REALES: 30 niveles, competitivo cada 5, mismas recompensas (sin copiar cifras)", () => {
  const cols = trackColumns(pase(7, { claimedFree: [1, 2, 3, 4, 5] }));
  assert.equal(cols.length, CURRENT_SEASON.maxLevel);
  for (const c of cols) {
    assert.equal(c.free!.reward, CURRENT_SEASON.free[c.level], `nivel ${c.level}: el MISMO objeto de la temporada`);
    assert.equal(!!c.competitive, !!CURRENT_SEASON.competitive![c.level]);
  }
  assert.deepEqual(cols.filter((c) => c.competitive).map((c) => c.level), Object.keys(CURRENT_SEASON.competitive!).map(Number));
});

test("F52 T2 · estados solo los reales: reclamado · reclamable · carril cerrado · bloqueado; el servidor manda", () => {
  const cols = trackColumns(pase(7, { claimedFree: [1, 2, 3, 4, 5] }));
  const st = (l: number, lane: "free" | "competitive" = "free") => cols.find((c) => c.level === l)![lane]!.state;
  assert.equal(st(3), "CLAIMED");
  assert.equal(st(6), "CLAIMABLE");
  assert.equal(st(8), "LOCKED");
  assert.equal(st(5, "competitive"), "LANE_LOCKED", "competitivo alcanzado con el carril cerrado");
  assert.equal(st(10, "competitive"), "LOCKED");
  const abierto = trackColumns(pase(12, { compOpen: true, claimedComp: [5] }));
  assert.equal(abierto.find((c) => c.level === 5)!.competitive!.state, "CLAIMED");
  assert.equal(abierto.find((c) => c.level === 10)!.competitive!.state, "CLAIMABLE");
  // Alcanzado pero el servidor dice «no reclamable» → nunca se presenta como reclamable.
  assert.equal(nodeState({ level: 3, reward: {}, claimed: false, claimable: false }, 7, true), "LOCKED");
});

test("F52 T3 · el carril se abre en el nivel actual (no en el 1)", () => {
  assert.equal(trackColumns(pase(23))[focusColumnIndex(trackColumns(pase(23)))].level, 23);
  assert.equal(focusColumnIndex(trackColumns(pase(0))), 0);
});

test("F52 T4 · recompensas: solo partes que existen (sobre, créditos, carta, XP); nada de cosméticos ni materiales", () => {
  assert.deepEqual(rewardParts({ packId: "premium", packCount: 2, credits: 1500 }), [{ kind: "pack", packId: "premium", count: 2 }, { kind: "credits", amount: 1500 }]);
  assert.deepEqual(rewardParts({ cardId: "mada__moments" }), [{ kind: "card", cardId: "mada__moments" }]);
  assert.deepEqual(rewardParts({ cosmetics: ["avatar:x"], materials: { rare: 3 }, credits: 0 }), []);
  assert.deepEqual(rewardParts(null), []);
});

test("F52 T5 · render: sobre = arte real del sobre, créditos = moneda DRL, carta = CardArt; el nodo reclamable enlaza a Logros", () => {
  const pack = renderToStaticMarkup(<RewardVisual reward={{ packId: "premium", packCount: 1, credits: 1500 }} />);
  assert.match(pack, /data-pack-art="premium"/); assert.match(pack, /src="[^"]*premium[^"]*"/);
  const card = renderToStaticMarkup(<RewardVisual reward={{ cardId: "mada__moments" }} />);
  assert.match(card, /data-card-art/); assert.match(card, /mada__moments/);
  const h = renderToStaticMarkup(<SeasonRewardTrack pass={{ ...pase(7, { claimedFree: [1, 2, 3, 4, 5] }), seasonId: CURRENT_SEASON.id, xp: 7400, competitiveUnlockPending: false, competitiveMinPoints: 400, points: 214, claimable: { free: 2, competitive: 0 }, nextReward: { track: "free", level: 6, reward: CURRENT_SEASON.free[6] } } as never} />);
  assert.equal((h.match(/data-node="free-/g) ?? []).length, 30);
  assert.equal((h.match(/data-node="competitive-/g) ?? []).length, 6);
  assert.match(h, /data-current="true"/);
  assert.match(h, /href="\/logros"/, "el reclamo sigue en /logros");
  assert.ok(!/comprar|precio|€|premium pass/i.test(h), "sin pase de pago ni precios");
});

/* ═══════════ MISIONES ═══════════ */

const LISTA = [
  obj("d1", "daily", "duels_played", 0, 1), obj("d2", "daily", "duels_won", 1, 1), obj("d3", "daily", "packs_opened", 1, 1, { claimed: true }),
  obj("w1", "weekly", "duels_played", 3, 5, { expiresAt: 10_000 }), obj("wm", "weekly", "market_sell", 0, 1),
  obj("s1", "seasonal", "decks_saved", 0, 1), obj("p1", "progressive", "distinct_cards", 38, 50),
];

test("F52 M1 · misiones por su tipo real, en orden, y dentro: en curso → completada → reclamada", () => {
  const g = missionGroups(LISTA, { marketEnabled: false });
  assert.deepEqual(g.map((x) => x.kind), ["daily", "weekly", "seasonal", "progressive"]);
  assert.deepEqual(g[0].missions.map((m) => m.state), ["ACTIVE", "COMPLETE", "CLAIMED"]);
  const w = missionView(LISTA[3]);
  assert.equal(w.remaining, 2); assert.equal(w.ratio, 0.6);
});

test("F52 M2 · Marketplace CERRADO: ninguna misión de mercado; con el interruptor SOLO de test, siguen siendo elegibles", () => {
  assert.equal(GLOBAL_MARKET_ENABLED, false);
  const off = missionGroups(LISTA).flatMap((x) => x.missions.map((m) => m.metric));
  assert.ok(!off.includes("market_sell") && !off.includes("market_buy"));
  const on = missionGroups(LISTA, { marketEnabled: true }).flatMap((x) => x.missions.map((m) => m.id));
  assert.ok(on.includes("wm"), "la definición no se borra: con el Marketplace abierto vuelve");
  // CORE GAME LOOP · lo mismo con `picks_made` (Pick'em legacy retirado en 0072): no se enseña una diaria imposible.
  const pk = [...LISTA, obj("dp", "daily", "picks_made", 0, 1)];
  assert.ok(!missionGroups(pk).flatMap((x) => x.missions.map((m) => m.id)).includes("dp"));
  assert.ok(missionGroups(pk, { marketEnabled: false, legacyPickems: true }).flatMap((x) => x.missions.map((m) => m.id)).includes("dp"));
});

test("F52 M3 · render de misiones: progressbar semántico, recompensa real y completada → enlaza a Logros; renovación desde el servidor", () => {
  const h = renderToStaticMarkup(<SeasonMissions objectives={{ daily: { done: 0, total: 0 }, weekly: { done: 0, total: 0 }, seasonal: { done: 0, total: 0 }, progressive: { done: 0, total: 0 }, list: [], all: LISTA, claimable: 1, rotationPending: false, unassigned: false }} serverNow={5_000} />);
  assert.match(h, /role="progressbar"[^>]*aria-valuemax="5"[^>]*aria-valuenow="3"/);
  assert.match(h, /data-state="COMPLETE"/); assert.match(h, /data-state="CLAIMED"/);
  assert.match(h, /Reclamar en Logros/);
  assert.match(h, /Renueva en/, "expiresAt del servidor, contado desde serverNow");
  assert.ok(!/market_sell|data-mission="wm"/.test(h));
});

/* ═══════════ SIGUIENTE OBJETIVO ═══════════ */

test("F52 N1 · siguiente objetivo determinista: reclamar → misión más cercana → XP para el siguiente nivel (recompensa real)", () => {
  const p = pase(7, { into: 400 });
  const s = nextSteps({ pass: p, objectives: LISTA, claimableLevels: 2, claimableMissions: 1 }, { marketEnabled: false });
  assert.deepEqual(s.map((x) => x.kind), ["claim", "mission", "level"]);
  assert.equal((s[0] as { count: number }).count, 3);
  const m = s[1] as { id: string; remaining: number };
  assert.equal(m.id, "d1"); assert.equal(m.remaining, 1, "d1 y s1 empatan a 1: gana el id menor");
  const l = s[2] as { xpRemaining: number; nextLevel: number; reward: unknown };
  assert.equal(l.xpRemaining, 600); assert.equal(l.nextLevel, 8); assert.equal(l.reward, CURRENT_SEASON.free[8]);
  assert.deepEqual(nextSteps({ pass: pase(30), objectives: [], claimableLevels: 0, claimableMissions: 0 }), [], "nivel máximo y sin misiones: nada inventado");
  assert.deepEqual(nextSteps({ pass: p, objectives: LISTA, claimableLevels: 0, claimableMissions: 0 }), nextSteps({ pass: p, objectives: LISTA, claimableLevels: 0, claimableMissions: 0 }));
});

/* ═══════════ SERVIDOR: foto real, sin escrituras, gating, propiedad ═══════════ */

const U = "aaaaaaaa-0000-4000-8000-000000000052";
const OTHER = "bbbbbbbb-0000-4000-8000-000000000052";
const S1 = SEASON_CALENDAR[0];
const NOW = Date.parse(S1.startsAt) + 8 * 86_400_000;

function seed() {
  const db = new FakeSupabase();
  const state = freshPassState(CURRENT_SEASON.id);
  state.xp = 7_400; state.claimedFree = [1, 2, 3, 4, 5];
  state.missions = [
    { id: "w-duelos-5", kind: "weekly", metric: "duels_played", goal: 5, baseline: 0, claimed: false, assignedAt: NOW - 3600_000 },
    // Estado ANTIGUO con una misión de mercado asignada: con el Marketplace cerrado no debe ofrecerse.
    { id: "legacy-market", kind: "weekly", metric: "market_sell", goal: 1, baseline: 0, claimed: false, assignedAt: NOW - 3600_000 },
    { id: "s-mazo", kind: "seasonal", metric: "decks_saved", goal: 1, baseline: 0, claimed: true, assignedAt: NOW - 86_400_000 },
  ];
  db.tables = {
    profiles: [{ id: U, xp: 12_345, credits: 6_000, points: 214, packs_opened: 0, region: "EMEA", equipped: {} }, { id: OTHER, xp: 1, credits: 1, points: 0, equipped: {} }],
    user_pass: [{ user_id: U, season_id: CURRENT_SEASON.id, state }],
    user_cards: [], user_achievements: [], user_cosmetics: [], user_packs: [], duel_matches: [], duel_decks: [],
    pickem_answers: [], duel_pvp_ratings: [], duel_pvp_rating_events: [], pickem_scores: [],
    events: [], matches: [], stages: [], pickem_events: [], pickem_questions: [], pickem_submissions: [],
  };
  return db;
}

test("F52 S1 · la foto del servidor: pase real, `all` sin misiones de mercado, sin escrituras", async () => {
  const db = seed();
  const r = await getSeasonHub(db.client, U, { now: NOW });
  assert.ok(r.ok, r.error);
  const p = r.data!.personal!;
  assert.equal(p.pass!.level, 7); assert.equal(p.pass!.xpIntoLevel, 400);
  assert.equal(p.pass!.tracks.free.length, 30);
  const ids = p.objectives!.all.map((o) => o.id);
  assert.ok(ids.includes("w-duelos-5") && ids.includes("s-mazo"), "también las reclamadas");
  assert.ok(!ids.includes("legacy-market"), "mercado cerrado: no se ofrece");
  assert.ok(!p.objectives!.list.some((o) => o.metric === "market_sell"));
  assert.deepEqual(db.writes, [], `escrituras: ${db.writes.join(", ")}`);
});

test("F52 S2 · propiedad: otro usuario no recibe nada del pase ajeno; sin sesión, nada personal", async () => {
  const db = seed();
  const other = await getSeasonHub(db.client, OTHER, { now: NOW });
  assert.ok(other.ok);
  assert.notEqual(other.data!.personal!.pass?.level, 7);
  assert.ok(!other.data!.personal!.objectives?.all.some((o) => o.id === "w-duelos-5"));
  const anon = await getSeasonHub(db.client, null, { now: NOW });
  assert.equal(anon.data!.personal, null);
});

/* ═══════════ RECLAMOS: idempotentes y server-authoritative ═══════════ */

const A = "aaaaaaaa-0000-4000-8000-0000000005a2";
const B = "bbbbbbbb-0000-4000-8000-0000000005a2";
const ledger = (db: MemSupabase, u: string) => db.table("credit_transactions").filter((t) => t.user_id === u && t.reason === "pass_reward");
const passXp = (db: MemSupabase, u: string, xp: number) => { (db.table("user_pass").find((r) => r.user_id === u)!.state as { xp: number }).xp = xp; };

test("F52 C1 · reclamar un nivel una vez paga; repetir (reintento, doble clic) no paga más", async () => {
  const db = new MemSupabase(); db.seedUser(A);
  await getProgression(db.client, A); passXp(db, A, 2_000);
  assert.ok((await claimPassLevel(db.client, A, 1, "free")).ok);
  const again = await claimPassLevel(db.client, A, 1, "free");
  assert.equal(again.ok, false);
  assert.equal(ledger(db, A).length, 1);
});

test("F52 C2 · dos pestañas a la vez sobre el mismo nivel: como mucho una concesión", async () => {
  const db = new MemSupabase(); db.seedUser(A);
  await getProgression(db.client, A); passXp(db, A, 3_000);
  await Promise.all([claimPassLevel(db.client, A, 2, "free"), claimPassLevel(db.client, A, 2, "free"), claimPassLevel(db.client, A, 2, "free")]);
  assert.ok(ledger(db, A).length <= 1);
});

test("F52 C3 · recompensa inválida o no alcanzada: rechazada por el servidor (el cliente no decide)", async () => {
  const db = new MemSupabase(); db.seedUser(A);
  await getProgression(db.client, A); passXp(db, A, 1_000);
  for (const lvl of [0, -1, 31, 1.5]) assert.equal((await claimPassLevel(db.client, A, lvl, "free")).status, 400, String(lvl));
  assert.equal((await claimPassLevel(db.client, A, 9, "free")).ok, false, "nivel no alcanzado");
  passXp(db, A, 6_000);
  assert.equal((await claimPassLevel(db.client, A, 5, "competitive")).ok, false, "carril competitivo cerrado");
  assert.equal(ledger(db, A).length, 0);
});

test("F52 C4 · los reclamos son por usuario: lo de A no toca a B", async () => {
  const db = new MemSupabase(); db.seedUser(A); db.seedUser(B);
  await getProgression(db.client, A); await getProgression(db.client, B); passXp(db, A, 2_000);
  assert.ok((await claimPassLevel(db.client, A, 1, "free")).ok);
  assert.equal((await claimPassLevel(db.client, B, 1, "free")).ok, false, "B no ha alcanzado el nivel");
  assert.equal(ledger(db, B).length, 0);
});

/* ═══════════ CONTRATOS DE LA UI ═══════════ */

const UI = readdirSync(join(ROOT, "src/components/season")).filter((f) => /\.tsx$/.test(f) && !/test/.test(f)).map((f) => `src/components/season/${f}`);

test("F52 U1 · la UI no duplica economía: ni cantidades, ni umbrales, ni XP por nivel escritos a mano", () => {
  for (const f of ["src/components/season/SeasonRewards.tsx", "src/components/season/SeasonMissions.tsx", "src/domain/season/hubView.ts"]) {
    const c = code(f);
    assert.ok(!/\b(250|600|1500|2000|4000|8000|12000|1000)\b/.test(c.replace(/ms|Ms|duration|1140|780|1048|750/g, "")), `${f} escribe cifras de economía`);
    assert.ok(!/CURRENT_SEASON|data\/season"/.test(c), `${f} lee la temporada fuera de la foto del servidor`);
  }
});

test("F52 U2 · sin reclamos ni escrituras desde /temporada; sin pase de pago; sin reloj del dispositivo", () => {
  for (const f of UI) {
    const c = code(f);
    assert.ok(!/claimPassLevel|claimMission|method:\s*"POST"|api\/game\/progression/.test(c), `${f} reclama`);
    assert.ok(!/Date\.now\(\)/.test(c), `${f} usa el reloj del dispositivo`);
    assert.ok(!/COMPRAR PASE|precio|Stripe|premium:/i.test(c), `${f} vende un pase`);
  }
  assert.ok(code("src/components/season/SeasonHub.tsx").includes("<SeasonRewardTrack pass={p.pass} />"));
});

test("F52 U3 · accesibilidad y movimiento: progressbar, carril con teclado y región etiquetada; animaciones sólo motion-safe/transitions", () => {
  const r = code("src/components/season/SeasonRewards.tsx");
  assert.match(r, /onKeyDown=\{\(e\) => onKey\(e, i, lane\)\}/);
  assert.match(r, /role="region" aria-label=\{(?:t|tr|i18nT)\("Niveles del pase, desplazable"\)\}/);
  assert.ok(!/scrollIntoView/.test(r), "sin scrollIntoView (desplazaba la página)");
  assert.match(code("src/components/season/SeasonMissions.tsx"), /role="progressbar"/);
  for (const f of UI) assert.ok(!/animate-(spin|bounce|ping)|repeat: Infinity/.test(code(f)), f);
});

test("F52 G1 · invariantes: Marketplace cerrado, sin migración nueva, PAYMENTS sin tocar", () => {
  assert.equal(GLOBAL_MARKET_ENABLED, false);
  const mig = readdirSync(join(ROOT, "supabase", "migrations")).filter((f) => f.endsWith(".sql")).sort();
  // F58 añade 0055 (Admin Control Center); F59.1 añade 0056 (Miks/Veto en `agents`); F60 añade 0057 (CMS); PRE-F70 añade 0058 (privilegios de profiles). Autorizadas.
  // F73 añade 0059 (crafteo y misiones) y 0060 (desguace atómico, última copia): AUTORIZADAS y APLICADAS el 2026-09-30.
  assert.equal(mig[mig.length - 1], "0076_team_identities_admin.sql"); // IDENTIDAD DE EQUIPOS NUEVOS · 0076 (alta desde el panel de clave, nombre, etiqueta y región de equipos impresos que el código no conoce; aditiva) es la última; antes COLECCIONES POR EQUIPO · 0075 (primeras compleciones e insignias regionales; aditiva: sin ella el servidor solo deja de guardarlas) es la última; antes F87.2 · 0073 (launch guard de Pick'ems: elegibilidad y puerta de tiempo) es la última; antes F87.1 · 0072, F87 · 0071 (Pick'ems 2.0: cuadros de predicción, cierre por partido, liquidación y reclamos; aditiva) es la última; antes F86.2 · 0070 (feedback de la Closed Alpha + embudo derivado) es la última; antes F86 · 0069 (torneos de jugadores) es la última del repositorio (cabeza = 0069; 0068 tag público de cuenta; 0067 gestión de admins, F85 añadió 0066, F84 añadió 0065, F83 0064, ops/release). F82 añadió 0062 y F89 0063.
});
