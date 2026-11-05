/**
 * DRAFT GAUNTLET · RENDER (Fase 39) — la sala de guerra pintada con fotos construidas por el dominio real
 * (`/design-system/fase39/fixtures`): portada, draft, vista previa, comparación, sin conexión, 409, plantilla completa,
 * mapa, combate abierto, resultados, abandono, fallo de arte y nombres largos.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { fase39Fixture, FASE39_STATES, type Fase39State } from "@/app/design-system/fase39/fixtures";
import { DraftGauntletScreen } from "./DraftGauntletScreen";
import { DraftResultBanner } from "./DraftResultBanner";
import { GauntletMap } from "./GauntletMap";

const noop = () => undefined;
function html(state: Fase39State): string {
  const f = fase39Fixture(state);
  return renderToStaticMarkup(
    <DraftGauntletScreen
      snapshot={f.snapshot} ui={f.ui} busy={f.busy} offline={f.offline} loading={f.loading} notice={f.notice ?? null}
      abandonOpen={f.abandonOpen} forceArtFallback={f.forceArtFallback}
      onStart={noop} onSelect={noop} onCancel={noop} onConfirm={noop} onStartMatch={noop} onResumeMatch={noop}
      onAbandonRequest={noop} onAbandonConfirm={noop} onAbandonCancel={noop} onRetry={noop}
    />,
  );
}
const count = (s: string, needle: string) => s.split(needle).length - 1;

test("R01 · todos los estados sintéticos se pintan sin romper", () => {
  for (const s of FASE39_STATES) assert.ok(html(s).includes('data-testid="draft-screen"'), s);
});

test("R02 · cargando, error y no disponible", () => {
  assert.ok(html("loading").includes('data-testid="draft-loading"'));
  assert.ok(html("error").includes('data-testid="draft-error"'));
  const u = html("unavailable");
  assert.ok(u.includes('data-testid="draft-unavailable"'));
  assert.ok(u.includes("Draft Gauntlet todavía no disponible"));
  assert.ok(!u.includes('data-testid="draft-start"'));
});

test("R03 · portada: nombre, lema, reglas honestas (fuera de tu colección), F72: ENTRADA 2.000, escalera de premios y ENTRAR · 2.000", () => {
  const h = html("landing");
  assert.ok(h.includes("Draft <span") && h.includes("Gauntlet"));
  assert.ok(h.includes("Construye. Adáptate. Sobrevive."));
  assert.ok(h.includes("no entran en tu colección") && !h.includes("Sin recompensas"));
  assert.match(h, /data-field="entry-fee"[^>]*>2\.000</);
  assert.equal(count(h, "data-wins="), 6);
  assert.match(h, /data-testid="draft-start"[^>]*>Entrar · 2\.000</);
  assert.ok(!h.includes('data-testid="draft-last-run"'));
});

test("R04 · portada con última run e historial", () => {
  const h = html("landing-history");
  assert.ok(h.includes('data-testid="draft-last-run" data-status="FAILED"'));
  assert.equal(count(h, 'data-testid="gauntlet-node"'), 5);
  assert.ok(h.includes('data-testid="draft-history"'));
  assert.match(h, />Entrar · 2\.000</);
});

test("R05 · draft: cabecera PICK X/10 y ROL ACTUAL, exactamente 3 opciones y plantilla de 10 huecos", () => {
  const h = html("pick-5");
  assert.ok(h.includes("PICK 5/10"));
  assert.ok(h.includes("ROL ACTUAL:"));
  assert.equal(count(h, 'data-testid="draft-option"'), 3);
  assert.equal(count(h, 'data-testid="draft-roster-slot"'), 10);
  assert.equal(count(h, 'data-filled="true"'), 4);
  assert.ok(!h.includes('data-testid="draft-preview"'));
});

test("R06 · sin vista previa no hay botón de confirmar (nada se elige por accidente)", () => {
  const h = html("pick-1");
  assert.ok(!h.includes('data-testid="draft-confirm"'));
  assert.equal(count(h, 'data-selected="true"'), 0);
});

test("R07 · vista previa: una opción marcada, CONFIRMAR ELECCIÓN y comparación", () => {
  const h = html("preview");
  assert.equal(count(h, 'data-selected="true"'), 1);
  assert.ok(h.includes('data-testid="draft-confirm"') && h.includes("Confirmar elección"));
  assert.ok(h.includes('data-testid="draft-cancel"'));
  assert.ok(h.includes('data-testid="draft-compare"'));
});

test("R08 · comparación con el ya elegido del mismo rol (tabla con OVR y las tres estadísticas)", () => {
  const h = html("compare");
  assert.ok(h.includes("<table"));
  for (const k of ["OVR", "Stronghold", "Gamesense", "Entryfrag"]) assert.ok(h.includes(k), k);
});

test("R09 · elección en vuelo: «Confirmando…» y botones desactivados", () => {
  const h = html("loading-pick");
  assert.ok(h.includes("Confirmando…"));
  assert.match(h, /data-testid="draft-confirm"[^>]*disabled|disabled[^>]*data-testid="draft-confirm"/);
});

test("R10 · 409 resincronizado: aviso visible", () => {
  const h = html("stale");
  assert.ok(h.includes('data-testid="draft-notice" data-tone="warn"'));
  assert.ok(h.includes("La run cambió en otra pestaña"));
});

test("R11 · sin conexión: banner y la foto sigue visible", () => {
  const h = html("offline");
  assert.ok(h.includes('data-testid="draft-offline"'));
  assert.equal(count(h, 'data-testid="draft-option"'), 3);
});

test("R12 · plantilla completa y mapa: 01 siguiente, resto bloqueado, botón del combate 01", () => {
  const h = html("draft-complete");
  assert.ok(h.includes('data-testid="draft-complete"') && h.includes("Equipo completo")); // F64 · «equipo» (terminología única)
  assert.deepEqual([...h.matchAll(/data-testid="gauntlet-node" data-state="(\w+)"/g)].map((m) => m[1]), ["CURRENT", "LOCKED", "LOCKED", "LOCKED", "LOCKED"]);
  assert.ok(h.includes("Jugar combate 01"));
});

test("R13 · etapas 2–4 y final: superados y siguiente; la final dice «Jugar la final»", () => {
  assert.deepEqual([...html("stage-3").matchAll(/data-state="(\w+)"/g)].map((m) => m[1]).slice(0, 5), ["WON", "WON", "CURRENT", "LOCKED", "LOCKED"]);
  assert.ok(html("final").includes("Jugar la final"));
  assert.ok(!html("stage-2").includes('data-testid="draft-complete"'));
});

test("R14 · combate abierto: RETOMAR COMBATE y nodo en combate marcado como paso actual", () => {
  const h = html("in-match");
  assert.ok(h.includes('data-testid="draft-resume-match"'));
  assert.match(h, /data-state="IN_MATCH" aria-current="step"/);
  assert.ok(!h.includes('data-testid="draft-start-match"'));
});

test("R15 · confirmación de abandono en pantalla (alertdialog) y el botón de abandonar se oculta", () => {
  const h = html("abandon-confirm");
  assert.ok(h.includes('role="alertdialog"'));
  assert.ok(h.includes('data-testid="draft-abandon-yes"'));
  assert.ok(!h.includes('data-testid="draft-abandon"'));
});

test("R16 · resultados finales en portada: completada, terminada y abandonada", () => {
  assert.ok(html("completed").includes('data-status="COMPLETED"') && html("completed").includes("GAUNTLET SUPERADO"));
  assert.ok(html("failed").includes("RUN TERMINADA"));
  assert.ok(html("abandoned").includes("RUN ABANDONADA"));
  for (const s of ["completed", "failed", "abandoned"] as const) assert.ok(!html(s).includes('data-testid="draft-abandon"'));
});

test("R17 · fallo de arte: las 3 opciones con cara de texto y los mismos datos", () => {
  const h = html("art-failure");
  assert.equal(count(h, 'data-testid="draft-card-fallback"'), 3);
  assert.equal(count(h, 'data-testid="draft-option-nick"'), 3);
});

test("R18 · nombres largos: se parten en vez de desbordar", () => {
  const h = html("long-names");
  assert.ok(h.includes("Supercalifragilisticoespialidoso"));
  assert.ok(count(h, "break-words") >= 6);
});

test("R19 · sin serial, sin «nueva», sin veredictos en ningún estado", () => {
  for (const s of FASE39_STATES) {
    const h = html(s).replace(/<[^>]+>/g, " ");
    assert.ok(!/#\d+\s*\/\s*\d+|\bserial\b|\bnueva carta\b|\bmejor\b|recomendad/i.test(h), s);
  }
});

test("R20 · banner de resultado: victoria, derrota, empate, completado y pendiente", () => {
  for (const [s, tone] of [["win", "win"], ["loss", "loss"], ["draw", "draw"], ["completed", "complete"]] as const) {
    const f = fase39Fixture(s);
    const h = renderToStaticMarkup(<DraftResultBanner copy={f.result!} onBack={noop} />);
    assert.ok(h.includes(`data-tone="${tone}"`), s);
  }
  const pending = renderToStaticMarkup(<DraftResultBanner copy={{ tone: "pending", title: "t", line: "l", cta: "c" }} onBack={noop} onRefresh={noop} />);
  assert.ok(pending.includes("Actualizar"));
});

test("R21 · el mapa suelto pinta marcador de los combates liquidados", () => {
  const f = fase39Fixture("stage-3");
  const h = renderToStaticMarkup(<GauntletMap stages={f.snapshot!.run!.stages} />);
  assert.ok(h.includes("Superado · 6–4"));
});

test("R22 · la vista previa se ancla con `fixed` sobre la barra móvil (sticky no se pega en DRLCards) y deja hueco", () => {
  const h = html("preview");
  const at = h.indexOf('data-testid="draft-preview"');
  const wrapper = h.slice(h.lastIndexOf("<div", h.lastIndexOf("<section", at)), at);
  assert.ok(wrapper.includes("fixed") && wrapper.includes("bottom-[var(--nx-mobilebar)]") && wrapper.includes("lg:bottom-0"));
  assert.ok(!h.slice(h.lastIndexOf("<section", at), at).includes("sticky"));
  assert.ok(h.includes('data-testid="draft-preview-spacer"'));
  assert.ok(!html("pick-5").includes('data-testid="draft-preview-spacer"'));
});
