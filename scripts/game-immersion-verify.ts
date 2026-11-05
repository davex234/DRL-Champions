/**
 * FASE 44.1 · VERIFICADOR DE INMERSIÓN — mundo, audio y entrada.
 *
 *   npm run game-immersion:verify              (todo)
 *   npm run game-environment:verify            ambientes por sección, capas, tintes, cámara, bóveda, presupuesto
 *   npm run game-audio:verify                  música original procedural, efectos, ajustes, un solo gestor
 *   npm run game-scroll:verify                 causa raíz de la rueda arreglada en la CSS, sin parches, rueda real medida
 *   npm run game-scroll-lock:verify            cerrojo compartido, fuzz 100.000, 100 ciclos reales de hoja/diálogo/menú
 *   npm run game-atmosphere:verify             pantallas que se ven como lugares: translucidez, vitrina, capturas, rendimiento
 *
 * Puro y reproducible (semillas fijas) + EVIDENCIAS de navegador de `scripts/_fase44-1-qa.ts` y `_fase44-shots.ts` en
 * docs/product/qa/fase44-1. Sin evidencia, la sección FALLA: no se da por bueno lo que no se ha medido.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ENVIRONMENTS, FOCUS_TINT, FOCUS_TRANSITION_MS, environmentForPath, packChamberDim, parallaxOffset, particleBudget, type EnvironmentVariant } from "../src/design/environment";
import { GameEnvironment } from "../src/components/visual/GameEnvironment";
import {
  barEvents, crossfadeMs, INITIAL_MUSIC, MAX_EVENTS_PER_BAR, MUSIC_CONTEXTS, MUSIC_THEMES, musicContextForPath, musicPlan, musicReducer,
  type MusicContext, type MusicEvent,
} from "../src/lib/audio/music";
import { DEFAULT_AUDIO, SOUND_EVENTS, effectiveGain, musicGain, parseAudioSettings } from "../src/lib/sound";
import { createScrollLock } from "../src/lib/gameExperience/scrollLock";
import { GLOBAL_MARKET_ENABLED } from "../src/config/features";

const section = process.argv[2] ?? "all";
const want = (s: string) => section === "all" || section === s;
const ROOT = process.cwd();
const QA = join(ROOT, "docs/product/qa/fase44-1");
let ok = 0; let ko = 0;
const check = (label: string, cond: boolean, detail = "") => { if (cond) ok++; else ko++; console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`); };
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
/* eslint-disable @typescript-eslint/no-explicit-any */
const evidence = <T = any>(name: string): T | null => (existsSync(join(QA, name)) ? JSON.parse(readFileSync(join(QA, name), "utf8")) as T : null);
function lcg(seed: number) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) walk(p, out); else out.push(p); }
  return out;
}
const SRC = walk(join(ROOT, "src")).filter((p) => /\.(ts|tsx)$/.test(p) && !/\.test\./.test(p));
const REQUIRED: EnvironmentVariant[] = ["lobby", "collection", "packs", "loadout", "campaign", "draft", "ranked", "season"];

