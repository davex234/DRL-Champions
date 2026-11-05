/**
 * PROYECCIÓN Y RECONSTRUCCIÓN del catálogo persistido (Bloque 8.1).
 *
 * Un solo sitio traduce entre el dominio y las filas de `content_players` / `content_cards`:
 *
 *      CardDef  ──toCardRow()──►  ContentCardRow  ──fromCardRow()──►  CardDef
 *
 * Que las dos direcciones vivan juntas no es comodidad: es lo que hace **demostrable** que
 * persistir no pierde nada. El verificador no compara la fila con otra fila —eso sería
 * comparar el migrador consigo mismo—, sino que reconstruye el `CardDef` desde la BD con
 * `fromCardRow()` (la MISMA función que usa el servidor en producción) y lo compara campo a
 * campo con el que devuelve `cardsForPlayer()`. Ida y vuelta sin pérdida, o falla.
 *
 * NADA de esto deriva estadísticas. La matemática sigue estando en `@/domain/cards`; aquí
 * solo se copia, se serializa y se vuelve a leer.
 */
import { createHash } from "node:crypto";
import type {
  CardDef, CardStatsSource, Player, PlayerStats, PrintedStats, Region, RoleId, VariantId, AccoladeId,
} from "@/domain/cards/types";
import type { CombatStats, StatBoostStep } from "@/domain/cards/combat";
import type { RawMetrics } from "@/domain/cards/statsFromMetrics";
import { getVariant } from "@/domain/cards/variants";
import { bucketForRank, type RarityBucket } from "@/domain/packs/types";
import { CARD_MANIFEST } from "@/data/cardCatalog";
import { printedTeamTag, repairMojibake } from "@/data/teamText";

// ───────────────────────────── Forma de las filas ─────────────────────────────

export interface ContentPlayerRow {
  id: string;
  nick: string;
  full_name: string | null;
  team: string;
  team_tag: string;
  region: Region;
  role: RoleId;
  country: string;
  stats: PlayerStats;
  metrics: RawMetrics | null;
  editorial: Player["editorial"] | null;
  accolades: AccoladeId[];
  image: string | null;
  status: "active" | "inactive";
  origin: "seed" | "admin" | "import";
}

export interface ContentCardRow {
  card_id: string;
  player_id: string;
  variant_id: VariantId;
  /**
   * Posición en el catálogo generado. Ver la columna homónima en 0037: el sorteo de sobres
   * elige por índice dentro del pool, así que el ORDEN forma parte del comportamiento y no
   * puede reconstruirse ordenando por `card_id`.
   */
  ordinal: number;
  ovr: number;
  stats: PlayerStats;
  combat: CombatStats;
  stat_boost: StatBoostStep;
  rarity_rank: number;
  rarity_bucket: RarityBucket;
  data_version: string;
  source: CardStatsSource;
  generated_at: string;
  origin: "seed-generator" | "admin" | "tournament";
  lifecycle: CardLifecycle;
  definition_version: number;
  checksum: string;
  /** F60 · lo IMPRESO de una carta creada desde /admin (NULL en las 331 del catálogo diseñado: manifiesto). */
  presentation?: CardPresentation | null;
}

/** F60 · Presentación impresa de una carta del panel: rol de carta, OVR y 6 stats impresas, equipo impreso y arte. */
export interface CardPresentation {
  role: RoleId;
  printed: { ovr: number; stats: PrintedStats };
  team: string;
  imageAssetId?: string;
  /** Ruta EXACTA del asset en Storage (la RPC comprueba que coincide con el asset). */
  imagePath?: string;
}

