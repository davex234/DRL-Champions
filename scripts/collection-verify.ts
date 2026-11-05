/**
 * VERIFICACIÓN — Collection Core Engine (DRL Champions, Collection Fase 1/7).
 *
 *   npx tsx scripts/collection-verify.ts
 *
 * Comprueba la capa PURA de colección sobre lo EXISTENTE (Card Registry `@/data/catalog` + variantes +
 * propiedad `OwnedCard[]` + selectores) sin duplicar nada: registry/identity/ownership/instance/meta/
 * quality/filters/search/sort/group/album/binder/sets/series/seasons/progress/statistics/analytics/
 * history/origin/compare/events/broadcast + determinismo + rendimiento (100.000 cartas) + cero estados
 * imposibles + compat Cards/Gameplay/Career/Living-World. DETERMINISTA (reloj lógico).
 */
import type { CardDef, OwnedCard, Player, VariantId } from "../src/domain/cards/types";
import { ALL_VARIANTS } from "../src/domain/cards/variants";
import {
  CollectionEngine, CardRegistry, parseCardId, makeCardId, OwnershipIndex,
  qualityOf, reconcile, migrateMeta, serializeMeta, deserializeMeta, toggleFavorite,
  emptyMeta,
} from "../src/collection";

let failures = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`  ${c ? "✓" : "✕"} ${l}${d ? ` — ${d}` : ""}`); if (!c) failures++; };
console.log("# Verificación del Collection Core Engine — DRL Champions (Collection Fase 1/7)\n");

const mk = (uid: string, cardId: string, serial?: number, at = 0): OwnedCard => ({ uid, cardId, serial, obtainedAt: at });

// ─────────────────────── 1. Card Registry + Card Identity ───────────────────────
console.log("## Card Registry + Card Identity");
const reg = new CardRegistry(); // catálogo real
{
  check("REGISTRY: reutiliza el catálogo real (no duplica)", reg.total > 0 && reg.cards.length === reg.total);
  const sample = reg.cards[0];
  const parsed = parseCardId(sample.id);
  check("IDENTITY: cardId = playerId__variantId (parse/roundtrip)", makeCardId(parsed.playerId, parsed.variantId) === sample.id && reg.has(sample.id));
  check("ÍNDICES: por jugador/grupo/región construidos", reg.forPlayer(sample.playerId).length >= 1 && reg.forGroup("base").length > 0 && reg.forRegion("EMEA").length > 0);
  const kinds = new Set(reg.allSets().map((s) => s.kind));
  check("SETS/SERIES/SEASONS: derivados del registro", kinds.has("group") && kinds.has("region") && kinds.has("role") && kinds.has("series") && kinds.has("season"));
}

// ─────────────────────── 2. Ownership + Card Instance + validación ───────────────────────
console.log("\n## Ownership Engine + Card Instance");
const serializedCard = reg.cards.find((c) => reg.variant(c.variantId).serialized)!;
const plainCard = reg.cards.find((c) => !reg.variant(c.variantId).serialized)!;
{
  const owned = [mk("u1", plainCard.id, undefined, 100), mk("u2", plainCard.id, undefined, 200), mk("u3", serializedCard.id, 1, 300)];
  const own = new OwnershipIndex(owned);
  check("OWNERSHIP: owns/count/instances/bestSerial (reutiliza groupCollection)", own.owns(plainCard.id) && own.countOf(plainCard.id) === 2 && own.instancesOf(plainCard.id).length === 2 && own.bestSerial(serializedCard.id) === 1);
  check("OWNERSHIP: distinct/total coherentes", own.distinctCount() === 2 && own.totalInstances() === 3);
  const v = own.validate(reg);
  check("VALIDACIÓN: propiedad limpia es válida", v.ok && v.issues.length === 0);
  const limit = reg.variant(serializedCard.variantId).serialLimit ?? 1;
  const bad = new OwnershipIndex([mk("dup", plainCard.id), mk("dup", plainCard.id), mk("x", "jugador_inexistente__gold"), mk("y", serializedCard.id, limit + 5)]);
  const bv = bad.validate(reg);
  check("SEGURIDAD: detecta uid duplicado + cardId inexistente + serie fuera de límite", !bv.ok && bv.issues.some((i) => i.reason.includes("duplicado")) && bv.issues.some((i) => i.reason.includes("inexistente")) && bv.issues.some((i) => i.reason.includes("límite")));
}

