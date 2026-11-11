/**
 * FASE 43 · INTERFAZ DE LA CAPA ESTRATÉGICA — presentación pura, render de cada pieza, integración en constructor,
 * pre-partida, resultado, PvP y repetición, ficha de colección, accesibilidad, movimiento reducido y rendimiento.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { CARDS, getPlayer } from "@/data/catalog";
import { qaSerializedCard } from "@/app/design-system/serialFixture";
import { PACKS } from "@/data/packs";
import { CardRegistry } from "@/collection";
import { getVariant } from "@/domain/cards/variants";
import { buildCollectionSnapshot, packsThatCanContain, playerVariants } from "@/domain/collection/room";
import { checkDraft, compareForSlot, indexPool, type BuilderCard } from "@/domain/deckBuilder/builder";
import { analyzeDeck, suggestDeck, swapAlternatives, swapImpact, summarizeMatch, type TurnFact } from "@/domain/deckStrategy";
import { explainDeckError } from "@/domain/cardgame";
import { builderCardOf, catalogCards, strategyContext, syntheticCollection } from "@/lib/deckStrategy/catalog";
import { adjustDeckHref, axisRows, deltaChips, dtoToStrategy, fmt1, identityModel, impactLines, isAxis, matchSummaryFromView, pLabel, resultFact } from "@/lib/deckStrategy/presentation";
import { qaFindMatch, qaReplay, qaView } from "@/lib/duel/qaSimulation";
import type { DuelDeckDTO } from "@/lib/duel/types";
import { DeckBuilder } from "@/components/duel/DeckBuilder";
import { ComparePanel } from "@/components/duel/deck/ComparePanel";
import { ResultScreen } from "@/components/duel/ResultScreen";
import { ReplayViewer } from "@/components/duel/ReplayViewer";
import { CardDetailView } from "@/components/collectionRoom/CardDetailView";
import { AxisBars, IdentityBadge, StrategyLabPanel } from "@/components/duel/strategy/StrategyLabPanel";
import { CardFocusSection, ContributionView, DeltaChips } from "@/components/duel/strategy/CardFocusSection";
import { StrategyImpact } from "@/components/duel/strategy/StrategyImpact";
import { SuggestSection } from "@/components/duel/strategy/SuggestSection";
import { PreMatchStrategy } from "@/components/duel/strategy/PreMatchStrategy";
import { MatchStrategyPanel } from "@/components/duel/strategy/MatchStrategyPanel";
import { DeckCompareView } from "@/components/duel/strategy/DeckCompareView";

const ctx = strategyContext();
const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const html = (n: React.ReactElement) => renderToStaticMarkup(n);
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const COLL = syntheticCollection(400, 7043, 400);
const POOL = indexPool(COLL);
const BAL = suggestDeck(POOL, "BALANCED", ctx).uids;
const EF = suggestDeck(POOL, "entryfrag", ctx).uids;
const cardsOf = (u: string[]) => u.map((x) => POOL.get(x)!);
const A = analyzeDeck(cardsOf(BAL), ctx);
const dto = (id: string, name: string, uids: string[], active = false): DuelDeckDTO => {
  const c = checkDraft(uids, POOL);
  return { id, name, cardUids: uids, cards: cardsOf(uids), valid: c.ready, status: c.status, roleCounts: c.validation.roleCounts, missingByRole: c.validation.missingByRole, errors: c.validation.errors.map((e) => ({ code: e.code, message: explainDeckError(e) })), sumOvr: cardsOf(uids).reduce((s, x) => s + x.ovr, 0), updatedAt: 0, version: "2026-09-16T10:00:00.000000+00:00", active };
};
const D1 = dto("0000dec4-3000-4000-8000-000000000001", "Uno", BAL, true);
const D2 = dto("0000dec4-3000-4000-8000-000000000002", "Dos", EF);
const WIN = qaFindMatch((m) => m.result?.winner === "A" && m.result.combat.decidedBy === "SCORE")!;
const STRAT_DIR = "src/components/duel/strategy";
const STRAT_UI = readdirSync(join(ROOT, STRAT_DIR)).filter((f) => f.endsWith(".tsx") && !f.includes(".test.")).map((f) => code(read(`${STRAT_DIR}/${f}`))).join("\n");

/* ───────── presentación pura ───────── */

