/**
 * SERVICIO DE ADMINISTRACIÓN DE CARTAS (SOLO SERVIDOR) — Bloque 8.4.1.
 *
 * La lógica que el panel necesita, fuera de la ruta. La ruta valida la forma de la petición
 * y comprueba quién llama; aquí se orquesta contra la infraestructura de 8.1-8.3.
 *
 * ────────────────────────── NO SE DERIVA NINGUNA ESTADÍSTICA NUEVA ──────────────────────────
 *
 * Crear una carta es elegir **un jugador y una variante**. El OVR, el trío de combate, las
 * seis estadísticas heredadas y la rareza salen de `playerCombatBase()` + `deriveCard()` —
 * las MISMAS funciones que usa el generador del catálogo desde el bloque 1. El
 * administrador no teclea un OVR.
 *
 * Es una decisión, y conviene dejarla escrita: un panel que permitiera escribir «OVR 95» a
 * mano convertiría el catálogo en opinión. La trazabilidad a métricas reales costó varios
 * bloques y no se rompe desde una interfaz.
 *
 * ────────────────────────── LA VÍA EDITORIAL, Y SUS CONDICIONES ──────────────────────────
 *
 * El dominio YA tiene una excepción para jugadores sin métricas derivables (`Player.editorial`,
 * con `reason` y `author` obligatorios). El panel la expone tal cual:
 *
 *   · Si el jugador tiene métricas → se deriva. No se admite trío manual.
 *   · Si NO las tiene → se puede aportar un trío editorial CON motivo, y la carta queda
 *     marcada `source: "editorial"`.
 *
 * Es decir: el trío manual no es un atajo, es la única vía para un jugador que el generador
 * rechaza — y queda etiquetada como tal en la fila y en el histórico.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { playerCombatBase, CATALOG_GENERATED_AT } from "@/data/catalog";
import { getVariant, VARIANTS } from "@/domain/cards/variants";
import { deriveCard, DATA_VERSION, type CombatStats } from "@/domain/cards/combat";
import { applyStatBoost } from "@/domain/cards/ovr";
import { bucketForRank } from "@/domain/packs/types";
import { marketValue, instanceValue } from "@/domain/economy/pricing";
import { salvageValue } from "@/domain/economy/salvage";
import { cardChecksum, fromPlayerRow, type ContentPlayerRow } from "@/server/catalog/rows";
import { pageAll } from "@/server/db/pageAll";
import { serverCatalog } from "@/server/catalog";
import { deriveDefinition, validateCombat, unboost } from "./cardDerivation";
import { serverDistribution } from "@/server/catalog/distribution";
import { effectiveProbabilities } from "@/domain/packs/weighted";
import { buildPool } from "@/domain/packs/pool";
import { PACKS, getPack } from "@/data/packs";
import type { CardDef, Player, VariantId } from "@/domain/cards/types";

export type Result<T> = { ok: true; data: T } | { ok: false; error: string; status: number };
const fail = (error: string, status = 400): { ok: false; error: string; status: number } =>
  ({ ok: false, error, status });

// ───────────────────────────── LISTADO ─────────────────────────────

export interface CardListFilters {
  q?: string;
  lifecycle?: string;
  variant?: string;
  bucket?: string;
  origin?: string;
  poolId?: string;
  sort?: "player" | "ovr" | "rarity" | "updated" | "lifecycle";
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export interface CardListRow {
  cardId: string; playerId: string; nick: string; team: string;
  variantId: string; variantLabel: string;
  rarityRank: number; rarityBucket: string; ovr: number;
  lifecycle: string; definitionVersion: number; origin: string;
  pools: number; createdAt: string; publishedAt: string | null; updatedAt: string | null;
}

/**
 * Listado paginado y filtrado **en la base de datos**.
 *
 * Las 773 cartas caben en memoria, pero traerlas todas para enseñar 25 sería exactamente lo
 * que el encargo pide evitar. Y el recuento de pools se resuelve con UNA consulta agregada
 * sobre las cartas de la página, no con una por fila: un N+1 de 25 consultas por pintar una
 * tabla es la forma más fácil de convertir un panel en algo lento.
 *
 * El filtro por texto busca en `card_id` y en el nick del jugador, así que se resuelve con
 * un `join` contra `content_players` en la misma consulta.
 */
