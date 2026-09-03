/**
 * PRESTIGIO — EL SUMIDERO DE FIN DE JUEGO (Fase 14). Dominio PURO.
 *
 * ────────────────────────── EL PROBLEMA, MEDIDO ──────────────────────────
 *
 * Es el único de la Fase 11 que seguía abierto. La Fase 13 lo dejó escrito con todas las
 * letras: «la maestría da objetivos, **no gasta créditos**».
 *
 * La Fase 14 lo ha medido con el escenario de SATURACIÓN de `npm run economy:simulate`, que
 * apaga la compra de sobres en cuanto la colección pasa del 85 % —que es lo que hace una
 * persona cuando el sobre ya casi nunca trae algo nuevo—:
 *
 *   Perfil       Colección   Saldo acumulado   Por día
 *   Casual           62 %               274         3     ← nunca se satura
 *   Activo           57 %               758         9     ← nunca se satura
 *   Intensivo        85 %           167.582     1.995     ← AQUÍ está el problema
 *
 * Dos conclusiones que cambian el tamaño del problema:
 *
 *   1. **El endgame afecta a un solo perfil.** Casual y Activo no llegan a saturarse en una
 *      temporada: siguen comprando sobres y acaban a cero. Para ellos no falta sumidero.
 *   2. **La magnitud es de unos 2.000 créditos al día.** Ese es el caudal que un sumidero
 *      de fin de juego tiene que ser capaz de absorber. Ni más ni menos.
 *
 * ────────────────────────── LA DECISIÓN ──────────────────────────
 *
 * **El prestigio se compra con créditos y es puramente visual.**
 *
 * Un jugador que ha completado un equipo se ha ganado su insignia (Fase 13, gratis). El
 * prestigio es MEJORARLA: plata, oro, élite. No da estadísticas, ni OVR, ni puntos, ni
 * rango, ni cartas. Solo dice, en el perfil, cuánto te importó ese equipo.
 *
 * Por qué esto y no otra cosa:
 *
 *   · **Es un sumidero, no un grifo.** Saca créditos de la economía y no devuelve ninguno.
 *   · **No hay segunda moneda.** Se paga en DRL Credits, los de siempre.
 *   · **No hay pay-to-win.** Es el color de una insignia.
 *   · **No hay contenido escrito a mano.** 3 escalones × las insignias que ya deriva la
 *     maestría. Un equipo nuevo trae sus tres prestigios sin que nadie los escriba.
 *   · **Conecta colección con economía.** No se puede comprar sin haber completado antes:
 *     los créditos no sustituyen al trabajo de coleccionar, lo reconocen.
 *
 * ────────────────────────── LOS PRECIOS, Y DE DÓNDE SALEN ──────────────────────────
 *
 * De la cifra de arriba: **1.995 créditos al día** para el perfil que se satura.
 *
 *   Plata   15.000  ≈ 7,5 días de un saturado · 13 días de un Casual que ahorre
 *   Oro     40.000  ≈ 20 días
 *   Élite  100.000  ≈ 50 días
 *
 * Un solo equipo llevado a élite cuesta **155.000**, casi exactamente lo que un Intensivo
 * acumula en una temporada entera sin gastar (167.582). Es deliberado: **completar el
 * prestigio de UN equipo es el objetivo de una temporada**, no de una tarde.
 *
 * Y la capacidad total es enorme a propósito. Un jugador al 85 % tiene decenas de conjuntos
 * completos; a 155.000 cada uno, el sumidero no se agota nunca. Lo que se agota es el
 * tiempo, y por eso **elegir qué equipo llevar a élite es la decisión**, que es justo lo que
 * convierte un sumidero en identidad.
 *
 * ────────────────────────── LO QUE NO SE HA HECHO ──────────────────────────
 *
 * No se ha bajado ninguna recompensa para «cerrar el grifo». La Fase 12 midió que el grifo
 * está calibrado y la Fase 13 no lo tocó; el problema no era que entrara demasiado, sino que
 * no salía nada. Se arregla el lado que estaba roto.
 */
import { masterySets, type MasterySet } from "./mastery";

export interface PrestigeTier {
  id: string;
  label: string;
  /** Precio en DRL Credits. Justificado arriba contra la simulación de saturación. */
  price: number;
  /** Color del escalón. Sustituye al del eje cuando la insignia está mejorada. */
  color: string;
  /** Orden: hay que comprarlos en secuencia. */
  rank: number;
}

/**
 * Tres escalones y no cinco. Con cinco, cada uno valdría poco y la decisión se diluiría;
 * con tres, elegir a qué equipo dedicar 155.000 créditos es una decisión de verdad.
 */
