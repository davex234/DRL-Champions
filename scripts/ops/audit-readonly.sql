-- F67 · AUDITORÍA DE SOLO LECTURA (sin escrituras: la sesión entera es read-only). Sin datos personales: solo recuentos.
set default_transaction_read_only = on;
\pset format unaligned
\pset tuples_only on
\echo ==size
select pg_size_pretty(pg_database_size(current_database()));
\echo ==tables
select relname||'='||n_live_tup from pg_stat_user_tables where schemaname='public' order by n_live_tup desc limit 40;
\echo ==storage
select 'buckets='||count(*) from storage.buckets;
select 'bucket '||id||' public='||public||' size_limit='||coalesce(file_size_limit::text,'none')||' mimes='||coalesce(array_to_string(allowed_mime_types,','),'any') from storage.buckets;
select 'objects '||bucket_id||'='||count(*) from storage.objects group by bucket_id;
\echo ==schema
select 'migrations_registered='||count(*)||' max='||max(version) from supabase_migrations.schema_migrations;
select 'has_'||t||'='||(to_regclass('public.'||t) is not null) from unnest(array['duel_matches','duel_match_actions','duel_pvp_queue','duel_pvp_ratings','duel_friendships','duel_challenges','duel_active_deck','draft_gauntlet_runs','user_favorites','user_sanctions','content_audit_log','admin_event_drafts','agents','content_cards','content_packs','content_assets','app_rate_limits']) t;
select 'public_tables='||count(*) from information_schema.tables where table_schema='public';
select 'functions_app_admin='||count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname like 'app_admin%';
\echo ==rls
select c.relname||' rls='||c.relrowsecurity||' policies='||(select count(*) from pg_policies p where p.schemaname='public' and p.tablename=c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by c.relrowsecurity, c.relname;
\echo ==grants_anon_authenticated_write
select table_name||' '||grantee||' '||string_agg(privilege_type,',') from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated') and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE') group by table_name, grantee order by 1;
\echo ==integrity
select 'negative_credits='||count(*) from public.profiles where credits < 0;
select 'admins='||count(*) from public.profiles where is_admin;
select 'user_cards_unknown_card='||count(*) from public.user_cards u where not exists (select 1 from public.content_cards c where c.card_id=u.card_id);
select 'duplicate_serials='||count(*) from (select card_id, serial from public.user_cards where serial is not null group by 1,2 having count(*)>1) d;
select 'users_in_two_live_pvp='||count(*) from (select u, count(*) from (select user_id u from public.duel_matches where mode in ('PVP','PVP_PRIVATE') and status='IN_PROGRESS' and closed_reason is null union all select player_b_id from public.duel_matches where mode in ('PVP','PVP_PRIVATE') and status='IN_PROGRESS' and closed_reason is null) x group by u having count(*)>1) y;
select 'live_pvp_overdue_5min='||count(*) from public.duel_matches where mode in ('PVP','PVP_PRIVATE') and status='IN_PROGRESS' and closed_reason is null and turn_deadline_at < now() - interval '5 minutes';
select 'self_matches='||count(*) from public.duel_matches where player_b_id = user_id;
select 'finished_without_result='||count(*) from public.duel_matches where status in ('COMPLETED','DRAW') and not (state ? 'result');
select 'pvp_settled_twice='||count(*) from (select match_id, user_id from public.duel_pvp_rating_events group by 1,2 having count(*)>1) d;
select 'ledger_dup_ref='||count(*) from (select user_id, ref from public.credit_transactions where ref is not null group by 1,2 having count(*)>1) d;
select 'queue_matched_orphan='||count(*) from public.duel_pvp_queue q where q.state='MATCHED' and not exists (select 1 from public.duel_matches m where m.id=q.match_id);
select 'queue_active_per_user_gt1='||count(*) from (select user_id from public.duel_pvp_queue where state in ('QUEUED','PAIRING') group by 1 having count(*)>1) d;
select 'active_deck_missing='||count(*) from public.duel_active_deck a where not exists (select 1 from public.duel_decks d where d.id=a.deck_id);
select 'pve_in_progress_older_7d='||count(*) from public.duel_matches where mode='PVE' and status='IN_PROGRESS' and updated_at < now() - interval '7 days';
\echo ==users
select 'auth_users='||count(*) from auth.users;
select 'qa_like_users='||count(*) from auth.users where email like '%example.invalid' or email like 'qa%';
