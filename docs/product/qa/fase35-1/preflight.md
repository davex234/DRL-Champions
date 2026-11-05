# FASE 35.1 · Preflight (0046 → 0051)

Fecha: 2026-09-15 · Entorno: VPS `212.95.40.144`, usuario `nexusadmin`, contenedor `supabase_db_DRLCards` · Sin secretos.

## Identidad verificada (solo lectura, 11:53–11:54Z)

| Comprobación | Valor |
|---|---|
| `whoami` / host | `nexusadmin` / `VM-4b2a3727-cfa7-48e3-ad08-9fca50df0ade` |
| Uptime / carga | 3 días 16 h / 1.26 |
| Disco `/` | 493 G, 5 % usado |
| Contenedor | `supabase_db_DRLCards` Up 2 days (healthy) |
| `current_database()` / `current_schema()` / `current_user` | `postgres` / `public` / `postgres` |
| `version()` | PostgreSQL 17.6 on x86_64-pc-linux-gnu |
| `supabase_migrations.schema_migrations` | 25 filas, 0001–0025 (0026–0045 aplicadas a mano, sin registrar) |
| Estado previo del stack | `edge_runtime` y `vector` en bucle de reinicio (DRLCards y sportcoach) **antes** de esta fase; no se tocaron |

## Inventario real (to_regclass / information_schema / pg_constraint / pg_proc)

| Objeto | Estado previo |
|---|---|
| `duel_friendships`, `duel_challenges`, `player_profile_customization`, `duel_active_deck`, `duel_active_decks`, `campaign_progress`, `campaign_attempts` | **ABSENT** |
| Índices de 0047 y 0048 (`duel_pvp_ratings_ladder_idx`, `duel_matches_pvp_*_recent_idx`, `duel_matches_private_*_idx`, `profiles_username_lower_idx`) | **ABSENT** |
| `profiles.last_seen_at` | ABSENT |
| `telemetry_events_flow_check` | `flow IS NULL OR flow IN (deck_builder, pack_ceremony, pickem_form, market_listing_form)` |
| `duel_matches_mode_check` | `mode IN (PVE, PVP)` (nombre coincide con el `drop constraint if exists` de 0048) |
| `duel_matches_mode_shape` | PVE sin B · PVP con B distinto (nombre coincide) |
| `_duel_pvp_has_active_match(uuid)`, `duel_pvp_expired_candidates(int) → SETOF duel_matches`, `duel_pvp_expire_turn(uuid,int,uuid) → jsonb` | presentes (0035), SECURITY DEFINER, `search_path=public`, solo `service_role` — firmas compatibles con `create or replace` |
| `touch_updated_at()` | presente |
| `social_*`, `player_profile_set`, `_uuid/_text_array_is_unique`, `duel_deck_activate` | ABSENT |
| `app_grant_reward` | presente, todos los parámetros opcionales con DEFAULT; `credit_tx_ref_uniq (user_id, ref) WHERE ref IS NOT NULL` |
| `gen_random_uuid()` | disponible |

Conclusión: **ninguna de 0046–0051 estaba aplicada, ni total ni parcialmente.**

## Datos existentes frente a las nuevas restricciones

| Comprobación | Resultado |
|---|---|
| Flows usados en `telemetry_events` (642 filas) | `NULL`, `deck_builder`, `pack_ceremony`, `pickem_form` → compatibles con el CHECK ampliado |
| `duel_matches` por modo | PVE 5 |
| Filas que violarían el nuevo `duel_matches_mode_shape` | 0 |
| `profiles.username` nulos (índice `lower(username)`) | 0 |
| Locks bloqueados / sesiones | 0 / 15 idle + 1 activa |

## Grafo de dependencias REAL

Ninguna migración de 0046–0051 depende de otra de ese rango. Cada una depende solo de objetos preexistentes:

| Migración | Depende de |
|---|---|
| 0046 | `telemetry_events` (0029) |
| 0047 | `duel_pvp_ratings` (0034), `duel_matches.mode/player_b_id` (0031) |
| 0048 | `profiles`, `auth.users`, `duel_decks` (0014), `duel_matches` (0014+0031), funciones PvP de 0035, `touch_updated_at` |
| 0049 | `profiles`, `user_cards` (0011), `user_achievements`, `auth.users` |
| 0050 | `duel_decks`, `auth.users` |
| 0051 | `duel_matches` (PK `id`), `auth.users` |

Orden elegido: numérico (0046 → 0051), porque no hay dependencias cruzadas y es el más fácil de auditar.

## Riesgos detectados antes de escribir

1. **BUG REAL en 0048 — regresión silenciosa de PvP ranked.** Su `duel_pvp_expire_turn` no solo ampliaba el modo: decidía NOT_DUE/LOST_RACE por `state_version`, mientras que la función viva (0035) lo decide por «sigue abierta y el plazo no ha vencido». **Corregido en local** antes de aplicar: cuerpo idéntico al vivo salvo `mode in ('PVP','PVP_PRIVATE')`.
2. **Endurecimiento en 0049.** Los privilegios por defecto de `public` dan EXECUTE a anon/authenticated en toda función nueva; los ayudantes `_uuid_array_is_unique` / `_text_array_is_unique` no se revocaban. **Corregido en local**: revoke a public/anon/authenticated, grant a service_role.
3. **Locks.** 0046 y 0048 añaden CHECK a `telemetry_events` (642 filas) y `duel_matches` (5 filas): ACCESS EXCLUSIVE breve. 0047/0048 crean índices no concurrentes (SHARE lock) sobre tablas diminutas. Mitigación: `lock_timeout = 5s`, `statement_timeout = 60s`, una migración por transacción. La app no está desplegada en el VPS; el worker no escribe esas tablas.
4. **Privilegios por defecto.** `public` concede `arwdDxtm` a anon/authenticated en tablas nuevas y EXECUTE en funciones nuevas: todas las migraciones revocan explícitamente (verificado después).
5. **Telemetría.** 0046 admite exactamente los 9 flows que el código declara (`*_FLOW`) + los 4 históricos; `FLOWS` del código sigue en 4 → la app no emitirá los nuevos hasta un cambio de código (no se hizo: fuera de alcance).

## Ensayo sin persistencia (dry run)

Las seis migraciones (ya corregidas) se ejecutaron en **una transacción con ROLLBACK** contra la BD real (11:56Z): exit 0, todos los objetos creados dentro de la transacción; tras el ROLLBACK, `campaign_progress` y `duel_friendships` ABSENT y `duel_matches_mode_check` de nuevo `(PVE, PVP)`. Un primer intento falló por el entrecomillado del envoltorio (`\echo`), antes de ejecutar ninguna sentencia de las migraciones: se abortó la transacción sin cambios (ese es el único ERROR en el log de Postgres del periodo).
