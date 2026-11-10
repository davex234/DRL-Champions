/**
 * MAESTRÍA DE COLECCIÓN — SERVIDOR (Fase 13, SOLO SERVIDOR).
 *
 * ────────────────────────── QUÉ APORTA ──────────────────────────
 *
 * El endgame que la Fase 11 detectó y la Fase 12 midió: al 91 % del catálogo no queda nada
 * que hacer. Esta capa da **77 objetivos nuevos** sobre la colección que el jugador ya
 * tiene, sin añadir una sola carta y sin repartir un solo crédito.
 *
 * ────────────────────────── DOS DECISIONES ──────────────────────────
 *
 * **1. Ninguna tabla nueva.** Igual que los desafíos de evento en la Fase 12, lo reclamado
 * va a `user_achievements` con el id `mastery:<conjunto>:<escalón>`. Esa tabla ya guarda
 * «qué reclamó quién y cuándo», ya está cerrada al cliente y ya tiene su RLS. Y el progreso
 * no se guarda: se cuenta contra `user_cards`, que es donde está la propiedad de verdad.
 *
 * **2. Solo cosméticos.** `assertNoCredits()` lo comprueba en arranque y hay una prueba que
 * lo vuelve a comprobar. No es una convención que alguien pueda romper por descuido al
 * añadir un conjunto: es una invariante que rompe la suite.
 *
 * ────────────────────────── LA TEMPORADA ──────────────────────────
 *
 * La maestría es **permanente**, no de temporada. Es deliberado: una colección tarda meses
 * en construirse y reiniciar el reconocimiento cada 84 días convertiría el trabajo largo en
 * trabajo perdido. Lo que sí se guarda es CUÁNDO se consiguió (`user_achievements.claimed_at`),
 * que es lo que permite ordenar la vitrina de un perfil por temporadas sin borrar nada.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  masterySets, masterySet, progressFor, masteryRef,
  type MasterySet, type MasteryTier,
} from "@/domain/collection/mastery";
import type { Reward } from "@/domain/events/types";
import { award } from "./rewards";
import { loadCollectionSummary, ownedCardIdsOf } from "./userCards";

export interface ServiceResult<T> {
  ok: boolean;
  status: number;
  error?: string;
  data?: T;
}

const ok = <T,>(data: T): ServiceResult<T> => ({ ok: true, status: 200, data });
const fail = (status: number, error: string): ServiceResult<never> => ({ ok: false, status, error });

/**
 * La invariante económica de esta capa, comprobada donde se paga.
 *
 * La Fase 12 dejó el grifo de temporada medido en 124.900 créditos no repetibles. 162
 * escalones que pagaran aunque fuese 500 créditos serían 81.000 más: habríamos resuelto el
 * endgame inflando la economía recién calibrada. Por eso esto no es un comentario, es un
 * corte.
 */
function assertNoCredits(reward: Reward, where: string): void {
  const money = (reward.credits ?? 0) + (reward.xp ?? 0)
    + (reward.packCount ?? 0) + (reward.cardId ? 1 : 0);
  if (money > 0) {
    throw new Error(`La maestría solo reparte cosméticos, y ${where} intenta pagar otra cosa`);
  }
}

// ───────────────────────────── Lectura ─────────────────────────────

/** Ids de carta DISTINTOS que posee el jugador. Es lo único que la maestría necesita saber. */
async function ownedCardIds(admin: SupabaseClient, userId: string): Promise<Set<string>> {
  // COLECCIONES ILIMITADAS · del resumen por carta: completo para cualquier tamaño o error (antes se paginaba sin orden
  // estable, y dos páginas podían repetir una fila y saltarse otra).
  return ownedCardIdsOf(await loadCollectionSummary(admin, userId));
}

async function claimedRefs(admin: SupabaseClient, userId: string): Promise<Set<string>> {
  const { data } = await admin
    .from("user_achievements").select("achievement_id")
    .eq("user_id", userId).like("achievement_id", "mastery:%");
  return new Set(((data ?? []) as { achievement_id: string }[]).map((r) => r.achievement_id));
}

export interface MasteryTierView {
  at: number;
  label: string;
  reward: Reward;
  reached: boolean;
  claimed: boolean;
  claimable: boolean;
}

export interface MasterySetView {
  id: string;
  axis: MasterySet["axis"];
  label: string;
  owned: number;
  total: number;
  /** Cuántas faltan para el siguiente escalón, 0 si ya está el pleno. */
  toNext: number;
  nextLabel: string | null;
  tiers: MasteryTierView[];
  /** ¿Hay algo que cobrar en este conjunto? Es lo que ordena la lista. */
  hasClaimable: boolean;
}

export interface MasteryView {
  sets: MasterySetView[];
  /** Resumen para la cabecera. */
  totals: {
    sets: number;
    completed: number;
    claimable: number;
    badgesEarned: number;
    /** Cartas distintas que tiene el jugador, sobre el catálogo. */
    ownedCards: number;
    catalogCards: number;
  };
}

