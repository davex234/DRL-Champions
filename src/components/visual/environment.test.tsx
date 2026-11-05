/**
 * FASE 44.1 · GAME ENVIRONMENT (51–70) — el mundo detrás de la interfaz: capas L0–L5, un ambiente por sección,
 * reacción del lobby al modo apuntado, cámara de sobres que se apaga, bóveda de la colección, movimiento acotado y
 * nada con movimiento reducido. Incluye el fuzzer de movimiento (50.000 entradas de parallax y partículas).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ENVIRONMENTS, ENV_DIM_EVENT, ENV_FOCUS_EVENT, environmentForPath, FOCUS_TINT, FOCUS_TRANSITION_MS, hexToRgbTriplet,
  packChamberDim, parallaxOffset, particleBudget, type EnvironmentVariant,
} from "@/design/environment";
import { GameEnvironment } from "./GameEnvironment";
import { DynamicGameBackground } from "./DynamicGameBackground";
import { LobbyPlayStage, lobbyModes } from "@/components/dailyLoop/LobbyPlayStage";
import { DailyLobby } from "@/components/dailyLoop/DailyLobby";
import { NextRail } from "@/components/dailyLoop/DailyPanels";
import { CollectionHero, VAULT_LIGHT } from "@/components/collectionRoom/CollectionHero";
import { ShopHero } from "@/components/shop/ShopHero";
import { buildDailyLoop } from "@/domain/dailyLoop";
import { SCENES as LOBBY } from "@/app/design-system/fase36/fixtures";
import { CARDS, getPlayer } from "@/data/catalog";
import { getPack } from "@/data/packs";
import { getVariant } from "@/domain/cards/variants";
import { buildCollectionSnapshot, rarityOf } from "@/domain/collection/room";
import { qaSerializedCard } from "@/app/design-system/serialFixture";

const ROOT = process.cwd();
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
const html = (n: React.ReactElement) => renderToStaticMarkup(n);
const VARIANTS = Object.keys(ENVIRONMENTS) as EnvironmentVariant[];
const REQUIRED: EnvironmentVariant[] = ["lobby", "collection", "packs", "loadout", "campaign", "draft", "ranked", "season"];
const noop = () => {};

/* ───────────── modelo ───────────── */

test("ENV 51 · las ocho variantes del encargo existen (y match/events/profile/world para el resto del juego)", () => {
  for (const v of REQUIRED) assert.ok(ENVIRONMENTS[v], v);
  assert.equal(VARIANTS.length, 12);
  for (const v of VARIANTS) assert.equal(ENVIRONMENTS[v].variant, v);
});

test("ENV 52 · cada lugar tiene arquitectura PROPIA (nada de un mismo fondo con otro color)", () => {
  const archs = REQUIRED.map((v) => ENVIRONMENTS[v].architecture);
  assert.equal(new Set(archs).size, REQUIRED.length);
  assert.deepEqual(Object.fromEntries(REQUIRED.map((v) => [v, ENVIRONMENTS[v].architecture])), {
    lobby: "arena", collection: "vault", packs: "chamber", loadout: "tactical", campaign: "terrain", draft: "triptych", ranked: "ladder", season: "horizon",
  });
});

