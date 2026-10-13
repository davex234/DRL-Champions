/**
 * PRESTIGIO — SERVIDOR (Fase 14, SOLO SERVIDOR).
 *
 * El sumidero de fin de juego. Un jugador que ha completado un conjunto de maestría puede
 * MEJORAR su insignia pagando créditos: plata, oro, élite. Puramente visual.
 *
 * ────────────────────────── QUÉ NO SE HA CREADO ──────────────────────────
 *
 * Ninguna tabla. Ninguna moneda. Ningún catálogo escrito a mano. Los escalones se derivan
 * de las insignias que la maestría ya genera desde el catálogo, y lo comprado va a
 * `user_cosmetics`, que es donde ya vivían los cosméticos.
 *
 * ────────────────────────── EL PRECIO NO VIENE DEL CLIENTE ──────────────────────────
 *
 * Es la regla que la Fase 11 fijó para el desguace y que aquí importa el doble, porque esto
 * COBRA. El cuerpo de la petición lleva dos identificadores —qué conjunto y qué escalón— y
 * el precio lo pone `PRESTIGE_TIERS`. Si el cliente pudiera nombrar el precio, el precio lo
 * pondría el cliente.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PRESTIGE_TIERS, prestigeId, prestigeRef, prestigeTier, prestigeOffers,
  fullBadgeOf, highestTierOf, burnedOn, type PrestigeTier,
} from "@/domain/collection/prestige";
import { masterySets, masterySet } from "@/domain/collection/mastery";
import { cosmetic } from "@/domain/cosmetics/catalog";

export interface ServiceResult<T> {
  ok: boolean;
  status: number;
  error?: string;
  data?: T;
}

const ok = <T,>(data: T): ServiceResult<T> => ({ ok: true, status: 200, data });
const fail = (status: number, error: string): ServiceResult<never> => ({ ok: false, status, error });

/** Cosméticos que posee el jugador. Es lo único que el prestigio necesita saber de él. */
async function ownedCosmetics(admin: SupabaseClient, userId: string): Promise<Set<string>> {
  const { data, error } = await admin
    .from("user_cosmetics").select("cosmetic_id").eq("user_id", userId);
  if (error) throw new Error(error.message);
  return new Set(((data ?? []) as { cosmetic_id: string }[]).map((r) => r.cosmetic_id));
}

async function creditsOf(admin: SupabaseClient, userId: string): Promise<number> {
  const { data } = await admin.from("profiles").select("credits").eq("id", userId).maybeSingle();
  return (data as { credits: number } | null)?.credits ?? 0;
}

// ───────────────────────────── La vitrina ─────────────────────────────

export interface PrestigeOfferView {
  setId: string;
  label: string;
  baseId: string;
  tierId: string;
  tierLabel: string;
  color: string;
  price: number;
  /** ¿Le llega el saldo AHORA? La interfaz no tiene que calcularlo. */
  affordable: boolean;
}

export interface PrestigeOwnedView {
  setId: string;
  label: string;
  baseId: string;
  tierId: string;
  tierLabel: string;
  color: string;
}

export interface PrestigeView {
  credits: number;
  offers: PrestigeOfferView[];
  owned: PrestigeOwnedView[];
  totals: {
    /** Insignias de pleno que tiene: las que puede prestigiar. */
    eligible: number;
    /** Escalones ya comprados. */
    purchased: number;
    /** Créditos que ha quemado en prestigio. El sumidero, visto desde el jugador. */
    burned: number;
    /** Coste de llevar UN conjunto de la base a élite. */
    fullCost: number;
  };
}

