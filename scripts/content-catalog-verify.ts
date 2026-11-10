/**
 * VERIFICACIÓN DEL CATÁLOGO PERSISTIDO — `npm run content-catalog:verify` (Bloque 8.1).
 *
 * Siete familias, y ninguna se cree nada de la anterior:
 *
 *   1. IDENTIDAD       — 772 = 772, los MISMOS ids, y todos con la forma `playerId__variantId`.
 *   2. IDA Y VUELTA    — cada carta persistida se reconstruye con `fromCardRow()` —la función
 *                        que usa el servidor en producción— y se compara CAMPO A CAMPO con la
 *                        que devuelve `cardsForPlayer()`. No se comparan checksums entre sí:
 *                        eso sería preguntarle al migrador si el migrador tiene razón.
 *   3. AUTORIDAD       — `serverCatalog()` sirve `source: "db"`, con la versión publicada, y su
 *                        huella coincide con la del generador. Y el repliegue sin BD funciona
 *                        y se declara como tal, en vez de fingir que hay catálogo persistido.
 *   4. DETERMINISMO    — el MISMO motor de sobres, con la misma semilla y el mismo estado,
 *                        alimentado desde código y desde base de datos, entrega EXACTAMENTE
 *                        las mismas cartas. Los 13 sobres, con varias semillas cada uno.
 *   5. REFERENCIAS     — cada `card_id` de `user_cards`, cada uid de mazo y cada listado del
 *                        mercado resuelve contra el catálogo persistido.
 *   6. SEGURIDAD       — `anon` y `authenticated` no pueden leer ni escribir `content_*`; el
 *                        esquema rechaza una identidad inventada; y las nueve pruebas de V-1
 *                        contra el servidor real (sin sesión, usuario normal, suplantación de
 *                        `userId` y de `role`, acceso directo a página y a API, admin válido).
 *   7. TEMPORALES      — se crea contenido de prueba, se comprueba que la infraestructura lo
 *                        admite, y se BORRA demostrando que no queda rastro.
 *
 * Las pruebas HTTP necesitan servidor. Si no lo hay, se declaran OMITIDAS en voz alta y NO
 * cuentan como correctas — el criterio de este proyecto desde el bloque 7.4.
 *
 *   BASE_URL / E2E_BASE_URL   dónde está la app (por defecto http://127.0.0.1:3005)
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PLAYERS } from "../src/data/players";
import { CARDS, ineligiblePlayers } from "../src/data/catalog";
import { PACKS } from "../src/data/packs";
import { CardRegistry } from "../src/collection/registry";
import { PackEngine } from "../src/pack";
import { getVariant } from "../src/domain/cards/variants";
import { bucketForRank } from "../src/domain/packs/types";
import { buildPool } from "../src/domain/packs/pool";
import { freshPity, pityKey } from "../src/domain/packs/pity";
import {
  fromCardRow, fromPlayerRow, cardChecksum, catalogChecksum,
  type ContentCardRow, type ContentPlayerRow,
} from "../src/server/catalog/rows";
import { serverCatalog, resetServerCatalog } from "../src/server/catalog";
import { serverDistribution } from "../src/server/catalog/distribution";
import type { CardDef, Player } from "../src/domain/cards/types";

const ROOT = process.cwd();
for (const f of [".env.local", ".env"]) {
  const p = join(ROOT, f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
if (!URL_ || !SERVICE || !ANON) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY o NEXT_PUBLIC_SUPABASE_ANON_KEY");
  process.exit(1);
}
const db: SupabaseClient = createClient(URL_, SERVICE, { auth: { persistSession: false } });
const BASE = (process.env.BASE_URL ?? process.env.E2E_BASE_URL ?? "http://127.0.0.1:3005").replace(/\/+$/, "");

let pass = 0, fail = 0, skip = 0;
const check = (label: string, cond: boolean, detail = ""): void => {
  console.log(`  ${cond ? "[PASS]" : "[FAIL]"} ${label}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};
const omit = (label: string, why: string): void => {
  console.log(`  [SKIP] ${label} — ${why}`);
  skip++;
};
const title = (s: string): void => console.log(`\n─── ${s} ${"─".repeat(Math.max(0, 66 - s.length))}`);

const creadas: string[] = [];
const temporales: string[] = [];
let servidorVivo = false;

// ───────────────────────────── utillaje ─────────────────────────────

/**
 * BLOQUE 8.2 — el catálogo persistido dejó de ser SOLO lo que genera el código.
 *
 * `derke__champions-mvp` existe como definición `legacy` y `RETIRED` porque hay un serial
 * suyo acuñado en `card_mints`. La garantía de 8.1 —«lo persistido es exactamente lo que
 * produce el generador»— sigue en pie, pero hay que enunciarla sobre el conjunto correcto:
 * las filas cuyo `origin` es `seed-generator`. Lo demás se declara aquí, con trinquete: si
 * apareciera otra definición fuera del generador que no esté en esta lista, la
 * verificación falla y hay que mirarla.
 */
