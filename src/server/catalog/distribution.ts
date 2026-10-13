/**
 * DISTRIBUCIÓN PERSISTIDA — la configuración de pool que usa el servidor (Bloque 8.3).
 *
 * ────────────────────────── LECTURA CONSISTENTE POR CONSTRUCCIÓN ──────────────────────────
 *
 * Todo se lee con UNA llamada: `app_content_distribution_snapshot()`, una función `stable`
 * que devuelve pools, entradas, vínculos y versión desde una sola transacción.
 *
 * No es una preferencia de estilo. Leerlo con tres consultas separadas por PostgREST podría
 * atravesar una publicación y componer una configuración **que nunca existió**: los pools
 * de antes con las entradas de después. Una apertura de sobre contra esa mezcla entregaría
 * cartas según una distribución que nadie publicó ni podría auditar. Con una sola función,
 * la foto es coherente porque la base de datos garantiza que lo es.
 *
 * ────────────────────────── CÓMO SE INVALIDA ──────────────────────────
 *
 * `content_distribution_version` sube en la MISMA transacción que cualquier cambio
 * (`_bump_distribution`). El servidor compara su versión con la publicada como mucho una
 * vez cada `VERSION_TTL_MS` y recarga si cambió. Y como la clave de caché del pool del
 * motor incluye la configuración (`buildPool` → `cacheKey`), un pool nuevo produce una
 * clave nueva: el pool viejo no se puede reutilizar por descuido.
 *
 * Es la respuesta al escenario que el encargo prohíbe en la Fase 12 — «admin publica → BD
 * tiene la carta → Node sigue usando el pool viejo indefinidamente».
 *
 * ────────────────────────── QUÉ VERSIÓN DE CARTA REFERENCIA UN POOL ──────────────────────────
 *
 * **Ninguna: referencia la CARTA.** Un pool responde «¿qué puede tocarme AHORA?», y lo que
 * toca ahora es la definición vigente. Anclar un pool a una versión concreta haría que los
 * sobres repartieran cartas obsoletas después de cada edición.
 *
 * La congelación ocurre donde debe: **al acuñar**. El trigger de 8.2 sella
 * `user_cards.minted_version` con la versión vigente en ese instante, así que el ejemplar
 * que sale del sobre queda anclado sin que el pool tenga que saber nada de versiones.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  composeDistribution, type PackDistribution, type PoolDef, type PoolEntry, type PoolRules,
} from "@/domain/packs/distribution";

interface SnapshotRow {
  version: number;
  checksum: string;
  pools: {
    id: string; mode: PoolDef["mode"]; rules: PoolRules;
    available_from: string | null; available_to: string | null;
  }[];
  entries: { pool_id: string; card_id: string; weight: string | number; mode: PoolEntry["mode"] }[];
  packPools: { pack_id: string; pool_id: string; priority: number }[];
}

export interface Distribution {
  version: number;
  checksum: string;
  /** Pools activos, por id. */
  pools: Map<string, PoolDef>;
  /** Sobres con configuración. Los que no están aquí se comportan como antes de 8.3. */
  byPack: Map<string, PackDistribution>;
  /** La forma que consume `PackEngine`. */
  forPack(packId: string): PackDistribution | null;
}

/** La distribución vacía: ningún sobre configurado ⇒ comportamiento anterior a 8.3. */
export const EMPTY_DISTRIBUTION: Distribution = {
  version: 0, checksum: "", pools: new Map(), byPack: new Map(), forPack: () => null,
};

const VERSION_TTL_MS = 5_000;

interface Cache { dist: Distribution; loadedVersion: number; lastCheck: number }
let cache: Cache | null = null;
let inflight: Promise<Distribution> | null = null;

/**
 * Compone la distribución de cada sobre a partir del volcado.
 *
 * `now` se inyecta para que las ventanas de disponibilidad sean deterministas en las
 * pruebas: el dominio no lee el reloj, y aquí tampoco se lee más de una vez.
 */