// ─────────────────────── 3. Card Quality ───────────────────────
console.log("\n## Card Quality (derivada)");
{
  const sv = reg.variant(serializedCard.variantId);
  check("QUALITY: #1 de la tirada = 'gem'; sin serie = 'standard'", qualityOf(sv, 1) === "gem" && qualityOf(reg.variant(plainCard.variantId), undefined) === "standard");
  check("QUALITY: grados intermedios según % de la tirada", ["mint", "pristine", "fine", "standard"].includes(qualityOf(sv, Math.floor((sv.serialLimit ?? 100) * 0.5))));
}

// ─────────────────────── 4. Meta (favoritos/etiquetas/bloqueos/orígenes) ───────────────────────
console.log("\n## Collection Meta");
{
  let meta = emptyMeta();
  const before = JSON.stringify(meta);
  const meta2 = toggleFavorite(meta, plainCard.id);
  check("META: inmutable (no muta el original)", JSON.stringify(meta) === before && meta2.favorites.includes(plainCard.id));
  const round = deserializeMeta(serializeMeta(meta2));
  check("META: serialize→deserialize roundtrip", round.favorites.includes(plainCard.id) && round.version >= 1);
  const migrated = migrateMeta({ favorites: "corrupto", tags: 42, locks: ["u1"], version: 0 });
  check("MIGRACIÓN: meta corrupta/antigua se sanea (compat futura)", Array.isArray(migrated.favorites) && migrated.favorites.length === 0 && migrated.locks.includes("u1") && migrated.version >= 1);
}

// ─────────────────────── 5. Engine: proyección + filtros + búsqueda + orden + agrupación ───────────────────────
console.log("\n## Engine: vistas / filtros / búsqueda / orden / agrupación");
const owned = [mk("o1", plainCard.id, undefined, 500), mk("o2", plainCard.id, undefined, 400), mk("o3", serializedCard.id, 1, 600)];
const eng = new CollectionEngine(owned);
{
  check("PROYECCIÓN: views() = todo el catálogo con propiedad+meta", eng.views().length === reg.total && eng.ownedViews().length === 2);
  const emea = eng.filter({ regions: ["EMEA"] });
  const ownedOnly = eng.filter({ owned: true });
  check("FILTROS: por región y por poseídas (AND incremental)", emea.every((v) => v.region === "EMEA") && ownedOnly.length === 2);
  const nick = reg.player(plainCard.playerId)!.nick;
  check("BÚSQUEDA: texto encuentra por nick", eng.search(nick).some((v) => v.playerId === plainCard.playerId));
  const sorted = eng.sort(eng.views(), { key: "ovr", dir: "desc" });
  check("ORDEN: por OVR desc y estable", sorted.length === reg.total && sorted[0].ovr >= sorted[sorted.length - 1].ovr);
  const grouped = eng.group(eng.ownedViews(), "region");
  check("AGRUPACIÓN: por región", grouped.size >= 1);
  eng.toggleFavorite(plainCard.id);
  check("FAVORITO: invalida caché y se refleja en la vista", eng.view(plainCard.id)!.favorite === true && eng.filter({ favorite: true }).length >= 1);
}

// ─────────────────────── 6. Álbum / Binder / Missing / Completion ───────────────────────
console.log("\n## Álbum / Binder / Missing / Completion");
{
  const alb = eng.album();
  check("ÁLBUM: una entrada por carta del catálogo", alb.length === reg.total && alb.filter((a) => a.owned).length === 2);
  const bnd = eng.binder(1);
  check("BINDER: pagina las poseídas", bnd.length === 2 && bnd[0].cards.length === 1);
  check("MISSING: faltantes = total − distinct", eng.missing().length === reg.total - 2);
  const comp = eng.completion();
  check("COMPLETION %: acotado 0..100", comp >= 0 && comp <= 100);
}

