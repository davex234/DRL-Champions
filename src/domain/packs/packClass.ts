/**
 * PACK CLASS DISTRIBUTION (Fase 57.3) — FUENTE ÚNICA de la línea principal de sobres.
 *
 * ─────────────────────────── QUÉ SUSTITUYE ───────────────────────────
 *
 * Seis productos —Bronce, Plata, Oro, Masters, Champions e Icon— dejan de sortear por RAREZA DE VARIANTE (con el techo
 * de OVR del Hotfix 57.2 encima) y pasan a sortear por CLASE DE SOBRE: cada hueco elige primero una clase con la tabla
 * de su ranura (`MAIN_PACK_PLAN`, Pack Opening 3.0) y después una carta de esa clase. Son dos conceptos y solo dos:
 *
 *   · `packCardClass(card)`  → a qué clase pertenece una carta (determinista, derivada de edición + OVR).
 *   · `mainPackPlan(packId)` → ranuras normales + ranura destacada + inclinación por OVR (null = el sobre no usa esto).
 *     `mainPackDistribution(packId)` es su promedio exacto por carta (derivado, para valor esperado y fichas).
 *
 * Servidor (`openPack`), simulador de economía, fichas y tests leen de aquí. Ningún porcentaje se repite a mano.
 *
 * ─────────────────────────── QUÉ NO ES ───────────────────────────
 *
 * «Prime» e «Icon» son CATEGORÍAS DE DISTRIBUCIÓN, no ediciones. Una Future Star sigue siendo Future Star, una Record
 * Breaker sigue siendo Record Breaker y una Moments sigue siendo Moments en el catálogo, en la carta y en la colección.
 * Esta clasificación no cambia edición, rareza, OVR ni stats de ninguna carta: solo decide en qué cubo del sorteo cae.
 *
 * ─────────────────────────── SIN FALLBACK ───────────────────────────
 *
 * Un cubo con probabilidad > 0 que no tenga cartas NO se renormaliza ni cae al catálogo completo: la apertura FALLA
 * CERRADA (`EmptyPackClassError`). Con el catálogo actual ninguno está vacío (lo fija `packClass.test.ts`).
 */
import type { CardDef } from "../cards/types";

export type PackCardClass = "base" | "plata" | "oro" | "masters" | "champions" | "prime" | "icon";

/** De menor a mayor: es el orden de la escalera y el de la ficha. */
export const PACK_CLASS_ORDER: readonly PackCardClass[] = ["base", "plata", "oro", "masters", "champions", "prime", "icon"];

export const PACK_CLASS_LABEL: Readonly<Record<PackCardClass, string>> = {
  base: "Base", plata: "Plata", oro: "Oro", masters: "Masters", champions: "Champions", prime: "Prime", icon: "Icon",
};

/** Ediciones que cubre cada clase, para explicarlo en la ficha (texto, no regla: la regla es `packCardClass`). */
export const PACK_CLASS_SCOPE: Readonly<Record<PackCardClass, string>> = {
  base: "Edición base, OVR 70–81",
  plata: "Edición base, OVR 82–85",
  oro: "Edición base, OVR 86–92",
  masters: "Masters L y Masters SDC",
  champions: "Champions S",
  prime: "Future Star",
  icon: "Record Breaker y Moments",
};

/**
 * La clase de sobre de una carta, o `null` si no pertenece a ninguna (edición fuera de la línea, o una base con un OVR
 * fuera de 70–92 o no finito). Una carta sin clase no puede salir de estos seis sobres: fallo cerrado.
 */
export function packCardClass(card: Pick<CardDef, "variantId" | "ovr">): PackCardClass | null {
  switch (card.variantId) {
    case "base": {
      const o = card.ovr;
      if (!Number.isFinite(o)) return null;
      if (o >= 70 && o <= 81) return "base";
      if (o >= 82 && o <= 85) return "plata";
      if (o >= 86 && o <= 92) return "oro";
      return null;
    }
    case "masters-l":
    case "masters-sdc":
      return "masters";
    case "champions-s":
      return "champions";
    case "future-star":
      return "prime";
    case "record-breaker":
    case "moments":
      return "icon";
    default:
      return null;
  }
}

