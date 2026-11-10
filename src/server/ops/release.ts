/**
 * F67 · IDENTIDAD DE LA RELEASE que el código espera. Fuente única (antes vivía dentro de `server/admin/overview.ts`).
 * La usan `/admin/system`, `/api/ready` y `npm run production:check`.
 */
// F73 · 0059 (crafteo y misiones) APLICADA en producción el 2026-09-30 (autorizada). Se verifica por estado real: ops/f73Probe.
// F73 final · 0060 (desguace atómico: la última copia la impone la BD) APLICADA el 2026-09-30 (autorizada). Solo redefine
// `app_salvage_cards`: no hay tabla ni sonda REST que la delate, así que /api/ready la da por aplicada cuando existen las
// tablas de 0059 (la comprobación de su cuerpo exacto está en docs/product/qa/fase73-final/migration-audit.json).
// F79.1 · 0061 (NEXUS FORGE 2.0: `forge_config` + RPC guardadas de carta protegida + última copia desbloqueada en el
// intercambio). Se verifica por ESTADO REAL (ops/f73Probe `forge0061Applied`): sin `forge_config` la cabeza dice 0060.
// F82 · 0062 (Collection Sets: `collection_sets` + `user_collection_completions` + `app_collection_claim` + insignias
// destacadas). Por ESTADO REAL (ops/f73Probe `collections0062Applied`): sin `collection_sets` la cabeza dice 0061.
// F89 · 0063 (equipo favorito del perfil: `player_profile_customization.favorite_team_id` + RPC
// `player_profile_set_favorite_team`). Por ESTADO REAL (ops/f73Probe `favoriteTeam0063Applied`): sin la columna, 0062.
// F83 · 0064 (ruta de temporada: `game_seasons` + libro de XP + retos + reclamos + RPC). Por ESTADO REAL
// (ops/f73Probe `seasonTrack0064Applied`): sin `game_seasons` la cabeza dice 0063.
// F84 · 0065 (Ranked 2.0: `competitive_seasons` + récord por temporada + vista `competitive_ladder` + liquidación con
// temporada/tope de pareja). Por ESTADO REAL (ops/f73Probe `ranked0065Applied`): sin `competitive_seasons`, 0064.
// F85 · 0066 (Social 2.0: `social_blocks` + RPC sociales con límites, bloqueo por dirección y retos de 5 min). Por ESTADO
// REAL (ops/f73Probe `social0066Applied`): sin `social_blocks`, 0065.
// 0067 · gestión de administradores (`app_admin_set_admin` + guardia de escritura de `is_admin` + suelo de admins). Por
// ESTADO REAL (ops/f73Probe `admin0067Applied`): sin la RPC, 0066.
// 0068 · tag público de cuenta (`profiles.public_tag` + `account_tag_registry`). Por ESTADO REAL (ops/f73Probe
// `accountTag0068Applied`): sin la columna o el registro, 0067.
// F86 · 0069 (torneos de jugadores: `cups` + `cup_registrations` + `cup_matches` + RPC). Por ESTADO REAL (ops/f73Probe
// `cups0069Applied`): sin `cups`, 0068.
// F86.2 · 0070 (Closed Alpha: `alpha_feedback` + `app_alpha_funnel`). Por ESTADO REAL (ops/f73Probe `alpha0070Applied`):
// sin `alpha_feedback`, 0069.
// F87 · 0071 (Pick'ems 2.0: `pickem_brackets` + nodos/picks/entradas/reclamos + RPC de pick/reclamo/admin). Por ESTADO
// REAL (ops/f73Probe `pickems0071Applied`): sin `pickem_brackets`, 0070.
// F87.1 · 0072 (corte de autoridad de recompensas de Pick'ems: `pickem_events.legacy_mode` + guardias). Por ESTADO REAL
// (ops/f73Probe `cutover0072Applied`): sin `legacy_mode`, 0071.
// F87.2 · 0073 (launch guard de Pick'ems: elegibilidad de cuenta para cobrar, política congelada y puerta de tiempo
// en la BD). Por ESTADO REAL (ops/f73Probe `guard0073Applied`): sin `app_pickem_reward_eligibility`, 0072.
export const MIGRATION_HEAD = "0073_pickems_launch_guard";
/** F87.2 · la que se informa si están 0059–0072 pero no 0073 (sin elegibilidad en la BD: el servidor no deja cobrar). */
export const HEAD_BEFORE_0073 = "0072_pickems_reward_cutover";
/** F87.1 · la que se informa si están 0059–0071 pero no 0072 (sin el corte: el worker legacy podría crear/pagar Pick'ems clásicos nuevos). */
export const HEAD_BEFORE_0072 = "0071_pickems_bracket";
/** F87 · la que se informa si están 0059–0070 pero no 0071 (sin Pick'ems 2.0: la API responde lista vacía / 503 en admin). */
export const HEAD_BEFORE_0071 = "0070_alpha_feedback";
/** F86.2 · la que se informa si están 0059–0069 pero no 0070 (sin feedback de la alpha: /feedback responde 503). */
export const HEAD_BEFORE_0070 = "0069_player_cups";
/** F86 · la que se informa si están 0059–0068 pero no 0069 (sin torneos de jugadores). */
export const HEAD_BEFORE_0069 = "0068_public_account_tag";
/** 0068 · la que se informa si están 0059–0067 pero no 0068 (sin tag público). */
export const HEAD_BEFORE_0068 = "0067_admin_management";
/** 0067 · la que se informa si están 0059–0066 pero no 0067 (sin gestión de admins desde el panel). */
export const HEAD_BEFORE_0067 = "0066_social_2";
/** F85 · la que se informa si están 0059–0065 pero no 0066 (lo social sigue con las reglas de 0048). */
export const HEAD_BEFORE_0066 = "0065_ranked_competitive";
/** F84 · la que se informa si están 0059–0064 pero no 0065 (el competitivo responde sin temporada competitiva). */
export const HEAD_BEFORE_0065 = "0064_season_track";
/** F83 · la que se informa si están 0059–0063 pero no 0064 (la ruta de temporada responde «sin temporada»). */
export const HEAD_BEFORE_0064 = "0063_profile_favorite_team";
/** F89 · la que se informa si están 0059–0062 pero no 0063 (el perfil no enseña equipo favorito; guardarlo → 503). */
export const HEAD_BEFORE_0063 = "0062_collection_sets";
/** F82 · la que se informa si están 0059–0061 pero no 0062 (la Sala de Trofeos responde «no disponible»). */
export const HEAD_BEFORE_0062 = "0061_forge_progression";
/** La cabeza anterior: la que se informa si la BD tiene el esquema de 0058 pero no las tablas de 0059. */
export const PREVIOUS_HEAD = "0058_hardening_grants";
/** F79.1 · la que se informa si están 0059/0060 pero no 0061 (la app de F79.1 necesita 0061 para intercambiar y desguazar). */
export const HEAD_BEFORE_0061 = "0060_salvage_last_copy_atomic";
/** Claves que la sonda `app_admin_schema_probe` (0057) debe devolver en verde para que el esquema sea el esperado. */
export const EXPECTED_SCHEMA_KEYS = ["0055_user_sanctions", "0055_admin_event_drafts", "0057_content_packs", "0057_agents_lifecycle", "0057_card_presentation", "0057_entity_version"] as const;

