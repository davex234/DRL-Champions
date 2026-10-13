/**
 * FASE 34 · CONTRATOS — UI y acciones (85–94), fuente única, navegación, integración, telemetría, rate
 * limit, lectura sin efectos, y regresión (95–119).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { GLOBAL_MARKET_ENABLED } from "@/config/features";
import { FLOWS, zoneFromPath } from "@/lib/telemetry/contract";
import { NAV_SECTIONS } from "@/design/nav";
import { RATE_POLICY } from "@/server/services/rateLimit";
import { K_ESTABLISHED, K_PROVISIONAL } from "@/domain/cardgame/rating";
import { SEASON_CONTEXTS, seasonFlow } from "@/lib/season/telemetry";
import { heroCta } from "@/components/season/SeasonHero";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const files = (dir: string): string[] => readdirSync(join(ROOT, dir)).flatMap((f) => {
  const rel = `${dir}/${f}`;
  return statSync(join(ROOT, rel)).isDirectory() ? files(rel) : /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) ? [rel] : [];
});

const UI = files("src/components/season");
const HUB = "src/components/season/SeasonHub.tsx";
const HERO = "src/components/season/SeasonHero.tsx";
const COUNT = "src/components/season/SeasonCountdown.tsx";
const SVC = "src/server/services/season.ts";

/* ───────────── 85–88 · CTA por estado ───────────── */

const snap = (status: "UPCOMING" | "ACTIVE" | "ENDED", actions: { label: string; href: string }[] = [], signed = true) =>
  ({ season: { status }, personal: signed ? { actions } : null } as never);

test("85 · próxima: la llamada lleva al calendario", () => { assert.equal(heroCta(snap("UPCOMING")).href, "#calendario"); });
test("86 · en curso: la primera acción del servidor; sin acciones, jugar ranked", () => {
  assert.equal(heroCta(snap("ACTIVE", [{ label: "Reclama tus recompensas", href: "/logros" }])).href, "/logros");
  assert.equal(heroCta(snap("ACTIVE")).href, "/duelos/pvp");
  assert.equal(heroCta(snap("ACTIVE", [], false)).href, "/cuenta");
});
test("87 · últimos días: tratamiento visual por `presentation`, sin urgencias de compra", () => {
  const all = UI.map(code).join("\n");
  assert.ok(code(HERO).includes("ENDING_SOON: {") && code("src/domain/season/calendar.ts").includes('ENDING_SOON: "Últimos 7 días"'));
  assert.ok(!/compra ya|última oportunidad|¡|buy now|oferta/i.test(all), "sin FOMO ni monetización");
});
test("88 · terminada: la llamada lleva al resumen", () => { assert.equal(heroCta(snap("ENDED")).href, "#resumen"); });

/* ───────────── 89–94 · acciones, cuenta atrás, movimiento, móvil ───────────── */

