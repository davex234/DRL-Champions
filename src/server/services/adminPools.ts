/**
 * SERVICIO DE ADMINISTRACIÓN DE POOLS (SOLO SERVIDOR) — Bloque 8.4.3.
 *
 * ────────────────────────── QUÉ ES UN POOL, Y QUÉ NO ES ──────────────────────────
 *
 * Un pool contesta a UNA pregunta: **qué cartas pueden tocar en un sobre y cuánto pesa cada
 * una**. No decide cuántas cartas trae el sobre, ni con qué probabilidad sale cada rareza, ni
 * cuándo entra el pity, ni qué garantiza el sobre. Todo eso vive en `PackDef`, en código, y
 * este bloque no lo toca.
 *
 * La consecuencia práctica es la regla de 8.3 que aquí solo se respeta: un pool **estrecha y
 * repondera**, nunca ensancha. Un sobre de EMEA con un pool no puede empezar a repartir
 * cartas de Pacific, porque `poolAllows()` se evalúa DESPUÉS de `isEligible()` del sobre.
 *
 * ────────────────────────── LA PROBABILIDAD SE EXPLICA, NO SE INVENTA ──────────────────────────
 *
 * El motor tiene dos capas y aquí se enseñan las dos:
 *
 *     P(carta) = P(bucket) × P(carta | bucket)
 *
 *     P(bucket)        = pack.weights[b] / Σ pack.weights[b']   sobre los buckets CON STOCK
 *     P(carta|bucket)  = weight(carta)   / Σ weight(c)          sobre las cartas de ese bucket
 *
 * La renormalización sobre «buckets con stock» no es una licencia: es literalmente lo que
 * hace `rollBucket()`. Un sobre que anuncia un 6 % de épicas y no tiene ni una épica en su
 * pool reparte 0 % de épicas, y el panel tiene que decir 0 %, no 6 %.
 *
 * Todos los cálculos usan `effectiveProbabilities()` y `buildPool()` — las funciones del
 * motor. No hay una segunda aritmética para la interfaz.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverCatalog } from "@/server/catalog";
import { pageAll } from "@/server/db/pageAll";
import { serverDistribution } from "@/server/catalog/distribution";
import { buildPool, BUCKETS } from "@/domain/packs/pool";
import { effectiveProbabilities, DEFAULT_WEIGHT } from "@/domain/packs/weighted";
import { bucketForRank, type RarityBucket } from "@/domain/packs/types";
import { getVariant } from "@/domain/cards/variants";
import { PACKS, getPack } from "@/data/packs";
import { openPack } from "@/domain/packs/openPack";
import { freshPity } from "@/domain/packs/pity";
import type { PackDistribution } from "@/domain/packs/distribution";

export type Result<T> = { ok: true; data: T } | { ok: false; error: string; status: number };
const fail = (error: string, status = 400): { ok: false; error: string; status: number } =>
  ({ ok: false, error, status });

// ───────────────────────────── LISTADO ─────────────────────────────

export interface PoolListRow {
  id: string; name: string; description: string | null;
  mode: string; lifecycle: string; revision: number;
  seasonId: string | null; eventId: string | null;
  availableFrom: string | null; availableTo: string | null;
  includes: number; excludes: number; pesoTotal: number;
  noPublicadas: number; retiradas: number;
  packs: string[]; nPacks: number;
  updatedAt: string | null; publishedAt: string | null;
  /** ¿Está dentro de su ventana de disponibilidad AHORA? */
  disponible: boolean;
}

export interface PoolFilters {
  q?: string; lifecycle?: string; packId?: string; mode?: string;
  seasonId?: string; eventId?: string;
  /** `true` = solo los que hoy participan en un sorteo. */
  soloActivos?: boolean;
}

/**
 * El listado entero en UNA consulta contra `v_pool_admin`.
 *
 * La vista existe justo para esto: enseñar cartas, peso, sobres y salud de 12 pools costaría
 * 48 consultas preguntando pool a pool. El filtro por sobre se resuelve antes con una
 * consulta a `content_pack_pools`, que es un `in(...)` y no un `join` anidado.
 */
