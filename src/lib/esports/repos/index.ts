/**
 * Capa de acceso a datos (LECTURA) del sistema competitivo.
 * Lee vía RLS pública con la clave anon; devuelve tipos de dominio.
 *
 *   import { matches, standings } from "@/lib/esports/repos";
 *   const próximos = await matches.listUpcoming();
 */
export * as circuits from "./circuits";
export * as tournaments from "./tournaments";
export * as teams from "./teams";
export * as players from "./players";
export * as matches from "./matches";
export * as standings from "./standings";
export * as stats from "./stats";
