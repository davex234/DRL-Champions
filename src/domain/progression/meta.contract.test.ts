/**
 * META GAME 2.0 · CONTRATOS SOBRE EL CÓDIGO REAL (Fase 27).
 *
 * Sin base de datos: se lee lo que hay escrito en servicio, rutas, cliente y pantallas y se afirma
 * lo que la fase promete y lo que NO puede romper. Bloques: autoridad del servidor y seguridad
 * (41–48), concurrencia/idempotencia (17, 22, 29), integraciones (33–37), regresión (49–60).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CURRENT_SEASON } from "@/data/season";
import { ACHIEVEMENTS } from "./achievements";
import { totalXpForLevel, xpForCardRank } from "./levels";
import { duelPayoutTable, DAILY_DUEL_AWARD_CAP } from "./duelRewards";
import { RANKS } from "./rank";
import { REWARD_TIERS } from "@/domain/pickems/rewards";
import { EVENT_NAMES, FLOWS, isFlow } from "@/lib/telemetry/contract";
import { META_CONTEXTS, META_FLOW } from "@/lib/progression/telemetry";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const SERVICE = read("src", "server", "services", "progression.ts");
const META_SERVICE = read("src", "server", "services", "meta.ts");
const LOOP_SERVICE = read("src", "server", "services", "loop.ts");
const META_ROUTE = read("src", "app", "api", "game", "meta", "route.ts");
const PROG_ROUTE = read("src", "app", "api", "game", "progression", "route.ts");
const META_CLIENT = read("src", "lib", "progression", "meta.ts");
const HUB_PAGE = read("src", "components", "progression", "ProgressionScreen.tsx");
const HUB = read("src", "components", "progression", "MetaHub.tsx");
const HOME = read("src", "app", "page.tsx");
const JUGAR = read("src", "app", "duelos", "jugar", "page.tsx");
const CEREMONY = read("src", "components", "packs", "PackOpeningExperience.tsx");
const COLECCION = read("src", "app", "coleccion", "page.tsx");
const RESULT = read("src", "components", "duel", "ResultScreen.tsx");
const POSTMATCH = read("src", "components", "progression", "PostMatchProgress.tsx");
const ALERTS = read("src", "components", "progression", "ProgressAlerts.tsx");
const OBJECTIVES = read("src", "components", "progression", "ObjectiveList.tsx");
const ACH_GRID = read("src", "components", "progression", "AchievementGrid.tsx");
const TRACK = read("src", "components", "progression", "FreeTrack.tsx");
const SEASON = read("src", "components", "progression", "SeasonPanel.tsx");
const LOOPSTRIP = read("src", "components", "lobby", "LoopStrip.tsx");
const GRANT_RPC = read("supabase", "migrations", "0026_retire_event_tokens_rpc.sql");
const MIGRATION_46 = read("supabase", "migrations", "0046_telemetry_flows_progression.sql");
const FEATURES = read("src", "config", "features.ts");
const UI = [HUB_PAGE, HUB, POSTMATCH, ALERTS, OBJECTIVES, ACH_GRID, TRACK, SEASON, LOOPSTRIP,
  read("src", "components", "progression", "LevelHero.tsx"), read("src", "components", "progression", "TodayPanel.tsx"),
  read("src", "components", "progression", "RewardHistory.tsx"), read("src", "components", "progression", "FtueSteps.tsx"),
  read("src", "components", "progression", "CollectionObjectives.tsx")];

/* ═══════════════════ seguridad / autoridad del servidor (41–48) ═══════════════════ */

