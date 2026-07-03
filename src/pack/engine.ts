/**
 * PACK OPENING ENGINE — orquestación (Collection Fase 2/7).
 *
 * Capa de ORQUESTACIÓN, no un segundo motor: compone el ÚNICO decisor de drops (`openPack`,
 * `@/domain/packs`) + el ÚNICO acuñador (`Minter`) + los eventos (reutiliza Collection). No posee
 * cartas, catálogo, variantes, ownership ni historial: solo decide qué recompensa entregar y la
 * materializa; la persistencia vive en el store. Dos rutas que comparten el MISMO acuñado:
 *   • open(pack)             → openPack DECIDE  → Minter ACUÑA → eventos.
 *   • grant(cardIds, origin) → (ya decididas)  → Minter ACUÑA → eventos.
 * Determinista (RNG oficial del proyecto).
 *
 *   Pack UI → PackEngine → openPack() [decisión] → Minter [acuñado] → Collection → Ownership
 */
import { CardRegistry } from "@/collection";
import { openPack } from "@/domain/packs/openPack";
import { buildPool, BUCKETS } from "@/domain/packs/pool";
import { freshPity } from "@/domain/packs/pity";
import type { RarityBucket } from "@/domain/packs/types";
import { Minter } from "./mint";
import { dropEvents } from "./events";
import { validatePack } from "./validate";
import type {
  PackDef, OpenContext, OpenResult, DropInstance, CardOrigin, PackOdds, PackValidation, PityState,
} from "./types";

export interface DrawResult { instances: DropInstance[]; pityAfter: PityState; mintDelta: Record<string, number> }

export class PackEngine {
  readonly registry: CardRegistry;
  constructor(registry: CardRegistry = new CardRegistry()) { this.registry = registry; }

  /**
   * DECIDE (openPack) + ACUÑA (Minter), SIN eventos. Ruta base compartida por `open`. Ordena el
   * resultado de menor a mayor rareza para el revelado (el acuñado ya respetó el orden de sorteo).
   */
  draw(pack: PackDef, ctx: OpenContext): DrawResult {
    const ownedSet = new Set(ctx.owned.map((o) => o.cardId));
    const { decisions, pityAfter } = openPack(this.registry, pack, { seed: ctx.seed, owned: ownedSet, pity: ctx.pity });
    const minter = new Minter(this.registry, ownedSet, ctx.mintCounts);
    const origin = pack.origin ?? "pack";
    const instances = decisions.map((d) => minter.mint(d.card, origin, { byPity: d.byPity, compensated: d.compensated }));
    instances.sort((a, b) => this.registry.variant(a.variantId).rank - this.registry.variant(b.variantId).rank || (a.cardId < b.cardId ? -1 : 1));
    return { instances, pityAfter, mintDelta: minter.mintDelta };
  }

  /** Abre un sobre: decisión + acuñado + eventos. Determinista dado (pack, ctx). */
  open(pack: PackDef, ctx: OpenContext): OpenResult {
    const { instances, pityAfter, mintDelta } = this.draw(pack, ctx);
    const events = dropEvents(this.registry, pack.id, instances, ctx);
    return { packId: pack.id, instances, events, pityAfter, mintDelta };
  }

  /**
   * Acuña cartas YA decididas por la MISMA ruta (Minter) que la apertura. Único punto por el que entran
   * recompensas/battlepass/torneo/gift/promo/code/admin. No sortea (no invoca `openPack`): no decide.
   */
  grant(cardIds: string[], origin: CardOrigin, ctx: OpenContext): OpenResult {
    const ownedSet = new Set(ctx.owned.map((o) => o.cardId));
    const minter = new Minter(this.registry, ownedSet, ctx.mintCounts);
    const instances: DropInstance[] = [];
    for (const id of cardIds) {
      const card = this.registry.card(id);
      if (card) instances.push(minter.mint(card, origin)); // cardId inválido ⇒ se ignora (nunca acuña basura)
    }
    const events = dropEvents(this.registry, `grant:${origin}`, instances, ctx);
    return { packId: `grant:${origin}`, instances, events, pityAfter: ctx.pity ?? freshPity(), mintDelta: minter.mintDelta };
  }

  /** Probabilidades declaradas (preview de tienda, sin abrir). */
  odds(pack: PackDef): PackOdds {
    const { pool, size } = buildPool(this.registry, pack);
    const usable = BUCKETS.filter((b) => pool[b].length > 0);
    const total = usable.reduce((s, b) => s + (pack.weights[b] || 0), 0);
    const byBucket = {} as Record<RarityBucket, number>;
    for (const b of BUCKETS) byBucket[b] = total > 0 && pool[b].length > 0 ? Math.round(((pack.weights[b] || 0) / total) * 1000) / 10 : 0;
    return {
      packId: pack.id, cardCount: pack.cardCount, poolSize: size, byBucket,
      guaranteedMin: pack.guaranteedMin ?? null, hasPity: !!pack.pity, antiDuplicate: pack.antiDuplicate ?? "allow",
    };
  }

  validate(pack: PackDef): PackValidation {
    const issues = validatePack(this.registry, pack);
    return { ok: issues.length === 0, issues };
  }
}
