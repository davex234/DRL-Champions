# 01 · Preflight — FASE 37.1 (0052 · favoritos de colección)

Todo en este documento es **solo lectura**. Sin PII (solo conteos y huellas md5).

## Baseline local (antes de tocar el VPS)
| gate | resultado |
|---|---|
| `npm test` | 2468 / 2468 |
| `collection:verify` · `collection-room:verify` | 53 ✓ · 53 ✓ |
| `collection-content` · `collection-security` · `collection-performance` | 23 ✓ · 21 ✓ · 9 ✓ |

## Contrato SQL ↔ código
- Fichero real: `supabase/migrations/0052_collection_favorites.sql`.
- Servicio: `src/server/services/collection.ts` escribe con el cliente de servidor (service_role): `select count/head`, `select … maybeSingle`, `insert {user_id, card_id}` (23505 → éxito idempotente; `FAVORITES_LIMIT` → 409), `delete … eq(user_id) eq(card_id)`. Lee `card_id` ordenado por `created_at desc`, límite 200.
- Ruta `src/app/api/game/collection/route.ts`: usuario del token, cuerpo cerrado `{action:"favorite", cardId, favorite}`.
- El cliente **no** escribe directamente: basta `SELECT` propio para `authenticated`; sin `INSERT/UPDATE/DELETE` para clientes. Coincide con la migración.
- **Bug encontrado antes de aplicar**: el disparador del tope contaba sin cerrojo → dos altas concurrentes del mismo usuario podían ver 199 y dejar 201. Corregido en local antes del ensayo con `pg_advisory_xact_lock(hashtextextended('user_card_favorites:'||user_id, 0))` y `search_path = pg_catalog, public`.

## Identidad del VPS
- Host `VM-4b2a…` · usuario `nexusadmin` · clave `~/.ssh/id_ed25519`.
- Contenedor `supabase_db_DRLCards` (healthy, up 3 días), `pg_isready` → accepting connections. Kong/REST/Auth up (healthy). `vector` y `edge_runtime` en bucle de reinicio (preexistente, no tocado).
- `current_database()=postgres` · `current_schema()=public` · `current_user=postgres` · PostgreSQL 17.6 · `pg_is_in_recovery()=false` · postmaster desde 2026-09-12 15:06 UTC.

## Estado de 0052 en el VPS
| objeto | estado |
|---|---|
| `public.user_card_favorites` | ausente |
| políticas / disparador / función `_user_card_favorites_cap` | 0 / 0 / 0 |
| índices / restricciones `user_card_favorites*` | 0 / 0 |
| cualquier relación `%favorit%` | ninguna |

Sin estado parcial. `supabase_migrations.schema_migrations`: 25 filas (máx. 0025) — **no se toca**.

Privilegios por defecto del esquema `public` para tablas nuevas (de `postgres` y `supabase_admin`): `anon`, `authenticated` y `service_role` reciben `arwdDxtm`. 0052 revoca todo a `anon`/`authenticated` inmediatamente después de crear la tabla (se verifica en ensayo y postflight).

## Huella PRE (global)
| medida | valor |
|---|---|
| auth.users / profiles | 10 / 10 |
| user_cards | 130 (md5 `bdb52593…`) |
| duel_decks / duel_active_deck | 3 (md5 `6721ae1d…`) / 1 |
| credit_transactions | 53 (última 2026-09-15 17:19:11 UTC) |
| user_packs (filas / suma qty) | 24 / 33 |
| user_game (filas / suma packs_opened) | 10 / 23 |
| user_pass | 4 (md5 `f635fa6f…`) |
| user_achievements / user_cosmetics | 4 / 0 |
| duel_matches / duel_pvp_ratings | 7 / 2 |
| player_profile_customization | 1 |
| campaign_attempts / campaign_progress | 3 / 1 |
| suma de créditos (profiles) | 234 195 |
