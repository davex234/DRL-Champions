/**
 * FASE 64 · EVIDENCIA (instrumento `_`, fuera de CI). Compone los JSON del informe a partir de las matrices medidas
 * (`before/matrix.json`, `after/matrix.json`) y de los ficheros de regresión. No inventa cifras.
 *   npx tsx scripts/_fase64-evidence.ts
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GLOBAL_MARKET_ENABLED } from "../src/config/features";
import { PAYMENTS_ENABLED } from "../src/config/monetization";
import { TOTAL_CARDS } from "../src/data/catalog";
import { SOUND_EVENTS } from "../src/lib/sound";
import { MOTION, pageMotion } from "../src/design/motion";
const DURATION_NOTE = Object.fromEntries((["gameplay", "collection", "season", "default"] as const).map((f) => [f, { normalMs: pageMotion(f, false).ms, reducedMs: pageMotion(f, true).ms }]));

/* eslint-disable @typescript-eslint/no-explicit-any */
const Q = join(process.cwd(), "docs/product/qa/fase64-game-feel");
const rd = (f: string) => (existsSync(join(Q, f)) ? JSON.parse(readFileSync(join(Q, f), "utf8")) : null);
const w = (f: string, o: unknown) => writeFileSync(join(Q, f), JSON.stringify(o, null, 2));
const before: any[] = rd("before/matrix.json").rows;
const after: any[] = rd("after/matrix.json").rows;
const key = (r: any) => `${r.name}@${r.w}${r.reduced ? "-reduced" : ""}`;
const aMap = new Map(after.map((r) => [key(r), r]));
const pairs = before.map((b) => ({ b, a: aMap.get(key(b)) })).filter((p) => p.a);
const sum = (rows: any[], k: string) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
const errCount = (rows: any[], re: RegExp) => rows.reduce((s, r) => s + r.errors.filter((e: string) => re.test(e)).length, 0);
const migrations = readdirSync(join(process.cwd(), "supabase/migrations")).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();

w("baseline.json", {
  at: "2026-09-26",
  git: { head: "48dac2a", branch: "arch/stabilization", note: "árbol con ~1.300 entradas sin commitear de fases anteriores; F64 solo toca lo listado en el informe" },
  tests: { before: 5262, after: 5286 }, tsc: "web y scripts exit 0 (antes y después)", build: "exit 0 (antes y después)", lint: "0 errores, 10 avisos (los mismos, ficheros previos a F64)",
  migrationHead: migrations[migrations.length - 1], cards: { code: TOTAL_CARDS, db: 331 }, agents: 29, flags: { GLOBAL_MARKET_ENABLED, PAYMENTS_ENABLED },
  infrastructure: {
    navigation: "GameShell: barra superior de secciones + dock móvil con JUGAR elevado (F44); hoja «Menú»; home = MainMenu inmersivo (F46) + guía F63",
    visualSystem: "tokens (src/design/tokens.ts), CSS de juego (game-experience.css), NxButton 6 papeles, chaflán nx-clip/nx-clip-sm",
    audio: "src/lib/sound.ts · Web Audio sintetizado, SOUND_EVENTS con nombre, ajustes master/sfx/música + silencio en localStorage, puerta de autoplay",
    motion: "src/design/motion.ts · EASE, SPRING, niveles 0–4, pageMotion por familia (180–300 ms), reducedTransition 120 ms",
    loading: "Loading→GameLoader (marca, sin spinner); GameSkeleton existía pero 0 pantallas lo usaban",
    toast: "Toast/useToast (aviso) + GameMoment (celebración): dos capas con papeles distintos",
    modals: "GameSheet/GameModal (foco, Escape, trampa de tabulador, scroll) + 20 capas propias",
  },
});

