/**
 * DRAFT GAUNTLET · CONTRATOS (Fase 39) — lo que debe seguir siendo cierto en el CÓDIGO y en la MIGRACIÓN:
 * esquema y permisos de 0053, ruta cerrada, un solo motor y un solo validador, aislamiento de economía, rating,
 * campaña y contadores, y reglas de la interfaz (sin veredictos, sin serial, 3 cartas pesadas, sin navegador).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DRAFT_STATUSES } from "@/domain/draft/rules";
import { RATE_POLICY } from "./rateLimit";
import { BODY_KEYS, MAX_BODY, CARD_ID } from "@/app/api/game/draft-gauntlet/route";

const ROOT = process.cwd();
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");
const sqlOnly = (s: string) => s.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const MIG = src("supabase/migrations/0053_draft_gauntlet.sql");
const SQL = sqlOnly(MIG);
const SERVICE = code(src("src/server/services/draftGauntlet.ts"));
const DUELS = src("src/server/services/duels.ts");
const ROUTE = src("src/app/api/game/draft-gauntlet/route.ts");
const CLIENT = src("src/lib/draft/client.ts");
const UI = ["src/components/draft/DraftCards.tsx", "src/components/draft/DraftGauntletScreen.tsx", "src/components/draft/GauntletMap.tsx", "src/app/jugar/draft-gauntlet/page.tsx"].map(src).join("\n");
const ARENA = src("src/app/duelos/jugar/page.tsx");
const fn = (code: string, name: string) => { const i = code.indexOf(`export async function ${name}`); return code.slice(i, code.indexOf("\nexport ", i + 10)); };

/* ─────────────── migración 0053 ─────────────── */

test("K01 · 0053 es la siguiente migración y nadie más usa ese número", () => {
  const files = readdirSync(join(ROOT, "supabase/migrations")).filter((f) => /^\d{4}_/.test(f)).sort();
  assert.equal(files.filter((f) => f.startsWith("0053_")).length, 1);
  assert.ok(files.includes("0052_collection_favorites.sql"));
});

test("K02 · modo DRAFT_GAUNTLET añadido sin perder PVE / PVP / PVP_PRIVATE", () => {
  assert.match(SQL, /duel_matches_mode_check check \(mode in \('PVE','PVP','PVP_PRIVATE','DRAFT_GAUNTLET'\)\)/);
});

test("K03 · forma de DRAFT_GAUNTLET = forma de PvE (sin jugador B ni mazo B); PvP intacto", () => {
  assert.match(SQL, /\(mode in \('PVE','DRAFT_GAUNTLET'\) and player_b_id is null and deck_b_id is null\)/);
  assert.match(SQL, /mode in \('PVP','PVP_PRIVATE'\) and player_b_id is not null and deck_b_id is not null\s+and player_b_id <> user_id/);
});

test("K04 · RLS activada en las dos tablas, SIN políticas, revocado a anon/authenticated, solo service_role", () => {
  for (const t of ["draft_runs", "draft_run_matches"]) {
    assert.ok(SQL.includes(`alter table public.${t} enable row level security;`));
    assert.ok(SQL.includes(`revoke all on public.${t} from anon, authenticated;`));
    assert.ok(SQL.includes(`grant all on public.${t} to service_role;`));
  }
  assert.ok(!/create policy/i.test(SQL));
});

test("K05 · sin SECURITY DEFINER, sin funciones ni triggers nuevos", () => {
  assert.ok(!/security definer/i.test(SQL));
  assert.ok(!/create (or replace )?function/i.test(SQL));
  assert.ok(!/create trigger/i.test(SQL));
});

test("K06 · una sola run activa por usuario (índice único parcial con los 3 estados activos)", () => {
  assert.match(SQL, /create unique index if not exists draft_runs_one_active\s+on public\.draft_runs\(user_id\) where status in \('DRAFTING','READY','IN_MATCH'\)/);
});

test("K07 · un combate por etapa y una partida liquida un combate", () => {
  assert.ok(SQL.includes("primary key (run_id, stage)"));
  assert.match(SQL, /match_id\s+uuid unique references public\.duel_matches\(id\) on delete set null/);
});