test("41+44 · el cliente no escribe XP ni nivel: la única escritura es la RPC de servidor (`app_grant_reward`/`app_apply_pack_open`)", () => {
  for (const src of [...UI, META_CLIENT, HOME, JUGAR]) {
    const c = code(src);
    assert.ok(!/\.from\("profiles"\)\.(update|upsert|insert)/.test(c), "ninguna pantalla escribe profiles");
    assert.ok(!/\.xp\s*(\+=|=\s*[^=])|\bxp\s*\+=/.test(c), "nadie asigna XP en cliente");
    assert.ok(!/level\s*(\+=|\+\+)/.test(c), "nadie sube nivel en cliente");
  }
  assert.ok(/xp\s*=\s*xp \+ coalesce\(p_xp, 0\)/.test(GRANT_RPC), "la RPC suma XP en servidor");
  assert.ok(/security definer/.test(GRANT_RPC) && /grant execute[\s\S]*to service_role/.test(GRANT_RPC));
});

test("42+43 · el cliente no escribe progreso ni elige recompensa: la ruta solo acepta ids y la meta-ruta es GET", () => {
  const bodyFields = [...new Set([...PROG_ROUTE.matchAll(/body\.(\w+)/g)].map((m) => m[1]))].sort();
  assert.deepEqual(bodyFields, ["achievementId", "action", "cosmeticId", "family", "level", "missionId", "track"]);
  assert.ok(!/body\.(progress|current|xp|credits|reward|points|baseline|assignedAt)/.test(PROG_ROUTE));
  assert.ok(/export async function GET/.test(META_ROUTE) && !/export async function POST/.test(META_ROUTE));
  assert.ok(!/\.rpc\(|\.insert\(|\.update\(|\.upsert\(/.test(code(META_SERVICE)), "el snapshot no escribe nada");
  assert.ok(!/claim[A-Za-z]*\(/.test(code(META_SERVICE)), "el snapshot no reclama");
});

test("45 · localStorage no es autoridad de progreso en ninguna pieza del meta", () => {
  for (const src of [...UI, META_CLIENT]) assert.ok(!/localStorage|sessionStorage/.test(code(src)));
  assert.ok(META_CLIENT.includes("const shown = new Set<string>();"), "la memoria de avisos es de módulo, no persiste");
});

test("46+47+17+18+22 · replay y concurrencia: claves de idempotencia deterministas y puerta única en el libro mayor", () => {
  assert.ok(SERVICE.includes("`mission:${CURRENT_SEASON.id}:${missionId}:${before.assignedAt}:${before.baseline}`"), "misión: tanda + baseline, sin Date.now()");
  assert.ok(!/mission:\$\{CURRENT_SEASON\.id\}:\$\{missionId\}:\$\{Date\.now\(\)\}/.test(SERVICE), "la clave con reloj ya no existe");
  assert.ok(SERVICE.includes("`achievement:${achievementId}`"), "logro: una clave por logro");
  assert.ok(SERVICE.includes("`pass:${CURRENT_SEASON.id}:${track}:${level}`"), "nivel del pase: una clave por nivel y carril");
  assert.ok(/exists \(select 1 from public\.credit_transactions where user_id = p_user and ref = p_ref\)/.test(GRANT_RPC), "puerta de idempotencia en la RPC");
  assert.ok(SERVICE.includes('if (error && !error.message.includes("duplicate")) throw new Error(error.message);'), "la PK de user_achievements corta la carrera");
  assert.ok(SERVICE.includes("await grantRewards(admin, userId, result.rewards, `pass:"), "se paga ANTES de marcar");
});

test("48 · el tiempo lo pone el servidor: la rotación se evalúa con `Date.now()` del servicio y el cliente solo cuenta desde `serverNow`", () => {
  // Fase 42 · la rotación es una FUNCIÓN del reloj del servidor (`resolvePassWindows`), evaluada en el servicio.
  assert.ok(SERVICE.includes("const now = Date.now();") && SERVICE.includes("resolvePassWindows({"));
  assert.ok(SERVICE.includes("serverNow: now,"));
  // La vista de misiones (con su caducidad de ventana) vive en `missionViewsOf` (rotation.ts), la misma para el servicio.
  assert.ok(readFileSync(join(process.cwd(), "src/domain/progression/rotation.ts"), "utf8").includes("expiresAt: missionExpiresAt(m.kind, m.assignedAt)") && SERVICE.includes("missionViewsOf("));
  for (const src of [OBJECTIVES, SEASON]) assert.ok(!/Date\.now\(\)/.test(code(src)), "las piezas de objetivos/temporada no leen el reloj del cliente para decidir");
  assert.ok(OBJECTIVES.includes("remainingLabel(o.expiresAt, now)"));
});

test("14 · rotación diaria/semanal al leer, solo los tipos vencidos, sin cron", () => {
  // Fase 42 · rotación PURA y determinista (solo tipos vencidos, `dueKinds`); se materializa solo en mutaciones
  // (`ensurePass`), con la versión leída del pase (concurrencia optimista, Fase 41).
  const ROT = read("src/domain/progression/rotation.ts");
  assert.ok(ROT.includes("export function dueKinds(") && ROT.includes("rotationDue(kind, m.assignedAt, now)"));
  assert.ok(SERVICE.includes("await savePass(admin, userId, r.resolved.state, r.version)"));
  assert.ok(read("src/domain/progression/rotation.ts").includes("export const BATCH_SIZE: Record<string, number> = { daily: 3, weekly: 2 };"));
  assert.ok(!/setInterval|cron/i.test(code(SERVICE)));
});

/* ═══════════════════ integraciones (33–37) ═══════════════════ */

test("33+34 · el duelo alimenta el meta: lectura antes de empezar, lectura al terminar, y el resultado la enseña", () => {
  assert.ok(JUGAR.includes("await beginProgression();") && JUGAR.includes("void endProgression();"));
  // Fase 35: en campaña el hueco lleva ANTES el resultado del nodo; el progreso del meta sigue ahí.
  // Fase 39: en Draft Gauntlet el hueco lleva el resultado de la run (el draft no da XP ni mueve el meta).
  // Fase 42 · el draft además enseña «qué sigue» (`NextUpAfter`), sin tocar el progreso del duelo.
  // FASE 62 · el progreso va en su propio hueco (`progress`), JUSTO tras las recompensas, no al final del resultado.
  assert.ok(JUGAR.includes("progress={draftMode || !progression.delta ? null : <PostMatchProgress delta={progression.delta}"));
  assert.ok(RESULT.includes("progress?: React.ReactNode") && RESULT.indexOf("{progress}") < RESULT.indexOf('data-testid="result-actions"'), "progreso antes de las acciones");
  assert.ok(JUGAR.includes("fetchGameState().then((s) => setXp("), "la XP nueva se lee del servidor");
  assert.ok(RESULT.includes("extra?: React.ReactNode") && RESULT.includes("{extra}"), "el resultado solo ofrece el hueco");
  assert.ok(!/objective|mission|misión/i.test(code(RESULT)), "el resultado no sabe de misiones");
});

test("35 · abrir un sobre alimenta el meta sin tocar la apertura: la misma operación de sync, lectura antes/después", () => {
  // Fase 38: la ceremonia usa `openPackOutcome` (la misma operación que `openPackOnline`, con el aviso de «repetida»).
  assert.ok(CEREMONY.includes("openPackOutcome(packId)"));
  assert.ok(/if \(opened\.current\) return;\s*opened\.current = true;/.test(CEREMONY));
  // F81 · `qaOpen` solo lo pasa el arnés QA (404 en producción): con sesión real la lectura «antes» sigue ahí.
  assert.ok(CEREMONY.includes("if (online && !qaOpen) await beginProgression();"));
  assert.ok(CEREMONY.includes('if (phase === "summary" && online) void endProgression();'));
  assert.ok(CEREMONY.includes("<PostMatchProgress delta={progression.delta}"));
  assert.ok(!/award\(|app_grant_reward|claim[A-Za-z]*\(/.test(code(CEREMONY)), "la ceremonia no concede nada");
});

test("36 · la colección alimenta el meta: logros de colección evaluados en servidor con las cartas reales", () => {
  assert.ok(SERVICE.includes('admin.from("user_cards").select("card_id, obtained_at").eq("user_id", userId)'));
  assert.ok(SERVICE.includes("const n = def.progress(ctx);"), "misma función que el catálogo");
  assert.ok(SERVICE.includes("distinct_cards: ownedCardIds.size"), "cartas DISTINTAS, no ejemplares");
  // Limpieza de /coleccion (2026-10-07): los objetivos/logros de colección se consultan y reclaman en Progresión y Logros;
  // la página de cartas ya no los duplica.
  assert.ok(!COLECCION.includes("CollectionObjectives"));
});

test("37 · Pick'ems solo aparece como CTA de lectura; su motor no se toca", () => {
  assert.ok(LOOP_SERVICE.includes('kind: "predict"') && LOOP_SERVICE.includes("pendingPicks"));
  for (const src of [...UI, META_SERVICE, META_CLIENT]) {
    assert.ok(!/app_submit_pick|app_score_pickem|submitPick\(/.test(code(src)));
  }
});

test("38 · la home recomienda UNA acción real con la prioridad pura y enseña nivel/objetivos del servidor", () => {
  // Fase 36: la home pinta la foto del Daily Loop; su acción sale de `orderToday`, el mismo orden que `todayActions`.
  const DAILY = read("src", "domain", "dailyLoop", "index.ts");
  assert.ok(DAILY.includes("orderToday(dailyCandidates(f), 1 + SECONDARY_MAX)"));
  assert.ok(read("src", "domain", "progression", "meta.ts").includes("return orderToday(list, input.max ?? 4);"));
  assert.ok(HOME.includes("<DailyLobby") && !/todayActions\(|continueCta\(|fetchLoop\(|fetchMetaSnapshot\(/.test(code(HOME)));
  assert.ok(LOOPSTRIP.includes('id: "continue"') && LOOPSTRIP.includes('id: "level"'));
  assert.ok(LOOP_SERVICE.includes("progression: progressionSummary"));
});

/* ═══════════════════ pantallas ═══════════════════ */

/*
 * FASE 62 · el hub es `ProgressionHub` (el `MetaHub` de F27 queda para su arnés). Orden: cuenta+temporada, reclamables,
 * objetivos, camino de temporada, logros, colección, competitivo (aparte) y lo recibido. Reclama por el transporte común.
 */
test("hub · secciones en orden: cuenta+temporada, reclamar, objetivos, camino, logros, colección, competitivo, recibido", () => {
  const NEW_HUB = read("src", "components", "progression", "hub", "ProgressionHub.tsx");
  // IA 2026-10-07 · la sección de objetivos es un bloque compartido (`objectives`, también la vista de Temporada → Objetivos).
  assert.ok(NEW_HUB.includes('id="objetivos"'));
  const full = NEW_HUB.slice(NEW_HUB.indexOf('data-f62="hub"'));
  const order = ["<Hero snap", "<ClaimCenter", "{objectives}", "Camino de temporada", "<Achievements", "<Collection", "<Competitive", "<Recent"];
  let last = -1;
  for (const k of order) { const i = full.indexOf(k); assert.ok(i > last, k); last = i; }
  assert.ok(HUB_PAGE.includes("<ProgressionHub snap={snap}") && HUB_PAGE.includes("<LevelHero level={level}"), "sin cuenta, el nivel local");
  assert.ok(!/claim[A-Za-z]*\(/.test(code(HUB_PAGE)), "la página no reclama por su cuenta");
  assert.ok(HUB_PAGE.includes('href="/logros"'), "Logros y pase sigue enlazado");
  void HUB;
});

test("21 · avisos con identidad estable y `aria-live` solo en subida de nivel/recompensa; sin repetir en cada render", () => {
  assert.ok(ALERTS.includes('aria-live="polite"') && ALERTS.includes('aria-live="assertive"'));
  assert.ok(META_CLIENT.includes("export function takeProgressEvents"));
  assert.ok(META_CLIENT.includes("if (!shown.has(e.id))") || META_CLIENT.includes("!shown.has(e.id)"));
  assert.ok(!/aria-live/.test(TRACK) && !/aria-live/.test(OBJECTIVES), "el resto no anuncia");
});

test("accesibilidad · progreso semántico, cuenta atrás no anunciada, botones y enlaces reales, texto en las recompensas", () => {
  assert.ok(read("src", "components", "ui", "Meter.tsx").includes('role="progressbar"'));
  assert.ok(!/aria-live/.test(SEASON), "la cuenta atrás de temporada no se anuncia cada minuto");
  assert.ok(TRACK.includes("snap-x snap-mandatory") && TRACK.includes("overflow-x-auto"));
  assert.ok(!/<table/.test(TRACK + OBJECTIVES + ACH_GRID), "sin tablas horizontales");
  assert.ok(read("src", "components", "progression", "RewardHistory.tsx").includes("créditos"), "las recompensas llevan texto, no solo icono");
  assert.ok(/min-h-\[(44|56|64)px\]/.test(read("src", "components", "progression", "TodayPanel.tsx") + read("src", "components", "progression", "FtueSteps.tsx")));
});

test("temporada · la cuenta atrás sale del calendario canónico (Fase 34), nunca inventada; sin entrada → sin fecha", () => {
  assert.ok(META_SERVICE.includes("resolveCalendar(SEASON_CALENDAR, now)"));
  assert.ok(META_SERVICE.includes("endsAt: seasonEntry ? seasonEntry.endsAtMs : null,"));
  assert.ok(SEASON.includes("sin fecha de cierre publicada"));
  assert.ok(!/NEON|ASCENSION/i.test(code(SEASON) + code(META_SERVICE)));
  assert.equal(CURRENT_SEASON.name, "Temporada 1 · Ascenso");
});

/* ═══════════════════ telemetría ═══════════════════ */

test("telemetría · siete contextos, flujo `progression` con puerta; taxonomía intacta; migración local NO aplicada", () => {
  assert.deepEqual([...META_CONTEXTS], ["progression_view", "objective_view", "objective_completed", "achievement_view", "level_up", "reward_view", "continue_action"]);
  assert.equal(META_FLOW, "progression");
  assert.equal(isFlow(META_FLOW), false, "hoy no existe en el contrato: trackMeta es no-op");
  assert.equal(EVENT_NAMES.length, 4);
  assert.equal(FLOWS.length, 4, "el contrato no se amplía sin la migración");
  // Fase 35.1: 0046 aplicada en la BD; `FLOWS` del código sigue cerrado (arriba), así que trackMeta sigue siendo no-op.
  assert.ok(MIGRATION_46.includes("— APLICADA (VPS 2026-09-15, Fase 35.1).") && MIGRATION_46.includes("'progression'") && MIGRATION_46.includes("'duel_play'"));
});

/* ═══════════════════ regresión (49–60) ═══════════════════ */

test("49+50 · motor de duelo y PvP intactos", () => {
  assert.ok(read("src", "domain", "cardgame", "match", "types.ts").includes("TURNS_PER_MATCH = 10"));
  assert.ok(read("src", "domain", "cardgame", "combat", "rules.ts").includes('"duel-combat-2"'));
  assert.ok(read("src", "domain", "cardgame", "opponent", "bots.ts").includes("HARD_HEURISTIC_RATE = 0.85"));
  assert.ok(read("src", "server", "services", "duelsPvp.ts").includes("PVP_TURN_MS"));
});

test("51+52+53+54 · RNG y precios de sobres, propiedad de la colección y reglas de mazo intactos", () => {
  const packs = read("src", "server", "services", "packs.ts");
  assert.ok(packs.includes("randomInt(") && packs.includes("guardPurchase(pack)"));
  assert.ok(!/@\/domain\/progression\/meta|from "\.\/progression"|from "\.\/meta"|mission|objective/i.test(code(packs)), "el servicio de sobres no sabe de objetivos");
  assert.ok(read("src", "domain", "cardgame", "types.ts").includes("DUEL_DECK_SIZE = 10"));
  assert.ok(/insert into public\.user_cards \(user_id, card_id, serial, origin\)/.test(GRANT_RPC));
});

test("55+56+57 · Pick'ems, Marketplace y autosync intactos", () => {
  assert.ok(/GLOBAL_MARKET_ENABLED\s*=\s*false/.test(FEATURES));
  assert.ok(read("src", "server", "services", "pickems.ts").includes("app_score_pickem_event"));
  assert.ok(read("src", "lib", "esports", "autosync", "policy.ts").length > 0);
  for (const src of [...UI, META_SERVICE]) assert.ok(!/market|mercado|autosync|esports/i.test(code(src)));
});

test("58 · totales de recompensa intactos: libre 15.900 + 6 sobres · competitivo 26.000 + 6 · temporada/hitos 9.500 · logros 67.500", () => {
  const sum = (t: Record<number, { credits?: number; packCount?: number }>) => {
    let credits = 0, packs = 0;
    for (const r of Object.values(t)) { credits += r.credits ?? 0; packs += r.packCount ?? 0; }
    return { credits, packs };
  };
  assert.deepEqual(sum(CURRENT_SEASON.free), { credits: 15_900, packs: 6 });
  assert.deepEqual(sum(CURRENT_SEASON.competitive ?? {}), { credits: 26_000, packs: 6 });
  const fixed = CURRENT_SEASON.missionPool.filter((m) => m.kind === "seasonal" || m.kind === "progressive");
  assert.equal(fixed.reduce((s, m) => s + (m.reward.credits ?? 0), 0), 9_500);
  assert.equal(ACHIEVEMENTS.reduce((s, a) => s + a.reward, 0), 67_500);
  assert.equal(DAILY_DUEL_AWARD_CAP, 20);
  assert.equal(REWARD_TIERS.length, 4);
});

test("59 · fórmula de XP intacta (curva de cuenta, XP por carta, pagos de duelo, pase lineal)", () => {
  assert.equal(totalXpForLevel(2), 100);
  assert.equal(totalXpForLevel(5), Math.round(100 * Math.pow(4, 1.6)));
  assert.equal(xpForCardRank(0), 10);
  assert.equal(xpForCardRank(3), 34);
  const t = duelPayoutTable();
  assert.deepEqual([t.win.EASY.xp, t.win.NORMAL.xp, t.win.HARD.xp], [60, 110, 180]);
  assert.equal(CURRENT_SEASON.xpPerLevel, 1000);
  assert.equal(CURRENT_SEASON.maxLevel, 30);
  assert.equal(RANKS.find((r) => r.id === "oro")!.min, 400);
});

test("60 · semántica de los logros intacta: mismos 7 ids, metas y recompensas; el servidor evalúa con la MISMA función", () => {
  assert.deepEqual(ACHIEVEMENTS.map((a) => [a.id, a.reward]), [
    ["sobres-100", 2500], ["sobres-1000", 25000], ["primer-mvp", 3000], ["primer-icon", 10000], ["coleccionista", 4000], ["completa-heretics", 8000], ["completa-emea", 15000],
  ]);
  assert.ok(!/case "sobres-100":/.test(SERVICE), "la tabla parcial de tres logros ya no existe");
  assert.ok(SERVICE.includes("serverProgressFor(def, ctx) < def.goal"));
});

test("7 · no hay recompensa por nivel de cuenta en el sistema y la interfaz no la inventa", () => {
  for (const src of UI) assert.ok(!/recompensa por nivel|LEVEL_REWARDS|levelReward/i.test(code(src)));
  assert.ok(read("src", "components", "progression", "LevelHero.tsx").includes("No hay recompensa por nivel de cuenta"));
});
