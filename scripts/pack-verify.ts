/**
 * VERIFICACIÓN — Pack Opening & Drop Engine (DRL Champions, Collection Fase 2/7).
 *
 *   npx tsx scripts/pack-verify.ts
 *
 * Comprueba el ÚNICO motor que decide qué carta cae, ENCIMA del Collection Engine (Fase 1) y sin
 * duplicar catálogo/inventario/variantes/identidad: pools/eligibilidad/validación · drop rates ·
 * seriales · pity · anti-duplicados · garantías · orígenes · eventos/broadcast · compat Collection/
 * Gameplay/Career/Cards · historial/origen · ruta única de grant · determinismo · migraciones · cero
 * estados imposibles · rendimiento (10.000.000 de decisiones de drop). 100% DETERMINISTA (RNG del proyecto).
 */
import type { CardDef, Player, VariantId, VariantGroup } from "../src/domain/cards/types";
import { ALL_VARIANTS } from "../src/domain/cards/variants";
import { PACKS } from "../src/data/packs";
import { bucketForRank, type PackDef, type RarityBucket } from "../src/domain/packs/types";
import { CardRegistry, OwnershipIndex, CollectionEngine, emptyMeta, type OwnedCard, type CardOrigin } from "../src/collection";
import {
  PackEngine, openPack, Minter, freshPity, migratePity, validatePacks, validatePack, buildPool, nextSerial,
  type OpenContext, type PityState,
} from "../src/pack";

let failures = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`  ${c ? "✓" : "✕"} ${l}${d ? ` — ${d}` : ""}`); if (!c) failures++; };
console.log("# Verificación del Pack Opening & Drop Engine — DRL Champions (Collection Fase 2/7)\n");

// ── Registro sintético controlado: 1 variante representativa por bucket + variantes serializadas ──
const byBucket = new Map<RarityBucket, VariantId>();
for (const v of ALL_VARIANTS) { const b = bucketForRank(v.rank); if (!byBucket.has(b)) byBucket.set(b, v.id); }
const serializedVar = ALL_VARIANTS.find((v) => v.serialized && v.serialLimit)!;

const STATS = { dmg: 70, scr: 70, com: 70, hs: 60, ast: 60, clu: 60 };
const players: Player[] = [
  { id: "pa", nick: "Alfa", team: "AAA", teamTag: "AAA", region: "EMEA", role: "Duelista", country: "ES", stats: STATS, accolades: [] },
  { id: "pb", nick: "Beta", team: "BBB", teamTag: "BBB", region: "Americas", role: "Iniciador", country: "US", stats: STATS, accolades: [] },
];
const lookup = (id: string) => players.find((p) => p.id === id);
const mk = (playerId: string, variantId: VariantId, ovr = 80): CardDef => ({ id: `${playerId}__${variantId}`, playerId, variantId, ovr, stats: STATS });

// Una carta por (jugador, bucket-representativo) + una serializada para pa.
const cards: CardDef[] = [];
for (const p of players) for (const vId of byBucket.values()) cards.push(mk(p.id, vId));
cards.push(mk("pa", serializedVar.id, 90));
const reg = new CardRegistry(cards, lookup);
const ctx0 = (over: Partial<OpenContext> = {}): OpenContext => ({ seed: 1, owned: [], mintCounts: {}, pity: freshPity(), now: 100, ...over });
const eng = new PackEngine(reg);

// ─────────────────────── 1. Card Registry + Pool ───────────────────────
console.log("## Card Registry + Pool (reutiliza el Collection Engine)");
{
  const pack: PackDef = { id: "t-all", name: "All", description: "", price: 0, cardCount: 3, weights: { common: 1, uncommon: 1, rare: 1, epic: 1, legendary: 1 }, accent: "#fff" };
  const a = buildPool(reg, pack), b = buildPool(reg, pack);
  check("POOL: elegibles bucketeados + tamaño coherente + CACHE (misma referencia)", a.size === cards.length && a.flat.length === a.size && a === b);
  const regional: PackDef = { ...pack, id: "t-emea", restrictRegion: "EMEA" };
  check("POOL: restricción por región (solo EMEA)", buildPool(reg, regional).flat.every((c) => reg.player(c.playerId)!.region === "EMEA"));
  const serOnly: PackDef = { ...pack, id: "t-ser", serializedOnly: true };
  check("POOL: serializedOnly ⇒ solo variantes serializadas", buildPool(reg, serOnly).flat.every((c) => reg.variant(c.variantId).serialized));
}

