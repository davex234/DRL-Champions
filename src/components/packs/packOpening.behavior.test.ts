import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * INVARIANTES DE LA CEREMONIA DE APERTURA (Fase 21.2 → Fase 38). El componente usa hooks de cliente (router, auth,
 * framer-motion, zustand) que no se montan en `node:test` sin DOM; por eso las propiedades CRÍTICAS se aseveran sobre
 * el CÓDIGO. La lógica de presentación (qué fase, qué se revela, nueva/duplicada) tiene sus pruebas de comportamiento
 * reales en `domain/packs/reveal.test.ts`.
 */
const read = (...p: string[]) => readFileSync(join(process.cwd(), "src", "components", "packs", ...p), "utf8");
const SRC = read("PackOpeningExperience.tsx");
const SUMMARY = read("PackSummary.tsx");

test("SERVER-AUTHORITY · el resultado viene del servidor/motor, no de un sorteo en el componente", () => {
  // Con sesión, la tirada la decide el servidor; sin ella, el motor local. Ninguna otra vía.
  assert.match(SRC, /openPackOutcome\(packId\)/, "usa la apertura del servidor");
  assert.match(SRC, /openFromInventory\(packId\)/, "o el motor local");
  assert.ok(!/from ["']@\/domain\/packs\/openPack["']/.test(SRC), "no importa el decisor de sorteo");
  assert.ok(!/makeRng|Math\.random|new PackEngine\(/.test(SRC + SUMMARY), "no genera RNG ni motor propio");
});

test("DOBLE APERTURA · pestillo de gesto + máquina de estados: una sola apertura", () => {
  assert.match(SRC, /const opened = useRef\(false\)/, "existe el pestillo de apertura");
  assert.match(SRC, /if \(opened\.current\) return;\s*\n\s*opened\.current = true;\s*\n\s*dispatch\(\{ type: "OPEN_REQUESTED" \}\)/, "triggerOpen sale si ya se abrió y pide UNA vez");
});

test("NADA SE REVELA ANTES DEL SERVIDOR · el éxito se despacha después de recibir el resultado", () => {
  const body = SRC.slice(SRC.indexOf("const triggerOpen = useCallback"), SRC.indexOf("/* ROTURA → MANO."));
  assert.ok(body.indexOf("await openPackOutcome(packId)") < body.indexOf('type: "OPEN_SUCCEEDED"'));
  assert.match(body, /type: "OPEN_FAILED"/, "si falla, no hay ceremonia");
});

test("SALTAR · va al resumen con el resultado existente, sin reabrir ni volver a sortear", () => {
  const body = SRC.slice(SRC.indexOf("const skipToSummary"), SRC.indexOf("const openAnother"));
  assert.match(body, /dispatch\(\{ type: "SKIP" \}\)/, "lleva al resumen");
  assert.ok(!/triggerOpen|openPackOutcome|openFromInventory/.test(body), "saltar no reabre");
});

test("RECUPERACIÓN · tras recarga se restaura desde sessionStorage sin reabrir", () => {
  // Fase 40 · la lectura lleva `allowSeen` (un resumen ya visto solo vuelve al RECARGAR esa pantalla).
  assert.match(SRC, /loadOpenReveal\(packId(, \{ allowSeen: [^}]+\})?\)/, "lee el resultado guardado al montar");
  assert.match(SRC, /saveOpenReveal\(packId, res\)/, "guarda el resultado al abrir");
  const at = SRC.indexOf("loadOpenReveal(packId");
  const rec = SRC.slice(at - 200, at + 300);
  assert.match(rec, /opened\.current = true/, "restaurar bloquea una reapertura");
});

test("RECUPERACIÓN · petición enviada sin respuesta: se pide su resultado con la MISMA clave", () => {
  assert.match(SRC, /if \(!hasPendingOpen\(packId\)\) return;/);
  const rec = SRC.slice(SRC.indexOf("if (!hasPendingOpen(packId)) return;"), SRC.indexOf("if (!hasPendingOpen(packId)) return;") + 600);
  assert.match(rec, /type: "RECOVER_STARTED"/);
  assert.match(rec, /openPackOutcome\(packId\)/, "la capa de sync reutiliza el gesto pendiente");
});

test("TECLADO · abrir/revelar/avanzar/saltar/revelar todas por teclado, respetando la fase", () => {
  assert.match(SRC, /addEventListener\("keydown"/, "escucha el teclado");
  assert.match(SRC, /removeEventListener\("keydown"/, "y lo limpia");
  assert.match(SRC, /ArrowRight/, "avanza con →");
  assert.match(SRC, /"Escape"/, "salta con Escape");
  // F81 · Enter/Espacio avanzan un paso (nunca se saltan la hero); con la hero quieta, CONTINUAR.
  assert.match(SRC, /if \(phase === "hero_hold"\) continueFromHero\(\); else advance\(\);/, "avanzar / continuar por teclado");
});

test("DRAFT · un sobre no público no se abre por la ruta pública", () => {
  assert.match(SRC, /isPubliclyOpenable\(pack\)/, "comprueba el ciclo de vida");
  assert.match(SRC, /Sobre no disponible/, "y lo dice con claridad");
});

test("ACCIONES FINALES · ver colección, abrir otro y volver a sobres", () => {
  // Pack Opening 3.0 · «Ir a mi colección» lleva a /coleccion (antes «Ver en mi colección» abría la ficha de la hero,
  // que ya tiene su propio «Ver carta →»).
  assert.match(SUMMARY, /onNavigate\("\/coleccion"\)\} data-testid="summary-view-collection">\s*Ir a mi colección/);
  assert.match(SUMMARY, /Abrir otro sobre/);
  assert.match(SUMMARY, /Volver a sobres/);
  assert.match(SUMMARY, /onNavigate\("\/packs"\)/, "volver lleva al catálogo");
  assert.match(SRC, /onOpenAnother=\{openAnother\}/);
});

test("REVEAL · muestra el resultado real carta a carta con su plan (rareza, nueva/duplicada, serial)", () => {
  // F81 · la hero es una instancia del resultado real (por uid) y su plan; el resto, el orden de presentación del plan.
  assert.match(SRC, /const heroResult = best \? results\.find\(\(r\) => r\.uid === best\.uid\) : undefined;/, "la hero sale del resultado real");
  assert.match(SRC, /item=\{best\}/, "con el plan de esa carta");
  // Walkout 0.5 · el resto: el resultado sin la hero y sin las especiales que ya salieron en su walkout (nada más)
  assert.match(SRC, /plan\.order\.filter\(\(i\) => i\.uid !== best\?\.uid && !walkedUids\.has\(i\.uid\)\)/, "el resto: el resultado sin la hero");
  assert.match(SRC, /const walkedUids = new Set\(walkoutItems\.map\(\(w\) => w\.uid\)\);/, "solo las ya presentadas en un walkout");
  assert.match(SUMMARY, /serial=\{it\.serial \?\? undefined\}/, "el resumen muestra el serial devuelto");
  // La marca va en TEXTO bajo cada carta (la cinta sobre la carta tapaba el OVR). Pack Opening 3.0: una insignia pequeña
  // con la MISMA semántica — nueva variante ≠ nueva ≠ duplicada ×N (según la colección de antes).
  assert.match(SUMMARY, /item\.status === "new" && item\.newVariant\) return <span[^>]*data-caption-status="new-variant">Nueva variante<\/span>/, "marca nueva variante");
  assert.match(SUMMARY, /item\.status === "new"\) return <span[^>]*data-caption-status="new">Nueva<\/span>/, "marca nueva según la colección de antes");
  assert.match(SUMMARY, /item\.status === "duplicate"\) return <span[^>]*data-caption-status="duplicate">Duplicada ×\{item\.copiesAfter\}<\/span>/, "duplicada ×N");
  assert.ok(!/status=\{(?:it|featured)\.status === "new"/.test(SUMMARY), "sin cinta que tape el OVR");
  assert.match(read("./HeroReveal.tsx"), /Continuar · \$\{total - 1\} más/, "cuántas quedan tras la hero");
});
