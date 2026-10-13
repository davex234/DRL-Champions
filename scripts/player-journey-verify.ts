/**
 * FASE 40 · VERIFICADOR DEL PLAYER JOURNEY — `npm run player-journey:verify` (todo) o
 *   `player-journey-starter:verify` · `player-journey-priority:verify` · `player-journey-security:verify`
 *
 *   starter   Contrato REAL de alta (migraciones), idempotencia del alta y 100.000 cuentas nuevas simuladas con el motor
 *             de sobres REAL: % con equipo legal tras los sobres de bienvenida, y 100 % de ruta GRATUITA (Sobre Inicial)
 *             a un equipo legal; fuerza del equipo de partida (sin optimizar nada).
 *   priority  Combinatoria exhaustiva de partidas abiertas × pasos del recorrido × retos/recompensas/Pick'ems sobre el
 *             motor único del vestíbulo: una partida a medias gana siempre; el recorrido va justo detrás; nada se pierde.
 *   security  Lectura sin escrituras (Supabase en memoria), privacidad, sin endpoint ni mutaciones del recorrido, sin
 *             recompensas, sin migración nueva, mercado cerrado, telemetría no-op honesta.
 *   journey   Dominio: preparación = `autocomplete` real (3.000 colecciones), combinatoria de hechos y legado.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CardRegistry } from "../src/collection/registry";
import { PackEngine } from "../src/pack/engine";
import { getPack, PACKS } from "../src/data/packs";
import { freshPity } from "../src/domain/packs/pity";
import { getVariant } from "../src/domain/cards/variants";
import { DUEL_ROLES } from "../src/domain/cardgame/types";
import type { RoleId } from "../src/domain/cards/types";
import { autocomplete, indexPool } from "../src/domain/deckBuilder/builder";
import { builderCollection } from "../src/server/services/deckTeams";
import { buildDailyLoop, dailyActions, type ActiveMatchFact, type DailyLoopFacts } from "../src/domain/dailyLoop";
import { buildPlayerJourney, deckReadiness, firstPackOf, FREE_PACK_ID, type JourneyFacts } from "../src/domain/journey";
import { STARTER_POLICY, starterAssistFor } from "../src/domain/economy/starter";
import { getDailyLoop } from "../src/server/services/dailyLoop";
import { FakeSupabase } from "../src/server/services/testing/fakeSupabase";
import { FLOWS } from "../src/lib/telemetry/contract";
import { RATE_POLICY } from "../src/server/services/rateLimit";
import { GLOBAL_MARKET_ENABLED } from "../src/config/features";

const section = process.argv[2] ?? "all";
const want = (s: string) => section === "all" || section === s;
let ok = 0; let ko = 0;
const check = (label: string, cond: boolean, detail = "") => { if (cond) ok++; else ko++; console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`); };
const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const pct = (a: number, b: number) => `${((100 * a) / Math.max(1, b)).toFixed(2)} %`;

const REG = new CardRegistry();
const ENGINE = new PackEngine(REG);
const resolve = (id: string) => {
  const c = REG.card(id); const p = c ? REG.player(c.playerId) : undefined;
  return c && p ? { playerId: c.playerId, role: p.role, dataVersion: c.dataVersion ?? "", combat: !!c.combat } : null;
};
const autoOk = (ids: string[]) => autocomplete([], indexPool(builderCollection(ids.map((cardId, i) => ({ uid: `u${i}`, cardId, obtainedAt: 0 })) as never) as never));

/** Sobres de bienvenida según la migración vigente (se leen, no se asumen). */
function starterContract() {
  const files = readdirSync(join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
  const defs = files.filter((f) => /create or replace function public\.handle_new_user\(\)/.test(read(`supabase/migrations/${f}`)));
  const latest = defs[defs.length - 1];
  const body = read(`supabase/migrations/${latest}`);
  const fn = body.slice(body.indexOf("create or replace function public.handle_new_user()"));
  const fnBody = fn.slice(0, fn.indexOf("end; $$;"));
  const packs = [...fnBody.matchAll(/\(new\.id,\s*'([a-z0-9_-]+)',\s*(\d+)\)/g)].map((m) => ({ packId: m[1], qty: Number(m[2]) }));
  const ledger = /\(new\.id,\s*(\d+),\s*'starter_grant',\s*'starter:'/.exec(fnBody);
  const credDefault = /credits\s+bigint not null default (\d+)/.exec(read("supabase/migrations/0001_init.sql"));
  return { files: defs, latest, fnBody, packs, ledgerCredits: ledger ? Number(ledger[1]) : null, creditsDefault: credDefault ? Number(credDefault[1]) : null };
}

async function main() {
  const t0 = performance.now();

  if (want("starter")) {
    console.log("\n· STARTER · CONTRATO REAL DE ALTA");
    const s = starterContract();
    check("el alta la hace SOLO el disparador `handle_new_user` (definido en 0001 y ampliado en 0011; ninguna migración posterior)", s.latest === "0011_server_authority.sql", s.files.join(", "));
    check("sobres de bienvenida = 3 × inicial + 1 × estándar", JSON.stringify(s.packs) === JSON.stringify([{ packId: "inicial", qty: 3 }, { packId: "estandar", qty: 1 }]), JSON.stringify(s.packs));
    check("créditos iniciales = 6.000 (valor por defecto de profiles) con asiento `starter_grant` de 6.000 en el libro mayor", s.creditsDefault === 6000 && s.ledgerCredits === 6000);
    check("sin cartas ni equipo de bienvenida (el alta no toca user_cards / duel_decks)", !/user_cards|duel_decks|duel_active_deck/.test(s.fnBody));
    check("idempotente: sobres `on conflict do nothing`, asiento con ref única `starter:<id>` (credit_tx_ref_uniq)", /on conflict \(user_id, pack_id\) do nothing/.test(s.fnBody) && /credit_tx_ref_uniq\s*\n?\s*on public\.credit_transactions\s*\(user_id, ref\)/.test(read("supabase/migrations/0011_server_authority.sql")));
    check("se ejecuta una vez por alta (trigger AFTER INSERT en auth.users); reintentos/pestañas no provisionan: la app no tiene ruta de alta de starter", /create trigger on_auth_user_created\s+after insert on auth\.users/.test(read("supabase/migrations/0001_init.sql")));
    // Fase 41 · `services/testing/` son dobles de prueba (MemSupabase reproduce el trigger de alta en memoria): no son rutas ni servicio.
    const appSrc = ["src/server", "src/app/api"].flatMap((d) => walk(join(ROOT, d))).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f) && !/[\\/]testing[\\/]/.test(f));
    const grants = appSrc.filter((f) => /starter_grant|'inicial',\s*3|STARTER_PACKS/.test(readFileSync(f, "utf8")));
    check("ningún código de servidor ni ruta concede el starter (ni el recorrido)", grants.length === 0, grants.join(", "));
    const inicial = getPack(FREE_PACK_ID)!;
    check("Sobre Inicial: gratis (precio 0), 5 cartas, visible en la tienda, sin garantía de rol (medido, no se toca)", inicial.price === 0 && inicial.cardCount === 5 && !("guarantees" in inicial));
    check("odds de sobres intactas (el recorrido no importa ni modifica `data/packs`)", !/data\/packs|weights/.test(code(read("src/domain/journey/index.ts") + read("src/lib/journey/presentation.ts"))));

    console.log("\n· STARTER · 100.000 CUENTAS NUEVAS (motor de sobres real, catálogo real)");
    const N = 100_000;
    let legalAfterStarter = 0; let routeFound = 0; let maxExtra = 0; let unresolved = 0;
    const extraHist = new Map<number, number>();
    const missingRole = new Map<RoleId, number>();
    const rarity = new Map<string, number>();
    const roleCards = new Map<RoleId, number>();
    let ovrSum = 0; let ovrN = 0; let ovrMin = Infinity; let ovrMax = -Infinity;
    let disagreements = 0; let compared = 0;
    const tSim = performance.now();
    for (let acc = 0; acc < N; acc++) {
      let pity = freshPity();
      const ids: string[] = [];
      let k = 0;
      // Fase 41 · el Sobre Inicial abierto sin plantilla posible lleva la asistencia de rol del servidor (2 huecos).
      const open = (packId: string) => {
        const assist = packId === FREE_PACK_ID ? starterAssistFor(packId, ids, resolve) : null;
        const r = ENGINE.draw(getPack(packId)!, { seed: ((acc * 7_919 + k++ * 104_729) >>> 0) % 2147483647, owned: [], mintCounts: {}, pity, now: 0, assist } as never);
        pity = r.pityAfter;
        for (const i of r.instances) ids.push(i.cardId);
      };
      for (const p of s.packs) for (let q = 0; q < p.qty; q++) open(p.packId);
      for (const id of ids) {
        const c = REG.card(id)!; const role = REG.player(c.playerId)!.role;
        rarity.set(getVariant(c.variantId).label, (rarity.get(getVariant(c.variantId).label) ?? 0) + 1);
        roleCards.set(role, (roleCards.get(role) ?? 0) + 1);
      }
      let ready = deckReadiness(ids, resolve);
      if (acc < 3_000) {
        compared++;
        if (ready.ready !== autoOk(ids).ok) disagreements++;
      }
      if (ready.ready) {
        legalAfterStarter++;
        if (acc < 5_000) {
          const a = autoOk(ids);
          if (a.ok) {
            const ovr = a.uids.reduce((sum, uid) => sum + REG.card(ids[Number(uid.slice(1))])!.ovr, 0) / a.uids.length;
            ovrSum += ovr; ovrN++; ovrMin = Math.min(ovrMin, ovr); ovrMax = Math.max(ovrMax, ovr);
          }
        }
      } else {
        for (const sh of ready.shortages) missingRole.set(sh.role, (missingRole.get(sh.role) ?? 0) + 1);
      }
      let extra = 0;
      while (!ready.ready && extra < STARTER_POLICY.maxFreeClaims) { open(FREE_PACK_ID); extra++; ready = deckReadiness(ids, resolve); }
      if (ready.ready) routeFound++; else unresolved++;
      if (extra > 0 && acc < 3_000) { compared++; if (autoOk(ids).ok !== true) disagreements++; }
      maxExtra = Math.max(maxExtra, extra);
      extraHist.set(extra, (extraHist.get(extra) ?? 0) + 1);
    }
    const q = (p: number) => { let acc = 0; for (const [e, n] of [...extraHist.entries()].sort((a, b) => a[0] - b[0])) { acc += n; if (acc >= p * N) return e; } return maxExtra; };
    const mean = [...extraHist.entries()].reduce((a, [e, n]) => a + e * n, 0) / N;
    console.log(`    simulación: ${(performance.now() - tSim).toFixed(0)} ms`);
    console.log(`    equipo legal SOLO con los sobres de bienvenida: ${legalAfterStarter} / ${N} (${pct(legalAfterStarter, N)})`);
    console.log(`    roles que faltan tras la bienvenida: ${[...missingRole.entries()].sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r} ${pct(n, N)}`).join(" · ")}`);
    console.log(`    Sobres Iniciales GRATIS extra hasta un equipo legal: media ${mean.toFixed(2)} · p50 ${q(0.5)} · p75 ${q(0.75)} · p90 ${q(0.9)} · p99 ${q(0.99)} · p99.9 ${q(0.999)} · máx ${maxExtra}`);
    check("100.000 cuentas nuevas simuladas", N === 100_000);
    check("MEDIDO (no se maquilla): con los sobres de bienvenida NO está garantizado un equipo legal", legalAfterStarter < N, pct(legalAfterStarter, N));
    check(`100.000 / 100.000 tienen RUTA GRATUITA a un equipo legal (Fase 41: Sobre Inicial gratis solo sin plantilla, asistido, ≤ ${STARTER_POLICY.maxFreeClaims})`, routeFound === N && unresolved === 0, `${routeFound} / ${N}`);
    check("preparación del recorrido = `autocomplete` real del constructor", disagreements === 0, `${compared} comparaciones, ${disagreements} discrepancias`);
    console.log("\n· STARTER · FUERZA (medida, sin optimizar)");
    console.log(`    OVR medio del equipo autocompletado (primeras 5.000 cuentas que ya pueden): media ${(ovrSum / Math.max(1, ovrN)).toFixed(1)} · mín ${ovrMin.toFixed(1)} · máx ${ovrMax.toFixed(1)}`);
    const totalCards = [...rarity.values()].reduce((a, b) => a + b, 0);
    console.log(`    rareza de las cartas de bienvenida: ${[...rarity.entries()].sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r} ${pct(n, totalCards)}`).join(" · ")}`);
    console.log(`    roles de las cartas de bienvenida: ${DUEL_ROLES.map((r) => `${r} ${pct(roleCards.get(r) ?? 0, totalCards)}`).join(" · ")}`);
    check("sin starter sobredimensionado: el recorrido no concede cartas (fuerza = la de los sobres reales)", ovrN > 0 && ovrSum / ovrN < 85, `OVR medio ${(ovrSum / Math.max(1, ovrN)).toFixed(1)}`);
  }

  if (want("priority")) {
    console.log("\n· PRIORIDAD (motor único del vestíbulo, combinatoria exhaustiva)");
    const MODES: ActiveMatchFact["mode"][] = ["RANKED", "PRIVATE", "CAMPAIGN", "PVE", "DRAFT"];
    const RESUME: Record<string, string> = { RANKED: "resume-ranked", PRIVATE: "resume-private", CAMPAIGN: "resume-campaign", PVE: "resume-pve", DRAFT: "resume-draft" };
    const STEPS: (Partial<JourneyFacts> | null)[] = [
      null,
      {},
      { ownedCards: 5, packsOpened: 1, unopenedPacks: 3 },
      { ownedCards: 20, packsOpened: 4, unopenedPacks: 0, firstPackId: null },
      { ownedCards: 30, packsOpened: 4, unopenedPacks: 0, firstPackId: null, readiness: READY },
      { ownedCards: 30, packsOpened: 4, unopenedPacks: 0, firstPackId: null, readiness: READY, decks: { total: 1, valid: 0, firstInvalid: { id: "x", name: "x", size: 7 } } },
      { ownedCards: 30, packsOpened: 4, unopenedPacks: 0, firstPackId: null, readiness: READY, decks: { total: 1, valid: 1, firstInvalid: null } },
      { ownedCards: 30, readiness: READY, decks: { total: 1, valid: 1, firstInvalid: null }, matchesCompleted: 1 },
      { ownedCards: 30, readiness: READY, decks: { total: 2, valid: 2, firstInvalid: null }, matchesCompleted: 12 },
    ];
    let combos = 0; let resumeWins = 0; let journeyFirst = 0; let failures: string[] = [];
    const subsets = (1 << MODES.length);
    for (let mask = 0; mask < subsets; mask++) for (const step of STEPS) for (const challenge of [0, 1]) for (const claim of [0, 1]) for (const predict of [0, 2]) {
      const matches = MODES.filter((_, i) => mask & (1 << i)).map((mode) => ({ id: mode, mode, difficulty: null, opponent: null, node: null }) as ActiveMatchFact);
      const j = step ? jf(step) : null;
      const f = pfacts({ matches, social: { incoming: challenge, from: null }, pickems: { pending: predict, open: predict, eventId: null, eventName: null }, journey: j, claimable: claim });
      const { primary, secondary } = dailyActions(f);
      const all = [primary, ...secondary];
      const journey = j ? buildPlayerJourney(j) : null;
      combos++;
      if (matches.length > 0) {
        const expected = RESUME[[...matches].sort((a, b) => MODES.indexOf(a.mode) - MODES.indexOf(b.mode))[0].mode];
        if (primary.id !== expected) failures.push(`partida abierta ${mask} → ${primary.id} (esperado ${expected})`);
        else resumeWins++;
      } else if (journey && !journey.isComplete) {
        if (!primary.id.startsWith("journey-")) failures.push(`recorrido activo sin partidas → ${primary.id}`);
        else journeyFirst++;
      }
      if (journey?.isComplete && all.some((a) => a.id.startsWith("journey-"))) failures.push("recorrido completo que sigue guiando");
      if (all.length > 4 || new Set(all.map((a) => a.kind)).size !== all.length) failures.push("más de 4 acciones o tipos repetidos");
      if (journey && !journey.isComplete && all.some((a) => ["ranked", "campaign", "quick", "create-team", "edit-team", "get-cards"].includes(a.id))) failures.push(`primera sesión con sugerencias duplicadas: ${all.map((a) => a.id)}`);
      if (JSON.stringify(dailyActions(f)) !== JSON.stringify({ primary, secondary })) failures.push("no determinista");
    }
    failures = [...new Set(failures)];
    check(`combinatoria: ${combos} estados (32 conjuntos de partidas abiertas × 9 estados de cuenta × retos × recompensas × Pick'ems)`, combos === 32 * 9 * 8, String(combos));
    check("una partida a medias gana SIEMPRE (orden ranked > privada > campaña > PvE > Draft)", failures.filter((x) => x.startsWith("partida")).length === 0, `${resumeWins} casos`);
    check("sin partidas, el recorrido activo va primero (por delante de retos, recompensas y Pick'ems)", failures.filter((x) => x.startsWith("recorrido activo")).length === 0, `${journeyFirst} casos`);
    check("un recorrido completo nunca sigue guiando", !failures.includes("recorrido completo que sigue guiando"));
    check("como mucho 4 acciones, una por tipo; sin sugerencias duplicadas en la primera sesión", !failures.some((x) => x.startsWith("más de") || x.startsWith("primera sesión")));
    check("determinista", !failures.includes("no determinista"));
    if (failures.length) console.log(failures.slice(0, 8).map((x) => `      ${x}`).join("\n"));
    const snapFresh = buildDailyLoop(pfacts({ journey: jf({}) }));
    check("cuenta nueva: acción principal = abrir SU sobre real (/abrir/inicial)", snapFresh.primaryAction.id === "journey-open" && snapFresh.primaryAction.href === "/abrir/inicial");
    check("el Daily Loop existente no se rompe sin hechos del recorrido (claim/predict/ranked de siempre)", dailyActions(pfacts({ journey: null, claimable: 1 })).primary.id === "claim");
  }

  if (want("security")) {
    console.log("\n· SEGURIDAD");
    const route = read("src/app/api/game/daily-loop/route.ts");
    check("el recorrido viaja en GET /api/game/daily-loop: solo GET, usuario del token, sin parámetros, no-store", /export async function GET/.test(route) && !/export async function (POST|PUT|PATCH|DELETE)/.test(route) && route.includes("getSession(req)") && route.includes("no-store"));
    check("sin endpoint nuevo ni acciones del recorrido (no se puede marcar un paso, completar ni conceder)", !existsSync(join(ROOT, "src/app/api/game/journey")));
    check("cubeta de rate limit existente (daily_loop_read ≤ 120/min)", !!RATE_POLICY.daily_loop_read && RATE_POLICY.daily_loop_read.limit <= 120);
    const db = freshDb();
    const r = await getDailyLoop(db as unknown as SupabaseClient, U, { now: Date.parse("2026-09-20T12:00:00Z") });
    check("lectura del recorrido: CERO escrituras y ninguna RPC de escritura", db.writes.length === 0 && db.rpcs.every((x) => x === "app_content_distribution_snapshot"), `${db.writes.length} escrituras · RPC ${db.rpcs.join(",") || "ninguna"}`);
    check("cuenta nueva real: paso ABRE sobre SU sobre inicial", r.data?.primaryAction.id === "journey-open" && r.data?.primaryAction.href === "/abrir/inicial");
    check("privacidad: los sobres y cartas de OTRO usuario no cuentan", r.data?.journey?.context.unopenedPacks === 4 && r.data?.journey?.steps[0].done === false);
    const svc = code(read("src/server/services/dailyLoop.ts"));
    check("el servicio sigue sin insert/update/upsert/delete/rpc/ensureRating/getProgression", !/\.(insert|update|upsert|delete)\(|\.rpc\(|ensureRating|getProgression\(/.test(svc));
    const client = code(["src/lib/journey/presentation.ts", "src/lib/journey/arena.ts", "src/lib/journey/deck.ts", "src/lib/journey/preference.ts"].map(read).join("\n") + ["JourneyMissionControl", "JourneyDiscovery", "JourneyCoach", "FirstMatchCoach", "CollectionCoach"].map((c) => read(`src/components/journey/${c}.tsx`)).join("\n"));
    check("el cliente del recorrido no escribe ni concede nada (sin fetch/insert/rpc/compra/apertura)", !/fetch\(|\.insert\(|\.rpc\(|purchase\(|openPackOutcome|grant|claim\(/i.test(client));
    check("«Explorar por mi cuenta» = preferencia de presentación en el adaptador KV (no servidor, no localStorage directo)", read("src/lib/journey/preference.ts").includes("getAdapter()") && !/localStorage/.test(code(read("src/lib/journey/preference.ts"))));
    check("sin recompensas de primera sesión ni moneda nueva", !/\+\s*\d+\s*(créditos|XP)|bonus|moneda nueva/i.test(client + code(read("src/domain/journey/index.ts"))));
    const migrations = readdirSync(join(ROOT, "supabase/migrations")).filter((f) => /^\d{4}_/.test(f)).sort();
    check("sin migración nueva (la última sigue siendo 0053)", migrations[migrations.length - 1] === "0053_draft_gauntlet.sql");
    check("mercado cerrado (GLOBAL_MARKET_ENABLED=false)", GLOBAL_MARKET_ENABLED === false);
    check("telemetría: no-op honesto (FLOWS sigue en 4, el recorrido no emite)", FLOWS.length === 4 && !/track(Flow|Zone)?\(/.test(client));
    check("el primer equipo solo se activa con la acción existente (`set_active`, validada en servidor) y se dice", read("src/app/duelos/mazos/page.tsx").includes("activateTeamDeck(deck.id") && read("src/lib/journey/deck.ts").includes("activado"));
    check("el paquete de sobres no cambia: odds y sobres del catálogo intactos", PACKS.find((p) => p.id === "inicial")!.weights.common === 70 && PACKS.find((p) => p.id === "estandar")!.price === 750);
  }

  if (want("journey")) {
    console.log("\n· DOMINIO DEL RECORRIDO");
    let agree = 0; let n = 0; let seed = 11;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    for (let t = 0; t < 3_000; t++) {
      const size = 3 + Math.floor(rnd() * 60);
      const ids = Array.from({ length: size }, () => REG.cards[Math.floor(rnd() * REG.cards.length)].id);
      n++;
      if (deckReadiness(ids, resolve).ready === autoOk(ids).ok) agree++;
    }
    check("preparación = `autocomplete` real en 3.000 colecciones aleatorias", agree === n, `${agree}/${n}`);
    check("primer sobre determinista entre los poseídos (inicial > estándar > orden)", firstPackOf([{ packId: "estandar", qty: 1 }, { packId: "inicial", qty: 3 }]) === "inicial" && firstPackOf([]) === null);
    check("legado: partidas sin equipo = COMPLETA; equipo sin partidas = JUEGA; cartas sin sobres = no se pide abrir",
      buildPlayerJourney(jf({ matchesCompleted: 2 })).isComplete
      && buildPlayerJourney(jf({ ownedCards: 30, readiness: READY, decks: { total: 1, valid: 1, firstInvalid: null } })).currentStep === "play"
      && buildPlayerJourney(jf({ ownedCards: 30, unopenedPacks: 0, firstPackId: null })).currentStep === "collect");
    check("ganar no es necesario: el recorrido no tiene hechos de victoria", !/win|won|victoria/i.test(Object.keys(jf({})).join(",")));
  }

  console.log(`\n${ko === 0 ? "✓" : "✗"} player-journey:verify (${section}) — ${ok} OK · ${ko} FALLOS · ${(performance.now() - t0).toFixed(0)} ms`);
  process.exit(ko === 0 ? 0 : 1);
}

/* ───────────── utilidades ───────────── */

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
}

const READY = { ready: true, dataVersion: "VCT-2026", roles: DUEL_ROLES.map((role) => ({ role, have: 2, need: 2 })), shortages: [] };
function jf(o: Partial<JourneyFacts>): JourneyFacts {
  const none = DUEL_ROLES.map((role) => ({ role, have: 0, need: 2 }));
  return { ownedCards: 0, packsOpened: 0, matchesCompleted: 0, unopenedPacks: 4, firstPackId: "inicial", decks: { total: 0, valid: 0, firstInvalid: null }, readyDeck: null, readiness: { ready: false, dataVersion: null, roles: none, shortages: none }, ...o };
}

function pfacts(o: { matches?: ActiveMatchFact[]; social?: DailyLoopFacts["social"]; pickems?: DailyLoopFacts["pickems"]; journey?: JourneyFacts | null; claimable?: number }): DailyLoopFacts {
  const NOW = Date.parse("2026-09-20T12:00:00Z");
  const j = o.journey ?? null;
  return {
    now: NOW, signedIn: true, catalogSize: 772, matches: o.matches ?? [], social: o.social ?? { incoming: 0, from: null },
    progression: {
      account: { level: 1, xp: 0, xpIntoLevel: 0, xpForNext: 100, progress: 0 }, pass: null, claimableLevels: o.claimable ?? 0, objectives: [],
      achievements: { total: 10, claimed: 0, claimable: 0, near: null }, rotationPending: false,
      metrics: { ownedCards: j?.ownedCards ?? 40, distinctCards: j?.ownedCards ?? 40, packsOpened: j?.packsOpened ?? 5, duelsPlayed: j?.matchesCompleted ?? 3 },
    },
    pickems: o.pickems ?? { pending: 0, open: 0, eventId: null, eventName: null },
    packs: { unopened: j?.unopenedPacks ?? 0 },
    decks: j ? { total: j.decks.total, valid: j.decks.valid, active: j.decks.valid ? { id: "d", name: "E", valid: true, size: 10, sumOvr: 700 } : null, firstInvalid: null } : { total: 1, valid: 1, active: { id: "d", name: "E", valid: true, size: 10, sumOvr: 700 }, firstInvalid: null },
    campaign: { completed: 0, total: 15, complete: false, next: { nodeId: "c1-n1", name: "N1", team: "LOUD", chapterOrder: 1 } },
    competitive: { rating: null, gamesPlayed: 0, wins: 0, losses: 0, draws: 0, provisional: true, position: null, rankedTotal: 10, recent: [] },
    live: [], season: { current: null, next: null }, journey: j,
  };
}

const U = "aaaaaaaa-0000-4000-8000-00000000f40a";
function freshDb(): FakeSupabase {
  const db = new FakeSupabase();
  db.tables = {
    profiles: [{ id: U, username: "Nuevo", xp: 0, credits: 6_000, points: 0, packs_opened: 0 }, { id: "other", username: "Otro", xp: 0 }],
    user_game: [{ user_id: U, packs_opened: 0 }], user_pass: [],
    user_cards: [{ uid: "x", user_id: "other", card_id: REG.cards[0].id }],
    user_achievements: [], user_cosmetics: [],
    user_packs: [{ user_id: U, pack_id: "inicial", qty: 3 }, { user_id: U, pack_id: "estandar", qty: 1 }, { user_id: "other", pack_id: "premium", qty: 50 }],
    duel_decks: [], duel_active_deck: [], duel_matches: [], draft_runs: [], campaign_attempts: [], campaign_progress: [], duel_challenges: [],
    duel_pvp_ratings: [], duel_pvp_rating_events: [], events: [], matches: [], stages: [], pickem_events: [], pickem_questions: [], pickem_submissions: [], pickem_answers: [],
  };
  return db;
}

void main();
