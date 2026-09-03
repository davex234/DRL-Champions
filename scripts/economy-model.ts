/**
 * MODELO ECONÓMICO — NEXUS (Fase 12).
 *
 *   npm run economy:model
 *   npm run economy:model -- --n 20000
 *
 * ────────────────────────── QUÉ ES Y QUÉ NO ES ──────────────────────────
 *
 * Es una herramienta de MEDICIÓN. No toca la base de datos, no forma parte del producto y
 * no cambia ni un número del juego. Su único trabajo es responder, con cifras, a las
 * preguntas que la Fase 12 plantea antes de permitir ninguna decisión:
 *
 *   ¿Qué contiene realmente un sobre, y con cuánta varianza?
 *   ¿Qué relación hay entre lo que cuesta un sobre y lo que vale lo que sale?
 *   ¿Puede el bucle SOBRE → CARTA → DESGUACE generar créditos infinitos?
 *   ¿Qué pasaría en un mercado de 100, 1.000, 10.000 y 100.000 transacciones?
 *
 * `economy:simulate` responde «cómo le va a un jugador a lo largo de una temporada».
 * Esto responde «cómo están calibradas las piezas». Son preguntas distintas y por eso son
 * dos herramientas.
 *
 * ────────────────────────── DE DÓNDE SALEN LOS NÚMEROS ──────────────────────────
 *
 *   · El sorteo            → el motor real (`runtimePackEngine`), no una aproximación
 *   · Precio y contenido   → `data/packs`
 *   · El catálogo          → `data/catalog` (772 cartas)
 *   · Tasación             → `domain/economy/pricing`
 *   · Desguace             → `domain/economy/salvage`
 *   · Comisión y banda     → los valores por defecto de `market_config` (migración 0004)
 *
 * Nada se inventa aquí. Lo único propio del fichero son los TAMAÑOS DE MUESTRA y los
 * escenarios de mercado, declarados como constantes para poder discutirlos.
 *
 * ────────────────────────── REPRODUCIBILIDAD ──────────────────────────
 *
 * Todo va con semilla fija (`SEED`). Dos ejecuciones con los mismos argumentos dan
 * exactamente el mismo resultado, que es la diferencia entre una medición y una anécdota.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { runtimePackEngine, runtimeRegistry } from "@/publisher/runtime";
import { PACKS } from "@/data/packs";
import { CARDS, getCard } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";
import { bucketForRank, type RarityBucket } from "@/domain/packs/types";
import { buildPool } from "@/domain/packs/pool";
import { marketValue, instanceValue } from "@/domain/economy/pricing";
import { salvageValue, SALVAGE_BY_BUCKET } from "@/domain/economy/salvage";
import type { OwnedCard, CardDef } from "@/domain/cards/types";

const SEED = 90210;
const BUCKETS: RarityBucket[] = ["common", "uncommon", "rare", "epic", "legendary"];

/** Comisión y banda de precio por defecto en `market_config` (migración 0004). */
const MARKET = { taxBps: 500, minMult: 0.2, maxMult: 10 };

// ───────────────────────────── Utilidades ─────────────────────────────

const fmt = (n: number): string => Math.round(n).toLocaleString("es-ES");
const pad = (s: string | number, n: number): string => String(s).padStart(n);
const padr = (s: string | number, n: number): string => String(s).padEnd(n);

/** Percentil por interpolación lineal sobre una muestra YA ordenada. */
function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

function title(n: number, t: string): void {
  console.log("\n" + "=".repeat(78) + "\n  SECCION " + n + " · " + t + "\n" + "=".repeat(78));
}

const bucketOf = (card: CardDef): RarityBucket => bucketForRank(getVariant(card.variantId).rank);

/** Sobres que se compran con créditos. `inicial` es gratis: no entra en ninguna ratio. */
const PAID = PACKS.filter((p) => p.price > 0);

// ═════════════════════════ 1 · EL CATÁLOGO ═════════════════════════

