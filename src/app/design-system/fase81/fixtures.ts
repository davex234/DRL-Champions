/**
 * F81 · fixtures del arnés `/design-system/fase81`: cartas REALES del catálogo (copias, nunca se registran en `CARDS`)
 * y uids fijos por escena, para que el desempate de la hero sea reproducible.
 */
import { CARDS } from "@/data/catalog";
import { packCardClass, type PackCardClass } from "@/domain/packs/packClass";
import type { CardDef } from "@/domain/cards/types";
import type { OpenedResult } from "@/store/useGameStore";

export type F81Scene = "normal" | "high" | "tie2" | "tieall" | "dup" | "single" | "invalid" | "plata-ref" | "team-g2"
  // WALKOUT 0.5 · aperturas con cartas especiales REALES (identidad = la de la carta: país, equipo, rol, edición, OVR)
  | "w-tr" | "w-jp" | "w-us" | "w-kr" | "w-mega" | "w-dup" | "w-std" | "w-ph" | "w-icon" | "w-icon3"
  // APERTURA 2026-10-15 · la sala por rareza: hero de cada clase y un sobre con TODAS las clases (cada revelado, su color)
  | "r-masters" | "r-icon" | "r-gold" | "r-mixed" | "r-same" | "r-big";

/** WALKOUT 0.5 · escenas del walkout en la apertura real (los ids existen en el catálogo; si no, la escena falla en el test). */
export const WALKOUT_SCENES: Readonly<Record<Extract<F81Scene, `w-${string}`>, { packId: string; ids: readonly string[]; note: string }>> = {
  "w-tr": { packId: "oro", ids: ["lar0k__future-star", "sato__base", "leaf__base", "aspas__base", "trent__base"], note: "Turquía · Future Star 95 (WALKOUT) y hero" },
  "w-jp": { packId: "oro", ids: ["absol__future-star", "aspas__base", "sato__base", "leaf__base", "trent__base"], note: "Japón · Future Star 87 (WALKOUT) que NO es la hero (Base 90)" },
  "w-us": { packId: "masters", ids: ["reduxx__future-star", "sato__base", "trent__champions-s", "leaf__base", "aspas__base"], note: "EE. UU. · Champions S 92 (RARE, hero) + Future Star 90 (WALKOUT)" },
  "w-kr": { packId: "masters", ids: ["sato__base", "xross__future-star", "leaf__base", "aspas__base", "trent__base"], note: "Corea · Future Star 95 (WALKOUT)" },
  // Icon por sobre (2026-10-09): un sobre lleva como mucho UNA Icon y el Sobre Icon es de 1 carta, así que la cola de varios
  // walkouts se enseña con un Champions alcanzable (Prime en huecos normales, Icon en la destacada).
  "w-mega": { packId: "champions", ids: ["xross__future-star", "timotino__future-star", "buzz__champions-s", "meteor__champions-s", "marteen__record-breaker"], note: "Champions · 5 especiales: 1 MEGA (CZ) + 2 WALKOUT (KR, CA) + 2 RARE (KR)" },
  "w-dup": { packId: "champions", ids: ["s0pp__champions-s", "sato__base", "buzz__champions-s", "s0pp__champions-s", "leaf__base"], note: "Champions · 3 RARE con una repetida (TR ×2, KR)" },
  // WALKOUT 0.8 · el caso reportado en producción (PATMEN Record Breaker 92, Filipinas) seguido de una turca: cada walkout con SU país
  "w-ph": { packId: "champions", ids: ["patmen__record-breaker", "lar0k__future-star", "timotino__future-star", "s0pp__champions-s", "krostaly__champions-s"], note: "Champions · Filipinas MEGA (el caso reportado) → Turquía WALKOUT → Canadá WALKOUT (+2 RARE TR)" },
  // ICON (2026-10-09): los dos sobres ICON reales. Sobre ICON (1 carta) → un MEGA; Premium (3) → tres MEGA seguidos.
  "w-icon": { packId: "icon-single", ids: ["patmen__record-breaker"], note: "Sobre ICON · 1 carta: Filipinas MEGA" },
  "w-icon3": { packId: "icon", ids: ["patmen__record-breaker", "marteen__record-breaker", "mada__moments"], note: "Sobre ICON Premium · 3 MEGA seguidos (PH, CZ, CA)" },
  "w-std": { packId: "estandar", ids: ["sato__base", "leaf__base", "aspas__base", "trent__base", "suygetsu__base"], note: "Sin especiales: la apertura de siempre (control)" },
};

const byOvr = [...CARDS].sort((a, b) => a.ovr - b.ovr || a.id.localeCompare(b.id));
const distinct = (from: number, k: number): CardDef[] => {
  const out: CardDef[] = [];
  for (const c of byOvr) if (c.ovr >= from && !out.some((o) => o.ovr === c.ovr)) { out.push(c); if (out.length === k) break; }
  return out;
};
const tieGroup = (min: number): CardDef[] => {
  const by = new Map<number, CardDef[]>();
  for (const c of byOvr) by.set(c.ovr, [...(by.get(c.ovr) ?? []), c]);
  return [...by.entries()].filter(([, v]) => v.length >= min).sort((a, b) => b[0] - a[0])[0][1];
};