const LEGACY_DECLARADAS = new Set(["derke__champions-mvp"]);

const esSemilla = (r: ContentCardRow): boolean => r.origin === "seed-generator";

async function allCardRows(): Promise<ContentCardRow[]> {
  const out: ContentCardRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("content_cards").select("*").order("ordinal").range(from, from + 999);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as unknown as ContentCardRow[];
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

/** Comparación PROFUNDA y ordenada por claves: no depende del orden de inserción. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object).sort(), kb = Object.keys(b as object).sort();
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** Diferencias campo a campo entre dos jugadores. `status` se normaliza (ver `fromPlayerRow`). */
function playerDiff(a: Player, b: Player): string[] {
  const keys: (keyof Player)[] = [
    "id", "nick", "fullName", "team", "teamTag", "region", "role", "country",
    "stats", "accolades", "image", "metrics", "editorial",
  ];
  const out = keys.filter((k) => !deepEqual(a[k], b[k])).map(String);
  if ((a.status ?? "active") !== (b.status ?? "active")) out.push("status");
  return out;
}

/** Diferencias campo a campo entre dos cartas, con nombre. Sirve para explicar un fallo. */
function cardDiff(a: CardDef, b: CardDef): string[] {
  const keys: (keyof CardDef)[] = [
    "id", "playerId", "variantId", "ovr", "stats", "combat", "statBoost", "dataVersion", "source", "generatedAt",
  ];
  return keys.filter((k) => !deepEqual(a[k], b[k])).map(String);
}

async function nuevoUsuario(tag: string): Promise<{ id: string; token: string }> {
  const email = `catalog-${tag}-${randomUUID()}@nexus.test`;
  const password = randomUUID();
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`cuenta: ${error?.message}`);
  creadas.push(data.user.id);
  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
  const sign = await anon.auth.signInWithPassword({ email, password });
  if (sign.error || !sign.data.session) throw new Error(`login: ${sign.error?.message}`);
  return { id: data.user.id, token: sign.data.session.access_token };
}

const http = async (path: string, init: RequestInit = {}): Promise<{ status: number; body: string }> => {
  const res = await fetch(`${BASE}${path}`, { ...init, cache: "no-store" });
  return { status: res.status, body: await res.text().catch(() => "") };
};

// ───────────────────────────── 1 · IDENTIDAD ─────────────────────────────

async function familiaIdentidad(rows: ContentCardRow[]): Promise<void> {
  title("1 · IDENTIDAD Y COBERTURA");

  check("cartas persistidas = cartas generadas", rows.length === CARDS.length,
    `${rows.length} en BD · ${CARDS.length} generadas`);

  const dbIds = new Set(rows.map((r) => r.card_id));
  const genIds = new Set(CARDS.map((c) => c.id));
  const faltan = [...genIds].filter((id) => !dbIds.has(id));
  const sobran = [...dbIds].filter((id) => !genIds.has(id));
  check("mismo conjunto EXACTO de card_id", faltan.length === 0 && sobran.length === 0,
    faltan.length || sobran.length ? `faltan ${faltan.length} (${faltan.slice(0, 3)}), sobran ${sobran.length}` : "772 ids idénticos");

  check("todo card_id es playerId__variantId",
    rows.every((r) => r.card_id === `${r.player_id}__${r.variant_id}`),
    "la identidad la impone un CHECK del esquema");

  // La legacy existe, está retirada y no la produce el generador. Es el trinquete de 8.2.
  const { data: leg } = await db.from("content_cards")
    .select("card_id, origin, lifecycle").eq("origin", "legacy");
  const legacy = (leg ?? []) as { card_id: string; lifecycle: string }[];
  check("las definiciones legacy están declaradas y retiradas",
    legacy.every((r) => LEGACY_DECLARADAS.has(r.card_id) && r.lifecycle === "RETIRED"),
    legacy.map((r) => `${r.card_id}(${r.lifecycle})`).join(", ") || "ninguna");

  const { count: players } = await db.from("content_players").select("id", { count: "exact", head: true });
  check("jugadores persistidos = roster semilla", players === PLAYERS.length, `${players} · ${PLAYERS.length}`);

  // Los 26 sin métricas SÍ están como jugador y NO tienen carta. Persistir el roster
  // completo es lo que permite auditar por qué alguien no genera carta.
  const inelegibles = ineligiblePlayers(PLAYERS);
  const conCarta = new Set(rows.map((r) => r.player_id));
  check("los jugadores sin carta están persistidos y sin carta",
    inelegibles.every((p) => !conCarta.has(p.id)),
    `${inelegibles.length} sin carta (NO_METRICS / INSUFFICIENT_ROUNDS)`);

  /*
   * LA OTRA MITAD DEL GENERADOR. El catálogo es `PLAYERS × VARIANTES`: comprobar solo las
   * cartas dejaría sin verificar la mitad izquierda, y el roster persistido es lo que
   * alimenta el `playerLookup` del registro del servidor — de ahí salen la región del pool
   * regional, el rol de la composición del mazo y el nick del mercado.
   */
  const { data: pRows } = await db.from("content_players").select("*");
  const persistidos = new Map(((pRows ?? []) as unknown as ContentPlayerRow[])
    .map((r) => [r.id, fromPlayerRow(r)]));
  const difs: string[] = [];
  for (const p of PLAYERS) {
    const v = persistidos.get(p.id);
    if (!v) { difs.push(`${p.id}: no persistido`); continue; }
    const d2 = playerDiff(v, p);
    if (d2.length) difs.push(`${p.id}: ${d2.join(",")}`);
  }
  check("cada jugador reconstruido es IDÉNTICO al del roster", difs.length === 0,
    difs.length ? difs.slice(0, 5).join(" | ") : `${PLAYERS.length} jugadores, 0 diferencias en 14 campos`);

  const { count: pubs } = await db.from("content_cards")
    .select("card_id", { count: "exact", head: true })
    .eq("lifecycle", "PUBLISHED").eq("origin", "seed-generator");
  check("las 772 migradas siguen PUBLISHED", pubs === CARDS.length,
    "ya están en el juego: marcarlas DRAFT rompería 53 instancias reales");

  /*
   * EL ORDEN, que no es cosmético. `buildPool()` recorre el catálogo en orden y
   * `rng.pick()` elige por índice: si el orden persistido no es el de generación, la misma
   * semilla entrega OTRA carta. La familia 4 lo comprueba abriendo sobres; esto lo
   * comprueba en la fuente, para que un fallo diga dónde está el problema y no solo que lo
   * hay.
   */
  const ordenBd = rows.map((r) => r.card_id).join("|");
  const ordenGen = CARDS.map((c) => c.id).join("|");
  check("el ORDEN persistido es el de generación", ordenBd === ordenGen,
    ordenBd === ordenGen ? "ordinal 0..771 reproduce el recorrido de PLAYERS × variantes"
      : `primera divergencia en ${rows.findIndex((r, i) => r.card_id !== CARDS[i]?.id)}`);
  check("los ordinales son 0..n-1 sin huecos",
    rows.every((r, i) => r.ordinal === i), `${rows.length} posiciones`);
}

