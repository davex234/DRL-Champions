/**
 * FASE 39 · VERIFICADOR DE DRAFT GAUNTLET — `npm run draft-gauntlet:verify` (todo) o
 *   `draft-gauntlet-security:verify` · `draft-gauntlet-economy:verify` · `draft-gauntlet-content:verify` ·
 *   `draft-gauntlet-solvability:verify`.
 *
 * Sin base de datos real: catálogo del código, dominio puro, validador CANÓNICO (`draftDeckCheck` / rivales con el
 * mismo `fixedOpponentDeck` que la partida), motor de combate REAL con bots en los dos bandos para las observaciones
 * de balance, y el servicio contra `MemorySupabase`. RLS/Postgres reales: NO EJECUTADO AQUÍ — lo cubren los probes de
 * ensayo de 0053 en el VPS.
 */
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { CardRegistry } from "../src/collection/registry";
import { DUEL_COMPOSITION, DUEL_ROLES } from "../src/domain/cardgame/types";
import { createRng, nextInt, type RngState } from "../src/domain/cardgame/opponent/rng";
import { advanceBots, createController, createDuelBot } from "../src/domain/cardgame/opponent";
import { confirmTurn, startDuelMatch, type DuelMatch } from "../src/domain/cardgame/match";
import { CURRENT_COMBAT_RULES } from "../src/domain/cardgame/combat";
import { buildDraftPool, eligibleDataVersion, offerFor, poolIsSolvable, rivalDeckFor, roleOrderFor, simulateDraft, type DraftPool } from "../src/domain/draft/generate";
import { applyPick, createRunState, currentOffer, isDraftComplete, rivalsFor, toRunView } from "../src/domain/draft/run";
import { ACTIVE_STATUSES, RIVAL_NAMES, STAGE_DIFFICULTY } from "../src/domain/draft/rules";
import { DRAFT_ENTRY_FEE, draftExpectedValue } from "../src/domain/draft/economy";
import { buildDraftSnapshot } from "../src/domain/draft/snapshot";
import { draftDeckCheck, draftRivalCheck, draftRivalSnapshot } from "../src/server/services/duels";
import { MemorySupabase } from "../src/server/services/testing/memorySupabase";
import { installLedger } from "../src/server/services/testing/ledgerRpc";
import {
  abandonDraftRun, getDraftGauntlet, pickDraftCard, settleDraftMatch, startDraftRun, startDraftStage,
  type DraftCatalog, type DraftLauncher, type DraftOptions,
} from "../src/server/services/draftGauntlet";
import { BODY_KEYS, CARD_ID, MAX_BODY } from "../src/app/api/game/draft-gauntlet/route";
import { RATE_POLICY } from "../src/server/services/rateLimit";