export async function listPools(sb: SupabaseClient, f: PoolFilters): Promise<Result<{
  rows: PoolListRow[]; total: number; facets: { lifecycles: string[]; packs: string[]; seasons: string[]; events: string[] };
}>> {
  let q = sb.from("v_pool_admin").select("*");

  if (f.lifecycle) q = q.eq("lifecycle", f.lifecycle);
  if (f.mode) q = q.eq("mode", f.mode);
  if (f.seasonId) q = q.eq("season_id", f.seasonId);
  if (f.eventId) q = q.eq("event_id", f.eventId);
  if (f.q) {
    const t = f.q.trim().replace(/[%,()]/g, "");
    if (t) q = q.or(`id.ilike.%${t}%,name.ilike.%${t}%`);
  }
  if (f.packId) {
    const { data: ids } = await sb.from("content_pack_pools")
      .select("pool_id").eq("pack_id", f.packId).eq("enabled", true);
    const lista = ((ids ?? []) as { pool_id: string }[]).map((r) => r.pool_id);
    if (lista.length === 0) {
      return { ok: true, data: { rows: [], total: 0, facets: { lifecycles: [], packs: [], seasons: [], events: [] } } };
    }
    q = q.in("id", lista);
  }

  const { data, error } = await q.order("id");
  if (error) return fail(error.message, 500);

  const ahora = Date.now();
  const dentroDeVentana = (desde: string | null, hasta: string | null): boolean =>
    (desde === null || ahora >= Date.parse(desde)) && (hasta === null || ahora < Date.parse(hasta));

  let rows = ((data ?? []) as Record<string, unknown>[]).map((r): PoolListRow => ({
    id: String(r.id), name: String(r.name), description: (r.description as string) ?? null,
    mode: String(r.mode), lifecycle: String(r.lifecycle), revision: Number(r.revision),
    seasonId: (r.season_id as string) ?? null, eventId: (r.event_id as string) ?? null,
    availableFrom: (r.available_from as string) ?? null, availableTo: (r.available_to as string) ?? null,
    includes: Number(r.includes), excludes: Number(r.excludes), pesoTotal: Number(r.peso_total),
    noPublicadas: Number(r.no_publicadas), retiradas: Number(r.retiradas),
    packs: (r.packs as string[]) ?? [], nPacks: Number(r.n_packs),
    updatedAt: (r.updated_at as string) ?? null, publishedAt: (r.published_at as string) ?? null,
    disponible: dentroDeVentana((r.available_from as string) ?? null, (r.available_to as string) ?? null),
  }));

  /*
   * «Activo» significa que HOY reparte cartas, y eso son tres cosas a la vez: el pool está
   * ACTIVE, está dentro de su ventana y algún sobre lo usa. Un pool ACTIVE que ningún sobre
   * tiene vinculado no reparte nada, y enseñarlo como activo sería mentir por omisión.
   */
  if (f.soloActivos) {
    rows = rows.filter((r) => r.lifecycle === "ACTIVE" && r.disponible && r.nPacks > 0);
  }

  const uniq = (xs: (string | null)[]): string[] =>
    [...new Set(xs.filter((x): x is string => !!x))].sort();

  return {
    ok: true,
    data: {
      rows, total: rows.length,
      facets: {
        lifecycles: uniq(rows.map((r) => r.lifecycle)),
        packs: PACKS.map((p) => p.id).sort(),
        seasons: uniq(rows.map((r) => r.seasonId)),
        events: uniq(rows.map((r) => r.eventId)),
      },
    },
  };
}

// ───────────────────────────── FICHA ─────────────────────────────

export interface PoolEntryRow {
  cardId: string; playerId: string; nick: string; team: string;
  variantId: string; variantLabel: string; rarityBucket: string; rarityRank: number;
  ovr: number; cardLifecycle: string; definitionVersion: number;
  weight: number; mode: string; note: string | null;
  /** Peso ÷ peso total del pool. Es la cuota dentro del pool, no la del sobre. */
  cuota: number;
  /** ¿La reparte hoy el sorteo? Requiere carta PUBLISHED y modo INCLUDE. */
  elegible: boolean;
}

