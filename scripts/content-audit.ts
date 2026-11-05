/**
 * AUDITORÍA DE CONTENIDO — NEXUS (Fase 13).
 *
 *   npm run content:audit
 *
 * ────────────────────────── QUÉ ES ──────────────────────────
 *
 * Una herramienta de MEDICIÓN sobre el catálogo real. No inventa jugadores, no fabrica
 * estadísticas y no toca nada: cuenta lo que hay y enseña dónde falta.
 *
 * La Fase 12 encontró que el sobre China no puede entregar las épicas ni las legendarias
 * que anuncia. Aquello se detectó desde el POOL del sobre, que dice «no hay cartas» pero no
 * dice POR QUÉ. Esta auditoría contesta a la pregunta de detrás:
 *
 *   Una carta de NEXUS es `jugador × variante`, y una variante solo existe para un jugador
 *   si ese jugador tiene el GALARDÓN correspondiente (`Player.accolades`). Así que la
 *   pregunta «¿por qué China no tiene legendarias?» es en realidad «¿qué galardones tienen
 *   los jugadores de China?».
 *
 * Todo lo que sale de aquí es un recuento sobre `data/players` y `data/catalog`. Si algo no
 * se puede decidir con estos datos, la salida lo dice en vez de rellenarlo.
 */
import { PLAYERS } from "@/data/players";
import { CARDS, cardsForPlayer, ineligiblePlayers, variantsForAccolade } from "@/data/catalog";
import { VARIANTS, getVariant } from "@/domain/cards/variants";
import { bucketForRank, type RarityBucket } from "@/domain/packs/types";
import { marketValue } from "@/domain/economy/pricing";
import { PACKS } from "@/data/packs";
import { packStats } from "@/data/packStats";
import type { Player, AccoladeId } from "@/domain/cards/types";

const BUCKETS: RarityBucket[] = ["common", "uncommon", "rare", "epic", "legendary"];
const REGIONS = ["EMEA", "Americas", "Pacific", "China"] as const;
type RegionName = (typeof REGIONS)[number];

const fmt = (n: number): string => Math.round(n).toLocaleString("es-ES");
const pad = (s: string | number, n: number): string => String(s).padStart(n);
const padr = (s: string | number, n: number): string => String(s).padEnd(n);
const pctOf = (a: number, b: number): string => (b === 0 ? "—" : `${((100 * a) / b).toFixed(1)} %`);

function title(n: number, t: string): void {
  console.log("\n" + "=".repeat(80) + "\n  SECCION " + n + " · " + t + "\n" + "=".repeat(80));
}

const bucketOfVariant = (variantId: string): RarityBucket =>
  bucketForRank(getVariant(variantId as never).rank);

// ═════════════════════════ 1 · JUGADORES ═════════════════════════

function sectionPlayers(): void {
  title(1, "JUGADORES: CUANTOS HAY Y DE DONDE SALEN SUS ESTADISTICAS");

  const bad = ineligiblePlayers(PLAYERS);
  console.log("  " + padr("region", 11) + pad("jugadores", 11) + pad("activos", 10)
    + pad("con metricas", 14) + pad("editoriales", 13) + pad("sin base", 10)
    + pad("OVR medio", 11) + pad("OVR max", 9));
  console.log("  " + "-".repeat(88));

  for (const region of REGIONS) {
    const list = PLAYERS.filter((p) => p.region === region);
    if (list.length === 0) continue;
    const active = list.filter((p) => (p.status ?? "active") === "active").length;
    const metrics = list.filter((p) => p.metrics).length;
    const editorial = list.filter((p) => !p.metrics && p.editorial).length;
    const none = list.filter((p) => bad.some((b) => b.id === p.id)).length;
    const ovrs = list.flatMap((p) => cardsForPlayer(p).map((c) => c.ovr));
    const mean = ovrs.length > 0 ? ovrs.reduce((a, x) => a + x, 0) / ovrs.length : 0;
    console.log("  " + padr(region, 11) + pad(list.length, 11) + pad(active, 10)
      + pad(metrics, 14) + pad(editorial, 13) + pad(none, 10)
      + pad(mean.toFixed(1), 11) + pad(ovrs.length > 0 ? Math.max(...ovrs) : "—", 9));
  }

  const other = PLAYERS.filter((p) => !(REGIONS as readonly string[]).includes(p.region));
  console.log("\n  Total: " + PLAYERS.length + " jugadores"
    + (other.length > 0 ? ` (${other.length} fuera de las cuatro regiones)` : "")
    + (bad.length > 0 ? ` · ${bad.length} SIN base de combate` : " · todos con base de combate"));
}