export const PRESTIGE_TIERS: PrestigeTier[] = [
  { id: "plata", label: "Plata", price: 15_000, color: "#c8d2dc", rank: 1 },
  { id: "oro", label: "Oro", price: 40_000, color: "#ffce4f", rank: 2 },
  { id: "elite", label: "Élite", price: 100_000, color: "#ff2e63", rank: 3 },
];

export const PRESTIGE_TOTAL = PRESTIGE_TIERS.reduce((n, t) => n + t.price, 0);

export const prestigeTier = (id: string): PrestigeTier | null =>
  PRESTIGE_TIERS.find((t) => t.id === id) ?? null;

/**
 * El id de una insignia mejorada: la base más el escalón.
 *
 * `insignia:equipo:100t` → `insignia:equipo:100t:oro`
 *
 * El prefijo de familia no cambia, así que `app_equip_cosmetic` la valida sin tocar nada y
 * `domain/cosmetics/catalog` la pinta reconociendo el sufijo. Es la misma decisión de la
 * Fase 13 —derivar en vez de escribir— llevada un escalón más.
 */
export const prestigeId = (baseId: string, tierId: string): string => `${baseId}:${tierId}`;

/** Descompone un id mejorado. `null` si no lo está. */
export function parsePrestige(cosmeticId: string): { baseId: string; tier: PrestigeTier } | null {
  const idx = cosmeticId.lastIndexOf(":");
  if (idx <= 0) return null;
  const tier = prestigeTier(cosmeticId.slice(idx + 1));
  return tier ? { baseId: cosmeticId.slice(0, idx), tier } : null;
}

/**
 * La insignia de PLENO de un conjunto: la única que se puede prestigiar.
 *
 * Las de «a medias» no. Prestigiar un conjunto a medio hacer sería premiar con dinero lo que
 * la maestría premia con trabajo, y rompería la regla de que los créditos no sustituyen a
 * coleccionar.
 */
export function fullBadgeOf(set: MasterySet): string | null {
  const full = set.tiers.find((t) => t.at === 1);
  const ids = full?.reward.cosmetics ?? [];
  return ids.find((id) => id.startsWith("insignia:")) ?? null;
}

export interface PrestigeOffer {
  setId: string;
  /** Nombre del conjunto, para la vitrina. */
  label: string;
  baseId: string;
  tier: PrestigeTier;
  /** El escalón anterior, que hay que tener antes. `null` para el primero. */
  requires: string;
}

/**
 * Qué puede comprar este jugador, ahora mismo.
 *
 * Las tres puertas, y las tres son de datos:
 *
 *   1. Tiene la insignia de PLENO del conjunto (se la ganó coleccionando).
 *   2. No tiene ya ese escalón.
 *   3. Tiene el escalón anterior. Se compran en orden.
 *
 * Se devuelve **un solo escalón por conjunto** —el siguiente—: ofrecer los tres a la vez
 * convertiría una lista de 66 conjuntos en una de 198 filas donde 132 están bloqueadas.
 */
export function prestigeOffers(owned: Set<string>): PrestigeOffer[] {
  const out: PrestigeOffer[] = [];
  for (const set of masterySets()) {
    const baseId = fullBadgeOf(set);
    if (!baseId || !owned.has(baseId)) continue;

    let requires = baseId;
    for (const tier of PRESTIGE_TIERS) {
      const id = prestigeId(baseId, tier.id);
      if (owned.has(id)) { requires = id; continue; }
      out.push({ setId: set.id, label: set.label, baseId, tier, requires });
      break;
    }
  }
  return out;
}

/** El escalón más alto que este jugador tiene de una insignia. `null` si solo la base. */
export function highestTierOf(baseId: string, owned: Set<string>): PrestigeTier | null {
  let best: PrestigeTier | null = null;
  for (const t of PRESTIGE_TIERS) if (owned.has(prestigeId(baseId, t.id))) best = t;
  return best;
}

/**
 * Cuánto ha quemado este jugador en prestigio. Es la cifra que dice si el sumidero
 * funciona, y la que `economy:verify` puede contrastar contra el libro mayor.
 */
export function burnedOn(owned: Set<string>): number {
  let total = 0;
  for (const id of owned) {
    const p = parsePrestige(id);
    if (p) total += p.tier.price;
  }
  return total;
}

/** Clave de idempotencia. Un escalón de un conjunto se compra una vez y solo una. */
export const prestigeRef = (baseId: string, tierId: string): string =>
  `prestige:${baseId}:${tierId}`;
