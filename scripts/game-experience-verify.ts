/**
 * FASE 44 · VERIFICADOR DE GAME EXPERIENCE 4.0
 *
 *   npm run game-experience:verify                 (todo)
 *   npm run game-experience-<sección>:verify       navigation · motion · packs · play · accessibility · responsive · performance · copy
 *
 * Puro y reproducible: dominio y presentación del código, fuzzers deterministas (semillas fijas) y las EVIDENCIAS de
 * navegador que dejan los instrumentos `_fase44-*` en docs/product/qa/fase44 (responsive, accesibilidad, capturas,
 * rendimiento). Si una evidencia no existe, la sección lo dice y FALLA: no se da por bueno lo que no se ha medido.
 * Escribe los JSON de máquina que pide el encargo.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NAV_SECTIONS, MOBILE_NAV, isImmersive, sectionForPath } from "../src/design/nav";
import { CLICK_DEPTH, CORE_SCREENS, PLAY_HREF, effectiveExits, isDeadEnd, mobileMenu, playCta, shellSections, shellVisible, type PlayStatusView } from "../src/design/gameShell";
import { MOTION, MOTION_LEVELS, pageMotion, transitionFamily, type MotionLevel } from "../src/design/motion";
import { GAME_EXPERIENCE_MAP } from "../src/design/gameExperienceMap";
import { EMPTY_MOMENTS, MAX_QUEUE, MOMENT_COPY, momentsReducer, type MomentKind, type MomentState } from "../src/lib/gameExperience/moments";
import { xpTimeline } from "../src/lib/gameExperience/xp";
import { INITIAL_REVEAL, buildRevealPlan, hasResult, revealReducer, type RevealEvent, type RevealState } from "../src/domain/packs/reveal";
import { pickUiReducer, type PickUi } from "../src/lib/draft/presentation";
import { PackOpenStage } from "../src/components/packs/PackOpenStage";
import { PlayButton } from "../src/components/ui/game/PlayButton";
import { GameLoader } from "../src/components/ui/game/GameLoader";
import { XpProgress } from "../src/components/ui/game/XpProgress";
import { PackSummary } from "../src/components/packs/PackSummary";
import { SCENES as PACK_SCENES } from "../src/app/design-system/fase38/fixtures";
import { CARDS, getCard, getPlayer } from "../src/data/catalog";
import { checkExpectedPrice, validExpectedPrice } from "../src/domain/packs/priceConfirm";
import { totalXpForLevel } from "../src/domain/progression/levels";
import { GameError, TECHNICAL_PATTERN } from "../src/components/ui/game/GameStates";
import { PACKS } from "../src/data/packs";
import { GLOBAL_MARKET_ENABLED } from "../src/config/features";

const section = process.argv[2] ?? "all";
const want = (s: string) => section === "all" || section === s;
const ROOT = process.cwd();
const QA = join(ROOT, "docs/product/qa/fase44");
mkdirSync(QA, { recursive: true });
let ok = 0; let ko = 0;
const check = (label: string, cond: boolean, detail = "") => { if (cond) ok++; else ko++; console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`); };
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const json = (name: string, data: unknown) => writeFileSync(join(QA, name), JSON.stringify(data, null, 2) + "\n");
const evidence = <T,>(name: string): T | null => (existsSync(join(QA, name)) ? JSON.parse(readFileSync(join(QA, name), "utf8")) as T : null);
function lcg(seed: number) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

function routeExists(href: string): boolean {
  const path = href.split(/[?#]/)[0];
  let dir = join(ROOT, "src", "app");
  for (const seg of path.split("/").filter(Boolean)) {
    const next = join(dir, seg);
    if (existsSync(next)) { dir = next; continue; }
    const dyn = existsSync(dir) ? readdirSync(dir).find((d) => /^\[[^.\]]+\]$/.test(d)) : undefined;
    if (!dyn) return false;
    dir = join(dir, dyn);
  }
  return existsSync(join(dir, "page.tsx"));
}

/* ═════════════════════════ SHELL ═════════════════════════ */
if (want("shell")) {
  console.log("\n## SHELL · armazón de juego");
  const shell = read("src/components/layout/GameShell.tsx");
  check("JUGAR en la barra (escritorio) y en el centro del dock (móvil)", shell.includes('size="bar"') && shell.includes('size="dock"'));
  check("hoja «Menú» móvil con todas las secciones", shell.includes("<MobileMenuSheet") && mobileMenu().length === NAV_SECTIONS.length);
  check("MotionConfig reducedMotion=user en armazón e inmersivas", (shell.match(/<MotionConfig reducedMotion="user">/g) ?? []).length === 2);
  check("momentos de juego disponibles en todas las pantallas (abajo en las inmersivas)", (shell.match(/<GameMomentProvider[ >]/g) ?? []).length === 2 && shell.includes('<GameMomentProvider placement="bottom">'));
  check("saltar al contenido (teclado)", shell.includes('href="#contenido"') && shell.includes('id="contenido"'));
  check("orden de secciones: colección, equipos, sobres, temporada, mundo", shellSections().map((s) => s.id).join(",") === "coleccion,equipos,tienda,progreso,mundo");
  const core = GAME_EXPERIENCE_MAP.filter((r) => r.core);
  check("mapa de experiencia: ≥ 15 pantallas core con problema, objetivo y nivel", core.length >= 15 && core.every((r) => r.gameFeelProblem && r.targetExperience && r.primaryAction));
  json("game-experience-map.json", { generatedAt: new Date().toISOString(), rows: GAME_EXPERIENCE_MAP });
}