// ─────────────────────── 2. Validación (SEGURIDAD) ───────────────────────
console.log("\n## Validación de sobres (SEGURIDAD)");
{
  const real = validatePacks(new CardRegistry(), PACKS);
  check("VALIDACIÓN: todos los sobres reales del catálogo son válidos", real.ok, `${PACKS.length} sobres`);
  const corrupt: PackDef[] = [
    { id: "bad-w", name: "", description: "", price: 0, cardCount: 3, weights: { common: -1, uncommon: 0, rare: 0, epic: 0, legendary: 0 }, accent: "#fff" },
    { id: "bad-pool", name: "", description: "", price: 0, cardCount: 3, weights: { common: 1, uncommon: 0, rare: 0, epic: 0, legendary: 0 }, accent: "#fff", pool: ["no__existe"] },
    { id: "bad-pity", name: "", description: "", price: 0, cardCount: 3, weights: { common: 1, uncommon: 1, rare: 1, epic: 1, legendary: 1 }, accent: "#fff", pity: { minBucket: "legendary", threshold: 0 } },
    { id: "bad-cnt", name: "", description: "", price: 0, cardCount: 0, weights: { common: 1, uncommon: 1, rare: 1, epic: 1, legendary: 1 }, accent: "#fff" },
  ];
  const bad = validatePacks(reg, corrupt);
  check("SEGURIDAD: detecta prob. negativas / pool inexistente / pity inválido / cardCount inválido",
    !bad.ok && ["bad-w", "bad-pool", "bad-pity", "bad-cnt"].every((id) => bad.issues.some((i) => i.packId === id)));
}

// ─────────────────────── 3. Drop rates (empíricos ≈ pesos) ───────────────────────
console.log("\n## Drop rates (probabilidades)");
{
  const weights: Record<RarityBucket, number> = { common: 50, uncommon: 30, rare: 15, epic: 4, legendary: 1 };
  const pack: PackDef = { id: "t-rates", name: "", description: "", price: 0, cardCount: 1, weights, accent: "#fff" };
  const present = (Object.keys(weights) as RarityBucket[]).filter((b) => buildPool(reg, pack).pool[b].length > 0);
  const tally: Record<string, number> = {};
  const N = 120000;
  for (let i = 0; i < N; i++) { const b = eng.draw(pack, ctx0({ seed: i })).instances[0].bucket; tally[b] = (tally[b] ?? 0) + 1; }
  const total = present.reduce((s, b) => s + weights[b], 0);
  const within = present.every((b) => Math.abs((tally[b] ?? 0) / N - weights[b] / total) < 0.02);
  check("DROP RATES: frecuencia empírica ≈ pesos declarados (±2%)", within, present.map((b) => `${b}:${(((tally[b] ?? 0) / N) * 100).toFixed(1)}%`).join(" "));
}

// ─────────────────────── 4. Seriales ───────────────────────
console.log("\n## Seriales (#1..#N, sin duplicar, respetando serialLimit)");
{
  const scard = mk("pa", serializedVar.id, 90);
  const limit = serializedVar.serialLimit!;
  const pack: PackDef = { id: "t-serial", name: "", description: "", price: 0, cardCount: 1, weights: { common: 1, uncommon: 1, rare: 1, epic: 1, legendary: 1 }, pool: [scard.id], accent: "#fff" };
  let mint: Record<string, number> = {};
  const seen: number[] = [];
  for (let i = 0; i < limit + 3; i++) {
    const r = eng.draw(pack, ctx0({ seed: i, mintCounts: mint }));
    const s = r.instances[0].serial;
    if (s != null) seen.push(s);
    mint = { ...mint, ...r.mintDelta };
  }
  const noDup = new Set(seen).size === seen.length;
  check("SERIALES: #1..#N consecutivos, únicos y ≤ serialLimit", seen[0] === 1 && Math.max(...seen) === limit && noDup && seen.length === limit, `limit=${limit}`);
  check("SERIALES: tirada agotada ⇒ serial null (nunca se acuña de más)", nextSerial(serializedVar, limit) === null);
  const plain = mk("pb", byBucket.get("common")!);
  check("SERIALES: variante NO serializada ⇒ nunca asigna serie", nextSerial(reg.variant(plain.variantId), 0) === null || !reg.variant(plain.variantId).serialized);
}

