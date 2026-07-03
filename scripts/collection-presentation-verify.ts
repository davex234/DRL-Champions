/**
 * VERIFICACIÓN — Collection Presentation, Museum & Showcase Engine (DRL Champions, Collection Fase 7/7, FINAL).
 *
 *   npx tsx scripts/collection-presentation-verify.ts
 *
 * Comprueba la capa AAA de presentación de SOLO LECTURA que CIERRA el módulo Collection: proyecta los
 * datos de todos los motores (Collection/Deck/Marketplace/Craft/Battle Pass/Career) sin recalcular ni
 * modificar nada. Museum/Album/Binder/Showcase/Analytics/Timeline/History/Career/Battle Pass/Marketplace/
 * Craft/Deck + read-only + determinismo + migraciones + rendimiento (1M cartas) + cero estados
 * imposibles. 100% DETERMINISTA.
 */
import type { CardDef, Player, VariantId, OwnedCard } from "../src/domain/cards/types";
import { ALL_VARIANTS } from "../src/domain/cards/variants";
import { CARDS } from "../src/data/catalog";
import { CardRegistry, CollectionEngine, emptyMeta, toggleFavorite, addTag } from "../src/collection";
import { instanceValue } from "../src/domain/economy/pricing";
import { PresentationEngine, migrateShowcaseConfig, type PresentationContext } from "../src/collection-presentation";

let failures = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`  ${c ? "✓" : "✕"} ${l}${d ? ` — ${d}` : ""}`); if (!c) failures++; };
console.log("# Verificación del Collection Presentation, Museum & Showcase Engine — DRL Champions (Collection Fase 7/7)\n");

// ── Colección real: ~40 distintas + duplicados + serials + favoritos/etiquetas ──
const owned: OwnedCard[] = [];
CARDS.slice(0, 40).forEach((c, i) => {
  const serialized = c.id.includes("winner") || c.id.includes("mvp");
  owned.push({ uid: `u${i}`, cardId: c.id, serial: serialized ? 1 : undefined, obtainedAt: 1000 + i });
  if (i % 5 === 0) owned.push({ uid: `d${i}`, cardId: c.id, obtainedAt: 900 + i });
});
let meta = emptyMeta();
meta = toggleFavorite(meta, CARDS[0].id);
meta = addTag(meta, CARDS[1].id, "pin");
meta = addTag(meta, CARDS[2].id, "coleccion-favorita");
const col = new CollectionEngine(owned, meta);
const decks = [{ id: "d1", name: "D", starters: owned.slice(0, 5).map((o) => o.uid), subs: [], createdAt: 0, lastUsedAt: null }];
const ctx: PresentationContext = {
  collection: col, now: 5000,
  marketValue: (id) => (col.registry.card(id)?.ovr ?? 60) * 10,
  materials: { common: 5, uncommon: 2, rare: 1, epic: 0, legendary: 0 },
  decks, pass: { seasonId: "s1", level: 12, percentComplete: 24, missionsCompleted: 8 }, passArchive: [{ seasonId: "s0" }],
  careerHistory: [{ season: 1 }], marketHistory: [{ cardId: CARDS[0].id, price: 500 }],
};
const P = new PresentationEngine(ctx);

// ─────────────────────── 1. Museum ───────────────────────
console.log("## Museum (reutiliza Collection)");
{
  const m = P.museum();
  check("HALL OF FAME: mejores poseídas ordenadas por rareza/serie", m.hallOfFame.length > 0 && m.hallOfFame.length <= 12 && m.hallOfFame[0].rank >= m.hallOfFame[m.hallOfFame.length - 1].rank);
  check("TIMELINE: línea de tiempo de la colección (desde el historial)", m.collectionTimeline.length > 0 && m.collectionTimeline[0].at >= m.collectionTimeline[m.collectionTimeline.length - 1].at);
  check("COLECCIONES: temporadas/torneos/champions/legado derivados de los sets", m.seasons.length >= 1 && m.tournaments.length >= 1 && m.records.length > 0);
  check("MILESTONES: hitos con progreso 0..1 y bandera reached", m.milestones.length >= 4 && m.milestones.every((x) => x.progress >= 0 && x.progress <= 1));
}

