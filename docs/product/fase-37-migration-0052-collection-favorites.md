# Migración 0052 · `user_card_favorites` (Fase 37)

**Estado: APLICADA EN EL VPS el 2026-09-15 19:32Z (Fase 37.1)** con backup verificado, ensayo transaccional, sondas de seguridad, postflight y E2E real — evidencia en `docs/product/qa/fase37-1/` y `docs/product/fase-37-1-collection-favorites-database-activation-report.md`. `schema_migrations` intacta. Si la tabla faltara, la colección sigue funcionando y los favoritos se declaran «no disponibles» (API `503 FAVORITES_UNAVAILABLE`, botón desactivado con texto «Favoritos no disponibles»). No hay ningún almacenamiento alternativo (ni `localStorage`, ni otra tabla).

Cambio previo al apply (Fase 37.1): el disparador del tope toma `pg_advisory_xact_lock` por usuario (dos altas concurrentes no pueden dejar 201) y fija `search_path = pg_catalog, public`.

Fichero: `supabase/migrations/0052_collection_favorites.sql`.

## Por qué hace falta

No existía persistencia de favoritos en servidor: `CollectionMeta.favorites` del motor de colección era solo local. La Fase 37 prohíbe `localStorage` como persistencia de favoritos, así que la única forma honesta de guardarlos es una tabla propia.

## Esquema

| columna | tipo | notas |
|---|---|---|
| `user_id` | `uuid not null` | FK `auth.users(id) on delete cascade` |
| `card_id` | `text not null` | `check (card_id ~ '^[a-z0-9-]{1,64}__[a-z0-9-]{1,32}$')` (formato canónico `playerId__variantId`) |
| `created_at` | `timestamptz not null default now()` | orden de la lista |

- Clave primaria `(user_id, card_id)`: marcar dos veces es idempotente (el servicio trata `23505` como éxito).
- Índice `(user_id, created_at desc)`.
- Favorito a nivel de **definición** (carta del catálogo), no de instancia: se puede marcar una carta que aún no tienes.

## Seguridad

- `enable row level security`.
- `revoke all on public.user_card_favorites from anon, authenticated;`
- `grant select on public.user_card_favorites to authenticated;` + política «tus favoritos (lectura)» `using (auth.uid() = user_id)`.
- **Ninguna escritura del cliente**: insertar/borrar solo desde el servidor (`src/server/services/collection.ts`, rol de servicio), con el usuario sacado del token, el id validado por formato y contra el catálogo del servidor.
- Tope de 200 favoritos por usuario: comprobado en el servicio (`409 FAVORITES_LIMIT`) y en BD con el disparador `_user_card_favorites_cap()` (lanza `FAVORITES_LIMIT` si ya hay ≥ 200).

## Qué NO toca

No altera `user_cards`, `profiles`, `user_game`, `duel_decks`, `player_profile_customization`, créditos, sobres ni mercado. No inserta ni actualiza datos. No registra nada en `schema_migrations`.

## Rollback

```sql
drop trigger if exists user_card_favorites_cap on public.user_card_favorites;
drop function if exists public._user_card_favorites_cap();
drop table if exists public.user_card_favorites;
```

(También está en la cabecera del fichero.) Al quitarla, la API vuelve a responder `503 FAVORITES_UNAVAILABLE` y la UI a «Favoritos no disponibles»; nada más depende de ella.

## Requisito de despliegue

Aplicarla en el VPS solo en una ventana autorizada y con el procedimiento de las fases 35.1/36.1:

1. **Preflight**: `to_regclass('public.user_card_favorites')` debe ser `null`; comprobar que `auth.users` existe.
2. **Backup**: `pg_dump -Fc` completo en `/opt/nexus/backups/supabase-drlcards/pre-0052/` con sha256.
3. **Sonda transaccional**: `begin; \i 0052…; <probes>; rollback;` — insertar/leer/duplicar/tope con un usuario QA dentro de la transacción; verificar RLS (`set role authenticated` + `request.jwt.claims`) y que `anon` no lee.
4. **Aplicar** el fichero tal cual, sin tocar `schema_migrations`.
5. **Probes post**: tabla, índice, política, disparador y grants; E2E de favoritos con la cuenta QA (marcar → recargar → persiste → desmarcar → recargar).
6. **Rollback** preparado (arriba).

En la Fase 37 no se aplicó (preferencia de no tocar la BD del VPS). **En la Fase 37.1 se siguió este procedimiento completo y se aplicó**: backup `pre-0052/supabase-drlcards-pre0052-20260915T193049Z.dump` (2 184 596 bytes, sha256 OK, `pg_restore -l` 1 796), ensayo PASS, apply exit 0, postflight PASS, E2E real de favoritos 34/34 PASS.
