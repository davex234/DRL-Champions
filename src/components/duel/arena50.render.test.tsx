/**
 * FASE 50 · NEXUS ARENA / MATCH BOARD 4.0 — render de las piezas reales y contratos de fuente.
 *
 * Todo lo de aquí es PRESENTACIÓN: las vistas salen del motor puro (`qaSimulation`, vía las fixtures
 * deterministas de la Fase 45) y se comprueba lo que la arena pinta, no ninguna regla. Las reglas
 * siguen fijadas por sus propios contratos (`gameplay.contract`, `experience.contract`, `duel.test`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MatchBoard } from "./MatchBoard";
import { DuelCard } from "./DuelCard";
import { MatchTopBar } from "./arena/MatchTopBar";
import { ArenaEnvironment } from "./arena/ArenaEnvironment";
import { ARENAS, ARENA_ACCENT, ARENA_MODE_LABEL, DEFAULT_ARENA_ID, arenaFor, type ArenaMode } from "@/lib/duel/arenas";
import { getCard } from "@/data/catalog";
import { fase45Fixtures } from "@/app/design-system/fase45/fixtures";
import type { DuelMatchView } from "@/lib/duel/types";

const ROOT = process.cwd();
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
const html = (n: React.ReactElement) => renderToStaticMarkup(n);
const noop = () => {};
const fx = fase45Fixtures();
const CSS = read("src", "app", "game-experience.css");
/** Solo la sección de la Fase 50 (va entre el charco de luz de la F45 y el vestíbulo de la F46). */
const F50_CSS = CSS.slice(CSS.indexOf("FASE 50 · NEXUS ARENA"), CSS.indexOf("FASE 46 · EL VESTÍBULO"));
const MODES: ArenaMode[] = ["quick", "ranked", "campaign", "draft"];

const board = (view: DuelMatchView, hudInTopBar = true) =>
  html(<MatchBoard view={view} onPlay={noop} busy={false} error={null} onDismissError={noop} hudInTopBar={hudInTopBar} />);

/* ═══════════ ARENA SYSTEM ═══════════ */