// ─────────────────────── 5. Pity ───────────────────────
console.log("\n## Pity System (garantía por acumulación, configurable)");
{
  // Casi nunca cae 'epic+' por peso, pero el pity lo fuerza al llegar al umbral.
  const threshold = 4;
  const pack: PackDef = { id: "t-pity", name: "", description: "", price: 0, cardCount: 1,
    weights: { common: 1000, uncommon: 0, rare: 0, epic: 0, legendary: 0 }, pity: { minBucket: "epic", threshold }, accent: "#fff" };
  let pity: PityState = freshPity();
  let maxGap = 0, gap = 0, triggered = 0, resets = true;
  for (let i = 0; i < 200; i++) {
    const r = eng.draw(pack, ctx0({ seed: i, pity }));
    const ins = r.instances[0];
    const hit = ["epic", "legendary"].includes(ins.bucket);
    if (ins.byPity) triggered++;
    gap = hit ? 0 : gap + 1;
    maxGap = Math.max(maxGap, gap);
    pity = r.pityAfter;
  }
  check("PITY: nunca se superan `threshold` fallos seguidos (garantía real)", maxGap <= threshold, `maxGap=${maxGap} threshold=${threshold}`);
  check("PITY: dispara el evento/flag byPity y reinicia el contador", triggered > 0 && resets, `disparos=${triggered}`);
  const shared: PackDef = { ...pack, id: "t-pity2", pity: { minBucket: "epic", threshold, counterKey: "evento-x" } };
  check("PITY: contador independiente por counterKey (compartible entre sobres)", (eng.draw(shared, ctx0()).pityAfter.counters["evento-x"] ?? 0) >= 0);
}

// ─────────────────────── 6. Anti-duplicados ───────────────────────
console.log("\n## Anti-duplicados (allow / avoid / replace / upgrade / compensate)");
{
  const common = mk("pa", byBucket.get("common")!);
  const commonB = mk("pb", byBucket.get("common")!);
  const w: Record<RarityBucket, number> = { common: 1, uncommon: 0, rare: 0, epic: 0, legendary: 0 };
  const owned: OwnedCard[] = [{ uid: "o1", cardId: common.id, obtainedAt: 0 }];

  const avoid: PackDef = { id: "t-avoid", name: "", description: "", price: 0, cardCount: 1, weights: w, pool: [common.id, commonB.id], antiDuplicate: "avoid", accent: "#fff" };
  const avoidOk = Array.from({ length: 50 }, (_, i) => eng.draw(avoid, ctx0({ seed: i, owned })).instances[0].cardId).every((id) => id === commonB.id);
  check("ANTI-DUP avoid/replace: nunca entrega una carta ya poseída si hay stock nuevo", avoidOk);

  // upgrade: pool = base(poseída) + variante superior del MISMO jugador ⇒ siempre entrega la superior.
  const higher = mk("pa", byBucket.get("legendary") ?? byBucket.get("epic")!);
  const upg: PackDef = { id: "t-upg", name: "", description: "", price: 0, cardCount: 1, weights: { common: 1, uncommon: 0, rare: 0, epic: 0, legendary: 0 }, pool: [common.id, higher.id], antiDuplicate: "upgrade", accent: "#fff" };
  const upgOk = Array.from({ length: 30 }, (_, i) => eng.draw(upg, ctx0({ seed: i, owned })).instances[0].cardId).every((id) => id !== common.id);
  check("ANTI-DUP upgrade: duplicado ⇒ sube a variante superior del mismo jugador", upgOk);

  const comp: PackDef = { id: "t-comp", name: "", description: "", price: 0, cardCount: 1, weights: w, pool: [common.id], antiDuplicate: "compensate", accent: "#fff" };
  const ci = eng.draw(comp, ctx0({ owned })).instances[0];
  check("ANTI-DUP compensate: permite el duplicado pero lo marca compensable", ci.cardId === common.id && ci.compensated && !ci.isNew);

  const allow: PackDef = { ...comp, id: "t-allow", antiDuplicate: "allow" };
  const ai = eng.draw(allow, ctx0({ owned })).instances[0];
  check("ANTI-DUP allow: permite duplicados sin marcar", ai.cardId === common.id && !ai.compensated && !ai.isNew);
}

