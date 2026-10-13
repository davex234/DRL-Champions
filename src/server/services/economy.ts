/**
 * ECONOMÍA — OPERACIONES DEL JUGADOR (Fase 11, SOLO SERVIDOR).
 *
 * Hoy contiene una sola operación, el DESGUACE de duplicados, y existe como módulo aparte
 * porque va a contener más: es el sitio donde vive lo que mueve saldo y no es ni una
 * recompensa (`rewards.ts`) ni una compra de sobre (`packs.ts`).
 *
 * ────────────────────────── LA REGLA ──────────────────────────
 *
 * **El cliente nombra cartas; el servidor pone precio.** Nunca se acepta un importe del
 * navegador. Aquí se resuelve el `card_id` de cada ejemplar contra el catálogo, se calcula
 * el valor con la tabla del dominio (`domain/economy/salvage`) y ese total —ya cerrado— es
 * el que viaja a la base de datos.
 *
 * La base de datos comprueba lo que Node no puede garantizar por su cuenta: que los
 * ejemplares siguen siendo del jugador, que no están bloqueados por un listado del
 * mercado, que desaparecen y que el pago ocurre en la misma transacción.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverCatalog } from "@/server/catalog";
import { salvageValue, salvageableCount } from "@/domain/economy/salvage";
import { copyProtection, type Protection } from "@/domain/cards/protection";
import { GUARD_RPC_ERRORS, isMissingRpc, loadProtection } from "./cardProtection";

export type ServiceResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number; code?: string };

const fail = (error: string, status = 400, code?: string): { ok: false; error: string; status: number; code?: string } =>
  ({ ok: false, error, status, ...(code ? { code } : {}) });

/** Un ejemplar del inventario, tal y como lo guarda `user_cards`. */
interface OwnedRow { uid: string; card_id: string; locked: boolean; minted_version: number | null }

export interface SalvagePreview {
  /** Ejemplares que se pueden desguazar ahora mismo. */
  uids: string[];
  /** Lo que pagaría el servidor por ellos. */
  total: number;
  /** Desglose por carta, para que la pantalla pueda explicarlo. */
  lines: { cardId: string; copies: number; salvageable: number; each: number; subtotal: number }[];
  /**
   * F79.1 · copias repetidas PROTEGIDAS (favorita o vitrina): NO están en `uids` ni en `total`. Solo se desguazan si el
   * jugador las CONFIRMA una a una (`confirmProtected`), como en NEXUS FORGE.
   */
  protectedCopies: { uid: string; cardId: string; protectedBy: Protection[]; each: number }[];
  /** F79.1 · copias repetidas que están en un equipo: nunca se desguazan (bloqueo absoluto). */
  inDeck: number;
}

/**
 * Qué duplicados tiene el jugador y cuánto valen.
 *
 * Es de SOLO LECTURA y es lo que la interfaz enseña antes de confirmar. El importe que se
 * pague después se vuelve a calcular en `salvageCards` con los mismos datos: enseñar y
 * cobrar no comparten resultado, comparten FUNCIÓN. Si compartieran resultado, un cliente
 * podría devolver el de una vista vieja.
 */
