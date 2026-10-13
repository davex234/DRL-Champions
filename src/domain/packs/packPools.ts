/**
 * PACK OPENING 3.1 · EL POOL POR CLASE DE CUALQUIER SOBRE CON PLAN, con los pesos que usa el servidor.
 *
 * El motor (`openByClass`) elige, dentro de la clase, con peso = peso del pool persistido × inclinación por OVR. En la
 * línea principal, regionales y EWC el pool persistido es EXPLICIT con peso 1 (miembros = el pool del código); en los
 * sobres de equipo se añade el pool RULE `boost-team-*`, que pesa `TEAM_BOOST_WEIGHT` (5) las cartas de su equipo
 * IMPRESO (`isTeamPackCard`, la misma regla con la que `content-pools-boost.ts` lo crea; `teamPackCatalog.test` lo cuadra).
 * Así la ficha pública y la compuerta económica calculan EXACTAMENTE lo que el servidor sortea, sin leer la BD.
 * `tierIdentity.test.ts` lo comprueba contra la foto de la distribución de producción.
 */
import { CardRegistry } from "@/collection/registry";
import { CARDS } from "@/data/catalog";
import { getPlayer } from "@/data/catalog";
import { TEAM_BOOST_WEIGHT } from "@/data/teamPackCatalog";
import { isTeamPackCard } from "@/data/teamIdentities";
import type { CardDef } from "../cards/types";
import type { PackDef } from "./types";
import { buildPool } from "./pool";
import { packCardClass, PACK_CLASS_ORDER, type PackCardClass } from "./packClass";
import type { ClassPools } from "./tierIdentity";

export interface PackClassPools {
  pools: ClassPools;
  /** Peso del pool persistido de cada carta (1, o `TEAM_BOOST_WEIGHT` para las de su equipo en un sobre de equipo). */
  weightOf: (c: CardDef) => number;
  /** Cartas que pueden salir (las de las clases del pool). */
  size: number;
  /** Cartas de SU equipo dentro del pool (0 si no es sobre de equipo). */
  teamCards: number;
}

let REG: CardRegistry | null = null;
const CACHE = new Map<string, PackClassPools>();

export function packClassPools(pack: Pick<PackDef, "id"> & Partial<PackDef>): PackClassPools {
  const hit = CACHE.get(pack.id);
  if (hit) return hit;
  REG ??= new CardRegistry(CARDS);
  const { flat } = buildPool(REG, pack as PackDef, null);
  const pools = Object.fromEntries(PACK_CLASS_ORDER.map((c) => [c, [] as CardDef[]])) as Record<PackCardClass, CardDef[]>;
  for (const c of flat) { const k = packCardClass(c); if (k) pools[k].push(c); }
  const team = pack.team ?? null;
  const isTeam = (c: CardDef) => !!team && isTeamPackCard(c, getPlayer(c.playerId), team);
  const weightOf = team ? (c: CardDef) => (isTeam(c) ? TEAM_BOOST_WEIGHT : 1) : () => 1;
  const size = PACK_CLASS_ORDER.reduce((a, k) => a + pools[k].length, 0);
  const out = { pools, weightOf, size, teamCards: team ? flat.filter(isTeam).length : 0 };
  CACHE.set(pack.id, out);
  return out;
}