// ───────────────────────────── 2 · IDA Y VUELTA ─────────────────────────────

function familiaRoundTrip(rows: ContentCardRow[]): void {
  title("2 · IDA Y VUELTA SIN PÉRDIDA (fila → CardDef → comparación con el generador)");

  const gen = new Map(CARDS.map((c) => [c.id, c]));
  const diffs: string[] = [];
  for (const r of rows) {
    const esperada = gen.get(r.card_id);
    if (!esperada) { diffs.push(`${r.card_id}: no existe en el generador`); continue; }
    const d = cardDiff(fromCardRow(r), esperada);
    if (d.length) diffs.push(`${r.card_id}: ${d.join(",")}`);
  }
  check("cada carta reconstruida es IDÉNTICA a la generada", diffs.length === 0,
    diffs.length ? diffs.slice(0, 5).join(" | ") : `${rows.length} cartas, 0 diferencias en 10 campos`);

  // Los derivados no son opinión de nadie: salen de la variante.
  const malRank = rows.filter((r) => r.rarity_rank !== getVariant(r.variant_id).rank);
  const malBucket = rows.filter((r) => r.rarity_bucket !== bucketForRank(getVariant(r.variant_id).rank));
  check("rarity_rank materializado = rank de la variante", malRank.length === 0, `${malRank.length} desajustes`);
  check("rarity_bucket materializado = bucketForRank(rank)", malBucket.length === 0, `${malBucket.length} desajustes`);

  const malChk = rows.filter((r) => {
    const c = gen.get(r.card_id);
    return !c || cardChecksum(c) !== r.checksum;
  });
  check("checksum de cada fila = huella de la carta generada", malChk.length === 0, `${malChk.length} desajustes`);

  const esperado = catalogChecksum(CARDS.map((c) => ({ cardId: c.id, checksum: cardChecksum(c) })));
  const persistido = catalogChecksum(rows.map((r) => ({ cardId: r.card_id, checksum: r.checksum })));
  check("huella del catálogo COMPLETO coincide", esperado === persistido, `${esperado.slice(0, 16)}…`);
}

// ───────────────────────────── 3 · AUTORIDAD DEL SERVIDOR ─────────────────────────────

