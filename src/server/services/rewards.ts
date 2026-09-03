/**
 * RECOMPENSAS — LA RUTA ÚNICA (Fase 10, SOLO SERVIDOR).
 *
 * ────────────────────────── QUÉ PROBLEMA RESUELVE ──────────────────────────
 *
 * Antes de la Fase 10 había TRES sitios distintos concediendo recompensas, cada uno con
 * su forma de hacerlo:
 *
 *   1. `services/pickems.ts` llamaba a `app_grant_reward` con los cuatro campos que la
 *      RPC entendía. Los cosméticos de un premio de Pick'em, si algún día los llevara,
 *      se habrían perdido en silencio.
 *   2. `services/progression.ts` llamaba a la misma RPC y DESPUÉS escribía los cosméticos
 *      con un `upsert` aparte —fuera de la transacción—: si esa segunda escritura fallaba,
 *      la puerta de idempotencia ya estaba cerrada y el reintento no daba nada.
 *   3. El store de eventos (`useEventsStore`) concedía en el NAVEGADOR, escribiendo en
 *      `useGameStore`. Con sesión iniciada, la siguiente sincronización lo borraba.
 *
 * Tres rutas para lo mismo es tres oportunidades de que un jugador se quede a medias.
 *
 * ────────────────────────── LA REGLA ──────────────────────────
 *
 * **Toda recompensa del producto pasa por `award()`.** Una llamada, una transacción, una
 * clave de idempotencia. Si un tipo de recompensa no se puede entregar, esta función lo
 * dice en voz alta (`unsupported`) en lugar de tragárselo.
 *
 * El trabajo de verdad lo hace `app_grant_reward` (migración 0018), que en la Fase 10
 * pasó a saber entregar los siete campos: créditos, XP, fichas, sobres, PUNTOS, CARTAS y
 * COSMÉTICOS. Este módulo es la puerta en Node: valida, normaliza y traduce errores.
 *
 * ────────────────────────── IDEMPOTENCIA ──────────────────────────
 *
 * `ref` es la clave, y es obligatoria. La RPC comprueba si ya existe un asiento con esa
 * `ref` en `credit_transactions` y, si lo hay, no hace nada. Esto es lo que permite
 * reintentar sin miedo: un doble clic, un reintento de red o una recorrección de un
 * torneo no pagan dos veces.
 *
 * Elegir bien la `ref` es la única responsabilidad de quien llama. La convención es
 * `<sistema>:<identificador estable>`:
 *
 *   duel:<matchId>                          — una partida paga una vez
 *   pickem:<pickemEventId>:<escalón>        — un escalón por torneo
 *   pass:<temporada>:<carril>:<nivel>       — un nivel por carril
 *   achievement:<id>                        — un logro, una vez en la vida
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Reward } from "@/domain/events/types";

/** Campos de `Reward` que el servidor NO sabe entregar todavía. */
export type UnsupportedRewardField = "materials";

export interface AwardOutcome {
  /** `false` cuando la clave de idempotencia ya existía: no se pagó nada, y está bien. */
  applied: boolean;
  /** Saldo de créditos después de la concesión. */
  credits: number;
  /** Identificadores de las cartas creadas, si la recompensa llevaba alguna. */
  cardUids: string[];
  /**
   * Lo que la recompensa pedía y no se pudo entregar. No es un error —la recompensa se
   * concede igual—, pero se devuelve para que quien llama pueda registrarlo en vez de
   * descubrirlo cuando un jugador reclame.
   */
  unsupported: UnsupportedRewardField[];
}

export interface AwardInput {
  userId: string;
  /** Clave de idempotencia. Obligatoria: sin ella no se concede nada. */
  ref: string;
  /** Motivo, tal como aparecerá en el libro mayor y en la pantalla de Recompensas. */
  reason: string;
  reward: Reward;
  /**
   * Puntos competitivos. Van APARTE del `Reward` porque no son un recurso de inventario:
   * `Reward` lo consumen el pase, los eventos y las colecciones, y ninguno de ellos debe
   * saber de la escalera de rango.
   */
  points?: number;
}

const clampInt = (n: unknown): number => {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.trunc(n) : 0;
  return v;
};

/** Qué campos de esta recompensa el servidor todavía no sabe entregar. */
export function unsupportedFields(reward: Reward): UnsupportedRewardField[] {
  const out: UnsupportedRewardField[] = [];
  /*
   * Materiales de crafteo. Existen en el store local (`@/craft`) pero no hay tabla ni
   * columna en el servidor donde guardarlos. Repartirlos sería dar algo que desaparece
   * en la siguiente sincronización; es preferible declararlo. Cuando exista esa tabla,
   * se añade a `app_grant_reward` y esta lista se queda vacía.
   */
  if (reward.materials && Object.values(reward.materials).some((n) => (n ?? 0) > 0)) {
    out.push("materials");
  }
  return out;
}

/**
 * Concede una recompensa. **Es la única forma de conceder algo en NEXUS.**
 *
 * Lanza si la base de datos rechaza la operación: una recompensa que falla a medias no
 * existe —la RPC es una transacción—, así que propagar el error es correcto y quien llama
 * decide si reintentar o registrar.
 */
export async function award(
  admin: SupabaseClient, input: AwardInput,
): Promise<AwardOutcome> {
  const { userId, ref, reason, reward, points } = input;
  if (!ref) throw new Error("Una recompensa necesita clave de idempotencia");

  const cardIds = reward.cardId ? [reward.cardId] : null;
  const cosmetics = reward.cosmetics?.length ? reward.cosmetics : null;

  const { data, error } = await admin.rpc("app_grant_reward", {
    p_user: userId,
    p_ref: ref,
    p_reason: reason,
    p_credits: clampInt(reward.credits),
    p_xp: clampInt(reward.xp),
    p_tokens: clampInt(reward.tokens),
    p_pack_id: reward.packId ?? null,
    // Un sobre sin cantidad es un sobre: es el descuido más fácil al escribir contenido.
    p_pack_count: reward.packId ? Math.max(1, clampInt(reward.packCount) || 1) : 0,
    p_points: clampInt(points),
    p_card_ids: cardIds,
    p_cosmetics: cosmetics,
  });
  if (error) throw new Error(error.message);

  const row = (data ?? {}) as { applied?: boolean; credits?: number; cardUids?: string[] };
  return {
    applied: row.applied !== false,
    credits: row.credits ?? 0,
    cardUids: row.cardUids ?? [],
    unsupported: unsupportedFields(reward),
  };
}

/**
 * Concede VARIAS recompensas bajo una misma raíz de clave.
 *
 * Cada una recibe su propio sufijo (`ref#0`, `ref#1`…) porque son pagos distintos: si
 * compartieran clave, la segunda se consideraría un reintento de la primera y no se
 * pagaría. Con una sola recompensa la clave se deja limpia, que es lo que esperan las
 * claves ya escritas en el libro mayor de fases anteriores.
 */
export async function awardMany(
  admin: SupabaseClient,
  userId: string,
  rewards: Reward[],
  ref: string,
  reason: string,
): Promise<AwardOutcome[]> {
  const out: AwardOutcome[] = [];
  for (const [i, reward] of rewards.entries()) {
    out.push(await award(admin, {
      userId,
      ref: rewards.length > 1 ? `${ref}#${i}` : ref,
      reason,
      reward,
    }));
  }
  return out;
}
