/**
 * MINTER — el ÚNICO punto de creación de cartas poseídas (Collection Fase 2/7).
 *
 * Toda carta que entra al juego (abriendo un sobre O concedida por recompensa/battlepass/torneo/gift/
 * promo/code/admin) se materializa AQUÍ y solo aquí: asigna nº de serie (respetando serialLimit, sin
 * duplicar), calidad (reutiliza Collection `qualityOf`), origen, marca de novedad y valor (reutiliza
 * pricing). NO persiste nada (el store lo hace) ni decide qué cae (eso es `openPack`). Determinista.
 *
 * Esto elimina la duplicidad histórica entre `openPack(...)` y `grantCard(...)`: ambos acuñan por esta
 * misma ruta.
 */
import { CardRegistry, qualityOf } from "@/collection";
import { bucketForRank } from "@/domain/packs/types";
import { nextSerial } from "@/domain/packs/serial";
import { instanceValue } from "@/domain/economy/pricing";
import type { CardDef, CardOrigin, DropInstance } from "./types";

export interface MintFlags { byPity?: boolean; compensated?: boolean }

/**
 * Acuñador con estado LOCAL (contadores de serie + cartas ya vistas en esta operación). Lee la
 * propiedad previa (`ownedSet`, SOLO LECTURA) para calcular la novedad; nunca la muta.
 */
export class Minter {
  private mintCounts: Record<string, number>;
  readonly mintDelta: Record<string, number> = {};
  private obtainedNew = new Set<string>();

  constructor(private registry: CardRegistry, private ownedSet: Set<string>, mintCounts: Record<string, number>) {
    this.mintCounts = { ...mintCounts };
  }

  /** Materializa UNA carta ya decidida en una instancia poseíble (sin uid/obtainedAt: eso es del borde). */
  mint(card: CardDef, origin: CardOrigin, flags: MintFlags = {}): DropInstance {
    const variant = this.registry.variant(card.variantId);
    const minted = this.mintCounts[card.id] ?? 0;
    const serial = nextSerial(variant, minted);
    if (serial != null) { this.mintCounts[card.id] = serial; this.mintDelta[card.id] = serial; }
    const isNew = !this.ownedSet.has(card.id) && !this.obtainedNew.has(card.id);
    if (isNew) this.obtainedNew.add(card.id);
    return {
      cardId: card.id, card, variantId: card.variantId, bucket: bucketForRank(variant.rank),
      serial, quality: qualityOf(variant, serial), origin, isNew,
      value: instanceValue(card, serial ?? undefined),
      byPity: flags.byPity ?? false, compensated: flags.compensated ?? false,
    };
  }
}