/** Probabilidad de cada clase. En `MAIN_PACK_DISTRIBUTION` (derivada) va en PORCENTAJE (puede llevar decimales). */
export type ClassDistribution = Readonly<Record<PackCardClass, number>>;

/*
 * ═══════════════════════ PACK OPENING 3.0 · IDENTIDAD DE SOBRE (2026-10-07) ═══════════════════════
 *
 * EL PROBLEMA (medido con el motor real, 200.000 aperturas por sobre): cada hueco sorteaba su clase de forma INDEPENDIENTE
 * con la misma tabla y, dentro de la clase, la carta salía UNIFORME. Las clases altas (Masters 78–95, Champions 80–95,
 * Prime 87–95, Icon 92–95) contienen cartas de 93–95, así que CUALQUIER hueco de CUALQUIER sobre podía dar un 95: el
 * Plata daba una carta ≥ 95 en el 19,8 % de los sobres, ≥ 90 en el 67 %, y un sobre «absurdo» (Prime/Icon + otras tres
 * ≥ 86) en el 14,4 %. El Bronce, ≥ 95 en el 7,9 %. Las seis identidades se solapaban.
 *
 * LA SOLUCIÓN, en la dimensión del sistema (clase de sobre), sin techos de OVR — toda carta de una clase permitida sigue
 * pudiendo salir:
 *
 *   1. RANURAS. Cada sobre tiene `cards − 1` huecos NORMALES (tabla `regular`) y UNA RANURA DESTACADA, el último hueco
 *      (tabla `featured`). En los sobres bajos las clases de jackpot (Champions, Prime, Icon) solo viven en la destacada:
 *      un sobre puede tener UN gran golpe, pero no varios a la vez por pura independencia. Es el «presupuesto de calidad»
 *      hecho estructura: exacto, auditable y sin correlaciones ocultas (los huecos siguen siendo independientes).
 *   2. INCLINACIÓN POR OVR dentro de la clase (`ovrTilt` = λ). Peso de una carta = e^(−λ·(OVR − 70)) dentro de su clase
 *      (× el peso del pool persistido, si lo hay). λ = 0 es el sorteo uniforme de siempre (Champions, Icon). En Bronce
 *      (λ 0,30) un 95 de su clase es ~ 15 veces menos probable que un 86 de la misma clase; sigue siendo posible: jackpot.
 *
 * Las tablas van en POR MIL (enteros: cada una suma exactamente 1000). La identidad estadística que resulta (mejor carta,
 * P(≥ 90), P(≥ 95), valor por crédito estrictamente creciente de Bronce a Icon) la fija `tierIdentity.test.ts` con el
 * cálculo EXACTO de `./tierIdentity` (no una simulación) y una simulación determinista del motor real.
 */
export type ClassTable = Readonly<Record<PackCardClass, number>>;

export interface MainPackPlan {
  /** Cartas del sobre (= `PackDef.cardCount`; lo comprueba un test). */
  cards: number;
  /** Huecos normales (`cards − 1`), POR MIL. */
  regular: ClassTable;
  /** La ranura destacada (el último hueco), POR MIL. */
  featured: ClassTable;
  /** λ de la inclinación por OVR dentro de cada clase (≥ 0; 0 = uniforme). */
  ovrTilt: number;
}

const tbl = (o: Partial<Record<PackCardClass, number>>): ClassTable => ({ base: 0, plata: 0, oro: 0, masters: 0, champions: 0, prime: 0, icon: 0, ...o });

/** EL PLAN. Clave = `PackDef.id` persistido (`estandar` = Bronce, `premium` = Plata). */
export const MAIN_PACK_PLAN: Readonly<Record<string, MainPackPlan>> = {
  estandar: { cards: 5, ovrTilt: 0.3, regular: tbl({ base: 720, plata: 250, oro: 30 }),
    featured: tbl({ base: 250, plata: 400, oro: 200, masters: 100, champions: 30, prime: 15, icon: 5 }) },
  premium: { cards: 6, ovrTilt: 0.22, regular: tbl({ plata: 820, oro: 150, masters: 30 }),
    featured: tbl({ plata: 150, oro: 395, masters: 290, champions: 100, prime: 50, icon: 15 }) },
  oro: { cards: 5, ovrTilt: 0.12, regular: tbl({ oro: 700, masters: 270, champions: 30 }),
    featured: tbl({ oro: 200, masters: 350, champions: 220, prime: 150, icon: 80 }) },
  masters: { cards: 5, ovrTilt: 0.03, regular: tbl({ oro: 350, masters: 520, champions: 130 }),
    featured: tbl({ masters: 300, champions: 290, prime: 260, icon: 150 }) },
  champions: { cards: 5, ovrTilt: 0, regular: tbl({ oro: 200, masters: 330, champions: 400, prime: 70 }),
    featured: tbl({ champions: 300, prime: 420, icon: 280 }) },
  icon: { cards: 3, ovrTilt: 0, regular: tbl({ prime: 720, icon: 280 }),
    featured: tbl({ prime: 500, icon: 500 }) },
};