export interface PoolSheet {
  pool: Record<string, unknown>;
  revision: number;
  packs: { packId: string; priority: number; enabled: boolean; existe: boolean; nombre: string }[];
  entries: PoolEntryRow[];
  entriesTotal: number;
  page: number; pageSize: number;
  resumen: {
    includes: number; excludes: number; pesoTotal: number; pesoActivo: number;
    elegibles: number; draft: number; retiradas: number;
    porBucket: Record<string, { cartas: number; peso: number }>;
  };
  audit: Record<string, unknown>[];
  distributionVersion: number;
}

/**
 * La ficha de un pool. Paginada, porque un pool real tiene 772 entradas.
 *
 * El enriquecimiento —nick, variante, rareza, OVR, estado— se hace con UNA consulta a
 * `content_cards` sobre las cartas de la página, no con una por fila.
 */
export async function poolSheet(
  sb: SupabaseClient, poolId: string,
  opts: { page?: number; pageSize?: number; q?: string; soloProblemas?: boolean } = {},
): Promise<Result<PoolSheet>> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(Math.max(opts.pageSize ?? 25, 1), 200);

  const [poolR, packsR, auditR] = await Promise.all([
    sb.from("content_pools").select("*").eq("id", poolId).maybeSingle(),
    sb.from("content_pack_pools").select("*").eq("pool_id", poolId).order("priority"),
    sb.from("content_audit_log").select("at, actor, action, detail")
      .eq("pool_id", poolId).order("at", { ascending: false }).limit(40),
  ]);
  if (!poolR.data) return fail("Pool no encontrado", 404);
  const pool = poolR.data as Record<string, unknown>;

  /*
   * El RESUMEN se calcula sobre TODAS las entradas, no sobre la página: un resumen de una
   * página no es un resumen.
   *
   * Y se lee PAGINADO, porque «todas» por PostgREST son como mucho 1.000 (`max_rows`), sin
   * error y sin aviso. De esta suma sale la cuota que el panel enseña; calcularla sobre una
   * parte de las entradas daría un porcentaje distinto presentado como un hecho. Ver
   * `src/server/db/pageAll.ts`.
   */
  const todas = await pageAll<unknown>((desde, hasta) => sb.from("content_pool_entries")
    .select("card_id, weight, mode, content_cards!inner(rarity_bucket, lifecycle)")
    .eq("pool_id", poolId).order("card_id").range(desde, hasta));
  const all = ((todas ?? []) as unknown as {
    card_id: string; weight: string | number; mode: string;
    content_cards: { rarity_bucket: string; lifecycle: string } | { rarity_bucket: string; lifecycle: string }[];
  }[]).map((r) => {
    const c = Array.isArray(r.content_cards) ? r.content_cards[0] : r.content_cards;
    return { cardId: r.card_id, weight: Number(r.weight), mode: r.mode, bucket: c.rarity_bucket, lifecycle: c.lifecycle };
  });

  const includes = all.filter((e) => e.mode === "INCLUDE");
  const elegibles = includes.filter((e) => e.lifecycle === "PUBLISHED");
  const porBucket: Record<string, { cartas: number; peso: number }> = {};
  for (const b of BUCKETS) porBucket[b] = { cartas: 0, peso: 0 };
  for (const e of elegibles) {
    const b = porBucket[e.bucket] ?? (porBucket[e.bucket] = { cartas: 0, peso: 0 });
    b.cartas += 1; b.peso += e.weight;
  }
  const pesoTotal = includes.reduce((s, e) => s + e.weight, 0);
  const pesoActivo = elegibles.reduce((s, e) => s + e.weight, 0);

  // ── La página de entradas ──
  let q = sb.from("content_pool_entries")
    .select("card_id, weight, mode, note, content_cards!inner(player_id, variant_id, ovr, rarity_bucket, rarity_rank, lifecycle, definition_version, content_players!inner(nick, team))",
      { count: "exact" })
    .eq("pool_id", poolId);
  if (opts.q) {
    const t = opts.q.trim().replace(/[%,()]/g, "");
    if (t) q = q.ilike("card_id", `%${t}%`);
  }
  const from = (page - 1) * pageSize;
  const { data: pag, count } = await q.order("card_id").range(from, from + pageSize - 1);

  const entries: PoolEntryRow[] = ((pag ?? []) as unknown as Record<string, unknown>[]).map((r) => {
    const c = (Array.isArray(r.content_cards) ? r.content_cards[0] : r.content_cards) as Record<string, unknown>;
    const p = (Array.isArray(c.content_players) ? c.content_players[0] : c.content_players) as { nick: string; team: string };
    const weight = Number(r.weight);
    let variantLabel = String(c.variant_id);
    try { variantLabel = getVariant(String(c.variant_id) as never).label; } catch { /* variante desconocida */ }
    return {
      cardId: String(r.card_id), playerId: String(c.player_id), nick: p?.nick ?? String(c.player_id),
      team: p?.team ?? "", variantId: String(c.variant_id), variantLabel,
      rarityBucket: String(c.rarity_bucket), rarityRank: Number(c.rarity_rank),
      ovr: Number(c.ovr), cardLifecycle: String(c.lifecycle),
      definitionVersion: Number(c.definition_version),
      weight, mode: String(r.mode), note: (r.note as string) ?? null,
      cuota: pesoTotal > 0 && r.mode === "INCLUDE" ? weight / pesoTotal : 0,
      elegible: r.mode === "INCLUDE" && c.lifecycle === "PUBLISHED",
    };
  });

  const dist = await serverDistribution(sb);

  return {
    ok: true,
    data: {
      pool, revision: Number(pool.revision),
      packs: ((packsR.data ?? []) as { pack_id: string; priority: number; enabled: boolean }[]).map((r) => {
        const pk = getPack(r.pack_id);
        return { packId: r.pack_id, priority: r.priority, enabled: r.enabled, existe: !!pk, nombre: pk?.name ?? r.pack_id };
      }),
      entries,
      entriesTotal: count ?? entries.length,
      page, pageSize,
      resumen: {
        includes: includes.length,
        excludes: all.length - includes.length,
        pesoTotal, pesoActivo,
        elegibles: elegibles.length,
        draft: includes.filter((e) => e.lifecycle === "DRAFT").length,
        retiradas: includes.filter((e) => e.lifecycle === "RETIRED").length,
        porBucket,
      },
      audit: (auditR.data ?? []) as Record<string, unknown>[],
      distributionVersion: dist.version,
    },
  };
}

