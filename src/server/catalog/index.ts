/**
 * CATÁLOGO DEL SERVIDOR — la autoridad de EXISTENCIA (Bloque 8.1) · SOLO SERVIDOR.
 *
 * ────────────────────────── QUÉ CAMBIA ──────────────────────────
 *
 * Hasta este bloque, todo lo que el servidor sabía de una carta venía de `CARDS`, un
 * `let` de módulo que `buildCatalog(PLAYERS)` rellena al importar. Funcionaba, pero
 * significaba que la respuesta a «¿esta carta existe?» dependía del proceso que la hiciera
 * y del código con el que arrancó. La auditoría lo resume en §1.8: con dos instancias,
 * dos catálogos.
 *
 * A partir de aquí el servidor pregunta a la base de datos. `content_cards` es la
 * autoridad de existencia; `cardsForPlayer()` sigue siendo la autoridad de GENERACIÓN.
 * No son dos catálogos rivales: el segundo produce al primero, y
 * `npm run content-catalog:verify` falla si alguna vez dejan de coincidir campo a campo.
 *
 * ────────────────────────── CÓMO NO SE QUEDA VIEJO ──────────────────────────
 *
 * Traer 772 filas en cada petición sería absurdo, y cachearlas para siempre sería el bug
 * de §1.8 otra vez. El equilibrio: se cachea el catálogo entero y se comprueba la VERSIÓN
 * (una fila, un entero, en `content_catalog_version`) como mucho una vez cada
 * `VERSION_TTL_MS`. Si la versión subió, se recarga; si no, la comprobación cuesta una
 * query trivial amortizada entre todas las peticiones de esa ventana.
 *
 * ────────────────────────── EL REPLIEGUE, DICHO EN VOZ ALTA ──────────────────────────
 *
 * Si la base de datos no está configurada, o `content_cards` está vacía (migración aún no
 * ejecutada), esto NO revienta el juego: devuelve el catálogo derivado del código y lo
 * marca `source: "seed-fallback"`. Es un repliegue explícito, no un silencio:
 *
 *   · queda en `ServerCatalog.source`, que las rutas pueden leer y el verificador
 *     comprueba en los dos sentidos (con BD → "db"; sin BD → "seed-fallback");
 *   · se avisa por consola UNA vez por proceso, no en cada petición;
 *   · y NO puede enmascarar una divergencia, porque el repliegue solo se activa cuando no
 *     hay NADA persistido. Con la tabla poblada, la BD manda siempre; un fallo de lectura
 *     con catálogo ya cargado devuelve el que hay en memoria, nunca el del código.
 *
 * Sin ese repliegue, un `npm run build` o un test sin Supabase delante se quedaría sin
 * catálogo — y eso convertiría la migración en un requisito de arranque, que es justo lo
 * que este bloque no debe imponer todavía.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { CARDS, allPlayers } from "@/data/catalog";
import { CardRegistry } from "@/collection/registry";
import { PackEngine } from "@/pack";
import type { CardDef, Player } from "@/domain/cards/types";
import { serverDistribution, currentDistribution, type Distribution } from "./distribution";
import {
  fromCardRow, fromPlayerRow, fromVersionRow, cardChecksum, catalogChecksum,
  RESOLVABLE_LIFECYCLES, DROPPABLE_LIFECYCLES,
  type ContentCardRow, type ContentPlayerRow, type ContentCardVersionRow, type CardLifecycle,
} from "./rows";

/** De dónde salió el catálogo que se está sirviendo. */
export type CatalogSource = "db" | "seed-fallback";

export interface ServerCatalog {
  source: CatalogSource;
  /** Configuración de pools vigente (bloque 8.3). Vacía = ningún sobre configurado. */
  readonly distribution: Distribution;
  /** Versión de `content_catalog_version`. 0 cuando se está sirviendo el repliegue. */
  version: number;
  /** Cartas RESOLUBLES: publicadas y retiradas. Es «lo que existe». */
  cards: CardDef[];
  /** Registro de resolución (publicadas + retiradas). Colección, mazos, mercado, desguace. */
  registry: CardRegistry;
  /**
   * Motor de sobres. Construido sobre el registro de SORTEO —solo publicadas—, que es una
   * pregunta distinta de «¿existe?». Ver `RESOLVABLE_LIFECYCLES` en `./rows`.
   */
  packEngine: PackEngine;
  /** Huella del catálogo servido. Comparable con la publicada sin traerse las filas. */
  checksum: string;
  /** La definición VIGENTE. Es lo que se puede obtener hoy. */
  card(cardId: string): CardDef | undefined;
  /**
   * La definición HISTÓRICA bajo la que se acuñó un ejemplar (bloque 8.2).
   *
   * Es la única función que hay que llamar para responder «¿qué carta tiene esta persona?».
   * `mintedVersion` sale de `user_cards.minted_version`; con `null` —carta fuera del
   * catálogo, o alta anterior al versionado— cae a la versión 1 y, si tampoco existe, a la
   * definición vigente. Nunca devuelve `undefined` por no encontrar la versión: eso dejaría
   * a alguien sin su carta, que es peor que servirle la vigente y que el diagnóstico
   * (`v_instance_version_gaps`) lo enseñe.
   */
  instance(cardId: string, mintedVersion: number | null | undefined): CardDef | undefined;
  /** ¿Se resolvió por la versión pedida? `false` = hubo repliegue (y hay que mirarlo). */
  instanceIsExact(cardId: string, mintedVersion: number | null | undefined): boolean;
  player(playerId: string): Player | undefined;
  has(cardId: string): boolean;
  /** Estado de la definición vigente. `undefined` si la carta no está en el catálogo. */
  lifecycleOf(cardId: string): CardLifecycle | undefined;
}