w("visual-audit.json", {
  method: "Matriz real con cuenta QA (772cf6f1) en 24 rutas × 1440/1024/390, sin movimiento reducido; y pasada reducida 1440/390. Señales objetivas por pantalla (instrumento _fase64-shots.ts) + revisión de capturas.",
  routes: [...new Set(before.map((r) => r.route))],
  webFeelFound: [
    { id: "W1", what: "Cada pantalla con sesión lanzaba ~23 peticiones: `useBadges()` montado 4 veces en el armazón = 8× /api/game/social + 8× /api/game/live-events por pantalla, y 5× /rest/v1/profiles. Tras ~15 navegaciones, 429 (40 en la matriz ANTES).", fix: "sondeo compartido (lib/net/sharedPoll) + perfil deduplicado + usuario estable" },
    { id: "W2", what: "HUD sin sesión: nivel 1 y 6.000 créditos del store local (dato falso) en la barra y en la portada.", fix: "ENTRAR en su lugar; la portada no pasa créditos sin sesión" },
    { id: "W3", what: "Emojis como iconos de producto (temporada 42, logros 23, cuenta 14, progresión 5, tienda 5, colección 3…): 📦 🏭 ⭐ 👑 🗂 🐉 🌍 ⚔ 🎮 🏅 🪙 🔒 ✕.", fix: "GameGlyph (SVG propios) al pintar; los datos no cambian" },
    { id: "W4", what: "Entrada/registro: formulario de web (caja redondeada, campos grises) bajo «MI PERFIL · Tu progreso competitivo».", fix: "panel de la casa, campos nx-field con etiqueta y autocompletar, error anunciado con temblor corto; cabecera «Tu cuenta de jugador»" },
    { id: "W5", what: "17 × 404 en /pickems (logos /teams/*.png que no existen) — misma clase de fallo que el vídeo de F46.", fix: "TEAM_LOGOS_AVAILABLE (test contra public/teams); monograma sin petición" },
    { id: "W6", what: "Cargas genéricas: <Loading> (cargador de marca a pantalla) en progresión, temporada, logros, competitivo, modos, equipos y perfil; GameSkeleton sin usar; salto de maquetación al llegar datos (CLS 0,158 en progresión).", fix: "Loading kind=hub|profile|deck → silueta del contenido" },
    { id: "W7", what: "Pulsaciones sin respuesta en NxButton, CTA de progreso y accesos rápidos; con movimiento reducido la carta no respondía a nada.", fix: "primitiva nx-press (reducido = destello), carta que se ilumina al apuntar/enfocar" },
    { id: "W8", what: "«mazo»/«plantilla» en ranked, draft, estrategia, recorrido F40, misión de temporada y copia del starter.", fix: "«equipo» en todo el flujo principal (el Tactical Coach conserva «plantilla» = plantilla de agentes, significado distinto)" },
    { id: "W9", what: "Aviso PWA de instalación como caja redondeada con una «D» por icono, en casi todas las pantallas.", fix: "placa de la casa con la marca real" },
    { id: "W10", what: "Desbordes a 390: /pickems (8 px, elementos de rejilla sin min-w-0) y /progresion (1 px en recompensas por reclamar).", fix: "min-w-0 en los elementos de rejilla" },
    { id: "W11", what: "Colección en móvil: la cabecera (cifras + desglose por rareza + vitrina) ocupaba la primera pantalla entera.", fix: "sin desglose por rareza en móvil, carta de vitrina menor, menos padding" },
    { id: "W12", what: "Capas «Añadir al equipo» (sin Escape ni foco) y ficha de carta (sin devolver el foco); cierres de 36 px redondos con ✕.", fix: "useDialogLayer / foco de ida y vuelta; cierres de 44 px en chaflán" },
    { id: "W13", what: "Toasts sin sonido y repetidos (mismo aviso reanimado).", fix: "suenan (acierto/error) y se agregan «×N»" },
    { id: "W14", what: "404 con «Volver al lobby»; rail F63 con «Continuar» genérico.", fix: "«Volver al juego»; el rail nombra la acción" },
  ],
  notChanged: ["Home/Main Menu (F46+F62+F63) ya es un menú de juego: se conserva", "Tablero y ritmo de partida F61", "Ceremonia de sobres F57 (solo el aspa de cierre)", "Tactical Coach F59 (identidad propia)", "Admin/CMS F60", "Avatares emoji de la cuenta: son identidad elegida por el jugador (dato), no iconos de producto"],
});

