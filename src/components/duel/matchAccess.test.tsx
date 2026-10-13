/**
 * FASE 45 · ACCESIBILIDAD, MOVIMIENTO REDUCIDO Y ANCHOS DE LA PARTIDA.
 *
 * Lo que se juega tiene que poder leerse sin animación, manejarse con teclado y caber de 390 a 2560 px. Ninguna de
 * estas comprobaciones depende del movimiento: la información vive en el texto y en los atributos.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MatchBoard } from "./MatchBoard";
import { MatchComplete } from "./MatchComplete";
import { ResultScreen } from "./ResultScreen";
import { fase45Fixtures } from "@/app/design-system/fase45/fixtures";

const ROOT = process.cwd();
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
const html = (n: React.ReactElement) => renderToStaticMarkup(n);
const noop = () => {};
const fx = fase45Fixtures();
const BOARD_SRC = read("src", "components", "duel", "MatchBoard.tsx");
const COMPLETE_SRC = read("src", "components", "duel", "MatchComplete.tsx");
const CSS = read("src", "app", "game-experience.css");
const board = html(<MatchBoard view={fx.mid} onPlay={noop} busy={false} error={null} onDismissError={noop} />);

test("A11Y 01 · la mesa dice de quién es cada fila de cartas", () => {
  assert.match(board, /aria-label="Tus cartas en la mesa"/);
  assert.match(board, /aria-label="Cartas del rival en la mesa"/);
});

test("A11Y 02 · la mano tiene nombre accesible", () => {
  assert.match(board, /aria-label="Tu mano"/);
});

test("A11Y 03 · cada carta se nombra con jugador, rol y OVR", () => {
  assert.match(board, /aria-label="[^"]+, (Duelista|Controlador|Iniciador|Centinela|Flex), OVR \d+/);
});

test("A11Y 04 · el turno y quién ataca se leen como texto, no solo por color", () => {
  assert.match(board, /Turno/);
  assert.match(board, /Atacas t|Ataca el rival/);
});

test("A11Y 05 · el marcador es texto con número, no una barra de color", () => {
  assert.match(board, /tabular-nums/);
});

test("A11Y 06 · los botones de estadística dicen su estado con aria-pressed", () => {
  assert.match(board, /aria-pressed=/);
});

test("A11Y 07 · el golpe final es un diálogo con nombre y marcador legible", () => {
  const h = html(<MatchComplete result={fx.win.result!} onDone={noop} />);
  assert.match(h, /role="dialog"[\s\S]*aria-modal="true"/);
  assert.match(h, /aria-label="(VICTORIA|DERROTA|EMPATE)\. \d+ a \d+"/);
});

test("A11Y 08 · el golpe final se cierra con teclado (no hace falta ratón)", () => {
  assert.ok(COMPLETE_SRC.includes('window.addEventListener("keydown", skip)'));
});

test("A11Y 09 · el resultado dice el veredicto en palabras", () => {
  const h = html(<ResultScreen view={fx.win} xp={100} onPlayAgain={noop} onDecks={noop} onReplay={noop} deckId="qa" />);
  assert.match(h, /VICTORIA|Victoria/);
});

test("A11Y 10 · el resultado no depende del color para decir qué pasó", () => {
  const h = html(<ResultScreen view={fx.loss} xp={100} onPlayAgain={noop} onDecks={noop} onReplay={noop} deckId="qa" />);
  assert.match(h, /data-kind="loss"/);
  assert.match(h, /DERROTA|Derrota/);
});

test("MOVIMIENTO 01 · el escenario de la arena no anima nada fuera de `no-preference`", () => {
  const reduce = CSS.split("@media (prefers-reduced-motion: reduce)").slice(1).join("\n");
  assert.match(reduce, /\.nx-arena-stage::before, \.nx-arena-stage::after \{ transition: none; \}/);
});

test("MOVIMIENTO 02 · el golpe del turno solo existe con movimiento permitido", () => {
  const noPref = CSS.split("@media (prefers-reduced-motion: no-preference)").slice(1).join("\n");
  assert.match(noPref, /nx-arena-hit/);
});

test("MOVIMIENTO 03 · el golpe final tiene versión corta y sin recorrido", () => {
  assert.ok(COMPLETE_SRC.includes("reduced ? { opacity: 0 } : { opacity: 0, scale: 1.18, y: 14 }"));
  assert.ok(COMPLETE_SRC.includes("MATCH_COMPLETE_MS.reduced"));
});

test("MOVIMIENTO 04 · la información del turno no depende de la animación del marcador", () => {
  assert.match(board, /data-hud="turno"|Turno/);
  assert.ok(BOARD_SRC.includes("AnimatePresence"), "la animación existe…");
  assert.match(board, /\d+/, "…pero el número está en el HTML igualmente");
});

test("RESPONSIVE 01 · la mesa se dimensiona con el juego, no con la página", () => {
  assert.ok(BOARD_SRC.includes("arenaVars(view.totalTurns)"));
  const arena = read("src", "components", "duel", "arena", "ArenaSurface.tsx");
  assert.match(arena, /--arena-w/);
});

test("RESPONSIVE 02 · el historial es un cajón, no una columna que le quite tablero a la mesa", () => {
  /*
   * FASE 45 · CAMBIO DE CONTRATO, A PROPÓSITO.
   *
   * Hasta aquí este test exigía la rejilla `xl:grid-cols-[minmax(0,1fr)_300px]`: una columna
   * fija de 300 px, siempre abierta, con la parrilla de turnos y el historial. Eso es lo que
   * le daba a la arena silueta de cuadro de mandos, y es lo que la Fase 45 se lleva.
   *
   * El contrato nuevo es más exigente, no más laxo: NO puede existir una columna reservada, y
   * el historial tiene que seguir siendo alcanzable —con disparador, con `role="dialog"` y
   * con salida por Escape—. Un cajón al que no se puede entrar o del que no se puede salir
   * sería peor que la columna que sustituye.
   */
  assert.ok(!BOARD_SRC.includes("xl:grid-cols-[minmax(0,1fr)_300px]"), "la columna fija del historial ya no existe");
  assert.ok(BOARD_SRC.includes('data-testid="match-history-toggle"'), "hay un disparador del historial");
  assert.ok(BOARD_SRC.includes('data-testid="match-history-drawer"'), "el historial vive en un cajón");
  assert.match(BOARD_SRC, /role="dialog"[\s\S]{0,200}aria-modal="true"/, "el cajón es un diálogo modal");
  assert.match(BOARD_SRC, /e\.key === "Escape"/, "el cajón se cierra con Escape");
  // La información no se pierde: las dos piezas de siempre siguen montándose dentro.
  assert.ok(BOARD_SRC.includes("<TurnTimeline"), "la parrilla de turnos sigue existiendo");
  assert.ok(BOARD_SRC.includes("<TurnHistory"), "el historial sigue existiendo");
});

test("RESPONSIVE 03 · ningún ancho fijo de cuatro cifras en la arena", () => {
  for (const f of ["MatchBoard.tsx", "MatchComplete.tsx", "ResultScreen.tsx"]) {
    const src = read("src", "components", "duel", f);
    assert.ok(!/(?<!max-)w-\[\d{4,}px\]/.test(src), f);
  }
});

test("RESPONSIVE 04 · el golpe final se adapta con `clamp`, sin romper en móvil", () => {
  assert.match(COMPLETE_SRC, /clamp\(44px,9vw,120px\)|clamp\(44px, 9vw, 120px\)/);
});

test("RESPONSIVE 05 · la fila de posiciones crece con la partida en móvil", () => {
  const played = read("src", "components", "duel", "arena", "PlayedRow.tsx");
  assert.ok(played.includes("const enMóvil = Math.min(slots, Math.max(cards.length + 1, 4));"));
});

test("RENDIMIENTO · la arena no usa 3D, vídeo ni lienzos gigantes", () => {
  for (const f of ["MatchBoard.tsx", "MatchComplete.tsx"]) {
    const src = read("src", "components", "duel", f);
    assert.ok(!/three|webgl|<video|<canvas/i.test(src), f);
  }
});