test("89–91 · el tablero pinta las acciones del servidor (máx. 5) y no ordena por su cuenta", () => {
  const board = code("src/components/season/SeasonActionBoard.tsx");
  assert.ok(board.includes("actions.map((a, i) =>") && !/sort\(|RANK/.test(board));
  assert.ok(code(SVC).includes("seasonActions({"));
});

test("92 · cuenta atrás accesible: role=timer con frase, sin aria-live por segundo", () => {
  const c = code(COUNT);
  assert.ok(c.includes('role="timer"') && c.includes("aria-label={countdownSentence(c, verb)}"));
  assert.ok(!/aria-live="(polite|assertive)"/.test(c));
});

test("93 · movimiento reducido: la única animación del héroe es motion-safe; sin bucles en paneles", () => {
  assert.ok(code(HERO).includes("motion-safe:animate-pulse"));
  for (const f of UI) assert.ok(!/animate-(spin|bounce|ping)|repeat: Infinity/.test(code(f)), f);
});

test("94 · móvil: rejillas que se apilan (lg:) y tipografía fluida; tira de carril desplazable", () => {
  assert.ok(code(HUB).includes("lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]") && code(HUB).includes("lg:grid-cols-3"));
  assert.ok(code(HERO).includes("text-[clamp(34px,6.4vw,76px)]"));
  assert.ok(code("src/components/season/SeasonPanels.tsx").includes("overflow-x-auto"));
});

/* ───────────── fuente única, lectura sin efectos, reloj ───────────── */

test("una sola fuente: SEASON_CALENDAR solo se lee a través de loadSeasonCalendar / meta, y nadie resuelve la temporada en cliente", () => {
  const users = files("src").filter((f) => !f.includes("design-system") && code(f).includes("SEASON_CALENDAR"));
  // Fase 42 · `progression` (servidor) lee el comienzo de la temporada para la baseline de las misiones fijas de una cuenta nueva.
  assert.deepEqual(users.sort(), ["src/data/seasonCalendar.ts", "src/server/services/meta.ts", "src/server/services/progression.ts", SVC].sort());
  for (const f of [...UI, "src/lib/season/client.ts", "src/app/temporada/page.tsx"]) assert.ok(!/resolveCalendar\(|statusAt\(/.test(code(f)), f);
});

test("GET sin efectos: el servicio no escribe ni llama RPC; peekProgression no guarda", () => {
  assert.ok(!/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(|savePass|ensureRating|getRating\(|getProgression\(|getLoop\(/.test(code(SVC)));
  const prog = read("src/server/services/progression.ts");
  const peek = prog.slice(prog.indexOf("export async function peekProgression"), prog.indexOf("function missionViews"));
  assert.ok(peek.length > 100 && !/savePass|refreshMissionsFor|rotateMissionsFor|unlockCompetitive/.test(peek));
  // Fase 42 · la apertura del carril y la rotación son del estado resuelto; solo `ensurePass` (mutaciones) las guarda.
  assert.ok(prog.includes("async function ensurePass(") && prog.includes("resolvePassWindows({"));
});

test("el cliente no usa su reloj como autoridad: estima desde serverNow; al llegar a 0 solo refresca", () => {
  const client = code("src/lib/season/client.ts");
  assert.ok(client.includes("estimateServerNow(clock, Date.now())"));
  for (const f of UI) assert.ok(!/Date\.now\(\)/.test(code(f)), f);
});

/* ───────────── integración ───────────── */

test("navegación: «Temporada» dentro de Progreso, sin romper límites (Jugar ≤ 7) ni Mi perfil/Cuenta", () => {
  const progreso = NAV_SECTIONS.find((s) => s.id === "progreso")!;
  assert.equal(progreso.items[0].href, "/temporada");
  // IA 2026-10-07 · Temporada → hub + Pase de batalla · Objetivos · Crafteo; Mi perfil/Cuenta viven en Mi cuenta.
  assert.deepEqual(progreso.items.slice(1, 4).map((i) => i.href), ["/temporada/pase", "/misiones", "/misiones/crafting"]);
  assert.ok(!progreso.items.some((i) => i.href === "/jugador/me" || i.href === "/cuenta"));
  assert.ok(NAV_SECTIONS.find((s) => s.id === "jugar")!.items.length <= 7);
  assert.equal(zoneFromPath("/temporada"), "pass");
  assert.equal(zoneFromPath("/temporadas/temporada-1"), "pass");
});

test("home: la temporada va DESPUÉS de la acción principal (no cambia su prioridad); el bloque compacto sigue con calendario público", () => {
  // Fase 36: la home recibe la temporada en la foto del Daily Loop (calendario del servidor); `SeasonHomeBlock` queda para el perfil.
  const lobby = read("src/components/dailyLoop/DailyLobby.tsx");
  assert.ok(lobby.indexOf("<DailyHero") < lobby.indexOf("<SeasonBlock"));
  assert.ok(read("src/server/services/dailyLoop.ts").includes("getSeasonCalendar(now, opts.entries ?? loadSeasonCalendar())"));
  const block = code("src/components/season/SeasonHomeBlock.tsx");
  assert.ok(block.includes("useSeasonCalendar()") && !/useSeasonHub|personal/.test(block));
});

test("perfil: la temporada ya no se pinta en el perfil (vive en /temporada); el perfil público no recibe pase ni objetivos", () => {
  const page = read("src/components/player/PlayerProfileScreen.tsx");
  assert.ok(!page.includes("<SeasonHomeBlock"), "perfil = identidad: el bloque de temporada sale del perfil");
  // Fase 56 · el perfil ya enseña la TEMPORADA (calendario canónico + tramo ranked público); lo que sigue sin viajar al
  // perfil es lo PRIVADO de la temporada: el pase, sus niveles y los objetivos. Pin reescrito a su intención.
  const svc = code("src/server/services/playerIdentity.ts");
  assert.ok(!/peekProgression|getProgression|user_pass|objectives|missions|passLevel/.test(svc), "ni pase ni objetivos en el perfil");
  assert.ok(svc.includes("resolveCalendar(loadSeasonCalendar(), now)"), "la temporada se lee por la fuente única");
});

test("meta: el panel del pase ya no dice «Termina en 0 min» con la temporada terminada", () => {
  assert.ok(read("src/components/progression/SeasonPanel.tsx").includes("season.endsAt <= serverNow"));
});

/* ───────────── telemetría, rate limit, caché ───────────── */

test("telemetría: seis contextos en `season`, no-op honesto hasta 0046 + FLOWS", () => {
  assert.equal(SEASON_CONTEXTS.length, 6);
  assert.equal(seasonFlow(), null);
  assert.equal(FLOWS.length, 4);
  assert.ok(read("supabase/migrations/0046_telemetry_flows_progression.sql").includes("'deck_management', 'season'"));
});

test("rate limit: cubeta season_read (misma RPC, sin migración) solo con sesión; anónimo sin escritura", () => {
  assert.ok(RATE_POLICY.season_read.limit > 0);
  const route = code("src/app/api/game/season/route.ts");
  assert.ok(route.includes('if (userId) {') && route.includes('takeRate(admin, userId, "season_read")'));
});

test("caché: público corto sin stale-while-revalidate (serverNow fresco); con sesión no-store; parámetros estrictos", () => {
  const route = code("src/app/api/game/season/route.ts");
  assert.ok(route.includes('"public, max-age=10, s-maxage=15"') && !route.includes("stale-while-revalidate"));
  assert.ok(route.includes("userId ? NO_STORE : PUBLIC_SHORT"));
  assert.ok(route.includes('const ALLOWED = new Set(["season", "scope"]);') && !/userId.*searchParams|q\.get\("user/.test(route));
});

/* ───────────── 95–119 · regresión ───────────── */

const MARK = /Fase 34|FASE 34|domain\/season|seasonCalendar|services\/season|lib\/season/;
const untouched = (label: string, list: string[]) => test(label, () => {
  assert.ok(list.length > 0);
  for (const f of list) { assert.ok(existsSync(join(ROOT, f)), f); assert.ok(!MARK.test(read(f)), f); }
});

untouched("95 · motor de combate intacto", files("src/domain/cardgame/combat"));
test("96 · duel-turns-2", () => { assert.ok(read("src/domain/cardgame/match/types.ts").includes('ORCHESTRATOR_VERSION = "duel-turns-2"')); });
test("97 · duel-combat-2", () => { assert.ok(code("src/domain/cardgame/combat/rules.ts").includes('"duel-combat-2"')); });
untouched("98 · fórmula de rating intacta", files("src/domain/cardgame/rating"));
test("98b · factor K", () => { assert.deepEqual([K_PROVISIONAL, K_ESTABLISHED], [40, 24]); });
untouched("99 · liquidación intacta", ["src/server/services/duelsRating.ts"]);
untouched("100 · matchmaking intacto", [...files("src/domain/cardgame/matchmaking"), "src/server/services/duelsMatchmaking.ts"]);
untouched("101 · recompensas intactas", ["src/domain/progression/duelRewards.ts", "src/server/services/rewards.ts", "src/battlepass/rewards.ts", "src/data/season.ts"]);
untouched("102–103 · sobres y su RNG intactos", ["src/domain/packs/weighted.ts", "src/domain/packs/pity.ts", "src/domain/packs/openPack.ts"]);
untouched("104 · colección intacta", ["src/collection/ownership.ts", "src/collection/filter.ts"]);
untouched("105–106 · Deck Builder y equipo activo intactos", [...files("src/domain/deckBuilder").filter((f) => !f.includes("test")), "src/server/services/deckTeams.ts"]);
untouched("107 · Match Experience intacta", ["src/lib/duel/experience.ts", "src/components/duel/MatchBoard.tsx"]);
// Fase 56 · el perfil importa ahora la temporada a propósito (calendario + rankedRecap); el pin «la Fase 34 no tocó el
// perfil» se reescribe a lo que protegía: que el perfil no reciba nada del pase ni de los objetivos.
test("108 · perfil sin pase ni objetivos (servicio y dominio)", () => {
  for (const f of ["src/server/services/playerIdentity.ts", "src/domain/profile/identity.ts"]) {
    assert.ok(existsSync(join(ROOT, f)), f);
    assert.ok(!/peekProgression|getProgression|user_pass|services\/progression|domain\/progression\/rotation/.test(code(f)), f);
  }
});
untouched("109 · social intacto", ["src/server/services/social.ts", "src/domain/social/social.ts"]);
untouched("110 · puntuación de Pick'ems intacta", [...files("src/domain/pickems"), "src/server/services/pickems.ts"]);
untouched("111 · Live Events intacto", ["src/server/services/liveEvents.ts", "src/domain/liveEvents/eventState.ts"]);
untouched("112 · worker de esports intacto", ["scripts/esports-autosync-worker.ts"]);
untouched("113 · importer VLR intacto", ["scripts/vlr-sync.ts", ...files("src/importer-vlr")]);
test("114 · Marketplace OFF", () => { assert.equal(GLOBAL_MARKET_ENABLED, false); });

test("progresión: el refactor de getProgression conserva sus reclamos y su vista (misma composición)", () => {
  const prog = read("src/server/services/progression.ts");
  assert.ok(prog.includes("return ok(composeView(state, facts.metrics, facts.ctx, await readViewParts(admin, userId), now));"));
  assert.ok(prog.includes("await grantRewards(admin, userId, result.rewards, `pass:${CURRENT_SEASON.id}:${track}:${level}`, \"pass_reward\");"));
});

const mig = readdirSync(join(ROOT, "supabase", "migrations"));
for (const [n, label] of [["0046", "115"], ["0047", "116"], ["0048", "117"], ["0049", "118"], ["0050", "119"]] as const) {
  test(`${label} · ${n} aplicada en la Fase 35.1 (cabecera honesta)`, () => {
    const f = mig.find((x) => x.startsWith(n))!;
    assert.ok(/— APLICADA \(VPS 2026-09-15, Fase 35\.1\)\.$/.test(read(`supabase/migrations/${f}`).split("\n")[0]));
  });
}
test("sin migración de temporada: el calendario vive en código versionado y la temporada no necesita tabla todavía", () => {
  // Fase 35: la única 0051 es la de Road to Champions; ninguna migración crea tablas de temporada.
  assert.ok(mig.filter((f) => f.startsWith("0051")).every((f) => f.includes("campaign")));
  for (const f of mig.filter((x) => x.startsWith("0051"))) {
    assert.ok(!/create table[^;]*season/i.test(readFileSync(join(process.cwd(), "supabase", "migrations", f), "utf8")), f);
  }
});
