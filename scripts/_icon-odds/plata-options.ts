/** Instrumento ICON-ODDS: opciones para la P(≥1 carta 95) del Plata sin tocar su 5 % de ICON (cálculo exacto). */
import { getPack } from "@/data/packs";
import { MAIN_PACK_PLAN, packCardClass, type MainPackPlan } from "@/domain/packs/packClass";
import { packClassPools } from "@/domain/packs/packPools";
import { tierIdentity } from "@/domain/packs/tierIdentity";
import { iconQualityWeights, iconValueLevels, ICON_QUALITY_ALTERNATIVES } from "@/domain/packs/iconQuality";
import { marketValue } from "@/domain/economy/pricing";
import type { CardDef } from "@/domain/cards/types";
const pp = packClassPools(getPack("premium")!);
const q = iconQualityWeights(ICON_QUALITY_ALTERNATIVES[0], iconValueLevels(pp.pools.icon, marketValue));
const run = (label: string, plan: MainPackPlan, w: (c: CardDef) => number = pp.weightOf) => { const r = tierIdentity(plan, pp.pools, marketValue, w); console.log(label.padEnd(64), "P(≥95)", (r.bestAtLeast[95] * 100).toFixed(2) + "%", "EV/cr", (r.expectedValue / 6000).toFixed(3)); };
const base = MAIN_PACK_PLAN.premium;
run("RC (Icon 5 %, inclinación λ 0,22 dentro de la Icon)", base);
// Contribución mínima de la propia Icon: P(Icon) × P(95 | Icon).
const iconOnly = (w: (c: CardDef) => number) => { const t = pp.pools.icon.reduce((a, c) => a + w(c), 0); return pp.pools.icon.filter((c) => c.ovr >= 95).reduce((a, c) => a + w(c), 0) / t; };
console.log("P(95 | Icon) con λ 0,22:", (iconOnly((c) => Math.exp(-0.22 * (c.ovr - 70))) * 100).toFixed(1) + "%", "· con tabla 65/35:", (iconOnly((c) => q.get(c.id)!) * 100).toFixed(1) + "%");
// tierIdentity multiplica el peso por la inclinación del plan: para que la Icon quede EXACTAMENTE en 65/35 se compensa.
const tilt = (c: CardDef) => Math.exp(-base.ovrTilt * (c.ovr - 70));
run("Opción 1 · tabla ICON 65/17,5/17,5 también en la Icon del Plata", base, (c) => (packCardClass(c) === "icon" ? q.get(c.id)! / tilt(c) : pp.weightOf(c)));