function sectionCatalog(): void {
  title(1, "EL CATALOGO: CUANTAS CARTAS HAY DE CADA RAREZA");

  const stats = new Map<RarityBucket, number[]>(BUCKETS.map((b) => [b, []]));
  for (const c of CARDS) stats.get(bucketOf(c))!.push(marketValue(c));

  console.log("  " + padr("bucket", 11) + pad("cartas", 8) + pad("% catalogo", 12) + pad("mv medio", 10)
    + pad("mv mediana", 12) + pad("desguace", 10) + pad("mv/desguace", 13));
  console.log("  " + "-".repeat(76));
  for (const b of BUCKETS) {
    const v = stats.get(b)!.sort((x, y) => x - y);
    if (v.length === 0) continue;
    const mean = v.reduce((a, x) => a + x, 0) / v.length;
    const sv = SALVAGE_BY_BUCKET[b];
    console.log("  " + padr(b, 11) + pad(v.length, 8) + pad((100 * v.length / CARDS.length).toFixed(1) + " %", 12)
      + pad(fmt(mean), 10) + pad(fmt(pct(v, 0.5)), 12) + pad(fmt(sv), 10) + pad((mean / sv).toFixed(1) + "x", 13));
  }
  console.log("\n  Total: " + CARDS.length + " cartas.");
}

// ═════════════════════════ 2 · VALOR DE UN SOBRE ═════════════════════════

interface PackStats {
  id: string; price: number; cards: number; n: number;
  mean: number; p10: number; p25: number; p50: number; p75: number; p90: number; max: number;
  instanceMean: number;
  salvageMean: number;
  drawn: Record<RarityBucket, number>;
  totalDrawn: number;
}

/**
 * Abre `n` sobres con la colección VACÍA en cada apertura.
 *
 * Es deliberado: aquí se mide el CONTENIDO del sobre, no lo que le pasa a un jugador
 * concreto. Mezclar las dos cosas es lo que hace que una medición de valor dependa de
 * cuántas cartas tenía ya quien abrió, que es justo lo que no queremos.
 */
function measurePack(packId: string, n: number): PackStats {
  const pack = PACKS.find((p) => p.id === packId)!;
  const totals: number[] = [];
  const salvages: number[] = [];
  const drawn = Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<RarityBucket, number>;
  let totalDrawn = 0;
  let pity = { version: 1, counters: {} } as never;

  const instances: number[] = [];
  for (let i = 0; i < n; i++) {
    const r = runtimePackEngine().open(pack, {
      seed: SEED + i * 7919, owned: [] as OwnedCard[], mintCounts: {}, pity, now: 0,
    });
    pity = r.pityAfter as never;
    let mv = 0, sv = 0, iv = 0;
    for (const ins of r.instances as { cardId: string; serial?: number }[]) {
      const def = getCard(ins.cardId);
      if (!def) continue;
      mv += marketValue(def);
      iv += instanceValue(def, ins.serial);
      sv += salvageValue(def);
      drawn[bucketOf(def)]++;
      totalDrawn++;
    }
    totals.push(mv);
    instances.push(iv);
    salvages.push(sv);
  }

  totals.sort((a, b) => a - b);
  return {
    id: pack.id, price: pack.price, cards: pack.cardCount, n,
    mean: totals.reduce((a, x) => a + x, 0) / n,
    p10: pct(totals, 0.10), p25: pct(totals, 0.25), p50: pct(totals, 0.50),
    p75: pct(totals, 0.75), p90: pct(totals, 0.90), max: totals[totals.length - 1],
    instanceMean: instances.reduce((a, x) => a + x, 0) / n,
    salvageMean: salvages.reduce((a, x) => a + x, 0) / n,
    drawn, totalDrawn,
  };
}

/**
 * LAS TRES COTAS DEL VALOR DE UNA CARTA.
 *
 * La Fase 12 pregunta qué es `marketValue`. La respuesta no se decide: se acota, y para
 * acotarla hacen falta las dos cifras entre las que tiene que caer.
 *
 *   COTA INFERIOR — el desguace. Es lo que el JUEGO paga por un duplicado, así que ningún
 *   jugador racional vende por debajo: siempre tiene esa alternativa garantizada.
 *
 *   COTA SUPERIOR — lo que cuesta sacar ESA carta concreta de sobres. Nadie paga a otro
 *   jugador más de lo que le costaría conseguirla él mismo abriendo.
 *
 * Entre esas dos vive el precio de cualquier carta en cualquier mercado de cromos. Si
 * `marketValue` cae dentro, es una referencia defendible aunque su escala sea arbitraria.
 * Si cae fuera, está mal y hay que moverla.
 *
 * El coste de tirada sale de la MEDICIÓN, no de los pesos declarados: se cuentan las cartas
 * de cada bucket realmente sorteadas y se reparte uniformemente entre las cartas que
 * existen de ese bucket. Ese reparto uniforme es una aproximación —el motor pondera dentro
 * del bucket— y por eso se declara aquí en vez de esconderse.
 */
