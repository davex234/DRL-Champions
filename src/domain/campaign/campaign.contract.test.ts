/**
 * ROAD TO CHAMPIONS · CONTRATOS (Fase 35) — hub de modos (75–80), vestíbulo/temporada (81–87), privacidad
 * (88–94), accesibilidad/UI (100–106) y regresión (107–140). Pruebas puras y de lectura de código: fijan lo que
 * esta fase NO podía cambiar (motor, bots, rating, cola, liquidación, mercado, temporada, migraciones).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { NAV_SECTIONS, MOBILE_NAV, IMMERSIVE_ROUTES, sectionForPath } from "@/design/nav";
import { zoneFromPath, FLOWS } from "@/lib/telemetry/contract";
import { campaignFlow, trackCampaign, CAMPAIGN_CONTEXTS } from "@/lib/campaign/telemetry";
import { RATE_POLICY } from "@/server/services/rateLimit";
import { GLOBAL_MARKET_ENABLED } from "@/config/features";
import { SEASON_CALENDAR } from "@/data/seasonCalendar";
import { CardRegistry } from "@/collection/registry";
import { ROAD_TO_CHAMPIONS } from "@/data/roadToChampions";
import { buildCampaignSnapshot, allNodes, buildOpponentPlan, nodeCardTier, type NodeProgress } from "@/domain/campaign";
import {
  gameModes, dailyPveObjectives, nodeCta, resultCopy, lockReason, chapterLayout, nodeAriaLabel, nextNodeAfter, allNodeViews,
  type ModeFacts,
} from "@/lib/campaign/presentation";
import { todayActions, continueCta, type MetaObjective } from "@/domain/progression/meta";
import { CURRENT_COMBAT_RULES } from "@/domain/cardgame/combat";

const ROOT = process.cwd();
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");
const code = (p: string) => src(p).replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "");

const REG = new CardRegistry();
const PLANS = new Map(allNodes(ROAD_TO_CHAMPIONS).map((n) => [n.id, buildOpponentPlan(REG, n.opponent.teamId, nodeCardTier(ROAD_TO_CHAMPIONS, n.id)!)]));
const done = (nodeId: string): NodeProgress => ({ nodeId, version: "rtc-1", status: "COMPLETED", bestResult: "WIN", attempts: 1, wins: 1, firstClearedAt: 1, firstClearMatchId: "m", updatedAt: 1 });
const snap = (progress: NodeProgress[] = [], available = true) =>
  buildCampaignSnapshot({ def: ROAD_TO_CHAMPIONS, opponents: PLANS, progress, available, unavailableReason: available ? null : "MIGRATION_PENDING", serverNow: 0 });

const FACTS: ModeFacts = {
  signedIn: true, hasValidDeck: true, activePve: false, activePvp: false, rankedProvisional: false,
  campaign: { available: true, completed: 3, total: 15, complete: false, nextName: "Ritmo de élite", chapter: "Capítulo 1" },
  // Fase 39 · Draft Gauntlet entra como quinto modo (sin run activa).
  draft: { available: true, status: null, pick: 0, stage: 0, lastStatus: null },
};
const byId = (f: ModeFacts) => Object.fromEntries(gameModes(f).map((c) => [c.id, c]));

/* ─────────────── 75–80 · hub de modos ─────────────── */

test("T75 · /jugar existe y Road to Champions es el modo héroe (primero)", () => {
  assert.ok(existsSync(join(ROOT, "src/app/jugar/page.tsx")));
  assert.ok(existsSync(join(ROOT, "src/app/jugar/road-to-champions/page.tsx")));
  assert.deepEqual(gameModes(FACTS).map((c) => c.id), ["ROAD_TO_CHAMPIONS", "QUICK", "RANKED", "FRIEND", "DRAFT_GAUNTLET"]);
});

test("T76 · estados SOLO de datos reales: disponible, en partida, equipo no válido, provisional", () => {
  assert.deepEqual(Object.values(byId(FACTS)).map((c) => c.status), ["DISPONIBLE", "DISPONIBLE", "DISPONIBLE", "DISPONIBLE", "DISPONIBLE"]);
  const noTeam = byId({ ...FACTS, hasValidDeck: false });
  assert.equal(noTeam.QUICK.status, "EQUIPO NO VÁLIDO"); assert.equal(noTeam.RANKED.status, "EQUIPO NO VÁLIDO"); assert.equal(noTeam.ROAD_TO_CHAMPIONS.status, "EQUIPO NO VÁLIDO");
  const inMatch = byId({ ...FACTS, activePve: true, activePvp: true });
  assert.equal(inMatch.QUICK.status, "EN PARTIDA"); assert.equal(inMatch.RANKED.status, "EN PARTIDA"); assert.equal(inMatch.QUICK.cta.href, "/duelos/jugar");
  assert.equal(byId({ ...FACTS, rankedProvisional: true }).RANKED.status, "PROVISIONAL");
  // Sin dato de equipo (null) no se afirma nada.
  assert.equal(byId({ ...FACTS, hasValidDeck: null }).QUICK.status, "DISPONIBLE");
});