export async function previewSalvage(
  sb: SupabaseClient, userId: string,
): Promise<ServiceResult<SalvagePreview>> {
  const { data, error } = await sb
    .from("user_cards").select("uid, card_id, locked, minted_version").eq("user_id", userId);
  if (error) return fail(error.message, 500);

  const rows = (data ?? []) as OwnedRow[];
  // F79.1 · la regla canónica de carta protegida (`domain/cards/protection`): equipos = bloqueo absoluto; favorita y
  // vitrina = solo confirmándolo.
  const prot = await loadProtection(sb, userId);
  // BLOQUE 8.1 — la tasación consulta el catálogo PERSISTIDO. Es la misma carta y el mismo
  // OVR (el verificador lo demuestra), pero la pregunta «¿esta carta existe?» ya no la
  // responde el código que arrancó el proceso.
  const catalog = await serverCatalog(sb);
  const byCard = new Map<string, OwnedRow[]>();
  for (const r of rows) {
    if (r.locked) continue; // una carta en venta no se desguaza
    const list = byCard.get(r.card_id) ?? [];
    list.push(r);
    byCard.set(r.card_id, list);
  }

  const uids: string[] = [];
  const lines: SalvagePreview["lines"] = [];
  const protectedCopies: SalvagePreview["protectedCopies"] = [];
  let inDeck = 0;
  let total = 0;

  for (const [cardId, copies] of byCard) {
    const n = salvageableCount(copies.length);
    if (n <= 0) continue;
    /*
      * BLOQUE 8.2 — se tasa la carta QUE EL JUGADOR TIENE, no la que el catálogo diga hoy.
      *
      * Desde la F57.5 `salvageValue` es una fracción de `marketValue`, que depende de la
      * clase Y DEL OVR: una versión con otro OVR paga otro desguace. Por eso se resuelve por
      * versión acuñada (`rarity_rank` también está congelado en cada una), y no contra la
      * definición vigente. El pago de `salvageCards` usa la versión de CADA ejemplar.
      */
     const def = catalog.instance(cardId, copies[0].minted_version);
     if (!def) continue; // una carta que el catálogo ya no conoce no se tasa
    const each = salvageValue(def);

    /*
     * Se conserva SIEMPRE un ejemplar, y se conserva el mejor: el de número de serie más
     * bajo. Desguazar el #3 y quedarse con el #180 sería destruir la copia valiosa por
     * orden de inserción. Sin serie, el orden da igual y se toma el primero.
     */
    const sorted = [...copies].sort((a, b) => a.uid.localeCompare(b.uid));
    /*
     * F79.1 · las copias de un EQUIPO no se tocan (y ya cuentan como la que conservas). Si ninguna está en un equipo se
     * conserva una: la de la vitrina si la hay (para no tener que confirmarla), si no la de uid más bajo.
     */
    const deck = sorted.filter((c) => prot.inDeck.has(c.uid));
    const free = sorted.filter((c) => !prot.inDeck.has(c.uid));
    const keep = deck.length > 0 ? null : (free.find((c) => prot.showcaseUids.has(c.uid)) ?? free[0]);
    const candidates = free.filter((c) => c !== keep).slice(0, n);
    inDeck += Math.max(0, deck.length - (deck.length > 0 ? 1 : 0));
    const toScrap: OwnedRow[] = [];
    for (const c of candidates) {
      const by = copyProtection(c.uid, cardId, prot);
      if (by.length) protectedCopies.push({ uid: c.uid, cardId, protectedBy: by, each }); else toScrap.push(c);
    }
    if (toScrap.length === 0) continue;

    for (const c of toScrap) uids.push(c.uid);
    const subtotal = each * toScrap.length;
    total += subtotal;
    lines.push({ cardId, copies: copies.length, salvageable: toScrap.length, each, subtotal });
  }

  lines.sort((a, b) => b.subtotal - a.subtotal);
  return { ok: true, data: { uids, total, lines, protectedCopies, inDeck } };
}

/**
 * Desguaza ejemplares concretos.
 *
 * `uids` es lo ÚNICO que puede elegir el cliente, y aun así se valida contra su propio
 * inventario: se recalcula el conjunto desguazable y se acepta solo la intersección. Un
 * `uid` de otro jugador, uno bloqueado o el último ejemplar de una carta se descartan
 * antes de tocar la base de datos, y la RPC vuelve a comprobar la propiedad por su cuenta.
 *
 * `ref` es la clave de idempotencia. Sin ella no se desguaza nada: repetir la petición
 * devuelve el mismo resultado en vez de cobrar dos veces o borrar más cartas.
 */