test("axisRows: OVR + tres ejes con media, percentil, nivel y aria", () => {
  const rows = axisRows(A);
  assert.deepEqual(rows.map((r) => r.metric), ["ovr", "stronghold", "gamesense", "entryfrag"]);
  for (const r of rows) { assert.match(r.percentile, /^P(\d+|>99|<1)$/); assert.ok(r.level); assert.match(r.aria, /percentil \d+ de las cartas del catálogo/); }
});
test("axisRows sin cartas: «—» y aria de vacío", () => {
  const rows = axisRows(analyzeDeck([], ctx));
  assert.ok(rows.every((r) => r.valueText === "—" && r.aria.endsWith("sin cartas")));
});
test("identityModel: completo con balance, incompleto con aviso, vacío", () => {
  assert.ok(identityModel(A).balance);
  assert.equal(identityModel(analyzeDeck(cardsOf(BAL.slice(0, 7)), ctx)).partial, "7/10: la orientación se calcula con las 10 cartas.");
  assert.equal(identityModel(analyzeDeck([], ctx)).label, "Sin cartas");
});
test("deltaChips: texto con signo, tono y aria (+, −, =)", () => {
  const c = deltaChips({ ovr: 0.3, stronghold: -0.2, gamesense: 0, entryfrag: 0.04 });
  assert.deepEqual(c.map((x) => [x.text, x.tone]), [["+0,3", "up"], ["−0,2", "down"], ["=", "same"], ["=", "same"]]);
  assert.equal(c[1].aria, "Stronghold baja 0,2");
});
test("impactLines: «76 → 79 (+3)» con medias a un decimal", () => {
  const alt = swapAlternatives(BAL, BAL[0], POOL, ctx)[0];
  const l = impactLines(alt.impact);
  assert.equal(l.length, 4);
  assert.equal(l[0].before, fmt1(alt.impact.before.ovr));
  assert.match(l[1].aria, /^Stronghold de [\d,]+ a [\d,]+: Stronghold (sube|baja|sin cambios)/);
});
test("adjustDeckHref: equipo + eje de contexto; sin equipo no hay enlace", () => {
  assert.equal(adjustDeckHref("abc", "gamesense"), "/duelos/mazos?deck=abc&eje=gamesense");
  assert.equal(adjustDeckHref("abc", null), "/duelos/mazos?deck=abc");
  assert.equal(adjustDeckHref(null, "gamesense"), null);
});
test("isAxis: lista cerrada (nunca texto libre del enlace)", () => {
  assert.ok(isAxis("entryfrag"));
  for (const bad of ["ovr", "../x", "<script>", "", null, 3]) assert.equal(isAxis(bad), false);
});
test("dtoToStrategy: calibración desde el catálogo, sin serial ni metadatos", () => {
  const s = dtoToStrategy(COLL[0]);
  assert.equal(s.dataVersion, catalogCards().find((c) => c.cardId === COLL[0].cardId)!.dataVersion);
  assert.ok(!("serial" in s) && !("team" in s) && !("region" in s));
});
test("resultFact y matchSummaryFromView: misma lectura que el dominio", () => {
  const v = qaView(WIN);
  assert.deepEqual(matchSummaryFromView(v.history, v.result), summarizeMatch(v.history as unknown as TurnFact[], resultFact(v.result)));
  assert.equal(resultFact(null), null);
});
test("pLabel y fmt1: formato español y extremos sin saturar a P100/P0", () => { assert.equal(pLabel(83.6), "P84"); assert.equal(pLabel(99.7), "P>99"); assert.equal(pLabel(0.2), "P<1"); assert.equal(pLabel(null), "—"); assert.equal(fmt1(76.25), "76,3"); });

/* ───────── laboratorio ───────── */