const section = process.argv[2] ?? "all";
let ok = 0; let ko = 0;
const check = (label: string, cond: boolean, detail = "") => { if (cond) ok++; else ko++; console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`); };
const want = (s: string) => section === "all" || section === s;
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const pct = (a: number, b: number) => `${((100 * a) / Math.max(1, b)).toFixed(1)} %`;

const REG = new CardRegistry();
const INPUT = { cards: REG.cards, player: (id: string) => REG.player(id), droppable: () => true };
const DV = eligibleDataVersion(INPUT);
const POOL: DraftPool = buildDraftPool(INPUT, DV ?? "");
const CATALOG: DraftCatalog = { cards: REG.cards, card: (id) => REG.card(id), player: (id) => REG.player(id), droppable: () => true };

/** Elección aleatoria (sembrada) entre las opciones: simula a un jugador cualquiera. */
function randomChooser(seed: number) {
  let rng: RngState = createRng(seed ^ 0x5eed);
  return (offer: readonly string[]) => { const n = nextInt(rng, 0, offer.length - 1); rng = n.rng; return offer[n.value]; };
}

/* ───────────────────────────── MemorySupabase ───────────────────────────── */

const USER = "00000000-0000-4000-8000-00000000a001";
const OTHER = "00000000-0000-4000-8000-00000000a002";

function world() {
  const db = new MemorySupabase();
  db.unique.draft_runs = [{ cols: ["user_id"], where: (r) => (ACTIVE_STATUSES as readonly unknown[]).includes(r.status) }];
  db.unique.draft_run_matches = [{ cols: ["run_id", "stage"] }, { cols: ["match_id"], where: (r) => r.match_id != null }];
  db.defaults.draft_runs = () => ({ id: randomUUID() });
  db.defaults.draft_run_matches = () => ({});
  db.tables.duel_matches = [];
  // F72 · la entrada se cobra en el libro mayor (contrato de 0019/0026 en memoria).
  const ledger = installLedger(db, [{ userId: USER, credits: 100_000 }, { userId: OTHER, credits: 100_000 }]);
  const launch: DraftLauncher = async (_sb, userId, input) => {
    db.rows("duel_matches").push({ id: input.matchId, user_id: userId, mode: "DRAFT_GAUNTLET", status: "IN_PROGRESS", state: { status: "IN_PROGRESS", result: null } });
    return { ok: true, status: 200, data: { view: { matchId: input.matchId } as never } };
  };
  const opts: DraftOptions = { catalog: CATALOG, launch, deckCheck: (id, cards) => draftDeckCheck(id, cards) };
  return { db, sb: db.client, opts, ledger };
}

async function fullRun(w: ReturnType<typeof world>, outcomes: ("A" | "B" | null)[]) {
  let snap = (await startDraftRun(w.sb, USER, { actionId: randomUUID() }, w.opts)).data!;
  for (let i = 0; i < 10; i++) snap = (await pickDraftCard(w.sb, USER, { actionId: randomUUID(), expectedVersion: snap.run!.version, choiceId: snap.run!.offer[i % snap.run!.offer.length] }, w.opts)).data!;
  for (const winner of outcomes) {
    const run = w.db.rows("draft_runs").find((r) => r.user_id === USER && (ACTIVE_STATUSES as readonly unknown[]).includes(r.status));
    if (!run) break;
    const s = await startDraftStage(w.sb, USER, { actionId: randomUUID(), expectedVersion: run.version as number }, w.opts);
    const m = w.db.rows("duel_matches").find((x) => x.id === s.data!.matchId)!;
    m.status = winner === null ? "DRAW" : "COMPLETED";
    m.state = { status: m.status, result: { winner, isDraw: winner === null, scoreA: winner === "A" ? 6 : 4, scoreB: winner === "A" ? 4 : 6 } };
    await settleDraftMatch(w.sb, USER, s.data!.matchId, m.state as never, w.opts);
  }
  return w;
}

/* ───────────────────────────── motor real con dos bots ───────────────────────────── */

function simulateMatch(playerCards: string[], rivalCards: string[], level: (typeof STAGE_DIFFICULTY)[number], seed: number): "WIN" | "LOSS" | "DRAW" | "ERROR" {
  const runId = `aaaaaaaa-bbbb-4ccc-8ddd-${String(seed % 1e12).padStart(12, "0")}`;
  const mine = draftDeckCheck(runId, playerCards).snapshot;
  if (!mine) return "ERROR";
  const rival = draftRivalSnapshot(rivalCards, "Rival", `v-${seed}`);
  const started = startDuelMatch({ id: runId, snapshotA: mine, snapshotB: rival, firstAttacker: seed % 2 === 0 ? "A" : "B", rules: CURRENT_COMBAT_RULES });
  if (!started.ok) return "ERROR";
  const ctrl = createController({ side: "A", kind: "BOT", id: "p" }, { side: "B", kind: "BOT", id: "r" });
  const bots = { A: createDuelBot("p", "NORMAL"), B: createDuelBot("r", level) };
  let m: DuelMatch = started.match;
  let ra = createRng(seed * 7 + 1); let rb = createRng(seed * 13 + 5);
  for (let step = 0; step < 200 && m.status === "IN_PROGRESS"; step++) {
    const r = advanceBots(m, ctrl, bots, ra, rb);
    if (r.error) return "ERROR";
    ra = r.rngA; rb = r.rngB;
    m = r.match;
    if (m.phase === "READY_TO_CONFIRM") { const c = confirmTurn(m); if (!c.ok) return "ERROR"; m = c.match; }
  }
  if (!m.result) return "ERROR";
  return m.result.isDraw || m.result.winner === null ? "DRAW" : m.result.winner === "A" ? "WIN" : "LOSS";
}

async function main() {
  const t0 = performance.now();

  if (want("content")) {
    console.log("\n· CONTENIDO (catálogo real)");
    check("hay versión de datos elegible", !!DV, String(DV));
    check("pool resoluble: ≥ 2 jugadores por rol", poolIsSolvable(POOL));
    for (const r of DUEL_ROLES) {
      const cards = POOL.byRole[r];
      check(`rol ${r}: ${cards.length} cartas, ${new Set(cards.map((c) => c.playerId)).size} jugadores, ${new Set(cards.map((c) => c.teamKey)).size} equipos`, new Set(cards.map((c) => c.playerId)).size >= 6);
    }
    const all = [...POOL.byId.values()];
    check("toda carta del pool existe en el catálogo, con combate y jugador real (sin jugadores inventados)", all.every((c) => { const d = REG.card(c.cardId); const p = REG.player(c.playerId); return !!d && !!d.combat && !!p && p.role === c.role; }));
    check("una sola versión de datos en el pool", all.every((c) => (REG.card(c.cardId)!.dataVersion ?? "") === DV));
    check("stats de combate del catálogo tal cual (sin modificadores)", all.every((c) => { const d = REG.card(c.cardId)!; return ["stronghold", "gamesense", "entryfrag"].every((k) => typeof (d.combat as unknown as Record<string, number>)[k] === "number"); }));
    check("rivales con nombres originales NEXUS (5)", RIVAL_NAMES.length === 5 && RIVAL_NAMES.every((n) => /^NEXUS /.test(n)));
    check("dificultades canónicas por etapa", STAGE_DIFFICULTY.join(",") === "EASY,NORMAL,NORMAL,HARD,HARD");
    let offersReal = true;
    for (let seed = 0; seed < 500; seed++) for (const o of simulateDraft(POOL, seed).offers) for (const id of o) if (!REG.card(id)) offersReal = false;
    check("500 drafts: toda opción ofrecida es una carta real del catálogo", offersReal);
    const players = new Set<string>(); const cards = new Set<string>();
    for (let seed = 0; seed < 2000; seed++) for (const o of simulateDraft(POOL, seed, randomChooser(seed)).offers) for (const id of o) { cards.add(id); players.add(POOL.byId.get(id)!.playerId); }
    check("diversidad: 2.000 drafts cubren gran parte del catálogo elegible", cards.size > POOL.byId.size * 0.6, `${cards.size}/${POOL.byId.size} cartas · ${players.size} jugadores`);
  }

  if (want("solvability")) {
    console.log("\n· RESOLUBILIDAD Y DETERMINISMO (10.000 runs · 10.000 rivales)");
    const deckOvr: number[] = []; const deckTeams: number[] = [];
    const rarity = new Map<string, number>(); const regions = new Map<string, number>(); const pickedPlayers = new Map<string, number>();
    const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
    let dead = 0; let illegal = 0; let offersShort = 0; const orders = new Set<string>(); const firstOffers = new Set<string>();
    const tDraft = performance.now();
    for (let seed = 0; seed < 10_000; seed++) {
      const sim = simulateDraft(POOL, seed * 2654435761 >>> 0, randomChooser(seed));
      if (sim.deadEnd) { dead++; continue; }
      if (sim.offers.some((o) => o.length < 3)) offersShort++;
      orders.add(sim.roleOrder.join(","));
      firstOffers.add(sim.offers[0].join(","));
      if (!draftDeckCheck("cccccccc-dddd-4eee-8fff-000000000000", sim.picks).valid) illegal++;
      const ovr = sim.picks.reduce((acc, id) => acc + POOL.byId.get(id)!.ovr, 0) / sim.picks.length;
      deckOvr.push(ovr);
      deckTeams.push(new Set(sim.picks.map((id) => POOL.byId.get(id)!.teamKey)).size);
      for (const id of sim.picks) {
        const d = REG.card(id)!; const pl = REG.player(d.playerId)!;
        bump(rarity, d.variantId); bump(regions, pl.region); bump(pickedPlayers, d.playerId);
      }
    }
    check("10.000 runs con elecciones aleatorias: CERO callejones sin salida", dead === 0, `${dead}`);
    check("10.000 plantillas: todas legales para el validador canónico", illegal === 0, `${illegal} ilegales · ${(performance.now() - tDraft).toFixed(0)} ms`);
    check("todas las ofertas con 3 opciones", offersShort === 0, `${offersShort} runs con alguna oferta corta`);
    {
      const sorted = [...deckOvr].sort((x, y) => x - y); const total = 100_000;
      const mean = deckOvr.reduce((x, y) => x + y, 0) / deckOvr.length;
      const share = (m: Map<string, number>) => [...m.entries()].sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${pct(v, total)}`).join(" · ");
      const top = [...pickedPlayers.entries()].sort((x, y) => y[1] - x[1]);
      console.log("\n· OBSERVACIÓN DE BALANCE DE PLANTILLAS (10.000 drafts, elecciones aleatorias; SIN AJUSTES)");
      console.log(`    OVR medio de la plantilla: media ${mean.toFixed(1)} · mín ${sorted[0].toFixed(1)} · p50 ${sorted[Math.floor(sorted.length / 2)].toFixed(1)} · máx ${sorted[sorted.length - 1].toFixed(1)}`);
      console.log(`    rareza (variante) de las cartas elegidas: ${share(rarity)}`);
      console.log(`    regiones: ${share(regions)}`);
      console.log(`    equipos distintos por plantilla: media ${(deckTeams.reduce((x, y) => x + y, 0) / deckTeams.length).toFixed(1)} · mín ${Math.min(...deckTeams)}`);
      console.log(`    jugadores elegidos alguna vez: ${pickedPlayers.size} · el más frecuente ${top[0][0]} ${pct(top[0][1], 10_000)} de las runs`);
      for (let stage = 1; stage <= 5; stage++) {
        let acc = 0; for (let seed = 0; seed < 2000; seed++) acc += rivalDeckFor(POOL, seed, stage).reduce((x, id) => x + POOL.byId.get(id)!.ovr, 0) / 10;
        console.log(`    rival etapa ${stage}: OVR medio ${(acc / 2000).toFixed(1)}`);
      }
      check("observación: ningún jugador aparece en más del 25 % de las runs (sin degeneración obvia)", top[0][1] / 10_000 <= 0.25, `${top[0][0]} ${pct(top[0][1], 10_000)}`);
    }
    check("diversidad de órdenes de rol", orders.size > 8000, `${orders.size} órdenes distintos de 113.400 posibles`);
    check("diversidad de primeras ofertas", firstOffers.size > 9000, `${firstOffers.size} distintas`);

    let rivalIllegal = 0; let rivalShape = 0;
    for (let seed = 0; seed < 2000; seed++) for (let stage = 1; stage <= 5; stage++) {
      const deck = rivalDeckFor(POOL, seed, stage);
      if (!draftRivalCheck(deck, `s-${seed}-${stage}`).valid) rivalIllegal++;
      if (deck.length !== 10 || DUEL_ROLES.some((r) => deck.filter((id) => POOL.byId.get(id)!.role === r).length !== DUEL_COMPOSITION[r])) rivalShape++;
    }
    check("10.000 mazos rivales (2.000 semillas × 5 etapas): todos legales", rivalIllegal === 0, `${rivalIllegal}`);
    check("10.000 mazos rivales: 10 cartas, 2 por rol", rivalShape === 0);

    let nondet = 0;
    for (let seed = 0; seed < 1000; seed++) {
      const a = simulateDraft(POOL, seed, randomChooser(seed)); const b = simulateDraft(POOL, seed, randomChooser(seed));
      if (JSON.stringify(a) !== JSON.stringify(b) || JSON.stringify(rivalsFor(POOL, seed)) !== JSON.stringify(rivalsFor(POOL, seed))) nondet++;
    }
    check("determinismo: misma semilla y mismas elecciones → misma run y mismos rivales (1.000)", nondet === 0);
    check("orden de roles estable entre llamadas", JSON.stringify(roleOrderFor(7)) === JSON.stringify(roleOrderFor(7)));
    check("oferta estable entre llamadas", JSON.stringify(offerFor(POOL, 9, 4, "Flex", [])) === JSON.stringify(offerFor(POOL, 9, 4, "Flex", [])));

    // Reanudar desde el estado persistido (JSON) produce la misma continuación.
    let resumeBad = 0;
    for (let seed = 0; seed < 300; seed++) {
      let s = createRunState(POOL, seed);
      for (let i = 0; i < 4; i++) { const r = applyPick(s, POOL, seed, currentOffer(s)[i % 3]); if (r.ok) s = r.state; }
      const persisted = JSON.parse(JSON.stringify(s));
      const a = applyPick(s, POOL, seed, currentOffer(s)[0]); const b = applyPick(persisted, POOL, seed, currentOffer(persisted)[0]);
      if (JSON.stringify(a) !== JSON.stringify(b)) resumeBad++;
    }
    check("reanudar desde el jsonb persistido = continuar en memoria (300)", resumeBad === 0);

    console.log("\n· OBSERVACIONES DE BALANCE (motor real, jugador = bot NORMAL con elecciones aleatorias; SIN AJUSTES)");
    const tally = STAGE_DIFFICULTY.map(() => ({ WIN: 0, LOSS: 0, DRAW: 0, ERROR: 0 }));
    const RUNS = 300;
    for (let seed = 0; seed < RUNS; seed++) {
      const picks = simulateDraft(POOL, seed, randomChooser(seed)).picks;
      for (let stage = 1; stage <= 5; stage++) tally[stage - 1][simulateMatch(picks, rivalDeckFor(POOL, seed, stage), STAGE_DIFFICULTY[stage - 1], seed * 10 + stage)]++;
    }
    tally.forEach((t, i) => console.log(`    etapa ${i + 1} (${STAGE_DIFFICULTY[i]}): victoria ${pct(t.WIN, RUNS)} · derrota ${pct(t.LOSS, RUNS)} · empate ${pct(t.DRAW, RUNS)}`));
    check("300 × 5 combates con el motor real sin errores", tally.every((t) => t.ERROR === 0));
    check("observación: los combates no están decididos de antemano (hay victorias y derrotas en cada etapa)", tally.every((t) => t.WIN > 0 && t.LOSS > 0));
  }

  if (want("security")) {
    console.log("\n· SEGURIDAD");
    const forbidden = ["seed", "stage", "won", "result", "cards", "cardIds", "deck", "deckId", "userId", "difficulty", "reward", "picks"];
    check("cuerpo cerrado: ninguna acción acepta campos de autoridad", Object.values(BODY_KEYS).every((k) => forbidden.every((f) => !k.includes(f))));
    check("cuerpo ≤ 1 KB", MAX_BODY <= 1000);
    check("choiceId con forma de id de carta", CARD_ID.test("benjy__silver") && !CARD_ID.test("x' or 1=1"));
    check("cubetas de rate limit propias", !!RATE_POLICY.draft_read && !!RATE_POLICY.draft_write);
    const route = read("src/app/api/game/draft-gauntlet/route.ts");
    check("ruta: usuario del token, confirmación de abandono, 5xx genérico", route.includes("session.userId") && route.includes("b.confirm !== true") && route.includes("const GENERIC"));
    const mig = read("supabase/migrations/0053_draft_gauntlet.sql").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    check("0053: RLS en las dos tablas, sin políticas, revocado a anon/authenticated", ["draft_runs", "draft_run_matches"].every((t) => mig.includes(`alter table public.${t} enable row level security;`) && mig.includes(`revoke all on public.${t} from anon, authenticated;`)) && !/create policy/i.test(mig));
    check("0053: sin SECURITY DEFINER ni funciones", !/security definer|create (or replace )?function/i.test(mig));
    check("0053: una run activa por usuario (índice único parcial)", mig.includes("draft_runs_one_active"));

    const w = world();
    const s0 = (await startDraftRun(w.sb, USER, { actionId: randomUUID() }, w.opts)).data!;
    const json = JSON.stringify(s0);
    const seed = String(w.db.rows("draft_runs")[0].seed);
    check("la foto no expone la semilla", !json.includes(`"seed"`) && !json.includes(seed));
    const outside = REG.forRole(s0.run!.currentRole!).find((c) => c.combat && !s0.run!.offer.includes(c.id))!.id;
    const bad = await pickDraftCard(w.sb, USER, { actionId: randomUUID(), expectedVersion: 1, choiceId: outside }, w.opts);
    check("carta fuera de la oferta → 409 INVALID_PICK", bad.code === "INVALID_PICK");
    const alien = await pickDraftCard(w.sb, OTHER, { actionId: randomUUID(), expectedVersion: 1, choiceId: s0.run!.offer[0] }, w.opts);
    check("otro usuario no toca la run", alien.code === "NO_RUN" && w.db.rows("draft_runs")[0].version === 1);
    const [a, b] = await Promise.all([
      pickDraftCard(w.sb, USER, { actionId: randomUUID(), expectedVersion: 1, choiceId: s0.run!.offer[0] }, w.opts),
      pickDraftCard(w.sb, USER, { actionId: randomUUID(), expectedVersion: 1, choiceId: s0.run!.offer[1] }, w.opts),
    ]);
    check("doble confirmación: una entra, la otra 409 STALE", [a, b].filter((x) => x.ok).length === 1 && [a, b].some((x) => x.code === "STALE_VERSION"));
    const full = await fullRun(world(), []);
    const state = full.db.rows("draft_runs")[0].state as { picks: string[]; rivals: { cardIds: string[] }[] };
    const view = JSON.stringify((await getDraftGauntlet(full.sb, USER, full.opts)).data);
    check("la foto no expone los mazos rivales", state.rivals.flatMap((r) => r.cardIds).filter((id) => !state.picks.includes(id)).every((id) => !view.includes(`"${id}"`)));
    const client = read("src/lib/draft/client.ts");
    check("el cliente no envía semilla, etapa, resultado ni cartas", !/seed|stage:|won|result:|cardIds/.test(code(client).replace(/snapshot\.run\.stage/g, "")));
    check("sin RNG ni reloj en la generación", ["src/domain/draft/generate.ts", "src/domain/draft/run.ts"].every((f) => !/Math\.random|Date\.now/.test(code(read(f)))));
  }

  if (want("economy")) {
    console.log("\n· ECONOMÍA AISLADA (F72: entrada + recompensa por victorias, solo por el libro mayor)");
    check("valor esperado de la tabla < 0 incluso con la cota ORACLE", draftExpectedValue([0, 0.0054, 0.0052, 0.0924, 0.0762, 0.8208]).ev < 0);
    const w = await fullRun(world(), ["A", "A", "A", "A", "A"]);
    const tables = new Set(w.db.writes().filter((l) => !l.startsWith("rpc:")).map((l) => l.split(":")[1]));
    const allowed = ["draft_runs", "draft_run_matches", "credit_transactions", "profiles", "user_packs", "user_cosmetics"];
    check("run completa (5 victorias): solo draft_* y el libro mayor (saldo, sobre, título)", [...tables].every((t) => allowed.includes(t)), [...tables].join(","));
    check("run completa: RPC = entrada + premio + sobre semanal", JSON.stringify(w.db.rpcCalls.map((c) => c.name)) === JSON.stringify(["app_adjust_credits", "app_grant_reward", "app_grant_reward"]));
    check("run completa: COMPLETED y saldo = inicial − entrada + 2.100", w.db.rows("draft_runs")[0].status === "COMPLETED" && w.ledger.credits(USER) === 100_000 - DRAFT_ENTRY_FEE + 2_100);
    const l = await fullRun(world(), ["A", "B"]);
    check("derrota en la 2: FAILED, entrada + 1 V (200), cero user_cards", l.db.rows("draft_runs")[0].status === "FAILED" && l.ledger.credits(USER) === 100_000 - DRAFT_ENTRY_FEE + 200 && !l.db.log.some((x) => x.includes("user_cards")));
    const ab = world();
    const s = (await startDraftRun(ab.sb, USER, { actionId: randomUUID() }, ab.opts)).data!;
    await abandonDraftRun(ab.sb, USER, { actionId: randomUUID(), expectedVersion: s.run!.version }, ab.opts);
    check("abandono en el draft: ABANDONED, sin premio y sin devolver la entrada", ab.db.rows("draft_runs")[0].status === "ABANDONED" && JSON.stringify(ab.db.rpcCalls.map((c) => c.name)) === JSON.stringify(["app_adjust_credits"]) && ab.ledger.credits(USER) === 100_000 - DRAFT_ENTRY_FEE);

    const duels = read("src/server/services/duels.ts");
    const play = duels.slice(duels.indexOf("export async function playTurn"), duels.indexOf("async function awardMatchOutcome"));
    check("duels.playTurn: el draft no llama a awardMatchOutcome", /if \(!draftMatch\) \{\s+await awardMatchOutcome/.test(play));
    check("duels.playTurn: el draft liquida su run, nunca la campaña", /if \(draftMatch\) await settleDraftFor/.test(play));
    check("duels: la vista del draft no lleva recompensa", !duels.slice(duels.indexOf("export function toDraftView"), duels.indexOf("interface MatchRow")).includes("duelAward"));
    check("partida rápida no retoma ni abandona el draft", duels.includes('.neq("mode", DRAFT_GAUNTLET_MODE)\n    .order("updated_at"') && /delete\(\)\.eq\("id", matchId\)\.eq\("user_id", userId\)\.neq\("mode", DRAFT_GAUNTLET_MODE\)/.test(duels));
    // Fase 42 · progression cuenta también las partidas DESDE el inicio de cada ventana (baseline pura): 2 + 2 exclusiones.
    for (const [f, n] of [["progression", 4], ["loop", 2], ["events", 2]] as const) check(`contadores de ${f}: excluyen DRAFT_GAUNTLET`, (read(`src/server/services/${f}.ts`).match(/\.neq\("mode", "DRAFT_GAUNTLET"\)/g) ?? []).length === n);
    check("rating solo PVP", read("src/server/services/duelsRating.ts").includes('row.mode !== "PVP"'));
    check("campaña solo PVE", read("src/server/services/campaign.ts").includes('.eq("mode", "PVE")'));
    const service = code(read("src/server/services/draftGauntlet.ts"));
    check("servicio del draft: sin user_cards, créditos, sobres, XP, rating ni campaña", !/user_cards|credit_|award\(|app_grant|packs_opened|user_game|pvp_ratings|campaign_|battle_pass|serial/.test(service));
    check("sobres, odds y objetivo de sobres sin tocar por el draft", ["src/server/services/packs.ts", "src/data/packs.ts", "src/domain/packs/objective.ts"].every((f) => { try { return !/DRAFT_GAUNTLET|draftGauntlet|draft_run|domain\/draft/.test(read(f)); } catch { return true; } }));
    check("mercado cerrado", /GLOBAL_MARKET_ENABLED\s*=\s*false/.test(read("src/config/features.ts")));
    const migrations = readdirSync(join(process.cwd(), "supabase", "migrations"));
    check("0053 es la única migración nueva y es del draft", migrations.filter((f) => f.startsWith("0053")).length === 1 && !migrations.some((f) => /^005[4-9]/.test(f)));
    { const ui = code([read("src/components/draft/DraftGauntletScreen.tsx"), read("src/components/draft/DraftCards.tsx"), read("src/components/draft/DraftEntry.tsx")].join("\n")); check("F72 · UI: entrada y premios SOLO de snapshot.economy (ningún importe fijo, sin tickets ni estamina)", ui.includes("snapshot.economy") && !/\b(2[.]?000|2[.]?100|1[.]?600)\b|🪙|ticket|stamina/i.test(ui)); }
    const snap = buildDraftSnapshot({ run: toRunView({ id: "r", status: "READY", stage: 1, version: 1, rules_version: "draft-gauntlet-1", data_version: DV ?? "", state: (() => { let st = createRunState(POOL, 1); while (!isDraftComplete(st)) { const r = applyPick(st, POOL, 1, currentOffer(st)[0]); if (!r.ok) break; st = r.state; } return st; })(), current_match_id: null, created_at: "", completed_at: null }, []), history: [], resolver: REG, serverNow: 0 });
    check("la foto no tiene uid, serial ni propiedad", Object.values(snap.cards).every((c) => !("uid" in c) && !("serial" in c)));
  }

  console.log(`\n${ko === 0 ? "✓" : "✗"} draft-gauntlet:verify (${section}) — ${ok} OK · ${ko} FALLOS · ${(performance.now() - t0).toFixed(0)} ms`);
  process.exit(ko === 0 ? 0 : 1);
}

void main();