/**
 * Cuánto puede tardar un proceso en enterarse de una publicación. 5 s es despreciable para
 * un cambio de catálogo (que en 8.1 no ocurre nunca en caliente) y evita una query por
 * petición en las rutas con más tráfico.
 */
const VERSION_TTL_MS = 5_000;

interface Cache {
  catalog: ServerCatalog;
  loadedVersion: number;
  lastVersionCheck: number;
}

let cache: Cache | null = null;
let fallbackWarned = false;
/** Vuelo en curso: varias peticiones concurrentes comparten UNA carga, no N. */
let inflight: Promise<ServerCatalog> | null = null;

interface BuildInput {
  /** Definiciones vigentes RESOLUBLES (publicadas + retiradas). */
  cards: CardDef[];
  /** Subconjunto que puede salir en un sobre (publicadas). */
  droppable: CardDef[];
  players: Player[];
  /** Historial: clave `cardId#version`. Vacío en el repliegue. */
  versions: Map<string, CardDef>;
  lifecycles: Map<string, CardLifecycle>;
}

function build(input: BuildInput, source: CatalogSource, version: number): ServerCatalog {
  const { cards, droppable, players, versions, lifecycles } = input;
  const byPlayer = new Map(players.map((p) => [p.id, p]));
  const lookup = (id: string): Player | undefined => byPlayer.get(id);
  /*
   * El registro se construye con el `playerLookup` del CATÁLOGO PERSISTIDO, no con el del
   * código. Si no, el pool regional de los sobres seguiría resolviendo la región contra
   * `PLAYERS` y la autoridad se partiría por la mitad justo en la decisión que más importa.
   */
  const registry = new CardRegistry(cards, lookup);
  /*
   * Un SEGUNDO registro para el sorteo. Podría parecer duplicación: no lo es. Son dos
   * conjuntos distintos porque responden a dos preguntas distintas, y el motor de sobres
   * construye su pool recorriendo `registry.cards`. Mientras no haya cartas retiradas, los
   * dos conjuntos coinciden y `content-version:verify` lo comprueba abriendo sobres.
   */
  const dropRegistry = droppable.length === cards.length
    ? registry
    : new CardRegistry(droppable, lookup);

  const resolveInstance = (cardId: string, v: number | null | undefined): CardDef | undefined =>
    (v != null ? versions.get(`${cardId}#${v}`) : undefined)
    ?? versions.get(`${cardId}#1`)
    ?? registry.card(cardId);

  return {
    source,
    version,
    // Siempre la vigente, por la misma razón que el motor: catálogo y distribución cambian
    // por separado, y devolver una copia vieja aquí engañaría a quien la consultara.
    get distribution() { return currentDistribution(); },
    cards,
    registry,
    /*
     * BLOQUE 8.3 — el motor consulta la distribución VIVA en cada apertura, no una copia
     * capturada al construirse. Si capturase, publicar un pool no le llegaría hasta que
     * cambiara el catálogo — y son cosas que cambian por separado. Para un sobre sin pool
     * configurado devuelve `null`, y el sorteo es exactamente el de antes de 8.3.
     */
    packEngine: new PackEngine(dropRegistry, (packId) => currentDistribution().forPack(packId)),
    checksum: catalogChecksum(cards.map((c) => ({ cardId: c.id, checksum: cardChecksum(c) }))),
    card: (id) => registry.card(id),
    instance: resolveInstance,
    instanceIsExact: (id, v) => v != null && versions.has(`${id}#${v}`),
    player: lookup,
    has: (id) => registry.has(id),
    lifecycleOf: (id) => lifecycles.get(id),
  };
}

