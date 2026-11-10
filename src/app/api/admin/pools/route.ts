/**
 * `/api/admin/pools` — el plano de control de la distribución (Bloque 8.3).
 *
 *   POST { action: "list",       filtros }                             → listado con salud
 *   POST { action: "sheet",      poolId, page, q }                     → ficha paginada
 *   POST { action: "simulate",   packId, aperturas, seed }             → simulación aislada
 *   POST { action: "cardOdds",   cardId, packId }                      → P de una carta
 *   POST { action: "inspect",    poolId }                              → pool + entradas + sobres
 *   POST { action: "upsert",     pool, reason, expectedRevision }      → alta/edición de pool
 *   POST { action: "setEntries", poolId, entries, reason, expectedRevision }   → todas de golpe
 *   POST { action: "entryUpsert", poolId, cardId, weight, mode, reason, expectedRevision }
 *   POST { action: "entryRemove", poolId, cardId, reason, expectedRevision }
 *   POST { action: "publish",    poolId, state, reason, expectedRevision }
 *
 * ────────────────────────── CONCURRENCIA (8.4.3) ──────────────────────────
 *
 * `setEntries` reemplaza el conjunto ENTERO de entradas. Es lo correcto —un pool a medias es
 * una distribución que nadie quiso publicar— pero significa que dos administradores a la vez
 * se pisan en silencio: A añade una carta, B guarda la lista que leyó antes, y la carta de A
 * desaparece sin que nada lo diga.
 *
 * `expectedRevision` es la revisión que el panel tenía delante. La comprueba la RPC **bajo su
 * propio `for update`**, no esta ruta: comprobarlo aquí protege del caso lento pero no del
 * simultáneo, porque dos lecturas concurrentes pasan las dos. Es la misma lección que
 * 8.4.1 §7 dejó escrita para las cartas.
 *   POST { action: "bind",       packId, poolId, priority? }           → vincular sobre ↔ pool
 *   POST { action: "unbind",     packId, poolId }
 *   POST { action: "odds",       packId }                              → probabilidad efectiva
 *
 * ────────────────────────── QUÉ ES Y QUÉ NO ES ──────────────────────────
 *
 * **No es** el panel de pools. No hay pantalla, ni listado, ni edición visual: eso es 8.4.
 * Es la superficie de servicios mínima para que la infraestructura se pueda configurar,
 * verificar y probar de extremo a extremo — sin ella, «los pools son administrables» sería
 * una afirmación sobre tablas que nadie ha escrito nunca desde fuera.
 *
 * ────────────────────────── LA PROBABILIDAD SE CALCULA AQUÍ ──────────────────────────
 *
 * `odds` devuelve la probabilidad efectiva por carta y por bucket, calculada en el
 * SERVIDOR con el mismo pool y los mismos pesos que usa el sorteo. La regla del proyecto
 * desde los bloques PvP es que la interfaz muestra y no calcula; si el panel de 8.4
 * recalculara la probabilidad por su cuenta, acabaría enseñando una distribución que no es
 * la que reparte.
 *
 * ────────────────────────── SEGURIDAD ──────────────────────────
 *
 * Las mismas tres puertas que `/api/admin/cards`: el middleware corta sin `Bearer`,
 * `verifyAdmin` resuelve el token contra GoTrue y `profiles.is_admin`, y las RPC están
 * revocadas a `anon`/`authenticated`. **El actor sale del token**, nunca del cuerpo.
 */
import { NextResponse } from "next/server";
import { verifyAdmin } from "@/lib/supabase/adminAuth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getPack } from "@/data/packs";
import { pageAll } from "@/server/db/pageAll";
import { serverCatalog } from "@/server/catalog";
import { serverDistribution } from "@/server/catalog/distribution";
import { buildPool, BUCKETS } from "@/domain/packs/pool";
import { effectiveProbabilities } from "@/domain/packs/weighted";
import type { RarityBucket } from "@/domain/packs/types";

import {
  listPools, poolSheet, simulate, cardOdds, SIM_MAX,
} from "@/server/services/adminPools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, private" };
const STATES = new Set(["DRAFT", "ACTIVE", "RETIRED"]);

