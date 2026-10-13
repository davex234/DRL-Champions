/**
 * IA 2026-10-07 · INFORMATION ARCHITECTURE / SEASON HUB / ACCOUNT CONSOLIDATION — el contrato.
 *
 *   TEMPORADA (hub) → PASE DE BATALLA · OBJETIVOS · CRAFTEO (→ CARTAS · SOBRES)
 *   MI CUENTA (icono de usuario) → PERFIL · PROGRESIÓN · CUENTA + DAR FEEDBACK
 *   TIENDA → Pase de batalla (entrada al pase canónico), SIN «Centro de eventos»
 *
 * Ninguna ruta se borra: `/progresion` y `/feedback` redirigen; `/jugador/[id]`, `/eventos`, `/logros`, `/recompensas`
 * siguen existiendo. Nada de esto toca economía ni datos.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { NAV_SECTIONS, MOBILE_NAV, ROUTES, sectionForPath } from "./nav";
import { mobileMenu } from "./gameShell";
import { SeasonModesHub, SEASON_AREAS } from "@/components/season/SeasonModesHub";
import { BattlePassEntry, battlePassStoreLine } from "@/components/store/BattlePassEntry";
import { AccountButton } from "@/components/layout/AccountButton";
import { ACCOUNT_TABS, accountSectionOf } from "@/components/account/accountSections";
import { PAYMENTS_ENABLED } from "@/config/monetization";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const tienda = NAV_SECTIONS.find((s) => s.id === "tienda")!;
const temporada = NAV_SECTIONS.find((s) => s.id === "progreso")!;

/* ───────────── Tienda ───────────── */

test("IA-T1 · el «Centro de eventos» ya NO está en la Tienda (barra, desplegable, hoja móvil); `/eventos` sigue viva", () => {
  assert.ok(!tienda.items.some((i) => i.href.startsWith("/eventos") || /centro de eventos/i.test(i.label)));
  const sheet = mobileMenu().find((s) => s.id === "tienda")!;
  assert.ok(!sheet.items.some((i) => i.href.startsWith("/eventos")));
  assert.ok(!code("src/app/tienda/page.tsx").includes("/eventos"));
  assert.ok(!code("src/components/layout/GameShell.tsx").includes('"tienda" ? badges.events'), "el dock de Tienda no cuenta eventos");
  assert.ok(existsSync(join(ROOT, "src/app/eventos/page.tsx")), "la ruta (y su sistema) no se borra");
});

test("IA-T2 · el Pase de batalla se alcanza desde la Tienda: menú + tarjeta, al pase CANÓNICO (sin copia)", () => {
  const item = tienda.items.find((i) => i.label === "Pase de batalla");
  assert.equal(item?.href, `${ROUTES.battlePass}?desde=tienda`);
  assert.equal(sectionForPath(ROUTES.battlePass)?.id, "progreso", "en el pase, la sección activa es Temporada");
  assert.match(code("src/app/tienda/page.tsx"), /<BattlePassEntry \/>/);
  const h = renderToStaticMarkup(<BattlePassEntry />);
  assert.match(h, /href="\/temporada\/pase\?desde=tienda"/);
  assert.match(h, /Pase de batalla/);
  assert.ok(!/comprad/i.test(h), "nunca «comprado»: aquí no se lee ningún derecho");
});

test("IA-T3 · premium honesto: sin pagos reales no hay compra, solo «próximamente»", () => {
  assert.equal(PAYMENTS_ENABLED, false);
  assert.match(battlePassStoreLine(), /próximamente/);
  assert.ok(!/próximamente/.test(battlePassStoreLine(true)), "con pagos reales dejaría de decirlo");
  assert.ok(!/<button/.test(renderToStaticMarkup(<BattlePassEntry />)), "ningún botón de comprar");
});

/* ───────────── Hub de Temporada ───────────── */

test("IA-H1 · el hub de Temporada tiene EXACTAMENTE Pase de batalla · Objetivos · Crafteo, con sus destinos canónicos", () => {
  assert.deepEqual(SEASON_AREAS.map((a) => a.title), ["Pase de batalla", "Objetivos", "Crafteo"]);
  const h = renderToStaticMarkup(<SeasonModesHub />);
  assert.equal((h.match(/data-testid="season-area-[A-Z]+"/g) ?? []).length, 3);
  for (const [id, href] of [["PASS", "/temporada/pase"], ["OBJECTIVES", "/misiones"], ["CRAFTING", "/misiones/crafting"]] as const) {
    assert.match(h, new RegExp(`data-testid="season-area-cta-${id}"[^>]*>|href="${href.replace(/\//g, "\\/")}"[^>]*data-testid="season-area-cta-${id}"`));
    assert.ok(h.includes(`href="${href}"`), href);
  }
  assert.equal((h.match(/data-cta="primary"/g) ?? []).length, 1, "una sola acción dominante");
  assert.match(code("src/app/temporada/page.tsx"), /<SeasonModesHub \/>/);
  assert.match(read("src/components/season/SeasonModesHub.tsx"), /from "@\/components\/modes\/ModePanel"/, "la pieza de JUGAR, no una copia");
});