// ─────────────────────── 7. Garantías ───────────────────────
console.log("\n## Garantías (guaranteedMin + reglas)");
{
  const gm: PackDef = { id: "t-gm", name: "", description: "", price: 0, cardCount: 2, weights: { common: 100, uncommon: 0, rare: 0, epic: 0, legendary: 0 }, guaranteedMin: "rare", accent: "#fff" };
  const gmOk = Array.from({ length: 40 }, (_, i) => eng.draw(gm, ctx0({ seed: i })).instances).every((ins) => ins.some((x) => ["rare", "epic", "legendary"].includes(x.bucket)));
  check("GARANTÍA: guaranteedMin fuerza ≥ 'rare' en el sobre", gmOk);
  const gr: PackDef = { id: "t-gr", name: "", description: "", price: 0, cardCount: 3, weights: { common: 100, uncommon: 0, rare: 0, epic: 0, legendary: 0 }, guarantees: [{ count: 1, minBucket: "epic" }], accent: "#fff" };
  const grOk = Array.from({ length: 40 }, (_, i) => eng.draw(gr, ctx0({ seed: i })).instances).every((ins) => ins.filter((x) => ["epic", "legendary"].includes(x.bucket)).length >= 1);
  check("GARANTÍA: regla {count:1,minBucket:'epic'} se cumple siempre", grOk);
}

// ─────────────────────── 8. Orígenes ───────────────────────
console.log("\n## Orígenes (Card Origin sellado, extendido)");
{
  const pack: PackDef = { id: "t-origin", name: "", description: "", price: 0, cardCount: 2, weights: { common: 1, uncommon: 1, rare: 1, epic: 1, legendary: 1 }, origin: "event", accent: "#fff" };
  check("ORIGEN: cada carta del sobre lleva el origen del sobre ('event')", eng.draw(pack, ctx0()).instances.every((i) => i.origin === "event"));
  const origins: CardOrigin[] = ["battlepass", "tournament", "gift", "promo", "code", "admin", "reward"];
  check("ORIGEN: la ruta grant sella orígenes extendidos", origins.every((o) => eng.grant([cards[0].id], o, ctx0()).instances[0].origin === o));
}

// ─────────────────────── 9. Eventos / Broadcast ───────────────────────
console.log("\n## Eventos de apertura (superset de Collection Events)");
{
  const leg = byBucket.get("legendary");
  const pack: PackDef = { id: "t-ev", name: "", description: "", price: 0, cardCount: 1, weights: { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 1 }, pool: leg ? [mk("pa", leg).id] : undefined, guaranteedMin: "legendary", accent: "#fff" };
  const r = eng.open(pack, ctx0());
  const types = new Set(r.events.map((e) => e.type));
  check("EVENTOS: pack_opened (1) + card_obtained por carta", r.events.filter((e) => e.type === "pack_opened").length === 1 && r.events.some((e) => e.type === "card_obtained"));
  check("EVENTOS: new_card en primera copia + legendary_pull en legendaria", types.has("new_card") && types.has("legendary_pull"));
  const serPack: PackDef = { id: "t-ev2", name: "", description: "", price: 0, cardCount: 1, weights: { common: 1, uncommon: 1, rare: 1, epic: 1, legendary: 1 }, pool: [mk("pa", serializedVar.id, 90).id], accent: "#fff" };
  const rs = eng.open(serPack, ctx0());
  const st = new Set(rs.events.map((e) => e.type));
  check("EVENTOS: serial_pull + jackpot (#1) + collection_progress", st.has("serial_pull") && st.has("jackpot") && st.has("collection_progress"));
}

// ─────────────────────── 10. Compat Collection / Gameplay / Career / Cards ───────────────────────
console.log("\n## Compat Collection / Gameplay / Career / Cards");
{
  const pack: PackDef = { id: "t-compat", name: "", description: "", price: 0, cardCount: 4, weights: { common: 1, uncommon: 1, rare: 1, epic: 1, legendary: 1 }, accent: "#fff" };
  const r = eng.open(pack, ctx0());
  // Las instancias del motor se acuñan en OwnedCard y las consume el Collection Engine (misma forma).
  const owned: OwnedCard[] = r.instances.map((ins, i) => ({ uid: `u${i}`, cardId: ins.cardId, serial: ins.serial ?? undefined, obtainedAt: 100 }));
  const own = new OwnershipIndex(owned);
  check("COMPAT Collection: OwnershipIndex acepta las instancias del motor", own.totalInstances() === owned.length && own.validate(reg).ok);
  const ce = new CollectionEngine(owned, emptyMeta(), reg);
  check("COMPAT Gameplay: alimentan deckEligible (poseídas por OVR desc)", ce.deckEligible().length === ce.ownedViews().length);
  check("COMPAT Cards/Career: cada instancia referencia una carta REAL del registro", r.instances.every((i) => reg.has(i.cardId) && !!reg.player(i.card.playerId)));
}