test("StrategyLabPanel reducido: solo encabezado, etiqueta de perfil y frase de balance", () => {
  const h = html(<StrategyLabPanel analysis={A} />);
  for (const id of ["strategy-lab", "deck-orientation", "deck-balance"]) assert.ok(h.includes(`data-testid="${id}"`), id);
  for (const id of ["axis-bars", "lab-strengths", "lab-weaknesses", "lab-roles", "lab-advanced", "lab-context"]) assert.ok(!h.includes(`data-testid="${id}"`), id);
  assert.ok(!h.includes("<details") && !h.includes("data-metric="));
});
test("StrategyLabPanel incompleto: aviso de 10 cartas y sin percentiles", () => {
  const h = html(<StrategyLabPanel analysis={analyzeDeck(cardsOf(BAL.slice(0, 8)), ctx)} />);
  assert.ok(h.includes("8/10: la orientación se calcula con las 10 cartas.") && !/P\d+ respecto/.test(h));
});
test("IdentityBadge: data-kind y texto (no solo color)", () => {
  const h = html(<IdentityBadge analysis={A} />);
  assert.match(h, /data-kind="(ORIENTED|BALANCED|MIXED)"/);
  assert.ok(text(h).trim().length > 5);
});
test("AxisBars compacto: sin OVR", () => { assert.ok(!html(<AxisBars analysis={A} compact />).includes('data-metric="ovr"')); });

/* ───────── foco de carta ───────── */

const ALTS = swapAlternatives(BAL, BAL[2], POOL, ctx);
test("CardFocusSection: aportación y alternativas con deltas y «Vista previa» accesible", () => {
  const h = html(<CardFocusSection contribution={A.contributions[2]} partnerNick="X" alternatives={ALTS} sort="ovr" onSort={() => {}} onPreview={() => {}} />);
  assert.ok(h.includes('data-testid="card-contribution"') && h.includes(`data-count="${ALTS.length}"`));
  assert.ok(h.includes(`aria-label="Vista previa con ${ALTS[0].card.nick}"`));
  assert.ok((h.match(/data-alternative=/g) ?? []).length === Math.min(12, ALTS.length));
});
test("CardFocusSection: orden explícito con aria-pressed (Δ OVR/SH/GS/EF)", () => {
  const h = html(<CardFocusSection contribution={null} partnerNick={null} alternatives={ALTS} sort="gamesense" onSort={() => {}} onPreview={() => {}} />);
  assert.equal((h.match(/aria-pressed="true"/g) ?? []).length, 1);
  assert.ok(/aria-pressed="true"[^>]*>Δ GS</.test(h));
});
test("CardFocusSection sin alternativas: estado honesto", () => {
  assert.ok(html(<CardFocusSection contribution={null} partnerNick={null} alternatives={[]} sort="ovr" onSort={() => {}} onPreview={() => {}} />).includes('data-empty="no-alternatives"'));
});
test("CardFocusSection: nunca «mejor carta»", () => {
  const t = text(html(<CardFocusSection contribution={A.contributions[0]} partnerNick="X" alternatives={ALTS} sort="ovr" onSort={() => {}} onPreview={() => {}} />));
  assert.ok(!/la mejor|mejor carta|recomendada/i.test(t.replace("Ninguna carta es «mejor»", "")));
});
test("ContributionView: tabla con vs media, vs compañero y catálogo", () => {
  const h = html(<ContributionView c={A.contributions[0]} partnerNick="Socio" />);
  assert.ok(h.includes("vs Socio") && h.includes("Catálogo") && (h.match(/<tr/g) ?? []).length === 5);
});
test("DeltaChips: aria por métrica", () => {
  const h = html(<DeltaChips delta={{ ovr: 1, stronghold: 0, gamesense: -1, entryfrag: 0.3 }} />);
  assert.ok(h.includes('aria-label="OVR sube 1"') && h.includes('aria-label="Gamesense baja 1"') && h.includes('aria-label="Stronghold sin cambios"'));
});

/* ───────── impacto y comparación ───────── */

