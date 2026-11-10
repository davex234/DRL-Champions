/**
 * F71 · PLAY EXPERIENCE 2.0 — VER → ELEGIR → JUGAR.
 *
 * `/jugar` son TRES áreas (Road to Champions, Duelos, Tactical Coach) y `/duelos` son CUATRO modos (partida rápida,
 * competitivo, retar a un amigo, Draft Gauntlet). Se fijan: los testids estables del gate de navegador, los
 * destinos (que siguen saliendo de `gameModes()`), las etiquetas de los CTA, que los enlaces profundos existen,
 * un presupuesto de texto medible («no muro de texto») y que en móvil los paneles se apilan en una columna.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { GameModesHub } from "./GameModesHub";
import { DuelModesHub } from "./DuelModesHub";
import {
  CAMPAIGN_ROUTE, campaignAreaCta, duelModeCta, duelModeNote, duelModes, gameModes, type ModeFacts,
} from "@/lib/campaign/presentation";
import { DRAFT_MATCH_HREF, DRAFT_ROUTE } from "@/domain/draft/rules";
import { draftEconomyView } from "@/domain/draft/economy";
import type { RankedGate } from "@/domain/pvpLadder/ranked";
import type { DuelModesHubProps } from "./DuelModesHub";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const FACTS: ModeFacts = {
  signedIn: true, hasValidDeck: true, activePve: false, activePvp: false, rankedProvisional: false,
  campaign: { available: true, completed: 7, total: 15, complete: false, nextName: "Lectura de mapa", chapter: "Capítulo 2" },
  draft: { available: true, status: null, pick: 0, stage: 0, lastStatus: null },
};
const jugar = (f: ModeFacts = FACTS, progress: { completed: number; total: number } | null = { completed: 7, total: 15 }) =>
  renderToStaticMarkup(<GameModesHub cards={gameModes(f)} rtcProgress={progress} />);
const ECON = draftEconomyView();
const READY_GATE: RankedGate = { kind: "READY", deck: { id: "d1", name: "Alfa", valid: true, errors: [], cards: [] } };
/** F72 · `/duelos` con un modo SELECCIONADO (`requested` = `?modo=`). */
const duelos = (f: ModeFacts = FACTS, extra: Partial<DuelModesHubProps> = {}) =>
  renderToStaticMarkup(<DuelModesHub cards={gameModes(f)} draftFacts={f.draft ?? null} draftEconomy={ECON} credits={10_000} onDraftEnter={() => undefined} {...extra} />);

/** Destino y etiqueta del enlace con ese testid (el orden de atributos no importa). */
function ctaOf(h: string, testid: string): { href: string; label: string } {
  const m = h.match(new RegExp(`<a ([^>]*data-testid="${testid}"[^>]*)>([\\s\\S]*?)</a>`));
  assert.ok(m, `CTA ${testid}`);
  const href = m![1].match(/href="([^"]+)"/);
  assert.ok(href, `href de ${testid}`);
  return { href: href![1].replace(/&amp;/g, "&"), label: m![2].replace(/<[^>]+>/g, "").trim() };
}

/**
 * Texto «de lectura» de una pantalla: se quitan títulos (h1/h2), botones y enlaces (CTA), arte (svg) y el
 * desplegable de repeticiones; lo que queda es lo que el jugador tendría que LEER.
 */
