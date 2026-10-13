/**
 * FASE 44 · GAME EXPERIENCE 4.0 — render de las piezas reales y contratos de fuente.
 *
 * Cubre: JUGAR global, lobby (escenario + héroe con UN dominante), selector de modos, inventario y resumen de sobre,
 * resultado (acciones arriba, XP real, empate/derrota), rating antes→después, momentos, cargador, estados, toasts,
 * 404/errores, capas (sin overlay pegado), armazón (textos fijados), autoridad del servidor, marketplace, copy y
 * movimiento reducido en la CSS.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { PlayButton } from "./PlayButton";
import { GameLoader } from "./GameLoader";
import { GameEmpty, GameError, GameOffline, playerMessage, TECHNICAL_PATTERN } from "./GameStates";
import { GameMomentView } from "./GameMoment";
import { GameModal, GameSheet } from "./GameOverlay";
import { GameSkeleton } from "./GameSkeleton";
import { XpProgress } from "./XpProgress";
import { Toast } from "@/components/ui/Toast";
import { EmptyState, ErrorState, Loading, NeedsAccount } from "@/components/ui/States";
import { DailyLobby } from "@/components/dailyLoop/DailyLobby";
import { LobbyPlayStage, lobbyModes } from "@/components/dailyLoop/LobbyPlayStage";
import { GameModesHub } from "@/components/modes/GameModesHub";
import { DuelModesHub } from "@/components/modes/DuelModesHub";
import { PackOpenStage } from "@/components/packs/PackOpenStage";
import { PackSummary } from "@/components/packs/PackSummary";
import { ResultScreen } from "@/components/duel/ResultScreen";
import { RatingDelta } from "@/components/duel/pvp/PvpOutcome";
import NotFound from "@/app/not-found";
import { EventStatusBadge } from "@/components/liveEvents/bits";
import { buildDailyLoop, type DailyLoopSnapshot } from "@/domain/dailyLoop";
import { homeJourneyMode } from "@/lib/journey/presentation";

const homeJourneyModeFor = (snap: DailyLoopSnapshot) => homeJourneyMode(snap, { dismissed: false });
import { SCENES as LOBBY } from "@/app/design-system/fase36/fixtures";
import { SCENES as PACK_SCENES } from "@/app/design-system/fase38/fixtures";
import { SCENES as FTUE } from "@/app/design-system/fase40/fixtures";
import { welcomeCards } from "@/lib/journey/presentation";
import { FASE44_SCENES, SECTIONS } from "@/app/design-system/fase44/fixtures";
import { buildRevealPlan } from "@/domain/packs/reveal";
import { CARDS, getCard, getPlayer } from "@/data/catalog";
import { getPack, PACKS } from "@/data/packs";
import { gameModes } from "@/lib/campaign/presentation";
import { playCta } from "@/design/gameShell";
import { MOMENT_COPY, type MomentKind } from "@/lib/gameExperience/moments";
import { qaSimulate, qaSnapshot, qaView } from "@/lib/duel/qaSimulation";
import type { DuelMatch } from "@/domain/cardgame/match";
import type { DuelMatchView, DuelResultView } from "@/lib/duel/types";
import { totalXpForLevel } from "@/domain/progression/levels";
import { GLOBAL_MARKET_ENABLED } from "@/config/features";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const noop = () => {};
const CAT = { cards: CARDS, getCard, getPlayer };

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

/* ───────────── JUGAR ───────────── */

for (const size of ["bar", "hero", "dock"] as const) {
  test(`JUGAR · ${size}: enlace de juego con destino, rol y nombre accesible`, () => {
    const h = html(<PlayButton cta={playCta(null)} size={size} />);
    assert.match(h, /href="\/jugar"/); assert.match(h, /data-game-cta="play"/); assert.match(h, /data-cta="primary"/);
    assert.match(h, /aria-label="Jugar: elegir modo de juego"/); assert.match(h, new RegExp(`data-size="${size}"`));
  });
  test(`CONTINUAR · ${size}: solo con partida del servidor, con su destino`, () => {
    const h = html(<PlayButton cta={playCta({ resume: { id: "resume-pve", label: "Continuar partida", href: "/duelos/jugar", eyebrow: "Partida rápida · en curso", title: "t" } })} size={size} />);
    assert.match(h, /href="\/duelos\/jugar"/); assert.match(h, /data-kind="resume"/);
  });
}
test("JUGAR · el halo es decorativo (aria-hidden) y no hay texto oculto engañoso", () => {
  const h = html(<PlayButton cta={playCta(null)} size="hero" />);
  assert.match(h, /aria-hidden="true" class="nx-play-halo"/);
});

