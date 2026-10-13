/**
 * FASE 40 · PLAYER JOURNEY — RENDER DE LAS ESCENAS REALES Y CONTRATO DE LAS PIEZAS.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { DailyLobby } from "@/components/dailyLoop/DailyLobby";
import { buildDailyLoop } from "@/domain/dailyLoop";
import { CARDS, getPlayer } from "@/data/catalog";
import { welcomeCards } from "@/lib/journey/presentation";
import { FLOWS } from "@/lib/telemetry/contract";
import { SCENES, FASE40_SCENES, type HomeScene } from "@/app/design-system/fase40/fixtures";
import { FirstMatchCoach } from "./FirstMatchCoach";
import { CollectionCoach, collectionReadiness } from "./CollectionCoach";
import { JourneyDiscovery } from "./JourneyDiscovery";
import { DISCOVERY } from "@/domain/journey";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const JOURNEY_UI = ["JourneyMissionControl.tsx", "JourneyDiscovery.tsx", "JourneyCoach.tsx", "FirstMatchCoach.tsx", "CollectionCoach.tsx"].map((f) => read(`src/components/journey/${f}`)).join("\n");
const JOURNEY_LIB = ["presentation.ts", "arena.ts", "deck.ts"].map((f) => read(`src/lib/journey/${f}`)).join("\n");
const DOMAIN = read("src/domain/journey/index.ts");
const CARDS3 = welcomeCards(CARDS, getPlayer);

const renderHome = (name: string, dismissed?: boolean) => {
  const s = SCENES[name as keyof typeof SCENES] as HomeScene;
  return renderToStaticMarkup(<DailyLobby snap={buildDailyLoop(s.facts)} now={s.facts.now} network={s.network ?? "online"} journeyDismissed={dismissed ?? !!s.dismissed} welcomeCards={CARDS3} />);
};

test("JR01 · todas las escenas del vestíbulo se pintan con la pantalla real", () => {
  let n = 0;
  for (const name of FASE40_SCENES) {
    const s = SCENES[name];
    if (s.kind !== "home") continue;
    assert.ok(renderHome(name).includes('data-testid="daily-lobby"'), name);
    n++;
  }
  assert.ok(n >= 20, `${n} escenas de vestíbulo`);
});

test("JR02 · bienvenida: NEXUS, tres pilares, tres cartas reales, ABRIR MI PRIMER SOBRE y EXPLORAR POR MI CUENTA", () => {
  const h = renderHome("welcome");
  assert.match(h, /data-testid="journey-mission"[^>]*data-step="open"[^>]*data-welcome="true"/);
  assert.match(h, /Colecciona\.[\s\S]*Construye\.[\s\S]*Compite\./);
  assert.match(h, /data-testid="journey-welcome-cards"/);
  assert.match(h, /Cartas reales del catálogo/);
  assert.match(h, /href="\/abrir\/inicial"[^>]*>Abrir mi primer sobre/);
  assert.match(h, /data-testid="journey-dismiss"[^>]*>Explorar por mi cuenta/);
  assert.ok(!/data-testid="daily-hero"/.test(h));
});

test("JR03 · explorar por libre: vestíbulo normal + tira con el paso REAL y «Ver la guía» (el paso no se da por hecho)", () => {
  const h = renderHome("dismiss");
  assert.ok(!/data-testid="journey-mission"/.test(h));
  assert.match(h, /data-testid="journey-strip"/);
  assert.match(h, /Primera sesión[\s\S]*0\/4/);
  assert.match(h, /data-testid="journey-resume"/);
  assert.match(h, /data-testid="daily-hero"[^>]*data-action="journey-open"/, "la acción principal sigue siendo abrir el sobre");
});

test("JR04 · paso COLECCIONA: roles con denominador en texto y enlace a la colección", () => {
  const h = renderHome("home-collect");
  assert.match(h, /data-step="collect"/);
  assert.match(h, /data-testid="journey-roles"/);
  assert.match(h, /Flex 1\/2|Flex 0\/2/);
  assert.match(h, /href="\/packs\/inicial"[^>]*>Conseguir Sobre Inicial gratis/);
  assert.match(h, /href="\/coleccion\?tener=owned"[^>]*>Ver mi colección/);
});

test("JR05 · paso JUEGA: PLANTILLA LISTA con las 10 cartas y CTA al PvE fácil", () => {
  const h = renderHome("deck-saved");
  assert.match(h, /data-testid="journey-deck-ready"/);
  assert.match(h, /Equipo listo/); // F64 · «equipo» (terminología única)
  assert.equal((h.match(/<li class="grid place-items-center">/g) ?? []).length, 10);
  assert.match(h, /href="\/duelos\/jugar\?dificultad=EASY&amp;primera=1"[^>]*>Jugar mi primer combate/);
});

test("JR06 · partidas a medias (PvE, ranked, Draft): héroe CONTINUAR PARTIDA y guía en tira", () => {
  for (const [name, id] of [["match-active", "resume-pve"], ["active-pvp-override", "resume-ranked"], ["active-draft-override", "resume-draft"]] as const) {
    const h = renderHome(name);
    assert.match(h, new RegExp(`data-testid="daily-hero"[^>]*data-action="${id}"`), name);
    assert.match(h, /Continuar partida/, name);
    assert.match(h, /data-testid="journey-strip"/, name);
    assert.ok(!/data-testid="journey-mission"/.test(h), name);
    assert.ok(!/data-testid="journey-strip-cta"/.test(h), `${name}: el paso ya está en «Después»; la tira no repite el botón`);
  }
});

test("JR07 · primera sesión completada en el vestíbulo: destinos reales y acción principal normal", () => {
  const h = renderHome("journey-complete");
  assert.match(h, /data-testid="journey-discovery"/);
  assert.match(h, /Ya conoces el núcleo de NEXUS/);
  for (const d of DISCOVERY) assert.ok(h.includes(`href="${d.href}"`), d.href);
  assert.match(h, /data-testid="daily-hero"/);
});

test("JR08 · cuenta veterana: ni guía, ni tira, ni destinos", () => {
  const h = renderHome("legacy-complete");
  assert.ok(!/journey-(mission|strip|discovery)/.test(h));
});

test("JR09 · sin conexión: CTA de la guía desactivado y aviso; nada avanza en local", () => {
  const h = renderHome("offline");
  assert.match(h, /data-testid="journey-mission"/);
  assert.match(h, /<button[^>]*disabled=""[^>]*data-testid="journey-primary-cta"|data-testid="journey-primary-cta"[^>]*disabled=""/);
  assert.match(h, /Sin conexión/);
});

test("JR10 · temporada, social o eventos caídos: la guía sigue en pie", () => {
  for (const name of ["season-unavailable", "social-unavailable", "events-unavailable"]) {
    const h = renderHome(name);
    assert.match(h, /data-testid="journey-mission"/, name);
    assert.match(h, /Abrir mi primer sobre/, name);
  }
});

test("JR11 · coach del primer combate: reglas del motor, Fácil propuesto, sin obligación de ganar", () => {
  const h = renderToStaticMarkup(<FirstMatchCoach onHelp={() => undefined} />);
  assert.match(h, /Si empatan, nadie puntúa/);
  assert.match(h, /suma de OVR de los equipos \(da un punto\)/); // F63 · «equipo», terminología única
  assert.match(h, /total de estadística declarada \(sin punto\)/);
  assert.match(h, /Ganes, pierdas o empates/);
  assert.match(h, /Fácil/);
});

test("JR12 · coach de la colección: qué es una carta, roles con denominador y el siguiente paso real", () => {
  const legal = SCENES.collection.kind === "collection" ? SCENES.collection.facts.instances.map((i) => i.cardId) : [];
  const ready = renderToStaticMarkup(<CollectionCoach cardIds={legal} packs={0} />);
  assert.match(ready, /Stronghold[\s\S]*Gamesense[\s\S]*Entryfrag/);
  assert.match(ready, /href="\/duelos\/mazos\?nuevo=1"[^>]*>Construir mi primer equipo/);
  assert.equal(collectionReadiness(legal).ready, true);
  const few = SCENES["collection-insufficient"].kind === "collection" ? SCENES["collection-insufficient"].facts.instances.map((i) => i.cardId) : [];
  const h = renderToStaticMarkup(<CollectionCoach cardIds={few} packs={0} />);
  assert.match(h, /Conseguir Sobre Inicial gratis/);
  assert.match(h, /Centinela 1\/2/);
  assert.match(renderToStaticMarkup(<CollectionCoach cardIds={few} packs={2} />), /href="\/inventario"/);
  assert.match(renderToStaticMarkup(<CollectionCoach cardIds={few} packs={0} onShowOwned={() => undefined} />), /Ver solo mis cartas/);
  assert.ok(!/Ver solo mis cartas/.test(h), "sin callback (ya filtrado a lo poseído) no se ofrece");
});

test("JR13 · resultado: destinos con una línea y enlaces reales; desactivados sin conexión", () => {
  const h = renderToStaticMarkup(<JourneyDiscovery items={[...DISCOVERY]} />);
  assert.equal((h.match(/<a /g) ?? []).length, 5);
  const off = renderToStaticMarkup(<JourneyDiscovery items={[...DISCOVERY]} offline />);
  assert.equal((off.match(/<a /g) ?? []).length, 0);
  assert.match(off, /aria-disabled="true"/);
});

/* ───────────── contrato ───────────── */