test("IA-H2 · Pase de batalla = la pantalla canónica de antes (Fase 34 + F83), movida sin cambios", () => {
  const pass = code("src/app/temporada/pase/page.tsx");
  // BATTLE PASS CLEANUP · la pantalla del pase ya no es un tablero (`SeasonHub` sigue en el archivo /temporadas/[slug]).
  assert.ok(pass.includes("<SeasonTrackScreen") && pass.includes('variant="pass"') && pass.includes("<BattlePassScreen") && pass.includes("claimSeasonReward") && pass.includes("claimPassLevel"));
  assert.ok(!/status:\s*"PUBLISHED"|publishSeason/.test(pass), "no publica temporadas");
});

test("IA-H3 · Objetivos = objetivos del pase (con su reclamo) + misiones F73; Progresión = lo conseguido (Mi cuenta)", () => {
  const obj = code("src/app/misiones/page.tsx");
  assert.match(obj, /<ProgressionHub snap=\{meta\.snap\}[^>]*view="objectives"/);
  assert.ok(obj.includes("claimMissionReq"), "las misiones F73 siguen reclamándose aquí");
  const hub = code("src/components/progression/hub/ProgressionHub.tsx");
  assert.ok(hub.includes('if (view === "objectives")') && hub.includes("<ClaimCenter"));
});