/* ═════════════════════════ NAVIGATION ═════════════════════════ */
if (want("navigation")) {
  console.log("\n## NAVIGATION · fuzz de 100.000 secuencias");
  const nodes = new Set<string>(["/", PLAY_HREF]);
  for (const s of NAV_SECTIONS) { nodes.add(s.href); for (const it of s.items) nodes.add(it.href); }
  for (const m of MOBILE_NAV) nodes.add(m.href);
  for (const c of CORE_SCREENS) { nodes.add(c.path); for (const x of c.exits) nodes.add(x); }
  const resumeHrefs = ["/duelos/jugar", "/duelos/pvp?match=qa", "/duelos/jugar?campaign=c1-n2", "/jugar/draft-gauntlet"];
  const actionsFrom = (route: string, status: PlayStatusView | null): string[] => {
    const out: string[] = [];
    if (shellVisible(route)) {
      out.push("/", playCta(status).href);
      for (const s of NAV_SECTIONS) { out.push(s.href); for (const it of s.items) out.push(it.href); }
      for (const m of MOBILE_NAV) out.push(m.href);
    }
    const screen = CORE_SCREENS.filter((c) => route === c.path || route.startsWith(`${c.path}/`) || route.startsWith(`${c.path}?`)).sort((a, b) => b.path.length - a.path.length)[0];
    if (screen) out.push(...screen.exits);
    return [...new Set(out)];
  };
  const rnd = lcg(44_100);
  const V = { invalidRoute: 0, deadEnd: 0, marketplace: 0, lostActiveMatch: 0, redirectLoop: 0, immersiveWithoutExit: 0 };
  const samples: string[] = [];
  let steps = 0;
  for (let run = 0; run < 100_000; run++) {
    let route = "/";
    const history: string[] = [];
    const active = rnd() < 0.35 ? resumeHrefs[Math.floor(rnd() * resumeHrefs.length)] : null;
    const status: PlayStatusView | null = active ? { resume: { id: "resume", label: "Continuar partida", href: active, eyebrow: "En curso", title: "t" } } : rnd() < 0.5 ? null : { resume: null };
    const len = 3 + Math.floor(rnd() * 10);
    for (let i = 0; i < len; i++) {
      steps++;
      let acts = actionsFrom(route, status);
      if (history.length && rnd() < 0.15) acts = [history[history.length - 1]]; // atrás
      if (acts.length === 0) { V.deadEnd++; if (samples.length < 5) samples.push(`sin salida en ${route}`); if (isImmersive(route)) V.immersiveWithoutExit++; break; }
      const next = acts[Math.floor(rnd() * acts.length)];
      if (!routeExists(next) && next !== "/abrir" && next !== "/coleccion/carta") { V.invalidRoute++; if (samples.length < 5) samples.push(`ruta inexistente ${next}`); }
      if (next.startsWith("/mercado")) V.marketplace++;
      if (active && shellVisible(next) && playCta(status).href !== active) V.lostActiveMatch++;
      if (next === route && acts.length === 1 && !history.length) V.redirectLoop++;
      history.push(route); route = next;
      void sectionForPath(route);
    }
  }
  const total = Object.values(V).reduce((a, b) => a + b, 0);
  check("100.000 secuencias sin rutas inexistentes", V.invalidRoute === 0, String(V.invalidRoute));
  check("sin callejones sin salida", V.deadEnd === 0, String(V.deadEnd));
  check("ningún paso al Mercado (cerrado)", V.marketplace === 0 && GLOBAL_MARKET_ENABLED === false);
  check("con partida abierta, el armazón SIEMPRE ofrece continuarla", V.lostActiveMatch === 0);
  check("sin bucles de redirección", V.redirectLoop === 0);
  json("navigation-fuzz.json", { generatedAt: new Date().toISOString(), seed: 44_100, sequences: 100_000, steps, nodes: nodes.size, violations: V, totalViolations: total, samples });
  const deadEnds = CORE_SCREENS.map((s) => ({ path: s.path, screen: s.screen, immersive: s.immersive, exits: effectiveExits(s), deadEnd: isDeadEnd(s) }));
  check("detector de callejones: 0 pantallas core sin salida", deadEnds.every((d) => !d.deadEnd), String(deadEnds.filter((d) => d.deadEnd).length));
  json("dead-end-report.json", { generatedAt: new Date().toISOString(), screens: deadEnds, deadEnds: deadEnds.filter((d) => d.deadEnd).length, clickDepth: CLICK_DEPTH });
  check("profundidad: jugar a 1 clic; núcleo ≤ 2", CLICK_DEPTH.every((c) => (c.goal.startsWith("Jugar (") ? c.clicks === 1 : c.clicks <= 2)));
}

