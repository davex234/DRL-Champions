/**
 * F71 · SELECTOR DE ESTADÍSTICA Y PISTAS DE LAS CARTAS OCULTAS — render de las piezas reales.
 *
 * Presentación: las vistas salen del motor puro vía las fixtures deterministas de la Fase 45. Aquí se
 * comprueba lo que se pinta (y que los recorridos automáticos siguen encontrando los botones), no reglas.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MatchBoard } from "./MatchBoard";
import { DuelCard, DuelCardBack } from "./DuelCard";
import { StatSelector } from "./arena/StatSelector";
import { RivalHand } from "./arena/HandFan";
import { RivalStats } from "./arena/RivalStats";
import { fase45Fixtures } from "@/app/design-system/fase45/fixtures";
import { STAT_INFO, type CombatStatKey, type DuelMatchView } from "@/lib/duel/types";
import { hintPresentation } from "@/lib/duel/hintDisplay";

const html = (n: React.ReactElement) => renderToStaticMarkup(n);
const noop = () => {};
const fx = fase45Fixtures();
const KEYS: CombatStatKey[] = ["stronghold", "gamesense", "entryfrag"];

/** Los `<button …>…</button>` de primer nivel del marcado, con sus atributos y su texto plano. */
function buttons(h: string): { attrs: string; text: string }[] {
  return [...h.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({
    attrs: m[1],
    text: m[2].replace(/<[^>]+>/g, "").trim(),
  }));
}
const attr = (attrs: string, name: string): string | null => attrs.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? null;
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'");

const selector = (over: Partial<Parameters<typeof StatSelector>[0]> = {}) =>
  html(<StatSelector card={fx.attack.yourHand[0]} attacking stat={null} required={null} locked={false} onSelect={noop} {...over} />);

test("F71 S1 · atacando: tres bloques <button> (SH/GS/EF) con la cifra IMPRESA de la carta elegida", () => {
  const c = fx.attack.yourHand[0];
  const h = selector({ card: c });
  const bs = buttons(h);
  assert.equal(bs.length, 3, "exactamente las tres estadísticas de combate");
  KEYS.forEach((k, i) => {
    const b = bs[i];
    const abbr = STAT_INFO[k].abbr;
    assert.equal(attr(b.attrs, "type"), "button");
    assert.equal(attr(b.attrs, "data-testid"), `stat-option-${abbr}`);
    // El valor es `card.combat[k]` tal cual (no se recalcula) y el texto sigue el contrato de los E2E.
    assert.equal(b.text, `${abbr}${c.combat[k]}`);
    assert.match(b.text, /^(SH|GS|EF)\s*\d+$/);
    // Nombre accesible completo por `aria-labelledby` (los E2E filtran estos botones por NO tener aria-label).
    assert.equal(attr(b.attrs, "aria-label"), null);
    const id = attr(b.attrs, "aria-labelledby")!;
    const label = h.match(new RegExp(`id="${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>([^<]*)<`))?.[1] ?? "";
    assert.ok(decode(label).startsWith(`${STAT_INFO[k].label} (${abbr}): ${c.combat[k]}`), label);
    assert.equal(attr(b.attrs, "aria-pressed"), "false");
    assert.ok(!/ disabled=""/.test(b.attrs), "con carta elegida se puede elegir");
  });
  assert.match(h, /role="group" aria-label="¿Con qué peleas\?"/);
  // Nombres largos visibles fuera del botón.
  for (const k of KEYS) assert.ok(h.includes(STAT_INFO[k].label));
});

test("F71 S2 · la elegida se marca con TEXTO y aria-pressed, no solo con color", () => {
  const h = selector({ stat: "gamesense" });
  const bs = buttons(h);
  const gs = bs.find((b) => attr(b.attrs, "data-testid") === "stat-option-GS")!;
  assert.equal(attr(gs.attrs, "aria-pressed"), "true");
  assert.equal(attr(gs.attrs, "data-state"), "selected");
  for (const b of bs.filter((x) => x !== gs)) {
    assert.equal(attr(b.attrs, "aria-pressed"), "false");
    assert.equal(attr(b.attrs, "data-state"), "idle");
  }
  assert.equal((h.match(/data-testid="stat-selected-badge"/g) ?? []).length, 1);
  // F71.2 · marca compacta ✓ (sin texto largo); el estado lo dicen aria-pressed + data-state + nombre accesible.
  assert.match(h, /data-testid="stat-selected-badge"[^>]*>✓<\/span>/);
  assert.match(h, /Gamesense \(GS\): \d+, elegida/);
  // El sello está FUERA del botón: el texto del botón sigue siendo sigla + cifra.
  assert.match(gs.text, /^GS\d+$/);
});