interface Bounds { anyOfBucket: number; thisCard: number }

function pullCosts(s: PackStats): Partial<Record<RarityBucket, Bounds>> {
  const out: Partial<Record<RarityBucket, Bounds>> = {};
  for (const b of BUCKETS) {
    const inBucket = CARDS.filter((c) => bucketOf(c) === b).length;
    if (inBucket === 0) continue;
    // Cartas de este bucket que salen, de media, por sobre abierto.
    const perPack = s.drawn[b] / s.n;
    if (perPack <= 0) continue;
    out[b] = { anyOfBucket: s.price / perPack, thisCard: s.price / (perPack / inBucket) };
  }
  return out;
}

function sectionValueBounds(all: PackStats[]): void {
  title(4, "QUE ES marketValue: LAS TRES COTAS DEL VALOR DE UNA CARTA");
  console.log("  DESGUACE      lo que el juego paga por un duplicado. Nadie vende por debajo:");
  console.log("                siempre tiene esa alternativa garantizada.");
  console.log("  RAREZA        lo que cuesta sacar UNA carta de esa rareza abriendo sobres.");
  console.log("                Es la cota que de verdad decide: quien quiere 'una legendaria'");
  console.log("                compara con esto, no con una carta concreta.");
  console.log("  CARTA EXACTA  lo que cuesta sacar ESA carta. Cota superior absoluta, y muy");
  console.log("                laxa: con 772 cartas, apuntar a una sola sale carisimo.\n");

  for (const id of ["estandar", "premium"]) {
    const s = all.find((x) => x.id === id)!;
    const pc = pullCosts(s);
    console.log("  Abriendo sobres " + id.toUpperCase() + " (" + fmt(s.price) + " cr):\n");
    console.log("  " + padr("bucket", 11) + pad("desguace", 10) + pad("marketValue", 13)
      + pad("coste rareza", 14) + pad("coste carta exacta", 20) + pad("mv / rareza", 13) + "  veredicto");
    console.log("  " + "-".repeat(96));
    for (const b of BUCKETS) {
      const v = CARDS.filter((c) => bucketOf(c) === b).map(marketValue);
      const bd = pc[b];
      if (v.length === 0 || !bd) continue;
      const mean = v.reduce((a, x) => a + x, 0) / v.length;
      const sv = SALVAGE_BY_BUCKET[b];
      const r = mean / bd.anyOfBucket;
      const verdict = mean < sv ? "BAJO el desguace"
        : r > 2 ? "CARA (>2x la rareza)"
        : r < 0.25 ? "barata (<0,25x)"
        : "en banda";
      console.log("  " + padr(b, 11) + pad(fmt(sv), 10) + pad(fmt(mean), 13)
        + pad(fmt(bd.anyOfBucket), 14) + pad(fmt(bd.thisCard), 20)
        + pad(r.toFixed(2) + "x", 13) + "  " + verdict);
    }
    console.log("");
  }

  /*
   * Y la tabla que la tienda deberia estar enseñando: cuanto cuesta UNA carta de cada
   * rareza segun el sobre que compres. Aqui se ve, sin opinar, cual es la via barata
   * para cada cosa — y donde un sobre esta mal tasado respecto a los demas.
   */
  console.log("  COSTE DE UNA CARTA DE CADA RAREZA, SEGUN EL SOBRE (creditos)\n");
  console.log("  " + padr("sobre", 11) + pad("precio", 8) + BUCKETS.map((b) => pad(b, 13)).join("")
    + pad("cr por carta", 14));
  console.log("  " + "-".repeat(94));
  const best: Partial<Record<RarityBucket, { id: string; cost: number }>> = {};
  for (const s of all) {
    const pc = pullCosts(s);
    const cells = BUCKETS.map((b) => {
      const bd = pc[b];
      if (!bd) return pad("—", 13);
      const cur = best[b];
      if (!cur || bd.anyOfBucket < cur.cost) best[b] = { id: s.id, cost: bd.anyOfBucket };
      return pad(fmt(bd.anyOfBucket), 13);
    }).join("");
    console.log("  " + padr(s.id, 11) + pad(fmt(s.price), 8) + cells + pad(fmt(s.price / s.cards), 14));
  }
  console.log("\n  La via mas barata para cada rareza:");
  for (const b of BUCKETS) {
    const w = best[b];
    if (w) console.log("    " + padr(b, 11) + " -> " + padr(w.id, 11) + " (" + fmt(w.cost) + " cr por carta)");
  }
  console.log("");
}

