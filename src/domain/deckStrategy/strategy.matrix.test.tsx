/**
 * FASE 43 · MATRIZ OBLIGATORIA (S001–S100) — Card Mastery & Deck Strategy 3.0.
 *
 * Estadísticas canónicas intactas, legalidad por el validador canónico, análisis exacto, percentiles del catálogo,
 * orientación y balance, roles, aportación, cambios, comparador, sugerencias, autocompletar, guardado y concurrencia,
 * cero escrituras, información oculta en PvE/PvP/privado, campaña y Draft intactos, resumen de partida exacto (con el
 * motor real), repetición sin volver a jugar, seguridad y regresiones.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { CARDS, getPlayer } from "@/data/catalog";
import { CARD_MANIFEST } from "@/data/cardCatalog";
import { COMBAT_STAT_ORDER } from "@/domain/cards/combat";
import { DUEL_COMPOSITION, DUEL_DECK_SIZE, DUEL_ROLES } from "@/domain/cardgame/types";
import { COMBAT_RULES_V2, CURRENT_COMBAT_RULES } from "@/domain/cardgame/combat/rules";
import { ORCHESTRATOR_VERSION, TURNS_PER_MATCH } from "@/domain/cardgame/match/types";
import { DIFFICULTY_PROFILE } from "@/domain/cardgame/opponent/bots";
import { projectMatchFor } from "@/domain/cardgame/pvp";
import { autocomplete, checkDraft, indexPool, tryReplace, type BuilderCard } from "@/domain/deckBuilder/builder";
import { parseDeckRequest } from "@/domain/deckBuilder/request";
import { GLOBAL_MARKET_ENABLED } from "@/config/features";
import { builderCardOf, catalogCards, strategyContext, syntheticCollection } from "@/lib/deckStrategy/catalog";
import { qaFindMatch, qaReplay, qaSimulate, qaSnapshot, qaRegistry, qaView } from "@/lib/duel/qaSimulation";
import { buildMatchView } from "@/lib/duel/matchView";
import { MemSupabase } from "@/server/services/testing/memSupabase";
import { createTeam, getDeckWorkspace } from "@/server/services/deckTeams";
import { PreMatch } from "@/components/duel/PreMatch";
import { ReplayViewer } from "@/components/duel/ReplayViewer";
import { MatchStrategyPanel } from "@/components/duel/strategy/MatchStrategyPanel";
import {
  AXES, METRICS, analyzeDeck, compareDecks, informativeImpact, orientationOf, percentileRank, suggestDeck, summarize,
  summarizeMatch, swapAlternatives, swapImpact, totalsOf, balanceText, type Axis, type StrategyCard, type TurnFact, type ResultFact,
} from "./index";

const ctx = strategyContext();
const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
let n = 0;
const S = (label: string, fn: () => void | Promise<void>) => { n++; test(`S${String(n).padStart(3, "0")} · ${label}`, fn); };
const quiet = async <T,>(fn: () => Promise<T>) => { const e = console.error; const w = console.warn; console.error = () => {}; console.warn = () => {}; try { return await fn(); } finally { console.error = e; console.warn = w; } };

// 500 instancias de 250 definiciones distintas: con el catálogo diseñado (329) deja cartas SIN poseer, como antes
// dejaban 500 de 772 (casos «carta no poseída»).
const COLL = syntheticCollection(500, 4343, 250);
const POOL = indexPool(COLL);
const DECK = suggestDeck(POOL, "BALANCED", ctx).uids;
const cardsOf = (uids: string[], pool = POOL) => uids.map((u) => pool.get(u)!);
const deckCards = cardsOf(DECK);
const A = analyzeDeck(deckCards, ctx);
const byRole = (role: string) => DECK.filter((u) => POOL.get(u)!.role === role);
const allDefs = catalogCards();

/* ───────── 1–5 · estadísticas canónicas ───────── */

S("OVR canónico: el de la definición del catálogo, sin recalcular", () => {
  for (const c of COLL.slice(0, 200)) assert.equal(c.ovr, CARDS.find((d) => d.id === c.cardId)!.ovr);
  assert.equal(A.metrics.ovr.mean, deckCards.reduce((s, c) => s + c.ovr, 0) / 10);
});
for (const ax of AXES) {
  S(`${ax} canónico: el trío congelado del catálogo`, () => {
    for (const c of COLL.slice(0, 200)) assert.equal(c.combat[ax], CARDS.find((d) => d.id === c.cardId)!.combat![ax]);
  });
}
S("sin estadística nueva: tres ejes + OVR, nada más", () => {
  assert.deepEqual([...COMBAT_STAT_ORDER], ["stronghold", "gamesense", "entryfrag"]);
  assert.deepEqual([...METRICS], ["ovr", "stronghold", "gamesense", "entryfrag"]);
  assert.deepEqual(Object.keys(deckCards[0].combat).sort(), ["entryfrag", "gamesense", "stronghold"]);
  for (const f of readdirSync(join(ROOT, "src/domain/deckStrategy")).filter((x) => x.endsWith(".ts") && !x.includes(".test."))) {
    assert.ok(!/combat\.(?!stronghold|gamesense|entryfrag)[a-z]+/.test(code(read(`src/domain/deckStrategy/${f}`))), f);
  }
});