export async function listCards(
  sb: SupabaseClient, f: CardListFilters,
): Promise<Result<{ rows: CardListRow[]; total: number; page: number; pageSize: number }>> {
  const page = Math.max(1, f.page ?? 1);
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 1), 100);

  let q = sb.from("content_cards").select(
    "card_id, player_id, variant_id, ovr, rarity_rank, rarity_bucket, lifecycle, " +
    "definition_version, origin, created_at, published_at, updated_at, " +
    "content_players!inner(nick, team)",
    { count: "exact" },
  );

  if (f.lifecycle) q = q.eq("lifecycle", f.lifecycle);
  if (f.variant) q = q.eq("variant_id", f.variant);
  if (f.bucket) q = q.eq("rarity_bucket", f.bucket);
  if (f.origin) q = q.eq("origin", f.origin);
  if (f.q) {
    const t = f.q.trim().replace(/[%,()]/g, "");
    if (t) q = q.or(`card_id.ilike.%${t}%,player_id.ilike.%${t}%`);
  }
  /*
   * El filtro por pool se resuelve ANTES, con una consulta a `content_pool_entries`, y se
   * aplica como `in(...)`. Es una consulta más, pero evita un `join` que PostgREST tendría
   * que anidar y que haría la paginación imprecisa.
   */
  if (f.poolId) {
    // Paginado: un pool puede tener más entradas que el `max_rows` de PostgREST, y quedarse
    // con las primeras 1.000 escondería cartas del pool en vez de fallar. Ver `pageAll`.
    const ids = await pageAll<{ card_id: string }>((desde, hasta) => sb.from("content_pool_entries")
      .select("card_id").eq("pool_id", f.poolId!).eq("mode", "INCLUDE")
      .order("card_id").range(desde, hasta));
    const list = (ids ?? []).map((r) => r.card_id);
    if (list.length === 0) {
      return { ok: true, data: { rows: [], total: 0, page, pageSize } };
    }
    q = q.in("card_id", list);
  }

  const dir = f.dir === "desc";
  const col = f.sort === "ovr" ? "ovr"
    : f.sort === "rarity" ? "rarity_rank"
    : f.sort === "updated" ? "updated_at"
    : f.sort === "lifecycle" ? "lifecycle"
    : "player_id";
  q = q.order(col, { ascending: !dir }).order("card_id", { ascending: true });

  const from = (page - 1) * pageSize;
  const { data, error, count } = await q.range(from, from + pageSize - 1);
  if (error) return fail(error.message, 500);

  const rows = (data ?? []) as unknown as (Omit<CardListRow, "nick" | "team" | "variantLabel" | "pools"> & {
    card_id: string; player_id: string; variant_id: string; rarity_rank: number;
    rarity_bucket: string; definition_version: number; created_at: string;
    published_at: string | null; updated_at: string | null;
    content_players: { nick: string; team: string } | { nick: string; team: string }[];
  })[];

  // UNA consulta para los pools de TODA la página. No una por fila.
  const ids = rows.map((r) => r.card_id);
  const poolCount = new Map<string, number>();
  if (ids.length > 0) {
    const { data: pe } = await sb.from("content_pool_entries")
      .select("card_id").in("card_id", ids).eq("mode", "INCLUDE");
    for (const r of ((pe ?? []) as { card_id: string }[])) {
      poolCount.set(r.card_id, (poolCount.get(r.card_id) ?? 0) + 1);
    }
  }

  return {
    ok: true,
    data: {
      rows: rows.map((r) => {
        const p = Array.isArray(r.content_players) ? r.content_players[0] : r.content_players;
        const variant = safeVariant(r.variant_id);
        return {
          cardId: r.card_id, playerId: r.player_id, nick: p?.nick ?? r.player_id, team: p?.team ?? "",
          variantId: r.variant_id, variantLabel: variant?.label ?? r.variant_id,
          rarityRank: r.rarity_rank, rarityBucket: r.rarity_bucket, ovr: r.ovr,
          lifecycle: r.lifecycle, definitionVersion: r.definition_version, origin: r.origin,
          pools: poolCount.get(r.card_id) ?? 0,
          createdAt: r.created_at, publishedAt: r.published_at, updatedAt: r.updated_at,
        };
      }),
      total: count ?? 0, page, pageSize,
    },
  };
}