/*
 * ═══════════════════════ PACK OPENING 3.1 · SOBRES ESPECIALES (2026-10-07) ═══════════════════════
 *
 * Regionales, de equipo y EWC sorteaban con los PESOS POR RAREZA heredados (rara 18 % · épica 6 % · legendaria 1 % por
 * carta). En el catálogo diseñado esas rarezas SON Prime (Future Star, valor ×18), Champions S (×10) e Icon (×25): un 19 %
 * de Prime/Icon por hueco frente al 1,1 % de un Plata. Medido (motor real + pools de producción, 200.000 aperturas):
 * 5,0–5,7 de valor por crédito frente a 0,50–0,83 de la línea; desguace del 30–34 % del precio; Pacific (2 Prime y 1
 * Icon en su pool, uno de 95) daba una carta ≥ 95 en el 46 % de los sobres.
 *
 * Ahora usan EL MISMO MOTOR que la línea (este plan por ranuras + inclinación), con su POOL de siempre: región, equipo
 * (sesgo ×5 de sus cartas, pool `boost-team-*` de la BD) y catálogo completo en EWC. Su ventaja es el TARGETING, no el
 * valor: por eso rinden por crédito algo menos que Bronce (0,50) — 0,43–0,48 regionales y de equipo — y EWC, sin
 * targeting pero con su Champions S garantizada en la carta destacada, por debajo de Plata (0,54 < 0,56).
 *
 * Un plan por REGIÓN (sus pools difieren: Americas es el más rico) y cada sobre de equipo usa el de su región: el sesgo
 * de su equipo mueve su valor como mucho un ±7 % (lo fija `tierIdentity.test.ts`). China (9.500) y EWC (8.500) suben de precio:
 * China solo tiene Masters y Champions —cualquier carta vale lo de un Masters— y EWC garantiza una Champions S.
 * La compuerta económica (`./economyGate`) impide vender un sobre especial fuera de estos límites.
 */
const EMEA_PLAN: MainPackPlan = { cards: 5, ovrTilt: 0.32, regular: tbl({ base: 610, plata: 300, oro: 82, masters: 8 }),
  featured: tbl({ plata: 310, oro: 375, masters: 265, champions: 36, prime: 11, icon: 3 }) };
const AMERICAS_PLAN: MainPackPlan = { cards: 5, ovrTilt: 0.36, regular: tbl({ base: 620, plata: 300, oro: 75, masters: 5 }),
  featured: tbl({ plata: 320, oro: 380, masters: 260, champions: 28, prime: 9, icon: 3 }) };
const PACIFIC_PLAN: MainPackPlan = { cards: 5, ovrTilt: 0.3, regular: tbl({ base: 600, plata: 300, oro: 90, masters: 10 }),
  featured: tbl({ plata: 300, oro: 370, masters: 270, champions: 40, prime: 15, icon: 5 }) };
/** China: su pool solo tiene Masters L/SDC y Champions S. */
const CHINA_PLAN: MainPackPlan = { cards: 5, ovrTilt: 0.3, regular: tbl({ masters: 1000 }), featured: tbl({ masters: 940, champions: 60 }) };
/** EWC: catálogo completo; la carta destacada es Champions S o Icon («épica garantizada» de siempre). */
const EWC_PLAN: MainPackPlan = { cards: 5, ovrTilt: 0.3, regular: tbl({ base: 100, plata: 580, oro: 280, masters: 40 }),
  featured: tbl({ champions: 990, icon: 10 }) };