// ───────────────────────────── PROBABILIDAD ─────────────────────────────

export interface CardOdds {
  cardId: string;
  packId: string;
  packName: string;
  /** El pool aporta configuración a este sobre. `false` = comportamiento previo a 8.3. */
  configurado: boolean;
  /** La carta pasa las restricciones del `PackDef` Y las del pool. */
  enPool: boolean;
  motivo: string | null;
  bucket: RarityBucket | null;
  /** Peso de la carta y suma de pesos de su bucket. */
  weight: number;
  pesoBucket: number;
  /** P(carta | bucket). */
  pEnBucket: number;
  /** P(bucket) renormalizado sobre los buckets CON STOCK, como hace `rollBucket`. */
  pBucket: number;
  /** El producto: probabilidad en UN hueco sin garantía ni pity en juego. */
  pPorHueco: number;
  /** Cuántas cartas trae el sobre. */
  huecos: number;
  /** 1 − (1 − p)^huecos: al menos una en el sobre, si los huecos fueran independientes. */
  pAlMenosUna: number;
  cartasEnBucket: number;
  /** Qué pools del sobre aportan esta carta, y cuál gana el peso. */
  composicion: { poolId: string; priority: number; weight: number | null; manda: boolean }[];
}

/**
 * «¿Qué probabilidad tiene ESTA carta de salir de ESTE sobre?», contestado sin mentir.
 *
 * Las tres advertencias que el número necesita para no ser engañoso van en el propio
 * resultado, no en una nota al pie:
 *
 *   · `pPorHueco` vale para UN hueco **sin garantía ni pity en juego**. Los huecos con
 *     garantía usan otro mínimo de rareza y el pity fuerza el bucket: la probabilidad de esos
 *     huecos es distinta y este número no la describe.
 *   · `pAlMenosUna` supone huecos independientes. El anti-duplicado y las garantías los
 *     correlacionan, así que es una aproximación — y por eso va con nombre propio en vez de
 *     presentarse como «la probabilidad del sobre».
 *   · Si la carta no está en el pool o no pasa las restricciones del sobre, la probabilidad
 *     es 0 y se dice POR QUÉ.
 */
