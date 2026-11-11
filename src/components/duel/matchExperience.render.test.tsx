/**
 * FASE 45 · MATCH EXPERIENCE — render de las piezas reales y contratos de fuente.
 *
 * Cubre el camino entero: selector de modos, preparación, intro, mesa (escenario, bandos, turno, marcador), golpe
 * final, resultado y recompensas, más las escenas del arnés. Nada de esto evalúa reglas: todas las vistas salen del
 * motor puro (`qaSimulation`) o de fixtures con la forma exacta del servidor.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MatchBoard } from "./MatchBoard";
import { MatchComplete, MATCH_COMPLETE_MS, matchCompleteDuration } from "./MatchComplete";
import { MatchIntro } from "./MatchIntro";
import { ResultScreen } from "./ResultScreen";
import { GameModesHub } from "@/components/modes/GameModesHub";
import { gameModes, type ModeFacts } from "@/lib/campaign/presentation";
import { fase45Fixtures, FASE45_SCENES, SECTIONS_45, withResult } from "@/app/design-system/fase45/fixtures";
import type { DuelMatchView } from "@/lib/duel/types";

const ROOT = process.cwd();
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
const html = (n: React.ReactElement) => renderToStaticMarkup(n);
const noop = () => {};
const fx = fase45Fixtures();

const BOARD = read("src", "components", "duel", "MatchBoard.tsx");
const ARENA_PAGE = read("src", "app", "duelos", "jugar", "page.tsx");
const COMPLETE = read("src", "components", "duel", "MatchComplete.tsx");
const HUB = read("src", "components", "modes", "GameModesHub.tsx") + read("src", "components", "modes", "ModePanel.tsx");
const RESULT = read("src", "components", "duel", "ResultScreen.tsx");
/* RESULTADO ÚNICO · `ResultScreen` es un adaptador; la pantalla (animaciones, recompensas) vive aquí. */
const DUEL_RESULT = read("src", "components", "duel", "result", "DuelResult.tsx");
const CSS = read("src", "app", "game-experience.css");
const HARNESS = read("src", "app", "design-system", "fase45", "page.tsx");

const board = (view: DuelMatchView, o: { busy?: boolean; waiting?: boolean; revealing?: boolean } = {}) =>
  html(<MatchBoard view={view} onPlay={noop} busy={o.busy ?? false} error={null} onDismissError={noop} waitingRival={o.waiting ?? false} revealing={o.revealing ?? false} />);

const FACTS: ModeFacts = {
  signedIn: true, hasValidDeck: true, activePve: false, activePvp: false, rankedProvisional: false,
  campaign: { available: true, completed: 2, total: 15, complete: false, nextName: "Lectura de mapa", chapter: "Capítulo 1" },
  draft: { available: true, status: null, pick: 0, stage: 0, lastStatus: null },
};
const hub = (f: ModeFacts = FACTS) => html(<GameModesHub cards={gameModes(f)} rtcProgress={{ completed: 2, total: 15 }} />);

/* ═══════════ ESCENARIO DE LA ARENA ═══════════ */

test("ARENA 01 · la mesa se apoya en un escenario propio, no en la página", () => {
  assert.match(board(fx.attack), /nx-arena-stage/);
  assert.match(CSS, /\.nx-arena-stage \{ position: relative; isolation: isolate; \}/);
});

test("ARENA 02 · atacando, el escenario marca tu bando", () => {
  assert.match(board(fx.attack), /data-attacker="you"/);
});

test("ARENA 03 · defendiendo, el bando del rival", () => {
  assert.match(board(fx.defense), /data-attacker="rival"/);
});

test("ARENA 04 · partida terminada: ningún bando encendido", () => {
  assert.match(board(fx.win), /data-attacker="none"/);
});

test("ARENA 05 · el último turno calienta el canto de la mesa", () => {
  assert.match(board(fx.t10), /data-final="true"/);
  assert.match(CSS, /\[data-final="true"\] \.nx-arena-stage \[data-arena="mesa"\]/);
});

test("ARENA 06 · en un turno cualquiera no hay marca de último turno", () => {
  assert.match(board(fx.mid), /data-final="false"/);
});