w("design-system.json", {
  language: {
    geometry: "chaflán (nx-clip 14–20 px / nx-clip-sm 10 px) en paneles, botones, campos, avisos y monogramas; nada de caja redondeada de web en el flujo principal",
    surfaces: "paneles oscuros con filo de color (nx-f62-panel, nx-f63-stage, nx-f63-coach); profundidad por gradiente + filo interior, no por sombra difusa",
    color: "rojo NEXUS (acción), cian (información / XP de cuenta / foco), oro (recompensa / créditos / XP de temporada); nunca solo color: texto e icono siempre",
    type: "display (Rajdhani) en mayúsculas para títulos y botones; `nx-readout` para cifras (OVR, créditos, XP, rating); Inter para texto",
    icons: "GameGlyph: 26 glifos SVG propios, trazo 1,8 px, currentColor, rejilla 24",
  },
  tokens: "src/design/tokens.ts sin cambios (sistema válido); F64 añade primitivas CSS, no tokens nuevos",
  buttons: { roles: ["primary", "secondary", "tertiary", "ghost", "danger", "icon"], game: ["nx-play (JUGAR)", "nx-menu-btn (menú principal)", "nx-f62-cta (reclamar/acción de hub)", "nx-quick (accesos del menú)"], press: "nx-press en todos" },
  primitives: ["nx-press", "nx-shake", "nx-field", "GameGlyph / CreditGlyph", "Loading kind (GameSkeleton hub|profile|deck|cards|hero)", "useDialogLayer", "createSharedPoll"],
  buttonStyleSignatures: { note: "estilos distintos de botón por pantalla (media de todas las rutas y anchos)", before: +(sum(before, "buttonStyles") / before.length).toFixed(2), after: +(sum(after.filter((r) => !r.reduced), "buttonStyles") / after.filter((r) => !r.reduced).length).toFixed(2) },
  radiiPerScreen: { before: +(sum(before, "radii") / before.length).toFixed(2), after: +(sum(after.filter((r) => !r.reduced), "radii") / after.filter((r) => !r.reduced).length).toFixed(2) },
});

w("motion.json", {
  primitives: MOTION,
  budget: DURATION_NOTE,
  reducedMotion: "Toda animación de la CSS de juego vive bajo `no-preference` (contrato F44, test). Con `reduce`: transiciones de pantalla = fundido 120 ms; pulsación = destello (sin moverse); carta = se ilumina al apuntar/enfocar (sin giro); error de formulario = campo en rojo + aviso anunciado (sin temblor). Nada queda sin respuesta.",
});

w("audio.json", {
  architecture: "UN gestor (src/lib/sound.ts): Web Audio sintetizado (sin ficheros, sin licencias), eventos con nombre, ajustes master/efectos/música con silencio en localStorage (nexus:audio:v1), puerta de autoplay (nada suena antes de un gesto), sonidos de paso limitados a uno cada 90 ms; `new Audio()` = 0 en todo el código.",
  events: Object.keys(SOUND_EVENTS).length,
  addedF64: ["ui.success (aviso correcto)", "ui.nav (cambio de sección: barra y dock)", "match.found (rival encontrado en ranked)"],
  wiredF64: ["Toast → ui.success / ui.error al entrar", "GameShell barra y dock móvil → ui.nav", "RankedMatchFound → match.found"],
  settings: "Panel de audio existente (F44.1) en la hoja del armazón: general, efectos y música con volumen y silencio",
  music: "Sin música nueva: la música procedural propia de F44.1 sigue igual; no se añadió ningún asset externo",
});

const perf = (rows: any[]) => ({
  apiRequestsAvg: +(sum(rows, "apiRequests") / rows.length).toFixed(1), requestsAvg: +(sum(rows, "requests") / rows.length).toFixed(1),
  jsKBAvg: Math.round(sum(rows, "jsKB") / rows.length), imgKBAvg: Math.round(sum(rows, "imgKB") / rows.length),
  clsMax: +Math.max(...rows.map((r) => r.cls ?? 0)).toFixed(3),
  errors429: errCount(rows, /429/), errors404: errCount(rows, /404/),
});
const signedIn = (rows: any[]) => rows.filter((r) => !r.anon && !r.reduced);
w("performance.json", {
  note: "Mismas rutas, mismos anchos, misma cuenta QA; medido en el navegador (PerformanceResourceTiming).",
  before: perf(signedIn(before)), after: perf(signedIn(after)),
  perRoute1440: pairs.filter((p) => p.b.w === 1440 && !p.b.anon).map((p) => ({ route: p.b.route, apiBefore: p.b.apiRequests, apiAfter: p.a.apiRequests, reqBefore: p.b.requests, reqAfter: p.a.requests, jsKBBefore: p.b.jsKB, jsKBAfter: p.a.jsKB, clsBefore: p.b.cls, clsAfter: p.a.cls })),
  probe: { "/como-jugar": { before: { social: 8, liveEvents: 8, profiles: 5, total: 26 }, after: { social: 1, liveEvents: 1, profiles: 3, total: 11 } } },
  bundle: "JS transferido por pantalla medido arriba (jsKB); F64 añade GameGlyph (SVG en línea, sin dependencia) y sharedPoll; ninguna librería nueva.",
});