test("StrategyImpact: antes → después, perfil y encaje", () => {
  const h = html(<StrategyImpact impact={ALTS[0].impact} />);
  assert.ok(h.includes('data-testid="impact-identity"') && h.includes('data-testid="impact-fit"') && h.includes("Qué cambia en tu equipo"));
});
test("StrategyImpact informativo: «Si la tuvieras (solo informativo)»", () => {
  assert.ok(html(<StrategyImpact impact={ALTS[0].impact} informative />).includes("Si la tuvieras (solo informativo)"));
});
test("StrategyImpact sin cambios: lo dice", () => {
  const deck = cardsOf(BAL);
  const imp = swapImpact(deck, deck[0].uid, { ...deck[0], uid: "clone", cardId: "otra" }, ctx);
  assert.ok(html(<StrategyImpact impact={imp} />).includes("Sin cambios en las medias del equipo."));
});
test("ComparePanel con estrategia: sustituye la tabla simple de medias", () => {
  const view = compareForSlot(BAL, POOL, BAL[2], ALTS[0].card.uid)!;
  const h = html(<ComparePanel open view={view} slotLabel="Hueco" onClose={() => {}} onConfirm={() => {}} strategy={ALTS[0].impact} />);
  assert.ok(h.includes('data-testid="strategy-impact"') && !h.includes('data-testid="team-impact"'));
});
test("ComparePanel sin estrategia: la tabla de la Fase 32 sigue", () => {
  const view = compareForSlot(BAL, POOL, BAL[2], ALTS[0].card.uid)!;
  assert.ok(html(<ComparePanel open view={view} slotLabel="Hueco" onClose={() => {}} onConfirm={() => {}} />).includes('data-testid="team-impact"'));
});
test("DeckCompareView: dos equipos, diferencias sin ganador y por rol", () => {
  const h = html(<DeckCompareView decks={[D1, D2]} />);
  assert.ok(h.includes('data-testid="deck-compare-summary"') && h.includes("OVR medio por rol"));
  assert.ok(!/gana|mejor equipo|superior/i.test(text(h).replace("No dice qué equipo gana", "")));
});
test("DeckCompareView: el mismo equipo dos veces pide dos distintos", () => {
  assert.ok(html(<DeckCompareView decks={[D1, D2]} initialA={D1.id} initialB={D1.id} />).includes("Elige dos equipos distintos."));
});

/* ───────── sugerencias ───────── */

test("SuggestSection: 4 objetivos, sin «mejor equipo»", () => {
  const h = html(<SuggestSection pool={POOL} currentUids={BAL} onApply={() => {}} />);
  assert.equal((h.match(/data-objective=/g) ?? []).length, 4);
  assert.ok(!/mejor equipo/i.test(text(h).replace("No existe «el mejor equipo»", "")));
});
test("SuggestSection con objetivo: resultado con identidad, regla y «Aplicar al borrador (sin guardar)»", () => {
  const h = html(<SuggestSection pool={POOL} currentUids={BAL.slice(0, 5)} onApply={() => {}} initialObjective="entryfrag" />);
  assert.ok(h.includes('data-testid="suggest-result"') && h.includes('data-ok="true"') && h.includes("Aplicar al borrador (sin guardar)") && h.includes("Regla:"));
});
test("SuggestSection: si la plantilla ya es tu borrador, aplicar está desactivado", () => {
  const h = html(<SuggestSection pool={POOL} currentUids={BAL} onApply={() => {}} initialObjective="BALANCED" />);
  assert.ok(/data-testid="suggest-apply"[^>]*disabled|disabled=""[^>]*data-testid="suggest-apply"/.test(h));
});
test("SuggestSection Pareto: opciones etiquetadas «Más …»", () => {
  const h = html(<SuggestSection pool={POOL} currentUids={BAL} onApply={() => {}} initialPareto />);
  assert.ok(h.includes('data-testid="pareto-options"') && /Más (OVR|Stronghold|Gamesense|Entryfrag|equilibrado)/.test(h));
});
test("SuggestSection sin cartas suficientes: motivo", () => {
  const h = html(<SuggestSection pool={indexPool(COLL.slice(0, 5))} currentUids={[]} onApply={() => {}} initialObjective="gamesense" />);
  assert.ok(h.includes('data-ok="false"') && h.includes("No tienes cartas suficientes"));
});

/* ───────── pre-partida, resultado, PvP y repetición ───────── */