function sectionPacks(all: PackStats[]): void {
  title(2, "DISTRIBUCION DE VALOR POR SOBRE");
  console.log("  Valor de mercado (marketValue) del contenido. Coleccion vacia en cada apertura.\n");
  console.log("  " + padr("sobre", 11) + pad("precio", 8) + pad("media", 10) + pad("P10", 9) + pad("P25", 9)
    + pad("P50", 9) + pad("P75", 9) + pad("P90", 10) + pad("maximo", 11));
  console.log("  " + "-".repeat(86));
  for (const s of all) {
    console.log("  " + padr(s.id, 11) + pad(fmt(s.price), 8) + pad(fmt(s.mean), 10) + pad(fmt(s.p10), 9)
      + pad(fmt(s.p25), 9) + pad(fmt(s.p50), 9) + pad(fmt(s.p75), 9) + pad(fmt(s.p90), 10) + pad(fmt(s.max), 11));
  }

  console.log("\n  RATIOS Y VARIANZA\n");
  console.log("  " + padr("sobre", 11) + pad("media/precio", 14) + pad("P50/precio", 12) + pad("P10/precio", 12)
    + pad("P90/P10", 10) + pad("mv por credito", 16));
  console.log("  " + "-".repeat(74));
  for (const s of all) {
    console.log("  " + padr(s.id, 11) + pad((s.mean / s.price).toFixed(1) + "x", 14)
      + pad((s.p50 / s.price).toFixed(1) + "x", 12) + pad((s.p10 / s.price).toFixed(1) + "x", 12)
      + pad((s.p90 / Math.max(1, s.p10)).toFixed(1) + "x", 10) + pad((s.mean / s.price).toFixed(2), 16));
  }

  console.log("\n  LAS DOS TASACIONES, Y POR QUE NO SON LA MISMA CIFRA\n");
  console.log("  marketValue(def)          tasa el TIPO de carta. Es el ancla del mercado entre jugadores.");
  console.log("  instanceValue(def, serie) tasa el EJEMPLAR: hasta x5 por numero de serie bajo.");
  console.log("  quickSellValue            es el 80 % de instanceValue: lo que pagaria la venta rapida.\n");
  console.log("  " + padr("sobre", 11) + pad("precio", 8) + pad("marketValue", 13) + pad("ratio", 8)
    + pad("instanceValue", 15) + pad("ratio", 8) + pad("quickSell", 12) + pad("ratio", 8));
  console.log("  " + "-".repeat(84));
  for (const s of all) {
    const qs = s.instanceMean * 0.8;
    console.log("  " + padr(s.id, 11) + pad(fmt(s.price), 8) + pad(fmt(s.mean), 13)
      + pad((s.mean / s.price).toFixed(1) + "x", 8) + pad(fmt(s.instanceMean), 15)
      + pad((s.instanceMean / s.price).toFixed(1) + "x", 8) + pad(fmt(qs), 12)
      + pad((qs / s.price).toFixed(1) + "x", 8));
  }

  console.log("\n  REPARTO DE RAREZA REAL DE LAS CARTAS SORTEADAS\n");
  console.log("  " + padr("sobre", 11) + BUCKETS.map((b) => pad(b, 12)).join(""));
  console.log("  " + "-".repeat(72));
  for (const s of all) {
    const cells = BUCKETS.map((b) => pad((100 * s.drawn[b] / s.totalDrawn).toFixed(1) + " %", 12)).join("");
    console.log("  " + padr(s.id, 11) + cells);
  }
}

