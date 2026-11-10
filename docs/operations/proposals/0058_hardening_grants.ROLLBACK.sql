-- =============================================================================
-- ROLLBACK de 0058_hardening_grants v3 — vuelve EXACTAMENTE a los privilegios medidos en 0057 (2026-09-27).
-- =============================================================================
-- Medido antes de 0058: anon y authenticated tenían en `profiles` SELECT/INSERT/DELETE/TRUNCATE/REFERENCES/TRIGGER
-- de tabla (+ UPDATE de columnas username/region/avatar para authenticated, que 0058 NO toca); política
-- «crea tu perfil» FOR INSERT WITH CHECK (auth.uid() = id); TRUNCATE en todas las tablas de public; ALL en las
-- vistas; EXECUTE de las diez funciones para PUBLIC/anon/authenticated. Aplicar en una transacción.
begin;

grant select, insert, delete, truncate, references, trigger on public.profiles to anon;
-- v3 · H6: vuelve el SELECT de TABLA (retirar primero el de columnas concedido por 0058 deja el estado idéntico).
revoke select (id, username, avatar, level, points, region) on public.profiles from authenticated;
grant select, insert, delete, truncate, references, trigger on public.profiles to authenticated;
-- v3 · H7: las vistas heredadas vuelven a ser legibles (0057: ALL para anon/authenticated; lo de escritura lo
-- restituye el bucle de vistas de abajo).
grant select, references, trigger on public.ranking_level, public.ranking_collection, public.ranking_market, public.ranking_rarities to anon, authenticated;
drop policy if exists "crea tu perfil" on public.profiles;
create policy "crea tu perfil" on public.profiles for insert with check (auth.uid() = id);

do $$ declare t record; begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('r', 'p') loop
    execute format('grant truncate on public.%I to anon, authenticated', t.relname);
  end loop;
end $$;
alter default privileges for role postgres in schema public grant truncate on tables to anon, authenticated;

do $$ declare v record; begin
  for v in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('v', 'm') loop
    execute format('grant insert, update, delete, truncate on public.%I to anon, authenticated', v.relname);
  end loop;
end $$;

grant execute on function public.recompute_standings(text)             to public, anon, authenticated;
grant execute on function public.recompute_team_stats(text, text)      to public, anon, authenticated;
grant execute on function public.recompute_player_event_stats(text)    to public, anon, authenticated;
grant execute on function public.expire_offers()                       to public, anon, authenticated;
grant execute on function public._release_listing_offers(uuid, uuid)   to public, anon, authenticated;
grant execute on function public._check_wash(uuid, uuid)               to public, anon, authenticated;
grant execute on function public._check_rate(text, integer)            to public, anon, authenticated;
grant execute on function public._check_price_band(text, bigint)       to public, anon, authenticated;
grant execute on function public._price_anchor(text)                   to public, anon, authenticated;
grant execute on function public._asset_refresh_best(text, text, text) to public, anon, authenticated;

commit;
-- NOTA: «ALL» en materializadas no aplica INSERT/UPDATE/DELETE (Postgres lo ignora con aviso); no hay
-- materializadas en public a 2026-09-27. service_role conserva sus privilegios en los dos sentidos.