test("T77 · los modos enlazan a lo que YA existe (partida rápida, competitivo, social)", () => {
  const c = byId(FACTS);
  assert.equal(c.QUICK.cta.href, "/duelos/jugar");
  assert.equal(c.RANKED.cta.href, "/duelos/competitivo");
  assert.equal(c.FRIEND.cta.href, "/social");
  for (const p of ["src/app/duelos/jugar/page.tsx", "src/app/duelos/competitivo/page.tsx", "src/app/social/page.tsx"]) assert.ok(existsSync(join(ROOT, p)), p);
});

test("T78 · campaña: sin sesión, cargando, no disponible, completada; progreso X/Y en el detalle", () => {
  assert.equal(byId({ ...FACTS, signedIn: false }).ROAD_TO_CHAMPIONS.status, "INICIA SESIÓN");
  assert.equal(byId({ ...FACTS, campaign: "loading" }).ROAD_TO_CHAMPIONS.status, "CARGANDO");
  assert.equal(byId({ ...FACTS, campaign: null }).ROAD_TO_CHAMPIONS.status, "NO DISPONIBLE");
  assert.equal(byId({ ...FACTS, campaign: { available: false, completed: 0, total: 15, complete: false, nextName: null, chapter: null } }).ROAD_TO_CHAMPIONS.status, "NO DISPONIBLE");
  assert.equal(byId({ ...FACTS, campaign: { available: true, completed: 15, total: 15, complete: true, nextName: null, chapter: null } }).ROAD_TO_CHAMPIONS.status, "COMPLETADA");
  assert.match(byId(FACTS).ROAD_TO_CHAMPIONS.detail!, /^3\/15 nodos · Capítulo 1 · Siguiente: Ritmo de élite$/);
});

test("T79 · desafíos del día = objetivos diarios de duelos existentes (sin tabla nueva, sin modificadores)", () => {
  const o = (id: string, kind: string, metric: string, claimed = false): MetaObjective => ({ id, label: id, kind, current: 0, goal: 1, complete: false, claimed, rewardCredits: 0, xp: 0, metric, packId: null, packCount: 0, assignedAt: 0, expiresAt: null });
  const list = [o("a", "daily", "duels_won"), o("b", "daily", "duels_played"), o("c", "weekly", "duels_won"), o("d", "daily", "packs_opened"), o("e", "daily", "duels_won", true)];
  assert.deepEqual(dailyPveObjectives(list).map((x) => x.id), ["a", "b"]);
  const sql = readdirSync(join(ROOT, "supabase/migrations")).map((f) => readFileSync(join(ROOT, "supabase/migrations", f), "utf8")).join("\n");
  assert.ok(!/daily_challenges/.test(sql));
});

test("T80 · el hub dice JUGAR (F71: sin subtítulo) y la navegación entra por /jugar sin pasar de 7", () => {
  const hub = src("src/components/modes/GameModesHub.tsx");
  assert.ok(hub.includes('>{t("Jugar")}</h1>') && !hub.includes("Elige tu próximo desafío"));
  const jugar = NAV_SECTIONS.find((s) => s.id === "jugar")!;
  assert.equal(jugar.href, "/jugar");
  assert.equal(jugar.items[0].href, "/jugar");
  assert.ok(jugar.items.length <= 7);
  assert.equal(MOBILE_NAV.find((m) => m.section === "jugar")!.href, "/jugar");
  assert.equal(sectionForPath("/jugar/road-to-champions")?.id, "jugar");
  // Fase 36: la home pinta el Daily Loop; «Jugar» sigue entrando por el hub de modos.
  assert.ok(src("src/domain/dailyLoop/index.ts").includes('play: "/jugar"') && src("src/app/page.tsx").includes("<DailyLobby"));
});

/* ─────────────── 81–87 · vestíbulo y temporada ─────────────── */

test("T81 · NextUp: la campaña es un paso SECUNDARIO (play, 6.5 tras «Juega un duelo»)", () => {
  const loop = src("src/server/services/loop.ts");
  const i = loop.indexOf('id: "play-duel"');
  const j = loop.indexOf('id: "campaign"');
  assert.ok(i > 0 && j > i);
  assert.ok(/id: "campaign",\s+kind: "play",[\s\S]{0,400}priority: 6\.5/.test(loop));
  assert.ok(/readCampaignSummary\(admin, userId\)\.catch\(\(\) => null\)/.test(loop));
});