/** Facetas para los desplegables. Se calculan de una vez, no por cada tecla. */
export async function listFacets(sb: SupabaseClient): Promise<Result<{
  lifecycles: string[]; variants: { id: string; label: string; rank: number }[];
  buckets: string[]; origins: string[]; pools: { id: string; name: string; lifecycle: string }[];
}>> {
  const [pools] = await Promise.all([
    sb.from("content_pools").select("id, name, lifecycle").order("id"),
  ]);
  return {
    ok: true,
    data: {
      lifecycles: ["DRAFT", "REVIEW", "APPROVED", "PUBLISHED", "RETIRED", "ARCHIVED", "REJECTED"],
      // Las variantes son regla de juego y viven en código: se leen de ahí, no de la BD.
      variants: Object.values(VARIANTS).map((v) => ({ id: v.id, label: v.label, rank: v.rank }))
        .sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label)),
      buckets: ["common", "uncommon", "rare", "epic", "legendary"],
      origins: ["seed-generator", "admin", "tournament", "legacy"],
      pools: (pools.data ?? []) as { id: string; name: string; lifecycle: string }[],
    },
  };
}

// ───────────────────────────── FICHA ─────────────────────────────

export interface CardSheet {
  definition: Record<string, unknown>;
  player: Player | null;
  variant: { id: string; label: string; group: string; rank: number; bucket: string; serialized: boolean; serialLimit?: number; animation: string };
  versions: Record<string, unknown>[];
  instances: { total: number; owners: number; byVersion: Record<string, number>; withSerial: number };
  economy: { marketValue: number; salvageValue: number; instanceValueFirst: number | null; anchorByVersion: { version: number; fairValue: number }[] };
  distribution: { poolId: string; poolName: string; lifecycle: string; weight: number; mode: string; packs: string[]; pEnBucket: number | null }[];
  audit: Record<string, unknown>[];
  /** Lo que hay que devolver al editar para detectar que otro se ha adelantado. */
  concurrency: { definitionVersion: number; updatedAt: string | null };
}

/**
 * Toda la ficha en una pasada. Ocho consultas fijas, no una por sección ni una por fila:
 * lo que hace lenta una ficha administrativa no es el volumen, es el número de viajes.
 */