export async function getPrestige(
  admin: SupabaseClient, userId: string,
): Promise<ServiceResult<PrestigeView>> {
  const [owned, credits] = await Promise.all([
    ownedCosmetics(admin, userId),
    creditsOf(admin, userId),
  ]);

  const offers = prestigeOffers(owned).map((o): PrestigeOfferView => ({
    setId: o.setId, label: o.label, baseId: o.baseId,
    tierId: o.tier.id, tierLabel: o.tier.label, color: o.tier.color,
    price: o.tier.price, affordable: credits >= o.tier.price,
  }));

  /*
   * Lo ya conseguido, para la vitrina. Se recorre por CONJUNTO y no por cosmético para que
   * el nombre que se enseña sea el del equipo o la región, no el id derivado.
   */
  const ownedViews: PrestigeOwnedView[] = [];
  for (const set of masterySets()) {
    const baseId = fullBadgeOf(set);
    if (!baseId) continue;
    const tier = highestTierOf(baseId, owned);
    if (!tier) continue;
    ownedViews.push({
      setId: set.id, label: set.label, baseId,
      tierId: tier.id, tierLabel: tier.label, color: tier.color,
    });
  }
  // Del escalón más alto al más bajo: la vitrina enseña primero lo que más costó.
  ownedViews.sort((a, b) => {
    const ra = prestigeTier(a.tierId)?.rank ?? 0;
    const rb = prestigeTier(b.tierId)?.rank ?? 0;
    return rb - ra || a.label.localeCompare(b.label);
  });

  const eligible = masterySets()
    .map(fullBadgeOf)
    .filter((id): id is string => !!id && owned.has(id)).length;

  return ok({
    credits,
    offers: offers.sort((a, b) => a.price - b.price || a.label.localeCompare(b.label)),
    owned: ownedViews,
    totals: {
      eligible,
      purchased: ownedViews.length,
      burned: burnedOn(owned),
      fullCost: PRESTIGE_TIERS.reduce((n, t) => n + t.price, 0),
    },
  });
}

// ───────────────────────────── Comprar ─────────────────────────────

export interface PrestigeBuyResult {
  cosmeticId: string;
  label: string;
  tierId: string;
  price: number;
  credits: number;
  /** `false` si la clave ya existía: no se cobró dos veces, y está bien. */
  applied: boolean;
}

/**
 * Compra un escalón de prestigio.
 *
 * Las puertas en Node son las mismas que en la RPC, y están duplicadas a propósito: aquí se
 * traducen a mensajes que un jugador entiende, y allí se cumplen bajo transacción aunque
 * alguien llamara a la RPC por otro camino. La de verdad es la de la base de datos.
 *
 *   1. El conjunto existe en el catálogo VIVO.
 *   2. El escalón existe.
 *   3. Tiene la insignia de pleno del conjunto — se la ganó coleccionando.
 *   4. Tiene el escalón anterior.
 *   5. No lo tiene ya.
 *
 * El precio NO se recibe: se busca en `PRESTIGE_TIERS`.
 */
export async function buyPrestige(
  admin: SupabaseClient, userId: string, setId: string, tierId: string,
): Promise<ServiceResult<PrestigeBuyResult>> {
  const set = masterySet(setId);
  if (!set) return fail(404, "Ese conjunto no existe");

  const tier: PrestigeTier | null = prestigeTier(tierId);
  if (!tier) return fail(404, "Ese escalón de prestigio no existe");

  const baseId = fullBadgeOf(set);
  if (!baseId) return fail(409, "Ese conjunto no tiene insignia que mejorar");

  const owned = await ownedCosmetics(admin, userId);
  if (!owned.has(baseId)) {
    return fail(409, "Primero hay que completar el conjunto");
  }

  const target = prestigeId(baseId, tier.id);
  if (owned.has(target)) return fail(409, "Ya tienes ese escalón");

  // El escalón anterior: la base para el primero, el de rango inferior para los demás.
  const previous = PRESTIGE_TIERS.filter((t) => t.rank < tier.rank).sort((a, b) => b.rank - a.rank)[0];
  const requires = previous ? prestigeId(baseId, previous.id) : baseId;
  if (!owned.has(requires)) {
    return fail(409, `Antes tienes que conseguir ${previous ? previous.label : "la insignia"}`);
  }

  const { data, error } = await admin.rpc("app_buy_cosmetic", {
    p_user: userId,
    p_cosmetic_id: target,
    p_price: tier.price,
    p_requires: requires,
    p_ref: prestigeRef(userId, baseId, tier.id),
  });

  if (error) {
    const m = error.message ?? "";
    if (/saldo|balance|insufficient/i.test(m)) return fail(409, "No te llegan los créditos");
    if (/Ya tienes/i.test(m)) return fail(409, "Ya tienes ese escalón");
    if (/escalón anterior/i.test(m)) return fail(409, "Te falta el escalón anterior");
    return fail(400, m || "No se pudo comprar");
  }

  const row = (data ?? {}) as { credits?: number; repeated?: boolean };
  return ok({
    cosmeticId: target,
    label: cosmetic(target)?.label ?? set.label,
    tierId: tier.id,
    price: tier.price,
    credits: row.credits ?? 0,
    applied: row.repeated !== true,
  });
}
