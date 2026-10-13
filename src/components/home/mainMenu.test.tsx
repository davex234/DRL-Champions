/**
 * FASE 46 · LO QUE PROTEGE EL MENÚ PRINCIPAL.
 *
 * No se prueba «que se vea bonito»: eso se mira. Se prueba el CONTRATO que hace que la Home sea un
 * menú de juego y no vuelva sola a ser un cuadro de mandos — tres acciones y ninguna más, sin
 * Marketplace, con el resto alcanzable, con vídeo que degrada y con movimiento reducido.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pickHeroCard, pickHallCards } from "@/lib/home/selection";
import type { CardDef } from "@/domain/cards/types";

const ROOT = process.cwd();
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
/** Código sin comentarios: lo que se afirma es lo que se EJECUTA, no lo que se documenta. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const MENU = read("src", "components", "home", "MainMenu.tsx");
const HALL = read("src", "components", "home", "NexusHall.tsx");
const MORE = read("src", "components", "home", "MoreMenu.tsx");
const HOME = read("src", "app", "page.tsx");
const CSS = read("src", "app", "game-experience.css");
const NAV = read("src", "design", "nav.ts");

/* ═════════════════ LAS TRES ACCIONES ═════════════════ */

test("HOME 01 · hay EXACTAMENTE tres acciones principales, y en su orden", () => {
  const ids = [...code(MENU).matchAll(/id: "(play|vault|store)" as const/g)].map((m) => m[1]);
  assert.deepEqual(ids, ["play", "vault", "store"], "tres acciones, con JUGAR la primera");
});

test("HOME 02 · cada acción lleva a la ruta real del producto", () => {
  assert.match(code(MENU), /href: "\/jugar"/, "JUGAR va al Play Hub de la Fase 45");
  assert.match(code(MENU), /href: "\/boveda"/, "INVENTARIO va a la bóveda");
  assert.match(code(MENU), /href: "\/tienda"/, "TIENDA va a la tienda de sobres");
  // `/inventario` es otra cosa (sobres sin abrir): la bóveda NO puede secuestrar esa URL.
  assert.ok(!/href: "\/inventario"/.test(code(MENU)), "la bóveda no usa la ruta de sobres");
});

test("HOME 03 · JUGAR domina: es la primera y su acento es el de la marca", () => {
  const play = code(MENU).slice(code(MENU).indexOf('id: "play"'), code(MENU).indexOf('id: "vault"'));
  assert.match(play, /k: "255, 46, 99"/, "JUGAR usa el magenta de NEXUS");
});

test("HOME 04 · los modos de juego NO son acciones principales: viven dentro de JUGAR", () => {
  /*
   * Lo que se protege es que ningún modo suba a las TRES acciones, no que la palabra no aparezca.
   * «Road to Champions» sí está en la Home —abajo a la derecha, como acceso pequeño—, y debe estar:
   * el encargo lo pide expresamente. La diferencia entre un acceso discreto y una cuarta acción
   * que compite es justo lo que hay que fijar aquí.
   */
  const acciones = code(MENU).slice(code(MENU).indexOf("const ACCIONES"), code(MENU).indexOf("function Icono"));
  for (const modo of ["Ranked", "Competitivo", "Draft", "Road to Champions", "PvE", "Campaña"]) {
    assert.ok(!acciones.includes(modo), `«${modo}» no puede ser una acción principal`);
  }
  // Y el acceso a la campaña vive en el pie, con su testid, no entre los botones grandes.
  assert.match(code(MENU), /data-testid="quick-campaign"/);
  const pie = code(MENU).slice(code(MENU).indexOf("<footer"));
  assert.ok(pie.includes("Road to Champions"), "la campaña es un acceso del pie");
});

test("HOME 05 · Marketplace sigue APAGADO y fuera de la Home y del menú secundario", () => {
  for (const [nombre, src] of [["MainMenu", MENU], ["MoreMenu", MORE]] as const) {
    assert.ok(!/market/i.test(code(src)), `${nombre} no menciona el mercado`);
  }
});

/* ═════════════════ NADA SE PIERDE ═════════════════ */

test("HOME 06 · lo que sale de la Home sigue alcanzable en el menú secundario", () => {
  // IA 2026-10-07 · Temporada (hub + Pase · Objetivos · Crafteo) y MI CUENTA (perfil, progresión, cuenta, feedback);
  // «Logros» se alcanza desde el pase y Mi cuenta → Progresión.
  for (const ruta of ["/temporada", "/temporada/pase", "/misiones", "/misiones/crafting", "/torneos", "/pickems", "/social", "/cuenta"]) {
    assert.ok(code(MORE).includes(`href: "${ruta}"`), `${ruta} sigue teniendo puerta`);
  }
});

test("HOME 07 · el menú secundario es un diálogo con salida por Escape y por botón", () => {
  assert.match(code(MORE), /role="dialog"/);
  assert.match(code(MORE), /aria-modal="true"/);
  assert.match(code(MENU), /e\.key === "Escape"/, "Escape abre y cierra");
  assert.match(code(MORE), /aria-label="Cerrar menú"/);
});

test("HOME 08 · la Home deja de llevar el armazón de secciones (barra de navegación web)", () => {
  assert.match(code(NAV), /IMMERSIVE_EXACT = \["\/"\]/, "la raíz es inmersiva");
  // Y NO por la vía peligrosa: `"/"` dentro de IMMERSIVE_ROUTES haría inmersiva TODA la aplicación.
  assert.ok(!/IMMERSIVE_ROUTES = \[[^\]]*"\/"[^\]]*\]/.test(code(NAV)), "la raíz no entra en la lista de prefijos");
});