function tierViews(
  set: MasterySet, owned: Set<string>, claimed: Set<string>,
): { views: MasteryTierView[]; reachedCount: number } {
  const p = progressFor(set, owned);
  const views = set.tiers.map((t): MasteryTierView => {
    const isReached = p.reached.includes(t);
    const isClaimed = claimed.has(masteryRef(set.id, t.at));
    return {
      at: t.at, label: t.label, reward: t.reward,
      reached: isReached, claimed: isClaimed,
      claimable: isReached && !isClaimed,
    };
  });
  return { views, reachedCount: p.reached.length };
}

export async function getMastery(
  admin: SupabaseClient, userId: string,
): Promise<ServiceResult<MasteryView>> {
  const [owned, claimed] = await Promise.all([
    ownedCardIds(admin, userId),
    claimedRefs(admin, userId),
  ]);

  const sets = masterySets();
  const views: MasterySetView[] = sets.map((s) => {
    const p = progressFor(s, owned);
    const { views: tiers } = tierViews(s, owned, claimed);
    return {
      id: s.id, axis: s.axis, label: s.label,
      owned: p.owned, total: p.total,
      toNext: p.toNext, nextLabel: p.next?.label ?? null,
      tiers,
      hasClaimable: tiers.some((t) => t.claimable),
    };
  });

  /*
   * Orden: primero lo que se puede cobrar, después lo que está más cerca de terminarse.
   * Con 77 conjuntos, el orden ES la interfaz: una lista alfabética obligaría a buscar.
   */
  views.sort((a, b) => {
    if (a.hasClaimable !== b.hasClaimable) return a.hasClaimable ? -1 : 1;
    const fa = a.total === 0 ? 0 : a.owned / a.total;
    const fb = b.total === 0 ? 0 : b.owned / b.total;
    if (fa !== fb) return fb - fa;
    return a.label.localeCompare(b.label);
  });

  const catalogCards = new Set(sets.flatMap((s) => s.cardIds)).size;

  return ok({
    sets: views,
    totals: {
      sets: views.length,
      completed: views.filter((v) => v.total > 0 && v.owned >= v.total).length,
      claimable: views.filter((v) => v.hasClaimable).length,
      badgesEarned: views.reduce((n, v) => n + v.tiers.filter((t) => t.claimed).length, 0),
      ownedCards: owned.size,
      catalogCards,
    },
  });
}

// ───────────────────────────── Cobrar ─────────────────────────────

export interface MasteryClaimResult {
  setId: string;
  at: number;
  label: string;
  reward: Reward;
  applied: boolean;
}

/**
 * Cobra un escalón de maestría.
 *
 * Las puertas, en orden, y el orden importa:
 *
 *   1. El conjunto existe en el catálogo VIVO. Un conjunto de un catálogo anterior ya no
 *      es un objetivo válido.
 *   2. El escalón pertenece a ese conjunto.
 *   3. El premio es cosmético. Se comprueba aquí, no solo al escribir el contenido.
 *   4. El progreso REAL lo alcanza. Contado contra `user_cards` ahora mismo.
 *   5. No estaba ya cobrado.
 *
 * Y después se paga por `award()` —idempotente por `ref`— y solo entonces se registra. Ese
 * orden es el mismo que la Fase 12 fijó para los desafíos de evento, y por el mismo motivo:
 * registrar antes de pagar dejaría un escalón marcado como cobrado sin haber entregado nada.
 */
export async function claimMasteryTier(
  admin: SupabaseClient, userId: string, setId: string, at: number,
): Promise<ServiceResult<MasteryClaimResult>> {
  const set = masterySet(setId);
  if (!set) return fail(404, "Ese conjunto no existe");

  const tier: MasteryTier | undefined = set.tiers.find((t) => Math.abs(t.at - at) < 1e-6);
  if (!tier) return fail(404, "Ese escalón no existe en este conjunto");

  assertNoCredits(tier.reward, `${setId}@${at}`);

  const owned = await ownedCardIds(admin, userId);
  const p = progressFor(set, owned);
  if (!p.reached.includes(tier)) {
    const need = Math.ceil(tier.at * set.cardIds.length);
    return fail(409, `Todavía no: llevas ${p.owned} de ${need}`);
  }

  const ref = masteryRef(set.id, tier.at);

  const { data: already } = await admin
    .from("user_achievements").select("achievement_id")
    .eq("user_id", userId).eq("achievement_id", ref).maybeSingle();
  if (already) return fail(409, "Ya has reclamado ese escalón");

  const outcome = await award(admin, {
    userId, ref, reason: `mastery:${set.id}`, reward: tier.reward,
  });

  await admin.from("user_achievements")
    .upsert({ user_id: userId, achievement_id: ref }, { onConflict: "user_id,achievement_id" });

  return ok({
    setId: set.id, at: tier.at, label: tier.label, reward: tier.reward, applied: outcome.applied,
  });
}