test("ENV 53 · presupuesto de movimiento: ≤ 3 fuentes, parallax 4–12 px (0 en partida), ≤ 40 partículas, atenuado 0..1", () => {
  for (const s of Object.values(ENVIRONMENTS)) {
    assert.ok(s.motion.length <= 3, s.variant);
    assert.ok(s.variant === "match" ? s.parallax === 0 : s.parallax >= 4 && s.parallax <= 12, s.variant);
    assert.ok(s.particles >= 0 && s.particles <= 40);
    assert.ok(s.dim >= 0 && s.dim <= 1);
    for (const hex of s.base) assert.match(hex, /^#[0-9a-f]{6}$/i);
    assert.notEqual(s.base[0].toLowerCase(), "#000000", "nunca negro plano");
  }
});

test("ENV 54 · la cámara de sobres y el draft son los lugares más oscuros (foco en el objeto)", () => {
  const dims = Object.values(ENVIRONMENTS).map((s) => s.dim).sort((a, b) => b - a);
  assert.equal(ENVIRONMENTS.packs.dim, dims[0]);
  assert.ok(ENVIRONMENTS.draft.dim >= dims[2]);
  assert.ok(ENVIRONMENTS.loadout.parallax <= 4, "la sala táctica es sobria");
});

test("ENV 55 · rutas → lugar: la coincidencia más específica gana y lo desconocido es el lobby", () => {
  const cases: [string, EnvironmentVariant][] = [
    ["/", "lobby"], ["/jugar", "lobby"], ["/duelos", "lobby"], ["/coleccion", "collection"], ["/coleccion/equipos", "loadout"],
    ["/coleccion/carta/x", "collection"], ["/tienda", "packs"], ["/inventario", "packs"], ["/abrir/p1", "packs"],
    ["/duelos/mazos", "loadout"], ["/duelos/mazos/nuevo", "loadout"], ["/jugar/road-to-champions", "campaign"],
    ["/jugar/draft-gauntlet", "draft"], ["/duelos/competitivo", "ranked"], ["/duelos/jugar", "match"], ["/temporada", "season"],
    ["/logros", "season"], ["/torneos/x", "events"], ["/jugador/me", "profile"], ["/mundo", "world"], ["/lo-que-sea", "lobby"],
    ["/coleccionista", "lobby"],
  ];
  for (const [p, v] of cases) assert.equal(environmentForPath(p), v, p);
});

test("ENV 56 · tintes del lobby por modo: PvE cian, ranked magenta, campaña azul profundo, draft ámbar; 200–400 ms", () => {
  assert.deepEqual(FOCUS_TINT.quick, [0x19, 0xe3, 0xff]);
  assert.deepEqual(FOCUS_TINT.ranked, [0xff, 0x2e, 0x63]);
  assert.deepEqual(FOCUS_TINT.campaign, [0x3a, 0x6b, 0xff]);
  assert.deepEqual(FOCUS_TINT.draft, [0xff, 0xb0, 0x3d]);
  assert.ok(FOCUS_TRANSITION_MS >= 200 && FOCUS_TRANSITION_MS <= 400);
  assert.match(read("src", "app", "game-experience.css"), new RegExp(`\\.nx-env-focus \\{[^}]*transition: opacity ${FOCUS_TRANSITION_MS}ms`));
  assert.equal(ENV_FOCUS_EVENT, "nexus:env-focus"); assert.equal(ENV_DIM_EVENT, "nexus:env-dim");
});

test("ENV 57 · parallax: acotado a la capa, 0 con movimiento reducido y 0 en partida; entradas basura → 0", () => {
  const lobby = ENVIRONMENTS.lobby;
  assert.deepEqual(parallaxOffset(lobby, 1, 1, 1, true), { x: 0, y: 0 });
  assert.deepEqual(parallaxOffset(ENVIRONMENTS.match, 1, 1, 1, false), { x: 0, y: 0 });
  assert.deepEqual(parallaxOffset(lobby, 1, 1, 0, false), { x: lobby.parallax, y: 0 });
  assert.deepEqual(parallaxOffset(lobby, 1, Number.NaN, Infinity, false), { x: 0, y: 0 });
});

test("ENV 58 · partículas: menos en móvil, ≤ 12 con movimiento reducido (y estáticas)", () => {
  const s = ENVIRONMENTS.lobby;
  assert.ok(particleBudget(s, 390, false) < particleBudget(s, 1440, false));
  assert.ok(particleBudget(s, 1440, true) <= 12);
  assert.match(read("src", "components", "visual", "GameEnvironment.tsx"), /reduced/);
});

test("ENV 59 · la cámara se apaga ANTES de abrir, al máximo en el revelado y se relaja en el resumen", () => {
  assert.equal(packChamberDim("ready"), 0);
  assert.ok(packChamberDim("requesting") > 0);
  assert.ok(packChamberDim("opening") > packChamberDim("requesting"));
  // F81 · al máximo con la HERO en escena (tensión → hero), se relaja en el resto y en el resumen.
  assert.ok(packChamberDim("buildup") >= packChamberDim("opening"));
  assert.ok(packChamberDim("hero") >= packChamberDim("buildup") && packChamberDim("hero_hold") === packChamberDim("hero"));
  assert.ok(packChamberDim("summary") < packChamberDim("rest") && packChamberDim("rest") < packChamberDim("hero"));
  for (const p of ["ready", "requesting", "opening", "buildup", "hero", "hero_hold", "rest", "summary", "error", "no_pack", "recovering", "???"]) assert.ok(packChamberDim(p) >= 0 && packChamberDim(p) <= 1);
  assert.equal(hexToRgbTriplet("#ffd35c"), "255,211,92");
  assert.equal(hexToRgbTriplet("rojo"), "200,210,230");
});

/* ───────────── render ───────────── */

test("ENV 60 · GameEnvironment: aria-hidden, sin puntero, detrás (−z), con su lugar y capas L0–L5", () => {
  for (const v of VARIANTS) {
    const h = html(<GameEnvironment variant={v} />);
    assert.match(h, new RegExp(`^<div aria-hidden="true" data-environment="${v}"`));
    assert.match(h, /pointer-events-none fixed inset-0 -z-10/);
    assert.match(h, /nx-env-light-a/);
    assert.match(h, /<svg[^>]*viewBox="0 0 1600 1000"/);
    assert.match(h, /nx-env-dim/);
    assert.ok(!/<img|<video|<iframe|https?:\/\//.test(h.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, "")), `${v}: sin recursos externos`);
  }
});

test("ENV 61 · solo el lobby lleva los cuatro tintes de modo", () => {
  assert.equal((html(<GameEnvironment variant="lobby" />).match(/data-tint="/g) ?? []).length, 4);
  for (const v of VARIANTS.filter((x) => x !== "lobby")) assert.ok(!/data-tint="/.test(html(<GameEnvironment variant={v} />)), v);
});

test("ENV 62 · sin Three.js, WebGL ni vídeo: SVG + CSS + canvas 2D; sin capa de grano a pantalla completa (bloqueaba fotogramas sin GPU)", () => {
  const src = read("src", "components", "visual", "GameEnvironment.tsx");
  assert.ok(!/three|webgl|<video/i.test(src));
  assert.match(src, /getContext\("2d"/);
  // Desde Walkout 0.1 (2026-10-07) `three` es dependencia, pero SOLO del escenario 3D del prototipo (import dinámico
  // desde WalkoutStage) y, desde 0.2 (2026-10-08), de su persona (`human3d.ts`) y, desde 0.3, de su arena (`arena3d.ts`), que solo importa
  // stage3d: ni el ambiente ni ninguna otra pieza lo importa.
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(d, e.name)) : /\.tsx?$/.test(e.name) && !e.name.includes(".test.") ? [join(d, e.name)] : []);
  const withThree = walk(join(process.cwd(), "src")).filter((f) => /from "three"|from "three\/|import\("three"\)/.test(readFileSync(f, "utf8"))).map((f) => f.replace(/\\/g, "/").replace(/^.*\/src\//, "src/")).sort();
  assert.deepEqual(withThree, ["src/components/walkout/arena3d.ts", "src/components/walkout/human3d.ts", "src/components/walkout/stage3d.ts"]);
  // feTurbulence a pantalla completa sobre luces animadas dejaba sin fotogramas a 1920/2560 px sin GPU (medido con CDP).
  assert.ok(!/feTurbulence type=/.test(src));
  assert.ok(!/nx-env-grain|backgroundImage/.test(src), "sin capa de grano a pantalla completa");
});

test("ENV 63 · el armazón monta el ambiente en las dos ramas y el alias viejo apunta al nuevo", () => {
  const shell = read("src", "components", "layout", "GameShell.tsx");
  assert.equal((shell.match(/<GameEnvironment variant=\{environment\} \/>/g) ?? []).length, 2);
  assert.match(shell, /environmentForPath\(pathname\)/);
  assert.match(html(<DynamicGameBackground variant="home" />), /data-environment="lobby"/);
});

test("ENV 64 · las fichas de modo del lobby avisan al ambiente al apuntar/enfocar y lo sueltan al salir", () => {
  const src = read("src", "components", "dailyLoop", "LobbyPlayStage.tsx");
  assert.match(src, /onMouseEnter=\{\(\) => \{ focusEnvironment\(m\.id\); playSound\("ui\.hover"\); \}\}/);
  assert.match(src, /onFocus=\{\(\) => focusEnvironment\(m\.id\)\}/);
  assert.match(src, /onMouseLeave=\{\(\) => focusEnvironment\(null\)\}/);
  const snap = buildDailyLoop(LOBBY.claim.facts!);
  assert.deepEqual(lobbyModes(snap).map((m) => m.id), ["quick", "campaign", "ranked", "draft"]);
  const h = html(<LobbyPlayStage snap={snap} />);
  assert.equal((h.match(/data-mode="/g) ?? []).length, 4);
});

test("ENV 65 · lobby: el héroe de contexto y «después» comparten fila (sin franjas vacías) y el orden de bloques se mantiene", () => {
  const snap = buildDailyLoop(LOBBY.claim.facts!);
  const h = html(<DailyLobby snap={snap} now={LOBBY.claim.facts!.now} />);
  assert.match(h, /data-testid="lobby-today-row"/);
  assert.equal((h.match(/data-testid="daily-next"/g) ?? []).length, 1, "«después» una sola vez");
  const row = h.slice(h.indexOf('data-testid="lobby-today-row"'));
  assert.ok(row.indexOf('data-testid="daily-hero"') < row.indexOf('data-testid="daily-next"'));
  assert.match(row, /data-layout="stack"/);
});

test("ENV 66 · «después» en columna: tarjetas con arte propio, flecha y sin colores hex sueltos", () => {
  const snap = buildDailyLoop(LOBBY.pickem.facts!);
  const h = html(<NextRail actions={snap.secondaryActions} offline={false} layout="stack" />);
  assert.match(h, /data-layout="stack"/);
  assert.ok((h.match(/nx-mode-art/g) ?? []).length === snap.secondaryActions.length);
  assert.ok(!/#[0-9a-f]{6}/i.test(read("src", "components", "dailyLoop", "DailyPanels.tsx").split("export function NextRail")[1].split("\nexport ")[0]));
});

test("ENV 67 · bóveda: la carta de mayor OVR en vitrina con cono, halo y pedestal del color de su rareza", () => {
  const serialized = qaSerializedCard() /* catálogo diseñado sin serializadas: carta local de QA */;
  const snap = buildCollectionSnapshot(CARDS, getPlayer, { instances: [{ uid: "u-1", cardId: serialized.id, serial: 3, mintedVersion: 1 }], favorites: [], showcaseUids: [], decks: [] });
  const h = html(<CollectionHero snap={snap} bestDef={serialized} mode="server" />);
  const rarity = rarityOf(serialized);
  assert.match(h, new RegExp(`data-testid="collection-best" data-rarity="${rarity}"`));
  for (const k of ["nx-vault-cone", "nx-vault-halo", "nx-vault-float", "nx-vault-pedestal"]) assert.match(h, new RegExp(k));
  assert.match(h, new RegExp(`--vault-rgb:${VAULT_LIGHT[rarity]}`));
  assert.match(h, /Tu carta de mayor OVR/);
});

test("ENV 68 · cámara de sobres en la tienda: el sobre en su pedestal bajo un cono de SU color", () => {
  const pack = getPack("premium")!;
  const h = html(<ShopHero pack={pack} owned={0} credits={5000} busy={false} onBuyAndOpen={noop} onBuyOnly={noop} />);
  assert.match(h, /nx-vault-cone/);
  assert.match(h, new RegExp(`--vault-rgb:${hexToRgbTriplet(pack.accent)}`));
  assert.match(read("src", "components", "packs", "PackOpeningExperience.tsx"), /dimEnvironment\(packChamberDim\(phase\)\)/);
});

test("ENV 69 · movimiento reducido: sin deriva, barrido, flotado ni transiciones del ambiente", () => {
  const cssx = read("src", "app", "game-experience.css");
  const reduce = cssx.split("@media (prefers-reduced-motion: reduce)").slice(1).join("\n");
  assert.match(reduce, /\.nx-env-layer, \.nx-env-focus, \.nx-env-dim \{ transition: none; \}/);
  for (const k of ["nx-env-drift-a", "nx-env-sweep", "nx-vault-float"]) {
    const where = cssx.indexOf(`animation: ${k}`);
    assert.ok(where > 0, k);
    const before = cssx.lastIndexOf("@media (prefers-reduced-motion: no-preference)", where);
    assert.ok(before > 0 && where - before < 600, `${k} solo con no-preference`);
  }
  assert.match(read("src", "components", "visual", "GameEnvironment.tsx"), /const reduced = mounted && !!reducedPref/);
});

/* ───────────── fuzzer ───────────── */

test("ENV 70 · FUZZ MOVIMIENTO 50.000: parallax nunca supera el de la capa, reducido = 0, partículas 0..40", () => {
  let seed = 50441;
  const rnd = () => { seed = (seed * 22695477 + 1) % 4294967296; return seed / 4294967296; };
  const weird = [Number.NaN, Infinity, -Infinity, 1e9, -1e9];
  for (let i = 0; i < 50_000; i++) {
    const spec = ENVIRONMENTS[VARIANTS[Math.floor(rnd() * VARIANTS.length)]];
    const pick = () => (rnd() < 0.05 ? weird[Math.floor(rnd() * weird.length)] : rnd() * 4 - 2);
    const depth = rnd() * 1.4 - 0.2;
    const reduced = rnd() < 0.2;
    const o = parallaxOffset(spec, depth, pick(), pick(), reduced);
    assert.ok(Number.isFinite(o.x) && Number.isFinite(o.y));
    assert.ok(Math.abs(o.x) <= spec.parallax + 1e-9 && Math.abs(o.y) <= spec.parallax + 1e-9);
    if (reduced) assert.deepEqual(o, { x: 0, y: 0 });
    const n = particleBudget(spec, Math.floor(rnd() * 3000), reduced);
    assert.ok(n >= 0 && n <= 40 && Number.isInteger(n));
    if (reduced) assert.ok(n <= 12);
  }
});