/** EL PLAN DE LOS ESPECIALES. Clave = `PackDef.id`. Cada sobre de equipo, el plan de su región (lo comprueba un test). */
export const SPECIAL_PACK_PLAN: Readonly<Record<string, MainPackPlan>> = {
  ewc: EWC_PLAN,
  emea: EMEA_PLAN, americas: AMERICAS_PLAN, pacific: PACIFIC_PLAN, china: CHINA_PLAN,
  "team-heretics": EMEA_PLAN, "team-fnatic": EMEA_PLAN, "team-navi": EMEA_PLAN, "team-liquid": EMEA_PLAN, "team-karmine": EMEA_PLAN, "team-m8": EMEA_PLAN, "team-fut": EMEA_PLAN,
  "team-g2": AMERICAS_PLAN, "team-loud": AMERICAS_PLAN, "team-100t": AMERICAS_PLAN, "team-lev": AMERICAS_PLAN,
  "team-prx": PACIFIC_PLAN, "team-ns": PACIFIC_PLAN, "team-ge": PACIFIC_PLAN,
  "team-blg": CHINA_PLAN, "team-te": CHINA_PLAN, "team-jdg": CHINA_PLAN, "team-tyl": CHINA_PLAN, "team-xlg": CHINA_PLAN,
};

/** Todos los planes (línea principal + especiales): lo que lee el motor. */
export const PACK_PLANS: Readonly<Record<string, MainPackPlan>> = { ...MAIN_PACK_PLAN, ...SPECIAL_PACK_PLAN };

/** Promedio EXACTO por carta de un plan, en porcentaje: ((cards − 1) · regular + featured) / cards / 10. */
export function averageDistribution(plan: MainPackPlan): ClassDistribution {
  const n = plan.cards;
  return Object.fromEntries(PACK_CLASS_ORDER.map((c) => [c, ((n - 1) * plan.regular[c] + plan.featured[c]) / n / 10])) as ClassDistribution;
}

/** Peso de la inclinación por OVR (relativo dentro de la clase; e^0 = 1 en OVR 70). */
export function ovrTiltWeight(tilt: number, ovr: number): number {
  return tilt > 0 && Number.isFinite(ovr) ? Math.exp(-tilt * (ovr - 70)) : 1;
}

/**
 * DERIVADA, no se edita: probabilidad media de cada clase POR CARTA (porcentaje) de cada sobre. La leen el valor
 * esperado, la Forja, el panel y la ficha («por carta»). La única fuente es `MAIN_PACK_PLAN`.
 *
 * Prime e Icon crecen estrictamente en cada escalón (por carta): ningún sobre inferior da más Prime o más Icon.
 */
export const MAIN_PACK_DISTRIBUTION: Readonly<Record<string, ClassDistribution>> = Object.fromEntries(
  Object.entries(MAIN_PACK_PLAN).map(([id, plan]) => [id, averageDistribution(plan)]),
);

/** La línea, de menor a mayor. */
export const MAIN_PACK_LINE: readonly string[] = ["estandar", "premium", "oro", "masters", "champions", "icon"];

/**
 * F60 · Un sobre del panel (`cms-…`) usa la tabla de su PLANTILLA: no hay economía nueva. El registro de sobres vivos
 * rellena este alias al cargar `content_packs`; los sobres de código no pasan nunca por aquí.
 */
const TEMPLATE_ALIAS = new Map<string, string>();
export function setPackClassAliases(pairs: readonly (readonly [string, string])[]): void {
  TEMPLATE_ALIAS.clear();
  for (const [id, template] of pairs) if (id.startsWith("cms-")) TEMPLATE_ALIAS.set(id, template);
}

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const planKey = (packId: string): string | null => {
  const key = has(MAIN_PACK_PLAN, packId) ? packId : TEMPLATE_ALIAS.get(packId);
  return key !== undefined && has(MAIN_PACK_PLAN, key) ? key : null;
};

/**
 * Pack Opening 3.1 · el plan de CUALQUIER sobre que lo tenga (línea principal o especial), o `null` si sortea con sus
 * pesos por rareza de siempre (Sobre Inicial, Prime retirado y productos de recompensa). Es lo que usa el motor.
 */