test("PreMatchStrategy: equipo completo ⇒ perfil compacto", () => {
  const h = html(<PreMatchStrategy cards={D1.cards} />);
  assert.ok(h.includes('data-testid="prematch-strategy"') && h.includes("Solo tu equipo") && !h.includes('data-metric="ovr"'));
});
test("PvP y campaña: perfil propio en su preparación, nunca con datos del rival", () => {
  for (const f of ["src/components/duel/pvp/PvpLobby.tsx", "src/components/campaign/CampaignPreMatch.tsx"]) {
    const src = read(f);
    assert.ok(/<PreMatchStrategy cards=\{(elegido|chosen)\.cards\}/.test(src), f);
  }
});
test("PreMatchStrategy: equipo incompleto ⇒ nada (no se inventa un perfil)", () => {
  assert.equal(html(<PreMatchStrategy cards={D1.cards.slice(0, 6)} />), "");
});
test("MatchStrategyPanel: insights, tres ejes, resolución, cartas y «Ajustar equipo» con contexto", () => {
  const v = qaView(WIN);
  const h = html(<MatchStrategyPanel history={v.history} result={v.result} deckId={D1.id} />);
  for (const id of ["match-strategy", "axis-performance", "match-resolution", "card-performance", "adjust-deck"]) assert.ok(h.includes(`data-testid="${id}"`), id);
  assert.ok(h.includes('data-consistent="true"'));
  assert.ok(h.includes(`href="/duelos/mazos?deck=${D1.id}`));
});
test("MatchStrategyPanel sin equipo (PvP/Draft): sin CTA de ajuste", () => {
  const v = qaView(WIN);
  assert.ok(!html(<MatchStrategyPanel history={v.history} result={v.result} />).includes('data-testid="adjust-deck"'));
});
test("MatchStrategyPanel sin turnos: no pinta nada", () => { assert.equal(html(<MatchStrategyPanel history={[]} result={null} />), ""); });
test("MatchStrategyPanel: aria por eje con comparaciones/ganadas/perdidas/empatadas", () => {
  const v = qaView(WIN);
  assert.match(html(<MatchStrategyPanel history={v.history} result={v.result} />), /aria-label="(Stronghold|Gamesense|Entryfrag): \d+ comparaciones, \d+ ganadas, \d+ perdidas, \d+ empatadas"/);
});
test("ResultScreen (RESULTADO ÚNICO): la lectura estratégica ya no se apila en el resultado", () => {
  const v = qaView(WIN);
  const h = html(<ResultScreen view={v} deckId={D1.id} onPlayAgain={() => {}} onDecks={() => {}} onReplay={() => {}} />);
  assert.ok(!h.includes('data-testid="match-strategy"') && !h.includes('data-testid="adjust-deck"'));
  assert.ok(h.includes(`href="/duelos/replay/${v.matchId}"`), "la partida se revisa con VER PARTIDA");
});
test("ResultScreen en Draft: sin «Ajustar equipo» (no es un equipo propio)", () => {
  const v = qaView(WIN);
  assert.ok(!html(<ResultScreen view={v} deckId={D1.id} mode="DRAFT_GAUNTLET" onPlayAgain={() => {}} onDecks={() => {}} onReplay={() => {}} />).includes('data-testid="adjust-deck"'));
});
test("PvpOutcome (RESULTADO ÚNICO): sin lectura estratégica y sin ningún equipo (propio ni del rival)", () => {
  const src = read("src/components/duel/pvp/PvpOutcome.tsx");
  assert.ok(!src.includes("<MatchStrategyPanel"));
  assert.ok(!src.includes("deckId={"));
});
test("ReplayViewer: lectura desde los turnos guardados y enlace solo con equipo propio", () => {
  const r = { ...qaReplay(WIN), deckId: D1.id };
  const h = html(<ReplayViewer replay={r} onBack={() => {}} />);
  assert.ok(h.includes('data-testid="match-strategy"') && h.includes("Lectura de la partida") && h.includes('data-testid="adjust-deck"'));
  assert.ok(!html(<ReplayViewer replay={{ ...r, deckId: null }} onBack={() => {}} />).includes('data-testid="adjust-deck"'));
});
test("servidor: deckId de la repetición solo para el PvE propio (nunca PvP ni Draft)", () => {
  const svc = read("src/server/services/duels.ts");
  assert.ok(svc.includes('deckId: mode === "PVE" && side === "A" && row.mode !== DRAFT_GAUNTLET_MODE ? row.deck_id ?? null : null,'));
});
test("vista de partida: yourDeckId sale del snapshot PROPIO", () => {
  assert.ok(read("src/lib/duel/matchView.ts").includes("yourDeckId: mySnap.deckId ?? null,"));
  assert.equal(qaView(WIN).yourDeckId, WIN.snapshotA.deckId);
});

/* ───────── constructor integrado ───────── */