test("K08 · estados de la BD = estados del dominio; etapas 1..5; resultados cerrados", () => {
  const m = SQL.match(/check \(status in \(([^)]*)\)\),/);
  assert.ok(m);
  assert.deepEqual(m![1].split(",").map((s) => s.trim().replace(/'/g, "")), [...DRAFT_STATUSES]);
  assert.ok(SQL.includes("check (stage between 1 and 5)"));
  assert.ok(SQL.includes("check (result in ('WIN','LOSS','DRAW'))"));
});

test("K09 · jsonb acotado (≤ 32 KB, objeto) y semilla en 32 bits", () => {
  assert.ok(SQL.includes("jsonb_typeof(state) = 'object' and pg_column_size(state) <= 32768"));
  assert.ok(SQL.includes("seed >= 0 and seed < 4294967296"));
});

test("K10 · 0053 no toca economía, cartas, rating, campaña ni schema_migrations", () => {
  for (const bad of ["user_cards", "credit_", "app_grant", "pvp_ratings", "campaign_", "schema_migrations", "user_game", "battle_pass"]) {
    assert.ok(!SQL.includes(bad), bad);
  }
});

test("K11 · 0053 documenta reversión y degradación", () => {
  assert.ok(MIG.includes("REVERSIÓN"));
  assert.ok(MIG.includes("DRAFT GAUNTLET TODAVÍA NO DISPONIBLE"));
});

/* ─────────────── ruta ─────────────── */

test("K12 · cuerpo cerrado: ninguna acción acepta semilla, etapa, resultado, cartas, mazo, usuario, dificultad ni recompensa", () => {
  const forbidden = ["seed", "stage", "won", "win", "result", "cards", "cardIds", "deck", "deckId", "userId", "difficulty", "reward", "opponent", "picks", "version"];
  for (const keys of Object.values(BODY_KEYS)) for (const f of forbidden) assert.ok(!keys.includes(f), f);
  assert.deepEqual(Object.keys(BODY_KEYS).sort(), ["abandon", "pick", "start", "start_match"]);
});

test("K13 · límite de tamaño, actionId UUID, versión entera, confirmación para abandonar y 5xx genérico", () => {
  assert.ok(MAX_BODY <= 1000);
  assert.ok(ROUTE.includes("INVALID_ACTION_ID"));
  assert.ok(ROUTE.includes("Number.isInteger(b.expectedVersion)"));
  assert.ok(ROUTE.includes("b.confirm !== true"));
  assert.ok(ROUTE.includes("const GENERIC"));
  assert.ok(ROUTE.includes("session.userId"));
  assert.ok(!/body\.userId|b\.userId/.test(ROUTE));
});

test("K14 · choiceId solo con forma de id público de carta", () => {
  assert.ok(CARD_ID.test("benjy__silver"));
  for (const bad of ["../x", "a__b__c;drop", "x", "__gold", "a".repeat(80) + "__gold", "benjy__silver' or 1=1"]) assert.ok(!CARD_ID.test(bad), bad);
});

test("K15 · cubetas de rate limit propias", () => {
  assert.ok(RATE_POLICY.draft_read.limit > 0 && RATE_POLICY.draft_write.limit > 0);
  assert.ok(ROUTE.includes('"draft_read"') && ROUTE.includes('"draft_write"'));
});

/* ─────────────── un motor, un validador ─────────────── */

test("K16 · el servicio no tiene validador propio: usa draftDeckCheck (validateDuelDeck canónico)", () => {
  assert.ok(!SERVICE.includes("validateDuelDeck"));
  assert.ok(!/ROLE_COUNT|DUPLICATE_PLAYER|DECK_SIZE/.test(SERVICE));
  assert.ok(DUELS.includes("export function draftDeckCheck"));
  assert.match(fn(DUELS, "startDraftMatch"), /draftDeckCheck\(/);
  assert.match(DUELS.slice(DUELS.indexOf("export function draftDeckCheck")), /validateDuelDeck\(deck, makeDeckResolver\(reg\(\), ownershipFromList\(owned\), versionOf\)\)/);
});

test("K17 · un solo camino de partida: rápida, campaña y draft usan launchPve con CURRENT_COMBAT_RULES", () => {
  assert.equal((DUELS.match(/launchPve\(sb, userId, \{/g) ?? []).length, 2);
  const launch = DUELS.slice(DUELS.indexOf("async function launchPve"), DUELS.indexOf("export async function getMatch"));
  assert.ok(launch.includes("rules: CURRENT_COMBAT_RULES"));
  assert.ok(launch.includes("rules_version: CURRENT_COMBAT_RULES.version"));
  assert.ok(launch.includes("runBot("));
  assert.ok(!SERVICE.includes("startDuelMatch") && !SERVICE.includes("confirmTurn"));
});

test("K18 · el draft inserta deck_id null y mode DRAFT_GAUNTLET; el PvE de siempre no cambia su fila", () => {
  assert.match(fn(DUELS, "startDraftMatch"), /deckId: null/);
  assert.ok(DUELS.includes("...(draft ? { mode: DRAFT_GAUNTLET_MODE } : {})"));
});

test("K19 · el servicio del draft no genera semillas de combate ni decide ganadores", () => {
  assert.ok(!SERVICE.includes("createRng("));
  assert.ok(!/winner:\s*"A"\s*[,}]|winner\s*=\s*"A"/.test(SERVICE));
  assert.ok(SERVICE.includes('from("duel_matches").select("id, status, mode, state")'));
});

/* ─────────────── aislamiento ─────────────── */

test("K20 · un combate del draft no paga: awardMatchOutcome solo fuera del draft, y liquida su run (no la campaña)", () => {
  const play = fn(DUELS, "playTurn");
  assert.match(play, /if \(!draftMatch\) \{\s+await awardMatchOutcome/);
  assert.match(play, /if \(draftMatch\) await settleDraftFor\(.*\);\s+else await settleCampaignFor/);
  assert.match(play, /draftMatch \? toDraftView\(m, level\) : toPublicView\(m, level\)/);
});

test("K21 · la vista del draft no lleva recompensa (sin duelAward)", () => {
  const view = DUELS.slice(DUELS.indexOf("export function toDraftView"), DUELS.indexOf("// ───────────────────────────── partida"));
  assert.ok(!view.includes("duelAward"));
});

test("K22 · la partida rápida no retoma ni abandona combates del draft", () => {
  assert.match(fn(DUELS, "getActiveMatch"), /\.neq\("mode", DRAFT_GAUNTLET_MODE\)/);
  assert.match(fn(DUELS, "abandonMatch"), /\.neq\("mode", DRAFT_GAUNTLET_MODE\)/);
});

test("K23 · misiones, logros, vestíbulo y eventos no cuentan combates del draft", () => {
  // CORE GAME LOOP · antes cada lectura excluía el draft a mano (`neq DRAFT_GAUNTLET`); ahora todas cuentan con
  // `matchCounts`, que solo admite PvE y ranked (lista cerrada: el draft, las privadas y los torneos quedan fuera).
  assert.match(src("src/server/services/matchCounts.ts"), /PROGRESS_MATCH_MODES = \["PVE", "PVP"\] as const/);
  assert.doesNotMatch(src("src/server/services/matchCounts.ts"), /DRAFT_GAUNTLET"\s*[,\]]/);
  for (const f of ["progression", "loop", "events"]) {
    const s = src(`src/server/services/${f}.ts`);
    assert.match(s, /countPlayedMatches\(/, f);
    assert.match(s, /countWonMatches\(/, f);
  }
});

test("K24 · rating, campaña y vestíbulo filtran su modo explícitamente (el draft queda fuera)", () => {
  assert.ok(src("src/server/services/duelsRating.ts").includes('row.mode !== "PVP"'));
  assert.ok(src("src/server/services/campaign.ts").includes('.eq("mode", "PVE")'));
  assert.ok(src("src/server/services/dailyLoop.ts").includes('.eq("mode", "PVE")'));
  assert.ok(src("src/server/services/competitive.ts").includes('.eq("mode", "PVP")'));
});

test("K25 · el servicio no toca economía, colección, rating, campaña ni sobres", () => {
  for (const bad of ["user_cards", "credit_transactions", "award(", "app_grant_reward", "pvp_ratings", "campaign_progress", "campaign_attempts", "user_game", "packs_opened", "battle_pass", "serial"]) {
    assert.ok(!SERVICE.includes(bad), bad);
  }
});

test("K26 · sin RNG ni reloj en la generación y las transiciones (deterministas)", () => {
  for (const f of ["src/domain/draft/generate.ts", "src/domain/draft/run.ts", "src/domain/draft/rules.ts"]) {
    const body = code(src(f));
    assert.ok(!body.includes("Math.random") && !body.includes("Date.now") && !body.includes("randomInt"), f);
  }
});

test("K27 · el cliente solo envía action, actionId, expectedVersion, choiceId y confirm", () => {
  const bodies = [...CLIENT.matchAll(/post<[^>]*>\(\{([^}]*)\}/g)].map((m) => m[1]);
  assert.equal(bodies.length, 4);
  for (const b of bodies) for (const key of b.split(",").map((s) => s.trim().split(":")[0]).filter(Boolean)) {
    assert.ok(["action", "actionId", "expectedVersion", "choiceId", "confirm"].includes(key), key);
  }
  assert.ok(!/localStorage|sessionStorage/.test(CLIENT + UI));
});

/* ─────────────── interfaz ─────────────── */

test("K28 · sin veredictos: nada de MEJOR, RECOMENDADA, BEST ni PEOR", () => {
  assert.ok(!/\bmejor\b|recomendad|\bbest\b|\bpeor\b/i.test(UI.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")));
});

test("K29 · sin serial en el draft y como mucho 3 cartas pesadas (Card3D solo en las opciones)", () => {
  assert.ok(!/serial=|\.serial\b/.test(UI));
  const cards = src("src/components/draft/DraftCards.tsx");
  assert.equal((cards.match(/<Card3D\b/g) ?? []).length, 1);
  assert.ok(cards.slice(cards.indexOf("export function DraftOption"), cards.indexOf("export function RosterStrip")).includes("<Card3D"));
  assert.ok(!src("src/components/draft/DraftGauntletScreen.tsx").includes("<Card3D"));
  assert.ok(cards.slice(cards.indexOf("export function RosterStrip")).includes("<CardThumb"));
});

test("K30 · elegir abre vista previa; SOLO confirmar llama a pickDraft", () => {
  const page = src("src/app/jugar/draft-gauntlet/page.tsx");
  assert.equal((page.match(/pickDraft\(/g) ?? []).length, 1);
  const confirm = page.slice(page.indexOf("const confirm = useCallback"), page.indexOf("const disabled ="));
  assert.ok(confirm.includes("pickDraft("));
  assert.ok(page.includes('onSelect={(index) => dispatch({ type: "select", index })}'));
});

test("K31 · el abandono pide confirmación en pantalla (sin window.confirm)", () => {
  assert.ok(UI.includes('role="alertdialog"'));
  assert.ok(!/window\.confirm|\bconfirm\(\s*["'`]/.test(UI));
});

test("K32 · VER CARTA lleva a la ficha de colección (la ficha dice si no la tienes)", () => {
  assert.ok(src("src/components/draft/DraftCards.tsx").includes("href={cardHref(card.cardId)}"));
});

test("K33 · movimiento reducido y sin conexión: MotionConfig user y acciones desactivadas", () => {
  const screen = src("src/components/draft/DraftGauntletScreen.tsx");
  assert.ok(screen.includes('<MotionConfig reducedMotion="user">'));
  assert.ok(screen.includes("const disabled = !!p.offline || !snapshot || !snapshot.available;"));
  assert.ok(screen.includes('data-testid="draft-offline"'));
});

test("K34 · arena en modo draft: sin revancha, sin abandonar la partida, sin elegir rival y sin XP", () => {
  const quit = ARENA.slice(ARENA.indexOf("async function quit()"), ARENA.indexOf("function reset()"));
  assert.ok(quit.indexOf("if (draftMode)") < quit.indexOf("abandonDuel("));
  assert.ok(ARENA.includes("onPlayAgain={draftMode ? () => router.push(DRAFT_ROUTE) : rematch}"));
  assert.ok(ARENA.includes("onChange={campaignMatchNode || draftMode ? undefined : change}"));
  const finish = ARENA.slice(ARENA.indexOf("const finish = useCallback"), ARENA.indexOf("const begin = useCallback"));
  assert.ok(finish.indexOf("if (draftMode)") < finish.indexOf("loadXp()"));
});

test("K35 · hub: Draft Gauntlet es un modo más en /duelos (F71), sin entrada nueva en la navegación", () => {
  assert.ok(src("src/app/duelos/page.tsx").includes("fetchDraft()"));
  assert.ok(!src("src/app/jugar/page.tsx").includes("fetchDraft()"), "F71: /jugar ya no lee el draft");
  assert.ok(src("src/components/modes/DuelModesHub.tsx").includes("DRAFT_GAUNTLET:"));
  if (existsSync(join(ROOT, "src/design/nav.ts"))) assert.ok(!/draft/i.test(src("src/design/nav.ts")));
  assert.ok(existsSync(join(ROOT, "src/app/jugar/draft-gauntlet/page.tsx")));
});

test("K36 · el mapa marca la etapa actual y el estado de cada nodo para lectores de pantalla", () => {
  const map = src("src/components/draft/GauntletMap.tsx");
  assert.ok(map.includes('aria-current={s.state === "CURRENT" || s.state === "IN_MATCH" ? "step" : undefined}'));
  assert.ok(map.includes("data-state={s.state}"));
});

/* ─────────────── F72 · economía del modo ─────────────── */

const ECON = code(src("src/server/services/draftEconomy.ts"));

test("K37 · el servicio del draft solo toca dinero a través de draftEconomy (y K25 sigue: nada de libro mayor directo)", () => {
  assert.ok(SERVICE.includes('from "./draftEconomy"'));
  for (const bad of ["app_adjust_credits", "rpc(", "credit_transactions", "user_packs", "user_cosmetics"]) assert.ok(!SERVICE.includes(bad), bad);
});

test("K38 · draftEconomy: entrada por app_adjust_credits NEGATIVA con clave de la run; premios solo por award(); sin cartas, XP ni puntos", () => {
  assert.equal((ECON.match(/rpc\(/g) ?? []).length, 1);
  assert.match(ECON, /rpc\("app_adjust_credits", \{ p_user: userId, p_delta: -fee, p_reason: entryReason, p_ref: entryRef\(runId\) \}\)/);
  assert.equal((ECON.match(/await award\(/g) ?? []).length, 2);
  for (const bad of ["user_cards", "cardId", "xp:", "points:", "p_xp", "p_points", "Math.random", "Date.now"]) assert.ok(!ECON.includes(bad), bad);
});

test("K39 · la recompensa se fija en la MISMA escritura que cierra la run y el abandono no devuelve la entrada", () => {
  const close = SERVICE.slice(SERVICE.indexOf("async function closeRun"), SERVICE.indexOf("/* ───────────────────────────── F72 · recompensas"));
  assert.ok(close.includes("state: withReward(run.state, next, now)"));
  const abandon = fn(SERVICE, "abandonDraftRun");
  assert.ok(abandon.includes('withReward(run.state, { status: "ABANDONED", stage: run.stage }, now)'));
  assert.ok(!/refund|reembolso|\+\s*fee/i.test(SERVICE + ECON));
});

test("K40 · F72 sin migración: la cabeza sigue en 0058 y 0053 no cambia", () => {
  const files = readdirSync(join(ROOT, "supabase/migrations")).filter((f) => /^\d{4}_.*\.sql$/.test(f) && !/ROLLBACK|rls_tests/i.test(f)).sort();
  // F73 añade 0059 (crafteo y misiones) y 0060 (desguace atómico, última copia): AUTORIZADAS y APLICADAS el 2026-09-30.
  // F79 · 0061 (Forja 2.0) APLICADA en producción desde F79.1 (2026-10-02): cabeza = 0061 (ops/release).
  assert.ok(files[files.length - 1].startsWith("0074_"), files[files.length - 1]); // COLECCIONES ILIMITADAS · 0074 (índices de cursor y resumen por carta; aditiva y opcional: el servidor funciona igual sin ella) es la última; antes F87.2 · 0073 (launch guard de Pick'ems); antes F87.1 · 0072, F87 · 0071 (Pick'ems 2.0); antes F86.2 · 0070 (feedback de la Closed Alpha); antes F86 · 0069 (torneos de jugadores; 0068 tag público de cuenta, 0067 admins, F85 0066, F84 0065, F83 0064)
  assert.deepEqual(files.filter((f) => /^0059_/.test(f)), ["0059_crafting_missions.sql"]);
});