/** La carta de mayor OVR de una clase (empate: id), con un techo opcional. Cartas REALES del catálogo. */
const topOf = (cls: PackCardClass, maxOvr = 99, skip: readonly string[] = []): CardDef => {
  const c = [...byOvr].reverse().find((x) => packCardClass(x) === cls && x.ovr <= maxOvr && !skip.includes(x.id));
  if (!c) throw new Error(`sin carta de clase ${cls} ≤ ${maxOvr}`);
  return c;
};

export function f81Scene(scene: F81Scene): { packId: string; cards: CardDef[] } {
  switch (scene) {
    case "normal": return { packId: "estandar", cards: (() => { const d = distinct(70, 5); return [d[1], d[3], d[0], d[4], d[2]]; })() };
    case "high": return { packId: "champions", cards: byOvr.slice(-5).reverse().slice(0, 5).sort((a, b) => a.id.localeCompare(b.id)) };
    case "tie2": { const t = tieGroup(2); const low = byOvr.filter((c) => c.ovr < t[0].ovr).slice(-3); return { packId: "oro", cards: [low[0], t[0], low[1], t[1], low[2]] }; }
    case "tieall": return { packId: "masters", cards: tieGroup(5).slice(0, 5) };
    case "dup": { const d = distinct(78, 5); return { packId: "premium", cards: [d[0], d[2], d[4], d[2], d[1], d[3]] }; }
    case "single": return { packId: "icon", cards: [byOvr[byOvr.length - 1]] };
    // Corrupción realista: un `cardId` persistido que el catálogo vivo no conoce (no se inventa su cara ni su OVR).
    case "invalid": { const d = distinct(75, 3); return { packId: "estandar", cards: [d[0], { ...d[1], id: "f81-qa__carta-inexistente" }, d[2]] }; }
    // Pack Opening 3.0 · el Sobre Plata real del 2026-10-07 (mismas 6 cartas, solo para ver el resultado: no es un sorteo).
    // Pack Opening 3.1 · un sobre de EQUIPO (G2): 5 cartas reales de su pool (Americas), dos de ellas de G2.
    case "team-g2": return { packId: "team-g2", cards: ["leaf__base", "trent__base", "valyn__base", "jawgemo__masters-l", "zekken__base"].map((id) => CARDS.find((c) => c.id === id) ?? CARDS.find((c) => c.id.startsWith(id.split("__")[0] + "__"))!).filter(Boolean) };
    case "w-tr": case "w-jp": case "w-us": case "w-kr": case "w-mega": case "w-dup": case "w-std": case "w-ph": case "w-icon": case "w-icon3": {
      const w = WALKOUT_SCENES[scene];
      return { packId: w.packId, cards: w.ids.map((id) => { const c = CARDS.find((x) => x.id === id); if (!c) throw new Error(`escena ${scene}: ${id} no está en el catálogo`); return c; }) };
    }
    // Hero Masters (lila) sobre cartas Base de OVR menor.
    case "r-masters": { const m = topOf("masters"); return { packId: "masters", cards: [topOf("base", m.ovr - 1), m, topOf("base", m.ovr - 3, [topOf("base", m.ovr - 1).id])] }; }
    // Hero ICON (marfil) en un sobre de 3: la Icon manda.
    case "r-icon": { const i = topOf("icon"); return { packId: "icon", cards: [topOf("oro", i.ovr - 1), i, topOf("plata")] }; }
    // Hero Oro (dorado) con Plata y Base detrás.
    case "r-gold": return { packId: "oro", cards: [topOf("plata"), topOf("oro"), topOf("base")] };
    // Las siete clases en un sobre: la hero y cada carta del resto con SU sala, en el orden de presentación (OVR desc).
    case "r-mixed": return { packId: "champions", cards: [topOf("base"), topOf("icon"), topOf("plata"), topOf("masters"), topOf("prime"), topOf("oro"), topOf("champions")] };
    // Dos cartas seguidas de la misma clase: la sala no parpadea entre ellas.
    case "r-same": { const a = topOf("plata"); return { packId: "premium", cards: [topOf("oro"), a, topOf("plata", 99, [a.id])] }; }
    // Estrés: 10 cartas (más que cualquier sobre real, que llega a 6), de todas las clases.
    case "r-big": {
      const picked: CardDef[] = [];
      for (const cls of ["base", "plata", "oro", "masters", "champions", "prime", "icon", "base", "plata", "masters"] as const) picked.push(topOf(cls, 99, picked.map((c) => c.id)));
      return { packId: "champions", cards: picked };
    }
    case "plata-ref": return { packId: "premium", cards: ["munchkin__masters-sdc", "sato__base", "jemkin__base", "xross__future-star", "brawk__base", "aspas__base"].map((id) => CARDS.find((c) => c.id === id)!) };
  }
}

export function f81Results(scene: F81Scene): OpenedResult[] {
  return f81Scene(scene).cards.map((card, i) => ({ uid: `f81-qa-${scene}-${i}`, card, isNew: true, value: 0, mintedVersion: 1 }));
}

export const F81_SCENES: F81Scene[] = ["normal", "high", "tie2", "tieall", "dup", "single", "invalid", "plata-ref", "team-g2", "w-tr", "w-jp", "w-us", "w-kr", "w-mega", "w-dup", "w-std", "w-ph", "w-icon", "w-icon3", "r-masters", "r-icon", "r-gold", "r-mixed", "r-same", "r-big"];