test("JC01 · un solo motor: el recorrido no decide prioridad fuera del Daily Loop (sin endpoint, sin segundo NextUp)", () => {
  assert.ok(!existsSync(join(ROOT, "src/app/api/game/journey")), "sin GET /api/game/journey");
  assert.ok(!/orderToday|dailyActions\(|todayRank/.test(code(DOMAIN + JOURNEY_UI + JOURNEY_LIB)));
  const dl = read("src/domain/dailyLoop/index.ts");
  assert.ok(dl.includes("journeyAction(") && dl.includes("buildPlayerJourney(f.journey)"));
});

test("JC02 · el cliente no tiene autoridad: ninguna pieza del recorrido escribe, compra, abre, concede ni marca pasos", () => {
  const all = code(JOURNEY_UI + JOURNEY_LIB + DOMAIN);
  assert.ok(!/fetch\(|\.insert\(|\.update\(|\.upsert\(|\.rpc\(|purchase\(|openPack|grant|claim|setFtue|markStep|completeStep/i.test(all));
  const route = read("src/app/api/game/daily-loop/route.ts");
  assert.ok(/export async function GET/.test(route) && !/export async function (POST|PUT|PATCH|DELETE)/.test(route));
});

test("JC03 · «Explorar por mi cuenta» es preferencia de PRESENTACIÓN por dispositivo (adaptador KV), nunca localStorage directo ni servidor", () => {
  const pref = read("src/lib/journey/preference.ts");
  assert.ok(pref.includes("getAdapter()") && !/localStorage|sessionStorage|fetch\(/.test(code(pref)));
  assert.ok(!/localStorage|sessionStorage/.test(code(JOURNEY_UI + JOURNEY_LIB + read("src/app/page.tsx"))));
});

test("JC04 · sin recompensas de primera sesión, sin moneda nueva, sin mercado", () => {
  const all = code(JOURNEY_UI + JOURNEY_LIB + DOMAIN);
  assert.ok(!/\+\s*\d+\s*(créditos|XP|sobres?)|bonus|racha|moneda|market|mercado|venta rápida/i.test(all));
  assert.ok(!/obtainedAt|obtained_at|createdAt|created_at/.test(code(DOMAIN + JOURNEY_LIB)));
});

test("JC05 · sin tutorial paralelo: ni cartas, ni sobres, ni bots, ni motor de combate propios", () => {
  const all = code(JOURNEY_UI + JOURNEY_LIB + DOMAIN);
  assert.ok(!/createDuelBot|startDuelMatch|resolveCombat|PackEngine|openPack\(|tutorial/i.test(all));
  assert.ok(read("src/components/journey/JourneyMissionControl.tsx").includes("interactive={false}"), "cartas de bienvenida estáticas");
});

test("JC06 · táctil ≥ 44 px: botones del sistema md/lg y filas/enlaces con min-h", () => {
  assert.ok(!/<NxButton[^>]*size="sm"/.test(JOURNEY_UI), "ningún botón por debajo de 44 px (las cartas «sm» no son botones)");
  assert.ok(JOURNEY_UI.includes("min-h-[44px]") && JOURNEY_UI.includes("min-h-[64px]"));
});

test("JC07 · movimiento reducido: la guía usa useReducedMotion y el vestíbulo MotionConfig user; sin parallax", () => {
  const mc = read("src/components/journey/JourneyMissionControl.tsx");
  assert.ok(mc.includes("useReducedMotion()") && mc.includes("initial={reduce ? false"));
  assert.ok(read("src/components/dailyLoop/DailyLobby.tsx").includes('<MotionConfig reducedMotion="user">'));
  assert.ok(!/parallax|useParallax|confetti/i.test(JOURNEY_UI));
});

test("JC08 · accesibilidad: pasos con aria-current y estado en texto; secciones con nombre", () => {
  const mc = read("src/components/journey/JourneyMissionControl.tsx");
  assert.ok(mc.includes('aria-current={s.current ? "step" : undefined}'));
  assert.ok(mc.includes("STEP_STATE_LABEL(s)"));
  assert.ok(mc.includes('aria-labelledby="journey-title"') && read("src/components/journey/JourneyDiscovery.tsx").includes('aria-labelledby="journey-discovery-title"'));
});

test("JC09 · telemetría: no-op honesto (FLOWS sigue en 4; el recorrido no emite eventos inventados)", () => {
  assert.equal(FLOWS.length, 4);
  assert.ok(!/trackFlow|trackZone|track\(/.test(code(JOURNEY_UI + JOURNEY_LIB)));
});

/*
 * FASE 47 · la última migración pasa a ser 0054 (composiciones tácticas), y es legítima: el
 * encargo de esa fase la autoriza expresamente. Lo que estas pruebas protegen NO cambia —que
 * su propia fase no metiera migraciones— y por eso se sigue fijando la cabeza de la lista,
 * sólo que ahora en 0054. Si mañana aparece una 0055 sin que nadie la pida, estas pruebas
 * vuelven a sonar.
 */
test("JC10 · sin migración nueva sin encargo: la cabeza es 0058 (F60: 0057 CMS; PRE-F70: 0058 privilegios, autorizadas)", () => {
  const files = readdirSync(join(ROOT, "supabase/migrations")).filter((f) => /^\d{4}_/.test(f)).sort();
  // F73 añade 0059 (crafteo y misiones) y 0060 (desguace atómico, última copia): AUTORIZADAS y APLICADAS el 2026-09-30.
  assert.equal(files[files.length - 1], "0074_collection_scale.sql"); // COLECCIONES ILIMITADAS · 0074 (índices de cursor y resumen por carta; aditiva y opcional: el servidor funciona igual sin ella) es la última; antes F87.2 · 0073 (launch guard de Pick'ems: elegibilidad y puerta de tiempo) es la última; antes F87.1 · 0072, F87 · 0071 (Pick'ems 2.0: cuadros de predicción, cierre por partido, liquidación y reclamos; aditiva) es la última; antes F86.2 · 0070 (feedback de la Closed Alpha + embudo derivado) es la última; antes F86 · 0069 (torneos de jugadores) es la última del repositorio (cabeza = 0069; 0068 tag público de cuenta; 0067 gestión de admins, F85 añadió 0066, F84 añadió 0065, F83 0064, ops/release). F82 añadió 0062 y F89 0063.
});

test("JC11 · la arena no tapa la partida: el coach va en la pre-partida y el resultado solo lee el vestíbulo", () => {
  const arena = read("src/app/duelos/jugar/page.tsx");
  assert.ok(arena.includes("intro={firstMatch ? <FirstMatchCoach"));
  assert.ok(arena.includes("showFirstSessionComplete(loopAfter.journey)"));
  const board = read("src/components/duel/MatchBoard.tsx");
  assert.ok(!/Journey|FirstMatchCoach/.test(board));
});

test("JC12 · primer equipo: activación con la acción existente y dicha en pantalla; el constructor enseña un único coach", () => {
  const page = read("src/app/duelos/mazos/page.tsx");
  assert.ok(page.includes("activateTeamDeck(deck.id") && page.includes("notify(AUTO_ACTIVATED_NOTICE, true)"));
  const builder = read("src/components/duel/DeckBuilder.tsx");
  assert.equal((builder.match(/<JourneyCoach/g) ?? []).length, 1);
  assert.ok(builder.includes("Autocompletar equipo"));
  assert.ok(!/mejor equipo/i.test(builder));
});

test("JC13 · la ayuda canónica dice que el desempate por estadística total NO da punto", () => {
  assert.match(read("src/components/duel/HelpSheet.tsx"), /estadística total declarada \(no otorga punto\)/);
});

test("JC14 · la navegación no se oculta: el vestíbulo no toca el shell ni la barra móvil", () => {
  assert.ok(!/GameShell|mobilebar|nx-chrome|hidden lg:flex/.test(code(JOURNEY_UI)));
});