export async function cardSheet(sb: SupabaseClient, cardId: string): Promise<Result<CardSheet>> {
  const [defR, verR, instR, playerR, poolR, packPoolR, anchorR, auditR] = await Promise.all([
    sb.from("content_cards").select("*").eq("card_id", cardId).maybeSingle(),
    sb.from("content_card_versions").select("*").eq("card_id", cardId).order("version"),
    sb.from("user_cards").select("user_id, serial, minted_version").eq("card_id", cardId),
    sb.from("content_cards").select("player_id").eq("card_id", cardId).maybeSingle(),
    sb.from("content_pool_entries").select("pool_id, weight, mode").eq("card_id", cardId),
    sb.from("content_pack_pools").select("pack_id, pool_id").eq("enabled", true),
    sb.from("content_card_market_anchor").select("version, fair_value").eq("card_id", cardId).order("version"),
    sb.from("content_audit_log").select("at, actor, action, detail").eq("card_id", cardId).order("at", { ascending: false }).limit(50),
  ]);
  void playerR;
  if (!defR.data) return fail("Carta no encontrada", 404);
  const def = defR.data as Record<string, unknown>;

  const { data: pRow } = await sb.from("content_players").select("*")
    .eq("id", def.player_id as string).maybeSingle();
  const player = pRow ? fromPlayerRow(pRow as unknown as ContentPlayerRow) : null;

  const variant = safeVariant(def.variant_id as string);
  const cardDef = toCardDef(def);

  // Propiedad AGREGADA. Nunca se devuelve quién posee qué: para administrar contenido hace
  // falta saber a cuánta gente afecta un cambio, no quiénes son.
  const inst = (instR.data ?? []) as { user_id: string; serial: number | null; minted_version: number | null }[];
  const byVersion: Record<string, number> = {};
  for (const i of inst) {
    const k = i.minted_version === null ? "sin-version" : String(i.minted_version);
    byVersion[k] = (byVersion[k] ?? 0) + 1;
  }

  // Distribución: pools, pesos y probabilidad efectiva DENTRO de su bucket.
  const dist = await serverDistribution(sb);
  const cat = await serverCatalog(sb);
  const poolsById = new Map(((await sb.from("content_pools").select("id, name, lifecycle")).data ?? [])
    .map((p) => [(p as { id: string }).id, p as { id: string; name: string; lifecycle: string }]));
  const packsByPool = new Map<string, string[]>();
  for (const pp of ((packPoolR.data ?? []) as { pack_id: string; pool_id: string }[])) {
    packsByPool.set(pp.pool_id, [...(packsByPool.get(pp.pool_id) ?? []), pp.pack_id]);
  }

  const distribution: CardSheet["distribution"] = [];
  for (const e of ((poolR.data ?? []) as { pool_id: string; weight: string | number; mode: string }[])) {
    const pool = poolsById.get(e.pool_id);
    const packs = packsByPool.get(e.pool_id) ?? [];
    let pEnBucket: number | null = null;
    // La probabilidad se calcula con el MISMO pool que usa el sorteo, en el servidor.
    const pack = packs.map(getPack).find(Boolean);
    if (pack && e.mode === "INCLUDE") {
      const built = buildPool(cat.packEngine.registry, pack, dist.forPack(pack.id));
      const bucket = built.pool[bucketForRank(variant?.rank ?? 1)];
      const found = effectiveProbabilities(bucket, (c) => dist.forPack(pack.id)?.weightOf(c.id) ?? 1)
        .find((x) => x.item.id === cardId);
      pEnBucket = found?.p ?? null;
    }
    distribution.push({
      poolId: e.pool_id, poolName: pool?.name ?? e.pool_id, lifecycle: pool?.lifecycle ?? "?",
      weight: Number(e.weight), mode: e.mode, packs, pEnBucket,
    });
  }

  return {
    ok: true,
    data: {
      definition: def,
      player,
      variant: variant
        ? { id: variant.id, label: variant.label, group: variant.group, rank: variant.rank,
            bucket: bucketForRank(variant.rank), serialized: variant.serialized,
            serialLimit: variant.serialLimit, animation: variant.animation }
        : { id: String(def.variant_id), label: String(def.variant_id), group: "?", rank: 1, bucket: "common", serialized: false, animation: "basic" },
      versions: (verR.data ?? []) as Record<string, unknown>[],
      instances: {
        total: inst.length,
        owners: new Set(inst.map((i) => i.user_id)).size,
        byVersion,
        withSerial: inst.filter((i) => i.serial !== null).length,
      },
      economy: {
        marketValue: cardDef ? marketValue(cardDef) : 0,
        salvageValue: cardDef ? salvageValue(cardDef) : 0,
        instanceValueFirst: cardDef && variant?.serialized ? instanceValue(cardDef, 1) : null,
        anchorByVersion: ((anchorR.data ?? []) as { version: number; fair_value: number }[])
          .map((a) => ({ version: a.version, fairValue: Number(a.fair_value) })),
      },
      distribution,
      audit: (auditR.data ?? []) as Record<string, unknown>[],
      concurrency: {
        definitionVersion: def.definition_version as number,
        updatedAt: (def.updated_at as string) ?? null,
      },
    },
  };
}

// ───────────────────────────── EDITOR ─────────────────────────────

export interface CardEditorData {
  cardId: string;
  lifecycle: string;
  origin: string;
  definitionVersion: number;
  updatedAt: string | null;
  player: Player;
  variant: { id: string; label: string; group: string; rank: number; bucket: string; statBoost: number; serialized: boolean; serialLimit: number | null };
  /** Trío BASE, el único campo que se edita. Sin el bonus de la variante. */
  baseCombat: CombatStats;
  /** Trío tal como está guardado, con el bonus aplicado. Solo para enseñarlo. */
  storedCombat: CombatStats;
  /** El trío guardado se reconstruye exactamente desde la base. Ver `unboost`. */
  baseExact: boolean;
  /** Lo que el generador derivaría hoy para este jugador, si es derivable. */
  generator: { combat: CombatStats; source: string } | null;
  generatorReason: string | null;
  /** A cuánta gente afecta publicar: ejemplares por versión. Sin decir quiénes. */
  instances: { total: number; byVersion: Record<string, number> };
}

/**
 * Lo justo para editar una carta, y nada más.
 *
 * `cardSheet` hace nueve consultas porque enseña la ficha entera —historial, distribución,
 * economía, diario—. El editor no necesita nada de eso y sí necesita abrirse rápido: son
 * tres consultas.
 *
 * Devuelve además el trío que el GENERADOR derivaría hoy. Es lo que permite ofrecer
 * «restaurar el valor derivado» sin que el panel recalcule nada por su cuenta: el número sale
 * de `playerCombatBase()`, igual que en el alta.
 */