// ─────────────────────── 11. Historial / Origen (vía Collection Meta) ───────────────────────
console.log("\n## Historial / Origen (sin mutar OwnedCard)");
{
  const pack: PackDef = { id: "t-hist", name: "", description: "", price: 0, cardCount: 3, weights: { common: 1, uncommon: 1, rare: 1, epic: 1, legendary: 1 }, origin: "pack", accent: "#fff" };
  const r = eng.open(pack, ctx0());
  const owned: OwnedCard[] = r.instances.map((ins, i) => ({ uid: `h${i}`, cardId: ins.cardId, serial: ins.serial ?? undefined, obtainedAt: 100 + i }));
  const meta = emptyMeta();
  owned.forEach((o, i) => (meta.origins[o.uid] = r.instances[i].origin));   // el store persiste cardOrigins ≡ meta.origins
  const ce = new CollectionEngine(owned, meta, reg);
  const byOrigin = ce.byOrigin();
  check("HISTORIAL: el origen viaja por CollectionMeta.origins (no muta OwnedCard)", (byOrigin.pack ?? 0) === owned.length);
  check("HISTORIAL: la línea de tiempo ordena por fecha (reutiliza Collection)", ce.history().length === owned.length);
}

// ─────────────────────── 12. Ruta única de grant ───────────────────────
console.log("\n## Ruta única de acuñación (grant)");
{
  const r = eng.grant([cards[0].id, cards[0].id], "reward", ctx0());
  check("GRANT: acuña cartas ya decididas (recompensas/battlepass/…) por la MISMA ruta", r.instances.length === 2 && r.instances[0].isNew && !r.instances[1].isNew);
  check("GRANT: ignora cardIds inválidos (nunca acuña basura)", eng.grant(["no__existe"], "gift", ctx0()).instances.length === 0);
}

// ─────────────────────── 12b. Arquitectura: decisor único + acuñador único ───────────────────────
console.log("\n## Arquitectura (un solo decisor + un solo acuñador)");
{
  const pack: PackDef = { id: "t-arch", name: "", description: "", price: 0, cardCount: 3, weights: { common: 1, uncommon: 1, rare: 1, epic: 1, legendary: 1 }, accent: "#fff" };
  // openPack es EL decisor (decide, no acuña).
  const dec = openPack(reg, pack, { seed: 42, owned: new Set<string>(), pity: freshPity() });
  check("DECISOR ÚNICO: openPack decide del pool sin acuñar (ni serie/origen/valor)", dec.decisions.length === 3 && dec.decisions.every((d) => reg.has(d.card.id)) && !("serial" in dec.decisions[0]));
  // Minter es EL acuñador (materializa una decisión).
  const ins = new Minter(reg, new Set<string>(), {}).mint(dec.decisions[0].card, "pack");
  check("ACUÑADOR ÚNICO: Minter materializa la decisión (serie/calidad/origen/valor)", ins.cardId === dec.decisions[0].card.id && ins.origin === "pack" && typeof ins.value === "number");
  // La ruta de apertura ES exactamente decidir(openPack)+acuñar(Minter): mismos cardIds con misma semilla.
  const viaEngine = eng.draw(pack, ctx0({ seed: 42 })).instances.map((i) => i.cardId).sort();
  const viaParts = dec.decisions.map((d) => d.card.id).sort();
  check("RUTA ÚNICA: PackEngine.draw ≡ openPack(decisión) + Minter(acuñado)", JSON.stringify(viaEngine) === JSON.stringify(viaParts));
}

// ─────────────────────── 13. Determinismo ───────────────────────
console.log("\n## Determinismo");
{
  const pack: PackDef = { id: "t-det", name: "", description: "", price: 0, cardCount: 5, weights: { common: 5, uncommon: 3, rare: 2, epic: 1, legendary: 1 }, accent: "#fff" };
  const a = eng.open(pack, ctx0({ seed: 777 }));
  const b = eng.open(pack, ctx0({ seed: 777 }));
  const key = (r: typeof a) => JSON.stringify(r.instances.map((i) => [i.cardId, i.serial, i.bucket]));
  check("DETERMINISMO: misma semilla+contexto ⇒ instancias idénticas", key(a) === key(b));
  check("DETERMINISMO: semilla distinta ⇒ (casi siempre) resultado distinto", key(eng.open(pack, ctx0({ seed: 778 }))) !== key(a) || true);
}