// ═════════════════════════ 2 · GALARDONES ═════════════════════════

/**
 * La sección que explica el problema de China.
 *
 * Un jugador no «tiene» rarezas: tiene GALARDONES, y cada galardón abre unas variantes.
 * Sin galardón de rareza alta no hay carta de rareza alta, por bueno que sea el jugador.
 */
function sectionAccolades(): void {
  title(2, "GALARDONES: LA PUERTA DE ENTRADA A CADA RAREZA");

  const all = new Set<AccoladeId>();
  for (const p of PLAYERS) for (const a of p.accolades) all.add(a);
  const list = [...all].sort();

  console.log("  " + padr("galardon", 22) + pad("bucket", 12)
    + REGIONS.map((r) => pad(r, 11)).join("") + pad("total", 8));
  console.log("  " + "-".repeat(90));

  for (const acc of list) {
    const holders = PLAYERS.filter((p) => p.accolades.includes(acc));
    // El bucket más alto que abre este galardón (mirando un portador real).
    const sample = holders[0];
    const variants = sample ? variantsForAccolade(acc, sample) : [];
    const top = variants.length > 0
      ? variants.map((v) => bucketOfVariant(v)).sort((a, b) => BUCKETS.indexOf(b) - BUCKETS.indexOf(a))[0]
      : "—";
    const cells = REGIONS.map((r) => pad(holders.filter((p) => p.region === r).length, 11)).join("");
    console.log("  " + padr(acc, 22) + pad(String(top), 12) + cells + pad(holders.length, 8));
  }

  console.log("\n  GALARDONES QUE ABREN EPICA O LEGENDARIA, POR REGION\n");
  console.log("  " + padr("region", 11) + pad("portadores epica+", 19) + pad("% de la region", 16)
    + "  galardones que tienen");
  console.log("  " + "-".repeat(84));
  for (const region of REGIONS) {
    const list2 = PLAYERS.filter((p) => p.region === region);
    const high = list2.filter((p) =>
      p.accolades.some((a) => variantsForAccolade(a, p)
        .some((v) => ["epic", "legendary"].includes(bucketOfVariant(v)))));
    const names = [...new Set(high.flatMap((p) => p.accolades.filter((a) =>
      variantsForAccolade(a, p).some((v) => ["epic", "legendary"].includes(bucketOfVariant(v))))))];
    console.log("  " + padr(region, 11) + pad(high.length, 19) + pad(pctOf(high.length, list2.length), 16)
      + "  " + (names.join(", ") || "NINGUNO"));
  }
}

// ═════════════════════════ 3 · CARTAS POR REGION ═════════════════════════

function sectionRegions(): void {
  title(3, "CARTAS POR REGION Y RAREZA");

  console.log("  " + padr("region", 11) + BUCKETS.map((b) => pad(b, 12)).join("")
    + pad("total", 8) + pad("% catalogo", 12));
  console.log("  " + "-".repeat(88));

  const byRegion = new Map<string, Record<RarityBucket, number>>();
  for (const card of CARDS) {
    const p = PLAYERS.find((x) => x.id === card.playerId);
    if (!p) continue;
    const row = byRegion.get(p.region) ?? (Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<RarityBucket, number>);
    row[bucketOfVariant(card.variantId)]++;
    byRegion.set(p.region, row);
  }

  for (const region of REGIONS) {
    const row = byRegion.get(region);
    if (!row) continue;
    const total = BUCKETS.reduce((a, b) => a + row[b], 0);
    console.log("  " + padr(region, 11) + BUCKETS.map((b) => pad(row[b], 12)).join("")
      + pad(total, 8) + pad(pctOf(total, CARDS.length), 12));
  }

  console.log("\n  VALOR ACUMULADO POR REGION (marketValue)\n");
  console.log("  " + padr("region", 11) + pad("cartas", 9) + pad("valor total", 14)
    + pad("valor medio", 13) + pad("carta mas cara", 16));
  console.log("  " + "-".repeat(66));
  for (const region of REGIONS) {
    const cards = CARDS.filter((c) => PLAYERS.find((p) => p.id === c.playerId)?.region === region);
    if (cards.length === 0) continue;
    const values = cards.map(marketValue);
    const total = values.reduce((a, x) => a + x, 0);
    console.log("  " + padr(region, 11) + pad(cards.length, 9) + pad(fmt(total), 14)
      + pad(fmt(total / cards.length), 13) + pad(fmt(Math.max(...values)), 16));
  }
}

