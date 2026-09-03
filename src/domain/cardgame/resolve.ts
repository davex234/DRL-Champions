/**
 * DUELOS — resolución y propiedad (Fase 3).
 *
 * Une catálogo y propiedad para convertir un `uid` en una carta jugable. Es el ÚNICO punto donde
 * el dominio de duelos toca el registro de cartas; el resto de las reglas son puras.
 *
 * REUTILIZA lo que ya existe y NO crea un segundo catálogo ni un segundo inventario:
 *   · `CardRegistry`   (@/collection/registry) — adaptador de solo lectura sobre el catálogo
 *   · `OwnershipIndex` (@/collection/ownership) — índice sobre `OwnedCard[]`
 *
 * El dominio depende de la PUERTA `OwnershipSource`, no de Supabase ni de ningún store.
 */
import type { CardRegistry } from "@/collection/registry";
import type { OwnedCard } from "@/domain/cards/types";
import type { DuelCardResolution, DuelDeckCard, DuelDeckResolver } from "./types";

/**
 * Puerta de propiedad. Cualquier origen que sepa listar las instancias de un usuario la cumple:
 * la respuesta del servidor (`/api/game/state`), la caché del cliente o una lista fija en tests.
 *
 * IMPORTANTE (frontera de seguridad): el cliente puede usar esto para PREVISUALIZAR, pero la
 * propiedad que cuenta es la del servidor. Antes de iniciar una partida real, el servidor deberá
 * volver a resolver el mazo con su propia fuente. Ver el informe de Fase 3 §16.
 */
export interface OwnershipSource {
  /** Instancia poseída por su uid, o `undefined` si el usuario no la tiene. */
  instance(uid: string): OwnedCard | undefined;
  /** Todas las instancias del usuario. */
  all(): OwnedCard[];
}

/**
 * Construye el resolver de mazo. Determinista: mismas entradas, misma salida.
 *
 * Orden de comprobación (importa, porque decide qué error se reporta):
 *   1. ¿el usuario posee la instancia?   → CARD_NOT_OWNED
 *   2. ¿existe la definición?            → CARD_NOT_FOUND
 *   3. ¿tiene trío de combate?           → CARD_NO_COMBAT
 */
export function makeDeckResolver(registry: CardRegistry, ownership: OwnershipSource): DuelDeckResolver {
  return (uid: string): DuelCardResolution => {
    const owned = ownership.instance(uid);
    if (!owned) return { ok: false, uid, reason: "CARD_NOT_OWNED" };

    const def = registry.card(owned.cardId);
    if (!def) return { ok: false, uid, reason: "CARD_NOT_FOUND", cardId: owned.cardId };

    // El trío es obligatorio: una carta sin él pertenece a un catálogo anterior al modelo de Fase 2.
    if (!def.combat) return { ok: false, uid, reason: "CARD_NO_COMBAT", cardId: def.id };

    const player = registry.player(def.playerId);
    if (!player) return { ok: false, uid, reason: "CARD_NOT_FOUND", cardId: def.id };

    const card: DuelDeckCard = {
      uid,
      cardId: def.id,
      playerId: def.playerId,
      playerName: player.nick,
      team: player.team,
      region: player.region,
      role: player.role,
      variantId: def.variantId,
      combat: def.combat,
      ovr: def.ovr,
      statBoost: def.statBoost ?? 0,
      dataVersion: def.dataVersion ?? "",
      serial: owned.serial ?? null,
    };
    return { ok: true, card };
  };
}

/**
 * Resuelve TODAS las instancias del usuario a cartas jugables, descartando en silencio las que no
 * lo son (catálogo antiguo, cartas retiradas). Es la lista que alimenta al constructor de mazos.
 */
export function resolveAvailableCards(
  registry: CardRegistry,
  ownership: OwnershipSource,
): DuelDeckCard[] {
  const resolve = makeDeckResolver(registry, ownership);
  const out: DuelDeckCard[] = [];
  for (const owned of ownership.all()) {
    const r = resolve(owned.uid);
    if (r.ok) out.push(r.card);
  }
  return out;
}

/** Adaptador trivial sobre una lista de instancias. Útil en servidor y en tests. */
export function ownershipFromList(owned: OwnedCard[]): OwnershipSource {
  const byUid = new Map(owned.map((o) => [o.uid, o]));
  return { instance: (uid) => byUid.get(uid), all: () => owned };
}