/* ───────── 6–15 · legalidad (validador canónico) ───────── */

S("equipo legal de 10", () => { assert.equal(DECK.length, DUEL_DECK_SIZE); assert.ok(checkDraft(DECK, POOL).ready); });
for (const role of DUEL_ROLES) {
  S(`exactamente 2 × ${role}`, () => {
    assert.equal(byRole(role).length, DUEL_COMPOSITION[role]);
    const other = DUEL_ROLES.find((r) => r !== role)!;
    const third = COLL.find((c) => c.role === role && !DECK.includes(c.uid) && !deckCards.some((d) => d.playerId === c.playerId))!;
    const broken = [...DECK.filter((u) => u !== byRole(other)[0]), third.uid];
    assert.equal(checkDraft(broken, POOL).ready, false);
  });
}
S("carta repetida inválida", () => {
  const v = checkDraft([...DECK.slice(0, 9), DECK[0]], POOL);
  assert.ok(!v.ready && v.validation.errors.some((e) => e.code === "DUPLICATE_CARD"));
});
S("jugador repetido (otra variante) inválido", () => {
  const twin = allDefs.find((d) => d.playerId === deckCards[0].playerId && d.cardId !== deckCards[0].cardId);
  const extra = twin ? builderCardOf(twin.cardId, 990_001) : { ...deckCards[0], uid: "00000000-0000-4000-8043-000000990001" };
  const pool = indexPool([...COLL, extra]);
  const v = checkDraft([...DECK.filter((u) => u !== byRole(deckCards[0].role)[1]), extra.uid], pool);
  assert.ok(!v.ready && v.validation.errors.some((e) => e.code === "DUPLICATE_PLAYER" || e.code === "DUPLICATE_CARD"));
});
S("temporada mezclada (otra dataVersion) inválida", () => {
  const alien = { ...POOL.get(DECK[9])!, uid: "00000000-0000-4000-8043-000000990002", dataVersion: "VCT-2025" };
  const pool = indexPool([...COLL, alien]);
  const v = checkDraft([...DECK.slice(0, 9), alien.uid], pool);
  assert.ok(!v.ready && v.validation.errors.some((e) => e.code === "INCOMPATIBLE_DATA_VERSION"));
});
S("carta ajena (no está en la colección) inválida", () => {
  const v = checkDraft([...DECK.slice(0, 9), "ffffffff-0000-4000-8000-000000000001"], POOL);
  assert.ok(!v.ready && v.lostUids.length === 1);
});

/* ───────── 16–25 · agregados y percentiles ───────── */

const exactMean = (f: (c: BuilderCard) => number) => deckCards.reduce((s, c) => s + f(c), 0) / 10;
S("media de OVR exacta", () => { assert.equal(A.metrics.ovr.mean, exactMean((c) => c.ovr)); });
S("media de Stronghold exacta", () => { assert.equal(A.metrics.stronghold.mean, exactMean((c) => c.combat.stronghold)); });
S("media de Gamesense exacta", () => { assert.equal(A.metrics.gamesense.mean, exactMean((c) => c.combat.gamesense)); });
S("media de Entryfrag exacta", () => { assert.equal(A.metrics.entryfrag.mean, exactMean((c) => c.combat.entryfrag)); });
S("mediana exacta", () => { const s = deckCards.map((c) => c.ovr).sort((a, b) => a - b); assert.equal(A.metrics.ovr.median, (s[4] + s[5]) / 2); });
S("mínimo exacto", () => { assert.equal(A.metrics.entryfrag.min, Math.min(...deckCards.map((c) => c.combat.entryfrag))); });
S("máximo exacto", () => { assert.equal(A.metrics.gamesense.max, Math.max(...deckCards.map((c) => c.combat.gamesense))); });
S("dispersión exacta (desviación poblacional)", () => { const xs = deckCards.map((c) => c.combat.stronghold); const m = xs.reduce((a, b) => a + b, 0) / 10; assert.ok(Math.abs(A.metrics.stronghold.sd - Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / 10)) < 1e-12); });
S("percentil determinista", () => { assert.deepEqual(analyzeDeck(deckCards, ctx).catalogPercentile, A.catalogPercentile); assert.deepEqual(analyzeDeck(deckCards, ctx).deckPercentile, A.deckPercentile); assert.equal(percentileRank([1, 2, 3], 2), percentileRank([1, 2, 3], 2)); });
S("percentil derivado del catálogo (no fijado a mano)", () => {
  const c = A.contributions[0];
  const vals = allDefs.map((d) => d.ovr);
  assert.equal(c.catalogPercentile.ovr, (100 * (vals.filter((v) => v < c.values.ovr).length + vals.filter((v) => v === c.values.ovr).length / 2)) / vals.length);
  assert.ok(!/(?:>=|>|<=|<)\s*80\b/.test(code(read("src/domain/deckStrategy/analysis.ts"))), "sin «80 = bueno»");
});

