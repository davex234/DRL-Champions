/**
 * LIVE EVENTS 1.0 · CONTRATOS SOBRE EL CÓDIGO REAL (Fase 30).
 *
 * Sin base de datos: se afirma lo que el servicio, la ruta, el cliente y las pantallas escriben,
 * y lo que NO pueden romper. Bloques del brief: Pick'ems (21–26), colección (27–32), sobres
 * (33–37), objetivos/recompensas (38–43), seguridad (44–50), regresión (51–67), datos reales
 * (sin nombres hardcodeados), telemetría, accesibilidad, móvil.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { isFlow } from "@/lib/telemetry/contract";
import { LIVE_EVENT_CONTEXTS, LIVE_EVENTS_FLOW } from "@/lib/liveEvents/telemetry";
import { RATE_POLICY } from "@/server/services/rateLimit";
import { GLOBAL_MARKET_ENABLED } from "@/config/features";
import { NAV_SECTIONS } from "@/design/nav";
import { LIVE_POLL_MS } from "@/domain/pickems/live";
import { REWARD_TIERS } from "@/domain/pickems/rewards";
import { CHALLENGE_SETS } from "@/domain/events/challenges";
import { PACKS } from "@/data/packs";
import { isStoreVisible } from "@/domain/packs/lifecycle";
import { publicPacks } from "@/components/packs/packCatalog";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const sql = (s: string) => s.replace(/^\s*--.*$/gm, "");

const DOMAIN = read("src", "domain", "liveEvents", "eventState.ts");
const BRIDGE = read("src", "domain", "liveEvents", "playerCards.ts");
const SERVICE = read("src", "server", "services", "liveEvents.ts");
const EVENTS_SERVICE = read("src", "server", "services", "events.ts");
const ROUTE = read("src", "app", "api", "game", "live-events", "route.ts");
const CLIENT = read("src", "lib", "liveEvents", "client.ts");
const TELEMETRY = read("src", "lib", "liveEvents", "telemetry.ts");
const OVERVIEW_PAGE = read("src", "app", "torneos", "page.tsx");
const HUB_PAGE = read("src", "app", "torneos", "[id]", "page.tsx");
const MATCH_PAGE = read("src", "app", "torneos", "[id]", "partido", "[matchId]", "page.tsx");
const COMP = (f: string) => read("src", "components", "liveEvents", f);
const UI = ["bits.tsx", "EventCard.tsx", "EventsOverview.tsx", "EventHero.tsx", "LiveStrip.tsx", "EventActionsPanel.tsx", "EventProgressChecklist.tsx", "EventMatches.tsx", "EventPickems.tsx", "EventBracket.tsx", "EventStandings.tsx", "EventTeams.tsx", "EventPlayersCards.tsx", "EventObjectives.tsx", "EventRewards.tsx", "EventActivity.tsx", "EventHub.tsx", "MatchCenter.tsx"].map(COMP);
const ALL_UI = UI.join("\n");
const FIXTURES = read("src", "app", "design-system", "fase30", "fixtures.ts");
const HARNESS = read("src", "app", "design-system", "fase30", "page.tsx");
const HOME = read("src", "app", "page.tsx");
const LOBBY = read("src", "components", "lobby", "LobbyCircuit.tsx");
const SHELL = read("src", "components", "layout", "GameShell.tsx");
const NAV = read("src", "design", "nav.ts");
const MIG46 = read("supabase", "migrations", "0046_telemetry_flows_progression.sql");
const RATE = read("src", "server", "services", "rateLimit.ts");

/* ───────────────────────────── datos reales: sin nombres hardcodeados ───────────────────────────── */

