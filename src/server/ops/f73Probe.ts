/**
 * F73 · ¿ESTÁ APLICADA 0059 EN ESTA BASE DE DATOS? — por ESTADO REAL, no por la constante del código.
 *
 * La sonda de esquema de 0057 (`app_admin_schema_probe`) no conoce 0059, y `MIGRATION_HEAD` es solo lo que dice el
 * código: sin esto, crear 0059 en el repo pintaría «cabeza 0059» aunque no se hubiera aplicado (la lección de F59.1).
 * Se leen dos de sus tablas con service_role: `true` = existen · `false` = no existen · `null` = no se pudo leer.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingRelation } from "@/server/services/f73Config";

/** F79.1 · ¿está aplicada 0061? Por estado real: existe `forge_config` (solo la lee service_role). */
export async function forge0061Applied(sb: SupabaseClient): Promise<boolean | null> {
  const { error } = await sb.from("forge_config").select("id", { count: "exact", head: true });
  if (!error) return true;
  return isMissingRelation(error) ? false : null;
}

/** F82 · ¿está aplicada 0062? Por estado real: existe `collection_sets` (solo la lee service_role). */
export async function collections0062Applied(sb: SupabaseClient): Promise<boolean | null> {
  const { error } = await sb.from("collection_sets").select("id", { count: "exact", head: true });
  if (!error) return true;
  return isMissingRelation(error) ? false : null;
}

/** F89 · ¿está aplicada 0063? Por estado real: existe la columna `favorite_team_id` (solo la lee service_role). */
export async function favoriteTeam0063Applied(sb: SupabaseClient): Promise<boolean | null> {
  const { error } = await sb.from("player_profile_customization").select("favorite_team_id", { count: "exact", head: true });
  if (!error) return true;
  const e = error as { code?: string; message?: string };
  return e.code === "42703" || e.code === "PGRST204" || /column .*favorite_team_id.* does not exist|could not find/i.test(e.message ?? "") || isMissingRelation(error) ? false : null;
}

/** F85 · ¿está aplicada 0066? Por estado real: existe `social_blocks` (la lee service_role). */
export async function social0066Applied(sb: SupabaseClient): Promise<boolean | null> {
  const { error } = await sb.from("social_blocks").select("blocker_id", { count: "exact", head: true });
  if (!error) return true;
  return isMissingRelation(error) ? false : null;
}

/**
 * 0067 · ¿está aplicada 0067? Por estado real: existe `app_admin_set_admin`. Se llama con actor NULO: la RPC responde
 * NOT_ADMIN antes de leer ni escribir nada (sin efectos); si no existe, PostgREST dice «función no encontrada».
 */
export async function admin0067Applied(sb: SupabaseClient): Promise<boolean | null> {
  const { error } = await sb.rpc("app_admin_set_admin", { p_actor: null, p_target: null, p_grant: true, p_reason: null });
  if (!error) return null; // nunca debería aceptar un actor nulo: lectura no fiable
  const e = error as { code?: string; message?: string };
  if (/NOT_ADMIN/.test(e.message ?? "")) return true;
  return e.code === "PGRST202" || /could not find the function|does not exist/i.test(e.message ?? "") ? false : null;
}

/** 0068 · ¿está aplicada 0068? Por estado real: existen `profiles.public_tag` y `account_tag_registry` (service_role). */
export async function accountTag0068Applied(sb: SupabaseClient): Promise<boolean | null> {
  const [a, b] = await Promise.all([
    sb.from("profiles").select("public_tag", { count: "exact", head: true }),
    sb.from("account_tag_registry").select("tag", { count: "exact", head: true }),
  ]);
  const err = a.error ?? b.error;
  if (!err) return true;
  const e = err as { code?: string; message?: string };
  return e.code === "42703" || e.code === "PGRST204" || /column .*public_tag.* does not exist|could not find/i.test(e.message ?? "") || isMissingRelation(err) ? false : null;
}