export async function cardOdds(sb: SupabaseClient, cardId: string, packId: string): Promise<Result<CardOdds>> {
  const pack = getPack(packId);
  if (!pack) return fail(`Sobre inexistente: ${packId}`, 404);

  const cat = await serverCatalog(sb);
  const dist = await serverDistribution(sb);
  const d = dist.forPack(packId);
  const card = cat.card(cardId);
  if (!card) return fail(`La carta ${cardId} no está en el catálogo servido`, 404);

  const { pool } = buildPool(cat.packEngine.registry, pack, d);
  const bucket = bucketForRank(getVariant(card.variantId).rank);
  const enBucket = pool[bucket] ?? [];
  const esta = enBucket.some((c) => c.id === cardId);

  const conStock = BUCKETS.filter((b) => pool[b].length > 0);
  const totalPeso = conStock.reduce((s, b) => s + (pack.weights[b] || 0), 0);
  const pBucket = totalPeso > 0 && enBucket.length > 0 ? (pack.weights[bucket] || 0) / totalPeso : 0;

  const probs = effectiveProbabilities(enBucket, (c) => (d ? d.weightOf(c.id) : DEFAULT_WEIGHT));
  const mia = probs.find((x) => x.item.id === cardId);
  const pesoBucket = probs.reduce((s, x) => s + x.weight, 0);

  let motivo: string | null = null;
  if (!esta) {
    motivo = d && d.excluded.has(cardId) ? "el pool la excluye expresamente"
      : d && d.members && !d.members.has(cardId) ? "no está en el pool de este sobre"
      : "no pasa las restricciones del sobre (región, variantes, series o grupo)";
  }

  // De qué pools del sobre viene, y cuál gana el peso (menor `priority`).
  const composicion: CardOdds["composicion"] = [];
  const enlaces = [...dist.pools.entries()];
  const { data: pp } = await sb.from("content_pack_pools")
    .select("pool_id, priority").eq("pack_id", packId).eq("enabled", true).order("priority");
  let primero = true;
  for (const r of ((pp ?? []) as { pool_id: string; priority: number }[])) {
    const def = enlaces.find(([id]) => id === r.pool_id)?.[1];
    const entrada = def?.entries.find((e) => e.cardId === cardId && e.mode === "INCLUDE");
    if (!def) continue;
    composicion.push({
      poolId: r.pool_id, priority: r.priority,
      weight: entrada ? entrada.weight : null,
      manda: !!entrada && primero,
    });
    if (entrada) primero = false;
  }

  const huecos = pack.cardCount;
  const pPorHueco = esta ? (mia?.p ?? 0) * pBucket : 0;

  return {
    ok: true,
    data: {
      cardId, packId, packName: pack.name,
      configurado: d !== null,
      enPool: esta, motivo,
      bucket: esta ? bucket : bucket,
      weight: mia?.weight ?? (d ? d.weightOf(cardId) : DEFAULT_WEIGHT),
      pesoBucket,
      pEnBucket: mia?.p ?? 0,
      pBucket,
      pPorHueco,
      huecos,
      pAlMenosUna: huecos > 0 ? 1 - Math.pow(1 - pPorHueco, huecos) : 0,
      cartasEnBucket: enBucket.length,
      composicion,
    },
  };
}

// ───────────────────────────── SIMULACIÓN ─────────────────────────────

export interface SimResult {
  packId: string; aperturas: number; cartas: number; seed: string;
  ms: number;
  distributionVersion: number;
  configurado: boolean;
  buckets: { bucket: string; esperado: number; observado: number; n: number }[];
  top: { cardId: string; nick: string; variantLabel: string; bucket: string;
         weight: number; esperado: number; observado: number; n: number }[];
}

/** Cuántas aperturas admite una simulación. Por encima, la petición deja de ser interactiva. */
export const SIM_MAX = 20_000;

