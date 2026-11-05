/**
 * Tests del gestor de descargas del launcher (node:test). Ejecutar: `npm test`.
 *
 * Se prueba la MÁQUINA DE ESTADOS, no la interfaz: descargar → verificar → instalar → hecho,
 * pausa/reanudación, límite de velocidad, determinismo y comprobación de espacio en disco.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  advanceJob, canCancel, canPause, canResume, checkSpace, createJob, effectiveBandwidth,
  failJob, INSTALL_MS, isJobActive, jobBytesFor, noise, overallPercent, pauseJob, resumeJob,
  seedOf, VERIFY_MS,
} from "./download";
import { GAMES, DISKS, getGame } from "./catalog";
import type { DownloadJob, Game } from "./types";

const GAME = getGame("project-alpha") as Game;
const SMALL: Game = { ...GAME, id: "test-small", sizeBytes: 6_000_000 }; // ~0,5 s de descarga

/** Avanza un trabajo hasta que deja de estar vivo o se agotan los pasos. */
function run(job: DownloadJob, steps = 4000, dt = 250, limitMbps = 0): DownloadJob {
  let cur = job;
  let now = job.startedAt;
  for (let i = 0; i < steps && isJobActive(cur.status); i++) {
    now += dt;
    cur = advanceJob(cur, dt, { limitMbps, now });
  }
  return cur;
}

// ───────────────────────────── Ciclo completo ─────────────────────────────

test("una descarga recorre descargando → verificando → instalando → hecho", () => {
  const job = createJob(SMALL, "install", "C:\\Games", 0);
  assert.equal(job.status, "downloading");
  const done = run(job);
  assert.equal(done.status, "done");
  assert.equal(done.downloadedBytes, SMALL.sizeBytes);
  assert.equal(done.percent, 100);
  assert.equal(overallPercent(done), 100);
});

test("las fases posteriores a la descarga duran lo que dicen durar", () => {
  const job = createJob(SMALL, "install", "C:\\Games", 0);
  // Descarga entera de golpe: un dt grande se recorta a 2 s, así que se itera.
  let cur = job;
  let now = 0;
  while (cur.status === "downloading") {
    now += 2000;
    cur = advanceJob(cur, 2000, { limitMbps: 0, now });
  }
  assert.equal(cur.status, "verifying");

  // `advanceJob` recorta cada paso a 2 s, así que el tiempo se acumula en pasos pequeños.
  const step = (ms: number) => {
    now += ms;
    cur = advanceJob(cur, ms, { limitMbps: 0, now });
  };

  // Verificación: no termina antes de VERIFY_MS.
  let waited = 0;
  while (waited < VERIFY_MS - 200) {
    step(200);
    waited += 200;
  }
  assert.equal(cur.status, "verifying");
  step(400);
  assert.equal(cur.status, "installing");

  waited = 0;
  while (waited < INSTALL_MS - 200) {
    step(200);
    waited += 200;
  }
  assert.equal(cur.status, "installing");
  step(400);
  assert.equal(cur.status, "done");
});

test("el progreso global reserva el tramo final a verificar e instalar", () => {
  const job = createJob(SMALL, "install", "C:\\Games", 0);
  const half: DownloadJob = { ...job, downloadedBytes: SMALL.sizeBytes / 2 };
  assert.equal(Math.round(overallPercent(half)), 45); // 50 % de descarga = 45 % del total
  assert.equal(Math.round(overallPercent({ ...job, status: "verifying", phaseMs: 0 })), 90);
  assert.equal(Math.round(overallPercent({ ...job, status: "installing", phaseMs: 0 })), 95);
});

// ───────────────────────────── Pausa y reanudación ─────────────────────────────

test("pausar detiene el avance y reanudar lo continúa desde los mismos bytes", () => {
  let job = createJob(SMALL, "install", "C:\\Games", 0);
  job = advanceJob(job, 250, { limitMbps: 0, now: 250 });
  const bytes = job.downloadedBytes;
  assert.ok(bytes > 0);

  job = pauseJob(job, 300);
  assert.equal(job.status, "paused");
  assert.equal(job.speedBps, 0);

  const stillPaused = advanceJob(job, 1000, { limitMbps: 0, now: 1300 });
  assert.equal(stillPaused.downloadedBytes, bytes, "en pausa no se descarga nada");

  job = resumeJob(job, 1400);
  assert.equal(job.status, "downloading");
  job = advanceJob(job, 250, { limitMbps: 0, now: 1650 });
  assert.ok(job.downloadedBytes > bytes);
});

