-- ============================================================================
-- FASE 8 · DUELOS: mazos y partidas con AUTORIDAD DE SERVIDOR
--
-- QUÉ RESUELVE
--   Las Fases 1-7 dejaron el motor de duelos terminado y probado, pero puro: no
--   sabe de usuarios ni de persistencia. Aquí se le da un sitio donde vivir sin
--   convertir al cliente en autoridad.
--
-- PRINCIPIO DE DISEÑO — el estado de la partida NO SALE DE AQUÍ
--   `duel_matches.state` contiene la partida COMPLETA, incluidas las cartas que
--   el rival todavía no ha jugado y el estado del generador determinista. Si el
--   cliente pudiera leer esa fila, podría predecir la partida entera.
--   Por eso la tabla tiene RLS activo y NINGUNA política: ni siquiera su dueño
--   puede seleccionarla. Solo `service_role` la toca, desde las rutas de Next,
--   y el cliente recibe únicamente una proyección redactada.
--
--   Los MAZOS sí son del usuario y no esconden nada, así que `duel_decks` sí
--   concede SELECT de las filas propias. La escritura sigue pasando por servidor:
--   un mazo se valida contra el inventario real antes de guardarse.
--
-- QUÉ NO SE TOCA
--   `user_cards` sigue siendo la única fuente de propiedad. Un mazo guarda
--   REFERENCIAS a instancias poseídas, nunca copias de cartas ni estadísticas.
--   Nada de esto concede cartas, créditos ni recompensas: un duelo de esta fase
--   no mueve la economía.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. MAZOS DE DUELO — 10 referencias a instancias del inventario
-- ----------------------------------------------------------------------------
create table if not exists public.duel_decks (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 1 and 40),
  -- Referencias a `user_cards.uid`. Se permite guardar un mazo INCOMPLETO: el
  -- dominio distingue «incompleto» de «ilegal», y el jugador puede dejarlo a medias.
  card_uids  uuid[] not null default '{}' check (array_length(card_uids, 1) is null
                                                 or array_length(card_uids, 1) <= 10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists duel_decks_user_idx on public.duel_decks(user_id);

alter table public.duel_decks enable row level security;

drop policy if exists duel_decks_select_own on public.duel_decks;
create policy duel_decks_select_own on public.duel_decks
  for select to authenticated using (user_id = auth.uid());

-- Sin políticas de INSERT/UPDATE/DELETE: toda escritura pasa por el servidor,
-- que comprueba contra `user_cards` que las instancias son realmente del usuario.
revoke insert, update, delete on public.duel_decks from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. PARTIDAS — estado completo, invisible para el cliente
-- ----------------------------------------------------------------------------
create table if not exists public.duel_matches (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  deck_id       uuid references public.duel_decks(id) on delete set null,
  difficulty    text not null check (difficulty in ('EASY','NORMAL','HARD')),
  -- Estado del ORQUESTADOR: WAITING | IN_PROGRESS | COMPLETED | DRAW | UNRESOLVED
  status        text not null,
  /*
   * Partida completa serializada (`DuelMatch`). Incluye los DOS snapshots, así que
   * contiene las cartas que el rival aún no ha jugado. NUNCA se devuelve tal cual.
   */
  state         jsonb not null,
  /*
   * Estado de los generadores deterministas de cada bando. Con esto se puede
   * predecir cada decisión futura del bot: es secreto de servidor.
   */
  rng           jsonb not null,
  -- Reglas de resultado con las que se juega esta partida (Fase 7: `duel-combat-2`).
  rules_version text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists duel_matches_user_idx    on public.duel_matches(user_id);
create index if not exists duel_matches_user_st_idx on public.duel_matches(user_id, status);

alter table public.duel_matches enable row level security;
-- DENIEGA TODO a propósito: no hay ni una política. Ver la cabecera de este fichero.
revoke all on public.duel_matches from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. `updated_at` automático
-- ----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists duel_decks_touch   on public.duel_decks;
create trigger duel_decks_touch   before update on public.duel_decks
  for each row execute function public.touch_updated_at();

drop trigger if exists duel_matches_touch on public.duel_matches;
create trigger duel_matches_touch before update on public.duel_matches
  for each row execute function public.touch_updated_at();