// ═════════════════════════ 3 · SOBRES SOBRE UNA COLECCIÓN REAL ═════════════════════════

function sectionCollection(packId: string, packsToOpen: number): void {
  title(3, "SOBRES SOBRE UNA COLECCION QUE CRECE (" + packId + ")");
  console.log("  Aperturas SECUENCIALES acumulando coleccion. Aqui si importa lo que ya se tiene.\n");

  const pack = PACKS.find((p) => p.id === packId)!;
  const owned = new Map<string, number>();
  let pity = { version: 1, counters: {} } as never;
  let cards = 0, dupes = 0;
  const marks = new Set([10, 25, 50, 100, 200, 400, packsToOpen]);

  console.log("  " + pad("sobres", 8) + pad("cartas", 8) + pad("distintas", 11) + pad("% catalogo", 12)
    + pad("% repetidas", 13) + pad("gastado", 11) + pad("cr/carta nueva", 16));
  console.log("  " + "-".repeat(78));

  for (let i = 1; i <= packsToOpen; i++) {
    const ownedList: OwnedCard[] = [...owned.keys()].map((cardId, k) => ({
      uid: "o" + k, cardId, serial: undefined, obtainedAt: 0, origin: "pack" as const,
    }));
    const r = runtimePackEngine().open(pack, {
      seed: SEED + i * 7919, owned: ownedList, mintCounts: {}, pity, now: 0,
    });
    pity = r.pityAfter as never;
    for (const ins of r.instances) {
      cards++;
      const had = owned.get(ins.cardId) ?? 0;
      owned.set(ins.cardId, had + 1);
      if (had > 0) dupes++;
    }
    if (marks.has(i)) {
      const spent = i * pack.price;
      console.log("  " + pad(i, 8) + pad(cards, 8) + pad(owned.size, 11)
        + pad((100 * owned.size / CARDS.length).toFixed(1) + " %", 12)
        + pad((100 * dupes / cards).toFixed(1) + " %", 13) + pad(fmt(spent), 11)
        + pad(fmt(spent / owned.size), 16));
    }
  }
}

// ═════════════════════════ 4 · EL ANCLA ═════════════════════════

/**
 * `marketValue` es `50 × 1,45^(rank-1) × 1,06^(ovr-60)`. Ese 50 es un factor de ESCALA:
 * multiplicarlo o dividirlo mueve TODOS los precios a la vez sin cambiar ni un ápice el
 * orden relativo entre cartas. Es decir: la ratio 10× no dice que los sobres estén rotos.
 * Dice que ese 50 nunca se eligió contra nada.
 *
 * Esta sección calcula qué escala haría que la media ponderada de los sobres cayera sobre
 * una ratio OBJETIVO, para cada objetivo candidato. No aplica nada: solo enseña la cuenta.
 */
function sectionAnchor(all: PackStats[]): void {
  title(5, "EL ANCLA: QUE ESCALA HARIA FALTA PARA CADA RATIO OBJETIVO");

  // Ponderación por sobre: el Estándar y el Premium son los que se compran de verdad
  // (`economy:simulate`), así que el ancla debe cuadrar sobre todo con ellos.
  const WEIGHT: Record<string, number> = {
    estandar: 3, premium: 3, masters: 1, ewc: 1, champions: 1, prime: 1, icon: 1,
    emea: 0.5, americas: 0.5, pacific: 0.5, china: 0.5,
  };
  let num = 0, den = 0;
  for (const s of all) {
    const w = WEIGHT[s.id] ?? 1;
    num += w * (s.mean / s.price);
    den += w;
  }
  const current = num / den;
  console.log("  Ratio media/precio ponderada de hoy: " + current.toFixed(2) + "x");
  console.log("  Escala actual de marketValue: 50 (constante arbitraria, nunca calibrada).\n");
  console.log("  " + padr("ratio objetivo", 16) + pad("escala", 9) + pad("factor", 10)
    + "   comun medio / legendaria media");
  console.log("  " + "-".repeat(78));

  const commonMv = CARDS.filter((c) => bucketOf(c) === "common").map(marketValue);
  const legMv = CARDS.filter((c) => bucketOf(c) === "legendary").map(marketValue);
  const meanC = commonMv.reduce((a, x) => a + x, 0) / commonMv.length;
  const meanL = legMv.reduce((a, x) => a + x, 0) / legMv.length;

  for (const target of [1, 1.2, 1.5, 2, 3]) {
    const factor = target / current;
    console.log("  " + padr(target.toFixed(1) + "x", 16) + pad((50 * factor).toFixed(1), 9)
      + pad("x" + factor.toFixed(3), 10) + "   " + fmt(meanC * factor) + " / " + fmt(meanL * factor));
  }
  console.log("\n  (Hoy: comun " + fmt(meanC) + " · legendaria " + fmt(meanL) + ".)");
}