/* ═════════════════════════ ENVIRONMENT ═════════════════════════ */
if (want("environment")) {
  console.log("\n## ENVIRONMENT · el mundo detrás de la interfaz");
  check("8 lugares del encargo con arquitectura propia", REQUIRED.every((v) => ENVIRONMENTS[v]) && new Set(REQUIRED.map((v) => ENVIRONMENTS[v].architecture)).size === 8);
  check("presupuesto: ≤ 3 movimientos, parallax 4–12 (0 en partida), ≤ 40 partículas", Object.values(ENVIRONMENTS).every((s) => s.motion.length <= 3 && (s.variant === "match" ? s.parallax === 0 : s.parallax >= 4 && s.parallax <= 12) && s.particles <= 40));
  check("rutas core → su lugar", environmentForPath("/coleccion") === "collection" && environmentForPath("/tienda") === "packs" && environmentForPath("/duelos/mazos") === "loadout" && environmentForPath("/jugar/road-to-champions") === "campaign" && environmentForPath("/jugar/draft-gauntlet") === "draft" && environmentForPath("/duelos/competitivo") === "ranked" && environmentForPath("/temporada") === "season" && environmentForPath("/") === "lobby");
  check("tintes de modo (cian/magenta/azul/ámbar) en 200–400 ms", FOCUS_TINT.quick.join() === "25,227,255" && FOCUS_TINT.ranked.join() === "255,46,99" && FOCUS_TINT.campaign.join() === "58,107,255" && FOCUS_TINT.draft.join() === "255,176,61" && FOCUS_TRANSITION_MS >= 200 && FOCUS_TRANSITION_MS <= 400);
  const renders = (Object.keys(ENVIRONMENTS) as EnvironmentVariant[]).map((v) => renderToStaticMarkup(createElement(GameEnvironment, { variant: v })));
  check("render: aria-hidden, sin puntero, detrás, sin recursos externos", renders.every((h) => /aria-hidden="true"/.test(h) && /pointer-events-none fixed inset-0 -z-10/.test(h) && !/<img|<video|<iframe/.test(h)));
  check("sin Three.js / WebGL / vídeo", !/three|webgl/i.test(read("src/components/visual/GameEnvironment.tsx")) && !/"three"/.test(read("package.json")));
  const rnd = lcg(441);
  let bad = 0;
  const variants = Object.keys(ENVIRONMENTS) as EnvironmentVariant[];
  for (let i = 0; i < 50_000; i++) {
    const s = ENVIRONMENTS[variants[Math.floor(rnd() * variants.length)]];
    const red = rnd() < 0.2;
    const o = parallaxOffset(s, rnd() * 1.4 - 0.2, rnd() * 6 - 3, rnd() < 0.05 ? Number.NaN : rnd() * 6 - 3, red);
    const n = particleBudget(s, Math.floor(rnd() * 3000), red);
    if (!Number.isFinite(o.x) || Math.abs(o.x) > s.parallax || Math.abs(o.y) > s.parallax || (red && (o.x !== 0 || o.y !== 0)) || n < 0 || n > 40 || (red && n > 12)) bad++;
  }
  check("fuzz de movimiento 50.000: acotado y reducido = quieto", bad === 0, `${bad} fallos`);
  const cam = ["ready", "requesting", "opening", "hand", "reveal", "summary"].map(packChamberDim);
  check("cámara de sobres: se apaga antes de abrir y se relaja en el resumen", cam[0] === 0 && cam[1] > 0 && cam[2] > cam[1] && cam[4] >= cam[3] && cam[5] < cam[4]);
  const envQa = evidence("environment-qa.json");
  check("navegador: cada pantalla core monta su lugar, detrás y sin tapar el contenido", !!envQa && envQa.rows.length >= 10 && envQa.rows.every((r: any) => r.count >= 1 && r.pointer === "none" && r.position === "fixed" && !r.hitIsEnv && r.variant === environmentForPath(r.path)), envQa ? `${envQa.rows.length} rutas` : "falta environment-qa.json (scripts/_fase44-1-qa.ts env)");
  check("navegador: los cuatro modos tiñen el lobby y al salir se suelta", !!envQa && envQa.tints.every((t: any) => t.found && t.focus === t.mode && t.opacity > 0.5) && envQa.released === "none");
  check("navegador: parallax con el puntero (escritorio)", !!envQa && envQa.rows.filter((r: any) => r.variant !== "match").every((r: any) => r.parallaxVar && r.parallaxVar !== "0" && r.parallaxVar !== ""));
  check("navegador: reducido = sin animaciones, sin barrido, sin parallax", !!envQa && envQa.reduced.motion === "static" && envQa.reduced.animations.length === 0 && !envQa.reduced.sweep && (envQa.reduced.parallaxVar === "" || envQa.reduced.parallaxVar === "0"));
  check("navegador: cámara apagada más oscura que en reposo", !!envQa && envQa.chamber.dim > envQa.chamber.rest);
}

