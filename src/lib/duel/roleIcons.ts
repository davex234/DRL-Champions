/**
 * DUEL GAMEPLAY UX 2.0 · ICONOS DE ROL — mapa `rol canónico → asset`.
 *
 * Los roles son los CANÓNICOS de Valorosters (`RoleId`: Duelista, Iniciador, Centinela, Controlador, Flex), los mismos
 * que lleva cada carta del catálogo (`card.role`, el rol de la carta manda). No se infieren de las estadísticas ni del
 * nombre del jugador.
 *
 * ASSETS: PENDIENTES (los entregará el usuario). Mientras un rol no tenga icono, la interfaz pinta su abreviatura
 * canónica (`ROLE_ABBR` de `lib/flags`, la misma del renderizador de cartas): nunca un icono inventado, un emoji ni una
 * imagen rota. Para activar un icono: dejar el fichero en `public/roles/<id>.svg` (o .png) y poner su ruta aquí.
 */
import type { RoleId } from "@/domain/cards/types";
import { ROLE_ABBR } from "@/lib/flags";

export const ROLE_ICON_SRC: Readonly<Record<RoleId, string | null>> = Object.freeze({
  Duelista: null,
  Iniciador: null,
  Centinela: null,
  Controlador: null,
  Flex: null,
});

export const ROLE_IDS: readonly RoleId[] = ["Duelista", "Iniciador", "Centinela", "Controlador", "Flex"];

export const isRoleId = (v: unknown): v is RoleId => typeof v === "string" && (ROLE_IDS as readonly string[]).includes(v);

/** Ruta del icono del rol, o `null` si aún no hay asset (→ abreviatura de texto). */
export const roleIconSrc = (role: RoleId): string | null => ROLE_ICON_SRC[role] ?? null;

/** Abreviatura canónica del rol (texto de respaldo). */
export const roleAbbr = (role: RoleId): string => ROLE_ABBR[role] ?? role.slice(0, 3).toUpperCase();
