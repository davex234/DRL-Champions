/**
 * FASE 55 · COMPETITIVO 4.0 — CONTRATOS, SEGURIDAD, PRIVACIDAD Y REGRESIÓN SOBRE EL CÓDIGO REAL.
 *
 * Sin base de datos: se afirma lo que escriben la ruta, el servicio, el SQL de liquidación y las pantallas, y lo
 * que no pueden romper. Las pruebas vivas contra la BD (liquidación doble, concurrencia, permisos) están en el
 * informe de la fase (sonda BEGIN/ROLLBACK + partida E2E real con cuentas QA).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CARDS } from "@/data/catalog";
import { GLOBAL_MARKET_ENABLED } from "@/config/features";
import { PAYMENTS_ENABLED } from "@/config/monetization";
import { ORCHESTRATOR_VERSION } from "@/domain/cardgame/match/types";
import { INITIAL_RATING, K_PROVISIONAL, K_ESTABLISHED, PLACEMENT_GAMES } from "@/domain/cardgame/rating";
import { CURRENT_SEASON } from "@/data/season";
import { rankedGate, rankedPlayHref, rewardsLane } from "./ranked";

const ROOT = process.cwd();
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const SERVICE = read("src", "server", "services", "competitive.ts");
const ROUTE = read("src", "app", "api", "game", "competitive", "route.ts");
const CLIENT = read("src", "lib", "competitive", "client.ts");
const PVP_ROUTE = read("src", "app", "api", "game", "duel", "pvp", "route.ts");
const MM_ROUTE = read("src", "app", "api", "game", "duel", "matchmaking", "route.ts");
const MIG32 = read("supabase", "migrations", "0032_pvp_matchmaking.sql");
const MIG33 = read("supabase", "migrations", "0033_pvp_rating.sql");
const MIG35 = read("supabase", "migrations", "0035_pvp_turn_timeout.sql");
const PAGE = read("src", "app", "competitivo", "page.tsx");
const LEGACY = read("src", "app", "duelos", "competitivo", "page.tsx");
const PVP_PAGE = read("src", "app", "duelos", "pvp", "page.tsx");
const OUTCOME = read("src", "components", "duel", "pvp", "PvpOutcome.tsx");
const RANKED_DIR = join("src", "components", "competitive", "ranked");
const RANKED_UI = readdirSync(join(ROOT, RANKED_DIR)).filter((f) => f.endsWith(".tsx")).map((f) => read(RANKED_DIR, f));
const DUEL_NEW = ["RankedSearch.tsx", "RankedMatchFound.tsx", "RankedMovement.tsx"].map((f) => read("src", "components", "duel", "pvp", f));
const NEW_UI = [...RANKED_UI, ...DUEL_NEW, PAGE];

/* ═══════════════════ autoridad del servidor: el cliente no escribe rating ═══════════════════ */