test("T82 · la prioridad compartida no cambia (RANK y verbos de continuar)", () => {
  // Fase 42 · el orden de siempre + `run` (Draft en curso, detrás de retomar partida).
  assert.ok(src("src/domain/progression/meta.ts").includes("const RANK: Record<TodayKind, number> = { resume: 0, challenge: 1, claim: 2, predict: 3, objective: 4, open: 5, build: 6, play: 7, explore: 8, run: 0.7 };"));
  const steps = [
    { id: "play-duel", kind: "play" as const, label: "Juega un duelo", detail: "", href: "/duelos/jugar" },
    { id: "campaign", kind: "play" as const, label: "Continúa Road to Champions", detail: "", href: "/jugar/road-to-champions" },
  ];
  const a = todayActions({ steps, objectives: [] });
  assert.equal(a.length, 1);
  assert.equal(continueCta(a)!.label, "Juega un duelo");
});

test("T83 · la temporada no crea un segundo motor de prioridad ni conoce la campaña", () => {
  assert.ok(!/campaign/i.test(code("src/domain/season/actions.ts")));
  assert.ok(!/campaign/i.test(code("src/server/services/season.ts")));
});

test("T84 · la home mantiene la acción principal antes del bloque de temporada", () => {
  // Fase 36: el héroe (acción principal) y las secundarias van antes que HOY/TEMPORADA.
  const lobby = src("src/components/dailyLoop/DailyLobby.tsx");
  assert.ok(lobby.indexOf("<DailyHero") > 0 && lobby.indexOf("<DailyHero") < lobby.indexOf("<SeasonBlock"));
  assert.ok(lobby.indexOf("<NextRail") < lobby.indexOf("<SeasonBlock"));
});

test("T85 · el paso de campaña exige equipo válido y ninguna partida a medias (dentro de la rama de jugar)", () => {
  const loop = src("src/server/services/loop.ts");
  const branch = loop.slice(loop.indexOf("} else if (!activeDuelRes.data) {"), loop.indexOf("// ── 6. Qué está pasando ──"));
  assert.ok(branch.includes('id: "campaign"'));
});

test("T86 · la temporada sigue siendo UNA (nexus-s1) y sin Temporada 2 inventada", () => {
  assert.equal(SEASON_CALENDAR.length, 1);
  assert.equal(SEASON_CALENDAR[0].id, "nexus-s1");
  assert.equal(SEASON_CALENDAR[0].startsAt, "2026-09-07T00:00:00.000Z");
});

test("T87 · la acción principal de la home sigue siendo la primera de la prioridad única", () => {
  // Fase 36: `todayActions` y el Daily Loop comparten `orderToday`; la campaña es «jugar» (rango 7), nunca por delante de lo urgente.
  const daily = src("src/domain/dailyLoop/index.ts");
  assert.ok(daily.includes("orderToday(dailyCandidates(f), 1 + SECONDARY_MAX)"));
  assert.ok(/id: "campaign", kind: "play"/.test(daily));
});

/* ─────────────── 88–94 · privacidad ─────────────── */

test("T88 · perfil = identidad: el progreso de campaña ya no se pinta en el perfil (vive en Road to Champions); nunca en el público", () => {
  const page = src("src/components/player/PlayerProfileScreen.tsx");
  assert.equal((page.match(/<CampaignProfileBadge/g) ?? []).length, 0);
  assert.ok(!/campaign/i.test(src("src/components/player/PlayerIdentityView.tsx")) && !/campaign/i.test(src("src/components/player/ProfileIdentityCard.tsx")));
});

test("T89 · GET /api/game/campaign no admite parámetros (no se puede pedir el mapa de otro)", () => {
  const route = src("src/app/api/game/campaign/route.ts");
  assert.ok(route.includes('if ([...q.keys()].length > 0) return bad("Parámetro no válido");'));
  assert.ok(route.includes("getCampaign(admin, session.userId)"));
});

test("T90 · POST: lista CERRADA de claves; nada de userId, dificultad, rival, resultado ni recompensa", () => {
  const route = src("src/app/api/game/campaign/route.ts");
  assert.ok(route.includes('start: ["action", "nodeId", "deckId"]') && route.includes('sync: ["action"]') && route.includes('abandon: ["action"]'));
  assert.ok(route.includes('"FIELD_NOT_ALLOWED"'));
  assert.ok(!/b\.(userId|difficulty|opponent|winner|result|reward|completed)/.test(route));
});

