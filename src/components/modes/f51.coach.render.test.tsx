/**
 * FASE 51 · TACTICAL COACH 4.0 — acceso desde /jugar (render real) y contratos de fuente de las
 * pantallas del entrenador: pizarra con cerrojo optimista y deshacer, plan con «no encontrada»,
 * API de partido único, teatro a pantalla completa estable y cero migraciones nuevas.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { GameModesHub } from "./GameModesHub";
import { gameModes, type ModeFacts } from "@/lib/campaign/presentation";
import { createHistory, commit, undo, redo } from "@/domain/tactics/history";

const ROOT = process.cwd();
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
/** Sin comentarios: una aserción de fuente no puede aprobar por lo que dice un comentario. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const FACTS: ModeFacts = {
  signedIn: true, hasValidDeck: true, activePve: false, activePvp: false, rankedProvisional: false,
  campaign: { available: true, completed: 2, total: 15, complete: false, nextName: "Lectura de mapa", chapter: "Capítulo 1" },
  draft: { available: true, status: null, pick: 0, stage: 0, lastStatus: null },
};
const hub = (f: ModeFacts = FACTS) =>
  renderToStaticMarkup(<GameModesHub cards={gameModes(f)} />);

const PIZARRA = code(read("src", "app", "entrenador", "strats", "page.tsx"));
const PLAN = code(read("src", "app", "entrenador", "plan", "page.tsx"));
const MATCHES_API = code(read("src", "app", "api", "game", "coach-matches", "route.ts"));
const THEATER = code(read("src", "components", "tactics", "TacticalTheater.tsx"));
const FRAME = code(read("src", "components", "coach", "tc", "CoachFrame.tsx"));

/* ═══════════ /jugar ═══════════ */

/* F71 · el Coach deja de ser una franja con lista de capacidades bajo los modos: es una de las TRES áreas de /jugar. */
test("F51 J1 · /jugar enseña el Tactical Coach como área con su CTA a /entrenador", () => {
  const h = hub();
  assert.match(h, /data-testid="play-area-COACH"/);
  assert.match(h, /href="\/entrenador"[^>]*data-testid="play-area-cta-COACH"|data-testid="play-area-cta-COACH"[^>]*href="\/entrenador"/);
});

test("F51 J2 · NO roba la acción dominante (su CTA es «coach», no «primary»)", () => {
  const h = hub();
  assert.equal((h.match(/data-cta="primary"/g) ?? []).length, 1);
  assert.match(h, /data-cta="coach"[^>]*data-testid="play-area-cta-COACH"/);
});

test("F51 J3 · va DESPUÉS de la campaña y de Duelos", () => {
  const h = hub();
  const rtc = h.indexOf('data-testid="play-area-RTC"');
  const duels = h.indexOf('data-testid="play-area-DUELS"');
  const coach = h.indexOf('data-testid="play-area-COACH"');
  assert.ok(rtc >= 0 && duels > rtc && coach > duels, "orden: campaña, duelos, coach");
});

test("F51 J4 · el menú Más → Entrenador sigue existiendo", () => {
  const nav = read("src", "design", "nav.ts");
  assert.match(nav, /href: "\/entrenador", label: "Entrenador"/);
});

/* ═══════════ BUG 2 · PIZARRA: cerrojo optimista ═══════════ */

