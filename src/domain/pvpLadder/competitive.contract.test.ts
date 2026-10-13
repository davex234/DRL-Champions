/**
 * COMPETITIVO / RANKED 2.0 · CONTRATOS SOBRE EL CÓDIGO REAL (Fase 28).
 *
 * Sin base de datos: se afirma lo que el servicio, la ruta, el cliente y las pantallas escriben, y lo
 * que NO pueden romper. Bloques: seguridad (36–43), post-partida (30–35), privacidad, integraciones,
 * regresión (44–55), telemetría, accesibilidad.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CURRENT_SEASON } from "@/data/season";
import { INITIAL_RATING, PLACEMENT_GAMES, K_PROVISIONAL, K_ESTABLISHED, MIN_RATING, MAX_RATING, RATING_WINDOW_STEPS } from "@/domain/cardgame/rating";
import { EVENT_NAMES, FLOWS, isFlow } from "@/lib/telemetry/contract";
import { COMPETITIVE_CONTEXTS, COMPETITIVE_FLOW } from "@/lib/competitive/telemetry";
import { LIMITS } from "./ladder";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const SERVICE = read("src", "server", "services", "competitive.ts");
const ROUTE = read("src", "app", "api", "game", "competitive", "route.ts");
const CLIENT = read("src", "lib", "competitive", "client.ts");
const RATING_SERVICE = read("src", "server", "services", "duelsRating.ts");
const PVP_SERVICE = read("src", "server", "services", "duelsPvp.ts");
const MM_SERVICE = read("src", "server", "services", "duelsMatchmaking.ts");
const MIG33 = read("supabase", "migrations", "0033_pvp_rating.sql");
const MIG35 = read("supabase", "migrations", "0035_pvp_turn_timeout.sql");
const MIG47 = read("supabase", "migrations", "0047_pvp_ladder_indexes.sql");
const MIG46 = read("supabase", "migrations", "0046_telemetry_flows_progression.sql");
const HUB_PAGE = read("src", "app", "duelos", "competitivo", "page.tsx");
const HUB = read("src", "components", "competitive", "CompetitiveHub.tsx");
const HERO = read("src", "components", "competitive", "CompetitiveHero.tsx");
const BOARD = read("src", "components", "competitive", "Leaderboard.tsx");
const HISTORY = read("src", "components", "competitive", "MatchHistoryList.tsx");
const DETAIL = read("src", "components", "competitive", "MatchDetailView.tsx");
const PROFILE = read("src", "components", "competitive", "PlayerProfile.tsx");
const CHART = read("src", "components", "competitive", "RatingChart.tsx");
const REWARDS = read("src", "components", "competitive", "CompetitiveRewards.tsx");
const PVP_PAGE = read("src", "app", "duelos", "pvp", "page.tsx");
const PVP_OUTCOME = read("src", "components", "duel", "pvp", "PvpOutcome.tsx");
const PVP_LOBBY = read("src", "components", "duel", "pvp", "PvpLobby.tsx");
const DUELOS = read("src", "app", "duelos", "page.tsx");
const HOME = read("src", "app", "page.tsx");
const META_HUB = read("src", "components", "progression", "MetaHub.tsx");
const CUENTA = read("src", "app", "cuenta", "page.tsx");
const LOOP = read("src", "server", "services", "loop.ts");
const FEATURES = read("src", "config", "features.ts");
const UI = [HUB_PAGE, HUB, HERO, BOARD, HISTORY, DETAIL, PROFILE, CHART, REWARDS, read("src", "components", "competitive", "RecentForm.tsx"), read("src", "components", "competitive", "CardPerformanceCard.tsx"), read("src", "components", "competitive", "CompetitiveSummary.tsx")];

/* ═══════════════════ seguridad (36–43) ═══════════════════ */