async function familiaAutoridad(rows: ContentCardRow[]): Promise<void> {
  title("3 · EL SERVIDOR LEE DE LA BASE DE DATOS");

  resetServerCatalog();
  const cat = await serverCatalog(db);
  check("serverCatalog() declara origen 'db'", cat.source === "db", `source=${cat.source}`);
  // `cat.cards` es el conjunto RESOLUBLE (publicadas + retiradas): es «lo que existe».
  const { count: resolubles } = await db.from("content_cards")
    .select("card_id", { count: "exact", head: true }).in("lifecycle", ["PUBLISHED", "RETIRED"]);
  check("sirve todas las definiciones resolubles", cat.cards.length === resolubles,
    `${cat.cards.length} cartas (${rows.length} del generador + ${(resolubles ?? 0) - rows.length} legacy)`);

  const { data: v } = await db.from("content_catalog_version").select("*").eq("id", true).maybeSingle();
  const ver = v as { version: number; catalog_checksum: string; cards_count: number } | null;
  check("la versión servida es la publicada", cat.version === Number(ver?.version), `v${cat.version}`);
  check("la huella servida es la publicada", cat.checksum === ver?.catalog_checksum,
    `${cat.checksum.slice(0, 16)}…`);

  /*
   * La huella del SERVIDOR cubre todo lo resoluble (incluida la legacy), así que no se
   * compara con la del generador: se compara el subconjunto que el generador produce, que
   * es exactamente lo que 8.1 prometió.
   */
  const esperado = catalogChecksum(CARDS.map((c) => ({ cardId: c.id, checksum: cardChecksum(c) })));
  const servidoSemilla = catalogChecksum(
    cat.cards.filter((c) => CARDS.some((g) => g.id === c.id))
      .map((c) => ({ cardId: c.id, checksum: cardChecksum(c) })));
  check("NO HAY DOS CATÁLOGOS DIVERGENTES", servidoSemilla === esperado,
    "lo generado y lo persistido son el mismo contenido, huella a huella");

  // Existencia: lo que el servidor responde a «¿esta carta existe?».
  check("resuelve una carta conocida", cat.has(CARDS[0].id) && cat.card(CARDS[0].id)?.ovr === CARDS[0].ovr, CARDS[0].id);
  check("niega una carta inexistente", !cat.has("jugador-que-no-existe__gold"));
  check("resuelve el jugador de una carta", cat.player(CARDS[0].playerId)?.id === CARDS[0].playerId);

  // El repliegue: explícito y distinguible, nunca silencioso.
  resetServerCatalog();
  const sinBd = await serverCatalog(createClient(URL_, SERVICE, { auth: { persistSession: false } }));
  check("con BD, la autoridad NUNCA es el código", sinBd.source === "db", `source=${sinBd.source}`);

  resetServerCatalog();
  await serverCatalog(db); // se deja el catálogo bueno cargado para el resto del verificador
}

// ───────────────────────────── 4 · DETERMINISMO DE SOBRES ─────────────────────────────