// ─────────────────────── 2. Showcase ───────────────────────
console.log("\n## Showcase (reutiliza favoritos/etiquetas)");
{
  const s = P.showcase();
  check("FAVORITAS: reutiliza la meta (1 favorita)", s.favorites.length === 1 && s.favorites[0].favorite);
  check("PINNED: vitrina 'pin' desde etiquetas (sin estado nuevo)", s.pinned.length === 1);
  check("CASES: cada etiqueta ≠ pin es una vitrina", s.cases.some((c) => c.id === "coleccion-favorita"));
  check("DINÁMICAS: estanterías por regla (élite/gemas/legendarias)", s.dynamic.length === 3 && s.dynamic.every((d) => Array.isArray(d.cards)));
  check("AGRUPACIONES: por jugador / región / tema", s.byPlayer.length > 0 && s.byRegion.length > 0 && s.themes.length > 0);
}

// ─────────────────────── 3. Album / Binder ───────────────────────
console.log("\n## Album / Binder (reutiliza album/sets/statistics)");
{
  const a = P.album();
  check("COMPLETION: coincide EXACTAMENTE con Collection (no recalcula)", a.completion === col.completion());
  check("PROGRESO: regiones/variantes desde los sets", a.regions.length === 4 && a.variants.length >= 1);
  check("SERIALES: serializedOwned + gemas + mejores series", a.serials.serializedOwned > 0 && a.serials.best.length > 0);
  check("DUPLICADOS: análisis desde count (reutiliza ownership)", a.duplicates.distinctDuplicated > 0 && a.duplicates.totalDuplicates > 0);
  check("HEATMAP: 4 regiones × 5 rarezas = 20 celdas con intensidad 0..1", a.heatmap.length === 20 && a.heatmap.every((c) => c.intensity >= 0 && c.intensity <= 1));
  check("MISSING: faltantes desde Collection", a.missing.length === col.missing().length);
  check("BINDER: reutiliza el binder de Collection", P.binder(12).length === col.binder(12).length);
}

// ─────────────────────── 4. Analytics ───────────────────────
console.log("\n## Analytics (proyecta, nunca recalcula)");
{
  const an = P.analytics();
  // Valor de colección = suma EXACTA de instanceValue (reutiliza pricing).
  let expected = 0;
  for (const v of col.ownedViews()) { const def = col.registry.card(v.cardId); if (def) expected += instanceValue(def, v.bestSerial ?? undefined); }
  check("COLLECTION VALUE: suma exacta de instanceValue (reutiliza pricing)", an.collectionValue === expected);
  check("MARKET VALUE: usa la función inyectada del Marketplace", an.marketValue > 0);
  check("CRAFT VALUE: proyecta el valor de los materiales", an.craftValue > 0);
  check("MOST RARE / VALUABLE / NEWEST / OLDEST / MOST USED", !!an.mostRare && !!an.mostValuable && !!an.newest && !!an.oldest && an.mostUsed?.cardId != null);
  check("HISTORIALES: career/pass/market proyectados TAL CUAL (no recalculados)", an.careerHistory.length === 1 && an.passHistory.length === 1 && an.marketHistory.length === 1);
  check("BY ORIGIN: reutiliza byOrigin de Collection", typeof an.byOrigin === "object");
}

// ─────────────────────── 5. Presentation (vistas de alto nivel) ───────────────────────
console.log("\n## Presentation (summary / detail / profile / reviews)");
{
  const sum = P.summary();
  check("SUMMARY: owned/total/completion/valor coherentes con Collection", sum.owned === col.progress().owned && sum.total === col.progress().total && sum.completion === col.completion());
  const cd = P.cardDetail(CARDS[0].id);
  check("CARD DETAIL: carta + instancias + historial + valor de mercado", !!cd && cd.instances.length >= 1 && cd.card.cardId === CARDS[0].id);
  check("TIMELINE / PROFILE / SEASON REVIEW / CAREER REVIEW", P.timeline().length > 0 && !!P.profile() && P.seasonReview()?.level === 12 && P.careerReview().records.length > 0);
}

// ─────────────────────── 6. Read-only (SEGURIDAD) ───────────────────────
console.log("\n## Read-only (nunca modifica las fuentes)");
{
  const ownedBefore = JSON.stringify(owned);
  const metaBefore = JSON.stringify(col.getMeta());
  const decksBefore = JSON.stringify(decks);
  P.museum(); P.showcase(); P.album(); P.analytics(); P.summary(); P.profile(); P.timeline(); P.cardDetail(CARDS[0].id); P.seasonReview(); P.careerReview();
  check("READ-ONLY: la propiedad no cambia tras TODAS las proyecciones", JSON.stringify(owned) === ownedBefore);
  check("READ-ONLY: la meta (favoritos/etiquetas) no cambia", JSON.stringify(col.getMeta()) === metaBefore);
  check("READ-ONLY: los decks inyectados no cambian", JSON.stringify(decks) === decksBefore);
}