// ═════════════════════════ 5 · EL BUCLE SOBRE → CARTA → DESGUACE ═════════════════════════

function sectionSalvageLoop(all: PackStats[]): void {
  title(6, "EL BUCLE SOBRE -> CARTA -> DESGUACE");
  console.log("  Si desguazar lo que sale devolviera mas de lo que cuesta el sobre, la economia");
  console.log("  tendria una impresora de dinero. Se comprueba con la media medida.\n");
  console.log("  " + padr("sobre", 11) + pad("precio", 9) + pad("desguace medio", 16)
    + pad("recuperacion", 14) + pad("margen", 11) + "  veredicto");
  console.log("  " + "-".repeat(80));
  let worst = 0;
  for (const s of all) {
    const rec = s.salvageMean / s.price;
    worst = Math.max(worst, rec);
    console.log("  " + padr(s.id, 11) + pad(fmt(s.price), 9) + pad(fmt(s.salvageMean), 16)
      + pad((100 * rec).toFixed(1) + " %", 14) + pad(fmt(s.price - s.salvageMean), 11)
      + "  " + (rec < 1 ? "OK pierde" : "IMPRIME"));
  }
  console.log("\n  Peor caso: " + (100 * worst).toFixed(1) + " % de recuperacion. "
    + (worst < 1 ? "El bucle SIEMPRE pierde dinero." : "HAY IMPRESORA."));
}

// ═════════════════════════ 6 · MERCADO HIPOTÉTICO ═════════════════════════

/**
 * Un mercado simulado. No abre nada ni escribe nada: contesta a «qué pasaría si».
 *
 * El modelo de precios es deliberadamente simple y está declarado: cada venta es una carta
 * del catálogo elegida con el mismo reparto de rareza que sale de un sobre Premium (que es
 * el que la gente compra), y el precio pedido es su `marketValue` con un ruido uniforme del
 * ±30 %. No pretende predecir el mercado real: pretende dimensionar los flujos.
 */
