/**
 * FASE 63 · ONBOARDING — PANTALLAS (render estático con datos del catálogo REAL) y contratos de integración.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { CARDS, getPlayer } from "@/data/catalog";
import { DUEL_ROLES } from "@/domain/cardgame";
import { buildOnboarding, NO_FLAGS, type OnboardingFlags } from "@/domain/onboarding";
import type { JourneyFacts, RoleShortage } from "@/domain/journey";
import { OnboardingContinue, OnboardingWelcome, StarterMoment } from "./OnboardingHome";
import { FirstCardLesson, OnboardingPackNext } from "./FirstCardLesson";
import { OnboardingCollectionCoach } from "./OnboardingCollectionCoach";
import { FirstMatchHint, OnboardingAfterMatch } from "./FirstMatchHelp";
import { OnboardingProgressCoach } from "./OnboardingProgress";
import { railVisibleOn } from "./OnboardingRail";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} } as never;
const R = (el: React.ReactElement) => renderToStaticMarkup(<AppRouterContext.Provider value={router}>{el}</AppRouterContext.Provider>);
const NOW = Date.parse("2026-09-26T12:00:00Z");
const roles = (have: number): RoleShortage[] => DUEL_ROLES.map((role) => ({ role, have, need: 2 }));
const deckIds = (() => {
  const out: string[] = []; const used = new Set<string>(); const n: Record<string, number> = {};
  for (const c of CARDS) { const r = c.role ?? getPlayer(c.playerId)?.role; if (!r || used.has(c.playerId) || (n[r] ?? 0) >= 2) continue; used.add(c.playerId); n[r] = (n[r] ?? 0) + 1; out.push(c.id); }
  return out;
})();
const J = (o: Partial<JourneyFacts> = {}): JourneyFacts => ({
  ownedCards: 0, packsOpened: 0, matchesCompleted: 0, unopenedPacks: 4, firstPackId: "inicial",
  decks: { total: 0, valid: 0, firstInvalid: null }, readyDeck: null, readiness: { ready: false, dataVersion: null, roles: roles(0), shortages: roles(0) }, ...o,
});
const view = (j: Partial<JourneyFacts> = {}, f: Partial<OnboardingFlags> = {}) =>
  buildOnboarding({ journey: J(j), flags: { ...NO_FLAGS, ...f }, starter: { credits: 6000, packs: [{ packId: "estandar", qty: 1 }, { packId: "inicial", qty: 3 }] } });

test("F63 U01 · bienvenida: NEXUS, «Construye tu equipo. Juega. Progresa.», UN botón EMPEZAR (orden del servidor) y Saltar tutorial", () => {
  const h = R(<OnboardingWelcome view={view()} />);
  assert.match(h, /NEX<span class="text-drl">US<\/span>/);
  assert.match(h, /Construye tu equipo\. Juega\. Progresa\./);
  assert.match(h, /data-testid="onboarding-start"[^>]*data-command="start"[^>]*>Empezar</);
  assert.match(h, /data-testid="onboarding-skip"[^>]*>Saltar tutorial</);
  assert.equal((h.match(/<button/g) ?? []).length, 2, "dos botones: empezar y saltar");
});

test("F63 U02 · tus recursos: los sobres REALES con su arte y su cantidad, los créditos reales y ABRIR MI PRIMER SOBRE → Bronce", () => {
  const h = R(<StarterMoment view={view({}, { startedAt: NOW })} />);
  assert.match(h, /Tu inicio · 2\/6/);
  assert.match(h, /data-pack="estandar" data-qty="1"/);
  assert.match(h, /data-pack="inicial" data-qty="3"/);
  assert.match(h, /Sobre Bronce[\s\S]*Sobre Inicial/);
  assert.match(h, /6\.000/);
  assert.match(h, /href="\/abrir\/estandar"[^>]*>Abrir mi primer sobre</);
  assert.match(h, /Los sobres añaden cartas a tu colección/);
});

test("F63 U03 · continúa tu inicio: paso del equipo = CREAR MI PRIMER EQUIPO (orden) + «Montarlo yo»; paso partida = diez cartas + JUGAR", () => {
  const ready = { ready: true, dataVersion: "VCT-2026", roles: roles(2), shortages: [] };
  const deck = R(<OnboardingContinue view={view({ packsOpened: 4, ownedCards: 20, unopenedPacks: 0, readiness: ready }, { startedAt: NOW })} />);
  assert.match(deck, /Tu inicio · 4\/6/);
  assert.match(deck, /data-command="first-team"[^>]*>Crear mi primer equipo</);
  assert.match(deck, /href="\/duelos\/mazos\?nuevo=1"[^>]*>Montarlo yo</);
  assert.match(deck, /10 cartas: 2 de cada rol y sin repetir jugador/);
  const match = R(<OnboardingContinue view={view({ packsOpened: 4, ownedCards: 20, readiness: ready, decks: { total: 1, valid: 1, firstInvalid: null }, readyDeck: { id: "d", name: "Mi primer equipo", cardIds: deckIds, active: true } }, { startedAt: NOW })} />);
  assert.match(match, /Tu equipo está listo/);
  assert.match(match, /data-testid="onboarding-team"/);
  assert.match(match, /Las 10 cartas de tu equipo/);
  assert.match(match, /href="\/duelos\/jugar\?dificultad=EASY&amp;primera=1"[^>]*>Jugar mi primera partida</);
});

test("F63 U04 · tu primera carta: la carta REAL con OVR, rol de la CARTA, SH/GS/EF y las 6 impresas (FKS, nunca COM)", () => {
  const card = CARDS.find((c) => c.printed && c.combat)!;
  const h = R(<FirstCardLesson card={card} view={view({ packsOpened: 1, ownedCards: 5, unopenedPacks: 3 }, { startedAt: NOW })} />);
  assert.match(h, new RegExp(`data-card-id="${card.id}"`));
  assert.match(h, new RegExp(`>${card.ovr}<`));
  assert.match(h, new RegExp(`>${card.role}<`));
  for (const l of ["SH", "GS", "EF", "Stronghold", "Gamesense", "Entryfrag", "DMG", "SCR", "FKS", "HS", "AST", "CLU"]) assert.ok(h.includes(l), l);
  assert.ok(!/>COM</.test(h));
  assert.match(h, /data-testid="onboarding-to-collection"[^>]*>Ver mi colección</);
  assert.match(h, /href="\/abrir\/inicial"[^>]*>Abrir el siguiente sobre</);
  assert.match(R(<OnboardingPackNext view={view({ packsOpened: 2, ownedCards: 10, unopenedPacks: 2 }, { startedAt: NOW })} />), /Completa tu colección/);
});

test("F63 U05 · colección: «Estas son tus cartas», roles con cifra y texto (no solo color), sin filtros avanzados", () => {
  const h = R(<OnboardingCollectionCoach view={view({ packsOpened: 1, ownedCards: 5, unopenedPacks: 3, readiness: { ready: false, dataVersion: "VCT-2026", roles: roles(1), shortages: roles(1) } }, { startedAt: NOW })} />);
  assert.match(h, /Estas son tus cartas/);
  assert.match(h, /Tu inicio · 3\/6/);
  assert.match(h, /· Duelista 1\/2/);
  assert.ok(!/filtr/i.test(h));
});

test("F63 U06 · partida: ayuda del primer ataque encima del tablero con «Entendido»; resultado → VER MI PROGRESO (gane o pierda)", () => {
  const hint = R(<FirstMatchHint view={{ matchId: "m", status: "IN_PROGRESS", youAreAttacker: true }} />);
  assert.match(hint, /role="note"/);
  assert.match(hint, /data-hint="attack"/);
  assert.match(hint, />Entendido</);
  const after = R(<OnboardingAfterMatch view={view({ matchesCompleted: 1, decks: { total: 1, valid: 1, firstInvalid: null } }, { startedAt: NOW })} />);
  assert.match(after, /Tu primera partida ya cuenta/);
  assert.match(after, /XP de cuenta[\s\S]*objetivos[\s\S]*XP de temporada/);
  // IA 2026-10-07 · la progresión vive en Mi cuenta → Progresión.
  assert.match(after, /href="\/cuenta\?seccion=progresion"[^>]*>Ver mi progreso</);
  assert.equal(R(<OnboardingAfterMatch view={view({ matchesCompleted: 3 })} />), "", "fuera de la guía no aparece");
});

test("F63 U07 · progreso: tres bloques (XP de cuenta, objetivos, XP de temporada) + «Ya estás listo» + SEGUIR JUGANDO (orden finish)", () => {
  const h = R(<OnboardingProgressCoach view={view({ matchesCompleted: 1, decks: { total: 1, valid: 1, firstInvalid: null } }, { startedAt: NOW })} />);
  assert.match(h, /data-block="account"[\s\S]*data-block="objectives"[\s\S]*data-block="season"/);
  assert.match(h, /Ya estás listo/);
  assert.match(h, /Jugar más partidas[\s\S]*Mejorar tu equipo[\s\S]*Completar objetivos/);
  assert.match(h, /data-testid="onboarding-finish"[^>]*data-command="finish"[^>]*>Seguir jugando</);
  assert.equal(R(<OnboardingProgressCoach view={view({ matchesCompleted: 1 }, { startedAt: NOW, finishedAt: NOW })} />), "", "terminada: nada");
});

test("F63 U08 · integración: portada (una lectura), sobre F57, colección, arena F61, resultado F62, progreso, franja y guía", () => {
  const menu = read("src/components/home/MainMenu.tsx");
  assert.match(menu, /snap\.onboarding/, "la portada usa la MISMA foto del vestíbulo");
  assert.ok(!/fetchOnboarding|useOnboarding/.test(menu), "la portada no hace lecturas nuevas");
  assert.match(read("src/server/services/dailyLoop.ts"), /buildOnboarding\(/);
  const pack = read("src/components/packs/PackOpeningExperience.tsx");
  assert.match(pack, /lead=\{guide \?/);
  assert.match(pack, /invalidateOnboarding\(\)/);
  assert.match(read("src/components/collectionRoom/CollectionRoomScreen.tsx"), /<OnboardingCollectionCoach view=\{onboarding\} \/>/);
  const arena = read("src/app/duelos/jugar/page.tsx");
  assert.match(arena, /\{guidedMatch && !draftMode && stage === "match" && <FirstMatchHint view=\{view\} \/>\}\s*<MatchBoard/);
  assert.ok(!/FirstMatchHint|Onboarding/.test(read("src/components/duel/MatchBoard.tsx")), "el tablero de F61 no se toca");
  // RESULTADO ÚNICO · el resultado ya no apila el aviso de la guía; la guía sigue en la franja (`OnboardingRail`) y en
  // Progresión, y la partida terminada la invalida para que se relea.
  assert.ok(!arena.includes("<OnboardingAfterMatch") && arena.includes("invalidateOnboarding();"));
  assert.match(read("src/components/progression/ProgressionScreen.tsx"), /<OnboardingProgressCoach view=\{onboarding\.view\} \/>/);
  assert.match(read("src/components/layout/GameShell.tsx"), /<OnboardingRail \/>/);
  assert.ok(railVisibleOn("/jugar", "open") && railVisibleOn("/duelos/mazos", "deck") && railVisibleOn("/tienda", "welcome"));
  assert.ok(!railVisibleOn("/coleccion", "collection") && !railVisibleOn("/progresion", "progress"), "sin duplicar el bloque de esas pantallas");
  assert.ok(railVisibleOn("/coleccion", "welcome") && railVisibleOn("/progresion", "match"), "fuera de su paso, esas pantallas también dan contexto");
  assert.ok(!railVisibleOn("/cuenta", "open"));
  assert.match(read("src/components/home/MoreMenu.tsx"), /href: "\/como-jugar"/);
  assert.ok(existsSync(join(ROOT, "src/app/como-jugar/page.tsx")));
});

test("F63 U09 · alta y entrada: registro → portada; login → portada SOLO con la guía activa (cuentas terminadas no cambian)", () => {
  const f = read("src/components/auth/AuthForms.tsx");
  assert.match(f, /if \(mode === "register"\) return "\/";/);
  assert.match(f, /\(await fetchOnboarding\(\)\)\.active \? "\/" : null/);
});

test("F63 U10 · 404 heredados de F46: el <video> de la portada solo se monta si el fichero EXISTE", () => {
  const hall = read("src/components/home/NexusHall.tsx");
  const ready = /export const LOBBY_VIDEO_READY = (true|false);/.exec(hall)?.[1] === "true";
  const files = ["nexus-lobby.webm", "nexus-lobby.mp4", "nexus-lobby-poster.jpg"].map((f) => existsSync(join(ROOT, "public/video", f)));
  assert.equal(ready, files.every(Boolean), "la bandera dice la verdad sobre public/video");
  assert.match(hall, /\{videoReady && <video/);
  assert.match(read("src/components/home/MainMenu.tsx"), /useState\(LOBBY_VIDEO_READY\)/);
});