test("S1 · /api/game/competitive sigue siendo SOLO GET y el servicio no escribe (ni con las lecturas nuevas)", () => {
  assert.ok(/export async function GET/.test(ROUTE) && !/export async function (POST|PUT|PATCH|DELETE)/.test(ROUTE));
  assert.ok(!/\.rpc\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(/.test(code(SERVICE)));
  assert.ok(!/ensureRating\(/.test(code(SERVICE)), "leer no crea la ficha 1000/0");
});

test("S2 · ninguna ruta de juego acepta del cliente ganador, rating, delta, rival ni usuario", () => {
  for (const [name, src] of [["pvp", PVP_ROUTE], ["matchmaking", MM_ROUTE]] as const) {
    const c = code(src);
    for (const field of ["winner", "rating", "delta", "newRating", "opponent", "opponentId", "userId", "playerId", "side", "score", "result"]) {
      assert.ok(!new RegExp(`body\\.${field}\\b|body\\[["']${field}["']\\]`).test(c), `${name} lee body.${field}`);
    }
    assert.ok(c.includes("getSession(req)"), `${name}: el usuario sale del Bearer`);
  }
  // La cola solo recibe el mazo.
  assert.ok(MM_ROUTE.includes("const deckId = typeof body.deckId === \"string\" && UUID.test(body.deckId) ? body.deckId : \"\";"));
});

test("S3 · la liquidación es SQL con permisos de servidor: RLS sin políticas y RPC solo para service_role", () => {
  assert.ok(MIG33.includes("revoke all on public.duel_pvp_ratings       from anon, authenticated;"));
  assert.ok(MIG33.includes("revoke all on public.duel_pvp_rating_events from anon, authenticated;"));
  assert.ok(MIG35.includes("execute format('revoke all on function public.%s from public, anon, authenticated', f);"));
  assert.ok(MIG35.includes("execute format('grant execute on function public.%s to service_role', f);"));
});

test("S4 · idempotencia y concurrencia en la BD: un asiento por (partida, jugador) y la liquidación exige 2 inserciones", () => {
  assert.ok(/create unique index if not exists duel_pvp_rating_events_once/.test(MIG33));
  assert.ok(/on conflict \(match_id, user_id\) do nothing/.test(MIG35) && /if inserted <> 2 then/.test(MIG35));
  assert.ok(/new_rating = old_rating \+ delta/.test(MIG33), "el asiento cuadra por CHECK");
  // Solo PvP ranked liquida; un duelo privado no.
  assert.ok(MIG35.includes("if m.mode <> 'PVP' then       return jsonb_build_object('code', 'NOT_PVP');  end if;"));
});

test("S5 · el resultado lo lee el cliente del servidor (outcome=1) y el cliente nunca resta ratings", () => {
  assert.ok(PVP_PAGE.includes("outcome=1"));
  for (const src of [...NEW_UI, OUTCOME, PVP_PAGE]) {
    assert.ok(!/newRating\s*-\s*oldRating|after\s*-\s*before|rating\s*\+\s*delta\b/.test(code(src)), "sin cuentas de rating en cliente");
    assert.ok(!/duel_pvp_settle_match|settleMatch\(/.test(code(src)), "el cliente no liquida");
  }
});

test("S6 · JUGAR solo manda el mazo: la URL y la cola no llevan rating, rival ni resultado", () => {
  assert.ok(!/rating|rival|opponent|winner|delta/i.test(rankedPlayHref("00000000-0000-4000-8000-000000000001")));
  assert.ok(PVP_PAGE.includes("void cola.enqueue(pedido.id)") && PVP_PAGE.includes("void cola.enqueue(mazo)"));
  assert.ok(PVP_PAGE.includes("if (autoBuscada.current || !buscar || !UUID.test(buscar)"), "`buscar` se valida y se usa UNA vez");
});

/* ═══════════════════ IDOR y privacidad ═══════════════════ */

test("P1 · «rival encontrado» solo para los DOS jugadores de una partida ranked (404 al resto, nunca 403)", () => {
  assert.ok(SERVICE.includes('if (!r || r.mode !== "PVP" || !r.player_b_id) return fail(404, "Partida no encontrada", "NOT_PVP");'));
  assert.ok(SERVICE.includes('if (viewerId !== r.user_id && viewerId !== r.player_b_id) return fail(404, "Partida no encontrada", "NOT_A_PLAYER");'));
  assert.ok(ROUTE.includes('if (q.has("matchup"))') && /matchup[\s\S]{0,160}UUID\.test\(id\)/.test(ROUTE));
  // Del emparejamiento no viaja ni mazo ni estado: solo el id de la fila y los dos jugadores.
  assert.ok(SERVICE.includes('.select("id, mode, user_id, player_b_id")'));
});

test("P2 · la identidad que sale del competitivo es pública: nombre y avatar, nunca correo ni datos de cuenta", () => {
  const selects = [...SERVICE.matchAll(/from\("profiles"\)\.select\("([^"]+)"\)/g)].map((m) => m[1]);
  for (const s of selects) assert.ok(["id, username, avatar", "id"].includes(s), s);
  assert.ok(!/\bemail\b|\bcredits\b|\bis_admin\b|\bphone\b/.test(code(SERVICE)));
  for (const src of NEW_UI) assert.ok(!/\.email\b|user\.email/.test(code(src)), "sin correos en pantalla");
});

test("P3 · clasificación paginada y acotada: nunca la escalera entera en el navegador", () => {
  assert.ok(SERVICE.includes("const page = ladderPage(opts.offset, total, opts.size);"));
  assert.ok(SERVICE.includes("await ladderSlice(sb, cseason.id, page.offset, Math.min(total, page.offset + page.size))")); // F84 · de la temporada activa
  assert.ok(ROUTE.includes('if (q.has("ladder"))'));
  assert.ok(CLIENT.includes("?ladder=1&offset=${Math.max(0, Math.floor(offset))}"));
});

test("P4 · BUG F28 corregido: sin ?top / ?limit el servidor usa el tamaño por defecto, no 1 fila", () => {
  assert.ok(ROUTE.includes('const top = q.has("top") ? Number(q.get("top")) : NaN;'));
  assert.ok(ROUTE.includes('const limit = q.has("limit") ? Number(q.get("limit")) : NaN;'));
  assert.ok(!/const top = Number\(q\.get\("top"\)\);/.test(ROUTE));
});

/* ═══════════════════ honestidad del producto ═══════════════════ */

test("H1 · emparejamiento honesto: la cola ranked no tiene bots y la pantalla lo dice", () => {
  assert.ok(!/\bbot\b/i.test(MIG32.replace(/--.*$/gm, "")), "0032 no empareja con bots");
  assert.ok(SERVICE.includes('rivalKind: "HUMAN"'));
  const ui = NEW_UI.map(code).join("\n");
  assert.ok(ui.includes("no tiene bots") || ui.includes("no hay bots"));
  assert.ok(ui.includes("Jugador real"));
});

test("H2 · sin tiers inventados: el rango ranked es la escalera (puesto + rating), no Oro II ni ligas", () => {
  for (const src of NEW_UI) {
    assert.ok(!/\b(Hierro|Bronce|Plata|Platino|Diamante|Maestro|Inmortal|Radiante|Bronze|Silver|Gold|Platinum|Diamond|Immortal|Radiant|División)\b/.test(code(src)), "sin ligas");
    assert.ok(!/rankProgress\(|rankFromPoints\(|leagueForMmr\(|@\/competitive"/.test(code(src)), "ni los rangos por puntos ni el motor de ligas congelado");
  }
});

test("H3 · sin recompensas inventadas: la única recompensa es el carril competitivo real del pase", () => {
  let credits = 0, packs = 0;
  for (const r of Object.values(CURRENT_SEASON.competitive ?? {})) { credits += r.credits ?? 0; packs += r.packCount ?? 0; }
  assert.deepEqual([credits, packs, CURRENT_SEASON.competitiveMinPoints], [26_000, 6, 400]);
  for (const src of NEW_UI) assert.ok(!/app_grant_reward|award\(|grantReward|\+\s*\d+\s*créditos/i.test(code(src)));
  // El requisito del carril llega del servidor (minPoints), no está escrito en la pantalla.
  for (const src of NEW_UI) assert.ok(!/\b400\b/.test(code(src)), "sin «400» cableado");
  assert.equal(rewardsLane({ unlocked: false, points: 78, minPoints: 400 }).remaining, 322);
});

test("H4 · la cola ranked NO tiene requisito de puntos: la puerta es cuenta + mazo legal + sin partida viva", () => {
  const g = rankedGate({ signedIn: true, decks: [{ id: "d", name: "d", valid: true, errors: [], cards: [] }], activeDeckId: "d" });
  assert.equal(g.kind, "READY", "ni puntos ni rango para entrar");
  const mm = read("src", "server", "services", "duelsMatchmaking.ts");
  assert.ok(!/competitiveMinPoints|profiles\.points|\bpoints\b/.test(code(mm)), "el emparejador no mira puntos");
});

test("H5 · temporada por la MISMA fuente que /temporada y sin reinicio simulado del rating", () => {
  assert.ok(SERVICE.includes("resolveCalendar(loadSeasonCalendar(), now)"));
  assert.ok(SERVICE.includes("resetsRating: false"));
  const ranked = read("src", "domain", "pvpLadder", "ranked.ts");
  assert.ok(ranked.includes("rankedRecap(") && ranked.includes('from "@/domain/season/recap"'), "el récord de temporada reutiliza rankedRecap");
  assert.ok(read("src", "components", "season", "SeasonPanels.tsx").includes('href="/competitivo"'), "/temporada → VER COMPETITIVO");
  assert.ok(RANKED_UI.join("\n").includes('href="/temporada/pase"'), "/competitivo → temporada (el pase, IA 2026-10-07)");
});

/* ═══════════════════ rutas y flujo ═══════════════════ */

test("F1 · /competitivo es el centro; /duelos/competitivo redirige; historial/detalle/perfil siguen donde estaban", () => {
  assert.ok(existsSync(join(ROOT, "src", "app", "competitivo", "page.tsx")));
  assert.ok(LEGACY.includes('redirect("/competitivo")'));
  for (const p of [["historial", "page.tsx"], ["partida", "[matchId]", "page.tsx"], ["jugador", "[id]", "page.tsx"]]) {
    assert.ok(existsSync(join(ROOT, "src", "app", "duelos", "competitivo", ...p)), p.join("/"));
  }
  assert.ok(read("src", "design", "nav.ts").includes('href: "/competitivo"'));
});

test("F2 · la página solo lee (competitivo, mazos, play-status) y deriva la puerta con rankedGate", () => {
  const c = code(PAGE);
  assert.ok(c.includes("fetchCompetitive()") && c.includes("fetchDuelDecks()") && c.includes("usePlayStatus("));
  assert.ok(c.includes("rankedGate({"));
  assert.ok(!/method:\s*"POST"|saveDuelDeck|enqueue\(/.test(c), "la página no escribe");
});

test("F3 · flujo de la arena: buscando → rival encontrado → partida → resultado con ascenso/descenso", () => {
  assert.ok(PVP_PAGE.includes("<RankedSearch") && PVP_PAGE.includes("<RankedMatchFound") && PVP_PAGE.includes("skipIntro="));
  // F84 · la ceremonia es de RANGO (colocación, ascenso, descenso, misma división) desde el asiento del servidor.
  assert.ok(OUTCOME.includes("<RankChange movement={rank}"));
  // El resultado competitivo va antes que la crónica de la partida.
  assert.ok(OUTCOME.indexOf('data-testid="pvp-rating"') < OUTCOME.indexOf("<DecisionPanel"));
  // Sin setTimeout/setInterval en la página PvP (contrato del 7.5).
  assert.ok(!/setTimeout|setInterval/.test(code(PVP_PAGE)));
});

test("F4 · accesibilidad: movimiento reducido en todas las piezas animadas; resultado y ascenso con palabras", () => {
  for (const src of [...DUEL_NEW, ...RANKED_UI.filter((s) => /framer-motion/.test(s))]) assert.ok(/useReducedMotion/.test(src));
  const mv = DUEL_NEW[2];
  for (const w of ["Ascenso", "Descenso", "Clasificado", "Entras en la escalera"]) assert.ok(mv.includes(w), w);
  assert.ok(RANKED_UI.join("\n").includes('aria-current={e.isSelf ? "true" : undefined}') || read("src", "components", "competitive", "Leaderboard.tsx").includes('aria-current={e.isSelf ? "true" : undefined}'));
});

/* ═══════════════════ regresión ═══════════════════ */

test("R1 · catálogo 331, motor duel-turns-2 / duel-combat-2, rating 1000 · K 40/24 · colocación 10", () => {
  assert.equal(CARDS.length, 331);
  assert.equal(ORCHESTRATOR_VERSION, "duel-turns-2");
  assert.ok(read("src", "domain", "cardgame", "combat", "rules.ts").includes('"duel-combat-2"'));
  assert.deepEqual([INITIAL_RATING, K_PROVISIONAL, K_ESTABLISHED, PLACEMENT_GAMES], [1000, 40, 24, 10]);
});

test("R2 · Marketplace y pagos cerrados; migraciones: cabeza 0058 (F60: 0057; PRE-F70: 0058, privilegios)", () => {
  assert.equal(GLOBAL_MARKET_ENABLED, false);
  assert.equal(PAYMENTS_ENABLED, false);
  const migs = readdirSync(join(ROOT, "supabase", "migrations")).filter((f) => /^\d{4}_/.test(f)).sort();
  // F73 añade 0059 (crafteo y misiones) y 0060 (desguace atómico, última copia): AUTORIZADAS y APLICADAS el 2026-09-30.
  assert.equal(migs[migs.length - 1].slice(0, 4), "0074"); // COLECCIONES ILIMITADAS · 0074 (índices de cursor y resumen por carta; aditiva y opcional: el servidor funciona igual sin ella) es la última; antes F87.2 · 0073 (launch guard de Pick'ems: elegibilidad y puerta de tiempo) es la última; antes F87.1 · 0072, F87 · 0071 (Pick'ems 2.0: cuadros de predicción, cierre por partido, liquidación y reclamos; aditiva) es la última; antes F86.2 · 0070 (feedback de la Closed Alpha) es la última; antes F86 · 0069 (torneos de jugadores) es la última del repositorio (cabeza = 0069; 0068 tag público de cuenta; 0067 admins, F85 0066, F84 0065, F83 0064, ops/release). F82 añadió 0062 y F89 0063.
});

test("R3 · economía intacta: el PvP sigue sin créditos y la fase no toca servicios de economía, sobres ni Coach", () => {
  const econ = read("src", "domain", "economy", "catalog.ts");
  assert.ok(econ.includes('{ id: "pvp", cls: "NON_ECONOMIC", label: "PvP (rating, sin créditos)", credits: { min: 0, max: 0 }'));
  for (const src of [SERVICE, ...NEW_UI]) assert.ok(!/from "@\/server\/services\/(economy|packs|store|market)"|domain\/tactics|entrenador/.test(code(src)));
});