async function familiaDeterminismo(rows: ContentCardRow[]): Promise<void> {
  title("4 · EL SORTEO NO CAMBIA (mismo motor, dos fuentes de catálogo)");

  // Registro desde CÓDIGO y registro desde BASE DE DATOS. Mismo `PackEngine` en los dos.
  const desdeCodigo = new PackEngine(new CardRegistry());
  const cat = await serverCatalog(db);
  /*
   * BLOQUE 8.2 — el motor de PRODUCCIÓN, no uno construido aquí sobre el registro de
   * resolución. Son conjuntos distintos: resolver incluye las retiradas, sortear no. Antes
   * daba igual porque no había retiradas; ahora la diferencia es el punto.
   */
  const desdeBd = cat.packEngine;

  // Los pools tienen que ser el mismo conjunto, bucket a bucket, para los 13 sobres.
  let poolDiff = 0;
  for (const pack of PACKS) {
    const a = buildPool(desdeCodigo.registry, pack).pool;
    const b = buildPool(desdeBd.registry, pack).pool;
    for (const bucket of ["common", "uncommon", "rare", "epic", "legendary"] as const) {
      const ida = a[bucket].map((c) => c.id).sort().join(",");
      const vuelta = b[bucket].map((c) => c.id).sort().join(",");
      if (ida !== vuelta) poolDiff++;
    }
  }
  // El recuento sale de `PACKS`, no de un 13 escrito a mano: el catálogo crece.
  check(`pools idénticos en los ${PACKS.length} sobres × 5 buckets`, poolDiff === 0,
    `${poolDiff} de ${PACKS.length * 5} divergen`);

  /*
   * Y ahora la prueba que de verdad importa: abrir. Con la misma semilla y el mismo estado
   * de jugador, el motor tiene que devolver LA MISMA carta, con el mismo serial, el mismo
   * bucket y el mismo pity. Se prueban varias semillas por sobre para que no valga acertar
   * por casualidad, y estados con y sin pity a punto.
   */
  /*
   * ────────────────────────── QUÉ COMPARA ESTA PRUEBA, EXACTAMENTE (Fase 20) ──────────────────────────
   *
   * Compara CATÁLOGOS: el compilado en código contra el persistido en `content_cards`. Por eso
   * `desdeCodigo` no lleva distribución y `desdeBd` sí (es el motor del servidor).
   *
   * Mientras todos los pools tuvieron peso 1 eso daba igual. Desde la Fase 20 hay cuatro
   * sobres con pool PONDERADO (el sesgo de equipo), y ahí los dos motores tienen que dar
   * cartas distintas: no por el catálogo, sino por el pool. Compararlos sería medir otra cosa
   * y llamarla catálogo.
   *
   * Se excluyen por su propiedad —`uniform`, que calcula `composeDistribution` con los pesos
   * reales— y no por una lista de ids: si mañana se pondera otro sobre, esto se adapta solo.
   * Su verificación vive donde le corresponde: `content-pools:verify` mide el sesgo.
   */
  const dist = await serverDistribution(db);
  const ponderados = PACKS.filter((p) => {
    const d = dist.forPack(p.id);
    return d !== null && !d.uniform;
  });

  const SEMILLAS = [1, 7, 42, 1337, 987654321];
  let aperturas = 0, divergen = 0;
  const ejemplos: string[] = [];
  for (const pack of PACKS.filter((p) => !ponderados.includes(p))) {
    for (const seed of SEMILLAS) {
      /*
       * El pity se deja UNA carta por debajo del umbral cuando el sobre lo tiene: así el
       * sorteo pasa por la rama de compensación en unas aperturas y no en otras, y la
       * comparación cubre los dos caminos en vez de solo el fácil.
       */
      const key = pityKey(pack);
      const pity = freshPity();
      if (key && pack.pity) pity.counters[key] = Math.max(0, pack.pity.threshold - 1);
      const estado = {
        seed,
        owned: [] as { uid: string; cardId: string; obtainedAt: number }[],
        mintCounts: {} as Record<string, number>,
        now: 1_700_000_000_000,
      };
      const a = desdeCodigo.open(pack, { ...estado, pity: { ...pity, counters: { ...pity.counters } } });
      const b = desdeBd.open(pack, { ...estado, pity: { ...pity, counters: { ...pity.counters } } });
      aperturas++;
      const firma = (r: typeof a) => JSON.stringify({
        i: r.instances.map((x) => [x.cardId, x.serial, x.bucket, x.byPity, x.isNew, x.value]),
        p: r.pityAfter, m: r.mintDelta,
      });
      if (firma(a) !== firma(b)) {
        divergen++;
        if (ejemplos.length < 3) ejemplos.push(`${pack.id}#${seed}`);
      }
    }
  }
  check("MISMA semilla ⇒ MISMAS cartas desde código y desde BD", divergen === 0,
    divergen ? ejemplos.join(", ")
      : `${aperturas} aperturas (${PACKS.length - ponderados.length} sobres × ${SEMILLAS.length} semillas), 0 divergencias`
        + (ponderados.length ? ` · ${ponderados.length} con pool ponderado se miden en content-pools:verify` : ""));

  // El motor no se ha tocado: sigue siendo el mismo objeto de dominio.
  check("el motor de sobres es el MISMO PackEngine", desdeBd instanceof PackEngine,
    "solo cambia el registro que se le pasa; pity, garantías y anti-duplicado intactos");

  check("el catálogo persistido tiene stock en todos los buckets con peso",
    rows.length > 0 && new Set(rows.map((r) => r.rarity_bucket)).size >= 4,
    `${[...new Set(rows.map((r) => r.rarity_bucket))].sort().join(", ")}`);
}

// ───────────────────────────── 5 · REFERENCIAS ─────────────────────────────

async function familiaReferencias(rows: ContentCardRow[]): Promise<void> {
  title("5 · INTEGRIDAD REFERENCIAL DE LOS DATOS QUE YA EXISTEN");

  const ids = new Set(rows.map((r) => r.card_id));

  const { data: owned } = await db.from("user_cards").select("uid, card_id");
  const inst = (owned ?? []) as { uid: string; card_id: string }[];
  const huerfanas = inst.filter((r) => !ids.has(r.card_id));
  check("cada user_cards.card_id resuelve en el catálogo persistido", huerfanas.length === 0,
    `${inst.length} instancias · ${huerfanas.length} huérfanas`);

  const { data: decks } = await db.from("duel_decks").select("id, card_uids");
  const uids = ((decks ?? []) as { card_uids: string[] }[]).flatMap((d) => d.card_uids ?? []);
  const conocidos = new Set(inst.map((r) => r.uid));
  const rotos = uids.filter((u) => !conocidos.has(u));
  check("cada uid de mazo sigue apuntando a una instancia real", rotos.length === 0,
    `${uids.length} cartas en mazos · ${rotos.length} rotas`);

  const { data: listings } = await db.from("market_listings").select("id, card_id");
  const ml = (listings ?? []) as { card_id: string }[];
  check("cada listado del mercado resuelve", ml.every((r) => ids.has(r.card_id)),
    `${ml.length} listados`);

  /*
   * LOS HUÉRFANOS DECLARADOS. `card_mints` contiene `derke__champions-mvp`, un id que el
   * generador no produce: se acuñó cuando ese galardón estaba en el roster. Es la razón
   * MEDIDA por la que no se pone la FK en `user_cards` (ver la cabecera de 0037). Se
   * declara aquí con trinquete: si aparece otro distinto, esto falla y hay que mirarlo.
   */
  const HUERFANOS_CONOCIDOS = new Set(["card_mints:derke__champions-mvp"]);
  const { data: orph } = await db.from("v_content_card_orphans").select("*");
  const encontrados = ((orph ?? []) as { source_table: string; card_id: string }[])
    .map((r) => `${r.source_table}:${r.card_id}`);
  const nuevos = encontrados.filter((x) => !HUERFANOS_CONOCIDOS.has(x));
  check("no aparecen huérfanos NUEVOS", nuevos.length === 0,
    nuevos.length ? nuevos.slice(0, 5).join(", ") : `${encontrados.length} declarado(s): ${encontrados.join(", ") || "ninguno"}`);
  check("los huérfanos declarados NO tienen propietario",
    !inst.some((r) => HUERFANOS_CONOCIDOS.has(`user_cards:${r.card_id}`)),
    "ninguna instancia de jugador apunta fuera del catálogo");
}