test("36+37 · el cliente no puede fijar rating ni posición: la ruta es solo GET y el servicio no escribe", () => {
  assert.ok(/export async function GET/.test(ROUTE) && !/export async function (POST|PUT|PATCH|DELETE)/.test(ROUTE));
  assert.ok(!/\.rpc\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(/.test(code(SERVICE).replace(/ensureRating\(/g, "")), "el servicio no escribe (ensureRating crea la ficha vacía a 1000 si no existe: es la RPC de siempre)");
  assert.ok(!/\bsetRating\b|\bset_rating\b|\bp_rating\b/.test(SERVICE + ROUTE + CLIENT));
  assert.ok(!/\.from\("duel_pvp_ratings"\)\.(update|insert|upsert)/.test(SERVICE));
});

test("38 · un id de usuario arbitrario solo devuelve campos públicos: username y avatar, nada más del perfil", () => {
  const selects = [...SERVICE.matchAll(/from\("profiles"\)\.select\("([^"]+)"\)/g)].map((m) => m[1]);
  assert.ok(selects.length >= 2);
  for (const s of selects) assert.ok(["id, username, avatar", "id"].includes(s), s);
  assert.ok(!/\bemail\b|\bcredits\b|\bxp\b|\bis_admin\b|\bdeck_id\b|\bdeck_b_id\b/.test(code(SERVICE)), "sin correo, créditos, XP ni mazos");
});

test("39 · IDOR sobre una partida: solo sus dos jugadores (404, nunca 403); en curso 409", () => {
  assert.ok(SERVICE.includes('if (!side) return fail(404, "Partida no encontrada", "NOT_A_PLAYER");'));
  assert.ok(SERVICE.includes('if (!r || r.mode !== "PVP") return fail(404, "Partida no encontrada", "NOT_PVP");'));
  assert.ok(SERVICE.includes('return fail(409, "La partida no ha terminado", "NOT_FINISHED");'));
  assert.ok(ROUTE.includes("if (!UUID.test(id)) return NextResponse.json({ error: \"Partida no válida\" }"));
});

test("40 · sin filtrar el mazo oculto: el detalle se proyecta con `projectMatchFor` y las tarjetas no muestran mazos", () => {
  // F72.2 · misma proyección, ahora con el resolvedor visual de pistas (país del catálogo del servidor).
  assert.ok(SERVICE.includes("const projected = projectMatchFor(r.state, side, (pid) => serverCatalogSync().registry.player(pid)?.country ?? \"\", visualHintValue);"));
  assert.ok(SERVICE.includes("buildMatchView(projected, { side"));
  assert.ok(!/snapshotB|snapshotA|deck_b_id|deckId/.test(code(SERVICE).replace(/const projected = projectMatchFor/g, "")), "el servicio no toca snapshots crudos");
  assert.ok(!/deck|mazo actual/i.test(code(PROFILE).replace(/nunca el mazo de otro jugador/g, "")), "el perfil no enseña mazos");
  assert.ok(SERVICE.includes("const mine = side === \"A\" ? t.encounter.a : t.encounter.b;"), "las cartas solo del propio bando");
});

test("41 · sin clave de servicio en cliente; lecturas con Bearer del usuario", () => {
  assert.ok(!/SERVICE_ROLE|service_role|supabaseAdmin/.test(CLIENT));
  assert.ok(CLIENT.includes("headers: { authorization: `Bearer ${token}` }"));
  assert.ok(ROUTE.includes("const session = await getSession(req);"));
});

test("42+43 · límites acotados: top ≤ 50, alrededor 3+3, historial ≤ 20, serie 20", () => {
  assert.deepEqual(LIMITS, { top: 25, topMax: 50, around: 3, history: 10, historyMax: 20, ratingHistory: 20 });
  assert.ok(SERVICE.includes("clampLimit(opts.top, LIMITS.top, LIMITS.topMax)"));
  assert.ok(SERVICE.includes("clampLimit(opts.limit, LIMITS.history, LIMITS.historyMax)"));
  assert.ok(SERVICE.includes(".limit(50)"), "el cara a cara se acota");
  assert.ok(!/select\("\*"\)/.test(SERVICE), "sin SELECT *");
  assert.ok(!/\.from\("profiles"\)\.select\("[^"]*"\)(?!\.in\(|\.eq\()/.test(SERVICE), "perfiles siempre por lista de ids o por id: sin N+1");
});

/* ═══════════════════ post-partida (30–35) ═══════════════════ */

test("30+31 · el rating del post-partida es el asiento de la liquidación (old → delta → new), leído con outcome=1", () => {
  assert.ok(PVP_PAGE.includes("outcome=1"));
  assert.ok(PVP_OUTCOME.includes("{outcome.oldRating}") && PVP_OUTCOME.includes("{outcome.newRating}") && PVP_OUTCOME.includes("{outcome.delta}"));
  assert.ok(!/newRating\s*-\s*oldRating/.test(code(PVP_OUTCOME) + code(PVP_PAGE)));
  assert.ok(/new_rating = old_rating \+ delta/.test(MIG33), "la BD exige que el asiento cuadre");
});

test("32+33 · posición actual siempre; cambio de puestos SOLO con foto antes y después", () => {
  assert.ok(PVP_PAGE.includes("void beginLadder();") && PVP_PAGE.includes("void endLadder();"));
  assert.ok(PVP_PAGE.includes("if (!terminal || !matchId || !outcome.event || liquidada.current === matchId) return;"), "la foto «después» espera al asiento");
  assert.ok(CLIENT.includes("positions: positionDelta(before.current?.position ?? null, after.position)"));
  assert.ok(PVP_OUTCOME.includes('{ladder.after.position != null ? `#${ladder.after.position}` : tr("Sin clasificar")}'));
  assert.ok(!/#0\b/.test(code(PVP_OUTCOME) + code(HERO) + code(BOARD)), "nunca #0");
});

test("34+35 · una liquidación: idempotencia en BD y ninguna liquidación desde el cliente ni desde el competitivo", () => {
  assert.ok(/on conflict \(match_id, user_id\) do nothing/.test(MIG35) && /if inserted <> 2 then/.test(MIG35));
  assert.ok(/create unique index if not exists duel_pvp_rating_events_once/.test(MIG33));
  assert.ok(!/settleMatch|duel_pvp_settle_match/.test(code(SERVICE) + code(CLIENT) + code(PVP_PAGE) + code(PVP_OUTCOME)));
  assert.ok(PVP_SERVICE.includes("settleTerminalMatch"), "la liquidación sigue donde estaba: en el servicio PvP");
});

/* ═══════════════════ escalera, empates, provisional, sin tiers ═══════════════════ */

test("orden documentado y el MISMO en SQL y en dominio; posición por recuento acotado", () => {
  assert.ok(SERVICE.includes('.order("rating", { ascending: false }).order("updated_at", { ascending: true }).order("user_id", { ascending: true })'));
  assert.ok(SERVICE.includes('base().gt("rating", self.rating)') && SERVICE.includes('.eq("rating", self.rating).lt("updated_at", self.updated_at)'));
  // F84 · la escalera es la CLASIFICACIÓN de la temporada competitiva (vista `competitive_ladder`: colocación + mínimo + actividad),
  // con el MISMO orden y los mismos recuentos acotados; antes era «quien ha jugado al menos una» (`games_played >= 1`).
  assert.ok(SERVICE.includes('from("competitive_ladder")') && SERVICE.includes('.eq("season_id", seasonId)'), "la escalera es la clasificación de la temporada");
  assert.ok(MIG47.includes("rating desc, updated_at asc, user_id asc") && MIG47.includes("— APLICADA (VPS 2026-09-15, Fase 35.1)."));
});

test("provisional real (< 10 partidas, K 40/24) y sin tiers inventados", () => {
  assert.equal(PLACEMENT_GAMES, 10); assert.equal(K_PROVISIONAL, 40); assert.equal(K_ESTABLISHED, 24);
  assert.ok(HERO.includes("Provisional · {r.gamesPlayed} / {self.placementGames} partidas"));
  for (const src of UI) assert.ok(!/\b(Bronze|Silver|Gold|Platinum|Diamond|Immortal|Radiant|División)\b/.test(code(src)), "sin tiers inventados");
  assert.ok(!/RankBadge|RankEmblem|rankProgress/.test(UI.join("\n")), "los tiers por puntos de Pick'ems no se mezclan con el rating");
});

test("sin temporada inventada y sin recompensas nuevas: solo el carril competitivo real (26.000 + 6 sobres, Oro = 400)", () => {
  const comp = CURRENT_SEASON.competitive ?? {};
  let credits = 0, packs = 0;
  for (const r of Object.values(comp)) { credits += r.credits ?? 0; packs += r.packCount ?? 0; }
  assert.equal(credits, 26_000); assert.equal(packs, 6);
  assert.equal(CURRENT_SEASON.competitiveMinPoints, 400);
  assert.ok(SERVICE.includes("levels: rewardsView?.tracks.competitive ?? []"));
  assert.ok(!/season|temporada/i.test(code(HUB) + code(HERO)), "el hub no inventa temporada");
  assert.ok(REWARDS.includes("el rating PvP no da recompensas"));
});

/* ═══════════════════ historial, detalle, perfil ═══════════════════ */

test("historial: ambos bandos, solo terminadas, más reciente primero, cursor por updated_at", () => {
  assert.ok(SERVICE.includes(".or(`user_id.eq.${userId},player_b_id.eq.${userId}`)"));
  assert.ok(SERVICE.includes('.or("status.in.(COMPLETED,DRAW,UNRESOLVED),closed_reason.not.is.null")'));
  assert.ok(SERVICE.includes('.order("updated_at", { ascending: false })'));
  assert.ok(SERVICE.includes('q = q.lt("updated_at", new Date(before).toISOString())'));
  assert.ok(HISTORY.includes("Cargar más"));
});

test("abandono/tiempo se nombran; en curso no es derrota", () => {
  assert.ok(HISTORY.includes("OUTCOME_LABEL[m.outcome]"));
  assert.ok(DETAIL.includes('detail.lifecycle === "ABANDONED" ? t("Abandono") : t("Tiempo agotado")'));
});

test("perfil de rival: cara a cara solo entre los dos y desde mi perspectiva", () => {
  assert.ok(SERVICE.includes("and(user_id.eq.${viewerId},player_b_id.eq.${playerId}),and(user_id.eq.${playerId},player_b_id.eq.${viewerId})"));
  assert.ok(SERVICE.includes("headToHead(f, viewerId, playerId)"));
  assert.ok(PROFILE.includes("Cara a cara contigo"));
});

test("evolución: asientos reales, nada reconstruido; SVG sin librería, con resumen textual", () => {
  assert.ok(SERVICE.includes("ratingSeries(history.ok && history.data ? history.data : [])"));
  assert.ok(!/recharts|chart\.js|d3/.test(CHART));
  assert.ok(CHART.includes("<figcaption") && CHART.includes('role="img"'));
  assert.ok(SERVICE.includes('.order("new_rating", { ascending: false }).limit(1)'), "el máximo sale del libro completo");
});

/* ═══════════════════ integraciones ═══════════════════ */

test("integración: puerta en /duelos (y la de PvP intacta), nav, home, meta hub y perfil", () => {
  // Fase 55 · el centro competitivo canónico es `/competitivo`; `/duelos/competitivo` queda como alias que redirige.
  // F72 · /duelos pinta los modos de `gameModes()` y COMPETITIVO juega DIRECTO: la puerta de F55 (`rankedGate`) con los
  // equipos del servidor y el rango de `fetchCompetitive()`; `/competitivo` queda como detalle (enlace discreto).
  assert.ok(DUELOS.includes("<DuelModesHub") && DUELOS.includes("gameModes(facts)"));
  // F84 · el estado de la tarjeta es el de la temporada competitiva (colocación / rango derivado del servidor).
  assert.ok(DUELOS.includes("rankedGate({") && DUELOS.includes("fetchCompetitive()") && DUELOS.includes("snap.competitive.standing"));
  assert.ok(read("src", "design", "nav.ts").includes('href: "/competitivo"'));
  assert.ok(HUB_PAGE.includes('redirect("/competitivo")'), "el alias de la Fase 28 redirige al centro nuevo");
  // Fase 42 · el bucle (GET) lee la ficha sin crearla.
  assert.ok(LOOP.includes("competitive,") && LOOP.includes("readCompetitivePosition(admin, userId)") && !LOOP.includes("ensureRating("));
  // Fase 36: la home lee el competitivo por el Daily Loop con la lectura PURA (sin crear la ficha 1000/0).
  const daily = read("src", "server", "services", "dailyLoop.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(HOME.includes("<DailyLobby") && daily.includes("readCompetitivePosition(sb, userId)") && !/ensureRating|getCompetitivePosition/.test(daily));
  assert.ok(META_HUB.includes('href="/competitivo"'));
  assert.ok(CUENTA.includes("<CompetitiveSummary enabled={!!user}"));
  assert.ok(PVP_LOBBY.includes("Ranked · Duelo PvP") && PVP_PAGE.includes("Rival encontrado · preparando la arena…"));
});

/* ═══════════════════ regresión (44–55) ═══════════════════ */

test("44+45+46 · motor PvP, matchmaking y fórmula de rating intactos", () => {
  // F72.8 · el plazo PvP pasa a ser el de cada DECISIÓN (30 s, constante central compartida con el PvE); antes 90_000.
  assert.ok(PVP_SERVICE.includes("PVP_TURN_MS = TURN_DECISION_MS"));
  assert.ok(MM_SERVICE.includes("duel_pvp_enqueue") && MM_SERVICE.includes("duel_pvp_status"));
  assert.equal(INITIAL_RATING, 1000); assert.equal(MIN_RATING, 0); assert.equal(MAX_RATING, 5000);
  assert.deepEqual(RATING_WINDOW_STEPS.map((s) => s.window), [150, 300, 600, 100_000]);
  assert.ok(/round\(k_a \* \(score_a\s+- public\.duel_pvp_expected_score\(ra\.rating, rb\.rating\)\)\)/.test(MIG35));
  assert.ok(RATING_SERVICE.includes('rpc<SettleOutcome>(sb, "duel_pvp_settle_match", { p_match: matchId })'));
});

test("47+48+49+50+51+52+53+54+55 · recompensas, duelo, mazos, sobres, colección, Pick'ems, progresión, Marketplace y worker intactos", () => {
  assert.ok(read("src", "domain", "cardgame", "match", "types.ts").includes("TURNS_PER_MATCH = 10"));
  assert.ok(read("src", "domain", "cardgame", "combat", "rules.ts").includes('"duel-combat-2"'));
  assert.ok(read("src", "domain", "cardgame", "types.ts").includes("DUEL_DECK_SIZE = 10"));
  assert.ok(read("src", "server", "services", "packs.ts").includes("randomInt("));
  assert.ok(read("src", "server", "services", "pickems.ts").includes("app_score_pickem_event"));
  assert.ok(read("src", "domain", "progression", "levels.ts").includes("Math.pow(level - 1, 1.6)"));
  assert.ok(/GLOBAL_MARKET_ENABLED\s*=\s*false/.test(FEATURES));
  assert.ok(read("src", "lib", "esports", "autosync", "policy.ts").length > 0);
  for (const src of [...UI, SERVICE]) assert.ok(!/market|mercado|autosync|esports|app_grant_reward|award\(/i.test(code(src)));
});

/* ═══════════════════ telemetría / accesibilidad ═══════════════════ */

test("telemetría: seis contextos con puerta; contrato intacto; 0046 admite `competitive` en la BD (aplicada en la Fase 35.1)", () => {
  assert.deepEqual([...COMPETITIVE_CONTEXTS], ["competitive_view", "leaderboard_view", "history_view", "match_detail_view", "queue_start", "queue_cancel"]);
  assert.equal(COMPETITIVE_FLOW, "competitive");
  assert.equal(isFlow(COMPETITIVE_FLOW), false);
  assert.equal(FLOWS.length, 4); assert.equal(EVENT_NAMES.length, 4);
  assert.ok(MIG46.includes("'competitive'") && MIG46.includes("— APLICADA (VPS 2026-09-15, Fase 35.1)."));
  assert.ok(PVP_PAGE.includes('trackCompetitive("queue_start")') && PVP_PAGE.includes('trackCompetitive("queue_cancel")'));
});

test("accesibilidad: tabla semántica en escritorio, lista en móvil, aria-current propio, tendencia textual, sin live-region de rating", () => {
  assert.ok(BOARD.includes("<table") && BOARD.includes('scope="col"') && BOARD.includes('aria-current={e.isSelf ? "true" : undefined}'));
  assert.ok(BOARD.includes("min-h-[52px]") && BOARD.includes("← tú"));
  assert.ok(HERO.includes("Subes") || PVP_OUTCOME.includes("Subes"), "el cambio de puestos se dice con palabras");
  for (const src of UI) assert.ok(!/aria-live/.test(src), "el rating no se anuncia en vivo");
  assert.ok(CHART.includes("useReducedMotion"));
});
