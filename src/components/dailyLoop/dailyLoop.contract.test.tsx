/**
 * FASE 36 · DAILY LOOP — CONTRATOS Y RENDER DEL VESTÍBULO.
 *
 * Ruta (GET, sin parámetros, token, no-store, límite, 5xx genérico), servicio de solo lectura, una sola
 * lectura personal en la home, rutas reales en cada CTA, accesibilidad (encabezados, barras, 44 px), movimiento
 * reducido, copy sin mentiras, telemetría no-op, sin migración 0052 y render de los estados clave.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { DailyLobby, DailyLobbySkeleton } from "./DailyLobby";
import { buildDailyLoop, DAILY_ROUTES, type DailyLoopFacts, type LiveEventFact } from "@/domain/dailyLoop";
import type { MetaObjective } from "@/domain/progression/meta";
import { FLOWS } from "@/lib/telemetry/contract";
import { RATE_POLICY } from "@/server/services/rateLimit";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const ROUTE = read("src/app/api/game/daily-loop/route.ts");
const SERVICE = read("src/server/services/dailyLoop.ts");
const CLIENT = read("src/lib/dailyLoop/client.ts");
const HOME = read("src/app/page.tsx");
const DOMAIN = read("src/domain/dailyLoop/index.ts");
const PRES = read("src/lib/dailyLoop/presentation.ts");
const UI = ["DailyLobby.tsx", "DailyHero.tsx", "DailyPanels.tsx"].map((f) => read(`src/components/dailyLoop/${f}`)).join("\n");
const ALL = [ROUTE, SERVICE, CLIENT, HOME, DOMAIN, PRES, UI].join("\n");

const NOW = Date.parse("2026-09-20T12:00:00.000Z");
const H = 3600_000; const D = 24 * H;

const obj = (o: Partial<MetaObjective> & { id: string }): MetaObjective => ({
  label: `Objetivo ${o.id}`, kind: "daily", current: 0, goal: 5, complete: false, claimed: false, rewardCredits: 0, xp: 0,
  metric: "duels_played", packId: null, packCount: 0, assignedAt: NOW - H, expiresAt: NOW + 5 * H, ...o,
});
const ev = (e: Partial<LiveEventFact> & { id: string }): LiveEventFact => ({
  name: `Evento ${e.id}`, lifecycle: "ACTIVE", isDemo: false, startDate: null, endDate: null, liveCount: 0, liveMatch: null, nextMatch: null, pickem: null, ...e,
});
function facts(o: Partial<DailyLoopFacts> = {}): DailyLoopFacts {
  return {
    now: NOW, signedIn: true, catalogSize: 772, matches: [], social: { incoming: 0, from: null },
    progression: {
      account: { level: 7, xp: 2400, xpIntoLevel: 120, xpForNext: 600, progress: 0.2 },
      pass: { level: 3, maxLevel: 50, xp: 3400, xpIntoLevel: 400, xpForNext: 1000, progress: 0.4, nextReward: { level: 4, track: "free", label: "300 créditos" } },
      claimableLevels: 0, objectives: [obj({ id: "a", current: 3 }), obj({ id: "w", kind: "weekly", current: 1, goal: 10, expiresAt: NOW + 3 * D })],
      achievements: { total: 12, claimed: 2, claimable: 0, near: null }, rotationPending: false,
      metrics: { ownedCards: 25, distinctCards: 22, packsOpened: 5, duelsPlayed: 3 },
    },
    pickems: { pending: 0, open: 0, eventId: null, eventName: null }, packs: { unopened: 2 },
    decks: { total: 1, valid: 1, active: { id: "d", name: "Equipo 2", valid: true, size: 10, sumOvr: 813 }, firstInvalid: null },
    campaign: { completed: 1, total: 15, complete: false, next: { nodeId: "c1-n2", name: "Segundo asalto", team: "LOUD", chapterOrder: 1 } },
    competitive: { rating: null, gamesPlayed: 0, wins: 0, losses: 0, draws: 0, provisional: true, position: null, rankedTotal: 40, recent: [] },
    live: [ev({ id: "ev1", name: "Masters QA", liveCount: 0, nextMatch: { teamA: "FNC", teamB: "G2", startTime: "2026-09-20T18:00:00.000Z" } })],
    season: { current: { id: "nexus-s1", name: "Temporada 1", status: "ACTIVE", presentation: "ACTIVE", startsAtMs: NOW - 10 * D, endsAtMs: NOW + 50 * D }, next: null },
    ...o,
  };
}
const render = (f: DailyLoopFacts, network: "online" | "offline" | "error" = "online") =>
  renderToStaticMarkup(<DailyLobby snap={buildDailyLoop(f)} now={NOW} network={network} stale={network !== "online"} />);

/** ¿Existe una página para esta ruta interna? Segmentos dinámicos (`[id]`) incluidos. */
function routeExists(href: string): boolean {
  const path = href.split(/[?#]/)[0];
  let dir = join(ROOT, "src", "app");
  for (const seg of path.split("/").filter(Boolean)) {
    if (existsSync(join(dir, seg))) { dir = join(dir, seg); continue; }
    const dyn = existsSync(dir) ? readdirSync(dir).find((d) => /^\[[^.\]]+\]$/.test(d)) : undefined;
    if (!dyn) return false;
    dir = join(dir, dyn);
  }
  return existsSync(join(dir, "page.tsx"));
}

/* ───────────── ruta ───────────── */

test("RUTA · solo GET: no existe POST/PUT/PATCH/DELETE en /api/game/daily-loop", () => {
  assert.ok(/export async function GET\(/.test(ROUTE));
  assert.ok(!/export (async )?function (POST|PUT|PATCH|DELETE)\b/.test(ROUTE));
  const exported = [...code(ROUTE).matchAll(/export (?:const|async function|function) (\w+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(exported, ["GET", "dynamic", "runtime"], "una ruta de Next solo exporta lo suyo");
});

test("SEGURIDAD · ningún parámetro (?userId= → 400); el usuario sale SIEMPRE del token", () => {
  assert.ok(ROUTE.includes("if ([...q.keys()].length > 0) return NextResponse.json({ error: \"Parámetro no válido\", code: \"BAD_REQUEST\" }, { status: 400"));
  assert.ok(ROUTE.includes("const userId = session?.userId ?? null;"));
  assert.ok(!/searchParams\.get\(|req\.json\(|body/.test(code(ROUTE)));
});

test("SEGURIDAD · personal no-store, público caché corta, límite de lectura razonable", () => {
  assert.ok(ROUTE.includes('headers: userId ? NO_STORE : PUBLIC_SHORT'));
  assert.ok(ROUTE.includes('takeRate(admin, userId, "daily_loop_read")'));
  const p = RATE_POLICY.daily_loop_read;
  assert.ok(p.limit >= 20 && p.limit <= 120 && p.windowSeconds === 60, "no bloquea el refresco normal y corta el rastreo");
});

test("SEGURIDAD · errores genéricos: nunca se devuelve el mensaje interno", () => {
  const body = code(ROUTE);
  assert.ok(!/error: r\.error|e\.message\s*[,}]|error: String\(e\)/.test(body.replace(/console\.error\([^)]*\)/g, "")));
  assert.ok(/status: 503/.test(body) && /status: 500/.test(body));
  assert.ok(SERVICE.includes('error: "No se pudo leer tu sesión de juego", code: "UNAVAILABLE"'));
});

test("SEGURIDAD · sin claves de servicio en el cliente y sin userId en la petición", () => {
  assert.ok(!/service_role|SUPABASE_SERVICE|SERVICE_KEY/i.test(CLIENT + HOME + UI + PRES));
  assert.ok(CLIENT.includes("authorization: `Bearer ${token}`"));
  assert.ok(!/userId|user_id/.test(code(CLIENT)));
});

/* ───────────── solo lectura ───────────── */

test("SOLO LECTURA · el servicio no inserta, actualiza, borra ni llama RPC; usa los equivalentes puros", () => {
  const s = code(SERVICE);
  assert.ok(!/\.(insert|update|upsert|delete)\(|\.rpc\(/.test(s));
  for (const bad of ["getProgression(", "ensureRating(", "getLoop(", "getMetaSnapshot(", "getCompetitivePosition(", "startCampaignNode(", "setActive"]) assert.ok(!s.includes(bad), bad);
  for (const good of ["peekProgression(sb, userId, now)", "readCompetitivePosition(sb, userId)", "readCampaignSummary(sb, userId)", "listDecks(sb, userId)", "readActive(sb, userId)"]) assert.ok(s.includes(good), good);
});

test("SOLO LECTURA · de duel_matches solo columnas públicas (nunca state/rng)", () => {
  const selects = [...code(SERVICE).matchAll(/from\("duel_matches"\)\.select\(([^)]*)\)/g)].map((m) => m[1]);
  assert.ok(selects.length >= 2);
  for (const s of selects) assert.ok(!/state|rng|\*/.test(s), s);
  assert.ok(SERVICE.includes('const PVP_COLS = "id, mode, user_id, player_b_id, closed_reason";'));
});

test("ACOTADO · lecturas en paralelo con límite; timeout por subsistema", () => {
  assert.ok(SERVICE.includes("await Promise.all(["));
  assert.ok(/export const SUBSYSTEM_TIMEOUT_MS = \d/.test(SERVICE));
  assert.ok(!/for \([^)]*\) \{[^}]*await sb\.from/.test(code(SERVICE)), "ninguna consulta dentro de un bucle");
  for (const m of code(SERVICE).matchAll(/from\("(\w+)"\)\.select\([^)]*\)[^;]*?;/g)) {
    assert.ok(/limit\(|maybeSingle\(/.test(m[0]), `sin límite: ${m[1]}`);
  }
});

/* ───────────── home ───────────── */

test("HOME · UNA lectura personal agregada: nada de las ~12 lecturas del vestíbulo anterior", () => {
  const h = code(HOME);
  assert.ok(h.includes("useDailyLoop({ enabled: configured && !authLoading, userKey: user?.id ?? null })"));
  for (const old of ["fetchTournaments", "fetchPickemEvent", "fetchPickemQuestions", "fetchMyAnswers", "fetchMatches", "fetchGlobalRanking", "fetchLedger", "fetchMyRankPosition", "fetchDuelDecks", "fetchLoop", "fetchEvent", "fetchMetaSnapshot", "fetch("]) {
    assert.ok(!h.includes(old), old);
  }
});

test("HOME · el cliente pide con tiempo máximo, conserva la última foto y no guarda nada en el navegador", () => {
  assert.ok(CLIENT.includes("export const DAILY_LOOP_TIMEOUT_MS = 8_000;") && CLIENT.includes("ctrl.abort()"));
  assert.ok(CLIENT.includes("setStale(true)") && CLIENT.includes('window.addEventListener("online", onOnline)'));
  assert.ok(!/localStorage|sessionStorage/.test(code(CLIENT + HOME + UI)));
  assert.ok(CLIENT.includes("REFRESH_MIN_GAP_MS = 30_000"));
});

test("RUTAS · cada ruta del Daily Loop tiene página real (incluidas /jugador/me y /torneos/[id])", () => {
  for (const r of Object.values(DAILY_ROUTES)) assert.ok(routeExists(r), r);
  assert.ok(routeExists("/torneos/ev1"));
  assert.ok(routeExists("/duelos/pvp?match=x"));
});

test("RUTAS · todos los href del vestíbulo renderizado existen, en varios estados", () => {
  const states = [
    facts(),
    facts({ matches: [{ id: "p", mode: "RANKED", difficulty: null, opponent: "Kira", node: null }] }),
    facts({ decks: { total: 1, valid: 0, active: null, firstInvalid: { id: "bad", name: "A medias", valid: false, size: 7, sumOvr: 1 } } }),
    facts({ social: { incoming: 1, from: "Ana" }, pickems: { pending: 2, open: 2, eventId: "ev1", eventName: "Masters" } }),
    { ...facts(), signedIn: false },
  ];
  for (const f of states) {
    const hrefs = [...render(f).matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
    assert.ok(hrefs.length > 3);
    for (const h of hrefs) assert.ok(h.startsWith("/") && routeExists(h), h);
  }
});

/* ───────────── render ───────────── */

test("RENDER · UNA acción principal: un h1 con el título, un CTA primario con su destino", () => {
  // Sin sobres pendientes: la acción es continuar la campaña (con sobres, ABRIR va antes: rango 5 < 7).
  const html = render(facts({ packs: { unopened: 0 }, progression: { ...facts().progression!, objectives: [] } }));
  assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
  assert.match(html, /<h1 id="daily-hero-title"[^>]*>Segundo asalto · contra LOUD<\/h1>/);
  assert.equal((html.match(/data-testid="daily-primary-cta"/g) ?? []).length, 1);
  assert.match(html, /href="\/jugar\/road-to-champions\?node=c1-n2"[^>]*data-testid="daily-primary-cta"|data-testid="daily-primary-cta"[^>]*href="\/jugar\/road-to-champions\?node=c1-n2"/);
});

test("RENDER · bloques con encabezados semánticos en orden: hoy, temporada, jugar, circuito, colección", () => {
  const html = render(facts());
  const order = ["daily-hero", "daily-today", "daily-season", "daily-play", "daily-live", "daily-stash"].map((id) => html.indexOf(`data-testid="${id}"`));
  assert.ok(order.every((i) => i >= 0), order.join(","));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.ok((html.match(/<h2\b/g) ?? []).length >= 5);
});

test("A11Y · toda barra de progreso es accesible (rol, valor y etiqueta)", () => {
  const bars = render(facts()).match(/<div[^>]*role="progressbar"[^>]*>/g) ?? [];
  assert.ok(bars.length >= 5);
  for (const b of bars) assert.ok(/aria-valuenow="\d+"/.test(b) && /aria-label="[^"]+"/.test(b), b);
});

test("CUENTA ≠ PASE · dos barras separadas y etiquetadas", () => {
  const html = render(facts());
  assert.match(html, /data-testid="daily-pass-xp"[\s\S]*XP del pase/);
  assert.match(html, /data-testid="daily-account-xp"[\s\S]*XP de cuenta/);
});

test("NO FAKE LIVE · evento activo sin partido en juego → «EN CURSO», nunca «EN DIRECTO»", () => {
  const html = render(facts());
  assert.ok(!html.includes("EN DIRECTO"));
  assert.match(html, /data-badge="EN CURSO"/);
  const live = render(facts({ live: [ev({ id: "ev1", liveCount: 1, liveMatch: { teamA: "FNC", teamB: "G2", scoreA: 1, scoreB: 0 } })] }));
  assert.match(live, /data-badge="EN DIRECTO"/);
  assert.match(live, /FNC vs G2 · 1-0/);
});

test("RENDER · sin conexión: aviso textual, CTA desactivado y secundarias sin enlace", () => {
  const html = render(facts({ packs: { unopened: 3 } }), "offline");
  assert.match(html, /data-testid="daily-network"[\s\S]*Sin conexión/);
  assert.match(html, /<button[^>]*disabled=""[^>]*data-testid="daily-primary-cta"|<button[^>]*data-testid="daily-primary-cta"[^>]*disabled=""/);
  assert.match(html, /aria-disabled="true"/);
});

test("RENDER · fallo parcial: el bloque caído lo dice y la acción no sale de él", () => {
  const html = render(facts({ competitive: null, live: null, progression: null }));
  assert.match(html, /data-testid="daily-partial"/);
  assert.match(html, /No se ha podido leer el circuito/);
  assert.match(html, /No se ha podido leer tus objetivos|No disponible ahora mismo/);
});

test("RENDER · anónimo: ENTRAR PARA JUGAR y nada personal", () => {
  const html = render({ ...facts(), signedIn: false });
  assert.match(html, /Entrar para jugar/);
  assert.ok(!/data-testid="daily-(today|stash|play)"/.test(html));
});

test("RENDER · cuenta nueva (Fase 40): Mission Control de la primera sesión con el paso actual en texto y explorar por libre", () => {
  const roles = (["Duelista", "Controlador", "Iniciador", "Centinela", "Flex"] as const).map((role) => ({ role, have: 0, need: 2 }));
  const f = facts({
    packs: { unopened: 4 }, decks: { total: 0, valid: 0, active: null, firstInvalid: null },
    journey: { ownedCards: 0, packsOpened: 0, matchesCompleted: 0, unopenedPacks: 4, firstPackId: "inicial", decks: { total: 0, valid: 0, firstInvalid: null }, readyDeck: null, readiness: { ready: false, dataVersion: null, roles, shortages: roles } },
  });
  f.progression!.metrics = { ownedCards: 0, distinctCards: 0, packsOpened: 0, duelsPlayed: 0 };
  const html = render(f);
  assert.match(html, /data-testid="journey-mission"/);
  assert.match(html, /data-welcome="true"/);
  assert.match(html, /data-step="open" data-state="current"[\s\S]*?Ahora/);
  assert.match(html, /href="\/abrir\/inicial"[^>]*>Abrir mi primer sobre/);
  assert.match(html, /Explorar por mi cuenta/);
  assert.ok(!/data-testid="daily-hero"/.test(html), "el Mission Control sustituye al héroe; la navegación no se toca");
});

test("RENDER · equipo no válido: estado textual y EDITAR EQUIPO hacia ese equipo", () => {
  const html = render(facts({ decks: { total: 1, valid: 0, active: null, firstInvalid: { id: "bad", name: "A medias", valid: false, size: 7, sumOvr: 1 } } }));
  assert.match(html, /data-state="INVALID"/);
  assert.match(html, /Equipo no válido/);
  assert.match(html, /href="\/duelos\/mazos\?deck=bad"/);
});

test("ESQUELETO · silueta sin una sola cifra (no se sabe nada todavía)", () => {
  const html = renderToStaticMarkup(<DailyLobbySkeleton />);
  assert.match(html, /aria-busy="true"/);
  assert.ok(!/\d/.test(html.replace(/<[^>]+>/g, "")), "sin números en el texto");
});

/* ───────────── táctil, movimiento, copy, telemetría, migraciones ───────────── */

test("TÁCTIL · enlaces y filas del vestíbulo ≥ 44 px; botones con tamaños del sistema", () => {
  assert.ok(UI.includes("inline-flex min-h-[44px] items-center font-display"), "TextLink");
  assert.ok(UI.includes("grid min-h-[56px] grid-cols-"), "filas de HOY");
  assert.ok(UI.includes("min-h-[64px]"), "secundarias");
  assert.ok(read("src/components/journey/JourneyMissionControl.tsx").includes("relative flex min-h-[44px] flex-col justify-center border-t-2"), "pasos de la primera sesión (Fase 40)");
  assert.ok(!/size="sm"/.test(UI), "ningún botón por debajo de 44 px");
});

test("MOVIMIENTO · MotionConfig respeta la preferencia; una sola línea en bucle, quieta con reduced motion", () => {
  assert.ok(UI.includes('<MotionConfig reducedMotion="user">') && UI.includes("useReducedMotion()"));
  const css = read("src/app/globals.css");
  assert.ok(/@media \(prefers-reduced-motion: reduce\) \{\s*\.nx-lobby-sweep \{ animation: none; opacity: 0; \}/.test(css));
  assert.ok(UI.includes("motion-reduce:animate-none"));
  assert.ok((UI.match(/nx-lobby-sweep/g) ?? []).length === 1, "una sola línea de energía");
  assert.ok(!/parallax|useParallax/.test(UI));
});

test("COPY · sin rachas, bonus, stamina, monedas nuevas, Temporada 2 ni jerga de panel corporativo", () => {
  const text = code(DOMAIN + PRES + UI + HOME);
  assert.ok(!/racha|login diario|bonus|stamina|energía extra|ticket|ruleta|Temporada 2|vuelve mañana/i.test(text));
  assert.ok(!/Panel de usuario|Actividad reciente|Resumen de métricas|Gestión de progreso/i.test(text));
  assert.ok(!/cartas nuevas hoy|obtained_at/i.test(text), "sin «cartas nuevas» (obtained_at no es fiable)");
});

test("CSS · colores con sintaxis válida: nada de `rgb(r,g,b / a)` (comas + barra es inválido y el navegador lo descarta)", () => {
  assert.ok(!/rgb\(\$\{[^}]+\} \//.test(UI), "usar rgba(r,g,b,a) con tonos en comas");
  assert.ok(UI.includes("rgba(${rgb}, 0.38)"), "el borde del héroe se tiñe de verdad");
});

test("CARTAS · el vestíbulo no crea un renderizador de cartas: usa la vitrina canónica", () => {
  assert.ok(UI.includes('import { LobbyShowcase, type ShowcaseCard } from "@/components/lobby/LobbyShowcase";'));
  assert.ok(!/PlayerCard|CardRenderer|MiniCard/.test(UI));
});

test("TELEMETRÍA · no-op honesto: FLOWS sigue cerrado en 4 y el Daily Loop no emite eventos", () => {
  assert.equal(FLOWS.length, 4);
  assert.ok(!/track[A-Z]\w*\(|telemetry/i.test(code(ALL)));
});

test("MIGRACIONES · el Daily Loop no añadió esquema (la única 0052 es la de favoritos de la Fase 37) ni toca mercado", () => {
  const m52 = readdirSync(join(ROOT, "supabase", "migrations")).filter((f) => f.startsWith("0052"));
  assert.deepEqual(m52, ["0052_collection_favorites.sql"]);
  assert.ok(!/0052|user_card_favorites/.test(code(ALL)), "el Daily Loop no depende de ella");
  assert.ok(!/GLOBAL_MARKET_ENABLED|market/i.test(code(ALL)));
});

test("FOTO · el tipo público no declara correo, créditos, estado de partida ni respuestas", () => {
  const block = DOMAIN.slice(DOMAIN.indexOf("export interface DailyLoopSnapshot"), DOMAIN.indexOf("export function unavailableOf"));
  assert.ok(block.length > 100);
  assert.ok(!/email|credits|is_admin|\brng\b|option|answer|hand|baseline|last_seen/.test(block));
  assert.ok(!/matchState|gameState|state: Duel/.test(block), "el único `state` es el del equipo (READY/INVALID/NONE)");
});