test("ARENA 07 · el impacto del turno viaja en el propio tablero", () => {
  assert.match(board(fx.mid), /data-hit="/);
  for (const k of ["win", "loss", "tie"]) assert.match(CSS, new RegExp(`\\[data-hit="${k}"\\] \\.nx-arena-stage::after`));
});

test("ARENA 08 · el golpe del turno es una animación de una sola pasada bajo `no-preference`", () => {
  const block = CSS.split("@media (prefers-reduced-motion: no-preference)").find((b) => b.includes("nx-arena-hit"));
  assert.ok(block, "la animación del golpe vive bajo no-preference");
  assert.match(CSS, /@keyframes nx-arena-hit/);
});

test("ARENA 09 · el escenario no captura el puntero (la mesa se sigue pudiendo tocar)", () => {
  assert.match(CSS, /\.nx-arena-stage::before,\s*\n\.nx-arena-stage::after \{[\s\S]*?pointer-events: none;/);
});

test("ARENA 10 · la mesa es una pieza DENTRO de un recinto, y sigue declarando su fase", () => {
  /*
   * FASE 45 · la rejilla de dos columnas (mesa + panel de 300 px) desaparece: en su sitio va el
   * recinto, a sangre y por debajo de todo. Lo que este test protege ahora es que el fondo
   * exista, que esté anclado (`relative` en la raíz: sin él se colgaría de la página entera) y
   * que la fase visual se siga declarando en el mismo nodo.
   */
  assert.ok(!BOARD.includes("xl:grid-cols-[minmax(0,1fr)_300px]"), "el panel lateral ya no existe");
  assert.ok(BOARD.includes("<ArenaEnvironment"), "la mesa se monta dentro del recinto");
  assert.match(BOARD, /className="relative"[\s\S]{0,200}data-phase=\{phase\}/, "el recinto está anclado a la raíz");
  assert.ok(BOARD.includes("data-phase={phase}"));
  assert.ok(BOARD.includes("nx-arena-stage"), "el escenario de la mesa sigue en su sitio");
});

test("ARENA 10b · el recinto es fondo y nada más: ni puntero, ni decisiones, ni partículas sin contar", () => {
  const fuente = read("src", "components", "duel", "arena", "ArenaEnvironment.tsx");
  /*
   * Se mira el código que se EJECUTA, no lo que se documenta: el propio fichero explica en su
   * cabecera que no usa WebGL, y una comprobación por subcadena sobre el texto crudo se
   * tropezaría con esa misma frase. Misma convención que `matchSecurity.test.ts`.
   */
  const env = fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  assert.ok(env.includes("pointer-events-none"), "el recinto no intercepta el puntero");
  assert.ok(env.includes("aria-hidden"), "el recinto no habla a los lectores de pantalla");
  // Partículas ACOTADAS: un número fijo escrito en el fuente, no una cuenta derivada de nada.
  assert.match(env, /const MOTAS = Array\.from\(\{ length: 12 \}/, "las motas son doce, contadas");
  // Ni WebGL, ni canvas, ni vídeo: la ilusión es CSS.
  for (const prohibido of ["WebGL", "getContext", "<canvas", "<video", "THREE", "requestAnimationFrame"]) {
    assert.ok(!env.includes(prohibido), `el recinto no usa ${prohibido}`);
  }
});

test("ARENA 10c · el recinto se apaga entero con movimiento reducido", () => {
  assert.match(
    CSS,
    /@media \(prefers-reduced-motion: reduce\) \{\s*\.nx-arena-env-mote, \.nx-arena-env-horizon \{ animation: none; \}/,
    "sin movimiento, el recinto sigue estando pero no se mueve",
  );
});

test("ARENA 11 · el impacto se lee del veredicto del servidor (`turnImpact`), no se compara nada", () => {
  assert.ok(BOARD.includes("const impact = turnImpact(view.history[resolved - 1].outcome);"));
  assert.ok(!/history\[[^\]]*\]\.you\.value\s*[<>]/.test(BOARD), "el tablero no compara valores");
});

test("ARENA 12 · el marcador cambia solo cuando cambia (una `key` por valor)", () => {
  assert.match(BOARD, /AnimatePresence mode="popLayout" initial=\{false\}[\s\S]{0,400}key=\{valor\}/);
});

test("ARENA 13 · el sonido del turno es el del turno, no el del desenlace", () => {
  assert.ok(BOARD.includes("playSound(impact.sound)"));
  assert.ok(!BOARD.includes('playSound("match.win")'));
});

test("ARENA 14 · el tablero sigue sin poder decidir nada del combate", () => {
  for (const forbidden of ["resolveCombat", "computeCombatOvr", "createDuelBot", "Math.random", "localStorage"]) {
    assert.ok(!BOARD.includes(forbidden), forbidden);
  }
});

/* ═══════════ GOLPE FINAL ═══════════ */

test("COMPLETE 01 · VICTORIA con el marcador final", () => {
  const h = html(<MatchComplete result={fx.win.result!} onDone={noop} />);
  assert.match(h, /data-scene="match-complete"/);
  assert.match(h, /data-verdict="WIN"/);
  assert.match(h, />VICTORIA</);
  assert.match(h, /data-testid="match-complete-score"/);
});

test("COMPLETE 02 · DERROTA", () => {
  assert.match(html(<MatchComplete result={fx.loss.result!} onDone={noop} />), /data-verdict="LOSS"[\s\S]*>DERROTA</);
});

test("COMPLETE 03 · EMPATE", () => {
  assert.match(html(<MatchComplete result={fx.draw.result!} onDone={noop} />), /data-verdict="DRAW"[\s\S]*>EMPATE</);
});

/* F61 · en reducido era ≤0,5 s y se leía como un parpadeo en el PC del usuario (reduce): ahora legible, sin movimiento. */
test("COMPLETE 04 · dura entre 1 y 2 s; con movimiento reducido, legible (0,8 s–la completa) y sin recorrido", () => {
  assert.ok(MATCH_COMPLETE_MS.full >= 1000 && MATCH_COMPLETE_MS.full <= 2000);
  assert.equal(matchCompleteDuration(false), MATCH_COMPLETE_MS.full);
  assert.ok(matchCompleteDuration(true) >= 800 && matchCompleteDuration(true) <= MATCH_COMPLETE_MS.full);
});

test("COMPLETE 05 · se puede saltar con clic, Enter, Espacio o Escape", () => {
  assert.ok(COMPLETE.includes('e.key === "Enter" || e.key === " " || e.key === "Escape"'));
  assert.ok(COMPLETE.includes("onClick={onDone}"));
});

test("COMPLETE 06 · es un diálogo con nombre accesible y el marcador dentro", () => {
  const h = html(<MatchComplete result={fx.win.result!} onDone={noop} />);
  assert.match(h, /role="dialog"/);
  assert.match(h, /aria-label="VICTORIA\. \d+ a \d+"/);
});

test("COMPLETE 07 · el veredicto lo trae el servidor: aquí solo se traduce a título", () => {
  assert.ok(COMPLETE.includes("matchVerdict(result)"));
  assert.ok(!COMPLETE.includes("scoreYou >") && !COMPLETE.includes("winner ==="));
});

test("COMPLETE 08 · la arena lo monta antes del resultado y lo apaga sola", () => {
  assert.ok(ARENA_PAGE.includes("{complete && view?.result && ("));
  assert.ok(ARENA_PAGE.includes("onDone={() => setComplete(false)}"));
  assert.ok(ARENA_PAGE.includes("setComplete(true);"));
});

/* ═══════════ PLAY HUB ═══════════ */

test("HUB 01 · F71: el selector se titula JUGAR y no lleva subtítulo explicativo", () => {
  const h = hub();
  assert.match(h, />Jugar</);
  assert.ok(!/Elige tu próximo desafío/.test(h));
});

test("HUB 02 · F71: tres áreas (campaña, duelos, coach) con su CTA; los modos de duelo viven en /duelos", () => {
  const h = hub();
  for (const id of ["RTC", "DUELS", "COACH"]) assert.match(h, new RegExp(`data-testid="play-area-cta-${id}"`), id);
  assert.ok(!/data-testid="mode-cta-/.test(h));
});

test("HUB 03 · sin partida abierta la acción dominante es la campaña", () => {
  const h = hub();
  assert.equal((h.match(/data-cta="primary"/g) ?? []).length, 1);
  assert.match(h, /data-cta="primary"[^>]*data-testid="play-area-cta-RTC"/);
  assert.ok(!h.includes('data-testid="play-hub-resume"'));
});

test("HUB 04 · con partida abierta manda RETOMAR y el destacado deja de ser dominante", () => {
  const h = hub({ ...FACTS, activePve: true });
  assert.match(h, /data-testid="play-hub-resume"/);
  assert.match(h, /data-testid="play-hub-resume-cta"/);
  assert.equal((h.match(/data-cta="primary"/g) ?? []).length, 1, "una sola acción dominante");
});

test("HUB 05 · la banda de partida abierta usa el CTA que ya calcula el dominio", () => {
  const h = hub({ ...FACTS, activePve: true });
  assert.match(h, /Retomar/);
  assert.match(h, /href="\/duelos\/jugar"/);
});

test("HUB 06 · el mundo responde al apuntar cada modo", () => {
  assert.ok(HUB.includes("focusEnvironment(focus)"));
  assert.ok(HUB.includes("onMouseLeave={() => focusEnvironment(null)}"));
});

test("HUB 07 · cada área tiñe con su color (campaña oro, duelos magenta, coach cian) y enfoca el mundo", () => {
  assert.ok(HUB.includes('RTC: "255,211,92", DUELS: "255,46,99", COACH: "47,224,255"'));
  assert.ok(HUB.includes('focus="campaign"') && HUB.includes('focus="ranked"'));
});

test("HUB 08 · elegir modo suena", () => {
  assert.ok(HUB.includes('playSound("play.confirm")'));
  assert.ok(HUB.includes('playSound("ui.hover")'));
});

test("HUB 09 · sin equipo válido cada modo dice qué falta (sin inventar estado)", () => {
  assert.match(hub({ ...FACTS, hasValidDeck: false }), /EQUIPO NO VÁLIDO/);
});

test("HUB 10 · sin sesión, el hub no promete partidas", () => {
  assert.match(hub({ ...FACTS, signedIn: false, hasValidDeck: null, campaign: null, draft: null }), /INICIA SESIÓN/);
});

test("HUB 11 · sigue sin spinners genéricos", () => {
  assert.ok(!HUB.includes("animate-spin"));
});

test("HUB 12 · el hub no decide nada: los destinos siguen saliendo de `gameModes`", () => {
  assert.ok(!HUB.includes("router.push"));
  assert.ok(!/fetch\(/.test(HUB));
});

/* ═══════════ RESULTADO Y RECOMPENSAS ═══════════ */

const result = (view: DuelMatchView, xp: number | null = 4_200) =>
  html(<ResultScreen view={view} xp={xp} onPlayAgain={noop} onDecks={noop} onReplay={noop} deckId="qa" />);

test("RESULT 01 · victoria: titular, marcador y acciones", () => {
  const h = result(fx.win);
  assert.match(h, /data-scene="result"/);
  assert.match(h, /data-kind="win"/);
  assert.match(h, /data-testid="result-actions"/);
});

test("RESULT 02 · derrota con su propio tratamiento (sin barrido de victoria)", () => {
  const h = result(fx.loss);
  assert.match(h, /data-kind="loss"/);
  assert.ok(!h.includes("nx-result-sweep"));
});

test("RESULT 03 · empate", () => {
  assert.match(result(fx.draw), /data-kind="draw"/);
});

test("RESULT 04 · «volver a jugar» es la acción dominante", () => {
  const h = result(fx.win);
  const actions = h.slice(h.indexOf('data-testid="result-actions"'));
  assert.match(actions, /data-cta="primary"/);
});

test("RESULT 05 · las recompensas son las del recibo del servidor, en UNA línea: créditos y XP", () => {
  const { credits, xp } = fx.win.result!.award!;
  const h = result(withResult(fx.win, { rewards: { matchId: fx.win.matchId, capped: false, grants: [{ source: "MATCH", reward: { credits, xp }, points: 0 }] } }));
  assert.match(h, /data-testid="duel-result-rewards"/);
  assert.match(h, /data-field="credits"/);
  assert.match(h, /data-field="xp"/);
  assert.match(h, new RegExp(`\\+${credits}`));
  assert.match(h, new RegExp(`\\+${xp}`));
});

test("RESULT 06 · sin recompensa no se inventa ninguna (y no queda un bloque vacío)", () => {
  for (const r of [{ award: null }, { award: fx.win.result!.award, rewards: null }]) {
    const h = result(withResult(fx.loss, r));
    assert.ok(!h.includes("duel-result-rewards") && !h.includes('data-field="credits"'));
  }
});

test("RESULT 07 · el nivel y la barra de XP ya no están en el resultado (viven en Progresión)", () => {
  for (const s of [RESULT, DUEL_RESULT]) {
    assert.ok(!s.includes("LevelProgressPanel") && !s.includes("XpProgress"));
    assert.equal((s.match(/level-up/g) ?? []).length, 0);
  }
});

test("RESULT 08 · el resultado no habla de misiones (eso lo cuenta la progresión)", () => {
  assert.ok(!/objective|mission|misión/i.test(RESULT.replace(/\/\*[\s\S]*?\*\//g, "")));
});

test("RESULT 09 · desempate por OVR: el resultado da el veredicto del servidor sin repetir la explicación", () => {
  // El desempate se cuenta en escena ANTES del resultado (`TiebreakReveal`); el resultado no apila su panel.
  const h = result(fx.ovr);
  const kind = fx.ovr.result!.isDraw ? "draw" : fx.ovr.result!.winner === "YOU" ? "win" : "loss";
  assert.match(h, new RegExp(`data-kind="${kind}"`));
  assert.ok(!h.includes('data-decided="OVR_TIEBREAK"'));
});

test("RESULT 10 · la entrada de las recompensas respeta el movimiento reducido", () => {
  assert.ok(DUEL_RESULT.includes("initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}"));
  assert.ok(DUEL_RESULT.includes("const step = (d: number) => (reduced ? { duration: 0 }"));
});

/* ═══════════ INTRO ═══════════ */

test("INTRO 01 · la entrada existe y se puede saltar", () => {
  const h = html(<MatchIntro view={fx.attack} rivalName="Bot · Normal" onDone={noop} />);
  assert.match(h, /data-scene="intro"/);
  const src = read("src", "components", "duel", "MatchIntro.tsx");
  assert.match(src, /Escape|Enter/);
});

/*
 * F61 · la entrada pasó de un «VS» de 1,6 s a tres tiempos (rival → VS → equipo) de 2–5 s, como pide el encargo.
 * El modo reducido ya no se come la presentación (era ≤0,8 s): conserva los tres tiempos, legibles y sin movimiento,
 * porque es lo que ve el usuario en su PC (reduce). Sigue siendo saltable en cualquier momento.
 */
test("INTRO 02 · dura entre 2 y 5 s; con movimiento reducido, entre 1,5 s y la completa", () => {
  const ux = read("src", "lib", "duel", "gameplayUx.ts");
  const m = ux.match(/INTRO_MS = \{ full: ([\d_]+), reduced: ([\d_]+) \}/);
  assert.ok(m, "INTRO_MS declarado");
  const ms = (x: string) => Number(x.replace(/_/g, ""));
  assert.ok(ms(m![1]) >= 2000 && ms(m![1]) <= 5000, m![1]);
  assert.ok(ms(m![2]) >= 1500 && ms(m![2]) <= ms(m![1]), m![2]);
});

/* ═══════════ ARNÉS ═══════════ */

test("ARNÉS · las secciones del encargo están todas", () => {
  for (const s of ["PLAY HUB", "PRE MATCH", "MATCH INTRO", "ARENA", "TURN", "CLASH", "SCORE", "FINAL TURN", "WAITING", "MATCH COMPLETE", "RESULT", "REWARDS", "RANKED", "CAMPAIGN", "DRAFT", "REDUCED MOTION", "MOBILE"]) {
    assert.ok(SECTIONS_45.includes(s as never), s);
  }
});

test("ARNÉS · al menos 50 escenas y sin ids repetidos", () => {
  assert.ok(FASE45_SCENES.length >= 50, String(FASE45_SCENES.length));
  assert.equal(new Set(FASE45_SCENES.map((s) => s.id)).size, FASE45_SCENES.length);
});

test("ARNÉS · las escenas dicen que son sintéticas", () => {
  assert.match(HARNESS, /QA SYNTHETIC/);
});

for (const scene of FASE45_SCENES) {
  test(`ESCENA · ${scene.id} (${scene.section}) está montada en el arnés`, () => {
    assert.ok(HARNESS.includes(`"${scene.id}"`), `falta el caso de ${scene.id}`);
    assert.ok(scene.note.length >= 6, `la escena ${scene.id} explica qué enseña`);
  });
}

/* ═══════════ FIXTURES ═══════════ */

test("FIXTURES · las partidas del arnés salen del motor puro y están completas", () => {
  assert.equal(fx.win.status, "COMPLETED");
  assert.equal(fx.loss.status, "COMPLETED");
  assert.equal(fx.win.history.length, 10);
  assert.equal(fx.win.result!.winner, "YOU");
  assert.equal(fx.loss.result!.winner, "RIVAL");
});

test("FIXTURES · lo fabricado se declara (nada se hace pasar por real)", () => {
  assert.ok(typeof fx.fabricated.draw === "boolean");
  assert.ok(typeof fx.fabricated.ovr === "boolean");
  assert.ok(typeof fx.fabricated.tie === "boolean");
});

test("FIXTURES · la vista en juego enseña diez posiciones y una mano", () => {
  assert.equal(fx.attack.totalTurns, 10);
  assert.ok(fx.attack.yourHand.length > 0);
  assert.equal(fx.attack.status, "IN_PROGRESS");
});
