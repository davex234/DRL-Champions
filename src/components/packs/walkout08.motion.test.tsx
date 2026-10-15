/**
 * WALKOUT 0.8 · el NPC 3D en producción — preferencia «Animaciones de apertura», motivos del respaldo 2D y contratos.
 *
 * Causa raíz medida en el PC del propietario (2026-10-08): Windows con «Efectos de animación» desactivado → Chrome
 * responde `prefers-reduced-motion: reduce` → el walkout salía SIEMPRE en 2D, sin forma de pedir el 3D desde el juego.
 *
 *   M01–M04 preferencia (por defecto Automático; Cinemática ignora el sistema; Reducidas siempre 2D; persistencia)
 *   M05–M07 escenario: Cinemática nunca salta una incompatibilidad técnica · un código por causa · sin three.js en 2D
 *   M08–M10 reproductor y ajustes (botón 3D/2D, telemetría sin datos personales, panel en menú y cuenta)
 *   M11     solo presentación: nada de red, store ni economía
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DEFAULT_OPENING_ANIMATION, OPENING_ANIMATION_KEY, describeOpeningMode, getOpeningAnimation, onOpeningAnimationChange,
  parseOpeningAnimation, setOpeningAnimation, walkoutReduced,
} from "@/lib/walkout/animationPref";
import { chooseStage, stageReason, HUMAN_READY_TIMEOUT_MS } from "@/lib/walkout/stageChoice";
import { OpeningAnimationSettings } from "@/components/ui/game/OpeningAnimationSettings";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

test("M01 · por defecto AUTOMÁTICO; valores desconocidos → Automático", () => {
  assert.equal(DEFAULT_OPENING_ANIMATION, "auto");
  for (const raw of [null, undefined, "", "3d", "CINEMATIC", 1]) assert.equal(parseOpeningAnimation(raw), "auto");
  for (const v of ["cinematic", "auto", "reduced"] as const) assert.equal(parseOpeningAnimation(v), v);
});

test("M02 · Automático respeta el sistema; Cinemática 3D lo ignora; Reducidas siempre reducido", () => {
  assert.equal(walkoutReduced("auto", true), true, "Windows sin efectos de animación → 2D en Automático");
  assert.equal(walkoutReduced("auto", false), false);
  assert.equal(walkoutReduced("cinematic", true), false, "la elección explícita prevalece sobre prefers-reduced-motion");
  assert.equal(walkoutReduced("cinematic", false), false);
  assert.equal(walkoutReduced("reduced", false), true);
  assert.equal(walkoutReduced("reduced", true), true);
});

test("M03 · el modo activo se dice en claro", () => {
  // 2026-10-15 · la preferencia rige toda la apertura (ya sin walkout): los modos ya no hablan de 3D
  assert.equal(describeOpeningMode("auto", true), "Automático · reducidas (tu sistema pide menos movimiento)");
  assert.equal(describeOpeningMode("auto", false), "Automático · completas");
  assert.equal(describeOpeningMode("cinematic", true), "Cinemática");
  assert.equal(describeOpeningMode("reduced", false), "Reducidas");
});

test("M04 · se guarda en este dispositivo y avisa a quien escucha", () => {
  const store = new Map<string, string>();
  const g = globalThis as unknown as { window?: unknown };
  const prev = g.window;
  g.window = { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) }, addEventListener() {}, removeEventListener() {} };
  try {
    let calls = 0;
    const off = onOpeningAnimationChange(() => { calls++; });
    assert.equal(getOpeningAnimation(), "auto");
    setOpeningAnimation("cinematic");
    assert.equal(store.get(OPENING_ANIMATION_KEY), "cinematic");
    assert.equal(getOpeningAnimation(), "cinematic");
    off(); setOpeningAnimation("reduced");
    assert.equal(calls, 1);
    assert.equal(getOpeningAnimation(), "reduced");
  } finally { g.window = prev; }
});

test("M05 · Cinemática 3D nunca salta una incompatibilidad técnica (sin WebGL, contexto perdido, fallo de carga)", () => {
  const cine = { webgl: true, lowEnd: false, reduced: walkoutReduced("cinematic", true) };
  assert.equal(chooseStage(cine), "3d", "con WebGL y la preferencia, 3D aunque el sistema pida menos movimiento");
  assert.equal(chooseStage({ ...cine, webgl: false }), "2d");
  assert.equal(chooseStage({ ...cine, contextLost: true }), "2d");
  assert.equal(chooseStage({ ...cine, loadFailed: true }), "2d");
  assert.equal(chooseStage({ webgl: true, lowEnd: false, reduced: walkoutReduced("reduced", false) }), "2d");
});

test("M06 · un código fijo por causa del 2D", () => {
  const e = { webgl: true, reduced: false, lowEnd: false };
  assert.equal(stageReason("3d", e), "WEBGL");
  assert.equal(stageReason("2d", { ...e, reduced: true }), "REDUCED_MOTION");
  assert.equal(stageReason("2d", { ...e, webgl: false }), "WEBGL_UNAVAILABLE");
  assert.equal(stageReason("2d", { ...e, broken: "context" }), "WEBGL_CONTEXT_LOST");
  assert.equal(stageReason("2d", { ...e, broken: "model" }), "MODEL_LOAD_FAILED");
  assert.equal(stageReason("2d", { ...e, broken: "asset" }), "ASSET_LOAD_FAILED");
  assert.equal(stageReason("2d", { ...e, broken: "runtime" }), "RUNTIME_ERROR");
  assert.equal(stageReason("2d", { ...e, broken: "timeout" }), "TIMEOUT");
  assert.equal(stageReason("2d", { ...e, lowEnd: true }), "LOW_END_DEVICE");
  assert.ok(HUMAN_READY_TIMEOUT_MS >= 10_000 && HUMAN_READY_TIMEOUT_MS <= 20_000);
});

test("M07 · escenario: en reducido no se descarga three.js para sondear; los fallos de pintado caen a 2D sin romper", () => {
  const s = read("src/components/walkout/WalkoutStage.tsx");
  assert.match(s, /const probe = !\(reduced && forced !== "3d"\);/);
  assert.match(s, /if \(!probe\) \{ setEnv\(\{ webgl: true, lowEnd \}\); return; \}/);
  assert.ok(s.indexOf("if (!probe)") < s.indexOf('import("./stage3d").then((m) => { webgl = m.webglAvailable(); })'), "la salida va ANTES del import");
  assert.match(s, /setBroken\("model"\)/);
  assert.match(s, /setBroken\("timeout"\)/);
  assert.match(s, /setBroken\("runtime"\)/);
  assert.match(s, /setBroken\("asset"\)/);
  assert.equal((s.match(/try \{ stageRef\.current\.render\(frame, walk\); \}/g) ?? []).length, 1, "el render por fotograma está protegido");
});

test("M08 · reproductor: la preferencia manda sobre el sistema y el botón 3D/2D vuelve a presentar ESTA carta", () => {
  const s = read("src/components/packs/PackWalkout.tsx");
  assert.match(s, /const effReduced = walkoutReduced\(pref, reduced\);/);
  assert.match(s, /<WalkoutDirector key=\{take\} ref=\{ref\} input=\{item\.identity\} intensity=\{item\.intensity\} reduced=\{effReduced\}/);
  assert.match(s, /setOpeningAnimation\(stage\.kind === "3d" \? "reduced" : "cinematic"\)/);
  assert.match(s, /data-testid="pack-walkout-mode"/);
  assert.match(s, /\{stage\.kind && !technical2d && \(/, "si el 2D es técnico no se ofrece un 3D que no puede salir");
});

test("M09 · telemetría: un código fijo por carta (escenario, motivo, preferencia), sin datos personales", () => {
  const s = read("src/components/packs/PackWalkout.tsx");
  assert.match(s, /trackFlow\("pack_ceremony", `walkout_stage:\$\{stage\.kind\}:\$\{why\}:\$\{pref\}`\)/);
  assert.match(s, /if \(reported\.current === key\) return;/, "no se repite en cada fotograma");
});

test("M10 · ajustes: tres modos con aria-pressed, Automático por defecto y modo activo visible; en el menú y en /cuenta", () => {
  const h = renderToStaticMarkup(<OpeningAnimationSettings />);
  for (const id of ["cinematic", "auto", "reduced"]) assert.match(h, new RegExp(`data-testid="opening-animation-${id}"`));
  assert.match(h, /aria-pressed="true"[^>]*data-testid="opening-animation-auto"/);
  assert.match(h, /Cinemática/); assert.match(h, /Automático/); assert.match(h, /Reducidas/);
  assert.match(h, /Activo: Automático · completas/);
  assert.match(read("src/components/layout/GameShell.tsx"), /<OpeningAnimationSettings className=/);
  assert.match(read("src/app/cuenta/page.tsx"), /<OpeningAnimationSettings className=/);
});

test("M11 · solo presentación: la preferencia y el reproductor no tocan red, store ni economía", () => {
  for (const f of ["src/lib/walkout/animationPref.ts", "src/components/ui/game/OpeningAnimationSettings.tsx", "src/components/packs/PackWalkout.tsx", "src/lib/walkout/stageChoice.ts"]) {
    const s = read(f);
    for (const banned of [/useGameStore/, /lib\/game\/sync/, /openPackOutcome/, /\bfetch\(/, /\/api\//]) assert.ok(!banned.test(s), `${f}: ${banned}`);
  }
});
