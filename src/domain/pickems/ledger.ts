/**
 * Lectura del libro mayor en lenguaje de producto.
 *
 * `credit_transactions` guarda `reason` y `ref` en formato técnico
 * (`pickem_reward:analista`, `buy_pack:premium`, `pickem:<uuid>:<tier>`). Aquí se
 * traducen a algo que una persona entiende, en un solo sitio, para que ninguna
 * pantalla invente sus propias etiquetas.
 *
 * Es una función PURA: no toca red ni estado.
 */
import { REWARD_TIERS, type RewardTier } from "./rewards";
import { ns, td } from "@/i18n/runtime";

const tr = ns("pickems");

export type LedgerKind = "reward" | "purchase" | "starter" | "other";

export interface LedgerEntry {
  kind: LedgerKind;
  /** Etiqueta lista para mostrar. */
  label: string;
  /** Escalón de recompensa, si el asiento es una recompensa de Pick'em. */
  tier: RewardTier | null;
  /** Id del Pick'em al que pertenece, si se puede deducir del `ref`. */
  pickemEventId: string | null;
}

const TIER_BY_ID = new Map(REWARD_TIERS.map((t) => [t.id, t]));

const PACK_LABEL: Record<string, string> = {
  inicial: "Sobre Inicial",
  estandar: "Sobre Bronce",
  premium: "Sobre Plata",
  oro: "Sobre Oro",
  masters: "Sobre Masters",
  champions: "Sobre Champions",
  ewc: "Sobre EWC",
  prime: "Sobre Prime",
  icon: "Sobre Icon",
};

/** Nombre legible de un sobre; si no está en la tabla, se devuelve tal cual. */
export function packLabel(packId: string): string {
  return PACK_LABEL[packId] ?? `Sobre ${packId}`;
}

/** Interpreta un asiento del libro mayor. */
export function describeLedger(reason: string, ref: string | null): LedgerEntry {
  if (reason.startsWith("pickem_reward:")) {
    const tierId = reason.slice("pickem_reward:".length);
    const tier = TIER_BY_ID.get(tierId) ?? null;
    // ref = `pickem:<uuid>:<tier>`
    const parts = (ref ?? "").split(":");
    const pickemEventId = parts[0] === "pickem" && parts[1] ? parts[1] : null;
    return {
      kind: "reward",
      label: tier ? tr("Recompensa · {label}", { label: td(tier.label) }) : tr("Recompensa de Pick'ems"),
      tier,
      pickemEventId,
    };
  }

  if (reason.startsWith("buy_pack:")) {
    return {
      kind: "purchase",
      label: tr("Compra · {v}", { v: packLabel(reason.slice("buy_pack:".length)) }),
      tier: null,
      pickemEventId: null,
    };
  }

  if (reason === "starter_grant") {
    return { kind: "starter", label: tr("Créditos de bienvenida"), tier: null, pickemEventId: null };
  }

  return { kind: "other", label: reason, tier: null, pickemEventId: null };
}

/** ¿Este asiento es una recompensa (y no un gasto o un ajuste técnico)? */
export const isReward = (reason: string): boolean =>
  reason.startsWith("pickem_reward:") || reason === "starter_grant";
