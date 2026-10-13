/**
 * COLECCIONES POR EQUIPO E INSIGNIAS REGIONALES — SERVIDOR (jugador). Solo lectura.
 *
 *   · Los equipos y sus cartas salen del catálogo PUBLICADO del servidor (`serverCatalog`: lo que el panel de
 *     administración tiene publicado en `content_cards`), agrupado por el equipo impreso. Una carta retirada ya no se
 *     puede conseguir y no se exige. Nada de esto está escrito a mano.
 *   · Lo que tiene el jugador sale del RESUMEN POR CARTA (`loadCollectionSummary`, migración 0074): una consulta cuyo
 *     tamaño lo acota el catálogo, no la colección. Aquí no se recorre el inventario ni se envía al cliente.
 *   · No escribe nada: ni compleciones, ni insignias, ni créditos. El estado es el de tu inventario en este momento.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverCatalog } from "@/server/catalog";
import {
  buildTeamCollections, teamCollectionsView, teamDetail,
  type TeamCollectionsModel, type TeamCollectionsView, type TeamDetailView,
} from "@/domain/teamCollections/model";
import { countsOf, loadCollectionSummary, ownedCardIdsOf } from "./userCards";

export type { TeamCollectionsView, TeamDetailView };

export interface TeamCollectionsResult<T> { ok: boolean; status: number; error?: string; code?: string; data?: T }
const ok = <T,>(data: T): TeamCollectionsResult<T> => ({ ok: true, status: 200, data });
const fail = (status: number, code: string, error: string): TeamCollectionsResult<never> => ({ ok: false, status, code, error });

/** Clave de equipo: la canónica (`team-heretics`) o `raw:<texto impreso>`. Cerrada para no aceptar cualquier cosa. */
export const TEAM_ID_PATTERN = /^(?:[a-z0-9][a-z0-9-]{0,47}|raw:[^\u0000-\u001f]{1,48})$/;

let warned = "";
/** El modelo vigente: equipos y cartas del catálogo publicado. Lo usan el jugador y el panel de administración. */
export async function teamCollectionsModel(sb: SupabaseClient): Promise<TeamCollectionsModel> {
  const cat = await serverCatalog(sb);
  const model = buildTeamCollections({ cards: cat.cards.filter((c) => cat.lifecycleOf(c.id) === "PUBLISHED"), player: (id) => cat.player(id) });
  // Falta de región o de equipo: se avisa una vez por cambio, no en cada petición.
  const gaps = model.unassigned.length || model.teamless.length ? JSON.stringify({ unassigned: model.unassigned.map((t) => t.id), teamless: model.teamless.length }) : "";
  if (gaps !== warned) { warned = gaps; if (gaps) console.warn("[team-collections]", gaps); }
  return model;
}

export async function getTeamCollections(sb: SupabaseClient, userId: string): Promise<TeamCollectionsResult<TeamCollectionsView>> {
  const [model, summary] = await Promise.all([teamCollectionsModel(sb), loadCollectionSummary(sb, userId)]);
  return ok(teamCollectionsView(model, ownedCardIdsOf(summary)));
}

export async function getTeamCollection(sb: SupabaseClient, userId: string, teamId: unknown): Promise<TeamCollectionsResult<TeamDetailView>> {
  if (typeof teamId !== "string" || !TEAM_ID_PATTERN.test(teamId)) return fail(400, "BAD_TEAM", "Equipo no válido");
  const [model, summary] = await Promise.all([teamCollectionsModel(sb), loadCollectionSummary(sb, userId)]);
  const team = model.teams.find((t) => t.id === teamId);
  if (!team) return fail(404, "NOT_FOUND", "Ese equipo no tiene colección");
  return ok(teamDetail(team, countsOf(summary)));
}