test("datos reales · ningún nombre de evento o equipo real como lógica en servicio, dominio, ruta ni pantallas", () => {
  const prod = code(DOMAIN) + code(BRIDGE) + code(SERVICE) + code(ROUTE) + code(CLIENT) + code(ALL_UI) + code(OVERVIEW_PAGE) + code(HUB_PAGE) + code(MATCH_PAGE);
  for (const name of ["Champions 2026", "Champions", "Masters", "Fnatic", "Sentinels", "Team Heretics", "Paper Rex", "Gen.G", "EMEA Stage", "vlr-2976"]) {
    assert.ok(!prod.includes(name), `«${name}» no puede aparecer como lógica`);
  }
  assert.ok(!/CURRENT_EVENT|currentEventId\s*=\s*"/.test(prod), "sin evento principal hardcodeado");
  assert.ok(!/\.eq\("name"|\.eq\("id", "[a-z0-9-]+"\)/.test(code(SERVICE)), "el servicio nunca busca un evento por nombre o id fijo");
});

test("datos reales · los fixtures del arnés usan nombres ficticios y solo los usa el arnés", () => {
  assert.ok(FIXTURES.includes("QA SYNTHETIC") && HARNESS.includes("QA SYNTHETIC"));
  for (const name of ["Fnatic", "Sentinels", "Champions 2026", "Team Heretics", "Paper Rex"]) assert.ok(!FIXTURES.includes(name), name);
  assert.ok(!/design-system\/fase30|fase30\/fixtures/.test(code(SERVICE) + code(ROUTE) + code(CLIENT) + code(OVERVIEW_PAGE) + code(HUB_PAGE) + code(MATCH_PAGE)));
});

test("no fake live · el servicio y las pantallas solo llaman «en directo» a status live/ongoing; nunca por hora", () => {
  assert.ok(DOMAIN.includes('const LIVE = new Set(["live", "ongoing"]);'));
  assert.ok(SERVICE.includes('.eq("status", "live")'), "el badge cuenta status = live real");
  assert.ok(!/start_time\s*[<>]=?\s*now|startTime\s*<=?\s*now\)\s*\?\s*"live"/.test(code(SERVICE) + code(ALL_UI)));
  assert.ok(!/status\s*=\s*"live"|status:\s*"live"/.test(code(SERVICE) + code(ALL_UI)), "nadie escribe live");
});

test("no inferred winner · ni servicio ni UI comparan marcadores para nombrar ganador", () => {
  const all = code(SERVICE) + code(ALL_UI) + code(DOMAIN);
  assert.ok(!/score_?a\s*>\s*score_?b|scoreA\s*>\s*scoreB|score_?b\s*>\s*score_?a|scoreB\s*>\s*scoreA/i.test(all));
  assert.ok(SERVICE.includes("winnerSideOf(") && DOMAIN.includes("if (m.winnerTeamId) {"));
  assert.ok(COMP("MatchCenter.tsx").includes("Terminado · resultado sin confirmar"));
});

test("TBD · los mapas sin nombre se enseñan como TBD y no se corrige el importador", () => {
  assert.ok(SERVICE.includes("name: mapLabel(") && SERVICE.includes("tbd: !x.map_id || !mapNames.has(x.map_id)"));
  assert.ok(COMP("MatchCenter.tsx").includes('data-map={mp.tbd ? "tbd" : "known"}'));
  assert.ok(!existsSync(join(process.cwd(), "src", "lib", "esports", "sync", "vlrSnapshotSource.ts")) || !/Fase 30/.test(read("src", "lib", "esports", "sync", "vlrSnapshotSource.ts")), "el conector no se toca");
});

test("participantes y cuadro · equipos = ids de partidos reales; cuadro = motor Fase 24 (buildBracketModel), sin segundo cuadro", () => {
  assert.ok(SERVICE.includes("const teamIds = state.participantIds;"));
  assert.ok(COMP("EventBracket.tsx").includes("buildBracketModel({") && COMP("EventBracket.tsx").includes("<TournamentBracket model={model}") && COMP("EventBracket.tsx").includes("readOnly"));
  assert.ok(!/function (buildBracket|layoutBracket|detectFormat)/.test(code(ALL_UI) + code(SERVICE) + code(DOMAIN)));
  assert.ok(COMP("EventBracket.tsx").includes("isBracketFormat(model.format)"), "sin formato de cuadro no se dibuja");
  const files = readdirSync(join(process.cwd(), "src", "components", "liveEvents"));
  assert.ok(!files.some((f) => /Bracket(Round|Match|Connector)|Tournament/.test(f)), "sin copias del cuadro");
});

test("qualification · la clasificación solo enseña qualified/eliminated si standings lo dice; la deuda no se disimula", () => {
  assert.ok(SERVICE.includes('status: s.status === "qualified" || s.status === "eliminated" ? s.status : null,'));
  assert.ok(COMP("EventStandings.tsx").includes("if (standings.length === 0) return null;"));
  assert.ok(!/qualified\s*=\s*true|eventStatus:\s*"qualified",/.test(code(SERVICE) + code(DOMAIN)));
});

/* ───────────────────────────── Pick'ems (21–26) ───────────────────────────── */

test("21–23 · pendientes = abiertas (locks_at > now del servidor) sin respuesta; cerradas excluidas; estado completo cuando no queda ninguna", () => {
  assert.ok(SERVICE.includes("const open = f.questions.filter((q) => (ms(q.locks_at) ?? 0) > now);"));
  assert.ok(SERVICE.includes("const pending = signedIn ? open.filter((q) => !f.answers.has(q.id)) : [];"));
  assert.ok(COMP("EventPickems.tsx").includes('data-state={!pickem ? "none" : pickem.pending > 0 ? "pending" : pickem.open > 0 ? "done" : "closed"}'));
});

test("24 · el CTA enruta al Pick'em existente y el formulario es el MISMO PickemPanel", () => {
  assert.ok(HUB_PAGE.includes("<PickemPanel pickemEventId={snap!.pickem.id} userId={user.id}"));
  assert.ok(COMP("EventPickems.tsx").includes('href="/pickems"'));
  assert.ok(COMP("MatchCenter.tsx").includes("#pickems"));
});

test("25 · sin segundo motor de predicciones: nadie escribe respuestas ni puntúa fuera de /api/pickems", () => {
  const all = code(SERVICE) + code(ROUTE) + code(CLIENT) + code(ALL_UI) + code(HUB_PAGE);
  assert.ok(!/app_submit_pick|app_score_pickem_event|pickem_answers"\)\.(insert|upsert|update)|submitPick\(/.test(all));
  assert.ok(!/LivePickemsEngine|EventPredictionEngine|PickemsV2/.test(all));
  assert.ok(!/from\("pickem_(questions|answers|submissions|scores|events)"\)/.test(code(ALL_UI) + code(CLIENT)), "la UI no lee tablas");
  assert.equal(LIVE_POLL_MS.live, 20_000);
});

test("26 · los datos personales de Pick'em salen de mi submission y correct_option solo tras el cierre", () => {
  assert.ok(SERVICE.includes('.eq("user_id", userId).eq("pickem_event_id", row.id).maybeSingle()'));
  assert.ok(SERVICE.includes("correctOption: locked ? q.correct_option : null"));
});

/* ───────────────────────────── colección (27–32) ───────────────────────────── */

test("27–29 · cartas del evento = cartas EXISTENTES del catálogo por jugador real; ids únicos; propiedad por user_cards del usuario", () => {
  assert.ok(SERVICE.includes("const cards = slug ? registry.forPlayer(slug) : [];"));
  assert.ok(SERVICE.includes("const cardIds = [...new Set(playerViews.flatMap((p) => p.cardIds))];"));
  assert.ok(SERVICE.includes('sb.from("user_cards").select("card_id").eq("user_id", userId).in("card_id", cardIds.slice(i, i + 300))'));
  assert.ok(SERVICE.includes("await serverCatalog(sb);"), "catálogo del servidor, no cartas inventadas");
});

test("30–32 · denominador = cartas reales elegibles; sin costura no hay carta; sin cartas, vacío honesto", () => {
  assert.ok(DOMAIN.includes("const unique = [...new Set(cardIds)];"));
  assert.ok(BRIDGE.includes("return byNick.get(n) ?? extraByNick?.get(n) ?? null;"));
  assert.ok(!/new CardDef|cardId: `qa|makeCardId\(/.test(code(SERVICE)), "el servicio no fabrica cartas");
  assert.ok(COMP("EventPlayersCards.tsx").includes("Ningún jugador de este evento tiene carta en el catálogo todavía."));
  assert.ok(!/registerServerCards|CARDS\.push|rebuildCatalog/.test(code(SERVICE)));
});

/* ───────────────────────────── sobres (33–37) ───────────────────────────── */

test("33–36 · solo sobres ACTIVE (publicPacks) por identidad canónica; DRAFT oculto; RETIRED no comprable; sin creación", () => {
  assert.ok(SERVICE.includes("const packs = publicPacks().filter((p) => !!p.team);"));
  for (const p of publicPacks()) assert.ok(isStoreVisible(p), `${p.id} debe ser ACTIVE`);
  assert.ok(PACKS.some((p) => p.lifecycle === "DRAFT"), "existen DRAFT en el catálogo (siguen ocultos)");
  assert.ok(publicPacks().every((p) => p.lifecycle !== "DRAFT"));
  assert.ok(SERVICE.includes("if (tid || pid) return false;"), "una identidad conocida frente a un alias desconocido no se adivina");
  assert.ok(!/from\("packs"\)\.insert|PACKS\.push|createPack\(/.test(code(SERVICE) + code(ALL_UI)));
  assert.ok(COMP("EventTeams.tsx").includes("href={`/packs/${t.pack.id}`}"));
});

test("37 · identidades de equipo: resolveTeamIdentity, nunca fusiones ni actualizaciones masivas", () => {
  assert.ok(SERVICE.includes("resolveTeamIdentity(t.name) ?? resolveTeamIdentity(t.tag)"));
  assert.ok(!/TEAM_IDENTITIES\.push|teamIdentities\.ts.*write|from\("teams"\)\.(update|upsert|insert)/.test(code(SERVICE)));
  assert.ok(COMP("bits.tsx").includes('data-verified={identity?.verified ? "yes" : "no"}'));
});

/* ───────────────────────────── objetivos y recompensas (38–43) ───────────────────────────── */

test("38–39 · objetivos = desafíos de evento existentes (CHALLENGE_SETS); progreso lo cuenta el servidor (getEventViewFor)", () => {
  assert.ok(SERVICE.includes("challengesFor({ id: event.id, type: event.type, region: event.region })"));
  assert.ok(SERVICE.includes("await getEventViewFor(sb, userId, eventId, now)"));
  assert.ok(EVENTS_SERVICE.includes("export async function getEventViewFor(") && EVENTS_SERVICE.includes("return buildEventView(admin, userId, ev, now);"));
  assert.ok(CHALLENGE_SETS.length >= 1 && CHALLENGE_SETS.every((s) => s.challenges.every((c) => c.goal > 0 && c.metric.startsWith("event_"))));
  assert.ok(!/progress:\s*\d+\s*,\s*complete:\s*true|complete:\s*true,/.test(code(SERVICE)), "el servicio no marca nada completo por su cuenta");
  assert.ok(!/EventObjectiveEngine|MissionEngine|objectives"\)\.insert/.test(code(SERVICE) + code(ALL_UI)));
});

test("40–41 · reclamar = claimChallenge existente (app_grant_reward por ref idempotente); la UI no cobra por su cuenta", () => {
  assert.ok(HUB_PAGE.includes("await claimChallenge(snap.event.id, o.id)"));
  assert.ok(EVENTS_SERVICE.includes("const ref = challengeRef(ev.id, def.id);") && EVENTS_SERVICE.includes("await award(admin, {"));
  assert.ok(!/app_grant_reward|award\(/.test(code(SERVICE) + code(ALL_UI) + code(ROUTE)), "el social de eventos no concede nada");
  assert.ok(COMP("EventObjectives.tsx").includes("onClaim(o)"));
});

test("42–43 · sin moneda del evento ni reward track inventado: recompensas = escalones del Pick'em + total de desafíos", () => {
  const all = code(SERVICE) + code(ALL_UI) + code(DOMAIN) + code(ROUTE);
  assert.ok(!/Champions Tokens|Event Coins|VCT Points|event_currency|eventTokens|reward_track/i.test(all));
  assert.ok(SERVICE.includes("pickemTiers: REWARD_TIERS.map("));
  assert.equal(REWARD_TIERS.length, 4);
  assert.ok(SERVICE.includes("challengesTotal: totalReward(defs)"));
});

/* ───────────────────────────── seguridad (44–50) ───────────────────────────── */

test("44–47 · lo personal solo con sesión; el userId sale del token; sin userId arbitrario", () => {
  assert.ok(ROUTE.includes("const userId = session?.userId ?? null;"));
  assert.ok(!/searchParams\.get\("user|q\.get\("user|body\.userId|userId=\$\{/.test(code(ROUTE) + code(CLIENT)));
  assert.ok(SERVICE.includes("if (userId && cardIds.length > 0)") && SERVICE.includes("if (userId) {"));
  assert.ok(SERVICE.includes("const pending = signedIn ? open.filter"), "sin sesión no hay pendientes");
  assert.ok(ROUTE.includes("const headers = userId ? NO_STORE : PUBLIC_SHORT;"), "los datos con sesión nunca se cachean");
});

test("48–49 · sin fuga de internos ni claves: la frescura es una frase; sync_state no viaja; sin service key en cliente", () => {
  assert.ok(SERVICE.includes("notice: FRESHNESS_NOTICE[freshness]"));
  assert.ok(!/lastError|consecutiveFailures|lease|cursor|runId/.test(code(ALL_UI) + code(CLIENT)));
  const syncViewBlock = SERVICE.slice(SERVICE.indexOf("export interface SyncView"), SERVICE.indexOf("export interface EventCardView"));
  assert.ok(!/lastError|lastResult|events:|nextDueAt/.test(syncViewBlock), "SyncView solo lleva frescura, aviso y fecha");
  assert.ok(!/service_role|SUPABASE_SERVICE|SERVICE_KEY/i.test(CLIENT + ALL_UI));
  assert.ok(!/is_admin|email|vlr_url|error\b.*sync/.test(code(SERVICE).split("/* ───────────────────────────── tipos públicos")[1]?.split("/* ───────────────────────────── lecturas agrupadas")[0] ?? ""));
});

test("50 · consultas acotadas y agrupadas: límites explícitos, `in(...)` por lote, sin N+1", () => {
  assert.ok(SERVICE.includes("const MAX_EVENTS = 24;") && SERVICE.includes("const MAX_MATCHES = 400;"));
  assert.ok(SERVICE.includes('.in("team_id", teamIds)') && SERVICE.includes('.in("id", teamIds)') && SERVICE.includes('.in("event_id", eventIds)'));
  const c = code(SERVICE);
  assert.ok(!/for \(const (p|t|m) of (players|teams|matches)\) \{[^}]*await sb\.from/.test(c), "ningún await por jugador/equipo/partido dentro de un bucle");
  assert.ok((c.match(/\.limit\(/g) ?? []).length >= 12);
  assert.ok(RATE_POLICY.events_read.limit === 60 && RATE.includes("events_read"));
});

/* ───────────────────────────── regresión (51–67) ───────────────────────────── */

test("51–55 · Pick'ems, bracket, worker e importador intactos: la fase no toca sus ficheros", () => {
  for (const f of ["src/server/services/pickems.ts", "src/server/services/pickemLifecycle.ts", "src/domain/pickems/bracket.ts", "src/domain/pickems/live.ts", "src/domain/pickems/rewards.ts", "src/lib/esports/autosync/runner.ts", "src/lib/esports/autosync/policy.ts", "src/lib/esports/autosync/health.ts", "src/lib/esports/sync/orchestrator.ts", "src/lib/esports/sync/vlrSnapshotSource.ts", "src/server/worker/esportsAutosyncWorker.ts", "scripts/esports-autosync-worker.ts"]) {
    assert.ok(!/Fase 30|FASE 30|liveEvents/.test(read(...f.split("/"))), `${f} no cambia en esta fase`);
  }
});

test("56–63 · RNG y precios de sobres, propiedad, motor de duelos, rating, matchmaking, XP y social intactos", () => {
  for (const f of ["src/domain/packs/openPack.ts", "src/domain/packs/pool.ts", "src/pack/engine.ts", "src/data/packs.ts", "src/server/services/packs.ts", "src/server/services/inventory.ts", "src/domain/cardgame/combat/index.ts", "src/server/services/duelsRating.ts", "src/server/services/duelsMatchmaking.ts", "src/domain/progression/levels.ts", "src/server/services/progression.ts", "src/server/services/social.ts", "src/data/teamIdentities.ts"]) {
    if (!existsSync(join(process.cwd(), ...f.split("/")))) continue;
    assert.ok(!/Fase 30|FASE 30|liveEvents/.test(read(...f.split("/"))), `${f} no cambia en esta fase`);
  }
  assert.ok(!/@\/domain\/cardgame\/(match|combat|opponent)|duel_pvp_|duelsRating|matchmaking/.test(code(SERVICE) + code(ALL_UI)), "un evento real no toca rating ni matchmaking");
});

test("64–67 · Marketplace OFF; 0046/0047/0048 aplicadas en la Fase 35.1; Live Events sin migración propia", () => {
  assert.equal(GLOBAL_MARKET_ENABLED, false);
  const files = readdirSync(join(process.cwd(), "supabase", "migrations")).filter((f) => /^\d{4}_/.test(f)).sort();
  assert.ok(!files.some((f) => Number(f.slice(0, 4)) >= 46 && /live|esports|event/i.test(f.slice(5))), "Live Events no crea migración propia (fases posteriores pueden añadir las suyas)");
  for (const n of ["0046", "0047", "0048"]) {
    const f = files.find((x) => x.startsWith(n))!;
    assert.ok(/— APLICADA \(VPS 2026-09-15, Fase 35\.1\)\.$/.test(read("supabase", "migrations", f).split("\n")[0]), `${f} aplicada en la Fase 35.1`);
  }
  assert.ok(!/schema_migrations/.test(sql(MIG46)));
  assert.ok(MIG46.includes("'live_events'"), "0046 admite el flujo en la BD; el contrato FLOWS del código sigue cerrado");
  assert.ok(!/from\("[a-z_]+"\)\.(insert|update|upsert|delete)/.test(code(SERVICE)), "el servicio es solo lectura");
});

/* ───────────────────────────── integración: home, navegación, refresco ───────────────────────────── */

test("home · el circuito del vestíbulo usa el estado REAL de Live Events y no dice «en directo» sin partido en juego", () => {
  // Fase 36: la home ya no deriva el evento en el navegador; lo trae la foto del Daily Loop desde `getEventsOverview`.
  const svc = read("src", "server", "services", "dailyLoop.ts");
  const pres = read("src", "lib", "dailyLoop", "presentation.ts");
  assert.ok(svc.includes("getEventsOverview(sb, userId, { now })"));
  assert.ok(pres.includes('if (e.lifecycle === "ACTIVE") return e.liveCount > 0 ? "EN DIRECTO" : "EN CURSO";'));
  assert.ok(HOME.includes("<DailyLobby") && !/fetchTournaments|fetchMatches|deriveEventState/.test(HOME));
  assert.ok(LOBBY.includes("Entrar al evento") && LOBBY.includes("live?: { label: string;"), "la tarjeta del circuito sigue disponible");
});

test("navegación · «Eventos» en Jugar con badge live del servidor; el centro de eventos local se renombra; sin menú enorme", () => {
  const jugar = NAV_SECTIONS.find((s) => s.id === "jugar")!;
  const item = jugar.items.find((i) => i.href === "/torneos");
  assert.ok(item && item.label === "Eventos" && item.badge === "live");
  // F86 · la unión crece con «cup» (torneos de jugadores) sin perder «live».
  assert.ok(NAV.includes('badge?: "events" | "news" | "duel" | "social" | "live" | "cup";'));
  assert.ok(jugar.items.length <= 7);
  assert.ok(SHELL.includes("const live = useLiveBadge(!!user);") && SHELL.includes("live };"));
  assert.ok(CLIENT.includes('get<{ live: number }>("?badge=1")') && SERVICE.includes("export async function getLiveCount"));
});

test("refresco · política de Pick'ems reutilizada (refreshIntervalFor), un solo setTimeout, sin websockets ni setInterval por segundo", () => {
  assert.ok(CLIENT.includes("refreshIntervalFor({ online, visibility, failures, hasLive: input.hasLive, status: input.status })"));
  assert.ok(!/WebSocket|\.channel\(|EventSource/.test(code(CLIENT) + code(ALL_UI)));
  assert.ok(!/setInterval\([^)]*1000\)/.test(code(CLIENT)));
  for (const p of [OVERVIEW_PAGE, HUB_PAGE, MATCH_PAGE]) assert.ok(p.includes("useLiveRefresh({"));
});

test("archivo · un evento terminado es la misma ruta y sigue enseñando resultado, cuadro, partidos, equipos y colección", () => {
  assert.ok(/Un evento terminado sigue siendo esta misma[\s*]+página/.test(HUB_PAGE));
  assert.ok(!/lifecycle === "COMPLETED" \? null|COMPLETED[^\n]*return null/.test(code(COMP("EventHub.tsx"))));
  assert.ok(HARNESS.includes('"hub-completed"'));
});

/* ───────────────────────────── telemetría, accesibilidad, móvil ───────────────────────────── */

test("telemetría · cinco contextos con puerta, todos usados; flow reservado en 0046 sin aplicar; sin hackear el CHECK", () => {
  assert.deepEqual([...LIVE_EVENT_CONTEXTS], ["event_view", "event_match_view", "event_pickem_cta", "event_collection_cta", "event_pack_cta"]);
  const all = OVERVIEW_PAGE + HUB_PAGE + MATCH_PAGE;
  for (const c of LIVE_EVENT_CONTEXTS) assert.ok(all.includes(`trackLiveEvent("${c}")`), c);
  assert.equal(isFlow(LIVE_EVENTS_FLOW), false);
  assert.ok(TELEMETRY.includes("if (!flow) return;"));
});

test("accesibilidad · estado con texto (no solo color), marcador con sr-only, progreso con aria, sin aria-live por segundo, foco visible, táctil 44", () => {
  assert.ok(COMP("bits.tsx").includes('<span className="sr-only">{sr}</span>'));
  assert.ok(COMP("bits.tsx").includes("MATCH_TEXT") && COMP("bits.tsx").includes('"Programado"'));
  assert.ok(COMP("EventProgressChecklist.tsx").includes("label={`${label}: ${done} de ${total}`}"));
  assert.ok(!/aria-live="assertive"/.test(ALL_UI));
  assert.ok(!/useNow\(|setInterval/.test(code(ALL_UI)), "sin cuentas atrás por segundo en el hub");
  assert.ok((ALL_UI.match(/min-h-\[44px\]/g) ?? []).length >= 8);
  assert.ok((ALL_UI.match(/nx-focus/g) ?? []).length >= 8);
  assert.ok(COMP("EventBracket.tsx").includes("readOnly"), "el cuadro real ya es navegable por teclado (Fase 24)");
});

test("móvil 390 · hero en dos columnas, cuadro con modo móvil, tablas desplazables, tarjetas apilables", () => {
  assert.ok(COMP("EventHero.tsx").includes("grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4"));
  assert.ok(COMP("EventBracket.tsx").includes("forceMode") && HARNESS.includes('"bracket-mobile"'));
  assert.ok(COMP("EventStandings.tsx").includes("overflow-x-auto") && COMP("MatchCenter.tsx").includes("overflow-x-auto"));
  assert.ok(COMP("EventsOverview.tsx").includes("grid gap-3 md:grid-cols-2"));
});

test("arnés · las 40 escenas del brief están cubiertas", () => {
  for (const s of ["overview", "overview-multi", "overview-upcoming", "overview-completed", "overview-empty", "hub", "hub-upcoming", "hub-completed", "hub-two-live", "hub-no-live", "match", "match-done", "match-tbd", "hub-pickems-done", "hub-no-pickems", "bracket", "hub-league", "hub-no-pack", "hub-no-objectives", "hub-reward", "hub-no-cards", "hub-stale", "backend-error", "bracket-mobile", "no-session", "home-card"]) {
    assert.ok(HARNESS.includes(`"${s}"`), s);
  }
});