export function packPlan(packId: string): MainPackPlan | null {
  const key = planTemplate(packId);
  return key ? PACK_PLANS[key] : null;
}

/** El id del plan que usa un sobre: el suyo, o el de su PLANTILLA si es un sobre del panel (`cms-…`). `null` si no tiene. */
export function planTemplate(packId: string): string | null {
  if (has(PACK_PLANS, packId)) return packId;
  const t = TEMPLATE_ALIAS.get(packId);
  return t !== undefined && has(PACK_PLANS, t) ? t : null;
}

/** Media exacta por carta (porcentaje) de cualquier sobre con plan; `null` si no tiene. */
export function packDistribution(packId: string): ClassDistribution | null {
  const plan = packPlan(packId);
  return plan ? (mainPackDistribution(packId) ?? averageDistribution(plan)) : null;
}

/**
 * Garantía de la carta destacada: si su tabla solo contiene clases desde Champions hacia arriba, el sobre la GARANTIZA
 * en esa carta (EWC: «Champions o Icon garantizada en la carta destacada»). `null` si no hay nada que garantizar con verdad.
 */
export function featuredGuarantee(plan: MainPackPlan): { classes: PackCardClass[]; label: string } | null {
  const active = PACK_CLASS_ORDER.filter((c) => plan.featured[c] > 0);
  if (active.length === 0 || active.some((c) => PACK_CLASS_ORDER.indexOf(c) < PACK_CLASS_ORDER.indexOf("champions"))) return null;
  return { classes: active, label: `${active.map((c) => PACK_CLASS_LABEL[c]).join(" o ")} garantizada en la carta destacada` };
}

/** Plan por ranuras del sobre (Pack Opening 3.0), o `null` si el sobre sigue con sus reglas de siempre (pesos por rareza). */
export function mainPackPlan(packId: string): MainPackPlan | null {
  const key = planKey(packId);
  return key ? MAIN_PACK_PLAN[key] : null;
}

/** Distribución media POR CARTA (porcentaje, derivada del plan), o `null` si el sobre no es de la línea principal. */
export function mainPackDistribution(packId: string): ClassDistribution | null {
  const key = planKey(packId);
  return key ? MAIN_PACK_DISTRIBUTION[key] : null;
}

/** Cómo decide un sobre sus cartas. Explícito para que ningún producto tenga dos filtros a la vez. */
export type PackDrawMode = "class-distribution" | "rarity-weights";

export function packDrawMode(packId: string): PackDrawMode {
  return packPlan(packId) ? "class-distribution" : "rarity-weights";
}

/** Clases con probabilidad > 0 del sobre, en orden de escalera. */
export function activeClasses(dist: ClassDistribution): PackCardClass[] {
  return PACK_CLASS_ORDER.filter((c) => dist[c] > 0);
}

/**
 * Qué garantiza el sobre por construcción: la clase más baja con probabilidad > 0 marca el suelo, y solo se comunica
 * cuando NO es la base de la escalera (Bronce puede dar Base: no garantiza nada). Icon → «Prime o Icon».
 * Devuelve `null` si no hay nada que garantizar con verdad.
 */
export function classGuarantee(dist: ClassDistribution): { classes: PackCardClass[]; label: string } | null {
  const active = activeClasses(dist);
  if (active.length === 0 || active.length > 2) return null;
  return { classes: active, label: `${active.map((c) => PACK_CLASS_LABEL[c]).join(" o ")} garantizada` };
}

/** Color de cada clase (presentación). Base/Plata/Oro de metal; el resto, de su edición. */
export const PACK_CLASS_COLOR: Readonly<Record<PackCardClass, string>> = {
  base: "#8b96a3", plata: "#cfd6de", oro: "#ffce4f", masters: "#ff8a3d", champions: "#b06bff", prime: "#3aa6ff", icon: "#f5f0e6",
};

/** Un cubo contractual (probabilidad > 0) sin cartas: la apertura se aborta, nunca cae a otro cubo ni al catálogo. */
export class EmptyPackClassError extends Error {
  constructor(readonly packId: string, readonly packClass: PackCardClass) {
    super(`Sobre ${packId}: la clase ${packClass} tiene probabilidad > 0 y ninguna carta elegible`);
    this.name = "EmptyPackClassError";
  }
}