test("F51 V1 · la pizarra guarda con versión (saveStratVersioned + baseVersion)", () => {
  assert.match(PIZARRA, /saveStratVersioned\(plan, comoCopia \? null : savedId, comoCopia \? null : version\)/);
  assert.ok(!/\bsaveStrat\(/.test(PIZARRA), "ya no usa el guardado sin versión");
  assert.match(PIZARRA, /setVersion\(row\.updatedAt\)|cargar\(row\.id, row\.plan, row\.updatedAt\)/, "la versión sale de la fila abierta");
});

test("F51 V2 · 409 VERSION_CONFLICT → aviso visible con recargar o copia, sin pisar ni mezclar", () => {
  assert.match(PIZARRA, /e\.code === "VERSION_CONFLICT"/);
  assert.match(PIZARRA, /Esta jugada ha cambiado en otra sesión\./);
  assert.match(PIZARRA, /Recargar última versión/);
  assert.match(PIZARRA, /Guardar como copia/);
  assert.match(PIZARRA, /data-testid="version-conflict"/);
  // Ningún «forzar»: el único camino para escribir es la copia (id nulo, sin versión).
  assert.ok(!/force|overwrite|forzar/i.test(PIZARRA));
});

test("F51 V3 · la API responde el texto del encargo", () => {
  assert.match(code(read("src", "app", "api", "game", "strats", "route.ts")), /Esta jugada ha cambiado en otra sesión\./);
});

/* ═══════════ PIZARRA: deshacer / rehacer ═══════════ */

test("F51 U1 · la pizarra edita a través del historial, con atajos y sin autoguardado", () => {
  assert.match(PIZARRA, /createHistory\(/);
  assert.match(PIZARRA, /commit\(h, fn\(h\.present\)/);
  assert.match(PIZARRA, /historyShortcut\(/);
  assert.match(PIZARRA, /data-testid="undo"/);
  assert.match(PIZARRA, /data-testid="redo"/);
  assert.match(PIZARRA, /`move:\$\{pasoVisible\}:\$\{id\}`/, "un arrastre = una entrada");
  // Deshacer NO guarda: ni deshacer ni rehacer llaman al servidor.
  const cuerpo = PIZARRA.slice(PIZARRA.indexOf("const deshacer"), PIZARRA.indexOf("const rehacer") + 120);
  assert.ok(!/save|fetch/.test(cuerpo));
  assert.ok(!/setInterval|autosave|autoguard/i.test(PIZARRA), "no hay autoguardado");
});

test("F51 U2 · persistencia tras deshacer/rehacer: se guarda EXACTAMENTE el presente", () => {
  const a = { v: "A" }, b = { v: "B" }, c = { v: "C" };
  let h = createHistory(a);
  h = commit(h, b, { now: 0 });
  h = commit(h, c, { now: 5000 });
  h = undo(h);
  assert.equal(h.present, b, "tras deshacer, el presente (lo que se guardaría) es B");
  h = redo(h);
  assert.equal(h.present, c, "tras rehacer, vuelve a ser C");
  // La pizarra guarda `strat`, que es `hist.present`, y marca «guardado» ese mismo objeto.
  assert.match(PIZARRA, /const strat = hist\.present;/);
  assert.match(PIZARRA, /setGuardado\(plan\)/);
});

test("F51 U3 · la línea de pasos conserva el formato que cuentan los verificadores («N.»)", () => {
  assert.match(PIZARRA, /String\(i \+ 1\)\.padStart\(2, "0"\)\}\./);
  assert.match(PIZARRA, /\+ Paso/);
  assert.match(PIZARRA, /MAX_STEPS/);
});

/* ═══════════ BUG 3 · PLAN: partida inexistente o ajena ═══════════ */

test("F51 P1 · la API devuelve 404 idéntico para id ajeno, inexistente o mal formado", () => {
  assert.match(MATCHES_API, /UUID_RE\.test\(unico\)/);
  assert.equal((MATCHES_API.match(/"Partida no encontrada"/g) ?? []).length, 2);
  assert.match(MATCHES_API, /partidoPorId\(session\.admin, session\.userId, unico\)/, "filtrado por dueño");
});

test("F51 P2 · el plan pide LA partida y enseña «no encontrada» sin filtrar datos", () => {
  assert.match(PLAN, /fetchCoachMatch\(matchId\)/);
  assert.ok(!/limit=60/.test(PLAN), "ya no busca entre las sesenta últimas");
  assert.match(PLAN, /data-testid="plan-not-found"/);
  assert.match(PLAN, /e\.status === 404/);
  const nf = PLAN.slice(PLAN.indexOf('data-testid="plan-not-found"'), PLAN.indexOf("</section>", PLAN.indexOf('data-testid="plan-not-found"')));
  assert.ok(!/matchId/.test(nf), "el estado no repite el identificador pedido");
});

test("F51 P3 · sin ?match el plan ofrece partidas reales (o un vacío con salida)", () => {
  assert.match(PLAN, /fetchCoachMatches\(12\)/);
  assert.match(PLAN, /data-testid="plan-select-match"/);
  assert.match(PLAN, /data-testid="plan-no-matches"/);
});

/* ═══════════ TEATRO Y NAVEGACIÓN ═══════════ */

test("F51 T1 · el teatro no cambia de elemento al entrar en pantalla completa", () => {
  assert.match(THEATER, /return createPortal\(cuerpo, document\.body\);/);
  assert.ok(!/mode === "native" \? cuerpo/.test(THEATER), "sin la rama que remontaba el elemento");
  assert.match(THEATER, /data-testid="theater-fullscreen"/);
  for (const id of ["theater-prev", "theater-play", "theater-next", "theater-close"]) assert.match(THEATER, new RegExp(id));
});

test("F51 N1 · las ocho salas del coach están siempre enlazadas (incluido el Plan desde el hub)", () => {
  for (const r of ["/entrenador/composiciones", "/entrenador/strats", "/entrenador/plan", "/entrenador/mapas",
    "/entrenador/partido", "/entrenador/partidos", "/entrenador/equipos"]) {
    assert.ok(FRAME.includes(`"${r}"`), `${r} en la navegación del coach`);
  }
});

test("F51 M1 · cero migraciones en F51: la cabeza es 0058 (F58: 0055; F59.1: 0056; F60: 0057; PRE-F70: 0058)", () => {
  const sql = readdirSync(join(ROOT, "supabase", "migrations")).filter((f) => f.endsWith(".sql")).sort();
  // F73 añade 0059 (crafteo y misiones) y 0060 (desguace atómico, última copia): AUTORIZADAS y APLICADAS el 2026-09-30.
  assert.equal(sql[sql.length - 1], "0076_team_identities_admin.sql"); // IDENTIDAD DE EQUIPOS NUEVOS · 0076 (alta desde el panel de clave, nombre, etiqueta y región de equipos impresos que el código no conoce; aditiva) es la última; antes COLECCIONES POR EQUIPO · 0075 (primeras compleciones e insignias regionales; aditiva: sin ella el servidor solo deja de guardarlas) es la última; antes F87.2 · 0073 (launch guard de Pick'ems: elegibilidad y puerta de tiempo) es la última; antes F87.1 · 0072, F87 · 0071 (Pick'ems 2.0: cuadros de predicción, cierre por partido, liquidación y reclamos; aditiva) es la última; antes F86.2 · 0070 (feedback de la Closed Alpha + embudo derivado) es la última; antes F86 · 0069 (torneos de jugadores) es la última del repositorio (cabeza = 0069; 0068 tag público de cuenta; 0067 gestión de admins, F85 añadió 0066, F84 añadió 0065, F83 0064, ops/release). F82 añadió 0062 y F89 0063.
});
