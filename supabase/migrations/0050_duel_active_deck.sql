-- 0050 · EQUIPO ACTIVO (Fase 32 · Deck Builder 2.0 + Team Management) — APLICADA (VPS 2026-09-15, Fase 35.1).
--
-- Estado: fichero LOCAL. Aplicada en la BD del VPS el 2026-09-15 12:00Z (Fase 35.1). No tocar `schema_migrations`.
--
-- POR QUÉ HACE FALTA. Antes de la Fase 32 no existía el concepto «equipo activo»: cada pantalla
-- (pre-partida, PvP, retos, vestíbulo) elegía por su cuenta «el primer mazo legal». Recordar CUÁL es
-- el equipo del jugador exige guardar una referencia, y no hay dónde hacerlo sin exponerla:
--   · `profiles` es legible por todos (0009) ⇒ el equipo activo sería público, y la Fase 31 protege
--     los mazos del perfil público;
--   · `duel_decks` concede SELECT del dueño y tiene un trigger que toca `updated_at` en cada UPDATE,
--     y `updated_at` es la VERSIÓN que usa la concurrencia optimista del constructor: marcar activo
--     un mazo lo daría por «cambiado en otra pestaña».
-- Por eso: una tabla nueva, una fila por usuario, SOLO servidor.
--
-- QUÉ NO HACE. No cambia `duel_decks`, ni `user_cards`, ni ninguna regla de composición, ni el
-- combate, ni el rating, ni la cola. La legalidad del mazo NO se valida aquí (vive en TypeScript,
-- `validateDuelDeck`, y el servicio la comprueba antes de llamar al RPC): el RPC solo garantiza, en
-- una transacción, que el mazo es del usuario y que no ha cambiado desde que se validó.
--
-- DEGRADACIÓN SIN APLICAR. El servicio detecta la tabla/función ausente (42P01 / PGRST205 / 42883) y
-- responde «equipo activo no disponible todavía» (503 NOT_READY); todo lo demás del constructor
-- (crear, guardar con versión, renombrar, duplicar, borrar) funciona sin esta migración.
--
-- BORRADO. `on delete cascade` sobre el mazo: borrar el equipo activo deja al usuario SIN equipo
-- activo (explícito, sin elegir otro por él). El servicio exige `confirmActive` para borrarlo.
--
-- REVERSIÓN (conceptual): drop function public.duel_deck_activate(uuid, uuid, timestamptz);
--   drop table public.duel_active_deck;
--
-- Aditiva e idempotente.

create table if not exists public.duel_active_deck (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  deck_id    uuid not null references public.duel_decks(id) on delete cascade,
  updated_at timestamptz not null default now()
);
create unique index if not exists duel_active_deck_deck_idx on public.duel_active_deck(deck_id);

alter table public.duel_active_deck enable row level security;
-- Sin políticas a propósito: ni el propio usuario lo lee con su token. Todo pasa por el servidor.
revoke all on public.duel_active_deck from anon, authenticated;
grant all on public.duel_active_deck to service_role;

comment on table public.duel_active_deck is
  'Fase 32: equipo activo por usuario (referencia a duel_decks). Solo servidor. La legalidad la valida validateDuelDeck antes del RPC.';

-- Marca activo un mazo del usuario. Devuelve 'OK' | 'NOT_FOUND' | 'CONFLICT'.
--   · NOT_FOUND: el mazo no existe o no es de p_user (misma respuesta: no se filtra la existencia).
--   · CONFLICT : el mazo cambió (updated_at) desde que el servicio lo validó.
create or replace function public.duel_deck_activate(
  p_user uuid,
  p_deck uuid,
  p_expected_updated_at timestamptz default null
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.duel_decks%rowtype;
begin
  select * into d from public.duel_decks where id = p_deck and user_id = p_user for update;
  if not found then
    return 'NOT_FOUND';
  end if;
  if p_expected_updated_at is not null and d.updated_at <> p_expected_updated_at then
    return 'CONFLICT';
  end if;
  insert into public.duel_active_deck (user_id, deck_id, updated_at)
  values (p_user, p_deck, now())
  on conflict (user_id) do update set deck_id = excluded.deck_id, updated_at = now();
  return 'OK';
end $$;

revoke all on function public.duel_deck_activate(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.duel_deck_activate(uuid, uuid, timestamptz) to service_role;