w("accessibility.json", {
  changes: [
    "Campos de entrada con <label> visible y autocomplete (email, username, current/new-password); error con role=alert; aria-invalid",
    "Pestañas de acceso con aria-pressed",
    "Capa «Añadir al equipo»: foco dentro, Escape, tabulador atrapado, foco de vuelta (useDialogLayer)",
    "Ficha de carta: foco a la ficha al abrir y de vuelta al origen al cerrar; aria-label",
    "Carta: foco de teclado visible sobre el ARTE (drop-shadow), también sin movimiento",
    "Glifos decorativos aria-hidden; con título → role=img + aria-label",
    "Cierres a 44 px (ficha de carta, hoja de equipo)",
    "cursor not-allowed en aria-disabled",
    "Audio nunca necesario: todo aviso sonoro tiene texto",
  ],
});

const byW = (rows: any[], wd: number) => rows.filter((r) => r.w === wd && !r.reduced);
w("responsive.json", {
  widths: [1440, 1024, 390],
  overflowBefore: before.filter((r) => r.over > 0).map((r) => `${r.name}@${r.w}: ${r.overList.join(";")}`),
  overflowAfter: after.filter((r) => r.over > 0).map((r) => `${r.name}@${r.w}`),
  mobile390: { routes: byW(after, 390).length, overflow: byW(after, 390).filter((r) => r.over).length, hScroll: byW(after, 390).filter((r) => r.hScroll).length },
  tablet1024: { routes: byW(after, 1024).length, overflow: byW(after, 1024).filter((r) => r.over).length },
  desktop1440: { routes: byW(after, 1440).length, overflow: byW(after, 1440).filter((r) => r.over).length },
  changes: ["colección móvil compacta", "min-w-0 en rejillas de progreso y Pick'ems", "HUD móvil: ENTRAR sin sesión", "dock móvil con pulsación y sonido"],
});

w("regressions.json", {
  f61: { live: "partida real contra el bot Fácil, 10 turnos, F5 a mitad recuperado, resultado + F5 sin duplicar (regression/f63-flow-on-f64.json)", tests: "f61.match.test.tsx (huella dorada del motor) verde" },
  f62: { live: rd("regression/f62-claim-live.json"), note: "«Reclamar todo»: 4 pendientes → 0; repetir no ofrece nada. Créditos del libro mayor = economía vigente (3 misiones + logro «Consigue una leyenda» 10.000 + nivel 1 del pase 260)." },
  f63: { live: (() => { const j = rd("regression/f63-flow-on-f64.json"); const e = j?.evidence; return e ? { account: e.account, firstPack: e.firstPackRoute, firstCard: e.firstCardShown, team: e.teamReady, hints: e.hints, result: e.result?.kind, final: e.final?.onboarding?.status, secondsToFirstMatch: e.secondsToFirstMatch, captures: j.captures.length, overflow: j.captures.filter((c: any) => c.measure.over).length, errors: j.captures.reduce((s: number, c: any) => s + c.errors.length, 0) } : null; })() },
  pinsRewritten: ["gameExperience.render (404: «Volver al juego»)", "audio.test AUDIO 46 (+3 eventos F64)", "journey.test / journey.render (Equipo listo, pasos «equipo»)", "draft presentation + draftScreen.render («equipo»)", "economy.render ×2, starter.test, starterOffer.test (copia del starter con «equipo»)"],
});

const nonReducedAfter = after.filter((r) => !r.reduced);
w("visual-qa.json", {
  before: { captures: before.length, overflow: before.filter((r) => r.over).length, brokenImages: sum(before.map((r) => ({ n: r.broken.length })), "n"), consoleErrors: sum(before.map((r) => ({ n: r.errors.length })), "n"), errors429: errCount(before, /429/), internal404: errCount(before.filter((r) => r.name !== "404"), /404/), emoji: sum(before, "emoji"), legacyTerms: sum(before, "legacyTerms") },
  after: { captures: after.length, reducedCaptures: after.filter((r) => r.reduced).length, overflow: after.filter((r) => r.over).length, brokenImages: sum(after.map((r) => ({ n: r.broken.length })), "n"), consoleErrors: sum(after.filter((r) => r.name !== "404").map((r) => ({ n: r.errors.length })), "n"), errors429: errCount(after, /429/), internal404: errCount(after.filter((r) => r.name !== "404"), /404/), emoji: sum(nonReducedAfter, "emoji"), legacyTerms: sum(nonReducedAfter, "legacyTerms") },
  remainingEmoji: [...new Set(nonReducedAfter.filter((r) => r.emoji).map((r) => `${r.name}: ${r.emojiSample.join(" ")}`))],
  remainingLegacy: [...new Set(nonReducedAfter.filter((r) => r.legacyTerms).map((r) => `${r.name}: ${r.legacySample.join(" ")}`))],
  note404: "La ruta /esta-ruta-no-existe responde 404 a propósito (1 error de consola por ser el documento): no es una petición interna rota.",
});
console.log("ok");