/* ───────── 26–32 · orientación y balance ───────── */

const forced = (ax: Axis) => analyzeDeck(deckCards.map((c) => ({ ...c, combat: { ...c.combat, [ax]: 99 } })), ctx).orientation!;
S("orientación Stronghold", () => { const o = forced("stronghold"); assert.deepEqual([o.kind, o.axes[0]], ["ORIENTED", "stronghold"]); });
S("orientación Gamesense", () => { const o = forced("gamesense"); assert.deepEqual([o.kind, o.axes[0]], ["ORIENTED", "gamesense"]); });
S("orientación Entryfrag", () => { const o = forced("entryfrag"); assert.deepEqual([o.kind, o.axes[0]], ["ORIENTED", "entryfrag"]); });
S("orientación equilibrada", () => { assert.equal(orientationOf({ stronghold: 0.2, gamesense: 0, entryfrag: 0.1 }).kind, "BALANCED"); });
S("perfil mixto", () => { assert.equal(orientationOf({ stronghold: 0.9, gamesense: 0.5, entryfrag: -0.3 }).kind, "MIXED"); });
S("orientación independiente del orden de las cartas", () => { assert.deepEqual(analyzeDeck([...deckCards].reverse(), ctx).orientation, A.orientation); });
S("balance determinista y descriptivo", () => { assert.equal(balanceText(A.orientation!), balanceText(analyzeDeck(deckCards, ctx).orientation!)); assert.ok(!/%|sinergia/.test(balanceText(A.orientation!))); });

/* ───────── 33–37 · roles ───────── */

for (const role of DUEL_ROLES) {
  S(`análisis de rol · ${role}`, () => {
    const r = A.roles.find((x) => x.role === role)!;
    const two = cardsOf(byRole(role));
    assert.equal(r.count, 2);
    assert.equal(r.mean.gamesense, (two[0].combat.gamesense + two[1].combat.gamesense) / 2);
    assert.equal(r.ovrGap, Math.abs(two[0].ovr - two[1].ovr));
    assert.ok(r.mainAxis && AXES.includes(r.mainAxis));
  });
}

/* ───────── 38–43 · aportación ───────── */

const contrib = A.contributions[3];
const contribCard = POOL.get(contrib.uid)!;
S("aportación · OVR frente a la media", () => { assert.equal(contrib.vsDeck.ovr, contribCard.ovr - A.metrics.ovr.mean); });
S("aportación · Stronghold", () => { assert.equal(contrib.vsDeck.stronghold, contribCard.combat.stronghold - A.metrics.stronghold.mean); });
S("aportación · Gamesense", () => { assert.equal(contrib.vsDeck.gamesense, contribCard.combat.gamesense - A.metrics.gamesense.mean); });
S("aportación · Entryfrag", () => { assert.equal(contrib.vsDeck.entryfrag, contribCard.combat.entryfrag - A.metrics.entryfrag.mean); });
S("comparación con el compañero de rol", () => { const p = POOL.get(contrib.partnerUid!)!; assert.equal(p.role, contribCard.role); assert.equal(contrib.vsPartner!.ovr, contribCard.ovr - p.ovr); });
S("percentil de catálogo por carta en [0,100]", () => { for (const c of A.contributions) for (const m of METRICS) assert.ok(c.catalogPercentile[m] >= 0 && c.catalogPercentile[m] <= 100); });

/* ───────── 44–55 · cambios ───────── */