/* ───────────── lobby ───────────── */

const lobbyNames = Object.keys(LOBBY).filter((n) => LOBBY[n].facts && !LOBBY[n].skeleton);
for (const name of lobbyNames) {
  test(`LOBBY · ${name}: un único CTA dominante y la acción del Live Service presente`, () => {
    const s = LOBBY[name];
    const snap = buildDailyLoop(s.facts!);
    const h = html(<DailyLobby snap={snap} now={s.facts!.now} network={s.network ?? "online"} />);
    const primaries = (h.match(/data-cta="primary"/g) ?? []).length;
    const mission = homeJourneyModeFor(snap) === "mission";
    if (!mission) assert.equal(primaries, 1, `dominantes: ${primaries}`);
    if (!mission) assert.match(h, /data-testid="daily-hero"/);
    const playHero = snap.primaryAction.kind === "play" || snap.primaryAction.kind === "resume";
    assert.equal(/data-testid="lobby-play-stage"/.test(h), !mission && !playHero, "escenario JUGAR solo si la acción del día no es ya jugar");
    if (!mission && !playHero) assert.match(h, /data-testid="daily-hero"[^>]*data-tier="context"/);
    if (!mission && playHero && !(s.network === "offline")) assert.match(h, /class="nx-play[^"]*"[^>]*data-testid="daily-primary-cta"|data-testid="daily-primary-cta"/);
  });
}
test("LOBBY · partida a medias: el héroe ES CONTINUAR PARTIDA (sin escenario duplicado)", () => {
  const s = LOBBY["match-pve"];
  const h = html(<DailyLobby snap={buildDailyLoop(s.facts!)} now={s.facts!.now} />);
  assert.ok(!/lobby-play-stage/.test(h)); assert.match(h, /data-kind="resume"/); assert.match(h, /Continuar partida/);
});
test("LOBBY · escenario: modos reales con destinos existentes", () => {
  const snap = buildDailyLoop(LOBBY.claim.facts!);
  for (const mo of lobbyModes(snap)) assert.ok(routeExists(mo.href), mo.href);
  const h = html(<LobbyPlayStage snap={snap} />);
  assert.equal((h.match(/data-mode="/g) ?? []).length, 4);
  assert.ok(!/<h1/.test(h), "el único h1 del lobby es el del héroe");
});
test("LOBBY · escenario: dice con qué equipo juegas (dato real) o que no lo tienes", () => {
  const h = html(<LobbyPlayStage snap={buildDailyLoop(LOBBY.claim.facts!)} />);
  assert.match(h, /data-testid="lobby-deck-line"/);
  const none = html(<LobbyPlayStage snap={buildDailyLoop(LOBBY["no-deck"].facts!)} />);
  assert.match(none, /Crear equipo|Completar equipo|Todavía no tienes equipo|Tu equipo/);
});

test("FTUE · primer combate: el CTA de la guía es el botón JUGAR grande (mismo destino fijado por la Fase 40)", () => {
  const s = FTUE["deck-saved"] as { facts: Parameters<typeof buildDailyLoop>[0]; network?: "online" | "offline" | "error" };
  const h = html(<DailyLobby snap={buildDailyLoop(s.facts)} now={s.facts.now} network={s.network ?? "online"} welcomeCards={welcomeCards(CARDS, getPlayer)} />);
  const tag = h.match(/<a [^>]*data-testid="journey-primary-cta"[^>]*>Jugar mi primer combate/)?.[0] ?? "";
  assert.ok(tag.includes('class="nx-play') && tag.includes('data-size="hero"') && tag.includes('href="/duelos/jugar?dificultad=EASY&amp;primera=1"'), tag);
});
test("FTUE · bienvenida: ABRIR MI PRIMER SOBRE sigue siendo la acción (sin escenario JUGAR encima de la guía)", () => {
  const s = FTUE.welcome as { facts: Parameters<typeof buildDailyLoop>[0] };
  const h = html(<DailyLobby snap={buildDailyLoop(s.facts)} now={s.facts.now} welcomeCards={welcomeCards(CARDS, getPlayer)} />);
  assert.ok(!/lobby-play-stage/.test(h)); assert.match(h, /href="\/abrir\/inicial"/);
});

/* ───────────── modos ───────────── */

const FACTS = { signedIn: true, hasValidDeck: true, activePve: false, activePvp: false, rankedProvisional: false, campaign: { available: true, completed: 4, total: 15, complete: false, nextName: "x", chapter: "Capítulo 1" }, draft: null };
test("MODOS · F71: /jugar son tres paneles grandes con respuesta (nx-mode) y un CTA por área", () => {
  const h = html(<GameModesHub cards={gameModes(FACTS)} />);
  for (const id of ["RTC", "DUELS", "COACH"]) assert.match(h, new RegExp(`data-testid="play-area-cta-${id}"`));
  assert.equal((h.match(/class="nx-mode /g) ?? []).length, 3);
});
test("MODOS · F72: /duelos son cuatro paneles grandes (nx-mode) que se SELECCIONAN; solo el elegido lleva el CTA", () => {
  const h = html(<DuelModesHub cards={gameModes(FACTS)} />);
  for (const id of ["QUICK", "RANKED", "FRIEND", "DRAFT_GAUNTLET"]) assert.match(h, new RegExp(`data-testid="duel-mode-select-${id}"`));
  assert.equal((h.match(/class="nx-mode /g) ?? []).length, 4);
  assert.equal((h.match(/data-testid="duel-mode-cta-/g) ?? []).length, 1);
});
test("MODOS · bloqueo real sin equipo: el motivo se ve", () => {
  assert.match(html(<GameModesHub cards={gameModes({ ...FACTS, hasValidDeck: false })} />), /EQUIPO NO VÁLIDO/);
  assert.match(html(<DuelModesHub cards={gameModes({ ...FACTS, hasValidDeck: false })} />), /EQUIPO NO VÁLIDO/);
});
for (const c of gameModes(FACTS)) test(`MODOS · ${c.id} lleva a una pantalla que existe`, () => { assert.ok(routeExists(c.cta.href), c.cta.href); });

/* ───────────── sobres ───────────── */

for (const p of PACKS.filter((x) => x.lifecycle === "ACTIVE").slice(0, 6)) {
  test(`INVENTARIO · ${p.id}: ABRIR SOBRE domina y lleva a la ceremonia`, () => {
    const h = html(<PackOpenStage pack={p} packId={p.id} total={2} />);
    assert.match(h, new RegExp(`href="/abrir/${p.id}"[^>]*data-cta="primary"|data-cta="primary"[^>]*href="/abrir/${p.id}"`));
    assert.match(h, /Abrir sobre/); assert.match(h, /Tienes 2 sobres sin abrir/);
  });
}
const summaryScenes = Object.entries(PACK_SCENES).filter(([, s]) => s.kind === "summary");
for (const [name, s] of summaryScenes) {
  test(`RESUMEN · ${name}: dock de acciones pegado, un dominante y JUGAR secundario`, () => {
    if (s.kind !== "summary") return;
    const plan = buildRevealPlan(s.plan.opened, s.plan.before, CAT);
    const h = html(<PackSummary packName="Sobre" plan={plan} available={s.available} packsLeft={s.packsLeft} onOpenAnother={noop} onNavigate={noop} />);
    assert.match(h, /class="sticky bottom-0[^"]*"/);
    assert.equal((h.match(/data-cta="primary"/g) ?? []).length, 1);
    assert.match(h, /data-testid="summary-play"/);
    if (s.available > 0) assert.match(h, /Abrir otro sobre · \d/);
  });
}
test("CEREMONIA · luz de sala (nivel 4) solo para legendaria o serial #1 y tras revelar", () => {
  const src = code(read("src/components/packs/CardReveal.tsx"));
  assert.ok(src.includes('{revealed && (item?.rarity === "legendary" || numberOne) && ('));
  assert.ok(src.includes('data-motion-level="4"'));
});
test("CEREMONIA · autoridad intacta: la apertura sigue pidiendo al servidor antes de revelar", () => {
  const exp = read("src/components/packs/PackOpeningExperience.tsx");
  assert.ok(/openPack|requestOpen|open\(/.test(exp));
  assert.ok(!/Math\.random\(/.test(code(read("src/components/packs/PackSummary.tsx")) + code(read("src/components/packs/PackOpenStage.tsx"))));
});

/* ───────────── resultado ───────────── */

const fx = (() => {
  const mine = qaSnapshot(0, "qa-you", "QA · Mi equipo");
  const rival = qaSnapshot(1, "qa-rival", "QA · Rival");
  let win: DuelMatch | null = null, loss: DuelMatch | null = null;
  for (let seed = 1; seed <= 400 && (!win || !loss); seed++) {
    const m = qaSimulate(mine, rival, 10, seed % 2 ? "A" : "B", seed);
    if (m.result?.winner === "A" && !win) win = m;
    if (m.result?.winner === "B" && !loss) loss = m;
  }
  return { win: qaView(win!), loss: qaView(loss!) };
})();
const withResult = (v: DuelMatchView, r: Partial<DuelResultView>): DuelMatchView => ({ ...v, result: { ...v.result!, ...r } });
const result = (v: DuelMatchView, xp: number | null) => html(<ResultScreen view={v} xp={xp} onPlayAgain={noop} onChange={noop} onDecks={noop} onReplay={noop} />);

test("VICTORIA · título, nivel 3, acciones ANTES de la historia de la partida", () => {
  const h = result(withResult(fx.win, { award: { points: 14, credits: 220, xp: 110 } }), totalXpForLevel(6) + 300);
  assert.match(h, /data-kind="win"[^>]*data-motion-level="3"/); assert.match(h, />Victoria</);
  // La SECCIÓN del historial, no la frase: «Los diez turnos…» también aparece en la explicación de un desempate.
  const historial = h.indexOf('aria-label="Historial completo"');
  assert.ok(historial > 0, "la sección del historial existe");
  assert.ok(h.indexOf('data-testid="result-actions"') < historial);
  assert.match(h, /Revancha/); assert.match(h, /href="\/"[^>]*>Volver al lobby/);
});
test("DERROTA · presentación propia sin barrido de celebración, con progreso y siguiente acción", () => {
  const h = result(withResult(fx.loss, { award: { points: 0, credits: 40, xp: 25 } }), totalXpForLevel(6) + 300);
  assert.match(h, />Derrota</); assert.ok(!/nx-result-sweep/.test(h)); assert.match(h, /data-testid="xp-progress"/); assert.match(h, /Revancha/);
});
test("EMPATE · presentación propia (nivel 2)", () => {
  const h = result(withResult(fx.win, { isDraw: true, winner: null, decidedBy: "NONE", scoreYou: 5, scoreRival: 5 }), null);
  assert.match(h, /data-kind="draw"[^>]*data-motion-level="2"/); assert.match(h, />Empate</);
});
test("XP · SUBIDA DE NIVEL solo si la XP real cruza un nivel", () => {
  assert.match(html(<XpProgress xp={totalXpForLevel(8) + 40} gained={110} />), /data-level-up="true"/);
  assert.match(html(<XpProgress xp={totalXpForLevel(8) + 400} gained={110} />), /data-level-up="false"/);
});
test("XP · la barra es accesible y dice el nivel (no solo animación)", () => {
  const h = html(<XpProgress xp={totalXpForLevel(8) + 40} gained={110} />);
  assert.match(h, /role="progressbar"[^>]*aria-valuenow="\d+"/); assert.match(h, /aria-label="Nivel 8, \d+% hacia el siguiente; has subido un nivel"/);
});
for (const delta of [18, -12, 0, 31]) {
  test(`RANKED · delta ${delta}: solo antes, después y delta reales (sin cifras intermedias)`, () => {
    const h = html(<RatingDelta outcome={{ matchId: "m", oldRating: 1201, delta, newRating: 1201 + delta, opponentRating: 1246, kFactor: 24, result: delta > 0 ? "WIN" : delta < 0 ? "LOSS" : "DRAW", createdAt: 0 }} />);
    const nums = [...h.replace(/<[^>]+>/g, " ").matchAll(/-?\d+/g)].map((x) => Number(x[0]));
    for (const n of nums) assert.ok([1201, 1201 + delta, delta, Math.abs(delta)].includes(n), String(n));
    assert.match(h, /data-motion-level="3"/);
  });
}

/* ───────────── momentos, estados, capas ───────────── */

for (const kind of Object.keys(MOMENT_COPY) as MomentKind[]) {
  test(`MOMENTO · ${kind}: rótulo anunciable con el hecho real`, () => {
    const h = html(<GameMomentView moment={{ key: kind, kind, fact: "Hecho real" }} inline />);
    assert.match(h, /aria-live="polite"/); assert.match(h, /role="status"/); assert.match(h, /Hecho real/);
    assert.match(h, new RegExp(MOMENT_COPY[kind].title));
  });
}
test("MOMENTO · en pantallas inmersivas va abajo (no tapa «VICTORIA» ni «TU SOBRE»)", () => {
  const m = { key: "k", kind: "objective" as const, fact: "Gana un duelo" };
  assert.match(html(<GameMomentView moment={m} placement="bottom" />), /data-placement="bottom"[^>]*class="[^"]*bottom-\[/);
  assert.match(html(<GameMomentView moment={m} />), /data-placement="top"[^>]*class="[^"]*top-\[/);
  assert.ok(read("src/components/layout/GameShell.tsx").includes('<GameMomentProvider placement="bottom">'));
});
test("CARGADOR · marca NEXUS, rol status, sin spinner ni porcentaje", () => {
  const h = html(<GameLoader label="Preparando duelo…" />);
  assert.match(h, /role="status"/); assert.ok(!/animate-spin/.test(h)); assert.ok(!/\d+\s?%/.test(h)); assert.match(h, /Preparando duelo…/);
});
test("CARGADOR · `Loading` y la puerta de hidratación ya no usan spinner", () => {
  assert.ok(!/animate-spin/.test(html(<Loading label="x" />)));
  assert.ok(!/animate-spin/.test(read("src/components/layout/HydrationGate.tsx")));
});
for (const kind of ["hero", "cards", "deck"] as const) {
  test(`ESQUELETO · ${kind}: contextual, aria-busy, sin cifras`, () => {
    const h = html(<GameSkeleton kind={kind} />);
    assert.match(h, /aria-busy="true"/); assert.ok(!/\d{2,}/.test(h.replace(/<[^>]+>/g, "")));
  });
}
test("ERROR · «No se ha podido cargar» + Reintentar + Volver al lobby", () => {
  const h = html(<GameError message="Road to Champions no responde" onRetry={noop} />);
  assert.match(h, /No se ha podido cargar/); assert.match(h, /Reintentar/); assert.match(h, /Volver al lobby/); assert.match(h, /role="alert"/);
});
for (const raw of ["Failed to fetch", "TypeError: x is undefined", "Internal Server Error", "HTTP 500", "PGRST116 JSON object requested", "supabase: relation does not exist", "Unexpected token < in JSON"]) {
  test(`ERROR · técnico filtrado: «${raw}»`, () => {
    assert.ok(TECHNICAL_PATTERN.test(raw));
    const h = html(<GameError message={raw} />);
    assert.ok(!h.includes(raw)); assert.match(h, /Tu progreso está a salvo/);
  });
}
for (const ok of ["Road to Champions no responde ahora mismo", "No te queda este sobre", "Te faltan 450 créditos"]) {
  test(`ERROR · frase de juego conservada: «${ok}»`, () => { assert.equal(playerMessage(ok), ok); });
}
test("ERROR · `ErrorState` usa la pieza de juego", () => { assert.match(html(<ErrorState message="Failed to fetch" onRetry={noop} />), /No se ha podido cargar/); });
test("VACÍO · siempre con siguiente acción y sin emoji", () => {
  const h = html(<EmptyState icon="📭" title="Sin movimientos" />);
  assert.ok(!h.includes("📭")); assert.match(h, /href="\/jugar"/);
  const g = html(<GameEmpty title="No tienes sobres" primary={{ href: "/tienda", label: "Conseguir sobres" }} />);
  assert.match(g, /Conseguir sobres/);
});
test("CUENTA · entrar o volver al lobby, sin emoji", () => {
  const h = html(<NeedsAccount what="El modo competitivo" />);
  assert.ok(!h.includes("🔐")); assert.match(h, /Entrar o registrarse/); assert.match(h, /Volver al lobby/);
});
test("OFFLINE · ESTÁS SIN CONEXIÓN + datos posiblemente desactualizados, sin acciones falsas", () => {
  const h = html(<GameOffline />);
  assert.match(h, /Estás sin conexión/); assert.match(h, /pueden estar desactualizados/); assert.ok(!/<button|<a /.test(h));
});
test("TOAST · aviso de juego; un error técnico nunca llega crudo", () => {
  assert.ok(!html(<Toast toast={{ id: 1, msg: "Failed to fetch", ok: false }} />).includes("Failed to fetch"));
  assert.ok(!/✓|✕/.test(code(read("src/components/ui/Toast.tsx"))));
});
test("CAPAS · cerradas no dejan NADA montado (sin overlay pegado)", () => {
  assert.equal(html(<GameSheet open={false} onClose={noop} title="x"><p>y</p></GameSheet>), "");
  assert.equal(html(<GameModal open={false} onClose={noop} title="x" />), "");
});
test("CAPAS · abiertas: diálogo modal con título, Escape y foco atrapado en el código", () => {
  const h = html(<GameModal open onClose={noop} title="¿Abandonar la run?" />);
  assert.match(h, /role="dialog"/); assert.match(h, /aria-modal="true"/);
  const src = read("src/components/ui/game/GameOverlay.tsx");
  assert.ok(src.includes('e.key === "Escape" && dismissable') && src.includes('e.key !== "Tab"') && src.includes("opener.focus()"));
  // Fase 44.1 · el bloqueo de fondo es el compartido con contador (se libera siempre).
  assert.ok(src.includes("const release = lockScroll();") && src.includes("release();"));
});
test("404 · pertenece al juego: VOLVER AL LOBBY y JUGAR", () => {
  const h = html(<NotFound />);
  assert.match(h, /Volver al juego/); assert.match(h, /href="\/jugar"/); assert.ok(!/could not be found/i.test(h)); // F64 · «VOLVER AL JUEGO»
});
test("ERROR FATAL · sin traza para el jugador", () => {
  for (const f of ["src/app/error.tsx", "src/app/global-error.tsx"]) {
    const s = code(read(f));
    assert.ok(!/error\.stack|\{error\.message\}|\{String\(error\)\}/.test(s), f);
    assert.match(s, /Reintentar|onRetry=\{reset\}/); assert.match(s, /lobby|GameError/i);
  }
});

/* ───────────── armazón, autoridad y contratos ───────────── */

const SHELL = read("src/components/layout/GameShell.tsx");
test("ARMAZÓN · JUGAR en barra y en el centro del dock; menú móvil; transiciones por familia", () => {
  assert.ok(SHELL.includes('<PlayButton cta={cta} size="bar"') && SHELL.includes('size="dock"'));
  assert.ok(SHELL.includes("<MobileMenuSheet") && SHELL.includes('<MotionConfig reducedMotion="user">'));
  assert.ok(read("src/components/layout/PageTransition.tsx").includes("pageMotion(family, reduced)"));
});
test("ARMAZÓN · textos fijados por fases anteriores intactos", () => {
  assert.ok(SHELL.includes('item.section === "jugar" ? badges.social : 0'));
  assert.ok(SHELL.includes("const live = useLiveBadge(!!user);") && SHELL.includes("live };"));
});
test("AUTORIDAD · CONTINUAR PARTIDA sale del servidor (una lectura de solo lectura, sin segunda prioridad)", () => {
  const route = read("src/app/api/game/play-status/route.ts");
  assert.ok(/export async function GET\(/.test(route) && !/export (async )?function (POST|PUT|PATCH|DELETE)\b/.test(route));
  assert.ok(route.includes('if ([...q.keys()].length > 0)'));
  const svc = read("src/server/services/playStatus.ts");
  assert.ok(svc.includes("readActiveMatches(sb, userId)") && svc.includes("primaryResume(read.matches)"));
  assert.ok(!/\.(insert|update|upsert|delete)\(|\.rpc\(|orderToday/.test(code(svc)));
  const client = read("src/lib/gameShell/playStatus.ts");
  assert.ok(!/userId|user_id/.test(code(client).replace(/userKey/g, "")));
});
test("AUTORIDAD · la UI no calcula recompensas, rareza, rating ni XP", () => {
  const files = ["src/components/ui/game/XpProgress.tsx", "src/lib/gameExperience/xp.ts", "src/components/dailyLoop/LobbyPlayStage.tsx", "src/components/packs/PackOpenStage.tsx", "src/lib/gameExperience/deckMoments.ts"];
  for (const f of files) assert.ok(!/award\s*[+\-*]|credits\s*\+|Math\.random|rarityOf\(|newRating\s*=/.test(code(read(f))), f);
});
test("MARKETPLACE · sigue cerrado y fuera de la navegación", () => {
  assert.equal(GLOBAL_MARKET_ENABLED, false);
  assert.ok(!read("src/design/nav.ts").includes('href: "/mercado"'));
  assert.ok(!read("src/app/inventario/page.tsx").includes('href="/mercado"'));
});
test("CONFIRMACIONES · ninguna pantalla de jugador usa confirm()/alert() del navegador", () => {
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? (e.name === "admin" || e.name === "design-system" ? [] : walk(join(d, e.name))) : e.name.endsWith(".tsx") && !e.name.includes(".test.") ? [join(d, e.name)] : []);
  for (const f of [...walk(join(ROOT, "src/app")), ...walk(join(ROOT, "src/components"))]) {
    assert.ok(!/window\.(confirm|alert)\(|(^|[^\w.])alert\(/.test(code(readFileSync(f, "utf8"))), f);
  }
});
const CORE_UI = [
  "src/app/page.tsx", "src/app/jugar/page.tsx", "src/app/inventario/page.tsx", "src/app/tienda/page.tsx", "src/app/coleccion/page.tsx",
  "src/app/duelos/mazos/page.tsx", "src/app/duelos/competitivo/page.tsx", "src/app/temporada/page.tsx", "src/app/jugar/road-to-champions/page.tsx",
  "src/app/jugar/draft-gauntlet/page.tsx", "src/components/dailyLoop/DailyLobby.tsx", "src/components/modes/GameModesHub.tsx", "src/components/modes/DuelModesHub.tsx",
  "src/components/modes/ModePanel.tsx", "src/app/duelos/page.tsx", "src/components/ui/States.tsx",
];
for (const f of CORE_UI) test(`SIN SPINNER · ${f}`, () => { assert.ok(!/animate-spin/.test(read(f)), f); });
test("COPY · las piezas nuevas no dicen Success/Updated/Saved ni errores técnicos", () => {
  const dir = join(ROOT, "src/components/ui/game");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".tsx") && !x.includes(".test."))) {
    const s = code(readFileSync(join(dir, f), "utf8")).replace(/TECHNICAL_PATTERN = \/.*\/i;/, "");
    assert.ok(!/>\s*(Success|Updated|Saved|Error 500|Failed to fetch|Something went wrong)\s*</i.test(s), f);
  }
});
test("MOVIMIENTO REDUCIDO · toda animación de la CSS de juego vive bajo `no-preference`", () => {
  const css = read("src/app/game-experience.css");
  const uses = [...css.matchAll(/animation:\s*nx-[a-z-]+/g)];
  assert.ok(uses.length >= 6);
  const blocks = [...css.matchAll(/@media \(prefers-reduced-motion: no-preference\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]).join("\n");
  for (const u of uses) assert.ok(blocks.includes(u[0]), u[0]);
});
test("MOVIMIENTO REDUCIDO · hover/press del botón JUGAR se apagan", () => {
  assert.match(read("src/app/game-experience.css"), /@media \(prefers-reduced-motion: reduce\) \{\s*\.nx-play, \.nx-play-icon, \.nx-play-halo \{ transition: none; \}/);
});
test("RENDIMIENTO · la CSS de juego no anima sombras ni desenfoques en bucle", () => {
  const css = read("src/app/game-experience.css");
  for (const k of [...css.matchAll(/@keyframes [\w-]+ \{([\s\S]*?)\}\s*\}/g)]) assert.ok(!/box-shadow|filter|width|height|top|left/.test(k[1]), k[0].slice(0, 40));
});

/* ───────────── no fake live ───────────── */

test("NO FAKE LIVE · evento DEMO con partido `live` en BD: «Partido de demo», sin pulso ni «En directo»", () => {
  const demo = html(<EventStatusBadge lifecycle="ACTIVE" label="En curso" live isDemo />);
  assert.ok(!/En directo/.test(demo)); assert.match(demo, /Partido de demo/);
  assert.match(html(<EventStatusBadge lifecycle="ACTIVE" label="En curso" live />), /En directo/);
  assert.match(html(<EventStatusBadge lifecycle="ACTIVE" label="En curso" />), /En curso/);
});
test("NO FAKE LIVE · tarjeta, héroe de evento y paso de progresión exigen evento real", () => {
  assert.ok(read("src/components/liveEvents/EventCard.tsx").includes('(ev.isDemo ? "Partido de demo" : "En directo")'));
  assert.ok(read("src/components/liveEvents/EventHero.tsx").includes('(event.isDemo ? "Partido de demo" : "En directo")'));
  assert.ok(read("src/server/services/loop.ts").includes('circuit.liveMatch && !circuit.isDemo ? "Hay partido en directo"'));
});

/* ───────────── arnés ───────────── */

test("ARNÉS · cubre todas las secciones del encargo", () => {
  for (const sec of ["GAME SHELL", "PLAY CTA", "MODE SELECT", "HOME", "PACKS", "PACK OPENING", "COLLECTION", "CARD DETAIL", "DECKS", "STRATEGY", "PREMATCH", "COMBAT", "RESULTS", "CAMPAIGN", "DRAFT", "RANKED", "SEASON", "MISSIONS", "ACHIEVEMENTS", "EVENTS", "PICKEMS", "PROFILE", "EMPTY", "ERROR", "OFFLINE", "LOADING", "MOTION", "REDUCED MOTION"]) {
    assert.ok((SECTIONS as string[]).includes(sec), sec);
  }
});
test("ARNÉS · laboratorio de sobres con común→legendaria, serial #1, todas nuevas/duplicadas y mezcla", () => {
  const ids = FASE44_SCENES.map((s) => s.id);
  for (const id of ["pack-common", "pack-uncommon", "pack-rare", "pack-epic", "pack-legendary", "pack-serial-one", "pack-summary-all-new", "pack-summary-all-dup", "pack-summary-mixed"]) assert.ok(ids.includes(id), id);
});
test("ARNÉS · laboratorio de resultados: victoria, derrota, empate, subida de nivel, objetivo, logro y rating", () => {
  const ids = FASE44_SCENES.map((s) => s.id);
  for (const id of ["result-victory", "result-defeat", "result-draw", "result-level-up", "moments", "rating-delta"]) assert.ok(ids.includes(id), id);
});
for (const s of FASE44_SCENES.filter((x) => x.frame)) {
  test(`ARNÉS · ${s.id} apunta a un arnés que existe`, () => { assert.ok(routeExists(s.frame!), s.frame); });
}
test("ARNÉS · fuera de producto: no hay datos falsos en la BD ni cartas insertadas", () => {
  const page = code(read("src/app/design-system/fase44/page.tsx"));
  assert.ok(!/fetch\(|getSupabase|\/api\/game/.test(page));
});