/**
 * El catálogo derivado del código, envuelto igual que el persistido.
 *
 * Sin base de datos no hay historial: `versions` va vacío y `instance()` cae a la
 * definición viva. Es el comportamiento anterior a 8.2, y es lo correcto en el repliegue —
 * fingir un historial que no se ha leído sería peor que no tenerlo. `source` lo delata.
 */
function seedCatalog(): ServerCatalog {
  const cards = [...CARDS];
  return build({
    cards, droppable: cards, players: allPlayers(),
    versions: new Map(), lifecycles: new Map(cards.map((c) => [c.id, "PUBLISHED" as CardLifecycle])),
  }, "seed-fallback", 0);
}

async function readVersion(sb: SupabaseClient): Promise<number | null> {
  const { data, error } = await sb
    .from("content_catalog_version").select("version").eq("id", true).maybeSingle();
  if (error || !data) return null;
  return Number((data as { version: number }).version);
}

/**
 * Trae el catálogo publicado. Pagina porque PostgREST corta en 1000 filas por defecto y
 * 772 cartas caben hoy — pero «hoy» no es una garantía que merezca la pena firmar.
 *
 * **Se ordena por `ordinal`, nunca por `card_id`.** El pool de un sobre se construye
 * recorriendo el catálogo en orden y `rng.pick()` elige por índice: leer alfabéticamente
 * daría el mismo conjunto de cartas en otras posiciones y la misma semilla entregaría otra
 * carta. Es un fallo real, no hipotético — lo detectó la familia 4 de
 * `content-catalog:verify` antes de que existiera la columna.
 */
async function fetchPage<T>(
  sb: SupabaseClient, table: string, columns: string, orderBy: string,
): Promise<T[] | null> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = sb.from(table).select(columns).order(orderBy, { ascending: true }).range(from, from + PAGE - 1);
    if (table === "content_cards") {
      q = q.in("lifecycle", RESOLVABLE_LIFECYCLES as unknown as string[]);
    }
    const { data, error } = await q;
    if (error) return null;
    const rows = (data ?? []) as unknown as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

async function loadFromDb(sb: SupabaseClient): Promise<ServerCatalog | null> {
  const version = await readVersion(sb);
  if (version === null) return null;

  const cardRows = await fetchPage<ContentCardRow>(sb, "content_cards", "*", "ordinal");
  if (!cardRows || cardRows.length === 0) return null; // sin migrar ⇒ repliegue
  const playerRows = await fetchPage<ContentPlayerRow>(sb, "content_players", "*", "id");
  if (!playerRows) return null;

  /*
   * El historial COMPLETO, de una vez. Hoy son 773 filas —una versión por carta—, del mismo
   * orden de magnitud que el catálogo, y crece solo cuando alguien publica una edición: no
   * con el tráfico ni con el número de jugadores. Traerlo entero evita la alternativa mala,
   * que sería una consulta por ejemplar al pintar una colección (N+1 de libro).
   *
   * Si algún día el historial creciera de verdad, lo que hay que cargar es el subconjunto
   * referenciado por `user_cards`, no volver a consultar por instancia.
   */
  const versionRows = await fetchPage<ContentCardVersionRow>(sb, "content_card_versions", "*", "card_id");
  if (!versionRows) return null;


  const cards = cardRows.map(fromCardRow);
  const presentationOf = new Map(cardRows.filter((r) => r.presentation).map((r) => [r.card_id, r.presentation!]));
  const droppable = cardRows
    .filter((r) => (DROPPABLE_LIFECYCLES as readonly string[]).includes(r.lifecycle))
    .map(fromCardRow);

  return build({
    cards,
    droppable,
    players: playerRows.map(fromPlayerRow),
    // F60 · las versiones de una carta del panel llevan lo impreso de su definición (inmutable tras publicar).
    versions: new Map(versionRows.map((r) => [`${r.card_id}#${r.version}`, fromVersionRow(r, presentationOf.get(r.card_id))])),
    lifecycles: new Map(cardRows.map((r) => [r.card_id, r.lifecycle])),
  }, "db", version);
}

function warnFallback(why: string): void {
  if (fallbackWarned) return;
  fallbackWarned = true;
  console.warn(
    `[content-catalog] repliegue al catálogo generado en código (${why}). ` +
    `La EXISTENCIA de las cartas no está saliendo de la base de datos. ` +
    `Ejecuta \`npm run content-catalog:migrate\` para materializarlo.`,
  );
}