const slot = byRole("Controlador")[0];
const alts = swapAlternatives(DECK, slot, POOL, ctx);
const alt = alts[0];
S("cambio legal (validador canónico)", () => { assert.ok(alts.length > 0 && alts.every((a) => checkDraft(a.nextUids, POOL).ready)); });
S("cambio de rol ilegal rechazado", () => { const other = COLL.find((c) => c.role !== "Controlador" && !DECK.includes(c.uid))!; const r = tryReplace(DECK, slot, other.uid, POOL); assert.ok(!r.ok && r.code === "WRONG_ROLE"); });
S("cambio que duplica jugador rechazado", () => {
  const partner = byRole("Controlador")[1];
  const clone = { ...POOL.get(partner)!, uid: "00000000-0000-4000-8043-000000990003" };
  const pool = indexPool([...COLL, clone]);
  const r = tryReplace(DECK, slot, clone.uid, pool);
  assert.ok(!r.ok && r.code === "DUPLICATE_PLAYER");
});
S("carta ajena nunca accionable", () => { const r = tryReplace(DECK, slot, "ffffffff-0000-4000-8000-000000000009", POOL); assert.ok(!r.ok && r.code === "NOT_OWNED"); });
S("carta no poseída: comparación informativa sin acción", () => {
  const def = allDefs.find((d) => d.role === "Controlador" && !COLL.some((c) => c.cardId === d.cardId))!;
  const imp = informativeImpact(deckCards, slot, { ...def, uid: "x", nick: "x" }, ctx);
  assert.equal(imp.actionable, false); assert.ok(!("nextUids" in imp));
  assert.ok(!alts.some((a) => a.card.cardId === def.cardId));
});
const cur = POOL.get(slot)!;
S("delta de OVR exacto", () => { assert.ok(Math.abs(alt.impact.delta.ovr - (alt.card.ovr - cur.ovr) / 10) < 1e-12); });
S("delta de Stronghold exacto", () => { assert.ok(Math.abs(alt.impact.delta.stronghold - (alt.card.combat.stronghold - cur.combat.stronghold) / 10) < 1e-12); });
S("delta de Gamesense exacto", () => { assert.ok(Math.abs(alt.impact.delta.gamesense - (alt.card.combat.gamesense - cur.combat.gamesense) / 10) < 1e-12); });
S("delta de Entryfrag exacto", () => { assert.ok(Math.abs(alt.impact.delta.entryfrag - (alt.card.combat.entryfrag - cur.combat.entryfrag) / 10) < 1e-12); });
S("impacto en la identidad", () => { const after = analyzeDeck(cardsOf(alt.nextUids), ctx).orientation!.label; assert.equal(alt.impact.orientationAfter!.label, after); assert.equal(alt.impact.identityChanged, after !== A.orientation!.label); });
S("impacto en el balance", () => { assert.equal(alt.impact.spreadBefore, A.orientation!.spreadSd); assert.equal(alt.impact.spreadAfter, analyzeDeck(cardsOf(alt.nextUids), ctx).orientation!.spreadSd); });
S("vista previa sin escrituras: pura, sin red y sin guardar", () => {
  for (const f of ["src/domain/deckStrategy/swap.ts", "src/components/duel/strategy/CardFocusSection.tsx", "src/components/duel/strategy/StrategyImpact.tsx"]) assert.ok(!/fetch\(|supabase|onSave|saveTeamDeck|saveDuelDeck/.test(code(read(f))), f);
  const before = JSON.stringify([...POOL.values()]);
  swapImpact(deckCards, slot, alt.card, ctx);
  assert.equal(JSON.stringify([...POOL.values()]), before);
});

/* ───────── 56–57 · comparador ───────── */

const OTHER = suggestDeck(POOL, "entryfrag", ctx).uids;
S("comparación de dos equipos: diferencias exactas", () => { const c = compareDecks("A", deckCards, "B", cardsOf(OTHER), ctx); for (const r of c.rows) assert.equal(r.diff, r.a - r.b); });
S("sin ganador en la comparación", () => { const c = compareDecks("A", deckCards, "B", cardsOf(OTHER), ctx); assert.ok(!("winner" in c)); assert.ok(c.summary.every((t) => !/mejor|gana|supera/i.test(t))); });

/* ───────── 58–69 · sugerencias ───────── */

const SUG = { BALANCED: suggestDeck(POOL, "BALANCED", ctx), stronghold: suggestDeck(POOL, "stronghold", ctx), gamesense: suggestDeck(POOL, "gamesense", ctx), entryfrag: suggestDeck(POOL, "entryfrag", ctx) };
S("sugerencia Equilibrado: menos distancia entre ejes que las de un eje", () => { for (const ax of AXES) assert.ok(analyzeDeck(SUG.BALANCED.cards, ctx).orientation!.spreadSd <= analyzeDeck(SUG[ax].cards, ctx).orientation!.spreadSd + 1e-9); });
for (const ax of AXES) S(`sugerencia ${ax}: máxima suma del eje entre las sugerencias`, () => { for (const s of Object.values(SUG)) assert.ok(SUG[ax].totals![ax] >= s.totals![ax]); });
S("sugerencias solo con cartas poseídas", () => { for (const s of Object.values(SUG)) assert.ok(s.uids.every((u) => POOL.has(u))); });
S("sugerencias legales", () => { for (const s of Object.values(SUG)) assert.ok(checkDraft(s.uids, POOL).ready); });
S("sugerencias deterministas", () => { for (const [o, s] of Object.entries(SUG)) assert.deepEqual(suggestDeck(POOL, o as never, ctx).uids, s.uids); });
const noisy = (patch: (c: BuilderCard, i: number) => Partial<BuilderCard>) => indexPool(COLL.map((c, i) => ({ ...c, ...patch(c, i) })));
S("sugerencia sin serial", () => { assert.deepEqual(suggestDeck(noisy((_c, i) => ({ serial: i % 2 ? 1 : 999 })), "gamesense", ctx).uids, SUG.gamesense.uids); });
S("sugerencia sin poder por rareza", () => { assert.deepEqual(suggestDeck(noisy(() => ({ variantId: "icon-series" as BuilderCard["variantId"], statBoost: 12 })), "BALANCED", ctx).uids, SUG.BALANCED.uids); });
S("sugerencia sin poder por equipo", () => { assert.deepEqual(suggestDeck(noisy((_c, i) => ({ team: `T${i % 3}` })), "stronghold", ctx).uids, SUG.stronghold.uids); });
S("sugerencia sin poder por región", () => { assert.deepEqual(suggestDeck(noisy(() => ({ region: "China" as BuilderCard["region"] })), "entryfrag", ctx).uids, SUG.entryfrag.uids); });
S("sugerencia sin poder por edición", () => { assert.deepEqual(suggestDeck(noisy((c) => ({ statBoost: 0, obtainedAt: c.obtainedAt + 99 })), "gamesense", ctx).uids, SUG.gamesense.uids); });

/* ───────── 70–73 · constructor ───────── */

S("autocompletar intacto: completa con la máxima suma de OVR legal", () => {
  const r = autocomplete([], POOL);
  assert.ok(r.ok && checkDraft(r.uids, POOL).ready);
  assert.ok(totalsOf(cardsOf(r.uids)).ovr >= totalsOf(SUG.BALANCED.cards).ovr);
  assert.ok(read("src/components/duel/deck/AnalysisPanel.tsx").includes("Autocompletar equipo"));
});
const USER = "aaaaaaaa-0000-4000-8000-000000004343";
function seededDb() {
  const d = new MemSupabase(); d.seedUser(USER);
  for (const c of COLL.slice(0, 120)) d.table("user_cards").push({ uid: c.uid, user_id: USER, card_id: c.cardId, serial: c.serial, origin: "pack", locked: false, obtained_at: new Date(c.obtainedAt).toISOString() });
  return d;
}
S("guardado canónico: el laboratorio no cambia el contrato (nombre + uids, validación en servidor)", async () => {
  const d = seededDb();
  const r = await quiet(() => createTeam(d.client, USER, { name: "Lab", cardUids: COLL.slice(0, 3).map((c) => c.uid) }));
  assert.ok(r.ok);
  const builder = read("src/components/duel/DeckBuilder.tsx");
  assert.ok(builder.includes("props.onSave({ name: nameCheck.name, cardUids: uids })"));
  assert.equal(parseDeckRequest({ action: "save", name: "x", cardUids: [], analysis: {} }).ok, false);
});
S("concurrencia por versión: el laboratorio conserva el guardado condicionado y el conflicto de pestañas", () => {
  // La prueba en ejecución vive en deckTeams.service.test («62 · versión antigua con otra composición ⇒ 409»,
  // «64 · dos pestañas…»), con un doble de Supabase que respeta el filtro de versión en UPDATE. Aquí: que la Fase 43
  // no lo ha tocado y que el constructor sigue tratando el 409 sin pisar el borrador.
  const svc = read("src/server/services/deckTeams.ts");
  assert.ok(svc.includes('.eq("id", input.id).eq("user_id", userId).eq("updated_at", input.expectedVersion)'));
  assert.ok(svc.includes('return fail(409, "CONFLICT", STALE_TEXT, { deck, unchanged: false });'));
  const tests = read("src/server/services/deckTeams.service.test.ts");
  assert.ok(tests.includes("62 · versión antigua con otra composición ⇒ 409") && tests.includes("64 · dos pestañas"));
  const builder = read("src/components/duel/DeckBuilder.tsx");
  assert.ok(builder.includes('if (out.kind === "conflict") { setConflict(out.current); return false; }'));
  assert.ok(builder.includes("Este equipo cambió en otra pestaña."));
});
S("equipo activo: flujo canónico (set_active) y el análisis no lo toca", () => {
  for (const f of ["src/components/duel/strategy/StrategyLabPanel.tsx", "src/components/duel/strategy/SuggestSection.tsx", "src/domain/deckStrategy/suggestion.ts"]) assert.ok(!/activate|set_active|duel_active_deck/.test(code(read(f))), f);
  assert.ok(read("src/domain/deckBuilder/request.ts").includes('set_active: { allowed: ["action", "id", "baseVersion"]'));
});

/* ───────── 74–77 · cero escrituras y pre-partida ───────── */

S("abrir el laboratorio: la foto de equipos es una lectura sin escrituras", async () => {
  const d = seededDb();
  const w = d.writes;
  const r = await quiet(() => getDeckWorkspace(d.client, USER));
  assert.ok(r.ok);
  analyzeDeck(r.data!.collection.slice(0, 10) as BuilderCard[], ctx);
  assert.equal(d.writes, w);
});
S("generar sugerencias: sin escrituras (cálculo local, sin ruta nueva)", async () => {
  const d = seededDb();
  const r = await quiet(() => getDeckWorkspace(d.client, USER));
  const w = d.writes;
  suggestDeck(indexPool(r.data!.collection as BuilderCard[]), "BALANCED", ctx);
  assert.equal(d.writes, w);
  assert.ok(!existsSync(join(ROOT, "src/app/api/game/strategy")) && !existsSync(join(ROOT, "src/app/api/game/deck-strategy")));
});
S("comparar equipos: sin escrituras", async () => {
  const d = seededDb();
  const r = await quiet(() => getDeckWorkspace(d.client, USER));
  const w = d.writes;
  compareDecks("A", deckCards, "B", cardsOf(OTHER), ctx);
  assert.equal(d.writes, w);
  assert.ok(!/fetch\(|supabase/.test(code(read("src/components/duel/strategy/DeckCompareView.tsx"))));
  assert.ok(r.ok);
});
S("pre-partida: análisis del propio equipo, sin datos del rival", () => {
  const dto = { id: "0000dec4-3000-4000-8000-000000000001", name: "Mío", cardUids: DECK, cards: deckCards, valid: true, status: "READY_FOR_DUEL" as const, roleCounts: { Duelista: 2, Iniciador: 2, Controlador: 2, Centinela: 2, Flex: 2 }, missingByRole: { Duelista: 0, Iniciador: 0, Controlador: 0, Centinela: 0, Flex: 0 }, errors: [], sumOvr: totalsOf(deckCards).ovr, updatedAt: 0 };
  const html = renderToStaticMarkup(<PreMatch decks={[dto]} deckId={dto.id} onDeck={() => {}} difficulty="NORMAL" onDifficulty={() => {}} onStart={() => {}} busy={false} error={null} />);
  assert.ok(html.includes('data-testid="prematch-strategy"'));
  assert.ok(!/rival.*(stronghold|gamesense|entryfrag)\s*\d/i.test(html.replace(/Del rival no se sabe nada[^<]*/g, "")));
  assert.ok(read("src/components/duel/strategy/PreMatchStrategy.tsx").includes("export function PreMatchStrategy({ cards, className }: { cards: DuelDeckCardDTO[]; className?: string })"));
});

/* ───────── 78–82 · información oculta, campaña y Draft ───────── */

function midMatch(turns: number, mode: "PVE" | "PVP" | "PVP_PRIVATE") {
  const a = qaSnapshot(0, "h-a", "A"); const b = qaSnapshot(1, "h-b", "B");
  const m = qaSimulate(a, b, turns, "A", 11);
  const view = mode === "PVE" ? buildMatchView(m, { side: "A", registry: qaRegistry, difficulty: "NORMAL" }) : buildMatchView(projectMatchFor(m, "A"), { side: "A", registry: qaRegistry, difficulty: "NORMAL", rivalLabel: "Rival" });
  // DUEL GAMEPLAY UX 2.0 · la carta comprometida y no revelada también es oculta: no puede aparecer en ninguna parte.
  const unplayed = b.cards.map((c) => c.uid).filter((u) => !m.usedB.includes(u));
  return { view, unplayed };
}
const leakFree = (mode: "PVE" | "PVP" | "PVP_PRIVATE") => {
  for (const t of [2, 5, 7]) {
    const { view, unplayed } = midMatch(t, mode);
    const s = summarizeMatch(view.history.map((h) => ({ ...h, attacker: h.attacker as "A" | "B" })) as unknown as TurnFact[], null);
    const json = JSON.stringify(view) + JSON.stringify(s);
    for (const u of unplayed) assert.ok(!json.includes(`"${u}"`), `${mode}: ${u}`);
  }
};
S("PvP: el rival oculto no se filtra (vista + lectura estratégica)", () => { leakFree("PVP"); });
S("privado: el rival oculto no se filtra", () => { leakFree("PVP_PRIVATE"); });
S("PvE: contrato respetado (solo cartas jugadas del bot; su mazo no se analiza antes)", () => {
  leakFree("PVE");
  assert.ok(!/snapshotB|rivalCards|opponent/i.test(code(read("src/components/duel/strategy/PreMatchStrategy.tsx"))));
});
S("campaña intacta: sus servicios no conocen la capa estratégica", () => {
  for (const f of ["src/server/services/campaign.ts", "src/domain/campaign/index.ts"].filter((x) => existsSync(join(ROOT, x)))) assert.ok(!/deckStrategy/.test(read(f)), f);
  assert.ok(read("src/server/services/duels.ts").includes("export async function startCampaignMatch("));
});
S("Draft intacto: sin análisis de equipo propio ni «Ajustar equipo»", () => {
  for (const f of ["src/domain/draft/rules.ts", "src/server/services/draftGauntlet.ts"].filter((x) => existsSync(join(ROOT, x)))) assert.ok(!/deckStrategy/.test(read(f)), f);
  assert.ok(read("src/components/duel/ResultScreen.tsx").includes('deckId={mode === "DRAFT_GAUNTLET" ? null : deckId}'));
});

/* ───────── 83–96 · resumen de partida ───────── */

const RIVAL: Record<Axis, Axis> = { stronghold: "entryfrag", gamesense: "gamesense", entryfrag: "stronghold" };
function hist(spec: [Axis, number, number][]): TurnFact[] {
  let y = 0; let r = 0;
  return spec.map(([stat, vy, vr], i) => { const outcome = vy > vr ? "A" : vr > vy ? "B" : "TIE"; if (outcome === "A") y++; else if (outcome === "B") r++; return { number: i + 1, attacker: i % 2 ? "B" : "A", outcome, scoreAfterYou: y, scoreAfterRival: r, you: { uid: `y${i}`, nick: `Y${i}`, stat, value: vy }, rival: { uid: `r${i}`, nick: `R${i}`, stat: RIVAL[stat], value: vr } } as TurnFact; });
}
const SPEC: [Axis, number, number][] = [["stronghold", 80, 70], ["stronghold", 60, 75], ["stronghold", 66, 66], ["gamesense", 70, 71], ["gamesense", 72, 60], ["entryfrag", 90, 50], ["entryfrag", 50, 90], ["entryfrag", 70, 69], ["gamesense", 55, 80], ["stronghold", 81, 80]];
const T = hist(SPEC);
const RES: ResultFact = { winner: "YOU", isDraw: false, scoreYou: 5, scoreRival: 4, tiedEncounters: 1, decidedBy: "SCORE", sumOvrYou: 810, sumOvrRival: 800, statTotalYou: 694, statTotalRival: 711 };
const SUM = summarizeMatch(T, RES);
const axis = (a: Axis) => SUM.axes.find((x) => x.axis === a)!;
S("Stronghold: victorias exactas", () => { assert.equal(axis("stronghold").wins, 2); });
S("Stronghold: derrotas exactas", () => { assert.equal(axis("stronghold").losses, 1); });
S("Stronghold: empates exactos", () => { assert.equal(axis("stronghold").ties, 1); });
S("resumen Gamesense exacto", () => { assert.deepEqual([axis("gamesense").timesCompared, axis("gamesense").wins, axis("gamesense").losses, axis("gamesense").pointDelta], [3, 1, 2, -1]); });
S("resumen Entryfrag exacto", () => { assert.deepEqual([axis("entryfrag").timesCompared, axis("entryfrag").wins, axis("entryfrag").losses, axis("entryfrag").ties], [3, 2, 1, 0]); });
S("rendimiento por carta exacto", () => { assert.deepEqual(SUM.cards.find((c) => c.uid === "y2"), { uid: "y2", nick: "Y2", turns: 1, wins: 0, losses: 0, ties: 1, stats: ["stronghold"], values: [66] }); });
S("turno igual = 0 puntos", () => { assert.equal(T[2].outcome, "TIE"); assert.equal(T[2].scoreAfterYou, T[1].scoreAfterYou); assert.equal(T[2].scoreAfterRival, T[1].scoreAfterRival); assert.ok(SUM.consistent); });
S("resolución por marcador exacta", () => { assert.equal(SUM.resolution!.decidedBy, "SCORE"); assert.match(SUM.resolution!.lines[0], /^Decidió el marcador: 5 turnos ganados contra 4/); });
const ENGINE_OVR = qaFindMatch((m) => m.result?.combat.decidedBy === "OVR_TIEBREAK", 1, 3000)!;
S("desempate final por suma de OVR exacto (motor real)", () => {
  const v = qaView(ENGINE_OVR);
  const s = summarizeMatch(v.history as unknown as TurnFact[], { ...v.result!, sumOvrYou: v.result!.sumOvrYou, sumOvrRival: v.result!.sumOvrRival });
  assert.ok(s.consistent);
  assert.equal(s.resolution!.tiebreakPointYou + s.resolution!.tiebreakPointRival, 1);
  assert.equal(s.wins + s.resolution!.tiebreakPointYou, v.result!.scoreYou);
});
function mirrorMatch(pred: (d: string, st: string) => boolean) {
  const a = qaSnapshot(0, "m-a", "A"); const b = qaSnapshot(0, "m-b", "B");
  for (let s = 1; s < 3000; s++) { const m = qaSimulate(a, b, 10, s % 2 ? "A" : "B", s); if (m.result && pred(m.result.combat.decidedBy, m.result.combat.status)) return m; }
  throw new Error("sin partida");
}
S("desempate por estadística total exacto (motor real, sin punto)", () => {
  const m = mirrorMatch((d) => d === "STAT_MARGIN");
  const v = qaView(m);
  const s = summarizeMatch(v.history as unknown as TurnFact[], v.result!);
  assert.ok(s.consistent);
  assert.deepEqual([s.resolution!.tiebreakPointYou, s.resolution!.tiebreakPointRival], [0, 0]);
  assert.ok(s.resolution!.lines[1].includes(`${v.result!.statTotalYou} contra ${v.result!.statTotalRival}. Este desempate no suma punto`));
});
S("empate exacto (motor real)", () => {
  const m = mirrorMatch((_d, st) => st === "DRAW");
  const v = qaView(m);
  const s = summarizeMatch(v.history as unknown as TurnFact[], v.result!);
  assert.ok(s.consistent && v.result!.isDraw);
  assert.match(s.resolution!.lines[0], /^Empate: turnos/);
});
S("la repetición deriva de los turnos persistidos", () => {
  const replay = qaReplay(qaFindMatch((m) => m.result?.winner === "A")!);
  const html = renderToStaticMarkup(<ReplayViewer replay={replay} onBack={() => {}} />);
  const s = summarizeMatch(replay.turns as unknown as TurnFact[], replay.result);
  assert.ok(html.includes('data-testid="match-strategy"'));
  assert.ok(html.includes(`${s.turns} turnos guardados · ${s.wins} ganados · ${s.losses} perdidos · ${s.ties} empatados`));
  assert.ok(read("src/server/services/duels.ts").includes("turns: view.history,"));
});
S("la repetición no vuelve a ejecutar el motor", () => {
  const svc = read("src/server/services/duels.ts");
  const replay = svc.slice(svc.indexOf("export async function getReplay"), svc.indexOf("export async function listReplays"));
  assert.ok(!/resolveCombat|confirmTurn|startDuelMatch|advanceBots/.test(replay));
  for (const f of ["src/components/duel/ReplayViewer.tsx", "src/components/duel/strategy/MatchStrategyPanel.tsx", "src/domain/deckStrategy/match.ts", "src/lib/deckStrategy/presentation.ts"]) assert.ok(!/resolveCombat|resolveEncounter|confirmTurn|qaSimulate|cardgame\/match"|cardgame\/combat"/.test(code(read(f))), f);
});
S("sin afirmaciones causales no demostradas", () => {
  const html = renderToStaticMarkup(<MatchStrategyPanel history={qaView(ENGINE_OVR).history} result={qaView(ENGINE_OVR).result} deckId="0000dec4-3000-4000-8000-000000000001" />);
  const text = html.replace(/<[^>]+>/g, " ");
  assert.ok(!/porque|por culpa|debido a|tu equipo era|deberías|mejor equipo/i.test(text));
  assert.ok(SUM.insights.every((t) => /^(Ganaste|Perdiste) \d+ de \d+ comparaciones de \w+\.$|turno|cartas ganaron/.test(t)));
});

/* ───────── 97–100 · seguridad y regresiones ───────── */

S("usuario arbitrario rechazado: el cuerpo no admite userId y la ruta usa la sesión", () => {
  assert.equal(parseDeckRequest({ action: "save", name: "x", cardUids: [], userId: "otro" }).ok, false);
  const route = read("src/app/api/game/duels/route.ts");
  assert.ok(route.includes("getSession(req)") && route.includes("session.userId") && !/searchParams\.get\("user/.test(route));
});
S("estadísticas falsas rechazadas en mutaciones (OVR, trío, rol, serial)", () => {
  for (const extra of [{ ovr: 99 }, { combat: { stronghold: 99 } }, { role: "Flex" }, { serial: 1 }, { stats: {} }]) {
    assert.equal(parseDeckRequest({ action: "save", name: "x", cardUids: [], ...extra }).ok, false, JSON.stringify(extra));
  }
  assert.ok(read("src/server/services/deckTeams.ts").includes("loadOwned(sb, userId)"));
});
S("Marketplace ausente", () => {
  assert.equal(GLOBAL_MARKET_ENABLED, false);
  for (const f of readdirSync(join(ROOT, "src/components/duel/strategy"))) assert.ok(!/mercado|market|vender|precio/i.test(code(read(`src/components/duel/strategy/${f}`))), f);
});
S("regresiones: motor, reglas, turnos, bots, roles y tamaño intactos", () => {
  assert.equal(ORCHESTRATOR_VERSION, "duel-turns-2");
  assert.equal(CURRENT_COMBAT_RULES.version, "duel-combat-2");
  assert.deepEqual([COMBAT_RULES_V2.encounterTie, COMBAT_RULES_V2.finalTiebreak, COMBAT_RULES_V2.terminal], ["NO_POINT", "STAT_MARGIN", "DRAW"]);
  assert.equal(TURNS_PER_MATCH, 10);
  assert.deepEqual([DIFFICULTY_PROFILE.EASY.heuristicRate, DIFFICULTY_PROFILE.NORMAL.heuristicRate, DIFFICULTY_PROFILE.HARD.heuristicRate], [0, 0.5, 0.85]);
  assert.deepEqual([...DUEL_ROLES].sort(), ["Centinela", "Controlador", "Duelista", "Flex", "Iniciador"]);
  assert.equal(DUEL_DECK_SIZE, 10);
  assert.ok(Object.values(DUEL_COMPOSITION).every((x) => x === 2));
  assert.equal(CARDS.length, CARD_MANIFEST.length);
  assert.ok(CARDS.every((c) => getPlayer(c.playerId)));
  assert.equal(summarize([1, 2, 3]).mean, 2);
});

test("la matriz tiene exactamente 100 casos", () => { assert.equal(n, 100); });