function build(snap: SnapshotRow, now: number): Distribution {
  const pools = new Map<string, PoolDef>();
  for (const p of snap.pools ?? []) {
    pools.set(p.id, {
      id: p.id, mode: p.mode, rules: p.rules ?? {}, entries: [],
      availableFrom: p.available_from ? Date.parse(p.available_from) : null,
      availableTo: p.available_to ? Date.parse(p.available_to) : null,
    });
  }
  for (const e of snap.entries ?? []) {
    // `numeric` llega como cadena por PostgREST: convertirlo aquí, una vez, evita que un
    // `"10" + 1 = "101"` se cuele en una suma de pesos.
    pools.get(e.pool_id)?.entries.push({ cardId: e.card_id, weight: Number(e.weight), mode: e.mode });
  }

  const porSobre = new Map<string, { pool: PoolDef; priority: number }[]>();
  for (const pp of snap.packPools ?? []) {
    const pool = pools.get(pp.pool_id);
    if (!pool) continue;
    const lista = porSobre.get(pp.pack_id) ?? [];
    lista.push({ pool, priority: pp.priority });
    porSobre.set(pp.pack_id, lista);
  }

  const byPack = new Map<string, PackDistribution>();
  for (const [packId, lista] of porSobre) {
    const d = composeDistribution(lista, now);
    if (d) byPack.set(packId, d);
  }

  return {
    version: Number(snap.version ?? 0),
    checksum: snap.checksum ?? "",
    pools,
    byPack,
    forPack: (packId) => byPack.get(packId) ?? null,
  };
}

async function readVersion(sb: SupabaseClient): Promise<number | null> {
  const { data, error } = await sb
    .from("content_distribution_version").select("version").eq("id", true).maybeSingle();
  if (error || !data) return null;
  return Number((data as { version: number }).version);
}

/**
 * La distribución vigente. Cachea entre peticiones y recarga solo cuando la versión sube.
 *
 * Falla **abierto hacia el comportamiento anterior**: si la tabla no existe todavía o la
 * lectura falla en frío, devuelve `EMPTY_DISTRIBUTION`, y entonces los sobres se abren
 * exactamente como antes de 8.3 en vez de no abrirse. Un fallo de configuración no puede
 * dejar a un jugador sin poder abrir un sobre que ya ha pagado.
 */
export async function serverDistribution(sb?: SupabaseClient, now = Date.now()): Promise<Distribution> {
  const db = sb ?? getSupabaseAdmin();
  if (!db) return EMPTY_DISTRIBUTION;

  if (cache && now - cache.lastCheck < VERSION_TTL_MS) return cache.dist;

  if (cache) {
    const v = await readVersion(db);
    cache.lastCheck = now;
    if (v === null) return cache.dist;              // lectura fallida ⇒ se sirve lo cargado
    if (v === cache.loadedVersion) return cache.dist;
  }

  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { data, error } = await db.rpc("app_content_distribution_snapshot");
      if (error || !data) {
        // Sin configuración legible se conserva la que hubiera; en frío, la vacía.
        return cache?.dist ?? EMPTY_DISTRIBUTION;
      }
      const dist = build(data as unknown as SnapshotRow, now);
      cache = { dist, loadedVersion: dist.version, lastCheck: Date.now() };
      return dist;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * La distribución YA CARGADA, sin `await`.
 *
 * Existe por un acoplamiento que hay que resolver explícitamente: el catálogo y la
 * distribución se cachean por separado y cambian por separado. Si el motor de sobres
 * capturase el objeto de distribución al construirse, publicar un pool nuevo NO lo
 * alcanzaría mientras el catálogo no cambiara — que es exactamente el escenario prohibido
 * por la Fase 12 del encargo.
 *
 * Leyéndola aquí, el motor ve siempre la última cargada. El contrato es el mismo que el de
 * `serverCatalogSync` en 8.2: se prepara con `await serverDistribution(sb)` en el punto de
 * entrada asíncrono —lo hace `serverCatalog()`— y se consume sin `await`.
 */
export function currentDistribution(): Distribution {
  return cache?.dist ?? EMPTY_DISTRIBUTION;
}

/** Olvida lo cacheado. Para verificadores y tests; ninguna ruta lo usa. */
export function resetServerDistribution(): void {
  cache = null;
  inflight = null;
}
