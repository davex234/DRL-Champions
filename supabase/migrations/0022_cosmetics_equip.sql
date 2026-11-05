-- ============================================================================
-- FASE 11 · COSMÉTICOS: DE «CONCEDIDO» A «EQUIPADO»
--
-- ────────────────────────── EL PROBLEMA ──────────────────────────
--
-- El carril de aspecto del pase reparte 15 cosméticos a lo largo de la temporada. Se
-- conceden bien —`app_grant_reward` los escribe en `user_cosmetics` dentro de la misma
-- transacción desde la Fase 10— y ahí se acaba todo: **no hay dónde verlos ni forma de
-- equiparlos.** Un id con prefijo (`titulo:analista`) en una tabla que ninguna pantalla
-- lee no es una recompensa; es un apunte contable.
--
-- Eso vacía de sentido al único carril que se pretende monetizar (§29: lo que se paga es
-- cosmética). Vender aspecto que no se ve no se sostiene.
--
-- ────────────────────────── LA DECISIÓN ──────────────────────────
--
-- **Una sola columna, no un sistema.** La Fase 11 pide expresamente no construir un
-- sistema gigantesco, así que lo equipado vive en `profiles.equipped`, un objeto pequeño
-- de FAMILIA → id:
--
--     { "titulo": "titulo:analista", "marco": "marco:neon" }
--
-- Por qué un `jsonb` y no una tabla de equipamiento: las familias son pocas y el jugador
-- lleva como mucho una de cada. Una tabla exigiría una fila por familia, su clave y su
-- RLS, para guardar lo que cabe en un objeto de cuatro claves.
--
-- **La familia es el prefijo del id.** `titulo:analista` pertenece a `titulo`. No hace
-- falta un catálogo en la base de datos: el catálogo vive en la temporada (`data/season`)
-- y esto solo guarda la elección.
--
-- ────────────────────────── LA INVARIANTE ──────────────────────────
--
-- **No se puede equipar lo que no se tiene.** Lo comprueba `app_equip_cosmetic` contra
-- `user_cosmetics` en la misma transacción. Si se comprobara en Node, bastaría con llamar
-- a la ruta con un id inventado.
--
-- `equipped` se añade además al trigger guardián de `profiles`: el cliente no la escribe
-- ni siquiera sabiendo que existe.
-- ============================================================================

alter table public.profiles
  add column if not exists equipped jsonb not null default '{}'::jsonb;

comment on column public.profiles.equipped is
  'Cosméticos equipados, FAMILIA → id (ej. {"titulo":"titulo:analista"}). Solo lo escribe app_equip_cosmetic.';

-- El guardián de columnas protegidas (0012) tiene que conocer la nueva: sin esto, un
-- `UPDATE profiles SET equipped = …` desde el navegador pasaría.
create or replace function public.profiles_guard_protected_columns()
returns trigger language plpgsql as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if new.id               is distinct from old.id               then raise exception 'SEC-02: id no es editable'; end if;
  if new.credits          is distinct from old.credits          then raise exception 'SEC-02: credits solo lo modifica el servidor'; end if;
  if new.tokens           is distinct from old.tokens           then raise exception 'SEC-02: tokens solo lo modifica el servidor'; end if;
  if new.xp               is distinct from old.xp               then raise exception 'SEC-02: xp solo lo modifica el servidor'; end if;
  if new.level            is distinct from old.level            then raise exception 'SEC-02: level solo lo modifica el servidor'; end if;
  if new.points           is distinct from old.points           then raise exception 'SEC-02: points solo lo modifica el servidor'; end if;
  if new.equipped         is distinct from old.equipped         then raise exception 'SEC-02: equipped solo lo modifica el servidor'; end if;
  if new.collection_value is distinct from old.collection_value then raise exception 'SEC-02: collection_value solo lo modifica el servidor'; end if;
  if new.distinct_cards   is distinct from old.distinct_cards   then raise exception 'SEC-02: distinct_cards solo lo modifica el servidor'; end if;
  if new.rarest_rank      is distinct from old.rarest_rank      then raise exception 'SEC-02: rarest_rank solo lo modifica el servidor'; end if;
  if new.market_volume    is distinct from old.market_volume    then raise exception 'SEC-02: market_volume solo lo modifica el servidor'; end if;
  if new.packs_opened     is distinct from old.packs_opened     then raise exception 'SEC-02: packs_opened solo lo modifica el servidor'; end if;
  if new.taxes_paid       is distinct from old.taxes_paid       then raise exception 'SEC-02: taxes_paid solo lo modifica el servidor'; end if;
  if new.is_admin         is distinct from old.is_admin         then raise exception 'SEC-02: is_admin solo lo modifica el servidor'; end if;
  if new.created_at       is distinct from old.created_at       then raise exception 'SEC-02: created_at no es editable'; end if;

  return new;
end; $$;

-- ----------------------------------------------------------------------------
-- Equipar / retirar
-- ----------------------------------------------------------------------------
-- `p_cosmetic_id` a NULL retira lo equipado de esa familia. Es la misma operación: elegir
-- «nada» es una elección válida y no merece una RPC aparte.
create or replace function public.app_equip_cosmetic(
  p_user uuid, p_family text, p_cosmetic_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_equipped jsonb;
begin
  if p_family is null or length(p_family) = 0 then
    raise exception 'Falta la familia del cosmético' using errcode = 'P0001';
  end if;

  if p_cosmetic_id is not null then
    -- No se puede equipar lo que no se tiene. Es LA invariante de esta migración.
    if not exists (
      select 1 from public.user_cosmetics
       where user_id = p_user and cosmetic_id = p_cosmetic_id
    ) then
      raise exception 'No tienes ese cosmético' using errcode = 'P0001';
    end if;
    -- Y el id tiene que pertenecer a la familia que dice: `titulo:x` no se equipa como marco.
    if split_part(p_cosmetic_id, ':', 1) <> p_family then
      raise exception 'Ese cosmético no es de esa familia' using errcode = 'P0001';
    end if;
  end if;

  update public.profiles
     set equipped = case
           when p_cosmetic_id is null then equipped - p_family
           else equipped || jsonb_build_object(p_family, p_cosmetic_id)
         end
   where id = p_user
   returning equipped into v_equipped;

  if v_equipped is null then raise exception 'Perfil inexistente'; end if;
  return v_equipped;
end; $$;

revoke all on function public.app_equip_cosmetic(uuid, text, text) from public, anon, authenticated;
grant execute on function public.app_equip_cosmetic(uuid, text, text) to service_role;