test("F50 01 · cada arena declara id, nombre, fondos, acentos y efectos", () => {
  for (const [id, a] of Object.entries(ARENAS)) {
    assert.equal(a.arenaId, id);
    assert.ok(a.name.length > 0 && a.tagline.length > 0);
    assert.match(a.accentPlayer, /^#[0-9a-f]{6}$/i);
    assert.match(a.accentOpponent, /^#[0-9a-f]{6}$/i);
    for (const k of ["motes", "beams", "haze", "crowd"] as const) assert.equal(typeof a.ambient[k], "boolean");
  }
  assert.ok(ARENAS[DEFAULT_ARENA_ID], "la arena por defecto existe");
});

test("F50 02 · los fondos de cada arena existen, son WebP y pesan poco (≤ 400 KB escritorio, ≤ 150 KB móvil)", () => {
  for (const a of Object.values(ARENAS)) {
    for (const [k, url, max] of [["wide", a.background.wide, 400_000], ["narrow", a.background.narrow, 150_000]] as const) {
      const f = join(ROOT, "public", url);
      assert.ok(existsSync(f), `${a.arenaId}.${k}: ${url}`);
      assert.match(url, /\.webp$/);
      assert.equal(readFileSync(f).subarray(8, 12).toString("ascii"), "WEBP", `${url} es WebP de verdad`);
      assert.ok(statSync(f).size <= max, `${url} pesa ${statSync(f).size}`);
    }
  }
});

test("F50 03 · todo modo tiene arena y rótulo: el modo decide el recinto, no la estructura", () => {
  for (const m of MODES) {
    assert.ok(ARENAS[arenaFor(m).arenaId], m);
    assert.ok(ARENA_MODE_LABEL[m], m);
  }
});

test("F50 04 · rival rojo, jugador cian: un único juego de acentos para todo el tablero", () => {
  assert.equal(ARENA_ACCENT.player.toLowerCase(), "#2fe0ff");
  assert.equal(ARENA_ACCENT.opponent.toLowerCase(), "#ff2e63");
  for (const f of ["MatchBoard.tsx", "DuelMoment.tsx", "arena/ArenaSurface.tsx", "arena/PlayedRow.tsx"]) {
    const src = read("src", "components", "duel", f);
    assert.ok(src.includes("ARENA_ACCENT"), `${f} toma los tonos de la arena`);
    assert.ok(!src.includes('"#3fc07a"'), `${f} ya no pinta al jugador en verde`);
  }
});

/* ═══════════ EL RECINTO ═══════════ */

test("F50 05 · el recinto monta la imagen de SU arena, a pantalla completa, sin puntero ni lectores", () => {
  const h = html(<ArenaEnvironment attacker="you" variant="quick" />);
  assert.match(h, /data-arena-id="nexus-champions"/);
  // F71 · sin temática de duelo activa (render en servidor, sin fetch) la capa es la imagen de la arena DEFAULT.
  assert.ok(h.includes(`--arena-bg-wide:url(&quot;${ARENAS["nexus-champions"].background.wide}&quot;)`) || h.includes(`--arena-bg-wide:url("${ARENAS["nexus-champions"].background.wide}")`), h.slice(0, 400));
  assert.match(h, /data-duel-theme="default"/);
  assert.match(h, /aria-hidden="true"/);
  assert.match(h, /pointer-events-none fixed inset-0/);
  assert.equal((h.match(/nx-arena-env-mote"/g) ?? []).length, 12, "doce motas, contadas");
  assert.equal((h.match(/class="nx-arena-env-beam /g) ?? []).length, 4, "cuatro focos, contados");
});

test("F50 06 · con movimiento reducido no se mueve nada del estadio ni del tablero nuevo", () => {
  const reduce = F50_CSS.split("@media (prefers-reduced-motion: reduce)")[1] ?? "";
  for (const c of ["nx-arena-env-stage", "nx-arena-env-beam", "nx-arena-env-haze", "nx-arena-env-crowd", "nx-a50-duel-line", "nx-a50-vs-ring", "nx-a50-vs-pulse", "nx-a50-slot", "nx-a50-shock"]) {
    assert.ok(reduce.slice(0, 600).includes(c), `${c} se apaga con reduce`);
  }
  // Toda animación nueva vive bajo no-preference.
  const noPref = F50_CSS.split("@media (prefers-reduced-motion: no-preference)")[1] ?? "";
  assert.match(noPref, /nx-a50-drift/);
});

test("F50 07 · rendimiento: el estadio no usa desenfoque animado, ni grano, ni mezcla, ni WebGL", () => {
  const f50 = F50_CSS.replace(/\/\*[\s\S]*?\*\//g, ""); // el código, no los comentarios
  assert.ok(f50.length > 2000, "la sección existe y está delimitada");
  assert.ok(!/backdrop-filter/.test(f50), "sin backdrop-filter");
  assert.ok(!/feTurbulence|noise|grain/i.test(f50), "sin grano");
  assert.ok(!/mix-blend-mode/.test(f50), "sin modos de mezcla a pantalla completa");
  assert.ok(!/filter:\s*blur/.test(f50), "sin blur en las capas nuevas");
  const moment = read("src", "components", "duel", "DuelMoment.tsx").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/backdrop-blur/.test(moment), "la resolución ya no desenfoca la arena");
});

/* ═══════════ TABLERO ═══════════ */

test("F50 08 · con la barra de la partida, el tablero no repite turno ni marcador (siguen para lectores)", () => {
  const h = board(fx.mid, true);
  assert.match(h, /data-arena="hud" class="[^"]*hidden"/, "la tira de la mesa se retira");
  assert.match(h, /data-hud="turno"[^>]*class="[^"]*sm:sr-only/, "la cinta del turno pasa a lectores a partir de sm");
  assert.match(h, /data-testid="turn-label"/, "el turno sigue en el DOM");
  // Sin barra (arena PvP) la tira sigue a la vista.
  assert.ok(!/data-arena="hud" class="[^"]*hidden"/.test(board(fx.mid, false)));
});

test("F50 09 · plataformas por bando y zona de duelo con su línea de energía", () => {
  const h = board(fx.attack);
  assert.match(h, /data-arena="zona-rival" data-side="rival"/);
  assert.match(h, /data-arena="zona-jugador" data-side="jugador"/);
  assert.equal((h.match(/class="nx-a50-plate"/g) ?? []).length, 2);
  assert.match(h, /class="nx-a50-duel-line"/);
  assert.match(h, /class="nx-a50-vs block font-display" data-ready="false">VS</);
});

test("F50 10 · la mano rival son dorsos contados; ninguna carta sin jugar del rival llega al tablero", () => {
  const v = fx.defense;
  const h = board(v);
  assert.match(h, new RegExp(`El rival tiene ${v.rivalRemaining} cartas ocultas`));
  // Lo único del rival con nombre en el tablero es lo que ya JUGÓ. DUEL GAMEPLAY UX 2.0 · la comprometida va boca abajo.
  const visibles = new Set(v.rivalUsed.map((c) => c.uid));
  const nombres = [...h.matchAll(/aria-label="([^"]+), [^"]+, OVR \d+"/g)].map((m) => m[1]);
  const mios = new Set([...v.yourHand, ...v.yourUsed].map((c) => c.nick));
  for (const n of nombres) {
    if (mios.has(n)) continue;
    assert.ok(v.rivalUsed.some((c) => c.nick === n && visibles.has(c.uid)), `${n} solo si el servidor lo mandó`);
  }
});

test("F50 11 · jerarquía: carta del duelo ×2,3 posiciones, mano hasta 108 px, lo jugado al 72 %", () => {
  const b = read("src", "components", "duel", "MatchBoard.tsx");
  const s = read("src", "components", "duel", "arena", "ArenaSurface.tsx");
  const hand = read("src", "components", "duel", "arena", "HandFan.tsx");
  assert.ok(b.includes("sm:w-[calc(var(--pos)*2.3)]"));
  assert.ok(s.includes('"--pos-hist": "calc(var(--pos) * 0.72)"'));
  assert.ok(s.includes('style={{ "--pos": "var(--pos-hist)" } as React.CSSProperties}'), "las plataformas miden lo jugado con --pos-hist");
  assert.ok(hand.includes("!w-[clamp(62px,min(10.6vh,8vw),108px)]"));
});

test("F50 12 · la mano: arco, la elegida sube y se ilumina en cian, y el hueco de una carta levantada sigue eligiéndola", () => {
  const hand = read("src", "components", "duel", "arena", "HandFan.tsx");
  assert.ok(hand.includes("onClick={(e) => { if (!disabled && e.target === e.currentTarget) onPick?.(c.uid); }}"));
  assert.ok(hand.includes("motion-reduce:transition-none"));
  assert.ok(hand.includes('"translateY(-24px) rotate(0deg) scale(1.1)"'));
});

/* ═══════════ BARRA DE LA PARTIDA ═══════════ */

test("F50 13 · la barra dice modo, rival, turno, pista de diez, fase y marcador con los datos de la vista", () => {
  const v = fx.mid;
  const h = html(<MatchTopBar view={v} mode="campaign" rivalName="Rival QA" difficultyLabel="Normal" controls={<button type="button">Salir</button>} />);
  assert.match(h, /Road to Champions/);
  assert.match(h, /vs Rival QA · Normal/);
  assert.equal((h.match(/class="nx-a50-seg"/g) ?? []).length, v.totalTurns, "un segmento por turno");
  const ganados = v.history.filter((t) => t.outcome === "A").length;
  assert.equal((h.match(/data-cell="WIN"/g) ?? []).length, ganados, "cian = puntos tuyos, leídos del historial");
  assert.match(h, new RegExp(`Marcador: tú ${v.scoreYou}, Rival QA ${v.scoreRival}`));
  assert.match(h, v.youAreAttacker ? /Fase de ataque/ : /Fase de defensa/);
  assert.match(h, />Salir</, "los controles los pone la página");
});

test("F50 14 · la página monta la barra nueva con los mismos controles y la arena del modo", () => {
  const page = read("src", "app", "duelos", "jugar", "page.tsx");
  assert.ok(page.includes("<MatchTopBar"));
  assert.ok(page.includes("arena={arenaMode}") && page.includes("hudInTopBar"));
  assert.ok(page.includes('{stage === "result" && view && <ArenaEnvironment variant={arenaMode} />}'), "el resultado se ve dentro del estadio");
});

/* ═══════════ CARTAS DISEÑADAS ═══════════ */

test("F50 15 · una carta diseñada no repite su cromo impreso: solo se añade el trío de combate", () => {
  const card = fx.attack.yourHand.find((c) => getCard(c.cardId)?.image);
  assert.ok(card, "las fixtures usan cartas del catálogo con imagen");
  const h = html(<DuelCard card={card!} size="lg" />);
  assert.ok(!h.includes(`>${card!.nick}</p>`), "el nombre impreso no se duplica");
  assert.ok(h.includes(`aria-label="${card!.nick}`) || !h.includes("<button"), "el nombre accesible sigue");
  for (const k of ["stronghold", "gamesense", "entryfrag"] as const) assert.ok(h.includes(`>${card!.combat[k]}</span>`), `trío: ${k}`);
});