test("F71 S3 · con el cerrojo puesto o sin carta, los bloques no responden", () => {
  for (const h of [selector({ locked: true }), selector({ card: null })]) {
    const bs = buttons(h);
    assert.equal(bs.length, 3);
    for (const b of bs) assert.match(b.attrs, /disabled=""/);
  }
  // Sin carta, en estrecho no ocupan sitio (solo la columna de escritorio los reserva).
  assert.match(selector({ card: null }), /class="[^"]*hidden lg:grid/);
});

test("F71 S4 · defendiendo: SOLO la estadística obligada, marcada como tal y sin botón que elegir", () => {
  const c = fx.attack.yourHand[1];
  for (const req of KEYS) {
    const h = html(<StatSelector card={c} attacking={false} stat={null} required={req} locked={false} onSelect={noop} />);
    assert.equal(buttons(h).length, 0, "defendiendo no se elige estadística");
    const abbr = STAT_INFO[req].abbr;
    assert.equal((h.match(/data-testid="stat-option-/g) ?? []).length, 1, "una sola opción");
    assert.match(h, new RegExp(`data-testid="stat-option-${abbr}" data-state="forced"`));
    assert.match(h, new RegExp(`aria-label="Estadística obligada: ${STAT_INFO[req].label}, ${c.combat[req]}"`));
    assert.match(h, /Obligada/);
    assert.ok(h.includes(`>${c.combat[req]}</b>`), "la cifra es la impresa de la carta");
  }
  // Sin obligada todavía (el rival no ha declarado): no se pinta nada.
  assert.equal(html(<StatSelector card={c} attacking={false} stat={null} required={null} locked={false} onSelect={noop} />), "");
});

test("F71 S5 · el tablero monta el panel de decisión con testids estables y el botón de siempre", () => {
  const h = html(<MatchBoard view={fx.attack} onPlay={noop} busy={false} error={null} onDismissError={noop} hudInTopBar />);
  assert.match(h, /data-testid="stat-panel"/);
  assert.match(h, /data-testid="stat-confirm"/);
  assert.match(h, /lg:col-start-2/, "en escritorio va en la columna derecha");
  assert.match(h, /data-arena="controles"/);
  // Atacando, los tres bloques ya están (desactivados hasta elegir carta).
  assert.equal((h.match(/data-testid="stat-option-(SH|GS|EF)"/g) ?? []).length, 3);
  const defending = [fx.defense, fx.imposed, fx.mid].find((v) => !v.youAreAttacker && v.requiredStat);
  if (defending) {
    const d = html(<MatchBoard view={defending} onPlay={noop} busy={false} error={null} onDismissError={noop} hudInTopBar />);
    assert.equal((d.match(/data-testid="stat-option-/g) ?? []).length, 1, "defendiendo, solo la obligada");
    assert.match(d, /data-state="forced"/);
  }
});

test("F71 S6 · la carta del duelo enseña el trío más grande, con los valores del DTO", () => {
  const c = fx.attack.yourHand[0];
  const lg = html(<DuelCard card={c} size="lg" />);
  const xs = html(<DuelCard card={c} size="sm" />);
  for (const k of KEYS) assert.match(lg, new RegExp(`text-\\[17px\\][^"]*" data-combat="${k}">${c.combat[k]}<`));
  assert.match(xs, /text-\[11px\]/);
});

/* ═══════════ PISTAS ═══════════ */

const withHints = (v: DuelMatchView) => v.rivalHints.length > 0 && v.rivalHints.length === v.rivalRemaining;

test("F71 P1 · la vista trae una pista por carta oculta y el tablero la pinta en cada dorso", () => {
  const v = [fx.attack, fx.defense, fx.mid].find(withHints);
  assert.ok(v, "las fixtures traen pistas");
  const h = html(<MatchBoard view={v!} onPlay={noop} busy={false} error={null} onDismissError={noop} hudInTopBar />);
  assert.match(h, new RegExp(`El rival tiene ${v!.rivalRemaining} cartas ocultas`), "el recuento sigue diciéndose");
  const pistas = [...h.matchAll(/aria-label="(Carta oculta · pista[^"]+)"[^>]*data-testid="rival-hint" data-hint-type="(\w+)"/g)];
  // F72.2 · una entrada por carta oculta; las `null` (sin pista representable) salen como dorso normal.
  // DUEL GAMEPLAY UX 2.0 · el nombre accesible suma el ROL de la MISMA carta (`rivalRoles`, alineado con las pistas).
  const drawn = v!.rivalHints
    .map((x, i) => ({ x, role: v!.rivalRoles?.[i] ?? null }))
    .filter((d): d is { x: NonNullable<typeof d.x>; role: typeof d.role } => !!d.x && !!hintPresentation(d.x));
  assert.equal(pistas.length, drawn.length);
  pistas.forEach((m, i) => {
    assert.equal(m[2], drawn[i].x.type);
    const base = hintPresentation(drawn[i].x)!.ariaLabel;
    assert.equal(decode(m[1]), drawn[i].role ? `${base}; rol ${drawn[i].role}` : base);
  });
});

test("F72.2 P2 · la pista es SOLO imagen: bandera sin ISO ni nombre; sin asset (rol, liga o equipo sin icono) → dorso limpio", () => {
  const flag = html(<DuelCardBack size="xs" hint={{ type: "COUNTRY", value: "FI" }} />);
  assert.match(flag, /data-testid="rival-hint" data-hint-type="COUNTRY" data-hint-shape="flag"/);
  // F72.8 · la bandera es el <img> del fichero LOCAL original (antes, fondo CSS): sin tratamiento, sin texto.
  assert.match(flag, /<img data-hint-art="flag" src="\/flags\/fi\.svg" alt=""/, "bandera LOCAL (F72.3), imagen y no emoji");
  assert.ok(!/https?:|flagcdn/.test(flag), "ninguna URL externa");
  assert.ok(flag.includes('aria-label="Carta oculta · pista de país: Finlandia"'), "nombre solo para lectores de pantalla");
  const visible = flag.replace(/<[^>]+>/g, "");
  assert.equal(visible.trim(), "", "ni una letra visible: ni «FI», ni «PAÍS», ni el nombre");
  // F72.3 · equipo con logo local (identidad canónica): solo la imagen, sin nombre ni tag.
  const logo = html(<DuelCardBack size="xs" hint={{ type: "TEAM", value: "fnatic" }} />);
  assert.match(logo, /data-hint-type="TEAM" data-hint-shape="logo"/);
  assert.ok(logo.includes("/hints/teams/fnatic.png") && !/https?:/.test(logo));
  assert.equal(logo.replace(/<[^>]+>/g, "").trim(), "", "ni «FNC» ni «Fnatic» visibles");
  // Ninguna OTRA imagen (foto del jugador) ni dato de la carta: solo el asset de la pista.
  assert.ok(!/PlayerPhoto|OVR|title=/.test(flag) && (flag.match(/<img/g) ?? []).length === 1 && !/<img(?![^>]*data-hint-art)/.test(flag));
  assert.ok(!/[\u{1F1E6}-\u{1F1FF}]/u.test(flag), "sin emoji de bandera");
  // Rol, liga y equipo sin asset (F72.3: roles/ligas sin licencia, Paper Rex sin logo) y país sin bandera local: nada inventado.
  for (const hint of [{ type: "ROLE", value: "DUELIST" }, { type: "REGION", value: "EMEA" }, { type: "TEAM", value: "paper-rex" }, { type: "ROLE", value: "Controlador" }, { type: "COUNTRY", value: "ZZ" }, { type: "COUNTRY", value: "UN" }, { type: "COUNTRY", value: "SE" }] as const) {
    const h = html(<DuelCardBack size="xs" hint={hint} />);
    assert.ok(!/rival-hint|aria-label|data-hint-art/.test(h), JSON.stringify(hint));
  }
  assert.ok(!/rival-hint|aria-label/.test(html(<DuelCardBack size="xs" />)));
});

test("F71 P3 · RivalHand solo pinta pistas si hay exactamente una por carta", () => {
  const hints = [{ type: "COUNTRY" as const, value: "FR" }, { type: "COUNTRY" as const, value: "KR" }];
  assert.equal((html(<RivalHand count={2} hints={hints} />).match(/data-testid="rival-hint"/g) ?? []).length, 2);
  assert.equal((html(<RivalHand count={3} hints={hints} />).match(/data-testid="rival-hint"/g) ?? []).length, 0, "si no cuadran, ninguna");
  assert.match(html(<RivalHand count={3} />), /El rival tiene 3 cartas ocultas/);
});

/* ═══════════ F71.2 · LATERALES SIMÉTRICOS: RIVAL A LA IZQUIERDA, TÚ A LA DERECHA; SOLO «SH 58» ═══════════ */

const board = (v: DuelMatchView) => html(<MatchBoard view={v} onPlay={noop} busy={false} error={null} onDismissError={noop} hudInTopBar />);
const defendingView = () => [fx.defense, fx.imposed, fx.mid].find((v) => !v.youAreAttacker && v.requiredStat && v.pendingRival) ?? null;

test("F71.2 V1 · la fila SH/GS/EF externa ya no va debajo de las cartas del enfrentamiento (las 6 impresas siguen)", () => {
  const c = fx.attack.yourHand[0];
  const big = html(<DuelCard card={c} size="lg" hideCombat />);
  assert.ok(!/data-combat=/.test(big), "sin trío de combate con hideCombat");
  assert.ok(/data-combat=/.test(html(<DuelCard card={c} size="lg" />)), "sin la prop, igual que siempre (la mano no cambia)");
  const src = readFileSync(join(process.cwd(), "src/components/duel/MatchBoard.tsx"), "utf8");
  // DUEL GAMEPLAY UX 2.0 · la del rival comprometida va BOCA ABAJO (reverso canónico): solo la tuya es una carta grande.
  assert.equal((src.match(/size="lg"[^/]*hideCombat \/>/g) ?? []).length, 1, "tu carta grande del enfrentamiento sin la fila");
  assert.match(src, /data-testid="rival-committed"[^]*?<DuelCardBack size="lg"/, "la del rival, reverso canónico");
});

test("F71.2 V2 · escritorio: tres columnas simétricas — rival (1) | mesa (2) | tú (3), los dos laterales a toda la altura", () => {
  const h = board(fx.attack);
  assert.match(h, /lg:grid-cols-\[var\(--ctl-w\)_minmax\(0,1fr\)_var\(--ctl-w\)\]/);
  const rival = h.match(/<section[^>]*data-testid="rival-panel"[^>]*>/)?.[0] ?? "";
  const tu = h.match(/<section[^>]*data-testid="stat-panel"[^>]*>/)?.[0] ?? "";
  assert.match(rival, /lg:col-start-1/); assert.match(tu, /lg:col-start-3/);
  for (const p of [rival, tu]) { assert.match(p, /lg:self-stretch/); assert.match(p, /lg:\[contain:size\]/); assert.match(p, /lg:row-span-3/); }
  assert.match(rival, /hidden lg:/, "el lateral del rival es de escritorio; en estrecho va la tira");
});

test("F71.2 V3 · cada estadística es SOLO sigla + cifra: sin nombres largos ni descripciones", () => {
  for (const h of [selector(), selector({ stat: "stronghold" }), html(<RivalStats card={fx.attack.yourHand[0]} stat="gamesense" />)]) {
    const visible = h.replace(/<span[^>]*class="sr-only"[^>]*>[\s\S]*?<\/span>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    for (const w of ["Stronghold", "Gamesense", "Entryfrag", "Aguantar", "Leer el juego", "Abrir la ronda", "Elegida", "no disponible"]) assert.ok(!visible.includes(w), `sin «${w}» a la vista`);
    assert.match(visible, /^SH \d+ (✓ )?GS \d+ (✓ )?EF \d+( ✓)?$/, "solo siglas, cifras y, como mucho, la marca ✓");
  }
  const bs = buttons(selector());
  for (const b of bs) assert.match(b.text, /^(SH|GS|EF)\d+$/, "contrato E2E: el botón es sigla + cifra");
});

test("F71.2 V4 · ataque y elegida: tres botones que ocupan cada tercio; la elegida con ✓ y las otras con menos énfasis", () => {
  const h = selector({ stat: "entryfrag" });
  const bs = buttons(h);
  assert.equal(bs.length, 3);
  for (const b of bs) assert.match(b.attrs, /lg:h-full/);
  assert.equal((h.match(/opacity-55/g) ?? []).length, 2);
  assert.match(h, /data-testid="stat-selected-badge"[^>]*>✓<\/span>/);
});

test("F71.2 V5 · defensa: las tres a la vista, la obligada destacada con OBLIGADA, las otras apagadas (no son opciones)", () => {
  const c = fx.attack.yourHand[0];
  for (const k of KEYS) {
    const h = html(<StatSelector card={c} attacking={false} stat={null} required={k} locked={false} onSelect={noop} />);
    assert.equal((h.match(/data-testid="stat-option-/g) ?? []).length, 1);
    assert.match(h, /data-state="forced"/);
    assert.equal((h.match(/data-testid="stat-unavailable-/g) ?? []).length, 2);
    assert.equal(buttons(h).length, 0);
    assert.match(h, /data-testid="stat-forced-tag"/);
    assert.match(h, />Obligada</, "la palabra en xl; en laterales estrechos basta el candado");
    assert.match(h, new RegExp(`>${c.combat[k]}<`));
  }
});

test("F71.2 V6 · rival OCULTO: el lateral enseña «?» y no recibe ni pinta ninguna cifra", () => {
  const h = html(<RivalStats card={null} stat={null} />);
  assert.match(h, /data-rival-state="hidden"/);
  assert.equal((h.match(/>\?</g) ?? []).length, 3);
  assert.ok(!/>\d+</.test(h), "ninguna cifra");
  // El tablero, cuando atacas (sin pendingRival), monta el lateral en «oculto».
  assert.equal(fx.attack.pendingRival, null);
  assert.match(board(fx.attack), /data-testid="rival-stats" data-rival-state="hidden"/);
  // Y la firma del componente solo admite la carta pública (no hay prop para la mano oculta).
  const src = readFileSync(join(process.cwd(), "src/components/duel/MatchBoard.tsx"), "utf8");
  // DUEL GAMEPLAY UX 2.0 · la carta comprometida del rival no llega: el lateral NUNCA recibe una carta (solo el eje).
  for (const use of src.match(/<RivalStats[^>]*\/>/g) ?? []) assert.match(use, /card=\{null\} stat=\{view\.pendingRival\?\.stat \?\? null\}/);
});

test("F71.2 V7 · DUEL UX 2.0 · rival COMPROMETIDO: boca abajo en la mesa; el lateral destaca SOLO el eje declarado, sin cifras", () => {
  const v = defendingView();
  assert.ok(v, "hay un fixture de defensa con el rival comprometido");
  const h = board(v!);
  assert.match(h, /data-testid="rival-committed" data-hidden="true"/, "la carta del rival, boca abajo");
  assert.match(h, /data-testid="rival-stats" data-rival-state="hidden"/);
  const panel = h.match(/data-testid="rival-panel"[^]*?<\/section>/)?.[0] ?? "";
  for (const k of KEYS) {
    const tile = panel.match(new RegExp(`data-testid="rival-stat-${STAT_INFO[k].abbr}"[^]*?</b>`))?.[0] ?? "";
    assert.ok(tile.endsWith(">?</b>"), `${STAT_INFO[k].abbr}: «?» (ninguna cifra de la carta oculta)`);
  }
  assert.match(h, new RegExp(`data-testid="rival-stat-${STAT_INFO[v!.pendingRival!.stat].abbr}" data-state="declared-hidden"`));
});

test("F71.2 V8 · 390: rival arriba (tira), tú abajo (hoja de tres en fila); sin «Obligado a responder con…» repetido", () => {
  const h = board(fx.attack);
  assert.match(h, /data-testid="rival-stats"[^>]*class="[^"]*lg:hidden/, "tira del rival en estrecho");
  assert.match(selector(), /class="grid grid-cols-3 gap-1\.5 /, "tres en fila debajo de lg");
  const v = defendingView();
  if (v) assert.ok(!/Obligado a responder con/.test(board(v)));
});

test("F71.2 V9 · entrada suave de los laterales solo sin movimiento reducido", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync("src/app/game-experience.css", "utf8");
  const blocks = [...css.matchAll(/@media \(prefers-reduced-motion: no-preference\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]);
  const mine = blocks.find((b) => /animation:\s*nx-stat-in/.test(b)) ?? "";
  assert.match(mine, /@media \(min-width: 1024px\)/, "solo escritorio, dentro de no-preference");
  const outside = blocks.reduce((acc, b) => acc.replace(b, ""), css);
  assert.ok(!/animation:\s*nx-stat-in/.test(outside), "con movimiento reducido no hay animación");
});