/** F86 · ¿está aplicada 0069? Por estado real: existen `cups`, `cup_registrations` y `cup_matches` (service_role). */
export async function cups0069Applied(sb: SupabaseClient): Promise<boolean | null> {
  const [a, b, c] = await Promise.all([
    sb.from("cups").select("id", { count: "exact", head: true }),
    sb.from("cup_registrations").select("cup_id", { count: "exact", head: true }),
    sb.from("cup_matches").select("id", { count: "exact", head: true }),
  ]);
  const err = a.error ?? b.error ?? c.error;
  if (!err) return true;
  return isMissingRelation(err) ? false : null;
}

/** F86.2 · ¿está aplicada 0070? Por estado real: existe `alpha_feedback` (service_role). */
export async function alpha0070Applied(sb: SupabaseClient): Promise<boolean | null> {
  const { error } = await sb.from("alpha_feedback").select("id", { count: "exact", head: true });
  if (!error) return true;
  return isMissingRelation(error) ? false : null;
}

/** F87 · ¿está aplicada 0071? Por estado real: existen `pickem_brackets` y `pickem_bracket_picks` (service_role). */
export async function pickems0071Applied(sb: SupabaseClient): Promise<boolean | null> {
  const [a, b] = await Promise.all([
    sb.from("pickem_brackets").select("id", { count: "exact", head: true }),
    sb.from("pickem_bracket_picks").select("match_id", { count: "exact", head: true }),
  ]);
  const err = a.error ?? b.error;
  if (!err) return true;
  return isMissingRelation(err) ? false : null;
}

/** F87.1 · ¿está aplicada 0072? Por estado real: existe `pickem_events.legacy_mode` (service_role). */
export async function cutover0072Applied(sb: SupabaseClient): Promise<boolean | null> {
  const { error } = await sb.from("pickem_events").select("legacy_mode", { count: "exact", head: true });
  if (!error) return true;
  const e = error as { code?: string; message?: string };
  return e.code === "42703" || e.code === "PGRST204" || /legacy_mode/i.test(e.message ?? "") || isMissingRelation(error) ? false : null;
}

/**
 * F87.2 · ¿está aplicada 0073? Por estado real: existe `app_pickem_reward_eligibility`. Se llama con ids nulos de
 * ceros: solo LEE (devuelve «sin política»); si no existe, PostgREST dice «función no encontrada».
 */
export async function guard0073Applied(sb: SupabaseClient): Promise<boolean | null> {
  const zero = "00000000-0000-0000-0000-000000000000";
  const { error } = await sb.rpc("app_pickem_reward_eligibility", { p_user: zero, p_bracket: zero });
  if (!error) return true;
  const e = error as { code?: string; message?: string };
  return e.code === "PGRST202" || /could not find the function|does not exist/i.test(e.message ?? "") ? false : null;
}

/** F84 · ¿está aplicada 0065? Por estado real: existen `competitive_seasons` y la vista `competitive_ladder` (service_role). */
export async function ranked0065Applied(sb: SupabaseClient): Promise<boolean | null> {
  const [a, b] = await Promise.all([
    sb.from("competitive_seasons").select("id", { count: "exact", head: true }),
    sb.from("competitive_ladder").select("user_id", { count: "exact", head: true }),
  ]);
  const err = a.error ?? b.error;
  if (!err) return true;
  return isMissingRelation(err) ? false : null;
}

/** F83 · ¿está aplicada 0064? Por estado real: existe `game_seasons` (la lee service_role). */
export async function seasonTrack0064Applied(sb: SupabaseClient): Promise<boolean | null> {
  const { error } = await sb.from("game_seasons").select("id", { count: "exact", head: true });
  if (!error) return true;
  return isMissingRelation(error) ? false : null;
}

export async function crafting0059Applied(sb: SupabaseClient): Promise<boolean | null> {
  const [a, b] = await Promise.all([
    sb.from("craft_recipes").select("id", { count: "exact", head: true }),
    sb.from("mission_events").select("user_id", { count: "exact", head: true }),
  ]);
  const err = a.error ?? b.error;
  if (!err) return true;
  return isMissingRelation(err) ? false : null;
}