/**
 * Simular no es abrir sobres: es preguntarle al motor qué decidiría.
 *
 * `openPack()` **decide** las cartas y no acuña nada — no toca `user_cards`, ni `card_mints`,
 * ni el mercado, ni el libro mayor, ni la economía. Acuñar es `app_apply_pack_open`, que aquí
 * no se llama. Por eso esto puede correr veinte mil veces sin dejar rastro.
 *
 * El RNG va sembrado con una semilla explícita: la misma semilla da el mismo resultado, así
 * que dos simulaciones comparables lo son de verdad. Y el pity arranca limpio en cada
 * apertura a propósito: se está midiendo la DISTRIBUCIÓN, no una racha concreta de un jugador.
 */
export async function simulate(
  sb: SupabaseClient, packId: string, aperturas: number, seed: string,
): Promise<Result<SimResult>> {
  const pack = getPack(packId);
  if (!pack) return fail(`Sobre inexistente: ${packId}`, 404);
  const n = Math.min(Math.max(Math.floor(aperturas) || 0, 1), SIM_MAX);

  // FNV-1a sobre el texto de la semilla: un numero estable a partir de lo que se teclea.
  let semillaBase = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    semillaBase ^= seed.charCodeAt(i);
    semillaBase = Math.imul(semillaBase, 0x01000193) >>> 0;
  }

  const t0 = Date.now();
  const cat = await serverCatalog(sb);
  const dist = await serverDistribution(sb);
  const d: PackDistribution | null = dist.forPack(packId);
  const registry = cat.packEngine.registry;

  const cuenta = new Map<string, number>();
  const porBucket = new Map<string, number>();
  let total = 0;
  for (let i = 0; i < n; i++) {
    /*
     * La semilla es un NUMERO: `makeRng` la consume como entero. Se compone de la semilla
     * de texto que pide el panel y del indice de la apertura, para que dos simulaciones con
     * la misma semilla sean exactamente comparables y dos aperturas de la misma simulacion
     * no lo sean entre si.
     */
    const r = openPack(registry, pack, {
      seed: (semillaBase + i) >>> 0,
      pity: freshPity(),
      owned: new Set<string>(),
      distribution: d,
    });
    for (const dec of r.decisions) {
      cuenta.set(dec.card.id, (cuenta.get(dec.card.id) ?? 0) + 1);
      porBucket.set(dec.bucket, (porBucket.get(dec.bucket) ?? 0) + 1);
      total += 1;
    }
  }

  // Lo ESPERADO se calcula con las mismas funciones del motor, no con una regla de tres.
  const { pool } = buildPool(registry, pack, d);
  const conStock = BUCKETS.filter((b) => pool[b].length > 0);
  const pesoBuckets = conStock.reduce((s, b) => s + (pack.weights[b] || 0), 0);
  const esperadoCarta = new Map<string, number>();
  const buckets = BUCKETS.map((b) => {
    const pB = pesoBuckets > 0 && pool[b].length > 0 ? (pack.weights[b] || 0) / pesoBuckets : 0;
    for (const x of effectiveProbabilities(pool[b], (c) => (d ? d.weightOf(c.id) : DEFAULT_WEIGHT))) {
      esperadoCarta.set(x.item.id, x.p * pB);
    }
    return {
      bucket: b, esperado: pB,
      observado: total > 0 ? (porBucket.get(b) ?? 0) / total : 0,
      n: porBucket.get(b) ?? 0,
    };
  });

  const top = [...cuenta.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 25)
    .map(([cardId, veces]) => {
      const card = cat.card(cardId);
      const p = card ? registry.player(card.playerId) : undefined;
      let variantLabel = card?.variantId ?? "?";
      let bucket = "?";
      if (card) {
        try {
          const v = getVariant(card.variantId);
          variantLabel = v.label; bucket = bucketForRank(v.rank);
        } catch { /* variante desconocida */ }
      }
      return {
        cardId, nick: p?.nick ?? card?.playerId ?? cardId, variantLabel, bucket,
        weight: d ? d.weightOf(cardId) : DEFAULT_WEIGHT,
        esperado: esperadoCarta.get(cardId) ?? 0,
        observado: total > 0 ? veces / total : 0,
        n: veces,
      };
    });

  return {
    ok: true,
    data: {
      packId, aperturas: n, cartas: total, seed,
      ms: Date.now() - t0,
      distributionVersion: dist.version,
      configurado: d !== null,
      buckets, top,
    },
  };
}
