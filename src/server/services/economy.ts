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
import { getCard } from "@/data/catalog";
import { salvageValue, salvageableCount } from "@/domain/economy/salvage";

export type ServiceResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

const fail = (error: string, status = 400): { ok: false; error: string; status: number } =>
  ({ ok: false, error, status });

/** Un ejemplar del inventario, tal y como lo guarda `user_cards`. */
interface OwnedRow { uid: string; card_id: string; locked: boolean }

export interface SalvagePreview {
  /** Ejemplares que se pueden desguazar ahora mismo. */
  uids: string[];
  /** Lo que pagaría el servidor por ellos. */
  total: number;
  /** Desglose por carta, para que la pantalla pueda explicarlo. */
  lines: { cardId: string; copies: number; salvageable: number; each: number; subtotal: number }[];
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
    .from("user_cards").select("uid, card_id, locked").eq("user_id", userId);
  if (error) return fail(error.message, 500);

  const rows = (data ?? []) as OwnedRow[];
  const byCard = new Map<string, OwnedRow[]>();
  for (const r of rows) {
    if (r.locked) continue; // una carta en venta no se desguaza
    const list = byCard.get(r.card_id) ?? [];
    list.push(r);
    byCard.set(r.card_id, list);
  }

  const uids: string[] = [];
  const lines: SalvagePreview["lines"] = [];
  let total = 0;

  for (const [cardId, copies] of byCard) {
    const n = salvageableCount(copies.length);
    if (n <= 0) continue;
    const def = getCard(cardId);
    if (!def) continue; // una carta que el catálogo ya no conoce no se tasa
    const each = salvageValue(def);

    /*
     * Se conserva SIEMPRE un ejemplar, y se conserva el mejor: el de número de serie más
     * bajo. Desguazar el #3 y quedarse con el #180 sería destruir la copia valiosa por
     * orden de inserción. Sin serie, el orden da igual y se toma el primero.
     */
    const sorted = [...copies].sort((a, b) => a.uid.localeCompare(b.uid));
    const toScrap = sorted.slice(1, 1 + n);

    for (const c of toScrap) uids.push(c.uid);
    const subtotal = each * toScrap.length;
    total += subtotal;
    lines.push({ cardId, copies: copies.length, salvageable: toScrap.length, each, subtotal });
  }

  lines.sort((a, b) => b.subtotal - a.subtotal);
  return { ok: true, data: { uids, total, lines } };
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
  sb: SupabaseClient, userId: string, uids: string[], ref: string,
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

  const allowed = new Set(preview.data.uids);
  const chosen = [...new Set(uids)].filter((u) => allowed.has(u));
  if (chosen.length === 0) {
    return fail("Ninguna de esas cartas se puede desguazar", 409);
  }

  /*
   * El importe se recalcula AQUÍ, sobre los ejemplares que de verdad se van a borrar. No
   * se reutiliza el total de la vista previa: si el jugador desguazó algo entre una y
   * otra, ese total ya no describe esta operación.
   */
  const { data: rows } = await sb
    .from("user_cards").select("uid, card_id").eq("user_id", userId).in("uid", chosen);
  const total = ((rows ?? []) as { uid: string; card_id: string }[]).reduce((sum, r) => {
    const def = getCard(r.card_id);
    return sum + (def ? salvageValue(def) : 0);
  }, 0);

  const { data, error } = await sb.rpc("app_salvage_cards", {
    p_user: userId,
    p_uids: chosen,
    p_total: total,
    p_ref: ref,
  });
  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("no es tuya")) return fail("Alguna carta ya no está disponible", 409);
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
