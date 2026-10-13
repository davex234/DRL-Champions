/**
 * FASE 64 · GAME FEEL 5.0 — contratos de presentación, respuesta y rendimiento (sin píxeles).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createSharedPoll } from "@/lib/net/sharedPoll";
import { sameUser } from "@/lib/supabase/auth";
import { GameGlyph, glyphFor } from "@/components/ui/game/GameGlyph";
import { Loading } from "@/components/ui/States";
import { Toast } from "@/components/ui/Toast";
import { ACHIEVEMENTS } from "@/domain/progression/achievements";
import { xpSources } from "@/domain/progression/xpSources";
import { SOUND_EVENTS, playSound } from "@/lib/sound";
import { TEAM_LOGOS_AVAILABLE } from "@/data/teamLogos";
import type { User } from "@supabase/supabase-js";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const tick = () => new Promise((r) => setTimeout(r, 0));

/* ───────────── rendimiento: una lectura para toda la app ───────────── */

test("F64 P01 · sondeo compartido: 4 suscriptores (barra, menú, dock, hoja) = UNA petición", async () => {
  let calls = 0;
  const poll = createSharedPoll<number>({ fetch: async () => { calls++; return 3; }, initial: 0, intervalMs: 60_000 });
  const offs = [0, 1, 2, 3].map(() => poll.subscribe("u1", () => undefined));
  await tick();
  assert.equal(calls, 1, "antes: 4 × 2 peticiones por pantalla");
  assert.equal(poll.get(), 3);
  poll.refresh(false);
  assert.equal(calls, 1, "dentro del margen mínimo no se relee");
  offs.forEach((o) => o());
  assert.equal(poll.stats().subscribers, 0);
});

test("F64 P02 · sondeo compartido: cambiar de cuenta vacía el valor y relee (nada de la cuenta anterior)", async () => {
  let who = "a";
  const poll = createSharedPoll<string>({ fetch: async () => who, initial: "", intervalMs: 60_000 });
  const off = poll.subscribe("a", () => undefined);
  await tick();
  assert.equal(poll.get(), "a");
  who = "b";
  const off2 = poll.subscribe("b", () => undefined);
  assert.equal(poll.get(), "", "al cambiar de clave, el valor viejo desaparece al instante");
  await tick();
  assert.equal(poll.get(), "b");
  off(); off2();
});

test("F64 P03 · sondeo compartido: un fallo conserva el último valor (nunca inventa uno)", async () => {
  let fail = false;
  const poll = createSharedPoll<number>({ fetch: async () => { if (fail) throw new Error("x"); return 7; }, initial: 0, intervalMs: 60_000, minGapMs: 0 });
  const off = poll.subscribe("u", () => undefined);
  await tick();
  fail = true;
  poll.refresh();
  await tick(); await tick();
  assert.equal(poll.get(), 7);
  off();
});

test("F64 P04 · las insignias del armazón usan el sondeo compartido (misma firma, pines F29/F30 intactos)", () => {
  // F85 · el número social sale del PULSO compartido (latido + contador + retos): sigue siendo UN sondeo para toda la app.
  assert.match(read("src/lib/social/client.ts"), /export const socialPulsePoll = createSharedPoll/);
  assert.match(read("src/lib/liveEvents/client.ts"), /const liveBadgePoll = createSharedPoll/);
  const shell = read("src/components/layout/GameShell.tsx");
  assert.ok(shell.includes("const social = useSocialBadge(!!user);") && shell.includes("const live = useLiveBadge(!!user);"));
});

test("F64 P05 · mismo usuario = mismo objeto (sin relecturas por TOKEN_REFRESHED); perfil con una lectura en vuelo", () => {
  const u = (o: Partial<User>) => ({ id: "1", email: "a@b.c", updated_at: "t1", ...o }) as User;
  assert.equal(sameUser(u({}), u({})), true);
  assert.equal(sameUser(u({}), u({ updated_at: "t2" })), false);
  assert.equal(sameUser(u({}), u({ id: "2" })), false);
  assert.equal(sameUser(null, null), true);
  assert.equal(sameUser(u({}), null), false);
  const auth = read("src/lib/supabase/auth.tsx");
  assert.match(auth, /Date\.now\(\) - cur\.at < 2_000/);
  assert.match(auth, /loadProfile\(user\.id, true\)/, "refreshProfile fuerza la lectura");
});