const builder = (initial: Parameters<typeof DeckBuilder>[0]["initial"] = {}, deck: DuelDeckDTO | null = D1, collection: BuilderCard[] = COLL) => html(
  <DeckBuilder deck={deck} collection={collection} activeSupported defaultName="Equipo" onSave={async () => ({ ok: false, kind: "error", message: "x" })} onExit={() => {}} initial={initial} />,
);
test("DeckBuilder: laboratorio en vivo, orientación en la cabecera y plantilla por objetivo", () => {
  const h = builder();
  assert.ok(h.includes('data-testid="strategy-lab"') && h.includes('data-testid="deck-orientation"') && h.includes('data-testid="suggest-objective"'));
  assert.ok(!h.includes('id="deck-stats-title"'), "las medias viven en el laboratorio");
});
test("DeckBuilder: hueco ocupado ⇒ aportación y alternativas en la hoja", () => {
  const h = builder({ slotSheet: "Controlador-1" });
  assert.ok(h.includes('data-testid="card-focus"') && h.includes('data-testid="swap-alternatives"'));
});
test("DeckBuilder: vista previa con impacto estratégico (no guarda)", () => {
  const h = builder({ compare: { slotUid: BAL[2], candidateUid: ALTS[0].card.uid } });
  assert.ok(h.includes('data-testid="strategy-impact"') && h.includes('data-testid="compare-confirm"'));
});
test("DeckBuilder: carta no poseída ⇒ comparación informativa sin confirmar", () => {
  const def = catalogCards().find((d) => d.role === "Flex" && !COLL.some((c) => c.cardId === d.cardId))!;
  const h = builder({ explore: def.cardId });
  assert.ok(h.includes('data-testid="explore-card"') && h.includes('data-informative="true"') && text(h).includes("no se puede aplicar al equipo"));
});
test("DeckBuilder: «Deshacer cambios» solo con borrador modificado", () => {
  assert.ok(!builder().includes('data-testid="revert-draft"'));
  assert.ok(builder({ uids: BAL.slice(0, 9) }).includes('data-testid="revert-draft"'));
});
test("DeckBuilder: sigue guardando con el contrato canónico (onSave con nombre + uids)", () => {
  const src = read("src/components/duel/DeckBuilder.tsx");
  assert.ok(src.includes("props.onSave({ name: nameCheck.name, cardUids: uids })"));
  assert.ok(!/onSave\([^)]*analysis|orientation/.test(code(src)));
});

/* ───────── colección ───────── */

const serialized = qaSerializedCard() /* catálogo diseñado sin serializadas: carta local de QA */;
const PS = getPlayer(serialized.playerId)!;
const snapOwned = buildCollectionSnapshot(CARDS, getPlayer, { instances: [{ uid: "u-1", cardId: serialized.id, serial: 1, mintedVersion: 1 }], favorites: [], showcaseUids: [], decks: [{ id: "d1", name: "Activo", active: true, cardUids: ["u-9"] }] });
const detail = (o: Partial<Parameters<typeof CardDetailView>[0]> = {}) => html(
  <CardDetailView def={serialized} player={PS} access="server" ownership={snapOwned.byCard.get(serialized.id)!} variants={playerVariants(CARDS, serialized.playerId, snapOwned)} availability={packsThatCanContain(new CardRegistry(), PACKS, serialized)} sets={{ team: null, region: null }} decks={[{ id: "d1", name: "Activo", active: true, cardUids: ["u-9"] }]} favorite={{ available: true, active: false }} showcase={{ available: true, count: 0 }} {...o} />,
);
test("ficha poseída: «Comparar para equipo» abre el constructor con la carta (accionable)", () => {
  const h = detail();
  assert.ok(h.includes('data-testid="card-team-compare"') && h.includes('data-actionable="true"') && h.includes("/duelos/mazos?deck=d1&amp;add=u-1"));
});
test("ficha NO poseída: «Comparar con mi equipo» solo informativo", () => {
  const h = detail({ ownership: null });
  assert.ok(h.includes('data-actionable="false"') && h.includes(`explorar=${encodeURIComponent(serialized.id)}`));
});
test("ficha ya en el equipo activo o sin equipo activo: sin enlace", () => {
  const inDeck = buildCollectionSnapshot(CARDS, getPlayer, { instances: [{ uid: "u-9", cardId: serialized.id, serial: 1, mintedVersion: 1 }], favorites: [], showcaseUids: [], decks: [] });
  assert.ok(!detail({ ownership: inDeck.byCard.get(serialized.id)!, decks: [{ id: "d1", name: "Activo", active: true, cardUids: ["u-9"] }] }).includes("card-team-compare"));
  assert.ok(!detail({ decks: [] }).includes("card-team-compare"));
});
test("favoritos no son señal estratégica", () => {
  assert.ok(!/favorite|favorit/i.test(code(read("src/domain/deckStrategy/suggestion.ts")) + code(read("src/domain/deckStrategy/analysis.ts")) + code(read("src/domain/deckStrategy/swap.ts"))));
});