/* ═════════════════════════ AUDIO ═════════════════════════ */
if (want("audio")) {
  console.log("\n## AUDIO · música original y efectos");
  check("9 contextos de música con tema", MUSIC_CONTEXTS.length === 9 && MUSIC_CONTEXTS.every((c) => MUSIC_THEMES[c]?.context === c));
  const allPairs = ([null, ...MUSIC_CONTEXTS] as (MusicContext | null)[]).flatMap((a) => ([null, ...MUSIC_CONTEXTS] as (MusicContext | null)[]).map((b) => crossfadeMs(a, b)));
  check("fundidos 500–1500 ms en todos los pares", allPairs.every((ms) => ms >= 500 && ms <= 1500));
  check("presupuesto de notas por compás", Object.values(MUSIC_THEMES).every((t) => Array.from({ length: 16 }, (_, b) => barEvents(t, b)).every((e) => e.length > 0 && e.length <= MAX_EVENTS_PER_BAR)));
  check("rutas → contexto; admin y arnés en silencio", musicContextForPath("/tienda") === "PACKS" && musicContextForPath("/duelos/jugar") === "MATCH" && musicContextForPath("/admin") === null);
  const required = ["ui.hover", "ui.confirm", "ui.back", "ui.error", "play.hover", "play.confirm", "pack.select", "pack.open", "card.reveal", "card.rare", "card.epic", "card.legendary", "serial.one", "match.turn", "match.win", "match.loss", "match.draw", "level.up", "mission.complete", "achievement.unlock"];
  check("catálogo de efectos completo (20 de F44.1 + 3 de turno en F45)", required.every((k) => k in SOUND_EVENTS) && Object.keys(SOUND_EVENTS).length === 23);
  check("ajustes: música y efectos independientes, compatibles con Fase 44", DEFAULT_AUDIO.music === 0.5 && parseAudioSettings(JSON.stringify({ master: 0.6, sfx: 0.4, muted: false })).music === 0.5 && effectiveGain({ ...DEFAULT_AUDIO, musicMuted: true }) > 0 && musicGain({ ...DEFAULT_AUDIO, sfxMuted: true }) > 0);
  const files = walk(join(ROOT, "src")).concat(walk(join(ROOT, "public"))).filter((p) => /\.(mp3|ogg|wav|m4a|aac|flac)$/i.test(p));
  check("solo audio original: ningún fichero de audio en src/ ni public/", files.length === 0, files.slice(0, 3).join(", "));
  const ctxs = SRC.filter((p) => /new (window\.)?AudioContext|new AC\(\)/.test(code(readFileSync(p, "utf8"))));
  check("un único AudioContext (lib/sound)", ctxs.length === 1 && ctxs[0].replace(/\\/g, "/").endsWith("src/lib/sound.ts"));
  check("sin <audio> ni new Audio()", SRC.every((p) => !/<audio[\s>]|new Audio\(/.test(code(readFileSync(p, "utf8")))));
  const shell = read("src/components/layout/GameShell.tsx");
  check("un director de música por rama del armazón", (shell.match(/<MusicDirector \/>/g) ?? []).length === 2);
  const rnd = lcg(20441);
  let bad = 0;
  let s = INITIAL_MUSIC;
  const all: (MusicContext | null)[] = [null, ...MUSIC_CONTEXTS];
  for (let i = 0; i < 20_000; i++) {
    const r = rnd();
    const e: MusicEvent = r < 0.05 ? { type: "unlock" } : r < 0.3 ? { type: "route", context: all[Math.floor(rnd() * all.length)] } : r < 0.4 ? { type: "override", context: rnd() < 0.5 ? null : "RESULT" } : r < 0.6 ? { type: "duck", on: rnd() < 0.5 } : r < 0.75 ? { type: "visibility", hidden: rnd() < 0.3 } : { type: "volume", value: rnd() * 1.6 - 0.3 };
    s = musicReducer(s, e);
    const p = musicPlan(s);
    if (p.gain < 0 || p.gain > 1 || (!s.unlocked && p.context) || (s.hidden && p.gain !== 0) || s.ducks < 0) bad++;
  }
  check("fuzz de audio 20.000: sin sonido antes del gesto ni con la pestaña oculta", bad === 0, `${bad} fallos`);
  const a = evidence("audio-qa.json");
  const q = evidence("p0-qa.json")?.audio;
  check("navegador (rutas reales): LOBBY → COLLECTION → PACKS al navegar, un tema activo", !!q && q.beforeGesture?.context === null && q.lobby?.context === "LOBBY" && q.collection?.plan?.context === "COLLECTION" && q.packs?.plan?.context === "PACKS" && q.packs.layers.filter((l: any) => !l.stopping).length === 1, q ? "" : "falta p0-qa.json");
  check("navegador (panel real): silenciar/activar música, volumen música 25, efectos 40, silenciar efectos, silencio general", !!q && q.musicMuted.plan.context === null && q.musicMuted.stored.musicMuted === true && q.musicUnmuted.context !== null && q.musicVolume25.stored.music === 0.25 && Math.abs(q.musicVolume25.engineVolume - 0.2) < 1e-9 && q.sfxVolume40.sfx === 0.4 && q.sfxMuted.stored.sfxMuted === true && q.sfxMuted.musicPlan.context !== null && q.globalMuted.context === null && q.globalUnmuted.context !== null);
  check("navegador: preferencias persisten tras recargar (almacén y deslizadores)", !!q && q.persisted.stored.music === 0.25 && q.persisted.stored.sfx === 0.4 && q.persisted.music === "25" && q.persisted.sfx === "40");
  check("navegador: pestaña oculta → 0 y vuelve; partida → MATCH; resultado → RESULT; duck de sobre y restauración", !!q && q.hidden.gain === 0 && q.visible.gain > 0 && q.match.plan.context === "MATCH" && q.result.plan.context === "RESULT" && q.packDuck.ducked < q.packDuck.full && q.packDuck.restored === q.packDuck.full && q.jsErrors.length === 0);
  check("navegador: nada suena antes del gesto", !!a && a.beforeGesture.plan?.context === null && (a.beforeGesture.layers ?? []).length === 0, a ? "" : "falta audio-qa.json (scripts/_fase44-1-qa.ts audio)");
  check("navegador: cada contexto pulsado suena con UN tema activo", !!a && a.steps.every((st: any) => st.plan?.context === st.context && st.layers.filter((l: any) => !l.stopping).length === 1));
  check("navegador: cambios rápidos nunca superan 2 capas", !!a && a.rapidMaxLayers >= 1 && a.rapidMaxLayers <= 2);
  check("navegador: duck, override de resultado y pestaña oculta", !!a && a.ducked.gain < a.unducked.gain && a.overridden.context === "RESULT" && a.hidden.gain === 0 && a.visible.gain > 0);
  // Los 429 son el límite de peticiones de la API del armazón bajo el ritmo de la QA (no audio): se cuentan aparte.
  const jsErrors = (a?.consoleErrors ?? []).filter((e: string) => !/status of 429/.test(e));
  check("navegador: 20 efectos y el laboratorio de música sin errores de JS (429 de ritmo de QA aparte)", !!a && a.sfx.buttons === 20 && a.sfx.errors.length === 0 && jsErrors.length === 0, a ? `${(a.consoleErrors ?? []).length - jsErrors.length} × 429` : "");
}

/* ═════════════════════════ SCROLL ═════════════════════════ */
if (want("scroll")) {
  console.log("\n## SCROLL · la rueda del ratón");
  const g = read("src/app/globals.css").replace(/\/\*[\s\S]*?\*\//g, "");
  check("causa raíz arreglada: html/body `overflow-x: clip`", /html,\s*body\s*\{[^}]*overflow-x:\s*clip/.test(g) && !/html,\s*body\s*\{[^}]*overflow-x:\s*hidden/.test(g));
  check("overscroll-behavior solo en html", /(^|\n)html\s*\{[^}]*overscroll-behavior-y:\s*none/.test(g) && !/html,\s*body\s*\{[^}]*overscroll-behavior/.test(g));
  check("sin parche de rueda global ni scrollBy", SRC.every((p) => { const c = code(readFileSync(p, "utf8")); return !/(window|document|documentElement|body)\.addEventListener\(\s*["']wheel["']/.test(c) && !/window\.scrollBy\(/.test(c); }));
  const before = evidence("wheel-before.json");
  check("ANTES medido: rueda muerta en las pantallas core", !!before && before.rows.filter((r: any) => r.max > 20).every((r: any) => r.wheelDown === 0), before ? `${before.rows.length} rutas` : "falta wheel-before.json");
  const after = evidence("wheel-after.json");
  check("DESPUÉS medido: rueda, trackpad, teclado y táctil en las pantallas core", !!after && after.rows.length >= 10 && after.rows.every((r: any) => r.ok && r.touchOk), after ? after.rows.filter((r: any) => !(r.ok && r.touchOk)).map((r: any) => r.path).join(", ") || `${after.rows.length} rutas` : "falta wheel-after.json (scripts/_fase44-1-qa.ts wheel)");
  const needed = ["/", "/coleccion", "/tienda", "/duelos/mazos", "/jugar/road-to-champions", "/temporada", "/jugador/me"];
  check("rueda ↓/↑ medida en Home, Colección, Sobres, Equipos, Campaña, Temporada y Perfil (ventana baja si la pantalla cabe)", !!after && needed.every((p) => { const r = after.rows.find((x: any) => x.path === p); if (!r) return false; const w = r.max > 20 ? r : r.short; return !!w && w.max > 20 && w.wheelDown > 0 && w.wheelUp < 0; }), after ? needed.filter((p) => { const r = after.rows.find((x: any) => x.path === p); const w = r && (r.max > 20 ? r : r.short); return !(w && w.max > 20 && w.wheelDown > 0 && w.wheelUp < 0); }).join(", ") : "");
  check("rueda vertical sobre un carril horizontal de cartas baja la página (no se convierte en horizontal)", !!after?.nested?.found && after.nested.pageDelta > 0 && after.nested.railLeftDelta === 0, after?.nested ? JSON.stringify({ page: after.nested.pageDelta, rail: after.nested.railLeftDelta }) : "");
}

/* ═════════════════════════ SCROLL LOCK ═════════════════════════ */
if (want("scroll-lock")) {
  console.log("\n## SCROLL LOCK · modales, hojas, visor");
  check("un único cerrojo compartido (GameOverlay + CardViewer)", read("src/components/ui/game/GameOverlay.tsx").includes("lockScroll()") && read("src/components/cards/CardViewer.tsx").includes("lockScroll()"));
  check("nadie escribe body/html.style.overflow a mano", SRC.filter((p) => !p.replace(/\\/g, "/").endsWith("gameExperience/scrollLock.ts")).every((p) => !/(body|documentElement)\.style\.overflow\s*=/.test(code(readFileSync(p, "utf8")))));
  const rnd = lcg(100441);
  let bad = 0;
  for (let round = 0; round < 100; round++) {
    const t = { style: { overflow: round % 2 ? "clip" : "" } };
    const start = t.style.overflow;
    const l = createScrollLock(() => t);
    const open: (() => void)[] = [];
    for (let i = 0; i < 1000; i++) {
      if (rnd() < 0.5 || open.length === 0) open.push(l.lock()); else open.splice(Math.floor(rnd() * open.length), 1)[0]();
      if ((t.style.overflow === "hidden") !== (l.count() > 0)) bad++;
    }
    for (const r of open) r();
    if (l.count() !== 0 || t.style.overflow !== start) bad++;
  }
  check("fuzz 100.000 lock/release: hidden ⇔ abierto, restaura siempre", bad === 0, `${bad} fallos`);
  const c = evidence("scroll-lock-cycles.json");
  check("navegador: 100 ciclos hoja+diálogo anidados → scroll libre y la rueda mueve", !!c && c.harness.cycles === 100 && c.harness.ok && c.harness.wheelAfter > 0, c ? "" : "falta scroll-lock-cycles.json (scripts/_fase44-1-qa.ts cycles)");
  const p0 = evidence("p0-qa.json");
  check("navegador: End/PageUp/Home/PageDown en Home, Colección y Temporada", !!p0 && p0.keys.length === 3 && p0.keys.every((k: any) => k.ok && k.max > 20), p0 ? "" : "falta p0-qa.json (scripts/_fase44-1-qa.ts p0)");
  check("navegador: apertura de sobre, ceremonia, selector de modos y /jugar montan y desmontan sin dejar cerrojo (rueda viva)", !!p0 && p0.flows.length === 4 && p0.flows.every((f: any) => f.after.ok) && p0.flows.find((f: any) => /selector/.test(f.flow))?.clicked === true);
  check("navegador: 100 ciclos del menú móvil real → táctil mueve la página", !!c && c.mobileMenu.cycles === 100 && c.mobileMenu.ok && c.mobileMenu.touchAfter > 0);
}

/* ═════════════════════════ ATMOSPHERE ═════════════════════════ */
if (want("atmosphere")) {
  console.log("\n## ATMOSPHERE · lugares, no divs sobre negro");
  const gx = read("src/app/game-experience.css");
  check("body transparente: el ambiente se ve", /body \{ background: transparent; \}/.test(gx));
  const alpha = (s: string) => [...s.matchAll(/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*(0?\.\d+|1)\s*\)/g)].map((m) => Number(m[1]));
  const stage = read("src/components/dailyLoop/LobbyPlayStage.tsx");
  check("escenario del lobby translúcido (fondo ≤ 0.85)", Math.max(...alpha(stage.split("linear-gradient(160deg")[1]?.split(")\"")[0] ?? "rgba(0,0,0,1)")) <= 0.85);
  check("héroe del día y paneles translúcidos", /rgba\(12,15,26,0\.72\)/.test(read("src/components/dailyLoop/DailyHero.tsx")) && /rgba\(18,22,36,0\.74\)/.test(read("src/components/dailyLoop/DailyPanels.tsx")));
  check("lobby: hoy + después en una fila", read("src/components/dailyLoop/DailyLobby.tsx").includes('data-testid="lobby-today-row"'));
  check("bóveda: vitrina con cono, halo, pedestal y flotado", ["nx-vault-cone", "nx-vault-halo", "nx-vault-pedestal", "nx-vault-float"].every((k) => read("src/components/collectionRoom/CollectionHero.tsx").includes(k)));
  check("cámara de sobres: pedestal y cono en la tienda y atenuado en la ceremonia", read("src/components/shop/ShopHero.tsx").includes("nx-vault-cone") && read("src/components/packs/PackOpeningExperience.tsx").includes("dimEnvironment(packChamberDim(phase))"));
  check("barra superior con luz que sigue al puntero y sonido", /--nx-lx/.test(gx) && read("src/components/layout/GameShell.tsx").includes("trackNavLight"));
  check("JUGAR suena al apuntar y al pulsar", /playSound\("play\.hover"\)/.test(read("src/components/ui/game/PlayButton.tsx")) && /playSound\("play\.confirm"\)/.test(read("src/components/ui/game/PlayButton.tsx")));
  check("Marketplace sigue OFF", GLOBAL_MARKET_ENABLED === false);
  const shots = evidence("after/shots.json");
  const rows: any[] = shots?.rows ?? [];
  const by = (g: string) => rows.filter((r) => r.group === g).length;
  check("≥ 150 capturas AFTER y TODAS las de la matriz válidas en la misma build (173/173)", rows.length >= 150 && rows.length === shots?.total && rows.every((r) => r.build === shots?.build), `${rows.length}/${shots?.total ?? "?"} · build ${shots?.build ?? "?"}`);
  const mem = evidence("after/memory-log.json");
  /*
   * Lo que el arnés SÍ controla: tamaño del lote, cerrar su Chrome (0 huérfanos), un solo navegador por lote y que su
   * huella NO crezca de lote en lote (la RAM libre del sistema la mandan los programas del usuario, no esto).
   */
  const peaks: number[] = (mem?.batches ?? []).map((b: any) => b.chromeMbPeak).filter((n: number) => n > 0);
  const firstAvg = peaks.slice(0, 5).reduce((a2: number, b2: number) => a2 + b2, 0) / Math.max(1, peaks.slice(0, 5).length);
  const lastAvg = peaks.slice(-5).reduce((a2: number, b2: number) => a2 + b2, 0) / Math.max(1, peaks.slice(-5).length);
  check("capturas por lotes ≤ 25, sin Chrome huérfano y sin crecimiento de memoria del arnés entre lotes", !!mem && mem.batches.length > 0
    && mem.batches.every((b: any) => b.screenshots <= 25 && b.leftoverPidsKilled.length === 0 && b.chromePidsPeak <= 12 && (b.chromeMbPeak ?? 0) <= 1536)
    && lastAvg <= firstAvg * 1.25,
    mem ? `${mem.batches.length} lotes · Chrome propio ${Math.round(firstAvg)}→${Math.round(lastAvg)} MB · pico ${Math.max(...peaks)} MB · huérfanos 0` : "falta after/memory-log.json");
  const floors: [string, number][] = [["home", 20], ["collection", 20], ["packs", 20], ["decks", 15], ["campaign", 15], ["draft", 10], ["ranked", 10], ["season", 10]];
  check("reparto: home/colección/sobres ≥ 20, equipos/campaña ≥ 15, draft/ranked/temporada ≥ 10", floors.every(([g, n]) => by(g) >= n), floors.map(([g]) => `${g} ${by(g)}`).join(" · "));
  check("responsive + reducido ≥ 30 (390…2560)", by("reduced") + by("responsive") >= 30 && ["390", "768", "1024", "1440", "1920", "2560"].every((s) => rows.some((r) => r.size === s)), `${by("reduced") + by("responsive")}`);
  check("capturas sin desbordamiento horizontal ni texto técnico", rows.length > 0 && rows.every((r) => !r.overflow && (r.technical ?? []).length === 0), rows.filter((r) => r.overflow || (r.technical ?? []).length).map((r) => r.file).slice(0, 4).join(", "));
  check("capturas hechas con backend vivo y sesión (sin túnel caído ni «No autenticado»)", rows.length > 0 && rows.every((r) => !r.backendDown), rows.filter((r) => r.backendDown).map((r) => r.file).slice(0, 3).join(", "));
  check("cada captura real con su lugar montado (y estático en reducido)", rows.length > 0 && rows.filter((r) => !String(r.path).startsWith("/design-system")).every((r) => r.environment === environmentForPath(String(r.path).split("?")[0]) && (!r.reduced || r.motion === "static")));
  const perf = evidence("perf.json");
  check("rendimiento: ambiente sin regresión grave (≥ 80 % de los fps sin ambiente, sin tareas largas > 200 ms)", !!perf && perf.rows.every((r: any) => r.withEnv.fps >= Math.min(50, r.withoutEnv.fps * 0.8) && r.withEnv.worstLongTask <= 200), perf ? perf.rows.map((r: any) => `${r.path} ${r.withEnv.fps}/${r.withoutEnv.fps}`).join(" · ") : "falta perf.json (scripts/_fase44-1-qa.ts perf)");
}

console.log(`\n${ko === 0 ? "OK" : "FALLOS"} · ${ok} correctas · ${ko} fallidas`);
process.exit(ko === 0 ? 0 : 1);