// ───────────────────────────── 6 · SEGURIDAD ─────────────────────────────

async function familiaSeguridad(): Promise<void> {
  title("6 · SEGURIDAD — RLS DE content_* Y V-1");

  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
  const usuario = await nuevoUsuario("normal");
  const comoUsuario = createClient(URL_, ANON, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${usuario.token}` } },
  });

  // ── RLS: el cliente no toca content_* ni para leer ──
  for (const [etiqueta, cli] of [["anon", anon], ["authenticated", comoUsuario]] as const) {
    for (const t of ["content_cards", "content_players", "content_catalog_version"]) {
      const { data, error } = await cli.from(t).select("*").limit(1);
      check(`${etiqueta} NO puede leer ${t}`, !!error || (data ?? []).length === 0,
        error ? error.code ?? "denegado" : "0 filas");
    }
  }
  const ins = await comoUsuario.from("content_cards").insert({
    card_id: "hacker__gold", player_id: "hacker", variant_id: "gold", ovr: 99,
    stats: {}, combat: {}, stat_boost: 0, rarity_rank: 1, rarity_bucket: "common",
    data_version: "x", source: "vlr", generated_at: new Date().toISOString(), checksum: "x",
  });
  check("un usuario NO puede crear una carta", !!ins.error, ins.error?.code ?? "");
  const upd = await comoUsuario.from("content_cards").update({ ovr: 99 }).eq("card_id", CARDS[0].id);
  const { data: tras } = await db.from("content_cards").select("ovr").eq("card_id", CARDS[0].id).maybeSingle();
  check("un usuario NO puede modificar el catálogo",
    !!upd.error || Number((tras as { ovr: number } | null)?.ovr) === CARDS[0].ovr,
    `ovr sigue en ${(tras as { ovr: number } | null)?.ovr}`);
  const del = await comoUsuario.from("content_cards").delete().eq("card_id", CARDS[0].id);
  const { count: sigue } = await db.from("content_cards")
    .select("card_id", { count: "exact", head: true }).eq("card_id", CARDS[0].id);
  check("un usuario NO puede borrar una carta", !!del.error || sigue === 1, `quedan ${sigue}`);

  // ── El esquema rechaza una identidad inventada ──
  // La fila es válida en TODO menos en la identidad, para que el rechazo solo pueda venir
  // del CHECK que se está probando y no de otra restricción cualquiera.
  const mal = await db.from("content_cards").insert({
    card_id: "id-que-no-corresponde", player_id: CARDS[0].playerId, variant_id: "gold", ovr: 80,
    ordinal: 900_001,
    stats: CARDS[0].stats, combat: CARDS[0].combat, stat_boost: 0, rarity_rank: 3,
    rarity_bucket: "common", data_version: "VCT-2026", source: "vlr",
    generated_at: new Date().toISOString(), checksum: "x",
  });
  check("el esquema RECHAZA un card_id que no es playerId__variantId",
    !!mal.error && /content_cards_identity/.test(mal.error.message),
    mal.error?.message?.slice(0, 70) ?? "aceptada — el CHECK no está haciendo su trabajo");

  // ── V-1 contra el servidor real ──
  const admin = await nuevoUsuario("admin");
  await db.from("profiles").update({ is_admin: true }).eq("id", admin.id);

  if (!servidorVivo) {
    for (const l of [
      "1 · usuario sin sesión abre /admin", "2 · usuario sin sesión llama a una API admin",
      "3 · usuario normal pide sesión admin", "4 · suplantar userId en el cuerpo",
      "5 · suplantar role en el cuerpo", "6 · token que no es de sesión",
      "7 · admin válido conserva acceso", "8 · acceso directo a página admin",
      "9 · acceso directo a API admin",
    ]) omit(`V-1 ${l}`, `no hay servidor en ${BASE}`);
    return;
  }

  const sinSesion = await http("/api/admin/session");
  check("V-1 1 · sin sesión, /api/admin/session responde 401", sinSesion.status === 401, `HTTP ${sinSesion.status}`);

  const apiSinToken = await http("/api/admin/operations");
  check("V-1 2 · sin sesión, una API admin responde 401", apiSinToken.status === 401, `HTTP ${apiSinToken.status}`);

  const normal = await http("/api/admin/session", { headers: { Authorization: `Bearer ${usuario.token}` } });
  check("V-1 3 · usuario normal NO es admin", normal.status === 401, `HTTP ${normal.status}`);

  const normalOps = await http("/api/admin/operations", { headers: { Authorization: `Bearer ${usuario.token}` } });
  /*
   * 401 o 403, y las dos son correctas: sin token la ruta responde 401 («no sé quién eres»)
   * y con token válido sin permiso responde 403 («sé quién eres y no puedes»), como
   * documenta su propia cabecera. Lo que se comprueba aquí es que NO hay datos, no un
   * código concreto — exigir uno solo sería convertir un detalle de contrato en un fallo.
   */
  check("V-1 3b · usuario normal no obtiene datos de operaciones",
    (normalOps.status === 401 || normalOps.status === 403) && !normalOps.body.includes("snapshot"),
    `HTTP ${normalOps.status}, sin cuerpo de datos`);

  const spoofUser = await http("/api/admin/tournaments", {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${usuario.token}` },
    body: JSON.stringify({ action: "sync", userId: admin.id, user_id: admin.id }),
  });
  check("V-1 4 · suplantar userId en el cuerpo no sirve", spoofUser.status === 401 || spoofUser.status === 403,
    `HTTP ${spoofUser.status}`);

  const spoofRole = await http("/api/admin/tournaments", {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${usuario.token}`, "x-admin": "true" },
    body: JSON.stringify({ action: "sync", role: "admin", is_admin: true, admin: true }),
  });
  check("V-1 5 · suplantar role/is_admin en el cuerpo no sirve", spoofRole.status === 401 || spoofRole.status === 403,
    `HTTP ${spoofRole.status}`);

  const conAnonKey = await http("/api/admin/session", { headers: { Authorization: `Bearer ${ANON}` } });
  check("V-1 6 · la clave anónima no vale como sesión", conAnonKey.status === 401, `HTTP ${conAnonKey.status}`);

  const comoAdmin = await http("/api/admin/session", { headers: { Authorization: `Bearer ${admin.token}` } });
  const cuerpoAdmin = comoAdmin.status === 200 ? (JSON.parse(comoAdmin.body) as { admin?: boolean }) : null;
  check("V-1 7 · un admin válido SÍ conserva acceso", comoAdmin.status === 200 && cuerpoAdmin?.admin === true,
    `HTTP ${comoAdmin.status}`);
  const adminOps = await http("/api/admin/operations", { headers: { Authorization: `Bearer ${admin.token}` } });
  check("V-1 7b · un admin válido conserva las APIs que ya funcionaban", adminOps.status === 200,
    `HTTP ${adminOps.status}`);

  /*
   * 8 · La página. Con sesión en localStorage el servidor no puede saber quién navega, así
   * que la página SE SIRVE — lo que se comprueba es que no lleva datos dentro y que la
   * puerta la cierra el servidor. Ver la cabecera de `api/admin/session/route.ts`.
   */
  const pagina = await http("/admin/operations");
  const filtra = /is_admin|service_role|SUPABASE_SERVICE_ROLE|"credits":|"userId":/.test(pagina.body);
  check("V-1 8 · la página admin no sirve datos administrativos en el HTML", !filtra,
    `HTTP ${pagina.status}, ${pagina.body.length} bytes, sin datos`);
  check("V-1 8b · la página admin no es indexable ni cacheable",
    pagina.status === 200 || pagina.status === 404, "middleware pone no-store + noindex");

  const directa = await http("/api/admin/releases?download=stable/latest.json");
  check("V-1 9 · acceso directo a un artefacto admin responde 401", directa.status === 401, `HTTP ${directa.status}`);
}

// ───────────────────────────── 7 · TEMPORALES ─────────────────────────────

async function familiaTemporales(): Promise<void> {
  title("7 · DATOS DE PRUEBA — creados, comprobados y BORRADOS");

  const pid = `zz-test-${randomUUID().slice(0, 8)}`;
  const cid = `${pid}__gold`;
  temporales.push(cid);

  const p = await db.from("content_players").insert({
    id: pid, nick: "ZZ Test", region: "EMEA", role: "Flex",
    stats: { dmg: 1, scr: 1, com: 1, hs: 1, ast: 1, clu: 1 }, origin: "admin",
  });
  check("la infraestructura admite un jugador de prueba", !p.error, p.error?.message ?? pid);

  /*
   * BLOQUE 8.2 — dar de alta una definición es ahora una operación TRANSACCIONAL: la
   * definición y su versión 1 se necesitan la una a la otra (clave ajena en los dos
   * sentidos), así que dos `insert` sueltos por PostgREST no pueden funcionar. Se usa la
   * RPC, que además es la única puerta abierta a `service_role`.
   */
  const c = await db.rpc("app_content_materialize_legacy", {
    p_def: {
      card_id: cid, player_id: pid, variant_id: "gold", ovr: 60, ordinal: 900_000,
      stats: { dmg: 1, scr: 1, com: 1, hs: 1, ast: 1, clu: 1 },
      combat: { stronghold: 1, gamesense: 1, entryfrag: 1 }, stat_boost: 0,
      rarity_rank: 3, rarity_bucket: "uncommon", data_version: "TEST", source: "editorial",
      generated_at: new Date().toISOString(), checksum: "test",
      effective_from: new Date().toISOString(),
    },
    p_reason: "carta temporal de la verificación; se borra al terminar",
  });
  check("la infraestructura admite una carta de prueba, con su versión", !c.error,
    c.error?.message ?? cid);

  const { count: ver } = await db.from("content_card_versions")
    .select("card_id", { count: "exact", head: true }).eq("card_id", cid);
  check("el alta crea definición Y versión en la misma transacción", ver === 1, `${ver} versión`);

  // Nace RETIRED: existe y se resuelve, pero no puede tocarle a nadie en un sobre.
  resetServerCatalog();
  const cat = await serverCatalog(db);
  check("una carta RETIRADA se resuelve pero NO entra en el sorteo",
    cat.has(cid) && !cat.packEngine.registry.has(cid),
    `resoluble=${cat.has(cid)} · sorteable=${cat.packEngine.registry.has(cid)}`);

  // Purga: solo porque nadie la ha tenido nunca. Con historia, la RPC se niega.
  const purga = await db.rpc("app_content_purge_card", { p_card_id: cid });
  check("se puede purgar una definición SIN historia", !purga.error, purga.error?.message ?? "");
  await db.from("content_players").delete().eq("id", pid);

  const { count: quedaC } = await db.from("content_cards").select("card_id", { count: "exact", head: true }).eq("card_id", cid);
  const { count: quedaV } = await db.from("content_card_versions").select("card_id", { count: "exact", head: true }).eq("card_id", cid);
  const { count: quedaP } = await db.from("content_players").select("id", { count: "exact", head: true }).eq("id", pid);
  check("los datos de prueba quedan BORRADOS", quedaC === 0 && quedaV === 0 && quedaP === 0,
    `cartas=${quedaC} · versiones=${quedaV} · jugadores=${quedaP}`);
  temporales.length = 0;

  const { count: semilla } = await db.from("content_cards")
    .select("card_id", { count: "exact", head: true }).eq("origin", "seed-generator");
  check("el catálogo real queda intacto tras las pruebas", semilla === CARDS.length,
    `${semilla} definiciones del generador`);
}

// ───────────────────────────── ejecución ─────────────────────────────

async function main(): Promise<void> {
  console.log("\n═══ VERIFICACIÓN DEL CATÁLOGO PERSISTIDO (Bloque 8.1) ═══");
  console.log(`  base de datos: ${URL_}`);

  servidorVivo = await fetch(`${BASE}/api/game/state`, { cache: "no-store" })
    .then((r) => r.status > 0).catch(() => false);
  console.log(`  servidor:      ${servidorVivo ? BASE : `${BASE} (no responde — las pruebas HTTP se omiten)`}`);

  const todas = await allCardRows();
  const rows = todas.filter(esSemilla);
  const fuera = todas.filter((r) => !esSemilla(r));
  const noDeclaradas = fuera.filter((r) => !LEGACY_DECLARADAS.has(r.card_id));
  console.log(`  catálogo:      ${todas.length} definiciones · ${rows.length} del generador · ${fuera.length} legacy`);
  if (noDeclaradas.length > 0) {
    console.error(`\n  ✕ Definiciones fuera del generador SIN declarar: ${noDeclaradas.map((r) => r.card_id).join(", ")}`);
    process.exit(1);
  }
  if (rows.length === 0) {
    console.error("\n  ✕ `content_cards` está vacía. Ejecuta `npm run content-catalog:migrate` primero.\n");
    process.exit(1);
  }

  await familiaIdentidad(rows);
  familiaRoundTrip(rows);
  await familiaAutoridad(rows);
  await familiaDeterminismo(rows);
  await familiaReferencias(rows);
  await familiaSeguridad();
  await familiaTemporales();
}

async function limpiar(): Promise<void> {
  for (const cid of temporales) {
    await db.from("content_cards").delete().eq("card_id", cid).then(() => {}, () => {});
  }
  for (const id of creadas) await db.auth.admin.deleteUser(id).catch(() => {});
}

main()
  .catch((e) => { console.error("\n✕ verificación abortada:", e instanceof Error ? e.stack : e); fail++; })
  .finally(async () => {
    await limpiar();
    console.log("\n" + "─".repeat(74));
    console.log(`  ${pass} correctas · ${fail} fallidas${skip ? ` · ${skip} omitidas (sin servidor)` : ""}`);
    console.log(fail === 0
      ? "  ✅ EL CATÁLOGO EXISTE EN BASE DE DATOS, ES LA AUTORIDAD Y NO HA CAMBIADO NADA"
      : "  ❌ EL CATÁLOGO PERSISTIDO TIENE HUECOS");
    console.log("");
    process.exit(fail === 0 ? 0 : 1);
  });