test("los permisos de la interfaz siguen el estado del trabajo", () => {
  assert.ok(canPause("downloading"));
  assert.ok(!canPause("verifying"));
  assert.ok(canResume("paused"));
  assert.ok(canResume("error"));
  assert.ok(!canResume("downloading"));
  assert.ok(canCancel("paused"));
  assert.ok(!canCancel("installing"), "cancelar mientras se escribe en disco no es seguro");
});

test("un fallo conserva los bytes y deja mensaje", () => {
  const job = advanceJob(createJob(SMALL, "install", "C:\\Games", 0), 250, { limitMbps: 0, now: 250 });
  const failed = failJob(job, "Conexión interrumpida", 300);
  assert.equal(failed.status, "error");
  assert.equal(failed.error, "Conexión interrumpida");
  assert.equal(failed.downloadedBytes, job.downloadedBytes);
  assert.ok(canResume(failed.status), "de un error se puede reintentar");
});

// ───────────────────────────── Red ─────────────────────────────

test("el límite de velocidad recorta el ancho de banda efectivo", () => {
  const seed = seedOf("project-alpha");
  const free = effectiveBandwidth(seed, 7, 0);
  const capped = effectiveBandwidth(seed, 7, 1); // 1 MB/s
  assert.ok(capped < free);
  assert.equal(capped, 1024 * 1024);
});

test("la simulación es determinista: misma semilla y tick, mismo valor", () => {
  const a = effectiveBandwidth(seedOf("project-zero"), 12, 0);
  const b = effectiveBandwidth(seedOf("project-zero"), 12, 0);
  assert.equal(a, b);
  assert.notEqual(a, effectiveBandwidth(seedOf("project-zero"), 13, 0));
  assert.notEqual(seedOf("project-zero"), seedOf("project-omega"));
  for (let i = 0; i < 50; i++) {
    const n = noise(1234, i);
    assert.ok(n >= 0 && n < 1, "el ruido vive en [0,1)");
  }
});

test("un dt enorme (pestaña en segundo plano) no teletransporta la descarga", () => {
  const job = createJob(GAME, "install", "C:\\Games", 0); // 22,5 GB
  const jumped = advanceJob(job, 10 * 60 * 1000, { limitMbps: 0, now: 600_000 });
  assert.ok(jumped.downloadedBytes < 40_000_000, "como mucho avanza 2 s de descarga");
});

// ───────────────────────────── Tamaños y disco ─────────────────────────────

test("una actualización mueve el parche, no el juego entero", () => {
  const nexus = getGame("project-nexus") as Game;
  assert.ok(nexus.patchBytes);
  assert.equal(jobBytesFor(nexus, "update"), nexus.patchBytes);
  assert.equal(jobBytesFor(nexus, "install"), nexus.sizeBytes);
  assert.ok(jobBytesFor(nexus, "repair") < nexus.sizeBytes);
});

test("reanudar una instalación parte de los bytes ya presentes en disco", () => {
  const job = createJob(SMALL, "install", "C:\\Games", 0, 3_000_000);
  assert.equal(job.downloadedBytes, 3_000_000);
  assert.equal(Math.round(job.percent), 50);
});

test("el espacio en disco se comprueba con holgura sobre el tamaño anunciado", () => {
  const big = GAMES.find((g) => g.id === "project-zero") as Game; // 38,1 GB
  const roomy = checkSpace(DISKS[1], big.sizeBytes); // 1,2 TB libres
  assert.ok(roomy.ok);
  assert.ok(roomy.requiredBytes > big.sizeBytes, "se exige margen para temporales");

  const tight = checkSpace(DISKS[2], big.sizeBytes); // 18,2 GB libres
  assert.ok(!tight.ok);
  assert.ok(tight.missingBytes > 0);
});