/* ───────── accesibilidad, movimiento y rendimiento ───────── */

test("accesibilidad: botones de la capa estratégica ≥ 44 px", () => {
  const buttons = STRAT_UI.match(/<button\b[\s\S]*?className=(?:\{cn\()?"[^"]*"/g) ?? [];
  assert.ok(buttons.length > 0);
  for (const b of buttons) assert.ok(/min-h-\[44px\]/.test(b), b.slice(0, 120));
});
test("accesibilidad: resúmenes <details> con objetivo ≥ 44 px y tablas con caption", () => {
  assert.ok((STRAT_UI.match(/<summary[^>]*min-h-\[44px\]/g) ?? []).length >= 1);
  assert.ok((STRAT_UI.match(/<caption/g) ?? []).length >= 4);
});
test("movimiento reducido: transiciones con motion-reduce y sin animación en bucle", () => {
  assert.ok(STRAT_UI.includes("motion-reduce:transition-none"));
  assert.ok(!/animate-(spin|pulse|bounce|ping)|repeat:\s*Infinity/.test(STRAT_UI));
});
test("rendimiento: sin Card3D en la capa estratégica (la carta 3D queda en la vista previa existente)", () => {
  assert.ok(!/Card3D/.test(STRAT_UI));
});
test("sin red ni almacenamiento: la capa estratégica no hace fetch ni guarda en el navegador", () => {
  assert.ok(!/fetch\(|localStorage|sessionStorage|supabase/i.test(STRAT_UI + code(read("src/lib/deckStrategy/presentation.ts")) + code(read("src/lib/deckStrategy/catalog.ts"))));
});
test("mazos: parámetros `eje` y `explorar` validados contra listas/patrones cerrados", () => {
  const page = read("src/app/duelos/mazos/page.tsx");
  assert.ok(page.includes("focusAxis: isAxis(eje) ? eje : null") && page.includes("/^[a-z0-9_-]{1,80}$/i.test(explorar)"));
});
test("equipos: «Comparar equipos» solo con 2 o más", () => {
  assert.ok(read("src/app/duelos/mazos/page.tsx").includes("onCompare={ws.decks.length >= 2 ? () => setComparing(true) : undefined}"));
});
test("rendimiento medido: análisis < 20 ms, alternativas < 50 ms, sugerencia < 150 ms (colección de 5.000)", () => {
  const big = indexPool(syntheticCollection(5000, 1, 772));
  let t = performance.now(); const s = suggestDeck(big, "BALANCED", ctx); const tSug = performance.now() - t;
  t = performance.now(); analyzeDeck(s.cards, ctx); const tAn = performance.now() - t;
  t = performance.now(); swapAlternatives(s.uids, s.uids[0], big, ctx); const tSw = performance.now() - t;
  assert.ok(tAn < 20, `análisis ${tAn}`); assert.ok(tSw < 50 * 3, `alternativas ${tSw}`); assert.ok(tSug < 150 * 3, `sugerencia ${tSug}`);
});
test("dominio estratégico solo en cliente con datos ya entregados: ninguna ruta API nueva", () => {
  const api = readdirSync(join(ROOT, "src/app/api/game"));
  assert.ok(!api.some((d) => /strategy|estrategia|analysis|analisis/i.test(d)));
});
test("ninguna frase de «mejor equipo», química, bonus o sinergia en la interfaz estratégica", () => {
  const s = STRAT_UI.replace(/No existe «el mejor equipo»/g, "").replace(/Ninguna carta es «mejor»/g, "");
  assert.ok(!/mejor equipo|química|sinergia|synergy|bonus|chemistry/i.test(s));
});
test("builderCardOf: definición real, serial opcional sin efecto en cifras", () => {
  const a = builderCardOf(serialized.id, 1, 1); const b = builderCardOf(serialized.id, 2, null);
  assert.deepEqual([a.ovr, a.combat], [b.ovr, b.combat]);
});