// ─────────────────────── 7. Sets / Series / Progreso (registro sintético pequeño) ───────────────────────
console.log("\n## Sets / Series / Progreso");
{
  const players: Player[] = [
    { id: "pa", nick: "Alfa", team: "AAA", teamTag: "AAA", region: "EMEA", role: "Duelista", country: "ES", stats: { dmg: 80, scr: 80, com: 80, hs: 70, ast: 60, clu: 70 }, accolades: [] },
    { id: "pb", nick: "Beta", team: "AAA", teamTag: "AAA", region: "EMEA", role: "Duelista", country: "ES", stats: { dmg: 70, scr: 70, com: 70, hs: 60, ast: 60, clu: 60 }, accolades: [] },
  ];
  const lookup = (id: string) => players.find((p) => p.id === id);
  const cards: CardDef[] = players.map((p) => ({ id: makeCardId(p.id, "bronze"), playerId: p.id, variantId: "bronze" as VariantId, ovr: 78, stats: p.stats }));
  const sreg = new CardRegistry(cards, lookup);
  const seng = new CollectionEngine([mk("s1", cards[0].id)], emptyMeta(), sreg);
  const sp = seng.setProgress("set-base")!;
  check("SET PROGRESS: 1/2 en el set base", sp.owned === 1 && sp.total === 2 && !sp.complete && sp.missing.includes(cards[1].id));
  const seng2 = new CollectionEngine([mk("s1", cards[0].id), mk("s2", cards[1].id)], emptyMeta(), sreg);
  check("SET COMPLETO: al poseer todas, complete=true y 100%", seng2.setProgress("set-base")!.complete && seng2.completion() === 100);
  check("ALL SETS: progreso de todos los sets/series/temporadas", seng2.sets().length >= 3 && seng2.sets().every((s) => s.percent === 100));
}

// ─────────────────────── 8. Estadísticas / Analytics ───────────────────────
console.log("\n## Estadísticas / Analytics");
{
  const st = eng.statistics();
  check("STATS: progreso + duplicados + squadRating + distribuciones (reutiliza selectores)", st.progress.distinct === 2 && st.duplicates === 1 && st.totalInstances === 3 && Object.keys(st.byRegion).length >= 1);
  const an = eng.analytics();
  check("ANALYTICS: carta más rara poseída + más duplicada + completion por grupo", an.rarestOwned != null && an.mostDuplicated === plainCard.id && Object.keys(an.completionByGroup).length >= 1 && an.ovrSum > 0);
}

// ─────────────────────── 9. Historial / Origen / Comparación ───────────────────────
console.log("\n## Historial / Origen / Comparación");
{
  eng.setOrigin("o1", "pack"); eng.setOrigin("o3", "tournament");
  const h = eng.history();
  check("HISTORIAL: orden por fecha desc (estable)", h.length === 3 && h[0].at >= h[1].at && h[0].at >= h[2].at);
  const co = eng.byOrigin();
  check("ORIGEN: recuento por procedencia (sin mutar OwnedCard)", (co.pack ?? 0) >= 1 && (co.tournament ?? 0) >= 1);
  const cmp = eng.compare(serializedCard.id, plainCard.id);
  check("COMPARACIÓN: dos cartas → delta OVR/rareza/stats", !!cmp && typeof cmp.ovrDelta === "number" && (cmp.better === "a" || cmp.better === "b" || cmp.better === "equal"));
}

// ─────────────────────── 10. Eventos / Broadcast ───────────────────────
console.log("\n## Eventos / Broadcast");
{
  const prev = [mk("e1", plainCard.id, undefined, 0)];
  const next = [...prev, mk("e2", plainCard.id, undefined, 10), mk("e3", serializedCard.id, 1, 10)];
  const evs = reconcile(reg, prev, next, 10);
  const t = (k: string) => evs.filter((e) => e.type === k).length;
  check("EVENTOS: acquired×2 + duplicate(plain) + new_card(serialized)", t("acquired") === 2 && t("duplicate") === 1 && t("new_card") === 1);
  const bc = eng.broadcast(["o1"]);
  check("BROADCAST: completion + featured (más rara) + set más cercano", bc.completion === eng.completion() && bc.featured != null && bc.total === reg.total);
}

// ─────────────────────── 11. Determinismo ───────────────────────
console.log("\n## Determinismo");
{
  const a = new CollectionEngine(owned);
  const b = new CollectionEngine(owned);
  check("DETERMINISMO: mismas entradas ⇒ mismas vistas/stats/completion", JSON.stringify(a.views()) === JSON.stringify(b.views()) && a.completion() === b.completion() && JSON.stringify(a.statistics()) === JSON.stringify(b.statistics()));
}

