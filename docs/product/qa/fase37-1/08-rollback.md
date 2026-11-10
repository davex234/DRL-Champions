# 08 · Plan de rollback de 0052 (redactado ANTES de aplicar)

## Qué crea 0052 (fichero real)
| objeto | tipo |
|---|---|
| `public.user_card_favorites` | tabla (`user_id uuid`, `card_id text`, `created_at timestamptz default now()`) |
| `user_card_favorites_pkey` | clave primaria `(user_id, card_id)` + su índice |
| `user_card_favorites_user_id_fkey` | FK → `auth.users(id) on delete cascade` |
| `user_card_favorites_card_id_format` | CHECK `card_id ~ '^[a-z0-9-]{1,64}__[a-z0-9-]{1,32}$'` |
| `user_card_favorites_user_created_idx` | índice `(user_id, created_at desc)` |
| RLS | `enable row level security` |
| grants | `revoke all … from anon, authenticated` · `grant select … to authenticated` |
| `"tus favoritos (lectura)"` | política `SELECT to authenticated using (auth.uid() = user_id)` |
| `public._user_card_favorites_cap()` | función de disparador (plpgsql, SECURITY INVOKER, `search_path = pg_catalog, public`, cerrojo consultivo por usuario, `FAVORITES_LIMIT` a partir de 200); `revoke all … from public, anon, authenticated` |
| `user_card_favorites_cap` | disparador `BEFORE INSERT FOR EACH ROW` |

No altera ninguna tabla existente, no inserta ni actualiza datos, no toca `schema_migrations`.

## Cómo revertir (una transacción)
```sql
\set ON_ERROR_STOP on
begin;
drop trigger if exists user_card_favorites_cap on public.user_card_favorites;
drop function if exists public._user_card_favorites_cap();
drop table if exists public.user_card_favorites;   -- arrastra PK, FK, CHECK, índice y política
commit;
select coalesce(to_regclass('public.user_card_favorites')::text, 'absent');
```

Ejecución: `ssh … 'docker exec -i supabase_db_DRLCards psql -U postgres -d postgres -v ON_ERROR_STOP=1' < rollback.sql`.

## Qué se perdería
Solo las filas de `user_card_favorites` (preferencias «me gusta esta carta»). No afecta a cartas, seriales, créditos, sobres, pase, equipos, vitrina, campaña ni rating. En el momento de aplicar hay **0 favoritos reales** (la tabla no existía), así que el rollback inmediato no pierde nada.

## Comportamiento de la app tras un rollback
La API vuelve a `503 FAVORITES_UNAVAILABLE` y la ficha a «Favoritos no disponibles» (aislamiento ya probado en Fase 37). El resto de la colección sigue.

## Si el apply falla a mitad
El fichero se aplica en **una sola transacción** con `ON_ERROR_STOP`: cualquier error aborta y PostgreSQL deshace todo (no queda estado parcial). Pasos: (1) guardar la salida; (2) repetir el preflight (`to_regclass`, políticas, disparador, función → deben seguir a 0); (3) si hubiese objetos sueltos (no esperado), ejecutar el bloque de rollback de arriba; (4) no reintentar sin entender el error.

## Último recurso
Restaurar el backup `pre-0052` (ver `02-backup.md`). No necesario para revertir 0052.