/* ═════════════════ EL FONDO ═════════════════ */

test("HOME 09 · la arquitectura de vídeo está completa y degrada sola", () => {
  assert.match(code(HALL), /\/video\/nexus-lobby\.webm/);
  assert.match(code(HALL), /\/video\/nexus-lobby\.mp4/);
  assert.match(code(HALL), /poster="/, "hay poster: nunca un destello negro");
  for (const attr of ["autoPlay", "muted", "loop", "playsInline"]) {
    assert.ok(code(HALL).includes(attr), `el vídeo es ${attr}`);
  }
  assert.match(code(HALL), /onError=\{onVideoError\}/, "si el vídeo falla, se apaga");
  assert.match(code(MENU), /setVideoReady\(false\)/, "y la escena 2.5D queda de fondo");
});

test("HOME 10 · el fondo es CSS: ni WebGL, ni canvas, ni Three.js, ni vídeo de terceros", () => {
  for (const prohibido of ["WebGL", "getContext", "<canvas", "THREE", "youtube", "http://", "https://"]) {
    assert.ok(!code(HALL).includes(prohibido), `la escena no usa ${prohibido}`);
  }
});

test("HOME 11 · las motas están CONTADAS (no hay partículas ilimitadas)", () => {
  assert.match(code(HALL), /Array\.from\(\{ length: 16 \}/, "dieciséis motas, escritas en el fuente");
});

test("HOME 12 · con movimiento reducido no se mueve nada, pero la escena sigue estando", () => {
  assert.match(
    CSS,
    /@media \(prefers-reduced-motion: reduce\) \{\s*\.nx-hall-mote, \.nx-hall-horizon, \.nx-hall-burst, \.nx-hall-rays \{ animation: none; \}/,
  );
});

test("HOME 13 · no se rompe el scroll de la Fase 44.1", () => {
  // `min-h-[100dvh]`: llena la pantalla pero PUEDE crecer. Nada de `h-screen` + `overflow: hidden`.
  assert.match(code(MENU), /min-h-\[100dvh\]/);
  assert.ok(!/overflow-hidden/.test(code(MENU)), "la Home no bloquea el desplazamiento");
});

/* ═════════════════ DATOS REALES ═════════════════ */

test("HOME 14 · el HUD sólo enseña monedas que existen: créditos y nada más", () => {
  assert.match(code(MENU), /data-testid="hud-credits"/);
  for (const inventada of ["gemas", "gems", "premium", "cristales"]) {
    assert.ok(!new RegExp(inventada, "i").test(code(MENU)), `no existe «${inventada}» en el producto`);
  }
});

test("HOME 15 · Road to Champions sólo aparece si la campaña REAL dice algo", () => {
  assert.match(code(MENU), /campaña\?\.next \? `Capítulo \$\{campaña\.next\.chapterOrder\}` : null/);
  assert.match(code(MENU), /campaña && !campaña\.complete && capitulo/, "nada de capítulos inventados");
});

test("HOME 16 · el nivel sale de la curva del dominio, no de una cuenta local", () => {
  assert.match(code(HOME), /import \{ levelFromXp \} from "@\/domain\/progression\/levels"/);
});

/* ═════════════════ LA ELECCIÓN DE CARTAS (dominio puro) ═════════════════ */

const carta = (id: string, variantId: string, ovr: number) => ({ id, variantId, ovr, playerId: id } as unknown as CardDef);
const CATALOGO = [carta("a", "bronce", 70), carta("b", "oro", 84), carta("c", "icon", 92), carta("d", "plata", 78)];
const RANK: Record<string, number> = { bronce: 1, plata: 2, oro: 3, icon: 4 };
const getVariant = ((v: string) => ({ rank: RANK[v] ?? 0 })) as never;
const getCard = (id: string) => CATALOGO.find((c) => c.id === id);

test("HOME 17 · la carta destacada es la MEJOR que posees, y es determinista", () => {
  const owned = [{ cardId: "a" }, { cardId: "b" }];
  const uno = pickHeroCard(owned, getCard, getVariant, CATALOGO);
  const dos = pickHeroCard(owned, getCard, getVariant, CATALOGO);
  assert.equal(uno?.id, "b", "oro gana a bronce");
  assert.equal(uno?.id, dos?.id, "la misma colección da siempre la misma carta");
});

test("HOME 18 · sin cartas propias, la escena NO se queda vacía: tira del catálogo", () => {
  const hero = pickHeroCard([], getCard, getVariant, CATALOGO);
  assert.equal(hero?.id, "c", "la mejor del catálogo");
});

test("HOME 19 · la protagonista NUNCA se repite entre las que vuelan", () => {
  const hero = pickHeroCard([], getCard, getVariant, CATALOGO);
  const vuelan = pickHallCards([], getCard, getVariant, CATALOGO, hero);
  assert.ok(!vuelan.some((c) => c.id === hero?.id), "no se ve la misma carta dos veces");
  assert.equal(new Set(vuelan.map((c) => c.id)).size, vuelan.length, "ni repetidas entre ellas");
});

/* ═════════════════ EL HUB DE INVENTARIO ═════════════════ */

test("HOME 20 · la bóveda agrupa colección, equipos y sets, y vuelve al menú", () => {
  const boveda = code(read("src", "app", "boveda", "page.tsx"));
  for (const r of ["/coleccion", "/duelos/mazos", "/colecciones"]) {
    assert.ok(boveda.includes(`href: "${r}"`), `la bóveda lleva a ${r}`);
  }
  assert.match(boveda, /href="\/"/, "y se puede volver al menú principal");
  assert.ok(!/market/i.test(boveda), "sin mercado");
});
