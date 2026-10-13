/**
 * FASE 44 · GAME EXPERIENCE 4.0 — modelo puro: movimiento, armazón, JUGAR, callejones sin salida, profundidad de clic.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  MOTION, MOTION_LEVELS, SPRING, levelDuration, pageMotion, transitionFamily, boundedStagger, reducedTransition,
  type MotionLevel, type TransitionFamily,
} from "./motion";
import {
  CORE_SCREENS, CLICK_DEPTH, HUB_EXITS, OWN_OFFLINE_NOTICE, PLAY_HREF, SHELL_ORDER, effectiveExits, isDeadEnd, mobileMenu,
  playCta, playSection, shellOfflineNotice, shellSections, shellVisible,
} from "./gameShell";
import { MOBILE_NAV, NAV_SECTIONS, sectionForPath, isImmersive } from "./nav";

const ROOT = process.cwd();
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

/* ───────────── motion tokens ───────────── */

test("MOTION · tokens centralizados con los nombres del encargo y orden creciente", () => {
  assert.deepEqual(Object.keys(MOTION), ["fast", "normal", "game", "celebration", "exceptional"]);
  assert.ok(MOTION.fast < MOTION.normal && MOTION.normal < MOTION.game && MOTION.game < MOTION.celebration && MOTION.celebration < MOTION.exceptional);
});
test("MOTION · microinteracción en 80–180 ms", () => { assert.ok(MOTION.fast >= 80 && MOTION.fast <= 180); });
test("MOTION · transición de pantalla en 150–350 ms", () => { assert.ok(MOTION.normal >= 150 && MOTION.normal <= 350 && MOTION.game <= 350); });
test("MOTION · nada obligatorio pasa de 1,2 s", () => { assert.ok(MOTION.exceptional <= 1200); });

for (const lv of [0, 1, 2, 3, 4] as MotionLevel[]) {
  test(`MOTION LEVEL ${lv} · presupuesto definido, con nombre y ejemplos`, () => {
    const L = MOTION_LEVELS[lv];
    assert.ok(L.name.length > 0 && L.examples.length > 0);
    assert.ok(L.maxMs >= 0 && L.maxMs <= 1200);
  });
  test(`MOTION LEVEL ${lv} · movimiento reducido lo aplasta a ≤ 120 ms`, () => {
    assert.ok(levelDuration(lv, true) <= 120);
    if (lv === 0) assert.equal(levelDuration(lv, false), 0);
  });
}
test("MOTION · la escala es monótona (más nivel, más presupuesto)", () => {
  for (let l = 1; l <= 4; l++) assert.ok(MOTION_LEVELS[l as MotionLevel].maxMs >= MOTION_LEVELS[(l - 1) as MotionLevel].maxMs);
});
test("MOTION · solo el nivel 4 admite partículas", () => {
  assert.equal(MOTION_LEVELS[4].particles, true);
  for (const l of [0, 1, 2, 3] as MotionLevel[]) assert.equal(MOTION_LEVELS[l].particles, false);
});
test("MOTION · luz de pantalla solo en niveles 3 y 4", () => {
  for (const l of [0, 1, 2] as MotionLevel[]) assert.equal(MOTION_LEVELS[l].screenLight, false);
});
test("SPRING · muelles con amortiguación suficiente (nada de UI saltarina)", () => {
  for (const [k, s] of Object.entries(SPRING)) assert.ok(s.damping >= 30, k);
});
test("MOTION · transición reducida es un fundido corto", () => {
  assert.ok(((reducedTransition as { duration?: number }).duration ?? 1) <= 0.12);
});

