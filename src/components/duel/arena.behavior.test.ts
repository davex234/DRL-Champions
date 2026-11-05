import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * INVARIANTES DE LA ARENA (Fase 22.2). El motor y su tablero (`MatchBoard`, `arena/*`) ya existen
 * y están probados por el juego (`domain/cardgame/*`, `lib/duel/*`). Esta fase es presentación:
 * aquí se aseveran, sobre el CÓDIGO, las propiedades que la capa visual NO debe romper —autoridad
 * del servidor, privacidad del rival, degradación de pantalla completa y reduced-motion—, y que
 * la pantalla completa está cableada. Como en fases anteriores, es una red, no la lógica de juego.
 */
const read = (...p: string[]) => readFileSync(join(process.cwd(), "src", ...p), "utf8");

const BOARD = read("components", "duel", "MatchBoard.tsx");
const HANDFAN = read("components", "duel", "arena", "HandFan.tsx");
const JUGAR = read("app", "duelos", "jugar", "page.tsx");
const FS_HOOK = read("lib", "useFullscreen.ts");
const FS_BTN = read("components", "duel", "FullscreenToggle.tsx");
const PVP_ARENA = read("components", "duel", "pvp", "PvpArena.tsx");

test("SERVER-AUTHORITY · el tablero pinta el estado recibido, no calcula combate", () => {
  // El tablero no genera azar ni resuelve nada: recibe `view` y llama `onPlay` al servidor.
  assert.ok(!/Math\.random\(/.test(BOARD), "MatchBoard no usa RNG");
  assert.ok(!/Math\.random\(/.test(HANDFAN), "HandFan no usa RNG");
  assert.ok(!/Math\.random\(/.test(PVP_ARENA), "PvpArena no usa RNG");
  // La jugada se envía al servidor; la pantalla no decide el resultado.
  assert.match(JUGAR, /\/api\/game\/duel/, "las acciones van al servidor");
});

test("PRIVACIDAD · la mano del rival son REVERSOS por recuento, nunca sus cartas", () => {
  // RivalHand recibe un `count`, no cartas; pinta reversos (`DuelCardBack`).
  assert.match(HANDFAN, /RivalHand\(\{ count/, "RivalHand toma solo el recuento");
  assert.match(HANDFAN, /DuelCardBack/, "pinta reversos");
  // No hay ninguna prop de cartas del rival en RivalHand.
  const rival = HANDFAN.slice(HANDFAN.indexOf("export function RivalHand"));
  assert.ok(!/rivalHand|rivalCards|opponentCards|\.cards/.test(rival.slice(0, 400)), "no recibe las cartas del rival");
});

test("PANTALLA COMPLETA · usa la Fullscreen API y DEGRADA si no está disponible", () => {
  assert.match(FS_HOOK, /requestFullscreen|webkitRequestFullscreen/, "usa la Fullscreen API");
  assert.match(FS_HOOK, /supported/, "expone si está soportada");
  assert.match(FS_HOOK, /\.catch\(\(\) =>/, "una promesa rechazada no rompe nada");
  // El botón se OCULTA si no hay soporte (no obliga a nadie).
  assert.match(FS_BTN, /if \(!supported\) return null/, "sin soporte, no se pinta");
  // Está cableado en la arena PvE y PvP.
  assert.match(JUGAR, /<FullscreenToggle/, "PvE monta el botón");
  assert.match(PVP_ARENA, /<FullscreenToggle/, "PvP monta el botón");
});

test("REDUCED-MOTION · la arena respeta la preferencia del sistema", () => {
  // El envoltorio de la arena PvE usa MotionConfig reducedMotion=\"user\": todas las animaciones
  // de framer-motion de dentro (incluida MatchBoard) honran la preferencia sin tocar el tablero.
  assert.match(JUGAR, /MotionConfig reducedMotion="user"/, "MotionConfig respeta la preferencia");
});

test("SSR-SAFE · el hook de pantalla completa no toca `document` en el servidor", () => {
  assert.match(FS_HOOK, /typeof document === "undefined"/, "comprueba entorno sin document");
});