/**
 * El catálogo vigente del servidor. Cachea entre peticiones y recarga solo cuando la
 * versión publicada cambia.
 *
 * `sb` es opcional: las rutas ya tienen un cliente `service_role` a mano (`session.admin`)
 * y pasarlo ahorra crearlo otra vez; sin él se usa el cliente admin del proceso.
 */
export async function serverCatalog(sb?: SupabaseClient): Promise<ServerCatalog> {
  const db = sb ?? getSupabaseAdmin();
  if (!db) {
    warnFallback("SUPABASE_SERVICE_ROLE_KEY no configurado");
    return (cache?.catalog.source === "seed-fallback" ? cache.catalog : (cache = {
      catalog: seedCatalog(), loadedVersion: 0, lastVersionCheck: Date.now(),
    }).catalog);
  }

  /*
   * La distribución se refresca en CADA llamada, no solo cuando el catálogo caduca: son dos
   * configuraciones que cambian por separado y publicar un pool no toca el catálogo. La
   * llamada está protegida por su propio TTL, así que en caché sale al instante.
   */
  await serverDistribution(db);

  const now = Date.now();
  if (cache && cache.catalog.source === "db" && now - cache.lastVersionCheck < VERSION_TTL_MS) {
    return cache.catalog;
  }

  if (cache && cache.catalog.source === "db") {
    // Comprobación barata: ¿sigue siendo mi versión la publicada?
    const v = await readVersion(db);
    cache.lastVersionCheck = now;
    if (v === null) return cache.catalog;          // lectura fallida ⇒ se sirve lo cargado
    if (v === cache.loadedVersion) return cache.catalog;
  }

  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const loaded = await loadFromDb(db);
      if (loaded) {
        cache = { catalog: loaded, loadedVersion: loaded.version, lastVersionCheck: Date.now() };
        return loaded;
      }
      /*
       * No hay catálogo persistido. Si ya se estaba sirviendo uno de la BD, se conserva:
       * un fallo de red no puede degradar en silencio la autoridad de existencia a la del
       * código. El repliegue solo es para el arranque en frío sin migrar.
       */
      if (cache?.catalog.source === "db") return cache.catalog;
      warnFallback("content_cards vacía o ilegible");
      cache = { catalog: seedCatalog(), loadedVersion: 0, lastVersionCheck: Date.now() };
      return cache.catalog;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Registro del catálogo persistido (índices por jugador/variante/región/rareza). */
export const serverRegistry = async (sb?: SupabaseClient): Promise<CardRegistry> =>
  (await serverCatalog(sb)).registry;

/**
 * El catálogo YA CARGADO, sin `await`.
 *
 * Existe por una razón concreta y acotada: en `services/duels.ts` hay ayudantes SÍNCRONOS
 * —`toPublicView`, la proyección de una carta a DTO, la construcción del mazo del bot— que
 * necesitan el registro y que están llamados desde media docena de sitios, incluido el
 * conjunto de pruebas. Convertirlos en asíncronos obligaría a reescribir esas pruebas para
 * no ganar nada: cuando se ejecutan, la función asíncrona que los envuelve ya ha hecho su
 * `await serverCatalog(sb)`.
 *
 * El contrato, por tanto, es: **prepara con `await serverCatalog()` en el punto de entrada
 * asíncrono y consume con esto**. No hay carrera —Node no interrumpe entre el `await` y el
 * uso— y no hay ambigüedad: antes de la primera carga esto devuelve el catálogo del
 * código, marcado `seed-fallback`, igual que el resto del módulo.
 *
 * No es un atajo para saltarse la carga. Si se usa sin haber preparado, se nota en
 * `source`, y `content-catalog:verify` comprueba justamente eso.
 */
export function serverCatalogSync(): ServerCatalog {
  if (cache) return cache.catalog;
  warnFallback("catálogo consultado antes de cargarse");
  cache = { catalog: seedCatalog(), loadedVersion: 0, lastVersionCheck: 0 };
  return cache.catalog;
}

/**
 * Motor de sobres sobre el catálogo persistido.
 *
 * El MOTOR no cambia: es el mismo `PackEngine` → `openPack()` → `Minter` de siempre, con
 * su pity, sus garantías, su anti-duplicado y su pool cacheado. Lo único que cambia es de
 * dónde salen las cartas elegibles. `content-catalog:verify` demuestra que, con la misma
 * semilla y el mismo estado, este motor y el de código devuelven exactamente lo mismo.
 */
export const serverPackEngine = async (sb?: SupabaseClient): Promise<PackEngine> =>
  (await serverCatalog(sb)).packEngine;

/** Olvida lo cacheado. Para tests y verificadores; no lo usa ninguna ruta. */
export function resetServerCatalog(): void {
  cache = null;
  inflight = null;
  fallbackWarned = false;
}