const FAMILY_CASES: [string, TransitionFamily][] = [
  ["/jugar", "gameplay"], ["/jugar/road-to-champions", "gameplay"], ["/jugar/draft-gauntlet", "gameplay"], ["/duelos", "gameplay"],
  ["/duelos/competitivo", "gameplay"], ["/pickems", "gameplay"], ["/torneos/ev1", "gameplay"], ["/social", "gameplay"],
  ["/coleccion", "collection"], ["/coleccion/carta/x", "collection"], ["/inventario", "collection"], ["/tienda", "collection"],
  ["/packs", "collection"], ["/duelos/mazos", "collection"], ["/eventos", "collection"],
  ["/temporada", "season"], ["/logros", "season"], ["/progresion", "season"], ["/jugador/me", "season"], ["/cuenta", "season"],
  ["/", "default"], ["/mundo", "default"], ["/noticias", "default"],
];
for (const [path, fam] of FAMILY_CASES) {
  test(`TRANSICIÓN · ${path} → ${fam}`, () => { assert.equal(transitionFamily(path), fam); });
}
for (const fam of ["gameplay", "collection", "season", "default"] as TransitionFamily[]) {
  test(`TRANSICIÓN · ${fam}: 150–350 ms, solo transform/opacity`, () => {
    const m = pageMotion(fam, false);
    assert.ok(m.ms >= 150 && m.ms <= 350, String(m.ms));
    for (const k of Object.keys(m.initial)) assert.ok(["opacity", "y", "scale"].includes(k), k);
  });
  test(`TRANSICIÓN · ${fam} reducida: solo fundido`, () => {
    const m = pageMotion(fam, true);
    assert.deepEqual(Object.keys(m.initial), ["opacity"]);
    assert.ok(m.ms <= 120);
  });
}
test("TRANSICIÓN · no hay 20 transiciones: cuatro familias", () => {
  const fams = new Set(FAMILY_CASES.map(([p]) => transitionFamily(p)));
  assert.ok(fams.size <= 4);
});
test("COLECCIÓN · escalonado acotado: como mucho 24 elementos animan y nunca más de 0,6 s", () => {
  let animated = 0;
  for (let i = 0; i < 772; i++) { const d = boundedStagger(i); if (d > 0) animated++; assert.ok(d <= 0.6); }
  assert.ok(animated <= 24, String(animated));
});

/* ───────────── JUGAR global ───────────── */

test("JUGAR · sin estado → JUGAR al selector de modos", () => {
  const c = playCta(null);
  assert.equal(c.kind, "play"); assert.equal(c.label, "Jugar"); assert.equal(c.href, "/jugar");
});
test("JUGAR · servidor sin partida → JUGAR", () => { assert.equal(playCta({ resume: null }).kind, "play"); });
test("JUGAR · servidor con partida → CONTINUAR PARTIDA a su ruta", () => {
  const c = playCta({ resume: { id: "resume-pve", label: "Continuar partida", href: "/duelos/jugar", eyebrow: "Partida rápida · en curso", title: "x" } });
  assert.equal(c.kind, "resume"); assert.equal(c.label, "Continuar partida"); assert.equal(c.href, "/duelos/jugar");
  assert.match(c.ariaLabel, /Continuar partida: Partida rápida/);
});
test("JUGAR · lectura desconocida (fallo) NUNCA afirma partida", () => {
  assert.equal(playCta({ resume: { id: "resume-pve", label: "x", href: "/duelos/jugar", eyebrow: "e", title: "t" }, unknown: true }).kind, "play");
});
test("JUGAR · un destino que no es ruta interna no se usa", () => {
  assert.equal(playCta({ resume: { id: "resume-pve", label: "x", href: "https://evil.example", eyebrow: "e", title: "t" } }).kind, "play");
});
for (const href of ["/duelos/jugar", "/duelos/pvp?match=abc", "/duelos/jugar?campaign=c1-n2", "/jugar/draft-gauntlet"]) {
  test(`CONTINUAR · ${href} existe como pantalla`, () => {
    const c = playCta({ resume: { id: "r", label: "Continuar partida", href, eyebrow: "e", title: "t" } });
    assert.equal(c.kind, "resume"); assert.ok(routeExists(c.href), c.href);
  });
}
test("JUGAR · el destino por defecto existe", () => { assert.ok(routeExists(PLAY_HREF)); });

/* ───────────── armazón y navegación ───────────── */

