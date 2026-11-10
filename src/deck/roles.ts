/**
 * COBERTURA DE ROLES (Collection Fase 3/7).
 *
 * Reutiliza los roles EXISTENTES: `RoleId` de la carta (Duelista/Iniciador/Centinela/Controlador/Flex)
 * y el `Role` del sim (entry/support/anchor/lurk/igl) vía `roleToSimRole` del Player Mapper. NUNCA
 * redefine roles. Puro y determinista.
 */
import type { RoleId } from "@/domain/cards/types";
import type { Role } from "@/sim";
import { roleToSimRole } from "@/lib/match/playerMapper";
import type { RoleCoverage } from "./types";

export const ALL_CARD_ROLES: RoleId[] = ["Duelista", "Iniciador", "Centinela", "Controlador", "Flex"];
const ALL_SIM_ROLES: Role[] = ["entry", "support", "anchor", "lurk", "igl"];

/** Cobertura de roles del quinteto: reparto por rol de carta y por rol de sim + equilibrio. */
export function roleCoverage(roles: RoleId[]): RoleCoverage {
  const byCardRole = { Duelista: 0, Iniciador: 0, Centinela: 0, Controlador: 0, Flex: 0 } as Record<RoleId, number>;
  const bySimRole = { entry: 0, support: 0, anchor: 0, lurk: 0, igl: 0 } as Record<Role, number>;
  for (const r of roles) { byCardRole[r]++; bySimRole[roleToSimRole(r)]++; }
  const missing = ALL_CARD_ROLES.filter((r) => byCardRole[r] === 0);
  const distinct = ALL_CARD_ROLES.length - missing.length;
  const maxOne = Math.max(...ALL_CARD_ROLES.map((r) => byCardRole[r]));
  // Equilibrio: quinteto completo con ≥3 roles distintos y sin que un rol acapare >3 de 5.
  const balanced = roles.length >= 5 ? distinct >= 3 && maxOne <= 3 : false;
  return { byCardRole, bySimRole, missing, balanced };
}

export { ALL_SIM_ROLES };
