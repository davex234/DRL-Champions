/**
 * REGLA DE NEGOCIO · ENTRADA EN ECO (ataque).
 *
 * Cuando el equipo ATACA y su compra es eco/save:
 *   1. El plan automático del motor de preparación usa `eco_rush` (lo comprueban `buildRoundPlan` y su test).
 *   2. El entrenador puede cambiar la entrada SOLO con una justificación táctica reconocida, que deja en sus notas:
 *        - `pistol_round`      ronda de pistola (1 y la primera tras el cambio de lado): se juega el plan por defecto;
 *        - `react_match_point` el rival tiene punto de partido: se fuerza;
 *        - `react_to_losses`   racha de derrotas / momentum muy negativo: se buscan picks.
 *   3. Sin esa justificación (p. ej. `endorse_plan`), o si el equipo IMPROVISÓ (desobedeció por su ADN y volvió a su
 *      lectura automática), la entrada debe seguir siendo `eco_rush`.
 *   4. La compra del plan (que el entrenador copia del plan automático) debe ser la compra REAL de la ronda.
 *
 * Función pura sobre los hechos de UNA ronda (los que guarda el historial del partido); no decide nada del juego.
 * La usan `scripts/preparation-verify.ts` y sus tests (`ecoEntry.test.ts`).
 */
import type { BuyTier } from "@/economy";
import type { EntryType } from "@/preparation";
import type { Side } from "@/sim";

/** Notas del entrenador que justifican no jugar eco_rush en eco. */
export const ECO_ENTRY_JUSTIFICATIONS = ["pistol_round", "react_match_point", "react_to_losses"] as const;
export type EcoEntryJustification = (typeof ECO_ENTRY_JUSTIFICATIONS)[number];

const ECO_TIERS: readonly BuyTier[] = ["eco", "save"];

/** Hechos de una ronda, tal como quedan en `RoundHistoryEntry` (plan final, decisión del entrenador, compra real). */
export interface EcoRoundFacts {
  side: Side;
  /** Compra que figura en el plan final. */
  planBuy: BuyTier;
  /** Entrada del plan final. */
  entryType: EntryType;
  /** Compra real de la ronda (`loadout.home.buy`); null si no se registró. */
  realBuy: BuyTier | null;
  /** Decisión del entrenador; null si el entrenador estaba desactivado. */
  coach: { notes: readonly string[]; deviated: boolean } | null;
}

export type EcoEntryVerdict =
  | { applies: false }
  | { applies: true; ok: true; reason: "eco_rush" | EcoEntryJustification }
  | { applies: true; ok: false; reason: "buy_mismatch" | "no_real_buy" | "improvised" | "no_coach" | "unjustified" };

export function checkEcoEntry(f: EcoRoundFacts): EcoEntryVerdict {
  if (f.side !== "ATK" || !ECO_TIERS.includes(f.planBuy)) return { applies: false };
  // 4 · la compra del plan es la compra real.
  if (f.realBuy == null) return { applies: true, ok: false, reason: "no_real_buy" };
  if (f.realBuy !== f.planBuy) return { applies: true, ok: false, reason: "buy_mismatch" };
  // 1 y 3 · eco_rush siempre vale.
  if (f.entryType === "eco_rush") return { applies: true, ok: true, reason: "eco_rush" };
  // Otra entrada: solo si el entrenador la decidió con una justificación reconocida y el equipo obedeció.
  if (!f.coach) return { applies: true, ok: false, reason: "no_coach" };
  if (f.coach.deviated || f.coach.notes.includes("improvised")) return { applies: true, ok: false, reason: "improvised" };
  const why = ECO_ENTRY_JUSTIFICATIONS.find((j) => f.coach!.notes.includes(j));
  return why ? { applies: true, ok: true, reason: why } : { applies: true, ok: false, reason: "unjustified" };
}
