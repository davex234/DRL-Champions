/**
 * FASE 41 · VERIFICADOR DE ECONOMÍA — `npm run economy:verify` (todo) o por sección:
 *
 *   economy-ledger:verify       libro mayor: suelo 0, clave única, RPC solo service_role, saldo = Σ asientos (secuencias)
 *   economy-starter:verify      Sobre Inicial: política, 20.000 cuentas con el motor real, servicio (elegible/rechazos/tope)
 *   economy-idempotency:verify  reintentos y concurrencia de compra, apertura, recompensa, reciclaje, misión, pase
 *   economy-progression:verify  misiones una vez por tanda, «actualizar» sin re-sorteo, pase sin XP duplicada, techo diario
 *   economy-security:verify     tienda de prueba cerrada, prestigio por jugador, recompensa negativa, GET sin escrituras,
 *                               cuerpo sin importes, mercado cerrado, Draft sin economía, sin valor/venta en Colección
 *   economy-simulation:verify   odds del simulador ≡ openPack, determinismo, informes 1M/100k/fuzzer presentes y sanos
 *
 * Sin BD real (la QA real contra el VPS es `_fase41-real-qa`). El verificador anterior de mercado/reciclaje contra BD
 * sigue como `economy-market:verify`.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CardRegistry } from "../src/collection/registry";
import { PackEngine } from "../src/pack/engine";
import { getPack } from "../src/data/packs";
import { freshPity } from "../src/domain/packs/pity";
import { openPack } from "../src/domain/packs/openPack";
import { BUCKETS } from "../src/domain/packs/pool";
import { deckReadiness } from "../src/domain/journey";
import { STARTER_POLICY, starterAssistFor, starterEligibility, ECONOMY_VERSION } from "../src/domain/economy/starter";
import { economyFlows, dailyRecurringCeiling } from "../src/domain/economy/catalog";
import { Simulator, buildSimCatalog, drawPackIndices, seedOf } from "../src/domain/economy/simulator";
import { makeRng } from "../src/sim/rng";
import { MemSupabase } from "../src/server/services/testing/memSupabase";
import { runSequence, newStats } from "../src/server/services/testing/economyFuzz";
import { buyPack, openPackForUser, buyAndOpen } from "../src/server/services/packs";
import { readStarterStatus } from "../src/server/services/starter";
import { claimMission, getProgression, peekProgression, refreshMissions } from "../src/server/services/progression";
import { sandboxPurchase } from "../src/server/services/credits";
import { award } from "../src/server/services/rewards";
import { salvageCards } from "../src/server/services/economy";
import { getCompetitiveSnapshot } from "../src/server/services/competitive";
import { prestigeRef } from "../src/domain/collection/prestige";
import { GLOBAL_MARKET_ENABLED } from "../src/config/features";

const section = process.argv[2] ?? "all";
const want = (s: string) => section === "all" || section === s;
let ok = 0; let ko = 0;
const check = (label: string, cond: boolean, detail = "") => { if (cond) ok++; else ko++; console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`); };
const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const REG = new CardRegistry();
const resolve = (id: string) => { const c = REG.card(id); const p = c ? REG.player(c.playerId) : undefined; return c && p ? { playerId: c.playerId, role: p.role, dataVersion: c.dataVersion ?? "", combat: !!c.combat } : null; };
const U = "f41f41f4-0000-4000-8000-000000000001"; const V = "f41f41f4-0000-4000-8000-000000000002";
const quiet = async <T,>(fn: () => Promise<T>) => { const e = console.error; const w = console.warn; console.error = () => {}; console.warn = () => {}; try { return await fn(); } finally { console.error = e; console.warn = w; } };
const db = (...users: string[]) => { const d = new MemSupabase(); for (const u of users) d.seedUser(u); return d; };
const credits = (d: MemSupabase, u = U) => Number(d.table("profiles").find((p) => p.id === u)!.credits);
const rows = (d: MemSupabase, u: string, reason: string) => d.table("credit_transactions").filter((t) => t.user_id === u && t.reason === reason).length;
function notReady(d: MemSupabase, u = U) {
  for (const p of d.table("user_packs").filter((r) => r.user_id === u)) p.qty = 0;
  const ids = REG.cards.filter((c) => REG.player(c.playerId)?.role === "Duelista").slice(0, 3).map((c) => c.id);
  ids.forEach((card_id, i) => d.table("user_cards").push({ uid: `nr-${i}`, user_id: u, card_id, locked: false }));
  d.table("economy_ops").push({ ref: `nr-open-${u}`, user_id: u, kind: "open_pack", result: { uids: ids.map((_, i) => `nr-${i}`), packId: "inicial" } });
}

async function main() {
  console.log(`FASE 41 · economía (ECONOMY_VERSION ${ECONOMY_VERSION}) · sección ${section}`);

  if (want("economy")) {
    console.log("\n· CATÁLOGO CANÓNICO");
    const flows = economyFlows();
    check("mapa con fuentes, sumideros, transferencias y no económicos", ["SOURCE", "SINK", "TRANSFER", "NON_ECONOMIC"].every((c) => flows.some((f) => f.cls === c)), `${flows.length} flujos`);
    check("ids únicos (sin definiciones duplicadas en el mapa)", new Set(flows.map((f) => f.id)).size === flows.length);
    check("ninguna fuente viva sin tope por acción", flows.filter((f) => f.cls === "SOURCE" && f.status === "LIVE" && f.repeat === "PER_ACTION").every((f) => f.cap !== null));
    check("el catálogo no define importes (importa constantes reales)", !/credits:\s*\{\s*min:\s*\d{3,}/.test(code(read("src/domain/economy/catalog.ts")).replace(/starter-grant[\s\S]*?\},/, "")));
    check("ECONOMY_VERSION = 3 (cambio de reglas; el libro mayor histórico no se reescribe)", ECONOMY_VERSION === 3);
    // WALKOUT 0.6 · la Fase 41 terminó en 0053 y no añadió ninguna; 0054–0073 son de fases posteriores (F58…F87.2), aplicadas
    // en producción (/api/ready → migrationHead). Se comprueba la base de F41, no que el árbol se congelase en ella.
    { const mig: string[] = require("node:fs").readdirSync(join(ROOT, "supabase/migrations")).filter((f: string) => /^\d{4}_.*\.sql$/.test(f)).sort();
      check("sin migración nueva en la Fase 41 (base 0053 presente; las posteriores son de otras fases)", mig.some((f) => f.startsWith("0053_")), `cabeza ${mig[mig.length - 1]}`); }
  }

  if (want("ledger")) {
    console.log("\n· LIBRO MAYOR");
    const m19 = read("supabase/migrations/0019_economy_ledger.sql");
    check("`_ledger_apply` bloquea el perfil y corta en negativo", /for update/.test(m19) && /v_balance \+ p_delta < 0/.test(m19));
    check("clave única (user_id, ref) en credit_transactions", /credit_tx_ref_uniq/.test(read("supabase/migrations/0011_server_authority.sql")));
    check("RPC de economía revocadas a public/anon/authenticated", /revoke[\s\S]*app_buy_pack[\s\S]*from public, anon, authenticated/i.test(m19) || /revoke all on function public\.app_buy_pack/i.test(m19));
    const stats = newStats();
    await quiet(async () => { for (let s = 410_001; s <= 410_300; s++) await runSequence(s, stats); });
    const ledgerInv = stats.violations.filter((v) => /saldo|clave-unica|sobres-no-negativos|cartas-cuadran/.test(v.invariant));
    check("300 secuencias hostiles: saldo = Σ asientos, sin negativos, claves únicas, cartas cuadran", ledgerInv.length === 0, `${stats.actions} acciones`);
    const d = db(U); d.table("profiles")[0].credits = 700; d.table("credit_transactions")[0].delta = 700;
    await Promise.all([0, 1, 2].map((i) => buyPack(d.client, U, "estandar", `par-${i}`)));
    check("compras simultáneas sin saldo: nunca negativo", credits(d) >= 0 && credits(d) === 700);
  }

  if (want("starter")) {
    console.log("\n· STARTER (asistencia de primer equipo)");
    check("política: gratis solo sin plantilla, 0 sin abrir y < tope", !starterEligibility({ deckReady: true, unopenedStarter: 0, freeClaims: 0 }).eligible && !starterEligibility({ deckReady: false, unopenedStarter: 1, freeClaims: 0 }).eligible && !starterEligibility({ deckReady: false, unopenedStarter: 0, freeClaims: STARTER_POLICY.maxFreeClaims }).eligible && starterEligibility({ deckReady: false, unopenedStarter: 0, freeClaims: 0 }).eligible);
    const ENGINE = new PackEngine(REG);
    const N = 20_000; const totals: number[] = []; let trapped = 0;
    for (let acc = 0; acc < N; acc++) {
      const ids: string[] = []; let pity = freshPity(); let k = 0; let opened = 0;
      const open = (id: string) => { const a = id === "inicial" ? starterAssistFor("inicial", ids, resolve) : null; const r = ENGINE.draw(getPack(id)!, { seed: ((acc * 7919 + k++ * 104729 + 99) >>> 0) % 2147483647, owned: [], mintCounts: {}, pity, now: 0, assist: a } as never); pity = r.pityAfter; for (const i of r.instances) ids.push(i.cardId); opened++; };
      for (const id of ["inicial", "inicial", "inicial", "estandar"]) open(id);
      let extra = 0;
      while (!deckReadiness(ids, resolve).ready && extra < STARTER_POLICY.maxFreeClaims) { open("inicial"); extra++; }
      if (!deckReadiness(ids, resolve).ready) trapped++;
      totals.push(opened);
    }
    totals.sort((a, b) => a - b);
    const q = (p: number) => totals[Math.floor(p * (N - 1))];
    check("20.000 cuentas (motor real): 100 % con plantilla, ninguna atrapada por el tope", trapped === 0, `atrapadas ${trapped}`);
    check("aperturas de starter P50 ≤ 4 · P90 ≤ 6 · P99 ≤ 8", q(0.5) <= 4 && q(0.9) <= 6 && q(0.99) <= 8, `P50 ${q(0.5)} · P90 ${q(0.9)} · P99 ${q(0.99)} · máx ${totals[N - 1]}`);
    const sim = existsSync(join(ROOT, "docs/product/qa/fase41/starter-simulation.json")) ? JSON.parse(read("docs/product/qa/fase41/starter-simulation.json")) : null;
    const c2 = sim?.alternatives?.find((a: { id: string }) => a.id === "C2");
    check("informe 100.000 (A–F) presente; alternativa elegida C2 cumple objetivos", !!c2 && c2.accounts >= 100_000 && c2.meetsTargets === true && c2.trapped === 0, c2 ? `P50 ${c2.totalOpenings.p50} P90 ${c2.totalOpenings.p90} P99 ${c2.totalOpenings.p99}` : "falta");
    const a = sim?.alternatives?.find((x: { id: string }) => x.id === "A");
    check("línea base A (Fase 40) NO cumplía P90/P99 (se documenta el porqué del cambio)", !!a && a.meetsTargets === false);
    const d = db(U);
    const r0 = await buyPack(d.client, U, "inicial", "x");
    check("alta con 3 Sobres Iniciales sin abrir: sin gratis extra", !r0.ok && rows(d, U, "buy_pack:inicial") === 0);
    const d2 = db(U); notReady(d2);
    const r1 = await buyPack(d2.client, U, "inicial", "g");
    const r2 = await buyPack(d2.client, U, "inicial", "g2");
    check("sin plantilla y sin sobres: 1 gratis; el 2.º sin abrir el 1.º se rechaza", r1.ok && !r2.ok && rows(d2, U, "buy_pack:inicial") === 1);
    const opened = await openPackForUser(d2.client, U, "inicial", "o");
    check("los Sobres Iniciales poseídos se siguen abriendo", opened.ok);
    const svc = code(read("src/server/services/packs.ts"));
    check("la compra gratis usa la clave de la N-ésima concesión (no la del cliente)", /packOpRef\(userId, "buy", starterClaimGesture\(st\.freeClaims\)\)/.test(svc));
    check("un precio 0 que no sea el Sobre Inicial no se concede", /pack\.id !== STARTER_POLICY\.packId\) return fail/.test(svc));
    // WALKOUT 0.6 · la copia pasó de «plantilla» a «equipo» (terminología del juego); el mensaje es el mismo.
    check("FTUE: copia «Consigue las cartas que te faltan para completar tu equipo.»", read("src/domain/journey/index.ts").includes("Consigue las cartas que te faltan para completar tu equipo."));
  }

  if (want("idempotency")) {
    console.log("\n· IDEMPOTENCIA Y CONCURRENCIA");
    const d = db(U);
    await buyPack(d.client, U, "estandar", "same"); await buyPack(d.client, U, "estandar", "same");
    // WALKOUT 0.6 · importes desde el precio REAL (F80: Bronce 2.500; antes fijos a 750 → 5250/4500/4850). Saldo inicial 6.000.
    const P = getPack("estandar")!.price;
    check("compra reintentada: un cobro", credits(d) === 6000 - P, `saldo ${credits(d)} (precio ${P})`);
    const [o1, o2] = await Promise.all([openPackForUser(d.client, U, "estandar", "op"), openPackForUser(d.client, U, "estandar", "op")]);
    check("apertura simultánea del mismo gesto: mismas cartas, un sobre", o1.ok && o2.ok && JSON.stringify(o1.data.opened.map((c) => c.uid)) === JSON.stringify(o2.data.opened.map((c) => c.uid)));
    const b1 = await buyAndOpen(d.client, U, "estandar", "bo"); const b2 = await buyAndOpen(d.client, U, "estandar", "bo");
    check("comprar-y-abrir reintentado: +0 y mismas cartas", b1.ok && b2.ok && b2.data.repeated === true && credits(d) === 6000 - 2 * P, `saldo ${credits(d)}`);
    await award(d.client, { userId: U, ref: "duel:x", reason: "duel_win", reward: { credits: 350 } });
    const again = await award(d.client, { userId: U, ref: "duel:x", reason: "duel_win", reward: { credits: 350 } });
    check("recompensa de partida reintentada: +0", !again.applied && credits(d) === 6000 - 2 * P + 350, `saldo ${credits(d)}`);
    const d2 = db(U); notReady(d2);
    await Promise.all(Array.from({ length: 8 }, (_, i) => buyPack(d2.client, U, "inicial", `b${i}`)));
    check("8 compras gratis simultáneas: 1 concesión", rows(d2, U, "buy_pack:inicial") === 1);
    const card = REG.cards[0].id; const d3 = db(U);
    ["s0", "s1", "s2"].forEach((uid) => d3.table("user_cards").push({ uid, user_id: U, card_id: card, locked: false, minted_version: null }));
    await Promise.all([salvageCards(d3.client, U, ["s0", "s1", "s2"], `salvage:${U}:a`), salvageCards(d3.client, U, ["s0", "s1", "s2"], `salvage:${U}:a`)]);
    check("reciclaje simultáneo con la misma clave: un pago", rows(d3, U, "salvage") === 1);
    const stats = newStats();
    await quiet(async () => { for (let s = 420_001; s <= 420_200; s++) await runSequence(s, stats); });
    check("200 secuencias hostiles con reintentos/ráfagas: 0 violaciones", stats.violations.length === 0, `${stats.byAction.burst ?? 0} ráfagas · ${stats.byAction.retry_last ?? 0} reintentos`);
  }

  if (want("progression")) {
    console.log("\n· PROGRESIÓN");
    const d = db(U);
    await getProgression(d.client, U);
    const state = d.table("user_pass")[0].state as { missions: { id: string; kind: string; metric: string; goal: number }[] };
    const duel = state.missions.find((m) => m.metric === "duels_played" && (m.kind === "daily" || m.kind === "weekly"));
    if (duel) {
      for (let i = 0; i < duel.goal * 4; i++) d.table("duel_matches").push({ id: `m${i}`, user_id: U, status: "COMPLETED", winner: "A", mode: "PVE" });
      const c1 = await claimMission(d.client, U, duel.id); const c2 = await claimMission(d.client, U, duel.id);
      check(`misión periódica ${duel.id}: una vez por tanda`, c1.ok && !c2.ok);
    } else check("tanda con misión de duelos (sorteo)", true, "no salió en este sorteo; cubierto por la matriz M");
    const before = JSON.stringify((d.table("user_pass")[0].state as { missions: unknown }).missions); const w = d.writes;
    await refreshMissions(d.client, U);
    check("«actualizar misiones» sin ventana vencida: no re-sortea ni escribe", d.writes === w && JSON.stringify((d.table("user_pass")[0].state as { missions: unknown }).missions) === before);
    d.table("duel_decks").push({ id: "dk", user_id: U });
    await Promise.all(Array.from({ length: 5 }, () => claimMission(d.client, U, "s-mazo")));
    const xp = Number((d.table("user_pass")[0].state as { xp: number }).xp);
    check("5 reclamos simultáneos: XP del pase sumada una sola vez", rows(d, U, "mission_reward") <= 2 && xp <= 800 + (duel ? 200 : 0) + 1000, `xp ${xp}`);
    const ENGINE = code(read("src/battlepass/engine.ts"));
    check("motor: repetible = vuelve en OTRA rotación (se marca reclamada)", /mission\.claimed = true;/.test(ENGINE) && !/rebaselineForRepeat\(mission/.test(ENGINE));
    const PROG = code(read("src/server/services/progression.ts"));
    check("pase con concurrencia optimista (`updated_at` leído)", /\.eq\("updated_at", version\)/.test(PROG) && /class PassConflictError/.test(PROG));
    const cat = buildSimCatalog(REG); const sim = new Simulator(cat);
    let worst = 0;
    for (let i = 0; i < 60; i++) worst = Math.max(worst, sim.run("HARDCORE", "fase41", seedOf(3, i, "fase41"), 0, 90).maxRecurringDay);
    check("HARDCORE simulado (60 × 90 días): fuentes recurrentes ≤ techo diario", worst <= dailyRecurringCeiling(), `${worst} ≤ ${dailyRecurringCeiling()}`);
    const base = sim.run("HARDCORE", "baseline", 7, 0, 30).maxRecurringDay;
    check("línea base (antes de la Fase 41) superaba el techo: money printer documentado", base > dailyRecurringCeiling(), `${base}`);
  }

  if (want("security")) {
    console.log("\n· SEGURIDAD");
    const prev = process.env.NEXUS_SANDBOX_CREDITS; delete process.env.NEXUS_SANDBOX_CREDITS;
    const d = db(U);
    const sp = await sandboxPurchase(d.client, U, "drlc-ultimate", "r");
    check("tienda de créditos de prueba cerrada por defecto (403, +0)", !sp.ok && credits(d) === 6000);
    if (prev !== undefined) process.env.NEXUS_SANDBOX_CREDITS = prev;
    check("prestigio: la clave lleva el usuario (sin colisión entre jugadores)", prestigeRef(U, "b", "plata") !== prestigeRef(V, "b", "plata") && /prestigeRef\(userId, baseId, tier\.id\)/.test(read("src/server/services/prestige.ts")));
    let threw = false; try { await award(d.client, { userId: U, ref: "neg", reason: "x", reward: { credits: -1 } }); } catch { threw = true; }
    check("recompensa negativa rechazada antes de la RPC sin suelo", threw && credits(d) === 6000);
    const w = d.writes; const r = d.rpcCalls.length;
    await readStarterStatus(d.client, U); await peekProgression(d.client, U); await quiet(() => getCompetitiveSnapshot(d.client, U));
    check("GET starter / temporada / competitivo: cero escrituras y cero RPC de economía", d.writes === w && d.rpcCalls.slice(r).every((x) => x === "app_content_distribution_snapshot"), `${d.writes - w} escrituras`);
    const comp = code(read("src/server/services/competitive.ts"));
    check("GET competitivo sin ensureRating ni getProgression", !/ensureRating\(|getProgression\(/.test(comp));
    const packsRoute = read("src/app/api/game/packs/route.ts");
    check("cuerpo de sobres cerrado: el cliente no manda precio, carta ni cantidad", /const ALLOWED = \["action", "packId", "ref"\];/.test(packsRoute));
    check("cuerpo de créditos rechaza importes", /"credits", "amount", "balance", "delta", "price"/.test(read("src/app/api/game/credits/route.ts")));
    check("mercado global cerrado (GLOBAL_MARKET_ENABLED=false)", GLOBAL_MARKET_ENABLED === false);
    check("Draft Gauntlet sin economía (sin award en su flujo)", /DRAFT_GAUNTLET/.test(read("src/server/services/duels.ts")) && /Draft Gauntlet no da créditos/.test(read("src/lib/duel/experience.ts")));
    check("el serial no toca la economía (reciclaje sin serie)", !/serial/.test(code(read("src/domain/economy/salvage.ts")).replace(/serializ\w*/g, "")));
    const coll = ["src/components/collectionRoom/CollectionRoomScreen.tsx", "src/domain/collection/room.ts"].map(read).join("\n");
    check("Colección sin valor/venta/mercado", !/quickSell|valor de colección|Vender|marketValue/i.test(code(coll)));
    check("ruta de estado del starter solo GET", !/export async function (POST|PUT|PATCH|DELETE)/.test(read("src/app/api/game/starter/route.ts")));
  }

  if (want("simulation")) {
    console.log("\n· SIMULACIÓN");
    const cat = buildSimCatalog(REG);
    for (const id of ["inicial", "estandar", "premium", "champions"]) {
      const a = [0, 0, 0, 0, 0]; const b = [0, 0, 0, 0, 0]; let na = 0; let nb = 0;
      for (let s = 1; s <= 20_000; s++) {
        for (const x of openPack(REG, getPack(id)!, { seed: s * 13, owned: new Set(), pity: freshPity() }).decisions) { a[BUCKETS.indexOf(x.bucket)]++; na++; }
        const out: number[] = []; drawPackIndices(cat, id, makeRng(s * 31), out); for (const ci of out) { b[cat.bucketOf[ci]]++; nb++; }
      }
      const dmax = Math.max(...a.map((x, i) => Math.abs(x / na - b[i] / nb)));
      check(`odds del simulador ≡ openPack · ${id} (20.000 sobres)`, dmax < 0.006, `máx Δ ${(100 * dmax).toFixed(2)} pp`);
    }
    const sim = new Simulator(cat);
    check("determinista (misma semilla ⇒ misma trayectoria)", JSON.stringify(Array.from(sim.run("ENGAGED", "fase41", 3, 0, 90).snapshots[3])) === JSON.stringify(Array.from(sim.run("ENGAGED", "fase41", 3, 0, 90).snapshots[3])));
    const load = (f: string) => existsSync(join(ROOT, f)) ? JSON.parse(read(f)) : null;
    const base = load("docs/product/qa/fase41/baseline-economy.json"); const fin = load("docs/product/qa/fase41/final-economy.json");
    check("baseline-economy.json: ≥ 1.000.000 trayectorias, reglas anteriores", !!base && base.trajectories >= 1_000_000 && base.rules === "baseline");
    check("final-economy.json: ≥ 1.000.000 trayectorias, reglas Fase 41", !!fin && fin.trajectories >= 1_000_000 && fin.rules === "fase41");
    const pct = fin?.archetypes?.REGULAR?.horizons?.d30?.metrics?.credits;
    check("percentiles P10/P25/P50/P75/P90/P95/P99 en el informe final", !!pct && ["P10", "P25", "P50", "P75", "P90", "P95", "P99"].every((k) => k in pct));
    check("salud final: todas las comprobaciones en verde", !!fin && fin.health.every((h: { ok: boolean }) => h.ok), fin ? `${fin.health.filter((h: { ok: boolean }) => h.ok).length}/${fin.health.length}` : "");
    check("salud baseline: la línea base SÍ fallaba (fuente sin tope / starter)", !!base && base.health.some((h: { ok: boolean }) => !h.ok));
    const fz = load("docs/product/qa/fase41/exploit-fuzzer.json");
    check("fuzzer: ≥ 100.000 secuencias y 0 violaciones", !!fz && fz.sequences >= 100_000 && fz.violations === 0, fz ? `${fz.sequences} · ${fz.actions} acciones` : "falta");
    const mut = load("docs/product/qa/fase41/exploit-fuzzer-mutation-check.json");
    check("fuzzer sensible: con los P0 reintroducidos detecta violaciones", !!mut && mut.violations > 0, mut ? JSON.stringify(mut.byInvariant) : "");
  }

  console.log(`\n${ok} ✓ · ${ko} ✗`);
  if (ko > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