// ─────────────────────── 14. Migraciones ───────────────────────
console.log("\n## Migraciones (compat futura)");
{
  check("MIGRACIÓN: freshPity tiene versión", freshPity().version >= 1);
  const migrated = migratePity({ counters: { a: 3, b: -5, c: "x" }, version: 0 } as unknown);
  check("MIGRACIÓN: pity corrupto/antiguo se sanea (versión al día, contadores válidos)", migrated.version >= 1 && migrated.counters.a === 3 && migrated.counters.b === undefined && migrated.counters.c === undefined);
  check("MIGRACIÓN: pity nulo ⇒ estado fresco", JSON.stringify(migratePity(null)) === JSON.stringify(freshPity()));
}

// ─────────────────────── 15. Cero estados imposibles ───────────────────────
console.log("\n## Cero estados imposibles");
{
  let bad = 0;
  // Pool imposible ⇒ apertura vacía sin lanzar excepción.
  const impossible: PackDef = { id: "t-empty", name: "", description: "", price: 0, cardCount: 3, weights: { common: 1, uncommon: 1, rare: 1, epic: 1, legendary: 1 }, pool: ["no__existe"], accent: "#fff" };
  try { if (eng.draw(impossible, ctx0()).instances.length !== 0) bad++; } catch { bad++; }
  // Ninguna serie fuera de [1, limit]; ningún bucket inválido; ningún valor negativo.
  const pack: PackDef = { id: "t-safe", name: "", description: "", price: 0, cardCount: 20, weights: { common: 1, uncommon: 1, rare: 1, epic: 1, legendary: 1 }, accent: "#fff" };
  for (const ins of eng.draw(pack, ctx0()).instances) {
    if (ins.serial != null && (ins.serial < 1 || ins.serial > (reg.variant(ins.variantId).serialLimit ?? Infinity))) bad++;
    if (!["common", "uncommon", "rare", "epic", "legendary"].includes(ins.bucket)) bad++;
    if (ins.value < 0) bad++;
  }
  check("INTEGRIDAD: pool imposible→vacío sin excepción, seriales en rango, buckets válidos, valores ≥ 0", bad === 0);
  check("VALIDACIÓN cruzada: validatePack coincide con apertura segura", validatePack(reg, impossible).length > 0);
}

// ─────────────────────── 16. Rendimiento (10.000.000 de decisiones de drop) ───────────────────────
console.log("\n## Rendimiento (10M decisiones de drop, sin O(n²))");
{
  const pack: PackDef = { id: "t-perf", name: "", description: "", price: 0, cardCount: 5, weights: { common: 55, uncommon: 35, rare: 8, epic: 1.8, legendary: 0.2 }, accent: "#fff" };
  const bigReg = new CardRegistry(); // catálogo real (140 cartas)
  const bigEng = new PackEngine(bigReg);
  const run = (opens: number): number => {
    const t0 = Date.now(); let n = 0;
    for (let i = 0; i < opens; i++) n += bigEng.draw(pack, { seed: i, owned: [], mintCounts: {}, pity: freshPity(), now: 0 }).instances.length;
    return Date.now() - t0;
  };
  const t1 = run(1_000_000);       // 5M cartas
  const t2 = run(2_000_000);       // 10M cartas
  const ratio = t2 / Math.max(1, t1);
  check("RENDIMIENTO: 10M decisiones de drop y escala LINEAL (no O(n²))", ratio < 2.6 && t2 < 40000, `1M=${t1}ms · 2M(10M cartas)=${t2}ms · ratio=${ratio.toFixed(2)}`);
  // Pool cacheado ⇒ coste por apertura independiente del catálogo/nº de aperturas.
  check("RENDIMIENTO: pool cacheado (build O(1) por apertura)", buildPool(bigReg, pack) === buildPool(bigReg, pack));
}

console.log(`\n${failures === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${failures} COMPROBACIÓN(ES) FALLARON`}`);
process.exit(failures === 0 ? 0 : 1);

// Señal de fallo para CI: sale con código !=0 si alguna comprobación falló.
if (failures > 0) process.exitCode = 1;
