/** PACK OPENING 3.0 · planes por ranuras en estudio (instrumento). `regular` = huecos normales; `featured` = el último. */
import type { PackCardClass } from "@/domain/packs/packClass";
export type Table = Record<PackCardClass, number>;
export interface SlotPlan { regular: Table; featured: Table | null; tilt?: number }
const T = (o: Partial<Table>): Table => ({ base: 0, plata: 0, oro: 0, masters: 0, champions: 0, prime: 0, icon: 0, ...o });
export const PLANS: Record<string, SlotPlan> = {
  estandar: { tilt: 0.3, regular: T({ base: 72, plata: 25, oro: 3 }), featured: T({ base: 25, plata: 40, oro: 20, masters: 10, champions: 3, prime: 1.5, icon: 0.5 }) },
  premium: { tilt: 0.22, regular: T({ plata: 82, oro: 15, masters: 3 }), featured: T({ plata: 15, oro: 40, masters: 29, champions: 10, prime: 5, icon: 1 }) },
  oro: { tilt: 0.12, regular: T({ oro: 70, masters: 27, champions: 3 }), featured: T({ oro: 20, masters: 35, champions: 22, prime: 15, icon: 8 }) },
  masters: { tilt: 0.03, regular: T({ oro: 35, masters: 52, champions: 13 }), featured: T({ masters: 30, champions: 30, prime: 25, icon: 15 }) },
  champions: { tilt: 0, regular: T({ oro: 20, masters: 33, champions: 40, prime: 7 }), featured: T({ champions: 30, prime: 42, icon: 28 }) },
  icon: { tilt: 0, regular: T({ prime: 72, icon: 28 }), featured: T({ prime: 50, icon: 50 }) },
};
