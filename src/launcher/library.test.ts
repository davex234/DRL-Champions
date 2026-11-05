/**
 * Tests de la biblioteca y la configuración del launcher (node:test). `npm test`.
 *
 * Lo que se protege aquí es la regla central del cliente: el BOTÓN es una función del estado.
 * Si alguien vuelve a decidir la etiqueta dentro de un componente, estos tests dejan de
 * cubrirlo — por eso viven pegados a `library.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyCompletedJob, applyRemoved, downloadKindFor, effectiveState, hasUpdate, initialEntry,
  primaryAction, sortLibrary, stateLabel, stateTone,
} from "./library";
import { createJob } from "./download";
import { getGame, GAMES } from "./catalog";
import { DEFAULT_SETTINGS, heavyEffectsEnabled, motionScale, sanitizeSettings } from "./settings";
import { countConnected, FRIENDS, sortFriends } from "./social";
import { formatDate, getNews, newsForGame } from "./feed";
import type { DownloadJob, Game, GameStateId, LibraryEntry } from "./types";

const ALPHA = getGame("project-alpha") as Game;
const NEXUS = getGame("project-nexus") as Game;
const CHAMPS = getGame("drl-champions") as Game;

const entry = (patch: Partial<LibraryEntry> = {}): LibraryEntry => ({ ...initialEntry(ALPHA), ...patch });

// ───────────────────────────── Estado → botón ─────────────────────────────

test("sin instalar ofrece INSTALAR", () => {
  const a = primaryAction(ALPHA, entry());
  assert.equal(a.id, "install");
  assert.equal(a.label, "Instalar");
  assert.equal(a.disabled, false);
});

test("instalado y al día ofrece JUGAR", () => {
  const a = primaryAction(ALPHA, entry({ state: "ready", installedVersion: ALPHA.version }));
  assert.equal(a.id, "play");
});

test("instalado con versión antigua ofrece ACTUALIZAR", () => {
  const e = entry({ state: "installed", installedVersion: "1.0.0" });
  assert.ok(hasUpdate(ALPHA, e));
  assert.equal(primaryAction(ALPHA, e).id, "update");
  assert.equal(downloadKindFor(ALPHA, e), "update");
});

test("descargando ofrece PAUSAR y las fases finales no son interrumpibles", () => {
  const job = createJob(ALPHA, "install", "C:\\Games", 0);
  assert.equal(primaryAction(ALPHA, entry(), job).id, "pause");

  const verifying: DownloadJob = { ...job, status: "verifying" };
  const finalizing = primaryAction(ALPHA, entry(), verifying);
  assert.equal(finalizing.id, "finalizing");
  assert.equal(finalizing.disabled, true);
});

test("en pausa ofrece REANUDAR y en error, REINTENTAR", () => {
  const job = createJob(ALPHA, "install", "C:\\Games", 0);
  assert.equal(primaryAction(ALPHA, entry(), { ...job, status: "paused" }).id, "resume");
  assert.equal(primaryAction(ALPHA, entry(), { ...job, status: "error", error: "x" }).id, "retry");
});

test("el trabajo en curso manda sobre lo guardado en la biblioteca", () => {
  const job = createJob(NEXUS, "update", "C:\\Games", 0);
  const e = entry({ state: "installed", installedVersion: "1.0.0" });
  assert.equal(effectiveState(e, job), "updating");
  assert.equal(effectiveState(e, { ...job, status: "paused" }), "paused");
  assert.equal(effectiveState(e, null), "installed");
});

// ───────────────────────────── Transiciones ─────────────────────────────

test("completar una descarga deja el juego listo y con la versión publicada", () => {
  const job = createJob(ALPHA, "install", "D:\\NEXUS", 0);
  const done = applyCompletedJob(ALPHA, entry(), { ...job, status: "done" });
  assert.equal(done.state, "ready");
  assert.equal(done.installedVersion, ALPHA.version);
  assert.equal(done.installPath, "D:\\NEXUS");
  assert.equal(done.bytesOnDisk, ALPHA.sizeBytes);
  assert.equal(primaryAction(ALPHA, done).id, "play");
});

test("quitar un juego lo devuelve a no instalado sin rastro de versión", () => {
  const removed = applyRemoved(entry({ state: "ready", installedVersion: "3.14.0", bytesOnDisk: 999 }));
  assert.equal(removed.state, "not-installed");
  assert.equal(removed.installedVersion, null);
  assert.equal(removed.bytesOnDisk, 0);
});

test("el título del cliente viene instalado de serie", () => {
  const e = initialEntry(CHAMPS);
  assert.equal(e.state, "ready");
  assert.equal(e.installedVersion, CHAMPS.version);
  assert.equal(primaryAction(CHAMPS, e).id, "play");
});

// ───────────────────────────── Etiquetas y orden ─────────────────────────────

test("cada estado tiene etiqueta y tono", () => {
  const states: GameStateId[] = ["not-installed", "installing", "installed", "updating", "paused", "error", "ready"];
  for (const s of states) {
    assert.ok(stateLabel(s).length > 0, `sin etiqueta: ${s}`);
    assert.ok(["ok", "warn", "bad", "info", "muted"].includes(stateTone(s)));
  }
  assert.equal(
    stateLabel("installed", ALPHA, entry({ state: "installed", installedVersion: "1.0.0" })),
    "Actualización disponible",
  );
});

test("la barra lateral ordena lo jugable primero y lo no instalado al final", () => {
  const states: Record<string, GameStateId> = {
    "drl-champions": "ready",
    "project-alpha": "not-installed",
    "project-nexus": "installing",
    "project-zero": "paused",
    "project-omega": "not-installed",
  };
  const sorted = sortLibrary(GAMES, (id) => states[id] ?? "not-installed");
  assert.equal(sorted[0].id, "drl-champions");
  assert.equal(sorted[1].id, "project-nexus");
  assert.equal(sorted[2].id, "project-zero");
  assert.equal(sorted[sorted.length - 1].id, "project-omega");
});

// ───────────────────────────── Configuración ─────────────────────────────

test("la configuración se sanea: nada puede dejar el launcher en un estado imposible", () => {
  const s = sanitizeSettings({
    speedLimitMbps: -50,
    concurrentDownloads: 99,
    effectIntensity: 400,
    theme: "no-existe" as never,
    animations: "turbo" as never,
    installPath: "   ",
  });
  assert.equal(s.speedLimitMbps, 0);
  assert.equal(s.concurrentDownloads, 3);
  assert.equal(s.effectIntensity, 100);
  assert.equal(s.theme, DEFAULT_SETTINGS.theme);
  assert.equal(s.animations, "full");
  assert.equal(s.installPath, DEFAULT_SETTINGS.installPath);
  assert.deepEqual(sanitizeSettings(null), DEFAULT_SETTINGS);
});

test("el movimiento se apaga por preferencia del usuario o del sistema", () => {
  assert.equal(motionScale(DEFAULT_SETTINGS, true), 0, "prefers-reduced-motion manda");
  assert.equal(motionScale({ ...DEFAULT_SETTINGS, animations: "off" }), 0);
  assert.ok(motionScale({ ...DEFAULT_SETTINGS, animations: "reduced" }) < motionScale(DEFAULT_SETTINGS));
  assert.equal(motionScale({ ...DEFAULT_SETTINGS, effectIntensity: 0 }), 0);
  assert.equal(heavyEffectsEnabled({ ...DEFAULT_SETTINGS, hardwareAcceleration: false }), false);
  assert.equal(heavyEffectsEnabled(DEFAULT_SETTINGS), true);
});

// ───────────────────────────── Social y novedades ─────────────────────────────

test("los amigos se ordenan por presencia: en partida arriba, desconectados abajo", () => {
  const sorted = sortFriends(FRIENDS);
  assert.equal(sorted[0].presence, "in-game");
  assert.equal(sorted[sorted.length - 1].presence, "offline");
  assert.equal(countConnected(FRIENDS), FRIENDS.filter((f) => f.presence !== "offline").length);
});

test("las novedades llegan ordenadas y se pueden filtrar por juego", () => {
  const news = getNews();
  for (let i = 1; i < news.length; i++) {
    assert.ok(news[i - 1].date >= news[i].date, "orden descendente por fecha");
  }
  const alpha = newsForGame("project-alpha");
  assert.ok(alpha.length > 0);
  assert.ok(alpha.every((n) => n.gameId === "project-alpha"));
  assert.ok(news.every((n) => n.body.length > 0), "toda noticia se puede abrir");
});

test("las fechas se escriben en español sin depender del entorno", () => {
  assert.equal(formatDate("2026-09-01"), "1 de septiembre de 2026");
  assert.equal(formatDate("2026-12-24"), "24 de diciembre de 2026");
});