export async function salvageCards(
  sb: SupabaseClient, userId: string, uids: string[], ref: string, confirmProtected: readonly string[] = [],
): Promise<ServiceResult<{ credits: number; salvaged: number; paid: number; repeated: boolean }>> {
  if (!ref) return fail("Falta la clave de la operación", 400);
  if (!Array.isArray(uids) || uids.length === 0) return fail("No has elegido ninguna carta", 400);
  if (uids.length > 500) return fail("Demasiadas cartas en una sola operación", 400);

  /*
   * IDEMPOTENCIA, ANTES DE VALIDAR NADA.
   *
   * La RPC ya reconoce una clave repetida, pero nunca llegaba a verla: este servicio
   * filtraba primero los `uid` contra los duplicados actuales y, tras un desguace, esas
   * cartas ya no existen — así que un reintento moría con «ninguna de esas cartas se puede
   * desguazar» en vez de devolver lo que se pagó la primera vez.
   *
   * Un reintento tiene que responder lo MISMO, no un error. Por eso la clave se consulta
   * aquí arriba, antes de mirar el inventario.
   */
  const { data: prior } = await sb
    .from("economy_ops").select("result").eq("ref", ref).maybeSingle();
  if (prior) {
    const r = (prior as { result: { credits?: number; salvaged?: number; paid?: number } }).result ?? {};
    return {
      ok: true,
      data: {
        credits: r.credits ?? 0, salvaged: r.salvaged ?? 0, paid: r.paid ?? 0, repeated: true,
      },
    };
  }

  const preview = await previewSalvage(sb, userId);
  if (!preview.ok) return preview;

  // F79.1 · una copia protegida elegida SIN confirmar rechaza la operación entera: nunca se descarta en silencio ni se
  // desguaza en silencio. Las demás no desguazables (última copia, en venta, en un equipo, ajenas) se descartan como antes.
  const confirmed = new Set(confirmProtected);
  const protectedUids = new Set(preview.data.protectedCopies.map((c) => c.uid));
  const unconfirmed = [...new Set(uids)].filter((u) => protectedUids.has(u) && !confirmed.has(u));
  if (unconfirmed.length > 0) {
    return fail("Has elegido cartas protegidas (favoritas o de tu vitrina): confírmalas antes de desguazarlas", 409, "PROTECTED_COPY");
  }
  const allowed = new Set([...preview.data.uids, ...protectedUids]);
  const chosen = [...new Set(uids)].filter((u) => allowed.has(u));
  if (chosen.length === 0) {
    return fail("Ninguna de esas cartas se puede desguazar", 409);
  }
  const confirm = chosen.filter((u) => protectedUids.has(u));

  /*
   * El importe se recalcula AQUÍ, sobre los ejemplares que de verdad se van a borrar. No
   * se reutiliza el total de la vista previa: si el jugador desguazó algo entre una y
   * otra, ese total ya no describe esta operación.
   */
  const { data: rows } = await sb
    .from("user_cards").select("uid, card_id, minted_version").eq("user_id", userId).in("uid", chosen);
  const catalog = await serverCatalog(sb);
  const total = ((rows ?? []) as { uid: string; card_id: string; minted_version: number | null }[])
    .reduce((sum, r) => {
      // Mismo criterio que la vista previa: la versión acuñada, no la vigente.
      const def = catalog.instance(r.card_id, r.minted_version);
      return sum + (def ? salvageValue(def) : 0);
    }, 0);

  // 0061 · RPC GUARDADA: equipos, favoritas/vitrina sin confirmar y última copia, dentro de la transacción.
  const { data, error } = await sb.rpc("app_salvage_cards_guarded", {
    p_user: userId,
    p_uids: chosen,
    p_total: total,
    p_ref: ref,
    p_confirm: confirm,
  });
  if (error) {
    const msg = error.message ?? "";
    if (isMissingRpc(error)) return fail("El desguace necesita la migración 0061", 503, "MIGRATION_PENDING");
    const guard = Object.keys(GUARD_RPC_ERRORS).find((k) => msg.includes(k));
    if (guard) return fail(GUARD_RPC_ERRORS[guard].error, GUARD_RPC_ERRORS[guard].status, guard);
    if (msg.includes("no es tuya")) return fail("Alguna carta ya no está disponible", 409);
    // 0060 · la BD impide quedarse sin ninguna copia (carrera con otro desguace o con un intercambio de F73).
    if (msg.includes("LAST_COPY")) return fail("Te quedarías sin ninguna copia de esa carta", 409);
    return fail(msg || "No se pudo desguazar", 500);
  }

  const res = (data ?? {}) as { credits: number; salvaged: number; paid: number; repeated?: boolean };
  return {
    ok: true,
    data: {
      credits: res.credits ?? 0,
      salvaged: res.salvaged ?? 0,
      paid: res.paid ?? 0,
      repeated: res.repeated === true,
    },
  };
}