function readingText(h: string): string {
  return h
    .replace(/<svg[\s\S]*?<\/svg>/g, "")
    .replace(/<h[12][^>]*>[\s\S]*?<\/h[12]>/g, "")
    .replace(/<a [\s\S]*?<\/a>/g, "")
    .replace(/<button[\s\S]*?<\/button>/g, "")
    .replace(/<details[\s\S]*?<\/details>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ═══════════ (a) /jugar: exactamente tres áreas ═══════════ */

test("F71 A1 · /jugar pinta EXACTAMENTE tres áreas, en orden RTC → DUELS → COACH", () => {
  const h = jugar();
  const ids = [...h.matchAll(/data-testid="play-area-(RTC|DUELS|COACH)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ["RTC", "DUELS", "COACH"]);
  assert.ok(!/data-testid="duel-mode-/.test(h), "los modos de duelo no se repiten en /jugar");
  assert.ok(!/daily-pve|Desafíos del día|play-hub-coach/.test(h), "sin bloque de desafíos ni franja de coach");
});

test("F71 A2 · destinos: campaña → mapa, Duelos → /duelos, Coach → /entrenador", () => {
  const h = jugar();
  assert.deepEqual(ctaOf(h, "play-area-cta-RTC"), { href: CAMPAIGN_ROUTE, label: "Jugar" });
  assert.deepEqual(ctaOf(h, "play-area-cta-DUELS"), { href: "/duelos", label: "Jugar" });
  assert.deepEqual(ctaOf(h, "play-area-cta-COACH"), { href: "/entrenador", label: "Entrar" });
});

test("F71 A3 · la campaña enseña su progreso compacto (7/15) y conserva el CTA de retomar", () => {
  assert.match(jugar(), /data-testid="mode-note"[^>]*>7\/15</);
  const h = jugar({ ...FACTS, activePve: true });
  assert.deepEqual(ctaOf(h, "play-area-cta-RTC"), { href: "/duelos/jugar", label: "Retomar partida" });
  assert.match(h, /data-testid="play-hub-resume"/);
});

test("F71 A4 · sin sesión / sin equipo, la campaña dice su estado corto y enruta como `gameModes()`", () => {
  const out = jugar({ ...FACTS, signedIn: false, hasValidDeck: null, campaign: null, draft: null }, null);
  assert.match(out, /data-testid="mode-note"[^>]*>INICIA SESIÓN</);
  assert.equal(ctaOf(out, "play-area-cta-RTC").href, CAMPAIGN_ROUTE);
  const noTeam = jugar({ ...FACTS, hasValidDeck: false });
  assert.deepEqual(ctaOf(noTeam, "play-area-cta-RTC"), { href: "/duelos/mazos", label: "Completar equipo" });
  assert.equal(campaignAreaCta(gameModes(FACTS)[0]).label, "Jugar");
});

/* ═══════════ (b) /duelos: cuatro modos ═══════════ */

test("F72 B1 · /duelos: CUATRO modos seleccionables; solo el elegido (por defecto PARTIDA RÁPIDA) enseña su CTA grande", () => {
  const h = duelos();
  const ids = [...h.matchAll(/data-testid="duel-mode-(QUICK|RANKED|FRIEND|DRAFT_GAUNTLET)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ["QUICK", "RANKED", "FRIEND", "DRAFT_GAUNTLET"]);
  for (const id of ids) assert.match(h, new RegExp(`aria-pressed="(true|false)"[^>]*data-testid="duel-mode-select-${id}"`));
  assert.equal((h.match(/data-selected="true"/g) ?? []).length, 1);
  assert.match(h, /data-testid="duel-mode-QUICK"[^>]*data-selected="true"|data-selected="true"[^>]*data-testid="duel-mode-QUICK"/);
  assert.equal((h.match(/data-testid="duel-mode-cta-/g) ?? []).length, 1, "un solo CTA: el del modo elegido");
  assert.deepEqual(ctaOf(h, "duel-mode-cta-QUICK"), { href: "/duelos/jugar", label: "Jugar" });
  assert.equal((h.match(/data-cta="primary"/g) ?? []).length, 1);
});

test("F72 B2 · el CTA de cada modo elegido: JUGAR (rápida) · JUGAR a la cola ranked · RETAR · ENTRAR · 2.000", () => {
  assert.deepEqual(ctaOf(duelos(FACTS, { requested: "QUICK" }), "duel-mode-cta-QUICK"), { href: "/duelos/jugar", label: "Jugar" });
  const r = duelos(FACTS, { requested: "ranked", rankedGate: READY_GATE, ranked: { state: "UNRANKED", position: null, rating: 1000, placementPlayed: 0, placementTotal: 10, first: false } });
  assert.deepEqual(ctaOf(r, "duel-mode-cta-RANKED"), { href: "/duelos/pvp?buscar=d1", label: "Jugar" }, "cola ranked directa, sin /competitivo");
  assert.equal(ctaOf(r, "duel-ranked-details").href, "/competitivo", "detalle secundario");
  assert.deepEqual(ctaOf(duelos(FACTS, { requested: "FRIEND" }), "duel-mode-cta-FRIEND"), { href: "/social", label: "Retar" });
  const d = duelos(FACTS, { requested: "DRAFT_GAUNTLET" });
  assert.match(d, /<button[^>]*data-testid="duel-mode-cta-DRAFT_GAUNTLET"[^>]*>Entrar · 2\.000<\/button>/);
  assert.match(d, /data-field="entry-fee"[^>]*>2\.000</);
  assert.equal((d.match(/<li [^>]*data-wins=/g) ?? []).length, 6, "escalera 0–5 victorias");
});

test("F72 B3 · rango REAL inline (sin clasificar · #puesto) y la run de draft (progreso y CONTINUAR)", () => {
  const un = duelos(FACTS, { requested: "RANKED", rankedGate: READY_GATE, ranked: { state: "UNRANKED", position: null, rating: 1000, placementPlayed: 0, placementTotal: 10, first: false } });
  assert.match(un, /data-field="rank"[^>]*>Sin clasificar</);
  assert.match(un, /data-field="rating"[^>]*>Rating 1000</);
  const top = duelos(FACTS, { requested: "RANKED", rankedGate: READY_GATE, ranked: { state: "RANKED", position: 12, rating: 1184, placementPlayed: 10, placementTotal: 10, first: false } });
  assert.match(top, /data-field="rank"[^>]*>#12</);
  assert.match(top, /data-field="rating"[^>]*>Rating 1184</);
  assert.match(duelos(FACTS, { requested: "RANKED", ranked: "loading" }), /data-testid="duel-ranked-inline"[^>]*data-state="loading"/);
  const ready = duelos({ ...FACTS, draft: { available: true, status: "READY", pick: 10, stage: 2, lastStatus: null, wins: 1, entryPending: false } }, { requested: "DRAFT_GAUNTLET" });
  assert.match(ready, />1\/5 victorias</);
  assert.deepEqual(ctaOf(ready, "duel-mode-cta-DRAFT_GAUNTLET"), { href: DRAFT_ROUTE, label: "Continuar" });
  assert.ok(!/Entrar ·/.test(ready), "run activa: nunca otra entrada");
  const inMatch = duelos({ ...FACTS, draft: { available: true, status: "IN_MATCH", pick: 10, stage: 3, lastStatus: null, wins: 2, entryPending: false } }, { requested: "DRAFT_GAUNTLET" });
  assert.deepEqual(ctaOf(inMatch, "duel-mode-cta-DRAFT_GAUNTLET"), { href: DRAFT_MATCH_HREF, label: "Continuar" });
  const drafting = duelos({ ...FACTS, draft: { available: true, status: "DRAFTING", pick: 3, stage: 1, lastStatus: null, wins: 0, entryPending: false } }, { requested: "DRAFT_GAUNTLET" });
  assert.match(drafting, />Draft 3\/10</);
  const pending = duelos({ ...FACTS, draft: { available: true, status: "DRAFTING", pick: 0, stage: 1, lastStatus: null, wins: 0, entryPending: true } }, { requested: "DRAFT_GAUNTLET" });
  assert.match(pending, />Entrar · 2\.000</, "entrada sin cobrar: se completa entrando (una sola vez)");
  assert.equal(duelModeNote(gameModes(FACTS).find((c) => c.id === "RANKED")!, { rating: 1000, position: null, provisional: true }), "1000 · Provisional");
});

test("F72 B4 · partida abierta, sin equipo, sin saldo y sin sesión", () => {
  const open = duelos({ ...FACTS, activePve: true });
  assert.deepEqual(ctaOf(open, "duel-mode-cta-QUICK"), { href: "/duelos/jugar", label: "Retomar" });
  const pvp = duelos({ ...FACTS, activePvp: true });
  assert.match(pvp, /data-testid="duel-mode-RANKED"[^>]*data-selected="true"|data-selected="true"[^>]*data-testid="duel-mode-RANKED"/, "abre el modo con partida");
  assert.equal(ctaOf(pvp, "duel-mode-cta-RANKED").href, "/duelos/pvp");
  assert.deepEqual(ctaOf(duelos({ ...FACTS, hasValidDeck: false }, { requested: "FRIEND" }), "duel-mode-cta-FRIEND"), { href: "/duelos/mazos", label: "Completar equipo" });
  assert.match(duelos({ ...FACTS, hasValidDeck: false }, { requested: "DRAFT_GAUNTLET" }), />Entrar · 2\.000</, "el draft no usa tu equipo");
  const poor = duelos(FACTS, { requested: "DRAFT_GAUNTLET", credits: 1_500 });
  assert.match(poor, /<button[^>]*disabled=""[^>]*data-testid="duel-mode-cta-DRAFT_GAUNTLET"|<button[^>]*data-testid="duel-mode-cta-DRAFT_GAUNTLET"[^>]*disabled=""/);
  assert.match(poor, />Te faltan 500 créditos</);
  for (const id of ["QUICK", "RANKED", "FRIEND", "DRAFT_GAUNTLET"]) {
    const out = duelos({ ...FACTS, signedIn: false, hasValidDeck: null, draft: null }, { requested: id, draftEconomy: null });
    assert.equal(ctaOf(out, `duel-mode-cta-${id}`).href, "/cuenta", id);
  }
  for (const c of duelModes(gameModes({ ...FACTS, signedIn: false }))) assert.deepEqual(duelModeCta(c), { label: "Inicia sesión", href: "/cuenta" });
});

test("F71 B5 · lo secundario sigue a mano: volver a /jugar, Mis equipos y repeticiones", () => {
  const h = renderToStaticMarkup(<DuelModesHub cards={gameModes(FACTS)} replays={[{ matchId: "m1", status: "WON", scoreYou: 6, scoreRival: 4, deckName: "Alfa" }]} />);
  assert.equal(ctaOf(h, "duels-back").href, "/jugar");
  assert.equal(ctaOf(h, "duels-decks").href, "/duelos/mazos");
  assert.match(h, /data-testid="duel-replays"/);
  assert.match(h, /href="\/duelos\/replay\/m1"/);
  assert.ok(!/duel-replays/.test(duelos()), "sin repeticiones no hay desplegable vacío");
});

/* ═══════════ (c) enlaces profundos ═══════════ */

test("F71 C1 · los enlaces profundos siguen siendo páginas", () => {
  for (const p of ["duelos/jugar", "duelos/pvp", "duelos/competitivo", "competitivo", "social", "jugar/road-to-champions", "jugar/draft-gauntlet", "entrenador", "duelos/mazos", "duelos/replay/[matchId]", "jugar", "duelos"]) {
    assert.ok(existsSync(join(ROOT, "src", "app", ...p.split("/"), "page.tsx")), p);
  }
});

test("F72 C2 · /jugar lee solo campaña y meta; /duelos lee meta, draft y repeticiones (competitivo al elegirlo) y SOLO escribe la entrada del draft", () => {
  const j = read("src/app/jugar/page.tsx");
  assert.ok(j.includes("fetchCampaign()") && j.includes("fetchMetaSnapshot()") && !j.includes("fetchDraft()"));
  assert.match(j, /<Loading kind="hub"/);
  const d = read("src/app/duelos/page.tsx");
  assert.ok(d.includes("fetchMetaSnapshot()") && d.includes("fetchDraft()") && d.includes("fetchDuelReplays()"));
  assert.match(d, /<Loading kind="hub"/);
  assert.ok(!/method: "POST"|startDraft|startCampaignNode|router\.push/.test(j));
  assert.ok(!/method: "POST"|startCampaignNode|startDraftMatch|pickDraft|abandonDraft/.test(d));
  assert.equal((d.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").match(/startDraft\(\)/g) ?? []).length, 2, "entrar (y, si otra pestaña la dejó sin cobrar, completarla)");
  assert.ok(d.indexOf("const loadRanked") < d.indexOf("fetchCompetitive()"), "el competitivo se lee al elegirlo");
  assert.match(d, /router\.push\(DRAFT_ROUTE\)/);
});

/* ═══════════ (d) sin muro de texto ═══════════ */

test("F71 D1 · presupuesto de texto: fuera de títulos y botones, < 80 caracteres por pantalla y ningún <p> > 32", () => {
  const cases = [
    jugar(), jugar({ ...FACTS, activePve: true }), jugar({ ...FACTS, signedIn: false, hasValidDeck: null, campaign: null, draft: null }, null),
    duelos(), duelos({ ...FACTS, hasValidDeck: false, rankedProvisional: true }),
    duelos(FACTS, { requested: "RANKED", rankedGate: READY_GATE, ranked: { state: "RANKED", position: 12, rating: 1184, placementPlayed: 10, placementTotal: 10, first: false } }),
    duelos(FACTS, { requested: "DRAFT_GAUNTLET" }),
  ];
  for (const h of cases) {
    const t = readingText(h);
    // F72 · el Draft elegido enseña entrada + escalera de 6 premios (números) + una línea del gran premio.
    const budget = /data-testid="duel-draft-entry"/.test(h) ? 120 : 80;
    assert.ok(t.length < budget, `demasiado texto (${t.length}): «${t}»`);
    for (const m of h.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)) {
      const p = m[1].replace(/<[^>]+>/g, "").trim();
      assert.ok(p.length <= 40, `párrafo largo: «${p}»`);
    }
  }
});

/* ═══════════ (e) móvil: una columna ═══════════ */

test("F71 E1 · en la base los paneles son UNA columna; varias solo desde lg:", () => {
  const grid = (h: string, id: string) => h.match(new RegExp(`<section[^>]*data-testid="${id}"[^>]*class="([^"]+)"|<section[^>]*class="([^"]+)"[^>]*data-testid="${id}"`));
  for (const [h, id, cols] of [[jugar(), "play-areas", "lg:grid-cols-3"], [duelos(), "duel-modes", "lg:grid-cols-5"]] as const) {
    const m = grid(h, id);
    assert.ok(m, id);
    const cls = (m![1] ?? m![2]).split(/\s+/);
    assert.ok(cls.includes("grid-cols-1"), `${id}: una columna en la base`);
    assert.ok(cls.includes(cols), `${id}: ${cols}`);
    assert.ok(!cls.some((c) => /^(sm:|md:)?grid-cols-[2-9]$/.test(c)), `${id}: nada de varias columnas por debajo de lg`);
  }
});

test("F71 E2 · los paneles son altos y visuales (arte a sangre, imágenes diferidas salvo la primera)", () => {
  const h = jugar();
  assert.equal((h.match(/class="nx-mode /g) ?? []).length, 3);
  const imgs = [...h.matchAll(/<img [^>]*>/g)].map((m) => m[0]);
  assert.ok(imgs.length >= 3);
  assert.ok(imgs.every((i) => /alt=""/.test(i)), "arte decorativo");
  assert.equal(imgs.filter((i) => /loading="eager"/.test(i)).length, 1, "solo el primer panel carga sin diferir");
  assert.ok(!imgs.some((i) => /stage-1920/.test(i)), "sin la imagen de 1920 en un panel de un tercio");
});

test("F71 J-RESUME · una partida PvE abierta no se atribuye a un modo que no se puede saber (RtC vs rápida)", () => {
  const h = jugar({ ...FACTS, activePve: true });
  const banner = h.match(/<section[^>]*data-testid="play-hub-resume"[\s\S]*?<\/section>/)?.[0] ?? "";
  assert.ok(banner, "hay banner de partida en curso");
  assert.match(banner, />Continuar partida</);
  assert.ok(!/Road to Champions/i.test(banner), "el banner no afirma que sea Road to Champions");
  assert.equal(ctaOf(h, "play-hub-resume-cta").href, "/duelos/jugar");
});