/** URL pública de un objeto del bucket `assets` (la misma forma que `getPublicUrl`). `null` sin Supabase configurado. */
export function storagePublicUrl(path: string | null | undefined): string | null {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  if (!path || !base) return null;
  return `${base}/storage/v1/object/public/assets/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/** Estados posibles de una definición. Las transiciones legales las impone `app_content_set_lifecycle`. */
export type CardLifecycle =
  | "DRAFT" | "REVIEW" | "APPROVED" | "PUBLISHED" | "RETIRED" | "ARCHIVED" | "REJECTED";

/**
 * LAS DOS PREGUNTAS QUE NO SON LA MISMA (bloque 8.2).
 *
 * 8.1 solo cargaba `PUBLISHED`, y eso era correcto mientras no existiera el estado
 * `RETIRED`. En cuanto una carta se puede retirar, mezclar las dos preguntas rompe
 * colecciones:
 *
 *   «¿existe esta carta?»          → colección, inventario, mazos, mercado, desguace
 *                                    PUBLISHED ∪ RETIRED. Retirar NO es borrar: quien la
 *                                    tiene la sigue teniendo, la sigue jugando y la sigue
 *                                    pudiendo vender.
 *
 *   «¿puede tocarme en un sobre?»  → pool de sorteo
 *                                    PUBLISHED y nada más.
 *
 * Si el catálogo del servidor solo cargara lo publicado, retirar una carta dejaría a sus
 * dueños con un `uid` que no resuelve: mazo inválido, listado invisible, desguace que se la
 * salta. Sería introducir el daño que este bloque existe para impedir.
 */
export const RESOLVABLE_LIFECYCLES: readonly CardLifecycle[] = ["PUBLISHED", "RETIRED"];
/** Solo estas entran en el sorteo de sobres. */
export const DROPPABLE_LIFECYCLES: readonly CardLifecycle[] = ["PUBLISHED"];

// ───────────────────────────── Huellas ─────────────────────────────

/**
 * Una carta con TODO lo que el catálogo persistido necesita.
 *
 * En `CardDef` los campos del modelo de combate son opcionales por historia del tipo, pero
 * su propio comentario dice que «los rellena SIEMPRE el constructor del catálogo». Aquí esa
 * promesa deja de ser un comentario: las columnas son `not null`, así que una carta que no
 * la cumpla no se persiste. Se comprueba explícitamente en vez de rellenar con un valor por
 * defecto — inventar un `combat` sería exactamente la clase de dato falso que el generador
 * se niega a producir cuando faltan métricas.
 */
export type CompleteCard = CardDef &
  Required<Pick<CardDef, "combat" | "statBoost" | "dataVersion" | "source" | "generatedAt">>;

export function assertComplete(card: CardDef): CompleteCard {
  const missing = (["combat", "statBoost", "dataVersion", "source", "generatedAt"] as const)
    .filter((k) => card[k] === undefined);
  if (missing.length > 0) {
    throw new Error(`Carta ${card.id} sin ${missing.join(", ")}: no se puede persistir sin inventar datos`);
  }
  return card as CompleteCard;
}

/**
 * Huella de los campos de una carta que AFECTAN AL JUEGO.
 *
 * Deliberadamente NO incluye `lifecycle`, `definition_version`, `origin` ni las marcas de
 * tiempo de fila: retirar una carta o republicarla no cambia lo que la carta ES. Si el
 * checksum entrara en juego con esos campos, cualquier operación administrativa parecería
 * una divergencia de contenido, y el trinquete dejaría de significar nada.
 *
 * `generatedAt` sí entra: es `CATALOG_GENERATED_AT`, una constante del build, no un reloj.
 */
export function cardChecksum(input: CardDef): string {
  const card = assertComplete(input);
  const canonical = JSON.stringify([
    card.id, card.playerId, card.variantId, card.ovr,
    card.stats.dmg, card.stats.scr, card.stats.com, card.stats.hs, card.stats.ast, card.stats.clu,
    card.combat.stronghold, card.combat.gamesense, card.combat.entryfrag,
    card.statBoost, card.dataVersion, card.source, card.generatedAt,
    // Catálogo diseñado: el rol impreso decide la composición del mazo, así que entra en la
    // huella. Cartas sin rol propio no añaden nada y su huella no cambia.
    ...(card.role ? [card.role] : []),
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Huella del catálogo COMPLETO: sha256 sobre los checksums de carta ordenados por id.
 *
 * Responde «¿mi copia en memoria es exactamente la publicada?» con una comparación de
 * cadena en vez de 772. Es lo que hace barato comprobar la no-divergencia en cada arranque
 * y en CI.
 */
export function catalogChecksum(checksums: { cardId: string; checksum: string }[]): string {
  const sorted = [...checksums].sort((a, b) => (a.cardId < b.cardId ? -1 : a.cardId > b.cardId ? 1 : 0));
  const h = createHash("sha256");
  /*
   * SEPARADOR EXPLÍCITO, y merece un comentario porque costó encontrarlo.
   *
   * Aquí había un byte NUL —invisible en cualquier editor— y funcionó hasta que el bloque
   * 8.3 necesitó calcular la MISMA huella en SQL para invalidar la caché del catálogo:
   * PostgreSQL no admite un byte NUL dentro de un `text`, así que esa huella era imposible de
   * reproducir del otro lado. Se comparaban dos números que nunca podrían coincidir.
   *
   * El espacio no es una elección estética: es el separador que las dos implementaciones
   * pueden escribir, y sigue siendo inequívoco porque ni un `card_id` ni un checksum
   * hexadecimal contienen espacios. La otra mitad vive en `_bump_catalog()` (0039 §9), que
   * usa `order by card_id collate "C"` para ordenar igual que la comparación de cadenas de
   * JavaScript.
   */
  const SEP = " ";
  for (const c of sorted) h.update(c.cardId).update(SEP).update(c.checksum).update(SEP);
  return h.digest("hex");
}

// ───────────────────────────── Dominio → fila ─────────────────────────────

export function toPlayerRow(p: Player): ContentPlayerRow {
  return {
    id: p.id,
    nick: p.nick,
    full_name: p.fullName ?? null,
    team: p.team,
    team_tag: p.teamTag,
    region: p.region,
    role: p.role,
    country: p.country,
    stats: p.stats,
    metrics: p.metrics ?? null,
    editorial: p.editorial ?? null,
    accolades: p.accolades,
    image: p.image ?? null,
    status: p.status ?? "active",
    origin: "seed",
  };
}

export function toCardRow(input: CardDef, ordinal: number): ContentCardRow {
  const card = assertComplete(input);
  // La rareza NO se inventa aquí: se lee de la variante, que es donde vive la regla.
  const rank = getVariant(card.variantId).rank;
  return {
    card_id: card.id,
    player_id: card.playerId,
    variant_id: card.variantId,
    ordinal,
    ovr: card.ovr,
    stats: card.stats,
    combat: card.combat,
    stat_boost: card.statBoost as StatBoostStep,
    rarity_rank: rank,
    rarity_bucket: bucketForRank(rank),
    data_version: card.dataVersion,
    source: card.source,
    generated_at: card.generatedAt,
    origin: "seed-generator",
    lifecycle: "PUBLISHED",
    definition_version: 1,
    checksum: cardChecksum(card),
  };
}

/**
 * Una fila de `content_card_versions`: qué era la carta bajo esa versión.
 *
 * Es un subconjunto deliberado de `ContentCardRow`: no lleva `ordinal` (el orden es del
 * catálogo vigente, no de la historia) ni `lifecycle` (el ciclo de vida es de la
 * definición: una carta retirada no retira su pasado).
 */
export interface ContentCardVersionRow {
  card_id: string;
  version: number;
  player_id: string;
  variant_id: VariantId;
  ovr: number;
  combat: CombatStats;
  stats: PlayerStats;
  stat_boost: StatBoostStep;
  rarity_rank: number;
  rarity_bucket: RarityBucket;
  data_version: string;
  source: CardStatsSource;
  generated_at: string;
  checksum: string;
  effective_from: string;
  effective_to: string | null;
}

// ───────────────────────────── Fila → dominio ─────────────────────────────

/**
 * Reconstruye el `Player` semilla. Es lo que alimenta el `playerLookup` del registro del
 * servidor (nick, equipo, región y rol se usan en el pool regional, en la composición del
 * mazo y en las vistas del mercado).
 */
export function fromPlayerRow(r: ContentPlayerRow): Player {
  const p: Player = {
    id: r.id,
    // `content_players` guarda los mismos textos en mojibake que la descarga de VLR: se reparan igual
    // que en `data/players`, para que servidor y cliente enseñen y agrupen el mismo equipo.
    nick: repairMojibake(r.nick),
    team: repairMojibake(r.team),
    teamTag: repairMojibake(r.team_tag),
    region: r.region,
    role: r.role,
    country: r.country,
    stats: r.stats,
    accolades: r.accolades ?? [],
  };
  // Los opcionales se OMITEN cuando no hay valor, en vez de ponerse a `undefined`: así el
  // objeto reconstruido es estructuralmente idéntico al del código y la comparación
  // profunda del verificador no falla por una clave presente-pero-vacía.
  if (r.full_name !== null) p.fullName = r.full_name;
  if (r.image !== null) p.image = r.image;
  if (r.metrics !== null) p.metrics = r.metrics;
  /*
   * `status` es el ÚNICO campo que la ida y vuelta normaliza, y conviene decirlo en voz
   * alta: en el código es opcional («ausente» significa activo) y en la columna es
   * `not null default 'active'`. Al volver siempre viene explícito. No se pierde
   * información —los dos estados posibles se conservan— pero un jugador sin `status` en
   * `players.ts` vuelve con `status: "active"`. El verificador compara `status ?? "active"`
   * por eso, y no por indulgencia.
   */
  p.status = r.status;
  if (r.editorial !== null) p.editorial = r.editorial;
  return p;
}

/**
 * Reconstruye el `CardDef` EXACTO que produjo el generador. Esta función es la autoridad de
 * existencia en tiempo de ejecución: todo lo que el servidor sabe de una carta pasa por
 * aquí. No recalcula nada — si un campo no estuviera en la fila, la BD no sería autoridad.
 */
/**
 * Reconstruye el `CardDef` que recibió el usuario, desde el registro histórico.
 *
 * Es la función que hace cierto el criterio 4 del bloque: dado un ejemplar y su
 * `minted_version`, esto devuelve la carta EXACTA de aquel momento, sin mirar la definición
 * viva. Su forma es idéntica a la de `fromCardRow` a propósito: para todo lo que consume un
 * `CardDef` —economía, mazos, mercado— la carta histórica y la vigente son
 * indistinguibles salvo en su contenido, que es justo lo que debe distinguirlas.
 */
export function fromVersionRow(r: ContentCardVersionRow, presentation?: CardPresentation | null): CardDef {
  return withPrinted({
    id: r.card_id,
    playerId: r.player_id,
    variantId: r.variant_id,
    stats: r.stats,
    ovr: r.ovr,
    combat: r.combat,
    statBoost: r.stat_boost,
    dataVersion: r.data_version,
    source: r.source,
    generatedAt: new Date(r.generated_at).toISOString(),
  }, presentation);
}

/**
 * Lo IMPRESO de una carta del catálogo diseñado no tiene columna en `content_cards` (el esquema
 * es de 0037 y no se migra por esto): vive en el manifiesto de código, igual que en el cliente.
 * Se añade por `card_id` a lo que viene de la fila, así cliente y servidor ven la misma carta.
 */
const PRINTED = new Map(CARD_MANIFEST.map((e) => [e.id, e]));

export function withPrinted(def: CardDef, presentation?: CardPresentation | null): CardDef {
  const e = PRINTED.get(def.id);
  if (!e) {
    // F60 · carta del panel: lo impreso sale de su presentación (inmutable tras publicar). El equipo IMPRESO manda y no
    // cambia aunque el jugador cambie de equipo; la imagen es su asset de Storage (LA CARTA ES EL ASSET).
    if (!presentation) return def;
    const p = presentation;
    return { ...def, printed: { ovr: p.printed.ovr, role: p.role, stats: { ...p.printed.stats } }, role: p.role,
      team: p.team, ...(storagePublicUrl(p.imagePath) ? { image: storagePublicUrl(p.imagePath)! } : {}) };
  }
  const role = e.role as RoleId;
  return { ...def, printed: { ovr: e.ovr, role, stats: { ...e.stats } }, role, image: `/cards/${e.id}.webp`, team: printedTeamTag(e.source) };
}

export function fromCardRow(r: ContentCardRow): CardDef {
  return withPrinted({
    id: r.card_id,
    playerId: r.player_id,
    variantId: r.variant_id,
    stats: r.stats,
    ovr: r.ovr,
    combat: r.combat,
    statBoost: r.stat_boost,
    dataVersion: r.data_version,
    source: r.source,
    // Postgres devuelve `timestamptz` con desplazamiento ("+00:00"); el dominio lo guarda
    // en ISO Z. Se normaliza para que la ida y vuelta sea literalmente idéntica.
    generatedAt: new Date(r.generated_at).toISOString(),
  }, r.presentation);
}