test("T91 · el cliente nunca envía userId ni guarda progreso en el navegador", () => {
  const client = code("src/lib/campaign/client.ts");
  assert.ok(!/userId|localStorage|sessionStorage|indexedDB/.test(client));
});

test("T92 · 0051: RLS activa, sin políticas y sin acceso anon/authenticated", () => {
  const sql = src("supabase/migrations/0051_campaign_road_to_champions.sql");
  for (const t of ["campaign_progress", "campaign_attempts"]) {
    assert.ok(sql.includes(`alter table public.${t} enable row level security;`), t);
    assert.ok(sql.includes(`revoke all on public.${t} from anon, authenticated;`), t);
  }
  assert.ok(!/create policy/i.test(sql));
});

test("T93 · la vista previa pública no enseña progreso de nadie", () => {
  const s = snap([]);
  assert.equal(s.summary.completed, 0);
  assert.equal(s.activeAttempt, null);
  assert.ok(src("src/server/services/campaign.ts").includes("progress: [], available: true, unavailableReason: null, serverNow: now"));
});

test("T94 · el rival no se revela carta a carta antes de jugar (información oculta)", () => {
  const json = JSON.stringify(snap([done("c1-n1")]));
  for (const p of PLANS.values()) if (p.ok) for (const c of p.cards) assert.ok(!json.includes(c.cardId), c.cardId);
});

/* ─────────────── 100–106 · accesibilidad y UI ─────────────── */

test("T100 · los nodos son botones reales con etiqueta completa y estado en texto", () => {
  const map = src("src/components/campaign/CampaignMap.tsx");
  assert.ok(map.includes('type="button"') && map.includes("aria-label={nodeAriaLabel(node)}") && map.includes('aria-haspopup="dialog"'));
  assert.ok(/\{(?:td\()?STATUS_LABEL\[node\.status\]\)?\}/.test(map));
  const s = snap([done("c1-n1")]);
  assert.match(nodeAriaLabel(allNodeViews(s)[1]), /^Nodo 1-2 · Partida · Presión alta · contra .+ · dificultad Novato · Disponible · Siguiente$/);
});

test("T101 · el detalle es un diálogo accesible: aria-modal, título, Escape, foco atrapado y devuelto", () => {
  const sheet = src("src/components/campaign/NodeSheet.tsx");
  for (const s of ['role="dialog"', 'aria-modal="true"', 'aria-labelledby="node-sheet-title"', 'e.key === "Escape"', 'e.key !== "Tab"', "returnTo?.focus?.()", "data-autofocus"]) assert.ok(sheet.includes(s), s);
});

test("T102 · objetivos táctiles de 44 px en nodos, cierre y enlaces de migas", () => {
  assert.ok(src("src/components/campaign/CampaignMap.tsx").includes("min-h-[44px]"));
  assert.ok(src("src/components/campaign/NodeSheet.tsx").includes("h-11 w-11"));
  assert.ok(src("src/components/campaign/CampaignHero.tsx").includes("min-h-[44px]"));
  assert.ok(src("src/components/campaign/CampaignPreMatch.tsx").includes("h-11 w-11"));
});