/* ───────────── iconos: ningún emoji como icono de producto en las rutas principales ───────────── */

test("F64 I01 · cada símbolo de los DATOS (logros, fuentes de XP, recompensas) tiene glifo propio", () => {
  for (const a of ACHIEVEMENTS) assert.ok(glyphFor(a.icon), `logro ${a.id}: ${a.icon}`);
  for (const s of xpSources()) assert.ok(glyphFor(s.icon), `fuente de XP ${s.id}: ${s.icon}`);
  for (const sym of ["🪙", "✨", "📦", "🃏", "🎖️", "🧪", "🔒", "⭐", "★", "✕"]) assert.ok(glyphFor(sym), sym);
  assert.equal(glyphFor("—"), null, "sin glifo = sin icono (nunca un emoji suelto)");
  assert.equal(glyphFor("🦄"), null);
});

test("F64 I02 · el glifo es SVG propio: decorativo por defecto, con nombre accesible si lleva título", () => {
  const deco = renderToStaticMarkup(<GameGlyph symbol="📦" />);
  assert.match(deco, /^<svg[^>]*data-glyph="pack"/);
  assert.match(deco, /aria-hidden="true"/);
  assert.ok(!/📦/.test(deco));
  const named = renderToStaticMarkup(<GameGlyph name="lock" title="Bloqueado" />);
  assert.match(named, /role="img"[^>]*aria-label="Bloqueado"/);
  assert.equal(renderToStaticMarkup(<GameGlyph symbol="—" />), "");
});

test("F64 I03 · los puntos de pintado de las rutas principales ya no escupen el emoji del dato", () => {
  const files = [
    "src/components/events/RewardChip.tsx", "src/components/player/ProfileSections.tsx", "src/components/progression/AchievementGrid.tsx",
    "src/components/progression/CollectionObjectives.tsx", "src/components/season/SeasonPanels.tsx", "src/app/logros/page.tsx",
    "src/components/progression/ProgressionScreen.tsx", "src/components/season/SeasonRewards.tsx", "src/components/season/SeasonMissions.tsx",
    "src/components/pwa/InstallBanner.tsx", "src/components/store/StoreProducts.tsx", "src/components/packs/PackStoreCard.tsx",
    "src/components/shop/ShopHero.tsx", "src/app/inventario/page.tsx", "src/components/collection/PrestigePanel.tsx",
    "src/components/collection/TeamCollection.tsx", "src/components/cards/CardViewer.tsx",
  ];
  for (const f of files) {
    const s = code(read(f));
    assert.ok(!/>\{(a|s|c)\.icon\}</.test(s) && !/\{a\.icon\} \{a\.name\}/.test(s), `${f}: icono crudo`);
    // RewardChip GUARDA el símbolo como dato (lo traduce GameGlyph al pintar); en el resto no queda ninguno.
    if (!f.endsWith("RewardChip.tsx")) assert.ok(!/🪙|🔒|✕/.test(s), `${f}: emoji de producto`);
  }
});

/* ───────────── estados: carga, error, vacío ───────────── */

test("F64 S01 · carga contextual: con `kind` la silueta del contenido (sin saltos); sin él, el cargador de la marca", () => {
  for (const k of ["hub", "profile", "deck", "cards", "hero"] as const) {
    const h = renderToStaticMarkup(<Loading kind={k} label="Leyendo…" />);
    assert.match(h, new RegExp(`data-testid="game-skeleton-${k}"`));
    assert.match(h, /aria-busy="true"/);
    assert.match(h, /role="status"[^>]*>Leyendo…/);
  }
  assert.match(renderToStaticMarkup(<Loading label="Preparando duelo…" />), /data-testid="game-loader"/);
  const routes: [string, string][] = [
    ["src/components/progression/ProgressionScreen.tsx", "hub"], ["src/app/temporada/pase/page.tsx", "hub"], ["src/app/logros/page.tsx", "hub"],
    ["src/app/competitivo/page.tsx", "hub"], ["src/app/jugar/page.tsx", "hub"], ["src/app/duelos/mazos/page.tsx", "deck"], ["src/components/player/PlayerProfileScreen.tsx", "profile"],
  ];
  for (const [f, k] of routes) assert.match(read(f), new RegExp(`<Loading kind="${k}"`), f);
});