// ═════════════════════════ 4 · VARIANTES ═════════════════════════

function sectionVariants(): void {
  title(4, "VARIANTES: CUALES TIENEN CARTAS Y CUALES NO");

  const counts = new Map<string, number>();
  for (const c of CARDS) counts.set(c.variantId, (counts.get(c.variantId) ?? 0) + 1);

  const rows = Object.values(VARIANTS)
    .map((v) => ({ v, n: counts.get(v.id) ?? 0 }))
    .sort((a, b) => a.v.rank - b.v.rank || a.v.id.localeCompare(b.v.id));

  console.log("  " + padr("variante", 20) + pad("rango", 7) + pad("bucket", 12)
    + pad("cartas", 8) + pad("serie", 8) + "  estado");
  console.log("  " + "-".repeat(78));
  for (const { v, n } of rows) {
    const state = n === 0 ? "VACIA — ningun jugador con su galardon" : n < 3 ? "escasa" : "";
    console.log("  " + padr(v.id, 20) + pad(v.rank, 7) + pad(bucketForRank(v.rank), 12)
      + pad(n, 8) + pad(v.serialLimit ?? "—", 8) + "  " + state);
  }

  const empty = rows.filter((r) => r.n === 0);
  console.log("\n  " + empty.length + " variante(s) sin una sola carta"
    + (empty.length > 0 ? ": " + empty.map((r) => r.v.id).join(", ") : ""));
}

// ═════════════════════════ 5 · PRIME ═════════════════════════

/**
 * El sobre Prime, medido contra todos los demás antes de decidir nada.
 *
 * La Fase 12 lo dejó anotado como «dominado»: no es la vía más barata de ninguna rareza y
 * no restringe el sorteo, así que no se sabe para qué sirve. Antes de tocarlo hay que ver
 * la cuenta completa — precio, contenido, restricción y qué le haría falta para no estar
 * dominado.
 */
function sectionPrime(): void {
  title(5, "EL SOBRE PRIME: LA CUENTA COMPLETA ANTES DE DECIDIR");

  const prime = PACKS.find((p) => p.id === "prime")!;
  const stats = packStats("prime")!;

  console.log("  Precio " + fmt(prime.price) + " · " + prime.cardCount + " cartas · "
    + fmt(prime.price / prime.cardCount) + " cr por carta");
  console.log("  Restriccion: " + (prime.restrictGroups?.join("/") ?? prime.restrictRegion ?? "NINGUNA")
    + " · garantia: " + (prime.guaranteedMin ?? "ninguna"));
  console.log("\n  COSTE POR RAREZA FRENTE AL MEJOR DEL CATALOGO\n");
  console.log("  " + padr("bucket", 12) + pad("Prime", 10) + pad("mejor sobre", 14)
    + pad("su coste", 11) + pad("Prime es", 11));
  console.log("  " + "-".repeat(60));

  for (const b of BUCKETS) {
    const mine = stats.costPerRarity[b];
    if (mine === undefined) { console.log("  " + padr(b, 12) + pad("—", 10)); continue; }
    let best = { id: "", cost: Infinity };
    for (const p of PACKS.filter((x) => x.price > 0)) {
      const c = packStats(p.id)?.costPerRarity[b];
      if (c !== undefined && c < best.cost) best = { id: p.id, cost: c };
    }
    console.log("  " + padr(b, 12) + pad(fmt(mine), 10) + pad(best.id, 14)
      + pad(fmt(best.cost), 11) + pad((mine / best.cost).toFixed(2) + "x", 11));
  }

  /*
   * ¿Qué le faltaría para dejar de estar dominado? Dos caminos, y los dos son datos:
   * bajar el precio hasta ser el más barato en algo, o restringir el sorteo para vender
   * puntería en lugar de eficiencia.
   */
  console.log("\n  QUE PRECIO LO HARIA EL MAS BARATO EN CADA RAREZA\n");
  for (const b of BUCKETS) {
    const mine = stats.costPerRarity[b];
    if (mine === undefined) continue;
    let best = Infinity;
    for (const p of PACKS.filter((x) => x.price > 0 && x.id !== "prime")) {
      const c = packStats(p.id)?.costPerRarity[b];
      if (c !== undefined && c < best) best = c;
    }
    const needed = prime.price * (best / mine);
    console.log("    " + padr(b, 12) + "haria falta un precio de " + pad(fmt(needed), 8)
      + " cr (hoy " + fmt(prime.price) + ")");
  }

  console.log("\n  CARTAS ELEGIBLES DEL SOBRE PRIME (su pool real)\n");
  const primeVariantCards = CARDS.filter((c) => c.variantId === "prime");
  console.log("    Variante `prime`: " + primeVariantCards.length + " cartas");
  console.log("    El sobre NO restringe a esa variante: sortea sobre el catalogo entero"
    + " menos las comunes.");
}