export async function cardEditor(sb: SupabaseClient, cardId: string): Promise<Result<CardEditorData>> {
  const { data: def } = await sb.from("content_cards").select("*").eq("card_id", cardId).maybeSingle();
  if (!def) return fail("Carta no encontrada", 404);
  const row = def as Record<string, unknown>;

  const [{ data: pRow }, { data: inst }] = await Promise.all([
    sb.from("content_players").select("*").eq("id", row.player_id as string).maybeSingle(),
    sb.from("user_cards").select("minted_version").eq("card_id", cardId),
  ]);
  if (!pRow) return fail(`El jugador ${String(row.player_id)} no está en el catálogo persistido`, 404);
  const player = fromPlayerRow(pRow as unknown as ContentPlayerRow);

  const variant = safeVariant(row.variant_id as string);
  if (!variant) return fail(`Variante desconocida: ${String(row.variant_id)}`, 500);

  const storedCombat = row.combat as CombatStats;
  const { base, exact } = unboost(storedCombat, Number(row.stat_boost));

  const gen = playerCombatBase(player);

  const byVersion: Record<string, number> = {};
  for (const i of ((inst ?? []) as { minted_version: number | null }[])) {
    const k = i.minted_version === null ? "sin-version" : String(i.minted_version);
    byVersion[k] = (byVersion[k] ?? 0) + 1;
  }

  return {
    ok: true,
    data: {
      cardId,
      lifecycle: String(row.lifecycle),
      origin: String(row.origin),
      definitionVersion: Number(row.definition_version),
      updatedAt: (row.updated_at as string) ?? null,
      player,
      variant: {
        id: variant.id, label: variant.label, group: variant.group, rank: variant.rank,
        bucket: bucketForRank(variant.rank), statBoost: variant.statBoost,
        serialized: variant.serialized, serialLimit: variant.serialLimit ?? null,
      },
      baseCombat: base,
      storedCombat,
      baseExact: exact,
      generator: gen.ok ? { combat: gen.combat, source: gen.source } : null,
      generatorReason: gen.ok ? null : gen.reason,
      instances: { total: (inst ?? []).length, byVersion },
    },
  };
}

// ───────────────────────────── ALTA ─────────────────────────────

export interface CreateCardInput {
  playerId: string;
  variantId: string;
  reason: string;
  /** Trío editorial. SOLO admisible si el jugador no tiene métricas derivables. */
  editorial?: { combat: CombatStats; reason: string };
}

/**
 * Deriva la carta con el dominio y la persiste como DRAFT.
 *
 * Todas las validaciones que importan ocurren aquí (servidor) y se repiten en la RPC: el
 * formulario puede mentir, y de hecho ni siquiera hace falta un formulario para llamar a la
 * API.
 */
export async function createCard(
  sb: SupabaseClient, input: CreateCardInput, actor: string,
): Promise<Result<{ cardId: string; lifecycle: string; version: number }>> {
  const reason = input.reason?.trim();
  if (!reason) return fail("Un alta necesita motivo");

  const variant = safeVariant(input.variantId);
  if (!variant) return fail(`Variante no válida: ${input.variantId}`);

  const { data: pRow } = await sb.from("content_players").select("*").eq("id", input.playerId).maybeSingle();
  if (!pRow) return fail(`Jugador inexistente: ${input.playerId}`, 404);
  const player = fromPlayerRow(pRow as unknown as ContentPlayerRow);

  const cardId = `${player.id}__${variant.id}`;
  const { count } = await sb.from("content_cards")
    .select("card_id", { count: "exact", head: true }).eq("card_id", cardId);
  if ((count ?? 0) > 0) return fail(`Esa carta ya existe: ${cardId}`, 409);

  /*
   * EL TRÍO. Primero se intenta derivar con el dominio; solo si el jugador NO es derivable
   * se admite la vía editorial, y con motivo. Nunca al revés: si se aceptara un trío manual
   * para un jugador con métricas, el panel podría contradecir en silencio los datos reales.
   */
  const base = playerCombatBase(player);
  let combat: CombatStats;
  let source: "vlr" | "editorial";
  if (base.ok) {
    if (input.editorial) {
      return fail(
        `${player.nick} tiene métricas reales: su carta se deriva y no admite un trío manual. ` +
        "La vía editorial existe solo para jugadores que el generador rechaza.",
      );
    }
    combat = base.combat;
    source = base.source;
  } else {
    if (!input.editorial?.reason?.trim()) {
      return fail(
        `${player.nick} no genera carta automáticamente (${base.reason}). ` +
        "Para crearla hace falta un trío editorial con su justificación.",
      );
    }
    const v = validateCombat(input.editorial.combat);
    if (!v.ok) return fail(`Trío editorial no válido: ${v.error}`);
    combat = v.combat;
    source = "editorial";
  }

  // Una sola derivacion para todo el panel: alta, edicion de borrador y publicacion.
  const { row } = deriveDefinition({
    player, variant, baseCombat: combat, source, generatedAt: CATALOG_GENERATED_AT,
  });

  const { data, error } = await sb.rpc("app_content_create_card", {
    p_def: row, p_reason: reason, p_actor: actor,
  });
  if (error) return fail(error.message, 409);
  return { ok: true, data: data as { cardId: string; lifecycle: string; version: number } };
}