test("IA-C1 · Crafteo presenta SOLO dos opciones: CARTAS y SOBRES (sin Packs ni tercera categoría)", () => {
  const home = code("src/app/misiones/crafting/page.tsx");
  const opts = home.slice(home.indexOf('data-testid="crafting-options"'), home.indexOf("</nav>", home.indexOf('data-testid="crafting-options"')));
  assert.deepEqual([...opts.matchAll(/<Branch href="([^"]+)"/g)].map((m) => m[1]), ["/misiones/crafting/cartas", "/misiones/crafting/sobres"]);
  assert.equal((home.match(/<Branch /g) ?? []).length, 2);
  assert.ok(!/crafting-entry-(avanzado|historial|packs)/.test(home));
  assert.ok(code("src/app/misiones/crafting/cartas/page.tsx").includes('href="/misiones/crafting/avanzado"'), "las recetas avanzadas (cartas) se entran desde Cartas");
  for (const r of ["avanzado", "historial", "sobres", "cartas"]) assert.ok(existsSync(join(ROOT, `src/app/misiones/crafting/${r}/page.tsx`)), r);
});

/* ───────────── Mi cuenta ───────────── */

test("IA-A1 · Mi cuenta = PERFIL · PROGRESIÓN · CUENTA, con las pantallas que ya existían (sin datos duplicados)", () => {
  assert.deepEqual(ACCOUNT_TABS.map((t) => t.label), ["Perfil", "Progresión", "Cuenta"]);
  assert.equal(accountSectionOf(null), "perfil");
  assert.equal(accountSectionOf("progresion"), "progresion");
  assert.equal(accountSectionOf("feedback"), "feedback");
  assert.equal(accountSectionOf("<script>"), "perfil");
  const hub = code("src/components/account/AccountHub.tsx");
  assert.ok(hub.includes("<PlayerProfileScreen id={userId} embedded />"));
  assert.ok(hub.includes("<ProgressionScreen embedded />"));
  const cuenta = code("src/app/cuenta/page.tsx");
  assert.ok(cuenta.includes("<AccountHub userId={user.id}") && cuenta.includes("settings={<AccountSettings />}"));
  assert.ok(cuenta.includes("<Suspense"), "useSearchParams bajo Suspense (si no, el build aborta)");
  assert.ok(cuenta.includes("<AuthForms />"), "sin sesión, entrar / registrarse como siempre");
});

test("IA-A2 · Dar feedback: botón arriba a la derecha de Mi cuenta, con el formulario REAL (mismas categorías y API)", () => {
  const hub = code("src/components/account/AccountHub.tsx");
  assert.ok(hub.includes('data-testid="account-feedback"') && hub.includes("href={ROUTES.feedback}"));
  assert.ok(hub.includes("<FeedbackForm userId={userId} source={feedbackSource} />"));
  assert.ok(hub.indexOf('data-testid="account-feedback"') < hub.indexOf('data-testid="account-tabs"'), "en la cabecera, antes de las pestañas");
  assert.ok(existsSync(join(ROOT, "src/app/api/game/feedback")) || existsSync(join(ROOT, "src/app/api/game/feedback/route.ts")), "la API no se toca");
});

test("IA-A3 · los reclamos de progresión siguen a mano en Mi cuenta → Progresión (y en Objetivos)", () => {
  const screen = code("src/components/progression/ProgressionScreen.tsx");
  assert.ok(screen.includes("<ProgressionHub snap={snap} receivedAt={receivedAt} reload={load} />"), "vista completa: centro de reclamos incluido");
  assert.ok(screen.includes('href="/logros"') && screen.includes('href="/recompensas"'), "Logros y pase e historial siguen enlazados");
  assert.equal(ROUTES.accountProgress, "/cuenta?seccion=progresion");
});

test("IA-A4 · icono global de usuario: persona en SVG, aria-label/title, foco visible, a Mi cuenta (armazón y portada)", () => {
  const h = renderToStaticMarkup(<AccountButton pathname="/cuenta" />);
  assert.match(h, /href="\/cuenta"/);
  assert.match(h, /aria-label="Mi cuenta"/);
  assert.match(h, /title="Mi cuenta"/);
  assert.match(h, /aria-current="page"/);
  assert.match(h, /<svg[^>]*aria-hidden/);
  assert.match(h, /focus-visible:outline/);
  assert.ok(!/aria-current/.test(renderToStaticMarkup(<AccountButton pathname="/tienda" />)));
  assert.match(code("src/components/layout/GameShell.tsx"), /\{user && <AccountButton pathname=\{pathname\} testId="shell-account" \/>\}/);
  assert.match(code("src/components/home/MainMenu.tsx"), /<AccountButton testId="home-account"/);
  assert.equal(MOBILE_NAV.find((m) => m.href === "/cuenta")?.label, "Cuenta");
});

/* ───────────── rutas, enlaces y navegación ───────────── */

test("IA-R1 · rutas antiguas sin 404: /progresion y /feedback redirigen a su sitio en Mi cuenta", () => {
  assert.match(code("src/app/progresion/page.tsx"), /redirect\(ROUTES\.accountProgress\)/);
  const fb = code("src/app/feedback/page.tsx");
  assert.ok(fb.includes("redirect(") && fb.includes("ROUTES.feedback") && fb.includes("FEEDBACK_SOURCES"), "conserva un ?desde= conocido");
  for (const p of ["temporada/pase", "misiones", "misiones/crafting", "cuenta", "jugador/[id]", "logros", "recompensas", "eventos"]) {
    assert.ok(existsSync(join(ROOT, "src/app", p, "page.tsx")), p);
  }
});

test("IA-R2 · perfil público intacto: /jugador/[id] monta la misma pantalla con el id de la URL", () => {
  const page = code("src/app/jugador/[id]/page.tsx");
  assert.ok(page.includes("const { id } = use(params);") && page.includes("<PlayerProfileScreen id={id} />"));
  const screen = code("src/components/player/PlayerProfileScreen.tsx");
  assert.ok(screen.includes("<PublicProfileView") && screen.includes("<SocialActions") && screen.includes('id === "me"'));
});

test("IA-R3 · ningún enlace interno a las rutas antiguas (/progresion, /feedback) fuera de sus redirecciones", () => {
  const files = ["src/components/home/ProgressDock.tsx", "src/components/lobby/LoopStrip.tsx", "src/components/progression/PostMatchProgress.tsx",
    "src/components/progression/CollectionObjectives.tsx", "src/components/season/SeasonPanels.tsx", "src/components/cups/CupDetailScreen.tsx",
    "src/domain/dailyLoop/index.ts", "src/domain/onboarding/index.ts", "src/domain/progression/meta.ts", "src/server/services/loop.ts",
    "src/components/home/MoreMenu.tsx", "src/design/nav.ts"];
  for (const f of files) assert.ok(!/["'`]\/(progresion|feedback)(["'`#?])/.test(code(f)), f);
});

test("IA-N1 · navegación sin duplicados: Progresión, Mi perfil, Cuenta y Feedback no son entradas de menú", () => {
  const all = [...NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.href)), ...MOBILE_NAV.map((m) => m.href)];
  for (const old of ["/progresion", "/feedback", "/jugador/me", "/logros", "/recompensas"]) assert.ok(!all.includes(old), old);
  const navHrefs = NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.href));
  assert.equal(new Set(navHrefs).size, navHrefs.length, "cada destino una sola vez en los menús");
  assert.deepEqual(temporada.items.map((i) => i.label), ["Temporada", "Pase de batalla", "Objetivos", "Crafteo", "Clasificación"]);
  const more = code("src/components/home/MoreMenu.tsx");
  for (const old of ['"/progresion"', '"/feedback"', '"/jugador/me"']) assert.ok(!more.includes(`href: ${old}`), old);
  assert.equal((more.match(/href: "\/cuenta"/g) ?? []).length, 1, "Mi cuenta, una vez");
});