test("T103 · movimiento reducido: pulso y energía se apagan; sin destellos (ciclo ≥ 1,6 s)", () => {
  const css = src("src/app/globals.css");
  assert.ok(/@media \(prefers-reduced-motion: reduce\) \{\s+\.nx-node-pulse, \.nx-energy \{ animation: none; \}/.test(css));
  assert.ok(css.includes("animation: nx-node-pulse 2.4s") && css.includes("animation: nx-energy-flow 1.6s"));
});

test("T104 · móvil sin scroll horizontal: mapa vertical bajo md; posiciones de escritorio dentro de 0–100 %", () => {
  const map = src("src/components/campaign/CampaignMap.tsx");
  assert.ok(map.includes('className="relative mt-4 space-y-1.5 md:hidden"') && map.includes("hidden h-[248px] md:block"));
  for (const n of [1, 3, 5, 6, 8]) for (const p of chapterLayout(n)) assert.ok(p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 100);
});

test("T105 · CTA del nodo: bloqueado explica qué falta; equipo inválido → EDITAR EQUIPO; sin conexión → progreso seguro", () => {
  const s = snap([done("c1-n1")]);
  const [n1, n2, n3] = allNodeViews(s);
  const base = { snapshot: s, signedIn: true, online: true, decksKnown: true, deck: { id: "d", name: "Mi equipo", valid: true, sumOvr: 700 } };
  assert.equal(nodeCta({ ...base, node: n2 }).kind, "PLAY");
  assert.equal(nodeCta({ ...base, node: n1 }).kind, "REPLAY");
  const locked = nodeCta({ ...base, node: n3 });
  assert.equal(locked.kind, "LOCKED");
  assert.equal(locked.note, "Gana «Presión alta» (1-2) para desbloquearlo.");
  assert.equal(nodeCta({ ...base, node: n2, deck: { ...base.deck, valid: false } }).kind, "EDIT_TEAM");
  assert.equal(nodeCta({ ...base, node: n2, deck: null }).kind, "CREATE_TEAM");
  assert.equal(nodeCta({ ...base, node: n2, online: false }).note, "SIN CONEXIÓN · Tu progreso está seguro.");
  assert.equal(nodeCta({ ...base, node: n2, signedIn: false }).kind, "SIGN_IN");
  assert.equal(nodeCta({ ...base, snapshot: snap([], false), node: allNodeViews(snap([], false))[0] }).note, "ROAD TO CHAMPIONS TODAVÍA NO DISPONIBLE");
  assert.equal(lockReason(snap([], false), allNodeViews(snap([], false))[0]), "Road to Champions todavía no está disponible.");
});

test("T106 · resultado del nodo: NODO COMPLETADO / INTÉNTALO DE NUEVO / empate pendiente / capítulo y campaña", () => {
  const base = { firstClear: false, wasCompleted: false, chapterClosed: null, campaignComplete: false, credits: 0, nodeName: "Primer contacto" };
  assert.equal(resultCopy({ ...base, outcome: "WIN", firstClear: true, credits: 50 }).title, "Nodo completado");
  assert.equal(resultCopy({ ...base, outcome: "LOSS" }).title, "Inténtalo de nuevo");
  assert.equal(resultCopy({ ...base, outcome: "DRAW" }).title, "Empate · nodo pendiente");
  assert.equal(resultCopy({ ...base, outcome: "WIN", wasCompleted: true }).title, "Victoria · nodo ya completado");
  assert.equal(resultCopy({ ...base, outcome: null }).tone, "pending");
  const s = snap(ROAD_TO_CHAMPIONS.chapters[0].nodes.map((n) => done(n.id)));
  assert.equal(resultCopy({ ...base, outcome: "WIN", firstClear: true, chapterClosed: s.chapters[0], credits: 200 }).title, "Capítulo 1 completado");
  assert.equal(resultCopy({ ...base, outcome: "WIN", firstClear: true, campaignComplete: true }).title, "Road to Champions completado");
  assert.equal(nextNodeAfter(s, "c1-n5")!.id, "c2-n1");
});

/* ─────────────── 107–140 · regresión ─────────────── */

const FORBIDDEN_ENGINES = /CampaignCombatEngine|RoadToChampionsEngine|ChallengeCombatResolver|AdventureBattleEngine|PvEEngine2/;
function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(f) && !f.endsWith(".contract.test.ts")) out.push(p);
  }
  return out;
}

test("T107 · ningún segundo motor de combate en todo src", () => {
  for (const f of walk(join(ROOT, "src"))) assert.ok(!FORBIDDEN_ENGINES.test(readFileSync(f, "utf8")), f);
});

test("T108 · el dominio de campaña no importa el combate, la resolución ni los bots", () => {
  for (const f of ["types.ts", "definition.ts", "opponent.ts", "progression.ts", "snapshot.ts", "rewards.ts", "difficulty.ts"]) {
    const c = code(`src/domain/campaign/${f}`);
    assert.ok(!/cardgame\/(combat|match|opponent\/bots|pvp)|duel-combat|duel-turns|createDuelBot|advanceBots|confirmTurn/.test(c.replace(/import type[^;]+;/g, "")), f);
  }
});

test("T109 · el servicio de campaña nunca escribe en duel_matches (solo lee; abandonar usa `abandonMatch`)", () => {
  const c = code("src/server/services/campaign.ts");
  assert.ok(!/from\("duel_matches"\)\.(insert|update|upsert|delete)/.test(c));
});

test("T110 · el servicio de campaña no toca rating, cola, PvP ni liquidación competitiva", () => {
  const c = code("src/server/services/campaign.ts");
  assert.ok(!/duelsRating|competitive|matchmaking|pvp|ensureRating|settle(Ranked|Pvp)|duel_pvp/i.test(c));
});

test("T111 · startMatch (partida rápida) mantiene su rival OPD-09 y sus validaciones", () => {
  const d = src("src/server/services/duels.ts");
  assert.ok(d.includes("return createPveMatch(sb, userId, deckId, level, (sumOvr) => buildOpponentDeck(sumOvr, randomInt(0, 2 ** 31)));"));
  assert.ok(d.includes('if (!DIFFICULTIES.has(difficulty as BotDifficulty)) return fail(400, "Dificultad no válida");'));
});