test("F64 S02 · aviso: el mismo mensaje se agrega (×N) en vez de apilarse; suena al entrar (acierto / error)", () => {
  const h = renderToStaticMarkup(<Toast toast={{ id: 1, msg: "Favorito guardado", ok: true, count: 3 }} />);
  assert.match(h, /data-testid="toast-count"[^>]*>×(<!-- -->)?3</);
  assert.ok(!/toast-count/.test(renderToStaticMarkup(<Toast toast={{ id: 2, msg: "x", ok: true }} />)));
  const hook = read("src/lib/useToast.ts");
  assert.match(hook, /cur && cur\.msg === msg && cur\.ok === ok/);
  assert.match(read("src/components/ui/Toast.tsx"), /playSound\(ok \? "ui\.success" : "ui\.error"\)/);
});

test("F64 S03 · 404 dentro del universo: VOLVER AL JUEGO y JUGAR; error de pantalla sin traza", () => {
  const nf = read("src/app/not-found.tsx");
  assert.match(nf, /Volver al juego/);
  assert.match(nf, /href="\/jugar"/);
  assert.ok(!/error\.stack|\{error\.message\}/.test(code(read("src/app/error.tsx"))));
});

/* ───────────── respuesta y movimiento ───────────── */

const CSS = read("src/app/game-experience.css");

