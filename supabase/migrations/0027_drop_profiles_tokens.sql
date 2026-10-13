-- ============================================================================
-- 0027 · RETIRADA DE LA SEGUNDA MONEDA (2/2) — SE ELIMINA `profiles.tokens`
-- ============================================================================
--
-- ⚠️  MIGRACIÓN DESTRUCTIVA. Elimina una columna. NO es reversible sin restaurar datos:
--     `alter table … add column tokens bigint not null default 0` devuelve la columna, pero
--     con TODOS los saldos a 0 y sin forma de saber cuáles eran.
--
-- ────────────────────────── POR QUÉ ES SEGURA HOY ──────────────────────────
--
-- Medido justo antes de escribir esta migración, contra la base de producción:
--
--     perfiles: 39
--     suma de profiles.tokens: 0
--     perfiles con tokens != 0: 0
--     perfiles con tokens < 0:  0
--
-- **No hay ni una ficha en el sistema.** El dato que se borra es cero para todo el mundo,
-- así que «restaurar» la columna daría exactamente el mismo estado que hay ahora. Ese es el
-- motivo por el que la ventana para hacerlo es ESTA: en cuanto se conceda una sola ficha
-- más, borrar la columna sí destruiría un saldo real.
--
-- Requisito previo: **0026 aplicada**. Desde 0026 nada escribe ni lee la columna, así que
-- el valor no puede haberse movido entre las dos migraciones.
--
-- ────────────────────────── POR QUÉ EL TRIGGER VA AQUÍ Y NO EN 0026 ──────────────────────────
--
-- `profiles_guard_protected_columns()` comprueba `new.tokens is distinct from old.tokens`.
-- El cuerpo de una función plpgsql no se valida al crearla, sino al ejecutarla: si se
-- borrase la columna dejando el trigger como está, la migración pasaría sin queja y
-- **cualquier UPDATE sobre `profiles` empezaría a fallar en caliente** con un error de
-- columna inexistente. Por eso las dos cosas van en el MISMO fichero: se aplican juntas o
-- no se aplican.
--
-- El resto del guardián se reproduce carácter por carácter respecto a 0022. Solo desaparece
-- la línea de `tokens`.
--
-- ────────────────────────── LO QUE ESTA MIGRACIÓN NO TOCA ──────────────────────────
--
-- `profiles.credits` · `credit_transactions` · `economy_ops` · `_ledger_apply` ·
-- `app_adjust_credits` · `app_sandbox_purchase` · `app_sandbox_refund` · `payments` ·
-- precios · probabilidades · salvamento · mercado. Nada de eso aparece aquí.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. El guardián deja de vigilar una columna que va a desaparecer
-- ----------------------------------------------------------------------------
create or replace function public.profiles_guard_protected_columns()
returns trigger language plpgsql as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if new.id               is distinct from old.id               then raise exception 'SEC-02: id no es editable'; end if;
  if new.credits          is distinct from old.credits          then raise exception 'SEC-02: credits solo lo modifica el servidor'; end if;
  -- Aquí iba la comprobación de `tokens`. La columna se elimina en esta misma transacción.
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
-- 2. Cinturón: no se borra la columna si alguien tiene fichas
-- ----------------------------------------------------------------------------
-- Si entre la medición y la ejecución alguien hubiese recibido fichas, esta migración se
-- ABORTA entera en vez de destruir un saldo. Es la comprobación que convierte «creo que
-- está a cero» en «está a cero o no se borra».
do $$
declare v_total bigint; v_holders int;
begin
  select coalesce(sum(tokens), 0), count(*) filter (where tokens <> 0)
    into v_total, v_holders
    from public.profiles;

  if v_total <> 0 or v_holders <> 0 then
    raise exception
      'ABORTADA: profiles.tokens no está a cero (suma=%, perfiles con saldo=%). '
      'Retirar la columna destruiría un saldo real. Decide primero qué hacer con él.',
      v_total, v_holders;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 3. Fuera la columna
-- ----------------------------------------------------------------------------
alter table public.profiles drop column tokens;

commit;
