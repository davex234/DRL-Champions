/**
 * F79.1 · CARTA PROTEGIDA — la regla ÚNICA para toda operación que DESTRUYE copias (desguace, intercambio F73, forja
 * avanzada de NEXUS FORGE y cualquier consumo futuro). PURO.
 *
 * Dos niveles, y no se mezclan:
 *
 *   BLOQUEO ABSOLUTO (nunca se consume, ni confirmándolo):
 *     · NOT_OWNED       la copia no es tuya (o ya no existe);
 *     · MARKET_LISTED   `user_cards.locked` (en venta en el mercado);
 *     · IN_DECK         está en alguno de tus equipos;
 *     · LAST_COPY       de cada carta te queda al menos UNA copia NO bloqueada. Invariante independiente (0060/0061):
 *                       ninguna confirmación la levanta.
 *
 *   PROTECCIÓN CONFIRMABLE (solo se consume si el jugador la CONFIRMA copia a copia, `confirmProtected`):
 *     · FAVORITE        la carta está en tus favoritas (0052, por carta → todas sus copias);
 *     · SHOWCASE        la copia está en la vitrina de tu perfil (0049, por copia).
 *
 * Nunca hay consumo silencioso de una copia protegida: o se confirma, o la operación entera se rechaza
 * (`PROTECTED_COPY`). La base de datos aplica la MISMA regla dentro de la transacción (0061, `_card_consume_guard`),
 * con la confirmación como argumento: Node la comprueba antes para dar un mensaje claro, la BD es la autoridad.
 */
export type AbsoluteBlock = "NOT_OWNED" | "MARKET_LISTED" | "IN_DECK" | "LAST_COPY";
export type Protection = "FAVORITE" | "SHOWCASE";

export interface ProtectionContext {
  /** Cartas favoritas (por `card_id`). */
  favoriteCardIds: ReadonlySet<string>;
  /** Copias en la vitrina (por `uid`). */
  showcaseUids: ReadonlySet<string>;
  /** Copias en algún equipo (por `uid`). */
  inDeck: ReadonlySet<string>;
}

export const EMPTY_PROTECTION: ProtectionContext = { favoriteCardIds: new Set(), showcaseUids: new Set(), inDeck: new Set() };

/** Protección confirmable de UNA copia. */
export function copyProtection(uid: string, cardId: string, ctx: ProtectionContext): Protection[] {
  const out: Protection[] = [];
  if (ctx.favoriteCardIds.has(cardId)) out.push("FAVORITE");
  if (ctx.showcaseUids.has(uid)) out.push("SHOWCASE");
  return out;
}

export interface OwnedCopyRef { uid: string; cardId: string; locked: boolean }

export type ConsumeCheck =
  | { ok: true; protectedUsed: string[] }
  | { ok: false; error: AbsoluteBlock | "PROTECTED_COPY" | "DUPLICATE_INPUT"; uids: string[] };

/**
 * ¿Se pueden DESTRUIR exactamente estas copias? La misma comprobación para todas las rutas. `confirmProtected` solo
 * puede RESTRINGIR: una copia protegida no listada rechaza la operación; una listada que no está protegida no cambia
 * nada. Orden de errores estable (lo absoluto primero).
 */
export function checkConsumable(
  uids: readonly string[], owned: readonly OwnedCopyRef[], ctx: ProtectionContext, confirmProtected: readonly string[] = [],
): ConsumeCheck {
  if (new Set(uids).size !== uids.length) return { ok: false, error: "DUPLICATE_INPUT", uids: [] };
  const byUid = new Map(owned.map((o) => [o.uid, o]));
  const pick = (pred: (u: string) => boolean) => uids.filter(pred);
  const missing = pick((u) => !byUid.has(u));
  if (missing.length) return { ok: false, error: "NOT_OWNED", uids: missing };
  const listed = pick((u) => byUid.get(u)!.locked);
  if (listed.length) return { ok: false, error: "MARKET_LISTED", uids: listed };
  const deck = pick((u) => ctx.inDeck.has(u));
  if (deck.length) return { ok: false, error: "IN_DECK", uids: deck };
  const chosen = new Set(uids);
  const lastCopy: string[] = [];
  for (const cardId of new Set(uids.map((u) => byUid.get(u)!.cardId))) {
    const kept = owned.filter((o) => o.cardId === cardId && !o.locked && !chosen.has(o.uid)).length;
    if (kept < 1) lastCopy.push(...uids.filter((u) => byUid.get(u)!.cardId === cardId));
  }
  if (lastCopy.length) return { ok: false, error: "LAST_COPY", uids: lastCopy };
  const confirmed = new Set(confirmProtected);
  const prot = pick((u) => copyProtection(u, byUid.get(u)!.cardId, ctx).length > 0);
  const unconfirmed = prot.filter((u) => !confirmed.has(u));
  if (unconfirmed.length) return { ok: false, error: "PROTECTED_COPY", uids: unconfirmed };
  return { ok: true, protectedUsed: prot };
}