/** Jugadores elegibles para un alta, con su estado de derivación. Para el formulario. */
export async function creatablePlayers(sb: SupabaseClient, q?: string): Promise<Result<{
  players: {
    id: string; nick: string; team: string; region: string; role: string; country: string;
    derivable: boolean; reason?: string; existing: string[];
    /*
     * El jugador COMPLETO y su trio base derivado.
     *
     * Van en la misma respuesta a proposito: la previsualizacion del alta necesita el jugador
     * entero —nick, equipo, pais, las seis estadisticas— y el trio para derivar el OVR. Pedirlo
     * en una segunda llamada al seleccionar significaria una espera visible cada vez que se
     * cambia de jugador, justo en la pantalla donde se compara uno con otro.
     *
     * `baseCombat` es null cuando el generador rechaza al jugador; entonces el formulario pide
     * el trio editorial y la previsualizacion se dibuja con lo que se teclee.
     */
    player: Player;
    baseCombat: CombatStats | null;
  }[];
}>> {
  let query = sb.from("content_players").select("*").order("nick").limit(60);
  if (q?.trim()) query = query.ilike("nick", `%${q.trim().replace(/[%,]/g, "")}%`);
  const { data, error } = await query;
  if (error) return fail(error.message, 500);

  const rows = (data ?? []) as unknown as ContentPlayerRow[];
  const ids = rows.map((r) => r.id);
  const { data: existing } = await sb.from("content_cards").select("card_id, player_id").in("player_id", ids);
  const porJugador = new Map<string, string[]>();
  for (const c of ((existing ?? []) as { card_id: string; player_id: string }[])) {
    porJugador.set(c.player_id, [...(porJugador.get(c.player_id) ?? []), c.card_id]);
  }

  return {
    ok: true,
    data: {
      players: rows.map((r) => {
        const p = fromPlayerRow(r);
        const base = playerCombatBase(p);
        return {
          id: p.id, nick: p.nick, team: p.team, region: p.region, role: p.role, country: p.country,
          derivable: base.ok, reason: base.ok ? undefined : base.reason,
          existing: porJugador.get(p.id) ?? [],
          player: p,
          baseCombat: base.ok ? base.combat : null,
        };
      }),
    },
  };
}

// ───────────────────────────── AYUDAS ─────────────────────────────

function safeVariant(id: unknown): ReturnType<typeof getVariant> | null {
  if (typeof id !== "string") return null;
  try { return getVariant(id as VariantId); } catch { return null; }
}

/** Fila → `CardDef`, para poder tasar con las funciones de economía sin duplicarlas. */
function toCardDef(def: Record<string, unknown>): CardDef | null {
  const variant = safeVariant(def.variant_id);
  if (!variant) return null;
  return {
    id: def.card_id as string, playerId: def.player_id as string,
    variantId: def.variant_id as VariantId,
    stats: def.stats as CardDef["stats"], ovr: def.ovr as number,
    combat: def.combat as CombatStats, statBoost: def.stat_boost as number,
    dataVersion: def.data_version as string, source: def.source as CardDef["source"],
    generatedAt: def.generated_at as string,
  };
}

/** Sobres cuyo pool contiene esta carta. Para la ficha; una sola pasada sobre los 12. */
export function packsContaining(cardId: string, cat: Awaited<ReturnType<typeof serverCatalog>>,
  dist: Awaited<ReturnType<typeof serverDistribution>>): string[] {
  return PACKS.filter((p) => buildPool(cat.packEngine.registry, p, dist.forPack(p.id))
    .flat.some((c) => c.id === cardId)).map((p) => p.id);
}