// ─────────────────────── 7. Determinismo ───────────────────────
console.log("\n## Determinismo");
{
  const a = new PresentationEngine(ctx);
  const b = new PresentationEngine({ ...ctx, collection: new CollectionEngine(owned, col.getMeta()) });
  check("DETERMINISMO: mismas fuentes ⇒ mismas vistas (museum/album/analytics/showcase)",
    JSON.stringify(a.museum()) === JSON.stringify(b.museum()) && JSON.stringify(a.album()) === JSON.stringify(b.album()) &&
    JSON.stringify(a.analytics()) === JSON.stringify(b.analytics()) && JSON.stringify(a.showcase()) === JSON.stringify(b.showcase()));
}

// ─────────────────────── 8. Migraciones ───────────────────────
console.log("\n## Migraciones");
{
  const m = migrateShowcaseConfig({ caseOrder: ["a", 5, "b"], pinned: "x", version: 0 });
  check("MIGRACIÓN: config de vitrinas saneada + versión", m.version >= 1 && JSON.stringify(m.caseOrder) === JSON.stringify(["a", "b"]) && m.pinned.length === 0);
  check("MIGRACIÓN: nulo ⇒ config fresca", migrateShowcaseConfig(null).caseOrder.length === 0);
}

// ─────────────────────── 9. Cero estados imposibles ───────────────────────
console.log("\n## Cero estados imposibles");
{
  const empty = new PresentationEngine({ collection: new CollectionEngine([]) });
  let bad = 0;
  try {
    const m = empty.museum(), a = empty.album(), an = empty.analytics(), s = empty.showcase(), sum = empty.summary();
    if (m.hallOfFame.length !== 0 || a.completion !== 0 || an.collectionValue !== 0 || s.favorites.length !== 0 || sum.owned !== 0) bad++;
    if (an.newest !== null || an.mostRare !== null) bad++;                 // sin cartas ⇒ null, no excepción
    if (empty.cardDetail("no__existe") !== null) bad++;                    // carta inexistente ⇒ null
    empty.profile(); empty.careerReview(); empty.seasonReview();
  } catch { bad++; }
  check("INTEGRIDAD: colección vacía coherente, inexistente→null, nunca lanza", bad === 0);
}

// ─────────────────────── 10. Rendimiento (1.000.000 de cartas) ───────────────────────
console.log("\n## Rendimiento (1.000.000 de cartas)");
{
  const variantIds = ALL_VARIANTS.map((v) => v.id);
  const regions = ["EMEA", "Americas", "Pacific", "China"] as const;
  const N = 1_000_000;
  const bigCards: CardDef[] = [];
  for (let i = 0; i < N; i++) bigCards.push({ id: `p${i}__${variantIds[i % variantIds.length]}`, playerId: `p${i}`, variantId: variantIds[i % variantIds.length] as VariantId, ovr: 60 + (i % 40), stats: { dmg: 70, scr: 70, com: 70, hs: 60, ast: 60, clu: 60 } });
  const bigLookup = (id: string): Player => { const i = parseInt(id.slice(1), 10) || 0; return { id, nick: `P${i}`, team: `T${i % 500}`, teamTag: "T", region: regions[i % 4], role: "Flex", country: "ES", stats: { dmg: 70, scr: 70, com: 70, hs: 60, ast: 60, clu: 60 }, accolades: [] }; };
  const t0 = Date.now();
  const bigReg = new CardRegistry(bigCards, bigLookup);
  const bigOwned: OwnedCard[] = bigCards.filter((_, i) => i % 10 === 0).map((c, i) => ({ uid: `b${i}`, cardId: c.id, obtainedAt: i }));
  const bigCol = new CollectionEngine(bigOwned, emptyMeta(), bigReg);
  const BP = new PresentationEngine({ collection: bigCol });
  const m = BP.museum(); const a = BP.album(); const an = BP.analytics(); const s = BP.showcase();
  const ms = Date.now() - t0;
  check("RENDIMIENTO: 1M cartas — museum+album+analytics+showcase, sin O(n²)",
    ms < 20000 && m.hallOfFame.length === 12 && a.heatmap.length === 20 && an.collectionValue > 0 && s.byRegion.length > 0,
    `${ms}ms · ${N} cartas · ${bigOwned.length} poseídas`);
}

console.log(`\n${failures === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${failures} COMPROBACIÓN(ES) FALLARON`}`);
process.exit(failures === 0 ? 0 : 1);
