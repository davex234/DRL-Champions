/**
 * ROLES & COMPOSICIÓN — taxonomía de la plantilla ideal (Career Fase 4/7).
 *
 * Un equipo competitivo cubre los 5 roles de `RoleId`. Aquí definimos la composición ideal
 * y utilidades para medir huecos de rol. PURO. No inventa roles: usa los del dominio.
 */
import type { RoleId } from "@/domain/cards/types";

export const ALL_ROLES: RoleId[] = ["Duelista", "Iniciador", "Centinela", "Controlador", "Flex"];

/** Composición IDEAL de un quinteto (uno de cada rol base; Flex cubre cualquier hueco). */
export const IDEAL_COMP: Record<RoleId, number> = {
  Duelista: 1,
  Iniciador: 1,
  Centinela: 1,
  Controlador: 1,
  Flex: 1,
};

export const ROLE_LABEL: Record<RoleId, string> = {
  Duelista: "Duelista",
  Iniciador: "Iniciador",
  Centinela: "Centinela",
  Controlador: "Controlador",
  Flex: "Flex",
};

/** Cuenta jugadores por rol en una lista. */
export function roleCounts(roles: RoleId[]): Record<RoleId, number> {
  const c: Record<RoleId, number> = { Duelista: 0, Iniciador: 0, Centinela: 0, Controlador: 0, Flex: 0 };
  for (const r of roles) c[r] = (c[r] ?? 0) + 1;
  return c;
}

/** ¿Encaja un rol candidato para cubrir un hueco de `need`? Flex encaja en cualquier hueco. */
export function roleFits(candidate: RoleId, need: RoleId): boolean {
  return candidate === need || candidate === "Flex" || need === "Flex";
}