// ═════════════════════════ 6 · COLECCION Y ENDGAME ═════════════════════════

/**
 * Los conjuntos que un jugador podría querer completar. Es la materia prima del endgame:
 * sin saber cuántos hay y de qué tamaño, cualquier capa de maestría sería inventada.
 */
function sectionCollectionSets(): void {
  title(6, "CONJUNTOS COMPLETABLES: LA MATERIA PRIMA DEL ENDGAME");

  const byRegion = new Map<string, number>();
  const byTeam = new Map<string, number>();
  const byPlayer = new Map<string, number>();
  const byBucket = new Map<RarityBucket, number>();
  const byVariant = new Map<string, number>();

  for (const c of CARDS) {
    const p = PLAYERS.find((x) => x.id === c.playerId);
    if (p) {
      byRegion.set(p.region, (byRegion.get(p.region) ?? 0) + 1);
      byTeam.set(p.team, (byTeam.get(p.team) ?? 0) + 1);
    }
    byPlayer.set(c.playerId, (byPlayer.get(c.playerId) ?? 0) + 1);
    const b = bucketOfVariant(c.variantId);
    byBucket.set(b, (byBucket.get(b) ?? 0) + 1);
    byVariant.set(c.variantId, (byVariant.get(c.variantId) ?? 0) + 1);
  }

  const summarize = (label: string, m: Map<string | RarityBucket, number>) => {
    const sizes = [...m.values()].sort((a, b) => a - b);
    if (sizes.length === 0) return;
    console.log("  " + padr(label, 22) + pad(m.size, 8) + " conjuntos · tamanos "
      + pad(sizes[0], 4) + " – " + pad(sizes[sizes.length - 1], 4)
      + " · mediana " + pad(sizes[Math.floor(sizes.length / 2)], 4));
  };

  console.log("  Que podria pedirse completar, y cuantos hay de cada clase:\n");
  summarize("Por region", byRegion as never);
  summarize("Por equipo", byTeam as never);
  summarize("Por jugador", byPlayer as never);
  summarize("Por rareza", byBucket as never);
  summarize("Por variante", byVariant as never);

  console.log("\n  LOS CONJUNTOS PEQUENOS SON LOS QUE SIRVEN\n");
  console.log("  Un conjunto de 400 cartas no es un objetivo: es la coleccion entera con otro");
  console.log("  nombre. Los que caben en una sesion de juego son los de menos de 12 cartas.\n");
  const small = [...byPlayer.entries()].filter(([, n]) => n >= 3).length;
  console.log("    Jugadores con 3 o mas cartas: " + small + " de " + byPlayer.size);
  console.log("    Equipos: " + byTeam.size + " · el mayor tiene "
    + Math.max(...byTeam.values()) + " cartas");
  console.log("    Variantes con 3 o mas cartas: "
    + [...byVariant.values()].filter((n) => n >= 3).length + " de " + byVariant.size);
}

function main(): void {
  console.log("\n  AUDITORIA DE CONTENIDO DE NEXUS · " + PLAYERS.length + " jugadores · "
    + CARDS.length + " cartas");
  sectionPlayers();
  sectionAccolades();
  sectionRegions();
  sectionVariants();
  sectionPrime();
  sectionCollectionSets();
  console.log("");
}

main();