/**
 * F79.2 · CABEZA REAL A PARTIR DEL ESTADO DE LA BD — lo que `production:check --vps` lee en solo lectura
 * (`scripts/ops/migration-state.sh`). Nunca la constante: cada hito exige SU huella concreta en el esquema.
 *   0059 → tablas `craft_recipes` + `mission_events`
 *   0060 → el cuerpo de `app_salvage_cards` impone `LAST_COPY`
 *   0061 → `forge_config` + las RPC guardadas + `app_craft_card` con la última copia DESBLOQUEADA
 * Un estado a medias (p. ej. `forge_config` sin las RPC) NO es ninguna cabeza: «inconsistente».
 */
export interface DbMigrationState {
  craftTables0059: boolean;
  salvageLastCopy0060: boolean;
  forgeConfig0061: boolean;
  guardedRpcs0061: boolean;
  craftCardUnlocked0061: boolean;
  /** F82 · 0062 → tabla `collection_sets` + RPC `app_collection_claim`. */
  collectionSets0062?: boolean;
  collectionClaim0062?: boolean;
  /** F89 · 0063 → columna `favorite_team_id` + RPC `player_profile_set_favorite_team`. */
  favoriteTeam0063?: boolean;
  /** F83 · 0064 → tablas `game_seasons` + `season_xp_ledger` y las RPC `app_season_apply` / `app_season_claim`. */
  seasonTrack0064?: boolean;
  /** F84 · 0065 → `competitive_seasons` + `competitive_season_players` + vista `competitive_ladder` + libro con temporada. */
  ranked0065?: boolean;
  /** F85 · 0066 → tabla `social_blocks` + utilidad `_social_blocked`. */
  social0066?: boolean;
  /** 0067 → RPC `app_admin_set_admin` + disparadores `profiles_admin_write_guard` / suelo de admins. */
  admin0067?: boolean;
  /** 0068 → columna `profiles.public_tag` (NOT NULL, UNIQUE) + `account_tag_registry` + disparadores de inmutabilidad. */
  accountTag0068?: boolean;
  /** F86 · 0069 → tablas `cups` / `cup_registrations` / `cup_matches` + RPC `cup_settle_game` y guardias de escritura. */
  cups0069?: boolean;
  /** F86.2 · 0070 → tabla `alpha_feedback` + RPC `app_alpha_funnel` + guardia append-only. */
  alpha0070?: boolean;
  /** F87 · 0071 → `pickem_brackets` + `pickem_bracket_picks` + RPC `app_pickem_save_pick` / `app_pickem_claim` + guardias. */
  pickems0071?: boolean;
  /** F87.1 · 0072 → `pickem_events.legacy_mode` + guardias del libro y de las recompensas. */
  cutover0072?: boolean;
  /** F87.2 · 0073 → `app_pickem_reward_eligibility` + guardias de elegibilidad y tiempo. */
  guard0073?: boolean;
}
export function headFromDbState(s: DbMigrationState): string {
  const any61 = s.forgeConfig0061 || s.guardedRpcs0061 || s.craftCardUnlocked0061;
  const all61 = s.forgeConfig0061 && s.guardedRpcs0061 && s.craftCardUnlocked0061;
  const any62 = !!s.collectionSets0062 || !!s.collectionClaim0062;
  const all62 = !!s.collectionSets0062 && !!s.collectionClaim0062;
  const has63 = !!s.favoriteTeam0063;
  const has64 = !!s.seasonTrack0064;
  const has65 = !!s.ranked0065;
  const has66 = !!s.social0066;
  const has67 = !!s.admin0067;
  const has68 = !!s.accountTag0068;
  const has69 = !!s.cups0069;
  const has70 = !!s.alpha0070;
  const has71 = !!s.pickems0071;
  const has72 = !!s.cutover0072;
  const has73 = !!s.guard0073;
  const later62 = has63 || has64 || has65 || has66 || has67 || has68 || has69 || has70 || has71 || has72 || has73;
  if (!s.craftTables0059) return any61 || any62 || later62 || s.salvageLastCopy0060 ? "inconsistente" : PREVIOUS_HEAD;
  if (!s.salvageLastCopy0060) return any61 || any62 || later62 ? "inconsistente" : "0059_crafting_missions";
  if (!any61) return any62 || later62 ? "inconsistente" : HEAD_BEFORE_0061;
  if (!all61) return "inconsistente";
  if (!any62) return later62 ? "inconsistente" : HEAD_BEFORE_0062;
  if (!all62) return "inconsistente";
  if (!has63) return has64 || has65 || has66 || has67 || has68 || has69 || has70 || has71 || has72 || has73 ? "inconsistente" : HEAD_BEFORE_0063;
  if (!has64) return has65 || has66 || has67 || has68 || has69 || has70 || has71 || has72 || has73 ? "inconsistente" : HEAD_BEFORE_0064;
  if (!has65) return has66 || has67 || has68 || has69 || has70 || has71 || has72 || has73 ? "inconsistente" : HEAD_BEFORE_0065;
  if (!has66) return has67 || has68 || has69 || has70 || has71 || has72 || has73 ? "inconsistente" : HEAD_BEFORE_0066;
  if (!has67) return has68 || has69 || has70 || has71 || has72 || has73 ? "inconsistente" : HEAD_BEFORE_0067;
  if (!has68) return has69 || has70 || has71 || has72 || has73 ? "inconsistente" : HEAD_BEFORE_0068;
  if (!has69) return has70 || has71 || has72 || has73 ? "inconsistente" : HEAD_BEFORE_0069;
  if (!has70) return has71 || has72 || has73 ? "inconsistente" : HEAD_BEFORE_0070;
  if (!has71) return has72 || has73 ? "inconsistente" : HEAD_BEFORE_0071;
  if (!has72) return has73 ? "inconsistente" : HEAD_BEFORE_0072;
  return has73 ? MIGRATION_HEAD : HEAD_BEFORE_0073;
}
/** Lee la salida `CLAVE=t|f` de `scripts/ops/migration-state.sh`. Clave ausente o ilegible → false (conservador). */
export function parseMigrationState(out: string): DbMigrationState {
  const b = (k: string) => new RegExp(`^${k}=t\s*$`, "m").test(out);
  return { craftTables0059: b("CRAFT_TABLES_0059"), salvageLastCopy0060: b("SALVAGE_LAST_COPY_0060"), forgeConfig0061: b("FORGE_CONFIG_0061"), guardedRpcs0061: b("GUARDED_RPCS_0061"), craftCardUnlocked0061: b("CRAFT_CARD_UNLOCKED_0061"), collectionSets0062: b("COLLECTION_SETS_0062"), collectionClaim0062: b("COLLECTION_CLAIM_0062"), favoriteTeam0063: b("FAVORITE_TEAM_0063"), seasonTrack0064: b("SEASON_TRACK_0064"), ranked0065: b("RANKED_0065"), social0066: b("SOCIAL_0066"), admin0067: b("ADMIN_0067"), accountTag0068: b("ACCOUNT_TAG_0068"), cups0069: b("CUPS_0069"), alpha0070: b("ALPHA_0070"), pickems0071: b("PICKEMS_0071"), cutover0072: b("CUTOVER_0072"), guard0073: b("GUARD_0073") };
}