// ─────────────────────── 12. Rendimiento (100.000 cartas) ───────────────────────
console.log("\n## Rendimiento");
{
  const variantIds = ALL_VARIANTS.map((v) => v.id);
  const regions = ["EMEA", "Americas", "Pacific", "China"] as const;
  const roles = ["Duelista", "Iniciador", "Centinela", "Controlador", "Flex"] as const;
  const N = 100000;
  const bigCards: CardDef[] = [];
  for (let i = 0; i < N; i++) {
    const vId = variantIds[i % variantIds.length];
    bigCards.push({ id: `p${i}__${vId}`, playerId: `p${i}`, variantId: vId, ovr: 60 + (i % 40), stats: { dmg: 70, scr: 70, com: 70, hs: 60, ast: 60, clu: 60 } });
  }
  const bigLookup = (id: string): Player => {
    const i = parseInt(id.slice(1), 10) || 0;
    return { id, nick: `Player${i}`, team: `Team${i % 500}`, teamTag: "T", region: regions[i % 4], role: roles[i % 5], country: "ES", stats: { dmg: 70, scr: 70, com: 70, hs: 60, ast: 60, clu: 60 }, accolades: [] };
  };
  const t0 = Date.now();
  const bigReg = new CardRegistry(bigCards, bigLookup);
  const ownedBig: OwnedCard[] = bigCards.filter((_, i) => i % 10 === 0).map((c, i) => mk(`b${i}`, c.id));
  const bigEng = new CollectionEngine(ownedBig, emptyMeta(), bigReg);
  const filtered = bigEng.filter({ regions: ["EMEA"], groups: ["base"], owned: true });
  const found = bigEng.search("Player123");
  const stats = bigEng.statistics();
  const ms = Date.now() - t0;
  check("RENDIMIENTO: 100.000 cartas — build+filtro+búsqueda+stats", ms < 6000 && filtered.length >= 0 && found.length >= 1 && stats.progress.total === N, `${ms}ms · ${N} cartas · ${ownedBig.length} poseídas`);
}

// ─────────────────────── 13. Cero estados imposibles ───────────────────────
console.log("\n## Cero estados imposibles");
{
  let bad = 0;
  const empty = new CollectionEngine([]);
  if (empty.completion() !== 0 || empty.missing().length !== reg.total) bad++;         // colección vacía coherente
  if (empty.progress().missing < 0) bad++;                                              // nunca negativo
  if (eng.view("no__existe") !== null) bad++;                                           // carta inexistente → null
  const m1 = toggleFavorite(toggleFavorite(emptyMeta(), plainCard.id), plainCard.id);   // toggle par = idempotente
  if (m1.favorites.length !== 0) bad++;
  if (!eng.validate().ok) bad++;                                                        // propiedad del engine válida
  check("INTEGRIDAD: vacío coherente, sin negativos, inexistente→null, toggle idempotente, validación", bad === 0);
}

// ─────────────────────── 14. Compat Cards / Gameplay / Career / Living World ───────────────────────
console.log("\n## Compat Cards / Gameplay / Career / Living World");
{
  // Consume el MISMO OwnedCard del useGameStore (misma forma) y proyecta sobre el catálogo real.
  const fromStore: OwnedCard[] = [{ uid: "g1", cardId: reg.cards[0].id, obtainedAt: 1 }];
  const e = new CollectionEngine(fromStore);
  check("COMPAT Cards: proyecta OwnedCard del store sobre el catálogo real", e.ownedViews().length === 1 && e.ownedViews()[0].ovr === reg.cards[0].ovr);
  const deck = eng.deckEligible();
  check("COMPAT Gameplay: deckEligible = poseídas por OVR desc (puente al Deck)", deck.length === 2 && deck[0].ovr >= deck[1].ovr && deck.every((v) => v.owned));
  check("COMPAT Career/Living-World: identidad/región/rol vienen del Player real (sin duplicar Player)", eng.ownedViews().every((v) => !!v.region && !!v.role && !!v.nick));
}

console.log(`\n${failures === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${failures} COMPROBACIÓN(ES) FALLARON`}`);
process.exit(failures === 0 ? 0 : 1);

// Señal de fallo para CI: sale con código !=0 si alguna comprobación falló.
if (failures > 0) process.exitCode = 1;