export async function POST(req: Request): Promise<NextResponse> {
  const admin = await verifyAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "Acceso restringido" }, { status: 401, headers: NO_STORE });
  }
  const sb = getSupabaseAdmin();
  if (!sb) {
    return NextResponse.json({ error: "Supabase admin no configurado" }, { status: 503, headers: NO_STORE });
  }

  let body: Record<string, unknown> = {};
  try { body = (await req.json()) as Record<string, unknown>; } catch { /* vacío */ }
  const action = typeof body.action === "string" ? body.action : "";
  const poolId = typeof body.poolId === "string" ? body.poolId : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  const num = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? v : undefined;
  const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

  // ── Listado ──
  if (action === "list") {
    const r = await listPools(sb, {
      q: str(body.q), lifecycle: str(body.lifecycle), packId: str(body.packId),
      mode: str(body.mode), seasonId: str(body.seasonId), eventId: str(body.eventId),
      soloActivos: body.soloActivos === true,
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status, headers: NO_STORE });
    return NextResponse.json(r.data, { headers: NO_STORE });
  }

  // ── Ficha ──
  if (action === "sheet") {
    if (!poolId) return bad("poolId requerido");
    const r = await poolSheet(sb, poolId, {
      page: num(body.page), pageSize: num(body.pageSize),
      q: str(body.q), soloProblemas: body.soloProblemas === true,
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status, headers: NO_STORE });
    return NextResponse.json(r.data, { headers: NO_STORE });
  }

  // ── Simulación aislada: decide, NO acuña ──
  if (action === "simulate") {
    const packId = str(body.packId) ?? "";
    const aperturas = num(body.aperturas) ?? 1000;
    if (aperturas > SIM_MAX) return bad(`Como mucho ${SIM_MAX} aperturas por simulación`);
    const r = await simulate(sb, packId, aperturas, str(body.seed) || "nexus");
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status, headers: NO_STORE });
    return NextResponse.json(r.data, { headers: NO_STORE });
  }

  // ── Probabilidad de UNA carta en UN sobre ──
  if (action === "cardOdds") {
    const cardId = str(body.cardId) ?? "";
    const packId = str(body.packId) ?? "";
    if (!cardId || !packId) return bad("cardId y packId requeridos");
    const r = await cardOdds(sb, cardId, packId);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status, headers: NO_STORE });
    return NextResponse.json(r.data, { headers: NO_STORE });
  }

  // ── Consultar ──
  if (action === "inspect") {
    if (!poolId) return bad("poolId requerido");
    const [pool, entries, packs] = await Promise.all([
      sb.from("content_pools").select("*").eq("id", poolId).maybeSingle(),
      // Paginado: `inspect` promete la configuración ENTERA, y PostgREST corta en 1.000 sin
      // decirlo. Media configuración devuelta como si fuera toda es peor que un error.
      pageAll<Record<string, unknown>>((desde, hasta) => sb.from("content_pool_entries")
        .select("*").eq("pool_id", poolId).order("card_id").range(desde, hasta)),
      sb.from("content_pack_pools").select("*").eq("pool_id", poolId),
    ]);
    if (!pool.data) return NextResponse.json({ error: "Pool no encontrado" }, { status: 404, headers: NO_STORE });
    return NextResponse.json(
      { pool: pool.data, entries: entries ?? [], packs: packs.data ?? [] }, { headers: NO_STORE });
  }

  // ── Probabilidad efectiva de un sobre ──
  if (action === "odds") {
    const packId = typeof body.packId === "string" ? body.packId : "";
    const pack = getPack(packId);
    if (!pack) return NextResponse.json({ error: "Sobre no encontrado" }, { status: 404, headers: NO_STORE });

    const cat = await serverCatalog(sb);
    const dist = await serverDistribution(sb);
    const d = dist.forPack(packId);
    const { pool } = buildPool(cat.packEngine.registry, pack, d);

    /*
     * La probabilidad se explica en las DOS capas que el motor tiene de verdad, y no se
     * inventa una tercera: P(carta) = P(bucket) × P(carta | bucket).
     *
     * `P(bucket)` se renormaliza sobre los buckets CON STOCK, que es exactamente lo que
     * hace `rollBucket`. Un sobre que anuncia un 6 % de épicas sin épicas en el pool —el
     * caso real del sobre China documentado en `content-verify`— se ve aquí como un 0 %.
     */
    const conStock = BUCKETS.filter((b) => pool[b].length > 0);
    const totalPeso = conStock.reduce((s, b) => s + (pack.weights[b] || 0), 0);
    const porBucket: Record<string, unknown> = {};
    for (const b of BUCKETS) {
      const pBucket = totalPeso > 0 && pool[b].length > 0 ? (pack.weights[b] || 0) / totalPeso : 0;
      const cards = effectiveProbabilities(pool[b], (c) => (d ? d.weightOf(c.id) : 1));
      porBucket[b] = {
        pBucket,
        declarado: pack.weights[b] || 0,
        stock: pool[b].length,
        top: cards.slice().sort((a, z) => z.p - a.p).slice(0, 5)
          .map((x) => ({ cardId: x.item.id, weight: x.weight, pEnBucket: x.p, pTotal: x.p * pBucket })),
      };
    }
    return NextResponse.json({
      packId, poolSize: BUCKETS.reduce((s, b) => s + pool[b].length, 0),
      configurado: d !== null, uniforme: d?.uniform ?? true,
      distributionVersion: dist.version, buckets: porBucket,
    }, { headers: NO_STORE });
  }

  // ── Mutaciones ──
  if (action === "upsert") {
    if (!reason) return bad("Todo cambio de distribución necesita motivo");
    const pool = (body.pool ?? {}) as Record<string, unknown>;
    if (typeof pool.id !== "string" || !pool.id) return bad("pool.id requerido");
    const { data, error } = await sb.rpc("app_content_pool_upsert", {
      p_pool: pool, p_reason: reason, p_actor: admin.userId,
      p_expected_revision: num(body.expectedRevision) ?? null,
    });
    return error ? conflict(error.message) : NextResponse.json(data, { headers: NO_STORE });
  }

  if (action === "setEntries") {
    if (!poolId) return bad("poolId requerido");
    if (!reason) return bad("Todo cambio de distribución necesita motivo");
    if (!Array.isArray(body.entries)) return bad("entries debe ser una lista");

    /*
     * Validación en la puerta, ANTES de la base de datos. La RPC y el `CHECK` de la tabla
     * lo comprueban igualmente —son la autoridad—, pero rechazarlo aquí da un mensaje que
     * dice qué entrada está mal en vez de un error de restricción.
     */
    const entries: { card_id: string; weight: number; mode: string; note?: string }[] = [];
    for (const raw of body.entries as unknown[]) {
      const e = (raw ?? {}) as Record<string, unknown>;
      const cardId = typeof e.cardId === "string" ? e.cardId : typeof e.card_id === "string" ? e.card_id : "";
      const weight = e.weight === undefined ? 1 : Number(e.weight);
      const mode = e.mode === "EXCLUDE" ? "EXCLUDE" : "INCLUDE";
      if (!cardId) return bad("Cada entrada necesita cardId");
      if (!Number.isFinite(weight) || weight <= 0 || weight > 1_000_000) {
        return bad(`Peso no válido para ${cardId}: ${e.weight} (debe ser > 0 y <= 1000000)`);
      }
      entries.push({ card_id: cardId, weight, mode, note: typeof e.note === "string" ? e.note : undefined });
    }
    const dupes = entries.map((e) => e.card_id).filter((id, i, a) => a.indexOf(id) !== i);
    if (dupes.length) return bad(`Entradas duplicadas: ${[...new Set(dupes)].join(", ")}`);

    const { data, error } = await sb.rpc("app_content_pool_set_entries", {
      p_pool_id: poolId, p_entries: entries, p_reason: reason, p_actor: admin.userId,
      p_expected_revision: num(body.expectedRevision) ?? null,
    });
    return error ? conflict(error.message) : NextResponse.json(data, { headers: NO_STORE });
  }

  /*
   * UNA entrada, atómicamente.
   *
   * `setEntries` reemplaza el conjunto entero, y la ficha del panel PAGINA: enviar «todas las
   * entradas» desde una pantalla que tiene 25 de 772 cargadas borraría las otras 747. Estas
   * dos acciones existen para que ese error no se pueda cometer, no por comodidad.
   */
  if (action === "entryUpsert") {
    if (!poolId) return bad("poolId requerido");
    if (!reason) return bad("Todo cambio de distribución necesita motivo");
    const cardId = str(body.cardId) ?? "";
    if (!cardId) return bad("cardId requerido");
    const weight = num(body.weight);
    if (weight === undefined || weight <= 0 || weight > 1_000_000) {
      return bad(`Peso no válido: ${String(body.weight)} (debe ser > 0 y <= 1000000)`);
    }
    const mode = body.mode === "EXCLUDE" ? "EXCLUDE" : "INCLUDE";
    const { data, error } = await sb.rpc("app_content_pool_entry_upsert", {
      p_pool_id: poolId, p_card_id: cardId, p_weight: weight, p_mode: mode,
      p_note: str(body.note) ?? null, p_reason: reason, p_actor: admin.userId,
      p_expected_revision: num(body.expectedRevision) ?? null,
    });
    return error ? conflict(error.message) : NextResponse.json(data, { headers: NO_STORE });
  }

  if (action === "entryRemove") {
    if (!poolId) return bad("poolId requerido");
    if (!reason) return bad("Todo cambio de distribución necesita motivo");
    const cardId = str(body.cardId) ?? "";
    if (!cardId) return bad("cardId requerido");
    const { data, error } = await sb.rpc("app_content_pool_entry_remove", {
      p_pool_id: poolId, p_card_id: cardId, p_reason: reason, p_actor: admin.userId,
      p_expected_revision: num(body.expectedRevision) ?? null,
    });
    return error ? conflict(error.message) : NextResponse.json(data, { headers: NO_STORE });
  }

  if (action === "publish") {
    if (!poolId) return bad("poolId requerido");
    const state = typeof body.state === "string" ? body.state : "";
    if (!STATES.has(state)) return bad("Estado no válido");
    const { data, error } = await sb.rpc("app_content_pool_publish", {
      p_pool_id: poolId, p_state: state, p_actor: admin.userId,
      p_reason: reason || null,
      p_expected_revision: num(body.expectedRevision) ?? null,
    });
    return error ? conflict(error.message) : NextResponse.json(data, { headers: NO_STORE });
  }

  if (action === "bind" || action === "unbind") {
    const packId = typeof body.packId === "string" ? body.packId : "";
    if (!packId || !poolId) return bad("packId y poolId requeridos");
    // El sobre sigue viviendo en código, así que su existencia se valida contra `PACKS` —
    // no hay clave ajena que pueda hacerlo por nosotros. Ver §3 de la migración 0039.
    if (!getPack(packId)) return bad(`Sobre inexistente: ${packId}`);
    const { data, error } = await sb.rpc("app_content_pack_bind", {
      p_pack_id: packId, p_pool_id: poolId,
      p_priority: typeof body.priority === "number" ? body.priority : 100,
      p_action: action, p_actor: admin.userId,
    });
    return error ? conflict(error.message) : NextResponse.json(data, { headers: NO_STORE });
  }

  return bad("Acción no válida");
}

const bad = (error: string): NextResponse =>
  NextResponse.json({ error }, { status: 400, headers: NO_STORE });
/**
 * 409, y con una marca cuando es un conflicto de revisión.
 *
 * La pantalla necesita distinguir «otro administrador se te ha adelantado» —que se resuelve
 * recargando— de «esta operación no es legal» —que no—. Comparar el texto del mensaje sería
 * frágil: se marca aquí, una vez.
 */
const conflict = (error: string): NextResponse => {
  const revision = /ha cambiado mientras lo editabas/.test(error);
  const actual = revision ? Number(error.match(/hay r(\d+)/)?.[1]) : undefined;
  return NextResponse.json(
    { error, ...(revision ? { conflict: true, current: actual } : {}) },
    { status: 409, headers: NO_STORE },
  );
};

/** Referencia de tipo para que el bucket no se pierda en un `string` suelto. */
export type _Bucket = RarityBucket;
