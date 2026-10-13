# 05 · Aplicación real y postflight de 0052

## Aplicación
| campo | valor |
|---|---|
| inicio / fin (UTC) | 2026-09-15 19:32:53Z → 19:32:54Z |
| método | `psql -v ON_ERROR_STOP=1` por stdin: `begin;` + `0052_collection_favorites.sql` (sha256 local `f97c7dd2c2eff2dc…`, con cerrojo) + `commit;` |
| precheck en el mismo fichero | `A_precheck_table = absent` |
| salida | `BEGIN · CREATE TABLE · CREATE INDEX · ALTER TABLE · REVOKE · GRANT · DROP POLICY (no existía) · CREATE POLICY · CREATE FUNCTION · REVOKE · DROP TRIGGER (no existía) · CREATE TRIGGER · COMMIT` |
| psql exit | **0** |
| tras COMMIT | tabla `user_card_favorites` presente · **0 filas** |
| otros SQL de producto | ninguno · `schema_migrations` sin tocar (25 filas, máx. 0025) |

## Esquema (coincide con el fichero)
| comprobación | resultado |
|---|---|
| columnas | `user_id uuid NOT NULL` · `card_id text NOT NULL` · `created_at timestamptz NOT NULL default now()` |
| restricciones | PK `(user_id, card_id)` · FK `user_id → auth.users(id) ON DELETE CASCADE` · CHECK formato `^[a-z0-9-]{1,64}__[a-z0-9-]{1,32}$` |
| índices | `user_card_favorites_pkey` UNIQUE (user_id, card_id) · `user_card_favorites_user_created_idx` (user_id, created_at DESC) |
| disparador | `user_card_favorites_cap` BEFORE INSERT FOR EACH ROW → `_user_card_favorites_cap()` |
| función | SECURITY INVOKER · `search_path=pg_catalog, public` · cerrojo consultivo · EXECUTE denegado a anon/authenticated/PUBLIC |
| RLS | habilitada, no forzada |
| política | `tus favoritos (lectura)` SELECT `authenticated` `using (auth.uid() = user_id)` |
| grants | `authenticated=SELECT` · `service_role`/`postgres`=todo · anon ninguno · PUBLIC ninguno |

## Seguridad (sondas sobre la tabla REAL, BEGIN … ROLLBACK, psql exit 0)
Mismos resultados que el ensayo (`04-security.md`): A lee solo sus 2 filas y 0 de B · A no puede insertar (propio ni para B), actualizar ni borrar · B lee solo su fila · authenticated sin `sub` → 0 · anon SELECT/INSERT/DELETE denegados · PUBLIC sin privilegios · service_role lee todo · 199 → nº 200 permitido → nº 201 `P0001 FAVORITES_LIMIT` · otro usuario no afectado · duplicado → 23505 y 1 fila · borrar 1 → repetir 0 sin error · formato inválido → CHECK · usuario inexistente → FK · borrar usuario → cascada 0 · filas reales tocadas 0.
Tras ROLLBACK: 0 filas en la tabla, 0 usuarios sintéticos.

## Huella POST vs PRE (global, solo lectura)
`diff` de la consulta de preflight: **únicamente** cambian las líneas de los objetos de 0052 (tabla presente, 1 política, 1 disparador, 1 función, 2 índices, 3 restricciones). Idénticos: auth.users 10 · profiles 10 · user_cards 130 (md5 `bdb52593…`) · duel_decks 3 (md5 `6721ae1d…`) · duel_active_deck 1 · credit_transactions 53 (última 17:19:11Z) · user_packs 24 / qty 33 · user_game 10 / packs_opened 23 · user_pass 4 (md5 `f635fa6f…`) · user_achievements 4 · user_cosmetics 0 · duel_matches 7 · duel_pvp_ratings 2 · player_profile_customization 1 · campaign_attempts 3 · campaign_progress 1 · suma de créditos 234 195. `user_card_favorites`: 0 filas.

## Salud (sin reiniciar nada)
| servicio | estado |
|---|---|
| Postgres | `pg_isready` → accepting connections · postmaster desde 2026-09-12 15:06:30Z (sin reinicio) · no en recuperación |
| `supabase_db/auth/kong` DRLCards | Up 3 days (healthy) |
| `supabase_rest` DRLCards | Up 3 days |
| recarga de esquema de PostgREST | disparadores de evento `pgrst_ddl_watch` (ddl_command_end) y `pgrst_drop_watch` activos: la tabla nueva entra en la caché sin reinicio (confirmado por el E2E, `06-real-e2e.md`) |

No se reinició DB, Kong, Auth, Storage, Realtime, Caddy, Cloudflare ni el worker.
