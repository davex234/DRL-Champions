set default_transaction_read_only = on;
\pset format unaligned
\pset tuples_only on
select tablename||' | '||policyname||' | '||cmd||' | roles='||array_to_string(roles,',')||' | using='||coalesce(left(qual,90),'-')||' | check='||coalesce(left(with_check,90),'-') from pg_policies where schemaname='public' and cmd in ('INSERT','UPDATE','DELETE','ALL') order by tablename;
\echo ==select_true_on_private
select tablename||' | '||policyname||' | '||array_to_string(roles,',')||' | '||left(qual,80) from pg_policies where schemaname='public' and cmd='SELECT' and tablename in ('profiles','user_cards','user_game','user_pass','user_packs','credit_transactions','economy_ops','duel_decks','inventory','game_state','user_achievements','user_cosmetics','payments','pickem_submissions','pickem_answers','user_strats','coach_matches') order by tablename;
\echo ==storage_policies
select policyname||' | '||cmd||' | '||array_to_string(roles,',')||' | '||coalesce(left(qual,90),'-')||' | '||coalesce(left(with_check,90),'-') from pg_policies where schemaname='storage';
\echo ==security_definer_exec_by_anon
select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE') order by 1;
