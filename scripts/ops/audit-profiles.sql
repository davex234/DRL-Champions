set default_transaction_read_only = on;
\pset format unaligned
\pset tuples_only on
\echo ==profiles_columns
select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='profiles';
\echo ==profiles_column_update_grants_authenticated
select string_agg(column_name, ',') from information_schema.column_privileges where table_schema='public' and table_name='profiles' and grantee='authenticated' and privilege_type='UPDATE';
\echo ==profiles_table_update_grant
select grantee||' '||privilege_type from information_schema.role_table_grants where table_schema='public' and table_name='profiles' and privilege_type in ('UPDATE','SELECT') and grantee in ('anon','authenticated');
\echo ==profiles_triggers
select tgname||' '||pg_get_triggerdef(t.oid) from pg_trigger t where tgrelid='public.profiles'::regclass and not tgisinternal;
\echo ==guard_fn
select p.proname||': '||left(regexp_replace(pg_get_functiondef(p.oid), '\s+', ' ', 'g'), 700) from pg_proc p join pg_trigger t on t.tgfoid=p.oid where t.tgrelid='public.profiles'::regclass and not t.tgisinternal;
\echo ==market_fns_auth
select p.proname||' uses_auth_uid='||(pg_get_functiondef(p.oid) ilike '%auth.uid()%') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('cancel_listing','cancel_offer','expire_offers','search_listings','recompute_standings','recompute_team_stats','recompute_player_event_stats');
\echo ==game_state_columns
select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='game_state';