test("T112 · la inserción de la partida PvE no cambia de forma (sin `mode`, sin columna de campaña)", () => {
  const d = src("src/server/services/duels.ts");
  // Fase 39 · un solo camino (`launchPve`): la partida rápida y la de campaña siguen pasando SU equipo (`row.id`) y
  // la fila solo gana `mode`/`id` explícitos en el draft; la forma de la inserción PvE no cambia.
  assert.ok(d.includes("return launchPve(sb, userId, { deckId: row.id, snapshot, level, opponentFor });"));
  assert.ok(d.includes("user_id: userId, deck_id: input.deckId, difficulty: level, status: match.status,"));
  assert.ok(d.includes("...(draft ? { mode: DRAFT_GAUNTLET_MODE } : {}),"));
  assert.ok(d.includes("state: match as unknown as object, rng, rules_version: CURRENT_COMBAT_RULES.version,"));
  assert.ok(!/campaign_id|node_id/.test(code("src/server/services/duels.ts")));
});

test("T113 · el orden de semillas del servidor no cambia (A, B, rival, primer atacante)", () => {
  const d = src("src/server/services/duels.ts");
  const a = d.indexOf("const seedA = randomInt(0, 2 ** 31);");
  const b = d.indexOf("const seedB = randomInt(0, 2 ** 31);");
  const o = d.indexOf("opponent = opponentFor(sumOvr);");
  const f = d.indexOf("const firstAttacker: Side = randomInt(0, 2) === 0 ? HUMAN : BOT;");
  assert.ok(a > 0 && a < b && b < o && o < f);
});