test("F64 M01 · una sola pulsación de la casa; con movimiento reducido se ILUMINA (no se queda sin respuesta)", () => {
  const f64 = CSS.slice(CSS.indexOf("FASE 64 · GAME FEEL 5.0"));
  assert.match(f64, /\.nx-press:active:not\(:disabled\)[\s\S]*transform: translateY\(1px\) scale\(0\.98\)/);
  const reduced = f64.slice(f64.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(reduced, /transform: none; filter: brightness\(1\.25\)/);
  assert.match(f64, /\.nx-shake/);
  assert.ok(!/nx-flash-bad/.test(f64), "con movimiento reducido el error es ESTÁTICO (campo en rojo + aviso), sin animación");
  assert.match(f64, /\.nx-field\[aria-invalid="true"\]/);
  assert.match(read("src/components/ui/NxButton.tsx"), /"nx-clip-sm nx-press relative/);
  assert.match(CSS, /:where\(a, button\):focus-visible \[data-card3d-face\]/, "la carta responde al teclado");
  assert.match(CSS, /prefers-reduced-motion: reduce\) \{\s*:where\(a, button\):hover \[data-card3d-face\]/, "y al ratón sin girar");
});

test("F64 M02 · transiciones de pantalla dentro del presupuesto (≤ 300 ms normal, fundido corto reducido)", () => {
  const motion = read("src/design/motion.ts");
  const ms = [...motion.slice(motion.indexOf("export function pageMotion")).matchAll(/duration: ([0-9.]+)/g)].map((m) => Number(m[1]));
  assert.ok(ms.length > 0 && ms.every((d) => d <= 0.3), JSON.stringify(ms));
});

test("F64 A01 · audio: tres eventos nuevos (acierto, navegación, rival encontrado), sintetizados, discretos y seguros sin gesto", () => {
  for (const k of ["ui.success", "ui.nav", "match.found"] as const) {
    assert.ok(SOUND_EVENTS[k]);
    assert.ok(SOUND_EVENTS[k].level <= 2, "respuesta, no celebración");
    assert.doesNotThrow(() => playSound(k));
  }
  assert.ok(!/new Audio\(|\.mp3|\.ogg|\.wav/.test(code(read("src/lib/sound.ts"))), "ni ficheros ni descargas");
  const shell = read("src/components/layout/GameShell.tsx");
  assert.ok((shell.match(/playSound\("ui\.nav"\)/g) ?? []).length >= 2, "barra de escritorio y dock móvil");
  assert.match(read("src/components/duel/pvp/RankedMatchFound.tsx"), /playSound\("match\.found"\)/);
});

/* ───────────── HUD honesto, auth, red ───────────── */

test("F64 H01 · sin sesión el HUD no enseña nivel ni créditos locales (eran datos falsos): ENTRAR", () => {
  const shell = read("src/components/layout/GameShell.tsx");
  assert.match(shell, /if \(configured && !loading && !user\) \{[\s\S]*data-testid="hud-signin"/);
  assert.match(read("src/app/page.tsx"), /credits=\{user \|\| !configured \? credits \?\? null : null\}/);
});

test("F64 H02 · entrada/registro: parte del juego (panel, campos con etiqueta y autocompletar, error anunciado) sin tocar el envío", () => {
  const f = read("src/components/auth/AuthForms.tsx");
  assert.match(f, /className="nx-field"[^>]*autoComplete="email"/);
  assert.match(f, /autoComplete=\{mode === "register" \? "new-password" : "current-password"\}/);
  assert.match(f, /role=\{msg\.ok \? "status" : "alert"\}/);
  assert.ok(f.includes('["register", "Registro"]'), "las pruebas E2E buscan la pestaña «Registro»");
  assert.match(f, /<NxButton type="submit"/);
  assert.ok(!/rounded-2xl|rounded-xl/.test(code(f)), "sin la caja redondeada de web");
  assert.match(f, /if \(mode === "register"\) return "\/";/, "F63 intacto");
});

test("F64 N01 · logos de equipo: solo se piden los que EXISTEN en public/teams (antes 17 × 404 en /pickems)", () => {
  const files = readdirSync(join(ROOT, "public/teams")).filter((f) => f.endsWith(".png")).map((f) => f.replace(/\.png$/, "")).sort();
  assert.deepEqual([...TEAM_LOGOS_AVAILABLE].sort(), files);
  assert.match(read("src/components/cards/layers/TeamLogo.tsx"), /!hasTeamLogo\(slug\)/);
});

test("F64 N02 · el vídeo de la portada sigue sin pedirse mientras no exista (F63 no se reintroduce)", () => {
  const ready = /export const LOBBY_VIDEO_READY = (true|false);/.exec(read("src/components/home/NexusHall.tsx"))?.[1] === "true";
  assert.equal(ready, existsSync(join(ROOT, "public/video/nexus-lobby.webm")));
});

/* ───────────── lenguaje y capas ───────────── */

test("F64 L01 · «equipo» en el flujo principal (ranked, draft, estrategia, recorrido, misiones)", () => {
  const visible = (f: string) => code(read(f)).replace(/["'`]\/duelos\/mazos[^"'`]*["'`]/g, "");
  for (const f of ["src/components/competitive/ranked/RankedPlayPanel.tsx", "src/components/duel/strategy/SuggestSection.tsx", "src/components/draft/DraftGauntletScreen.tsx"]) {
    assert.ok(!/>[^<{]*\b(mazos?|plantillas?)\b/i.test(visible(f)), f);
  }
  const journey = read("src/domain/journey/index.ts");
  assert.ok(!/"[^"]*\bplantilla[^"]*"|`[^`]*\bplantilla[^`]*`/i.test(code(journey)), "recorrido F40");
  assert.match(read("src/data/season.ts"), /label: "Guarda tu primer equipo de duelo"/);
});

test("F64 D01 · capas: la hoja «Añadir al equipo» tiene Escape y foco (useDialogLayer); la ficha de carta devuelve el foco", () => {
  assert.match(read("src/components/ui/game/GameOverlay.tsx"), /export function useDialogLayer/);
  const sheet = read("src/components/deck/AddToDeckSheet.tsx");
  assert.match(sheet, /useDialogLayer\(true, onClose, !busy, layer\)/);
  assert.match(sheet, /ref=\{layer\} tabIndex=\{-1\}/);
  const viewer = read("src/components/cards/CardViewer.tsx");
  assert.match(viewer, /opener\.focus\(\{ preventScroll: true \}\)/);
});

test("F64 R01 · regresiones: F61 (tablero y motor), F62 (hub y reclamos) y F63 (guía) sin tocar en su lógica", () => {
  assert.ok(!/GameGlyph|nx-press|F64/.test(read("src/components/duel/MatchBoard.tsx")), "tablero F61 intacto");
  assert.ok(existsSync(join(ROOT, "src/lib/duel/f61.match.test.tsx")), "la huella del motor sigue fijada");
  assert.match(read("src/components/progression/ProgressionScreen.tsx"), /<ProgressionHub snap=\{snap\}/);
  assert.match(read("src/components/progression/ProgressionScreen.tsx"), /<OnboardingProgressCoach view=\{onboarding\.view\} \/>/);
  assert.match(read("src/components/home/MainMenu.tsx"), /snap\.onboarding/);
});