function sectionMarket(premium: PackStats): void {
  title(7, "MERCADO HIPOTETICO: FLUJOS, QUEMA Y CONCENTRACION");

  const pool = BUCKETS.map((b) => ({
    b, share: premium.drawn[b] / premium.totalDrawn,
    cards: CARDS.filter((c) => bucketOf(c) === b),
  })).filter((p) => p.cards.length > 0);

  // Generador congruencial: reproducible y sin dependencias.
  let state = SEED >>> 0;
  const rnd = (): number => ((state = (state * 1664525 + 1013904223) >>> 0) / 4294967296);

  const pickCard = (): CardDef => {
    let r = rnd();
    for (const p of pool) { if ((r -= p.share) <= 0) return p.cards[Math.floor(rnd() * p.cards.length)]; }
    const last = pool[pool.length - 1];
    return last.cards[Math.floor(rnd() * last.cards.length)];
  };

  for (const fee of [500, 750, 1000]) {
    console.log("\n  COMISION " + (fee / 100).toFixed(1) + " %\n");
    console.log("  " + pad("ventas", 9) + pad("volumen", 15) + pad("quemado", 13)
      + pad("precio medio", 14) + pad("top 10 % del volumen", 22));
    console.log("  " + "-".repeat(74));
    for (const n of [100, 1000, 10000, 100000]) {
      state = SEED >>> 0;
      let volume = 0;
      const prices: number[] = [];
      for (let i = 0; i < n; i++) {
        const card = pickCard();
        const price = Math.max(25, Math.round(marketValue(card) * (0.7 + 0.6 * rnd())));
        volume += price;
        prices.push(price);
      }
      const burned = Math.round(volume * fee / 10000);
      prices.sort((a, b) => b - a);
      const top = prices.slice(0, Math.max(1, Math.floor(n * 0.1))).reduce((a, x) => a + x, 0);
      console.log("  " + pad(fmt(n), 9) + pad(fmt(volume), 15) + pad(fmt(burned), 13)
        + pad(fmt(volume / n), 14) + pad((100 * top / volume).toFixed(1) + " %", 22));
    }
  }

  console.log("\n  LA BANDA DE PRECIO (min " + MARKET.minMult + "x · max " + MARKET.maxMult + "x sobre el ancla)\n");
  console.log("  " + padr("bucket", 11) + pad("ancla media", 14) + pad("minimo", 11)
    + pad("maximo", 13) + pad("el maximo, en sobres estandar", 32));
  console.log("  " + "-".repeat(80));
  const standardPrice = PACKS.find((p) => p.id === "estandar")!.price;
  for (const b of BUCKETS) {
    const v = CARDS.filter((c) => bucketOf(c) === b).map(marketValue);
    if (v.length === 0) continue;
    const mean = v.reduce((a, x) => a + x, 0) / v.length;
    console.log("  " + padr(b, 11) + pad(fmt(mean), 14) + pad(fmt(mean * MARKET.minMult), 11)
      + pad(fmt(mean * MARKET.maxMult), 13)
      + pad((mean * MARKET.maxMult / standardPrice).toFixed(0) + " sobres", 32));
  }
}

// ═════════════════════════ EMITIR LOS DATOS MEDIDOS ═════════════════════════

/**
 * Escribe `src/data/packStats.ts` con lo medido.
 *
 * ────────────────────────── POR QUÉ UN FICHERO Y NO UN CÁLCULO EN VIVO ──────────────────────────
 *
 * La tienda tiene que enseñar el reparto de rareza REAL, no los pesos declarados. Y no son
 * lo mismo: el Premium declara 30 % de comunes y entrega 25,2 %, porque la garantía de
 * «rara o mejor» ocupa una de las seis casillas. Enseñar el peso declarado sería una
 * promesa falsa, que es justo lo que la Fase 12 prohíbe.
 *
 * Medirlo en vivo costaría veinte mil aperturas por sobre cada vez que alguien entra en la
 * tienda. Medirlo una vez y guardarlo cuesta cero — y el riesgo evidente (que el catálogo
 * cambie y el fichero se quede viejo) lo cubre un test que vuelve a medir con una muestra
 * pequeña y compara. Si alguien toca los pesos o el catálogo, el test cae.
 *
 * ────────────────────────── LO IMPOSIBLE, APARTE ──────────────────────────
 *
 * `impossible` no sale de la muestra: sale del POOL. Un sobre puede declarar 6 % de épicas
 * y no tener ni una carta épica elegible —le pasa a los cuatro sobres regionales—, y eso es
 * un hecho del catálogo, no una probabilidad. Se detecta mirando el pool, que es exacto,
 * en vez de esperar a que una muestra no saque ninguna.
 */