test("T114 · el gancho de campaña va DESPUÉS de persistir y pagar, y nunca rompe la jugada", () => {
  const d = src("src/server/services/duels.ts");
  // F72.8 · `persist` recibe además el reloj ({ now, dueAt }): el orden persistir → pagar → campaña no cambia.
  const persistAt = d.indexOf("await persist(sb, row, m, rng, { now,");
  const awardAt = d.indexOf("await awardMatchOutcome(sb, row.user_id, row.id, m, level)");
  const hookAt = d.indexOf("await settleCampaignFor(sb, row.user_id, row.id, m);");
  assert.ok(persistAt > 0 && persistAt < awardAt && awardAt < hookAt);
  assert.ok(/async function settleCampaignFor[\s\S]{0,200}try \{[\s\S]{0,400}\} catch \(e\) \{/.test(d));
});

test("T115 · el rival fijo pasa por el MISMO validador canónico que el rival de siempre", () => {
  const d = src("src/server/services/duels.ts");
  const fixed = d.slice(d.indexOf("function fixedOpponentDeck"), d.indexOf("// ───────────────────────────── proyección pública"));
  assert.ok(fixed.includes("validateDuelDeck(deck, makeDeckResolver(reg(), ownershipFromList(owned), versionOf))"));
  assert.ok(fixed.includes("takeDeckSnapshot(deck, validation, 0)!"));
});

test("T116 · reglas de combate vigentes intactas", () => {
  assert.ok(typeof CURRENT_COMBAT_RULES.version === "string" && CURRENT_COMBAT_RULES.version.length > 0);
});

test("T117 · /api/game/duel no gana acciones ni campos de campaña", () => {
  const r = src("src/app/api/game/duel/route.ts");
  assert.ok(!/campaign|nodeId/.test(r));
  assert.ok(r.includes("return send(await startMatch(session.admin, session.userId, deckId, difficulty));"));
});

test("T118 · la arena conserva sus textos fijados y el camino PvE normal", () => {
  const j = src("src/app/duelos/jugar/page.tsx");
  assert.ok(/<ErrorState message=\{(?:td\()?fatal\)?\} onRetry=\{boot\} \/>/.test(j));
  assert.ok(j.includes('variant="ghost" size="md" className="shrink-0" onClick={onQuit}'));
  assert.ok(j.includes("const r = nodeId ? await startCampaignNode(nodeId, id) : await startDuel(id, lv);"));
  // Fase 39 · la pre-partida rápida sigue ahí; en contexto de draft (`?draft=1`) no se elige equipo ni rival.
  assert.ok(j.includes("{stage === \"prematch\" && !campaignNodeId && !draftMode && ("));
});

test("T119 · la pre-partida rápida no cambia («Comenzar duelo», selector de dificultad)", () => {
  const p = src("src/components/duel/PreMatch.tsx");
  assert.ok(p.includes('{busy ? t("Preparando…") : t("Comenzar duelo")}') && p.includes('const LEVELS: BotDifficulty[] = ["EASY", "NORMAL", "HARD"];'));
});

test("T120 · la campaña no añade componentes dentro de components/duel (UI_FILES intacto)", () => {
  assert.ok(!existsSync(join(ROOT, "src/components/duel/campaign")));
  for (const f of readdirSync(join(ROOT, "src/components/campaign"))) assert.ok(!f.startsWith("Duel"), f);
});

test("T121 · la arena sigue siendo la única ruta inmersiva de partida (el hub y el mapa llevan armazón)", () => {
  assert.ok(IMMERSIVE_ROUTES.includes("/duelos/jugar"));
  assert.ok(!IMMERSIVE_ROUTES.some((r) => r.startsWith("/jugar")));
});

test("T122 · telemetría: zonas cerradas reutilizadas; `campaign` reservado en 0046 y fuera de FLOWS (no-op honesto)", () => {
  assert.equal(zoneFromPath("/jugar"), "duel_hub");
  assert.equal(zoneFromPath("/jugar/road-to-champions"), "duel_hub");
  assert.equal(FLOWS.length, 4);
  assert.equal(campaignFlow(), null);
  assert.doesNotThrow(() => trackCampaign("campaign_open"));
  assert.deepEqual([...CAMPAIGN_CONTEXTS], ["game_modes_view", "campaign_open", "campaign_node_open", "campaign_match_start", "campaign_node_complete", "campaign_replay", "campaign_chapter_complete"]);
  assert.ok(src("supabase/migrations/0046_telemetry_flows_progression.sql").includes("'deck_management', 'season', 'campaign'"));
});

test("T123 · migraciones: 0051 aplicada en la Fase 35.1 (sin registro falso), la campaña no añadió 0052 (solo la de favoritos, Fase 37), 0046–0050 siguen ahí", () => {
  const files = readdirSync(join(ROOT, "supabase/migrations"));
  for (const n of ["0046", "0047", "0048", "0049", "0050", "0051"]) assert.ok(files.some((f) => f.startsWith(n)), n);
  assert.deepEqual(files.filter((f) => f.startsWith("0052")), ["0052_collection_favorites.sql"]);
  const sql = src("supabase/migrations/0051_campaign_road_to_champions.sql");
  assert.ok(sql.startsWith("-- 0051 · ROAD TO CHAMPIONS") && sql.includes("— APLICADA (VPS 2026-09-15, Fase 35.1).") && sql.includes("No tocar `schema_migrations`"));
  assert.ok(!/schema_migrations\s*\(|insert into\s+supabase_migrations/i.test(sql));
});

test("T124 · 0051 no toca tablas existentes (solo crea las dos suyas)", () => {
  const sql = src("supabase/migrations/0051_campaign_road_to_champions.sql").replace(/--.*$/gm, "");
  assert.ok(!/alter table public\.(duel_matches|profiles|credit_transactions|duel_decks|user_cards)/.test(sql));
  assert.equal((sql.match(/create table if not exists/g) ?? []).length, 2);
});

test("T125 · 0051: un intento abierto por usuario y match_id único (idempotencia en BD)", () => {
  const sql = src("supabase/migrations/0051_campaign_road_to_champions.sql");
  assert.ok(sql.includes("on public.campaign_attempts(user_id) where status = 'STARTED';"));
  assert.ok(sql.includes("match_id         uuid unique references public.duel_matches(id) on delete set null"));
});

test("T126 · mercado sigue APAGADO", () => {
  assert.equal(GLOBAL_MARKET_ENABLED, false);
});

test("T127 · cubetas de ritmo propias para la campaña, sin migración", () => {
  assert.equal(RATE_POLICY.campaign_read.limit, 60);
  assert.equal(RATE_POLICY.campaign_write.limit, 20);
  assert.equal(RATE_POLICY.season_read.limit, 30);
});

test("T128 · la ruta de campaña enmascara los 5xx y usa las cubetas", () => {
  const r = src("src/app/api/game/campaign/route.ts");
  assert.ok(r.includes('"Road to Champions no responde ahora mismo"') && r.includes('"campaign_read"') && r.includes('"campaign_write"'));
  assert.ok(r.includes("const NO_STORE = { \"cache-control\": \"no-store\" };"));
});

test("T129 · sin tienda de temporada, sobre de campaña ni cartas de campaña", () => {
  const all = ["src/data/roadToChampions.ts", "src/server/services/campaign.ts", "src/components/campaign/NodeSheet.tsx"].map(code).join("\n");
  assert.ok(!/season_shop|campaign_pack|campaignPack|campaign_card/i.test(all));
});

test("T130 · el marcador de la arena sigue resolviendo el nombre del rival igual (rivalLabel ?? dificultad)", () => {
  assert.ok(src("src/components/duel/MatchBoard.tsx").includes("const rivalName = view.rivalLabel ?? DIFFICULTY_INFO[view.difficulty].label;"));
});

test("T131 · PvpOutcome y el cierre de partida de Fase 33 no se tocan desde la campaña", () => {
  for (const f of ["src/components/campaign/CampaignResultBanner.tsx", "src/app/duelos/jugar/page.tsx"]) assert.ok(!/PvpOutcome|MatchEndHero/.test(src(f)), f);
});

test("T132 · la campaña reutiliza la experiencia de partida (MatchIntro, MatchBoard, DuelMoment, ResultScreen)", () => {
  const j = src("src/app/duelos/jugar/page.tsx");
  for (const c of ["<MatchIntro", "<MatchBoard", "<DuelMoment", "<ResultScreen", "<CampaignPreMatch", "<CampaignResultBanner"]) assert.ok(j.includes(c), c);
  assert.ok(src("src/components/campaign/CampaignPreMatch.tsx").includes("<PreMatchVersus"));
});

test("T133 · la navegación de progreso de Fase 34 sigue intacta", () => {
  // IA 2026-10-07 · la sección entra por su hub y sus tres áreas; Mi perfil/Cuenta pasan a MI CUENTA (icono y dock).
  const progreso = NAV_SECTIONS.find((s) => s.id === "progreso")!;
  assert.equal(progreso.items[0].href, "/temporada");
  assert.deepEqual(progreso.items.slice(1, 4).map((i) => i.label), ["Pase de batalla", "Objetivos", "Crafteo"]);
  assert.equal(MOBILE_NAV.find((m) => m.href === "/cuenta")?.label, "Cuenta");
});

test("T134 · «Pizarra» sale del menú pero su ruta sigue existiendo y dentro de Entrenador", () => {
  assert.ok(existsSync(join(ROOT, "src/app/entrenador/strats/page.tsx")));
  assert.equal(sectionForPath("/entrenador/strats")?.id, "jugar");
});

test("T135 · el hub no escribe: solo lee meta y campaña", () => {
  const page = code("src/app/jugar/page.tsx");
  assert.ok(page.includes("fetchMetaSnapshot()") && page.includes("fetchCampaign()"));
  assert.ok(!/startCampaignNode|syncCampaign|abandonCampaignNode|method: "POST"/.test(page));
});

test("T136 · el mapa sincroniza solo con sesión y nunca sondea", () => {
  const c = code("src/lib/campaign/client.ts");
  assert.ok(!/setInterval|setTimeout/.test(c));
  assert.ok(src("src/app/jugar/road-to-champions/page.tsx").includes("useCampaign({ sync: signedIn })"));
});

test("T137 · lecturas acotadas en el servicio (límites explícitos, sin N+1 por nodo)", () => {
  const c = src("src/server/services/campaign.ts");
  assert.ok(c.includes("const PROGRESS_LIMIT = 100;") && c.includes("const ATTEMPTS_RECENT = 5;") && c.includes("const RECONCILE_LIMIT = 5;"));
  const selects = (c.match(/\.select\(/g) ?? []).length;
  const limited = (c.match(/\.limit\(|\.maybeSingle\(\)/g) ?? []).length;
  assert.ok(limited >= selects - 2, `${limited} límites para ${selects} selects`);
});

test("T138 · la definición y los mazos rivales se calculan UNA vez por catálogo (caché)", () => {
  const c = src("src/server/services/campaign.ts");
  assert.ok(c.includes("const planCache = new WeakMap<object, Map<CampaignDefinition, Map<string, OpponentPlan>>>();"));
  assert.ok(src("src/app/api/game/campaign/route.ts").includes('const PUBLIC_SHORT = { "cache-control": "public, max-age=60, s-maxage=300" };'));
});

test("T139 · sin impacto en rating: la partida de campaña es PVE y no hay ruta a la escalera", () => {
  const svc = code("src/server/services/campaign.ts");
  assert.ok(svc.includes('.eq("mode", "PVE")'));
  assert.ok(!/rating/i.test(svc));
});

test("T140 · jugar un nodo usa la arena canónica (/duelos/jugar?campaign=)", () => {
  assert.ok(src("src/lib/campaign/presentation.ts").includes("export const campaignPlayHref = (nodeId: string) => `/duelos/jugar?campaign=${encodeURIComponent(nodeId)}`;"));
});