/* ═════════════════════════ MOTION ═════════════════════════ */
if (want("motion")) {
  console.log("\n## MOTION · jerarquía, presupuesto y fuzz de estados");
  check("tokens duration.fast/normal/game/celebration", ["fast", "normal", "game", "celebration"].every((k) => k in MOTION));
  check("niveles 0–4 con presupuesto creciente ≤ 1,2 s", ([0, 1, 2, 3, 4] as MotionLevel[]).every((l, i, a) => MOTION_LEVELS[l].maxMs <= 1200 && (i === 0 || MOTION_LEVELS[l].maxMs >= MOTION_LEVELS[a[i - 1]].maxMs)));
  check("transiciones de pantalla 150–350 ms y reducidas ≤ 120 ms", (["gameplay", "collection", "season", "default"] as const).every((f) => pageMotion(f, false).ms >= 150 && pageMotion(f, false).ms <= 350 && pageMotion(f, true).ms <= 120));
  check("cuatro familias de transición", new Set(["/jugar", "/coleccion", "/temporada", "/mundo", "/duelos/mazos", "/logros"].map(transitionFamily)).size === 4);
  const css = read("src/app/game-experience.css");
  const anims = [...css.matchAll(/animation:\s*nx-[a-z-]+/g)].map((m) => m[0]);
  const safe = [...css.matchAll(/@media \(prefers-reduced-motion: no-preference\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]).join("\n");
  check("toda animación de juego apagada con movimiento reducido", anims.length > 0 && anims.every((a) => safe.includes(a)), `${anims.length} animaciones`);

  const rnd = lcg(44_200);
  const kinds = Object.keys(MOMENT_COPY) as MomentKind[];
  const M = { stuckOverlay: 0, twoVisible: 0, queueOverflow: 0, neverExpires: 0 };
  for (let run = 0; run < 10_000; run++) {
    let s: MomentState = EMPTY_MOMENTS; let now = 0; const reduced = rnd() < 0.3;
    for (let i = 0; i < 14; i++) {
      now += Math.floor(rnd() * 1800);
      const r = rnd();
      s = r < 0.5 ? momentsReducer(s, { type: "push", moment: { key: `k${Math.floor(rnd() * 9)}`, kind: kinds[Math.floor(rnd() * kinds.length)], fact: "hecho" }, now, reduced })
        : r < 0.65 ? momentsReducer(s, { type: "dismiss", now, reduced }) : momentsReducer(s, { type: "tick", now, reduced });
      if (s.queue.length > MAX_QUEUE) M.queueOverflow++;
      if (s.visible && s.visible.expiresAt - s.visible.shownAt > 3200) M.neverExpires++;
      if (!s.visible && s.queue.length) M.twoVisible++;
    }
    for (let i = 0; i < MAX_QUEUE + 2; i++) { now += 4000; s = momentsReducer(s, { type: "tick", now, reduced }); }
    if (s.visible || s.queue.length) M.stuckOverlay++;
  }
  check("momentos · 10.000 secuencias: sin rótulo pegado ni cola desbordada", Object.values(M).every((v) => v === 0), JSON.stringify(M));

  const R = { animationLock: 0, doubleRequest: 0, resultBeforeServer: 0, skipIgnored: 0, cannotLeaveSummary: 0 };
  const events = (s: RevealState): RevealEvent[] => [
    { type: "OPEN_REQUESTED" }, { type: "OPEN_SUCCEEDED", count: 5, repeated: rnd() < 0.1 }, { type: "OPEN_FAILED", failure: { kind: "NETWORK", title: "t", message: "m", retryable: true } as never },
    // F81 · el vocabulario de la cinemática (intro → tensión → hero → quieta → resto), con los gestos y los relojes.
    { type: "INTRO_DONE" }, { type: "BUILDUP_DONE" }, { type: "HERO_SHOWN" }, { type: "ADVANCE" }, { type: "CONTINUE" }, { type: "REST_DONE" }, { type: "SKIP" }, { type: "DISMISS_ERROR" }, ...(s.phase === "summary" ? [{ type: "RESET" } as RevealEvent] : []),
  ];
  for (let run = 0; run < 10_000; run++) {
    let s = INITIAL_REVEAL;
    for (let i = 0; i < 20; i++) {
      const ev = events(s)[Math.floor(rnd() * events(s).length)];
      const prev = s;
      s = revealReducer(s, ev);
      if (ev.type === "OPEN_REQUESTED" && prev.phase !== "ready" && s.requests > prev.requests) R.doubleRequest++;
      if (s.count > 0 && prev.count === 0 && ev.type !== "OPEN_SUCCEEDED" && ev.type !== "RECOVERED") R.resultBeforeServer++;
      if (ev.type === "SKIP" && hasResult(prev) && s.phase !== "summary") R.skipIgnored++;
      // F81 · sin estados imposibles: ninguna fase de cinemática sin resultado.
      if (["opening", "buildup", "hero", "hero_hold", "rest"].includes(s.phase) && s.count <= 0) R.animationLock++;
    }
    // Desde cualquier estado con resultado se llega al resumen y desde el resumen se sale.
    if (hasResult(s)) { const t = revealReducer(s, { type: "SKIP" }); if (t.phase !== "summary") R.animationLock++; else if (revealReducer(t, { type: "RESET" }).phase !== "ready") R.cannotLeaveSummary++; }
  }
  check("ceremonia · 10.000 secuencias: SALTAR siempre funciona, 1 petición por gesto, nada antes del servidor", Object.values(R).every((v) => v === 0), JSON.stringify(R));

  const D = { stuck: 0, invalidIndex: 0 };
  for (let run = 0; run < 10_000; run++) {
    let s: PickUi = { phase: "browse" }; const n = 3;
    for (let i = 0; i < 12; i++) {
      const r = rnd();
      s = pickUiReducer(s, r < 0.4 ? { type: "select", index: Math.floor(rnd() * 5) - 1 } : r < 0.6 ? { type: "cancel" } : r < 0.8 ? { type: "send" } : { type: "settled" }, n);
      if (s.phase !== "browse" && (s.index < 0 || s.index >= n)) D.invalidIndex++;
    }
    if (pickUiReducer(pickUiReducer(s, { type: "settled" }, n), { type: "cancel" }, n).phase !== "browse") D.stuck++;
  }
  check("draft · 10.000 secuencias: la elección nunca se queda bloqueada", Object.values(D).every((v) => v === 0), JSON.stringify(D));

  let xpBad = 0;
  for (let i = 0; i < 10_000; i++) { const t = xpTimeline(Math.floor(rnd() * 80_000), Math.floor(rnd() * 5000)); if (t.segments.some((g) => g.from > g.to || g.from < 0 || g.to > 1)) xpBad++; }
  check("XP · 10.000 timelines: la barra nunca retrocede ni se sale", xpBad === 0);
  json("motion-fuzz.json", { generatedAt: new Date().toISOString(), transitions: 10_000 * 4, moments: { sequences: 10_000, violations: M }, reveal: { sequences: 10_000, violations: R }, draft: { sequences: 10_000, violations: D }, xp: { timelines: 10_000, violations: xpBad }, totalViolations: Object.values(M).concat(Object.values(R), Object.values(D), [xpBad]).reduce((a, b) => a + b, 0) });
}

/* ═════════════════════════ PACKS ═════════════════════════ */
if (want("packs")) {
  console.log("\n## PACKS · inventario, ceremonia y autoridad");
  const active = PACKS.filter((p) => p.lifecycle === "ACTIVE");
  let stageOk = 0;
  for (const p of active) {
    const h = renderToStaticMarkup(createElement(PackOpenStage, { pack: p, packId: p.id, total: 1 }));
    if (h.includes(`href="/abrir/${p.id}"`) && (h.match(/data-cta="primary"/g) ?? []).length === 1 && /Abrir sobre/.test(h)) stageOk++;
  }
  check(`ABRIR SOBRE dominante en los ${active.length} sobres activos`, stageOk === active.length);
  const summary = read("src/components/packs/PackSummary.tsx");
  /*
   * El resumen se RENDERIZA (antes se buscaba el literal `className="sticky bottom-0`, que dejó de existir en F63 cuando el
   * dock pasó a ser estático SOLO con la guía de la primera sesión delante, porque en 390 px tapaba sus botones). Se exige:
   * sin guía, dock PEGADO; con guía, dock en su sitio; y en los dos, ABRIR OTRO (si quedan), COLECCIÓN y JUGAR.
   */
  const scene = PACK_SCENES["summary-open-another"];
  const docks = scene?.kind === "summary" ? (() => {
    const plan = buildRevealPlan(scene.plan.opened, scene.plan.before, { cards: CARDS, getCard, getPlayer });
    const props = { packName: "Sobre", plan, available: scene.available, packsLeft: scene.packsLeft, onOpenAnother: () => {}, onNavigate: () => {} };
    return { sticky: renderToStaticMarkup(createElement(PackSummary, props)), guided: renderToStaticMarkup(createElement(PackSummary, { ...props, dockStatic: true, lead: "Guía" })) };
  })() : null;
  const dockActions = (h: string) => ["summary-open-another", "summary-view-collection", "summary-play"].every((id) => h.includes(`data-testid="${id}"`));
  check("resumen: dock pegado con ABRIR OTRO, COLECCIÓN y JUGAR",
    !!docks && /data-dock="sticky"/.test(docks.sticky) && /class="sticky bottom-0[^"]*"/.test(docks.sticky) && dockActions(docks.sticky),
    docks ? "" : "falta la escena QA summary-open-another");
  check("resumen con la guía de primera sesión: dock en su sitio (no tapa la guía) y las MISMAS acciones",
    !!docks && /data-dock="static"/.test(docks.guided) && /class="relative bottom-0[^"]*"/.test(docks.guided) && dockActions(docks.guided) && docks.guided.includes('data-testid="summary-lead"'));
  check("resumen sin valor en monedas ni venta", !/quickSell|Vender|🪙|valor de mercado/i.test(code(summary)));
  const reveal = code(read("src/components/packs/CardReveal.tsx"));
  check("legendaria / serial #1: luz de sala nivel 4 SOLO tras revelar", reveal.includes('{revealed && (item?.rarity === "legendary" || numberOne) && ('));
  const s1 = revealReducer(revealReducer(INITIAL_REVEAL, { type: "OPEN_REQUESTED" }), { type: "OPEN_REQUESTED" });
  check("doble clic en ABRIR = 1 petición", s1.requests === 1);
  check("sin resultado del servidor no hay cartas que anticipar", !hasResult(s1) && s1.count === 0);
  const route = read("src/app/api/game/packs/route.ts");
  /*
   * ICON (2026-10-09) añadió `expectedPrice` (el precio que el jugador VIO). Sigue sin haber cambio de autoridad: el
   * servidor cobra SIEMPRE su precio y `expectedPrice` solo puede BLOQUEAR el cobro (409 sin cobrar). Se comprueba eso,
   * no una lista de campos de antes del cambio.
   */
  const packsSvc = read("src/server/services/packs.ts");
  const buy = packsSvc.slice(packsSvc.indexOf("export async function buyPack("), packsSvc.indexOf('sb.rpc("app_buy_pack"'));
  check("ruta de sobres: solo POST y campos cerrados (sin cambios de autoridad)",
    /export async function POST\(/.test(route) && !/export async function (GET|PUT|PATCH|DELETE)\(/.test(route)
    && route.includes('const ALLOWED = ["action", "packId", "ref", "expectedPrice"];') && route.includes("if (Object.keys(body).some((k) => !ALLOWED.includes(k))) {"));
  check("expectedPrice solo bloquea: forma validada, prohibido al abrir, comprobado ANTES de cobrar y se cobra el precio del servidor",
    route.includes('if (!validExpectedPrice(body.expectedPrice) || (action === "open" && body.expectedPrice !== undefined)) {')
    && buy.includes("const seen = checkExpectedPrice(pack, opts.expectedPrice);") && buy.includes("if (!seen.ok) return fail(seen.error, seen.status);")
    && packsSvc.includes("p_price: pack.price,") && !/p_price:\s*(opts\.)?expectedPrice/.test(packsSvc));
  const icon = { id: "icon", price: 80_000 }, std = { id: "standard", price: 1_000 };
  check("precio cambiado o sin confirmar en ICON → 409 sin cobrar; mismo precio → se cobra",
    checkExpectedPrice(icon, 80_000).ok && !checkExpectedPrice(icon, 60_000).ok && (checkExpectedPrice(icon, 60_000) as { code?: string }).code === "PRICE_CHANGED"
    && (checkExpectedPrice(icon, undefined) as { code?: string }).code === "PRICE_CONFIRMATION_REQUIRED" && checkExpectedPrice(std, undefined).ok
    && !validExpectedPrice(-1) && !validExpectedPrice(1.5) && !validExpectedPrice("80000") && validExpectedPrice(undefined));
}

/* ═════════════════════════ PLAY ═════════════════════════ */
if (want("play")) {
  console.log("\n## PLAY · JUGAR global y CONTINUAR PARTIDA");
  const route = read("src/app/api/game/play-status/route.ts");
  const svc = code(read("src/server/services/playStatus.ts"));
  check("play-status: solo GET, sin parámetros, usuario del Bearer", /export async function GET\(/.test(route) && !/export (async )?function (POST|PUT|PATCH|DELETE)\b/.test(route) && route.includes("getSession(req)") && route.includes("[...q.keys()].length > 0"));
  check("play-status: solo lectura y misma prioridad que el vestíbulo", svc.includes("readActiveMatches(sb, userId)") && svc.includes("primaryResume(read.matches)") && !/\.(insert|update|upsert|delete)\(|\.rpc\(/.test(svc));
  check("play-status: fallo → nunca afirma partida", svc.includes("resume: null, unknown: true"));
  check("sin partida → JUGAR; con partida → CONTINUAR; desconocido → JUGAR", playCta(null).kind === "play" && playCta({ resume: { id: "r", label: "x", href: "/duelos/jugar", eyebrow: "e", title: "t" } }).kind === "resume" && playCta({ resume: { id: "r", label: "x", href: "/duelos/jugar", eyebrow: "e", title: "t" }, unknown: true }).kind === "play");
  const btn = renderToStaticMarkup(createElement(PlayButton, { cta: playCta(null), size: "bar" }));
  check("JUGAR: enlace real con nombre accesible y marca de acción de juego", /href="\/jugar"/.test(btn) && /aria-label="Jugar/.test(btn) && /data-game-cta="play"/.test(btn));
  type ShotRow = { id: string; size: string; real: boolean; reduced?: boolean; playInView: number; playCount: number; path: string };
  const afterDir = join(QA, "after");
  const shotFiles = existsSync(afterDir) ? readdirSync(afterDir).filter((f) => /^shots.*\.json$/.test(f)) : [];
  const shots = shotFiles.length ? { rows: shotFiles.flatMap((f) => (JSON.parse(readFileSync(join(afterDir, f), "utf8")) as { rows: ShotRow[] }).rows) } : null;
  const coreIds = ["home", "play", "duels", "ranked", "campaign", "draft", "shop", "packs", "inventory", "collection", "card-detail", "decks", "season", "pass", "progression", "events", "pickems", "profile", "account", "social", "rewards", "not-found"];
  const rows = (shots?.rows ?? []).filter((r) => r.real && coreIds.includes(r.id));
  const failing = rows.filter((r) => !(r.playInView > 0));
  check("visibilidad de JUGAR medida en navegador (capturas AFTER)", rows.length > 0, rows.length ? `${rows.length} capturas` : "falta docs/product/qa/fase44/after/shots.json");
  check("JUGAR visible (o a un toque) en todas las pantallas core medidas", rows.length > 0 && failing.length === 0, failing.map((r) => `${r.id}@${r.size}`).join(", "));
  json("play-visibility.json", { generatedAt: new Date().toISOString(), source: shots ? "after/shots.json" : null, screens: rows.map((r) => ({ id: r.id, path: r.path, size: r.size, playInView: r.playInView, playCount: r.playCount, ok: r.playInView > 0 })), failing: failing.length });
}

/* ═════════════════════════ ACCESSIBILITY ═════════════════════════ */
if (want("accessibility")) {
  console.log("\n## ACCESSIBILITY · teclado, foco, lectores y táctil");
  const css = read("src/app/game-experience.css");
  check("foco visible propio del botón JUGAR", css.includes(".nx-play:focus-visible { outline: 3px solid #fff;"));
  check("JUGAR ≥ 44 px en todos sus tamaños (46/76/72)", /data-size="bar"\] \{ height: 46px/.test(css) && /min-height: 76px/.test(css) && /width: 72px; height: 72px/.test(css));
  const overlay = read("src/components/ui/game/GameOverlay.tsx");
  check("capas: role=dialog, aria-modal, Escape, foco atrapado y devuelto", overlay.includes('role="dialog"') && overlay.includes('aria-modal="true"') && overlay.includes('e.key === "Escape"') && overlay.includes("opener.focus()"));
  check("momentos y toasts anunciados (aria-live)", read("src/components/ui/game/GameMoment.tsx").includes('aria-live="polite"') && read("src/components/ui/Toast.tsx").includes('aria-live="polite"'));
  const loader = renderToStaticMarkup(createElement(GameLoader, { label: "Cargando" }));
  check("cargador anunciado (role=status)", loader.includes('role="status"'));
  /*
   * La barra de XP se RENDERIZA y se lee su `aria-label` real (antes se buscaba una plantilla del código fuente, que dejó
   * de existir al pasar el texto a i18n aunque la barra siguiera siendo accesible). Dos casos: subida de nivel y no.
   */
  const xpBar = (xp: number, gained: number) => renderToStaticMarkup(createElement(XpProgress, { xp, gained }));
  const barLabel = (h: string) => /role="progressbar"[^>]*aria-label="([^"]*)"|aria-label="([^"]*)"[^>]*role="progressbar"/.exec(h);
  const up = xpBar(totalXpForLevel(8) + 40, 110), flat = xpBar(totalXpForLevel(8) + 400, 110);
  const upLabel = barLabel(up), flatLabel = barLabel(flat);
  const said = (m: RegExpExecArray | null) => (m ? m[1] ?? m[2] ?? "" : "");
  check("XP con texto además de animación: la barra dice nivel, % y si subiste",
    /aria-valuenow="\d+"/.test(up) && /^Nivel 8, \d+% hacia el siguiente; has subido un nivel$/.test(said(upLabel)) && /^Nivel 8, \d+% hacia el siguiente$/.test(said(flatLabel)),
    `«${said(upLabel)}» / «${said(flatLabel)}»`);
  check("rating con texto además de animación", read("src/components/duel/pvp/PvpOutcome.tsx").includes('data-field="newRating"'));
  const matrix = evidence<{ flows: { name: string; ok: boolean }[]; blockers: number }>("accessibility-matrix.json");
  check("matriz de teclado medida en navegador", !!matrix, matrix ? `${matrix.flows.length} flujos` : "falta accessibility-matrix.json (scripts/_fase44-a11y.ts)");
  check("matriz de teclado sin bloqueos", !!matrix && matrix.blockers === 0, matrix ? String(matrix.blockers) : "");
}

/* ═════════════════════════ RESPONSIVE ═════════════════════════ */
if (want("responsive")) {
  console.log("\n## RESPONSIVE · 320 → 2560");
  const m = evidence<{ widths: number[]; rows: unknown[]; blockers: number; reducedRows?: number }>("responsive-matrix.json");
  check("matriz responsive medida en navegador", !!m, m ? `${m.rows.length} mediciones` : "falta responsive-matrix.json (scripts/_fase44-responsive.ts)");
  check("anchos del encargo", !!m && [320, 360, 390, 430, 768, 820, 1024, 1280, 1440, 1920, 2560].every((w) => m.widths.includes(w)));
  check("0 bloqueos (desbordamiento, CTA recortado, capa inaccesible, control inalcanzable)", !!m && m.blockers === 0, m ? String(m.blockers) : "");
}

/* ═════════════════════════ PERFORMANCE ═════════════════════════ */
if (want("performance")) {
  console.log("\n## PERFORMANCE · before/after");
  type Page = { id: string; longTasks: number; longTaskMs: number; cls: number; slowFrames: number; domNodes: number; jsBytes: number };
  const before = evidence<{ pages: Page[]; signedIn?: boolean }>("performance-before.json");
  const after = evidence<{ pages: Page[]; signedIn?: boolean }>("performance-after.json");
  const bb = evidence<{ jsBytes: number; cssBytes: number }>("bundle-before.json");
  const ba = evidence<{ jsBytes: number; cssBytes: number }>("bundle-after.json");
  check("rendimiento BEFORE y AFTER medidos (build de producción)", !!before && !!after);
  check("bundle BEFORE y AFTER medidos", !!bb && !!ba);
  const rows = (before?.pages ?? []).map((b) => {
    const a = after?.pages.find((x) => x.id === b.id);
    const pct = (x: number, y: number) => (x === 0 ? (y === 0 ? 0 : 100) : Math.round(((y - x) / x) * 1000) / 10);
    return a ? { id: b.id, before: b, after: a, jsBytesPct: pct(b.jsBytes, a.jsBytes), domPct: pct(b.domNodes, a.domNodes), longTaskMsDelta: a.longTaskMs - b.longTaskMs, clsDelta: Number((a.cls - b.cls).toFixed(4)), slowFramesDelta: a.slowFrames - b.slowFrames } : { id: b.id, before: b, after: null };
  });
  /*
   * Regresión JUSTIFICADA (el encargo lo permite con justificación): en Home el JS de más son chunks de las rutas que
   * el lobby enlaza (arena PvE, Draft, Ranked, Road to Champions, Inventario, Logros) precargados por `<Link>` en reposo
   * tras pintar. Se acepta SOLO si la evidencia atribuye el 100 % de esos bytes a rutas enlazadas y no empeoran ni
   * tareas largas, ni fotogramas, ni CLS.
   */
  const prefetch = evidence<{ extraBytes: number; attributed: number; extraChunks: number }>("prefetch-evidence.json");
  const justified = (r: { id: string; longTaskMsDelta?: number; slowFramesDelta?: number; clsDelta?: number }) =>
    r.id === "home" && !!prefetch && prefetch.extraChunks > 0 && prefetch.attributed === prefetch.extraBytes && (r.longTaskMsDelta ?? 0) <= 100 && (r.slowFramesDelta ?? 0) <= 5 && (r.clsDelta ?? 0) <= 0.05;
  const over = rows.filter((r) => "jsBytesPct" in r && ((r.jsBytesPct as number) > 15 || (r.longTaskMsDelta as number) > 100 || (r.slowFramesDelta as number) > 5 || (r.clsDelta as number) > 0.05));
  const regress = over.filter((r) => !justified(r as never));
  check("sin regresión > 15 % en JS por pantalla ni tareas largas/fotogramas/CLS (salvo justificada con evidencia)", !!after && regress.length === 0, regress.map((r) => r.id).join(", "));
  check("regresiones justificadas: prefetch de rutas enlazadas atribuido al 100 %", over.filter((r) => justified(r as never)).length === 0 || (!!prefetch && prefetch.attributed === prefetch.extraBytes), over.filter((r) => justified(r as never)).map((r) => r.id).join(", "));
  const bundlePct = bb && ba ? Math.round(((ba.jsBytes - bb.jsBytes) / bb.jsBytes) * 1000) / 10 : null;
  check("bundle JS total ≤ +15 %", bundlePct !== null && bundlePct <= 15, bundlePct !== null ? `${bundlePct} %` : "");
  json("performance-before-after.json", { generatedAt: new Date().toISOString(), bundle: { before: bb, after: ba, jsPct: bundlePct }, pages: rows, regressions: regress.map((r) => r.id), justified: over.filter((r) => justified(r as never)).map((r) => ({ id: r.id, reason: "prefetch de rutas enlazadas por el lobby (docs/product/qa/fase44/prefetch-evidence.json)" })) });
}

/* ═════════════════════════ COPY ═════════════════════════ */
if (want("copy")) {
  console.log("\n## COPY · lenguaje de juego");
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? (["admin", "design-system", "api"].includes(e.name) ? [] : walk(join(d, e.name))) : /\.tsx$/.test(e.name) && !e.name.includes(".test.") ? [join(d, e.name)] : []);
  const files = [...walk(join(ROOT, "src/app")), ...walk(join(ROOT, "src/components")).filter((f) => !/[\\/](admin|broadcast|coach|career|sim|tactics|launcher)[\\/]/.test(f))];
  const GENERIC = />\s*(Success|Updated|Saved|Submit|Loading\.\.\.|No data|Something went wrong|Error 500|Failed to fetch|OK)\s*</;
  const hits: string[] = [];
  for (const f of files) { const s = code(readFileSync(f, "utf8")); if (GENERIC.test(s)) hits.push(f.replace(ROOT, "")); }
  check(`${files.length} pantallas y piezas sin «Success/Updated/Saved/No data/Failed to fetch» como texto`, hits.length === 0, hits.join(", "));
  const err = renderToStaticMarkup(createElement(GameError, { message: "TypeError: Failed to fetch" }));
  check("errores técnicos traducidos antes de llegar al jugador", !err.includes("TypeError") && TECHNICAL_PATTERN.test("Failed to fetch"));
  check("toast de error filtrado", read("src/components/ui/Toast.tsx").includes("playerMessage(toast.msg)"));
  const inv = read("src/app/inventario/page.tsx");
  check("inventario sin anunciar el Mercado cerrado", !/href="\/mercado"/.test(inv));
  check("404 en español y de juego", read("src/app/not-found.tsx").includes("Esta zona no existe"));
  check("Loading/Empty/NeedsAccount sin emoji de producto", !/["']📭["']|🔐|⚠️/.test(code(read("src/components/ui/States.tsx"))));
}

console.log(`\n${ok} ✓ · ${ko} ✗ (${section})`);
if (ko > 0) process.exitCode = 1;