function emit(all: PackStats[], n: number): void {
  const registry = runtimeRegistry();
  const lines: string[] = [];
  lines.push(`/**`);
  lines.push(` * ESTADÍSTICA DE SOBRES — GENERADO, NO ESCRITO A MANO.`);
  lines.push(` *`);
  lines.push(` *   npm run economy:model -- --emit`);
  lines.push(` *`);
  lines.push(` * Medido con el motor de sorteo REAL sobre ${n.toLocaleString("es-ES")} aperturas por sobre,`);
  lines.push(` * semilla ${SEED}, colección vacía en cada apertura.`);
  lines.push(` *`);
  lines.push(` * Existe para que la tienda pueda enseñar el reparto de rareza que un sobre entrega DE`);
  lines.push(` * VERDAD, en vez de los pesos declarados en \`data/packs\`, que no coinciden: una garantía`);
  lines.push(` * de «rara o mejor» ocupa una casilla y desplaza el reparto entero.`);
  lines.push(` *`);
  lines.push(` * \`src/data/packStats.test.ts\` vuelve a medir con una muestra pequeña y compara. Si se`);
  lines.push(` * tocan los pesos, los precios o el catálogo, ese test cae y este fichero hay que`);
  lines.push(` * regenerarlo. Es la red que impide que la tienda mienta sin que nadie se entere.`);
  lines.push(` */`);
  lines.push(`import type { RarityBucket } from "@/domain/packs/types";`);
  lines.push(``);
  lines.push(`export interface PackStatRow {`);
  lines.push(`  packId: string;`);
  lines.push(`  price: number;`);
  lines.push(`  cardCount: number;`);
  lines.push(`  /** Reparto de rareza REAL, en tanto por uno. Suma 1. */`);
  lines.push(`  drawn: Record<RarityBucket, number>;`);
  lines.push(`  /** Lo que cuesta, de media, UNA carta de cada rareza comprando este sobre. */`);
  lines.push(`  costPerRarity: Partial<Record<RarityBucket, number>>;`);
  lines.push(`  /** Valor de mercado medio del contenido del sobre. */`);
  lines.push(`  meanValue: number;`);
  lines.push(`  /** Lo que devolvería desguazar el sobre entero. */`);
  lines.push(`  meanSalvage: number;`);
  lines.push(`  /** Rarezas con peso declarado que este sobre NO PUEDE entregar: no hay cartas. */`);
  lines.push(`  impossible: RarityBucket[];`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`export const PACK_STATS_SAMPLE = ${n};`);
  lines.push(`export const PACK_STATS_SEED = ${SEED};`);
  lines.push(``);
  lines.push(`export const PACK_STATS: Record<string, PackStatRow> = {`);

  for (const s of all) {
    const pack = PACKS.find((p) => p.id === s.id)!;
    const { pool } = buildPool(registry, pack);
    const impossible = BUCKETS.filter((b) => (pack.weights[b] ?? 0) > 0 && pool[b].length === 0);
    const pc = pullCosts(s);
    const drawn = BUCKETS.map((b) => `${b}: ${(s.drawn[b] / s.totalDrawn).toFixed(4)}`).join(", ");
    const cost = BUCKETS.filter((b) => pc[b] !== undefined)
      .map((b) => `${b}: ${Math.round(pc[b]!.anyOfBucket)}`).join(", ");
    lines.push(`  ${JSON.stringify(s.id)}: {`);
    lines.push(`    packId: ${JSON.stringify(s.id)}, price: ${s.price}, cardCount: ${s.cards},`);
    lines.push(`    drawn: { ${drawn} },`);
    lines.push(`    costPerRarity: { ${cost} },`);
    lines.push(`    meanValue: ${Math.round(s.mean)}, meanSalvage: ${Math.round(s.salvageMean)},`);
    lines.push(`    impossible: [${impossible.map((b) => JSON.stringify(b)).join(", ")}],`);
    lines.push(`  },`);
  }
  lines.push(`};`);
  lines.push(``);
  lines.push(`export const packStats = (packId: string): PackStatRow | null => PACK_STATS[packId] ?? null;`);
  lines.push(``);

  writeFileSync(join(process.cwd(), "src", "data", "packStats.ts"), lines.join("\n"), "utf8");
  console.log("\n  Escrito src/data/packStats.ts con " + all.length + " sobres.\n");
}

// ═════════════════════════ main ═════════════════════════

function main(): void {
  const args = process.argv.slice(2);
  const arg = (k: string, d: number): number => {
    const i = args.indexOf("--" + k);
    return i >= 0 && args[i + 1] ? Number(args[i + 1]) : d;
  };
  const n = Math.max(100, Math.min(200000, arg("n", 20000)));

  console.log("\n  MODELO ECONOMICO DE NEXUS · " + n.toLocaleString("es-ES")
    + " aperturas por sobre · semilla " + SEED);

  sectionCatalog();
  const all = PAID.map((p) => measurePack(p.id, n));
  sectionPacks(all);
  sectionCollection("premium", 400);
  sectionValueBounds(all);
  sectionAnchor(all);
  sectionSalvageLoop(all);
  sectionMarket(all.find((s) => s.id === "premium")!);
  if (args.includes("--emit")) emit(all, n);
  console.log("");
}

main();