test("NAV · orden del armazón: colección, equipos, sobres, temporada, mundo", () => {
  assert.deepEqual(shellSections().map((s) => s.id), [...SHELL_ORDER]);
});
test("NAV · JUGAR es la sección de acción y entra por /jugar", () => { assert.equal(playSection().href, "/jugar"); });
test("NAV · etiquetas de juego: Tienda y Temporada", () => {
  // Fase 49 · la sección vende sobres, cajas, cartas y packs (Tienda 4.0): vuelve a ser «Tienda».
  assert.equal(NAV_SECTIONS.find((s) => s.id === "tienda")!.label, "Tienda");
  assert.equal(NAV_SECTIONS.find((s) => s.id === "progreso")!.label, "Temporada");
  assert.equal(NAV_SECTIONS.find((s) => s.id === "progreso")!.href, "/temporada");
});
test("NAV · Equipos es sección propia y /duelos/mazos le pertenece", () => {
  assert.equal(sectionForPath("/duelos/mazos")?.id, "equipos");
  assert.equal(sectionForPath("/equipo")?.id, "equipos");
});
test("NAV · MARKETPLACE OFF: ninguna entrada de menú a /mercado", () => {
  for (const s of NAV_SECTIONS) for (const it of s.items) assert.ok(!it.href.startsWith("/mercado"), it.href);
  assert.ok(!MOBILE_NAV.some((m) => m.href.startsWith("/mercado")));
  assert.ok(!mobileMenu().some((g) => g.items.some((i) => i.href.startsWith("/mercado"))));
});
test("NAV · /mercado conserva contexto (colección) aunque no esté en el menú", () => { assert.equal(sectionForPath("/mercado")?.id, "coleccion"); });
test("NAV · dock móvil: JUGAR en el centro y marcado como acción", () => {
  assert.equal(MOBILE_NAV.length, 5);
  assert.equal(MOBILE_NAV[2].section, "jugar"); assert.equal(MOBILE_NAV[2].play, true);
  assert.equal(MOBILE_NAV.filter((m) => m.play).length, 1);
});
test("NAV · menú móvil: todas las secciones, JUGAR primero", () => {
  const m = mobileMenu();
  assert.equal(m[0].id, "jugar");
  assert.deepEqual(m.map((g) => g.id).sort(), [...NAV_SECTIONS.map((s) => s.id)].sort());
});
for (const s of NAV_SECTIONS) {
  for (const it of s.items) {
    test(`NAV · ${s.id} › ${it.label} (${it.href}) existe`, () => { assert.ok(routeExists(it.href), it.href); });
  }
}
for (const m of MOBILE_NAV) test(`DOCK · ${m.label} (${m.href}) existe`, () => { assert.ok(routeExists(m.href)); });
test("NAV · rutas inmersivas sin armazón (partida y apertura)", () => {
  assert.ok(isImmersive("/duelos/jugar") && isImmersive("/abrir/estandar"));
  assert.equal(shellVisible("/duelos/jugar"), false); assert.equal(shellVisible("/coleccion"), true);
});

/* ───────────── callejones sin salida y profundidad ───────────── */

for (const s of CORE_SCREENS) {
  test(`SIN CALLEJÓN · ${s.screen} (${s.path}) tiene salida a jugar/lobby o siguiente acción`, () => {
    assert.equal(isDeadEnd(s), false);
    const e = effectiveExits(s);
    assert.ok(e.length > 0);
    if (!s.immersive) assert.ok(e.includes(PLAY_HREF) && e.includes("/"), "el armazón aporta JUGAR e INICIO");
    else assert.ok(e.some((x) => (HUB_EXITS as readonly string[]).includes(x)));
  });
  test(`SIN CALLEJÓN · ${s.screen}: todas sus salidas existen`, () => {
    assert.ok(routeExists(s.path) || s.path === "/abrir" || s.path === "/coleccion/carta", s.path);
    for (const x of effectiveExits(s)) assert.ok(routeExists(x) || x === "/abrir" || x === "/coleccion/carta", x);
  });
}
test("SIN CALLEJÓN · el detector sí detecta un callejón", () => {
  assert.equal(isDeadEnd({ path: "/abrir", screen: "x", immersive: true, exits: [] }), true);
  assert.equal(isDeadEnd({ path: "/abrir", screen: "x", immersive: true, exits: ["/noticias"] }), true);
});
for (const c of CLICK_DEPTH) {
  test(`CLICS · ${c.goal}: ${c.clicks} (objetivo: jugar 1, núcleo ≤ 2)`, () => {
    assert.equal(c.path.length, c.clicks);
    assert.ok(c.goal.startsWith("Jugar (") ? c.clicks === 1 : c.clicks <= 2);
  });
}

/* ───────────── sin conexión ───────────── */

for (const p of OWN_OFFLINE_NOTICE) test(`OFFLINE · ${p} ya tiene aviso propio: el armazón no lo repite`, () => { assert.equal(shellOfflineNotice(p), false); });
for (const p of ["/temporada", "/logros", "/tienda", "/duelos/mazos", "/jugador/me", "/pickems"]) test(`OFFLINE · ${p}: aviso global del armazón`, () => { assert.equal(shellOfflineNotice(p), true); });
test("OFFLINE · la raíz no absorbe todas las rutas", () => { assert.equal(shellOfflineNotice("/torneos"), true); });
